/**
 * ★ Đợt 9 (2026-10-25, dieu-phoi duyệt (a)) — HÀNG RÀO NẠP IN-PROCESS khi llama-server NGOÀI đang sống, KHÔNG phụ thuộc env.
 *
 * Sự cố đo được 2026-10-25: một tiến trình vitest thiếu `LLAMA_SERVER_ENABLED` ⇒ `laModelServerDangGiu()` = false ⇒ hàng rào cũ
 * (`aiGgufEngine.chanNapTrungModelServer`) tắt ⇒ node-llama-cpp nạp Qwen3.6-35B (22 GB) IN-PROCESS trong khi :8091 đang phục vụ CHÍNH
 * model đó. Windows đẩy VRAM của llama-server 24 → 8,8 GB; lượt kế của :8091 mất 12,7 s cho prompt 21 token. Bộ điều phối VRAM cũng KHÔNG
 * chặn: tiến trình không chạy reconciler ⇒ `tick` null ⇒ quyết định "mù", basis ledger-only, used 0 GB ⇒ cấp 22 GB (đo bằng
 * `tmp/do-broker-vitest.ts` — sửa ở lô sau).
 *
 * Luật (chỉ cho GGUF > `AI_NAP_KIEM_SERVER_NGOAI_BYTES`, mặc định 8 GiB — model nhỏ (embed/fast/FIM) không tốn lượt thăm dò nào):
 *   1. thăm dò ≤ 500 ms `GET <LLAMA_SERVER_URL | http://127.0.0.1:8091>/v1/models`; không trả lời ⇒ CHO QUA (như cũ);
 *   2. server đang phục vụ CÙNG model ⇒ NÉM `NAP_TRUNG_SERVER_NGOAI` (hướng dẫn đặt LLAMA_SERVER_ENABLED=true);
 *   3. server sống, model KHÁC ⇒ đo VRAM tươi (nvidia-smi); trống < cỡ tệp × 1,10 (hoặc không đo được) ⇒ NÉM `VRAM_KHONG_DU_SERVER_NGOAI`
 *      (luật một instance 30B+ trên card 32 GB).
 */
export type MaLoiNapServerNgoai = "NAP_TRUNG_SERVER_NGOAI" | "VRAM_KHONG_DU_SERVER_NGOAI";

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
  /** Cỡ tệp GGUF (byte); không đọc được ⇒ null (bỏ qua hàng rào — không có căn cứ). */
  coTep: (duong: string) => Promise<number | null>;
  /** Basename (không `.gguf`) model llama-server đang phục vụ; không trả lời trong hạn ⇒ null. */
  modelServer: (url: string, hanMs: number) => Promise<string | null>;
  /** VRAM thiết bị đo TƯƠI; không đo được ⇒ null. */
  vram: () => Promise<{ usedBytes: number; totalBytes: number } | null>;
}

const GiB = 1024 ** 3;
const baseModel = (s: string) => s.replace(/\\/g, "/").split("/").pop()!.replace(/\.gguf$/i, "");

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
  vram: async () => (await import("../vram/vramProbe")).readDeviceVramUncached(),
};

export async function kiemNapKhiServerNgoaiSong(
  modelId: string,
  duongTep: string | undefined,
  viTri: string,
  dep: PhuThuocNapServerNgoai = phuThuocMacDinh,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!duongTep) return;
  const nguong = Number(env.AI_NAP_KIEM_SERVER_NGOAI_BYTES);
  const tran = Number.isFinite(nguong) && nguong > 0 ? nguong : 8 * GiB;
  const co = await dep.coTep(duongTep);
  if (co === null || co <= tran) return;
  const url = (env.LLAMA_SERVER_URL || "").trim() || "http://127.0.0.1:8091";
  const dangPhucVu = await dep.modelServer(url, 500);
  if (dangPhucVu === null) return; // nhánh 1 — không có server ngoài trả lời ⇒ như cũ
  const ten = baseModel(modelId);
  if (dangPhucVu === ten) {
    throw new LoiNapServerNgoai(
      "NAP_TRUNG_SERVER_NGOAI",
      `[aiGgufEngine] (${viTri}) KHÔNG nạp "${ten}" in-process: llama-server ${url} đang phục vụ CHÍNH model này ` +
        `(${(co / GiB).toFixed(1)} GB — nạp thêm = hai bản trên một card, Windows sẽ đẩy VRAM của server ra RAM). ` +
        `Đặt LLAMA_SERVER_ENABLED=true (+ LLAMA_SERVER_URL, LLAMA_SERVER_FAIL_CLOSED=true) để lượt gọi đi qua server.`,
    );
  }
  const v = await dep.vram().catch(() => null);
  const trong = v ? v.totalBytes - v.usedBytes : null;
  if (trong === null || trong < co * 1.1) {
    throw new LoiNapServerNgoai(
      "VRAM_KHONG_DU_SERVER_NGOAI",
      `[aiGgufEngine] (${viTri}) KHÔNG nạp "${ten}" in-process (${(co / GiB).toFixed(1)} GB): llama-server ${url} đang sống ` +
        `(giữ "${dangPhucVu}") và VRAM trống ${trong === null ? "KHÔNG đo được" : `${(trong / GiB).toFixed(1)} GB`} < cần ` +
        `${((co * 1.1) / GiB).toFixed(1)} GB — luật một instance model lớn trên một card.`,
    );
  }
}
