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
// Tĩnh (không require — repo là ESM): mô-đun này chỉ được nạp (import động ở goiModelMayChu) khi đang ghi.
import { danhSachDuAn } from "../../aiLocalTools/repoProjects";

export const PHIEN_BAN_GHI_LUOT = 1;
const RE_RUN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HamStream = (options: GgufChatOptions, modelId?: string, signal?: AbortSignal) => AsyncIterable<GgufStreamChunk>;

let daCanhBao = false;
const soLuotTheoRun = new Map<string, number>();

function ghiDong(tep: string, o: unknown): void {
  try {
    // (rà an toàn dieu-phoi) bản thô có system prompt / kết quả tool / suy luận ⇒ chỉ chủ tiến trình đọc được (POSIX 0700/0600; Windows:
    //   quyền thật là ACL của thư mục — thư mục ghi NGOÀI repo, chỉ tài khoản chạy máy chủ).
    fs.mkdirSync(path.dirname(tep), { recursive: true, mode: 0o700 });
    fs.appendFileSync(tep, `${JSON.stringify(o)}\n`, { encoding: "utf8", mode: 0o600 });
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
/** Đường THẬT (theo symlink / junction) của p, hoặc của tổ tiên gần nhất đang tồn tại + phần đuôi chưa có. */
function duongThat(p: string): string {
  let dau = path.resolve(p);
  const duoi: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(dau), ...duoi.reverse());
    } catch {
      const cha = path.dirname(dau);
      if (cha === dau) return path.resolve(p);
      duoi.push(path.basename(dau));
      dau = cha;
    }
  }
}

const trongHoacBang = (con: string, cha: string): boolean => {
  const rel = path.relative(cha, con);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * (rà kiem-dinh + rà an toàn dieu-phoi) thư mục ghi phải TUYỆT ĐỐI và — so bằng đường THẬT (realpath: junction / symlink không lách được) —
 * KHÔNG nằm trong thư mục làm việc của tiến trình (gốc repo khi chạy :3000) hay trong BẤT KỲ gốc dự án nào đã khai (`gocCam`): bản thô
 * trong cây mã ⇒ dễ commit nhầm / bị chính tác nhân đọc lại.
 */
export function thuMucGhiHopLe(thuMuc: string, cwd: string = process.cwd(), gocCam: readonly string[] = []): boolean {
  if (!path.isAbsolute(thuMuc)) return false;
  const that = duongThat(thuMuc);
  return ![cwd, ...gocCam].some((g) => trongHoacBang(that, duongThat(g)));
}

/** Gốc mọi dự án hộp cát đang khai (env + DB) — lỗi ⇒ [] (cwd vẫn được kiểm). */
function gocDuAnDaKhai(): string[] {
  try {
    return danhSachDuAn().map((d) => d.goc);
  } catch {
    return [];
  }
}

let daBaoBat = false;

export function bocGhiLuot(goc: HamStream, o: { thuMuc: string; runId: string }): HamStream {
  if (!RE_RUN.test(o.runId) || !thuMucGhiHopLe(o.thuMuc, process.cwd(), gocDuAnDaKhai())) {
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
