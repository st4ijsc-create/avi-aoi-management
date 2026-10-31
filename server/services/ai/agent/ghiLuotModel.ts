/**
 * ★ Đợt 12 H4.2 (thiết kế `docs/superpowers/specs/2026-10-31-h4-2-ghi-phat-lai-luot-agent.md`, dieu-phoi duyệt 2026-10-31) — BỘ GHI lượt
 * model của tác nhân máy chủ: bọc `HamChatStream` (đúng chỗ harness gọi model, `goiModelMayChu`), chuyển NGUYÊN từng mảnh cho người gọi
 * và ghi thêm một dòng JSONL mỗi lượt model vào `<thư mục>/<runId>.jsonl`:
 *   `{ loai:"dau", phienBan, ngay, node, runId }` (một lần) · `{ loai:"luot", n, modelId, options, manh: GgufStreamChunk[], loi? }`.
 * BẢN THÔ — chỉ để ở thư mục tạm của TIẾN TRÌNH ĐO; bước đóng gói (che bí mật + quét đường tuyệt đối + băm system/tool) mới tạo fixture vào
 * repo. Bật DUY NHẤT bằng `AI_GHI_LUOT_DIR` mà `goiModelMayChu.ts` đọc (census); vắng ⇒ không bọc, đường gọi y nguyên từng byte.
 * Ghi hỏng KHÔNG BAO GIỜ làm hỏng lượt model (nuốt + cảnh báo một lần).
 */
import fs from "node:fs";
import path from "node:path";
import type { GgufChatOptions, GgufStreamChunk } from "../../aiGgufEngine";

export const PHIEN_BAN_GHI_LUOT = 1;
const RE_RUN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HamStream = (options: GgufChatOptions, modelId?: string, signal?: AbortSignal) => AsyncIterable<GgufStreamChunk>;

let daCanhBao = false;
const soLuotTheoRun = new Map<string, number>();

function ghiDong(tep: string, o: unknown): void {
  try {
    fs.mkdirSync(path.dirname(tep), { recursive: true });
    fs.appendFileSync(tep, `${JSON.stringify(o)}\n`, "utf8");
  } catch (e) {
    if (!daCanhBao) {
      daCanhBao = true;
      console.warn("[ghiLuotModel] không ghi được lượt (bỏ qua, lượt model không bị ảnh hưởng):", (e as Error)?.message ?? e);
    }
  }
}

/**
 * Bọc `goc` để ghi mỗi lượt. `thuMuc` tuyệt đối (do người đo đặt), `runId` phải là UUID (tên tệp) — sai ⇒ trả `goc` nguyên (không ghi).
 * Thứ tự mảnh giữ đúng như engine phát; lỗi giữa luồng được ghi (`loi`) rồi NÉM LẠI nguyên vẹn.
 */
/** (rà kiem-dinh) thư mục ghi nằm TRONG thư mục làm việc của tiến trình (gốc repo khi chạy :3000) ⇒ dễ commit nhầm bản thô ⇒ từ chối. */
export function thuMucGhiHopLe(thuMuc: string, cwd: string = process.cwd()): boolean {
  if (!path.isAbsolute(thuMuc)) return false;
  const rel = path.relative(path.resolve(cwd), path.resolve(thuMuc));
  const trong = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  return !trong;
}

let daBaoBat = false;

export function bocGhiLuot(goc: HamStream, o: { thuMuc: string; runId: string }): HamStream {
  if (!RE_RUN.test(o.runId) || !thuMucGhiHopLe(o.thuMuc)) {
    if (!daCanhBao && o.thuMuc) {
      daCanhBao = true;
      console.warn(`[ghiLuotModel] thư mục ghi lượt bị BỎ QUA (phải là thư mục tuyệt đối NGOÀI thư mục làm việc của tiến trình): ${o.thuMuc}`);
    }
    return goc;
  }
  if (!daBaoBat) {
    daBaoBat = true;
    console.warn(`[ghiLuotModel] ⚠ ĐANG GHI NGUYÊN VĂN lượt model của tác nhân (prompt, kết quả tool, suy luận) ra ${o.thuMuc} — CHỈ dùng trong cửa sổ đo; khởi động lại KHÔNG có biến ghi lượt khi xong.`);
  }
  const tep = path.join(o.thuMuc, `${o.runId.toLowerCase()}.jsonl`);
  return async function* (options, modelId, signal) {
    const n = (soLuotTheoRun.get(o.runId) ?? 0) + 1;
    soLuotTheoRun.set(o.runId, n);
    if (n === 1) ghiDong(tep, { loai: "dau", phienBan: PHIEN_BAN_GHI_LUOT, ngay: new Date().toISOString(), node: process.version, runId: o.runId });
    const manh: GgufStreamChunk[] = [];
    let loi: string | undefined;
    try {
      for await (const c of goc(options, modelId, signal)) {
        manh.push(c);
        yield c;
      }
    } catch (e) {
      loi = (e as Error)?.message ?? String(e);
      throw e;
    } finally {
      ghiDong(tep, { loai: "luot", n, modelId: modelId ?? null, options, manh, ...(loi !== undefined ? { loi } : {}) });
    }
  };
}

/** Lưới: quên bộ đếm lượt (mỗi ca một runId mới thì không cần). */
export function _datLaiGhiLuot(): void {
  soLuotTheoRun.clear();
  daCanhBao = false;
  daBaoBat = false;
}
