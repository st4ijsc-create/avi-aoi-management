/**
 * doc 81 Đợt 1D final wave 1 (Ruling R-1D-k, final review I1) — MỘT định nghĩa DUY NHẤT của "adapter này nói
 * chuyện với THIẾT BỊ NÀO": protocol + endpoint + machineId + connectionOptions trừ bí mật / tài khoản / chế độ
 * bảo mật (các khoá đó đổi CÁCH nói chuyện, không đổi thiết bị). Dùng chung bởi:
 *   • `adapterDoiDich` (stopPin.ts, Ruling R-1D-a) — sửa adapter đổi đích ⇒ gỡ mọi ghim DỪNG;
 *   • `otManager` — dấu vân tay kết nối ghi lại LÚC NỐI cho mỗi adapter đang chạy;
 *   • `commandDispatcher` (5a-stop) — lệnh DỪNG ghim chỉ được miễn preflight khi dấu vân tay của kết nối ĐANG
 *     CHẠY bằng dấu vân tay của hàng adapter HIỆN TẠI (sửa adapter không nối lại driver ⇒ kết nối cũ vẫn tới
 *     thiết bị CŨ; ghim mới chọn cho thiết bị mới không được đi qua nó mà bỏ qua preflight).
 * THUẦN: không DB, không I/O.
 */
import { createHash } from "node:crypto";
import { canonicalize } from "../security/auditChain";
import { SENSITIVE_KEY_RE } from "../assetRegistry/configDriftService";

/** Các trường xác định "thiết bị nào" của một adapter (hàng DB hoặc RuntimeAdapter đã quy đổi). */
export interface AdapterTarget {
  protocol: string;
  endpoint: string;
  machineId?: number | null;
  connectionOptions?: unknown;
}

/** Khoá cấu hình KHÔNG xác định "thiết bị nào": bí mật (SENSITIVE_KEY_RE), tài khoản, ràng buộc bảo mật. */
const KHOA_KHONG_DINH_DANH = new Set(["userName", "username", "user", "securityMode", "securityPolicy", "trustOnFirstUse"]);

/** connectionOptions bỏ bí mật / tài khoản / bảo mật (đệ quy), để so "đích kết nối". */
export function dichKetNoi(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dichKetNoi);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k) || KHOA_KHONG_DINH_DANH.has(k)) continue;
      if (x === undefined) continue;
      out[k] = dichKetNoi(x);
    }
    return out;
  }
  return v;
}

/** Dạng CHUẨN (JSON khoá sắp xếp) của đích adapter. `connectionOptions` vắng ≡ null; machineId vắng ≡ null. */
export function adapterTargetCanonical(t: AdapterTarget): string {
  return canonicalize({
    protocol: String(t.protocol ?? ""),
    endpoint: String(t.endpoint ?? ""),
    machineId: t.machineId ?? null,
    target: dichKetNoi(t.connectionOptions ?? null) ?? null,
  });
}

/** Dấu vân tay kết nối (sha256 hex của dạng chuẩn). Cùng thiết bị ⇔ cùng dấu. */
export function adapterTargetFingerprint(t: AdapterTarget): string {
  return createHash("sha256").update(adapterTargetCanonical(t)).digest("hex");
}

/** Đích của một RuntimeAdapter (otManager) — cùng hình với hàng DB (`connection.options` vắng ≡ null). */
export function runtimeAdapterTarget(a: {
  protocol: string;
  machineId: number | null;
  connection: { endpoint: string; options?: Record<string, unknown> };
}): AdapterTarget {
  return { protocol: a.protocol, endpoint: a.connection.endpoint, machineId: a.machineId, connectionOptions: a.connection.options ?? null };
}
