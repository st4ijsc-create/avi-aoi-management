/**
 * G0 — Hardening upload: validate magic-byte (MIME thực) + giới hạn size theo loại.
 *
 * Mục tiêu: chặn file giả mạo phần mở rộng & file vượt ngưỡng cho từng route,
 * mà KHÔNG phá vỡ luồng upload đang chạy (chỉ kiểm tra, trả 400/413 khi vi phạm).
 *
 * Dùng cho các route `express.raw(...)` (req.body là Buffer). Không phụ thuộc package ngoài.
 */

export type UploadKind = "apk" | "zip" | "image" | "gguf" | "model3d" | "any";

/** Ngưỡng size mặc định theo loại (byte). Có thể override qua ENV. */
const DEFAULT_MAX_BYTES: Record<UploadKind, number> = {
  apk: 300 * 1024 * 1024,
  zip: 500 * 1024 * 1024,
  image: 25 * 1024 * 1024,
  gguf: 8 * 1024 * 1024 * 1024,
  model3d: 100 * 1024 * 1024,
  any: 200 * 1024 * 1024,
};

function maxBytesFor(kind: UploadKind): number {
  const envKey = `UPLOAD_MAX_BYTES_${kind.toUpperCase()}`;
  const override = Number(process.env[envKey]);
  if (Number.isFinite(override) && override > 0) return override;
  return DEFAULT_MAX_BYTES[kind];
}

/** Nhận diện MIME thực qua magic bytes (signature) của Buffer. */
export function sniffMime(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;
  const b = buf;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  // WEBP (RIFF....WEBP)
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return "image/webp";
  // BMP
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  // ZIP / APK / JAR (PK\x03\x04). APK là ZIP container.
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return "application/zip";
  // GGUF (model file): magic "GGUF"
  if (b[0] === 0x47 && b[1] === 0x47 && b[2] === 0x55 && b[3] === 0x46) return "application/x-gguf";
  // glTF binary (GLB): magic "glTF" (0x67 0x6C 0x54 0x46)
  if (b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) return "model/gltf-binary";
  return null;
}

/** Tập MIME hợp lệ cho từng loại upload. */
const ALLOWED_MIME: Record<UploadKind, string[]> = {
  apk: ["application/zip"], // APK = ZIP container
  zip: ["application/zip"],
  image: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"],
  gguf: ["application/x-gguf"],
  model3d: ["model/gltf-binary", "model/gltf+json"],
  any: [],
};

export interface UploadValidationResult {
  ok: boolean;
  status?: number; // 413 quá lớn, 400 sai loại
  error?: string;
  detectedMime?: string | null;
  size?: number;
}

/**
 * Kiểm tra một Buffer upload theo loại. Trả {ok:true} nếu hợp lệ.
 * - Vượt ngưỡng → 413.
 * - MIME thực không nằm trong allow-list của loại → 400.
 * - kind "any" chỉ kiểm tra size.
 */
export function validateUpload(buf: Buffer, kind: UploadKind): UploadValidationResult {
  const size = buf ? buf.length : 0;
  if (size === 0) {
    return { ok: false, status: 400, error: "Empty upload body", size };
  }

  const max = maxBytesFor(kind);
  if (size > max) {
    return {
      ok: false,
      status: 413,
      error: `File quá lớn: ${(size / 1048576).toFixed(1)}MB > giới hạn ${(max / 1048576).toFixed(0)}MB`,
      size,
    };
  }

  if (kind === "any") return { ok: true, size, detectedMime: sniffMime(buf) };

  // glTF 2.0: accept a GLB (binary, magic "glTF") OR a JSON glTF (text that starts with
  // '{' and declares an "asset"). No fabrication — anything else is rejected 400.
  if (kind === "model3d") {
    if (sniffMime(buf) === "model/gltf-binary") return { ok: true, detectedMime: "model/gltf-binary", size };
    const head = buf.subarray(0, 512).toString("utf8").replace(/^﻿/, "").trimStart();
    if (head.startsWith("{") && head.includes('"asset"')) return { ok: true, detectedMime: "model/gltf+json", size };
    return {
      ok: false,
      status: 400,
      error: "Loại file không hợp lệ cho 'model3d'. Cần glTF 2.0 (.glb nhị phân hoặc .gltf JSON có \"asset\").",
      detectedMime: sniffMime(buf),
      size,
    };
  }

  const detected = sniffMime(buf);
  const allowed = ALLOWED_MIME[kind];
  if (!detected || !allowed.includes(detected)) {
    return {
      ok: false,
      status: 400,
      error: `Loại file không hợp lệ cho '${kind}'. Phát hiện: ${detected ?? "unknown"}; cho phép: ${allowed.join(", ")}`,
      detectedMime: detected,
      size,
    };
  }

  return { ok: true, detectedMime: detected, size };
}

/**
 * Express middleware factory: validate `req.body` (Buffer từ express.raw) theo loại.
 * Đặt SAU express.raw(...) trong cùng route. Tự gửi response lỗi khi vi phạm.
 */
export function uploadGuard(kind: UploadKind) {
  return (req: any, res: any, next: () => void) => {
    const body: Buffer = req.body;
    if (!Buffer.isBuffer(body)) {
      // Không phải raw buffer (vd JSON) — bỏ qua, để handler xử lý.
      return next();
    }
    const result = validateUpload(body, kind);
    if (!result.ok) {
      return res.status(result.status ?? 400).json({ success: false, error: result.error });
    }
    next();
  };
}
