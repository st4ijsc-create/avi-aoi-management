/**
 * ★ Đợt 9 (2026-10-25, dieu-phoi duyệt) — HÀNG RÀO NẠP GGUF IN-PROCESS (node-llama-cpp), KHÔNG phụ thuộc env của llama-server.
 *
 * Hai sự cố đo được cùng ngày:
 *   • 35B nạp lần hai trong vitest thiếu `LLAMA_SERVER_ENABLED` ⇒ Windows đẩy VRAM của :8091 24 → 8,8 GB, lượt kế 12,7 s/21 token.
 *   • Qwen3-4B in-process THỰC chiếm 5.540 MiB dedicated (tệp chỉ 2.428 MiB) ⇒ :3000 giữ 4B + một tiến trình thứ hai nạp 4B = tràn card
 *     (đỉnh đo được 30,2 / 32,6 GB với MỘT bản). Ngưỡng cũ "tệp > 8 GiB" để lọt lớp này.
 *
 * Luật, theo thứ tự (mọi lượt nạp GGUF in-process — `aiGgufEngine.loadGgufModel` → `chanNapTrungModelServer`):
 *   0. CỔNG TIẾN TRÌNH: chỉ tiến trình MÁY CHỦ ứng dụng (`server/_core/index.ts` gọi `danhDauTienTrinhMayChu()`) được nạp in-process.
 *      Tiến trình khác (vitest, script tsx) ⇒ NÉM `NAP_IN_PROCESS_BI_TAT` trừ khi bật tường minh `AI_CHO_NAP_TRONG_TIEN_TRINH=1`.
 *   1. llama-server NGOÀI (≤ 500 ms `GET <LLAMA_SERVER_URL | :8091>/v1/models`) đang phục vụ CÙNG model ⇒ NÉM `NAP_TRUNG_SERVER_NGOAI`.
 *   2. DẤU CHÂN ước tính = cỡ tệp × 1,0 + 3.112 MiB (context ctx 4096 + CUDA context + bộ đệm tính — NGUỒN: 4B đo 5.540 MiB dedicated,
 *      tệp 2.546.340.960 B = 2.428 MiB ⇒ phần ngoài trọng số 3.112 MiB; 2026-10-25 `tmp/vram-pl.log`). So với VRAM trống ĐO TƯƠI trừ biên
 *      1.536 MiB (mã hoá ảnh mmproj "worst-case 1130,63 MiB" + dư). Thiếu ⇒ NÉM `VRAM_KHONG_DU_NAP`. Không đo được VRAM ⇒ chỉ chặn khi
 *      llama-server ngoài đang sống (không biết ⇒ không đoán là trống); không có server ngoài ⇒ cho qua như cũ (máy CPU / không GPU).
 * Hằng số chỉnh bằng env: `AI_NAP_PHU_TROI_MB` (3112), `AI_NAP_BIEN_AN_TOAN_MB` (1536), `AI_NAP_HE_SO_TEP` (1.0).
 */
export type MaLoiNapServerNgoai = "NAP_TRUNG_SERVER_NGOAI" | "VRAM_KHONG_DU_NAP" | "NAP_IN_PROCESS_BI_TAT";

export class LoiNapServerNgoai extends Error {
  constructor(
    readonly code: MaLoiNapServerNgoai,
    thongDiep: string,
  ) {
    super(thongDiep);
    this.name = "LoiNapServerNgoai";
  }
}

export interface PhuThuocNapServerNgoai {
  /** Cỡ tệp GGUF (byte); không đọc được ⇒ null. */
  coTep: (duong: string) => Promise<number | null>;
  /** Basename (không `.gguf`) model llama-server đang phục vụ; không trả lời trong hạn ⇒ null. */
  modelServer: (url: string, hanMs: number) => Promise<string | null>;
  /** VRAM thiết bị đo TƯƠI; không đo được ⇒ null. */
  vram: () => Promise<{ usedBytes: number; totalBytes: number } | null>;
  /** Tiến trình này có phải máy chủ ứng dụng không. */
  laMayChu: () => boolean;
}

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const baseModel = (s: string) => s.replace(/\\/g, "/").split("/").pop()!.replace(/\.gguf$/i, "");
const KHOA_MAY_CHU = Symbol.for("avi.ai.tienTrinhMayChu");

/** Gọi MỘT lần ở `server/_core/index.ts` (cả vai api lẫn worker). Cờ nằm trên `globalThis` — tiến trình con KHÔNG thừa kế (khác env). */
export function danhDauTienTrinhMayChu(): void {
  (globalThis as Record<symbol, unknown>)[KHOA_MAY_CHU] = true;
}

export const phuThuocMacDinh: PhuThuocNapServerNgoai = {
  coTep: async (duong) => {
    try {
      const fs = await import("node:fs");
      const st = fs.statSync(duong);
      return st && Number.isFinite(st.size) ? st.size : null;
    } catch {
      return null;
    }
  },
  modelServer: async (url, hanMs) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), hanMs);
    try {
      const key = (process.env.LLAMA_SERVER_API_KEY || "").trim();
      const res = await fetch(`${url.replace(/\/+$/, "")}/v1/models`, { signal: ctrl.signal, headers: key ? { authorization: `Bearer ${key}` } : {} });
      if (!res.ok) return null;
      const j = (await res.json()) as { data?: Array<{ id?: unknown }>; models?: Array<{ model?: unknown; name?: unknown }> };
      const id = j?.data?.[0]?.id ?? j?.models?.[0]?.model ?? j?.models?.[0]?.name;
      return typeof id === "string" && id.trim() ? baseModel(id) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  },
  vram: async () => {
    let hen: ReturnType<typeof setTimeout> | undefined;
    const kq = await Promise.race([
      (await import("../vram/vramProbe")).readDeviceVramUncached().catch(() => null),
      new Promise<null>((r) => {
        hen = setTimeout(() => r(null), 3000);
      }),
    ]);
    if (hen) clearTimeout(hen);
    return kq;
  },
  laMayChu: () => (globalThis as Record<symbol, unknown>)[KHOA_MAY_CHU] === true,
};

const soMB = (raw: string | undefined, md: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : md;
};

/** Dấu chân VRAM ước tính của một lượt nạp in-process (byte). Công thức + nguồn số: đầu tệp. */
export function dauChanUocTinh(coTepBytes: number, env: NodeJS.ProcessEnv = process.env): number {
  const heSo = Number(env.AI_NAP_HE_SO_TEP);
  return coTepBytes * (Number.isFinite(heSo) && heSo > 0 ? heSo : 1) + soMB(env.AI_NAP_PHU_TROI_MB, 3112) * MiB;
}

export async function kiemNapKhiServerNgoaiSong(
  modelId: string,
  duongTep: string | undefined,
  viTri: string,
  dep: PhuThuocNapServerNgoai = phuThuocMacDinh,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const ten = baseModel(modelId);
  // 0 — cổng tiến trình.
  if (!dep.laMayChu() && env.AI_CHO_NAP_TRONG_TIEN_TRINH !== "1") {
    throw new LoiNapServerNgoai(
      "NAP_IN_PROCESS_BI_TAT",
      `[aiGgufEngine] (${viTri}) KHÔNG nạp "${ten}" in-process: tiến trình này không phải máy chủ ứng dụng (vitest/script). ` +
        `Gọi model qua llama-server (LLAMA_SERVER_ENABLED=true, LLAMA_SERVER_URL, LLAMA_SERVER_FAIL_CLOSED=true), hoặc — nếu CHỦ ĐÍCH nạp ` +
        `model nhỏ trong tiến trình và đã kiểm VRAM — đặt AI_CHO_NAP_TRONG_TIEN_TRINH=1.`,
    );
  }
  if (!duongTep) return;
  const co = await dep.coTep(duongTep);
  if (co === null) return; // không có tệp thật ⇒ không có căn cứ (đường lỗi nạp sẽ tự báo)
  const url = (env.LLAMA_SERVER_URL || "").trim() || "http://127.0.0.1:8091";
  // 1 — cùng model với server ngoài.
  const dangPhucVu = await dep.modelServer(url, 500);
  if (dangPhucVu !== null && dangPhucVu === ten) {
    throw new LoiNapServerNgoai(
      "NAP_TRUNG_SERVER_NGOAI",
      `[aiGgufEngine] (${viTri}) KHÔNG nạp "${ten}" in-process: llama-server ${url} đang phục vụ CHÍNH model này ` +
        `(${(co / GiB).toFixed(1)} GB — nạp thêm = hai bản trên một card, Windows sẽ đẩy VRAM của server ra RAM). ` +
        `Đặt LLAMA_SERVER_ENABLED=true (+ LLAMA_SERVER_URL, LLAMA_SERVER_FAIL_CLOSED=true) để lượt gọi đi qua server.`,
    );
  }
  // 2 — dấu chân so với VRAM trống đo tươi. Nạp CPU (`GGUF_GPU=false` — engine `getLlama({gpu:false})`) không chạm VRAM ⇒ bỏ qua bước này
  // (phát hiện khi đo bộ nhúng chạy CPU 2026-10-25: hàng rào từ chối oan một lượt nạp 0 byte VRAM).
  if (env.GGUF_GPU === "false") return;
  const can = dauChanUocTinh(co, env) + soMB(env.AI_NAP_BIEN_AN_TOAN_MB, 1536) * MiB;
  const v = await dep.vram().catch(() => null);
  const trong = v ? v.totalBytes - v.usedBytes : null;
  if (trong === null) {
    if (dangPhucVu === null) return; // không GPU đo được + không server ngoài ⇒ như cũ
  } else if (trong >= can) {
    return;
  }
  throw new LoiNapServerNgoai(
    "VRAM_KHONG_DU_NAP",
    `[aiGgufEngine] (${viTri}) KHÔNG nạp "${ten}" in-process: cần ~${(can / MiB).toFixed(0)} MiB (dấu chân ${(dauChanUocTinh(co, env) / MiB).toFixed(0)} ` +
      `+ biên ${soMB(env.AI_NAP_BIEN_AN_TOAN_MB, 1536)}), VRAM trống ${trong === null ? "KHÔNG đo được" : `${(trong / MiB).toFixed(0)} MiB`}` +
      `${dangPhucVu ? ` (llama-server ${url} đang giữ "${dangPhucVu}")` : ""} — nạp sẽ làm tràn card và đẩy VRAM tiến trình khác ra RAM.`,
  );
}
