/**
 * ★★ Đợt 9 (2026-10-21, dieu-phoi duyệt) — tool `kiem_bien_dich_st`: tác nhân lập trình TỰ biên dịch thử mã Structured Text
 * (IEC 61131-3; SCL được chuẩn hoá sang ST, giữ số dòng) bằng RuSTy trong docker cách ly (`bienDichST` 8.4: `--network none
 * --read-only --cap-drop ALL`, `plc -c` — CHỈ biên dịch, KHÔNG liên kết, KHÔNG chạy, KHÔNG nạp thiết bị).
 *
 * Đầu vào: `code` (mã ST/SCL thô, hoặc câu trả lời có khối ```st/```scl) HOẶC `path` (tệp .st/.scl trong HỘP CÁT dự án —
 * đọc qua `moTepTrongHopCat`, cùng cửa/ngân sách byte với `read_file`). Đọc thôi, không ghi. Quyền ai_repo_read/canView.
 * Vì sao tool chứ không vòng ẩn: lỗi hiện thành MỘT BƯỚC tool trong bản ghi tác nhân — người dùng thấy, không thay lặng lẽ.
 * (`compile_program` của nhóm lập trình tự động hoá dùng bộ phân tích ST nội bộ — không phải trình biên dịch thật.)
 */
import { z } from "zod";
import { bienDichST, LoiBienDichST } from "../flow/lib/bienDichST";
import { chanDoanChoModel, chanDoanTheoKhoi, ghepMaST } from "../ai/st/kiemBienDichSt";
import { trichMaST, type KhoiMaST } from "../ai/st/trichMaST";
import { dauHieuScl } from "../ai/st/sclSangSt";
import { authCtxParam, authCtxSchema, rbacGate } from "./readToolRbac";
import { ketQuaTuChoiHopCat } from "./repoReadTools";
import { gocHopCat, moTepTrongHopCat } from "./repoSandbox";
import { registerTool, type Tool, type ToolPermission } from "./toolRegistry";

const KIEU = "action_result" as const;
const QUYEN: ToolPermission = { module: "ai_repo_read", action: "canView" };

const thamSo = z
  .object({
    code: z.string().min(1).max(64 * 1024).optional(),
    path: z.string().min(1).max(1024).optional(),
    __authCtx: authCtxParam,
    __projectRoot: z.string().optional(),
  })
  .strict();

interface DuLieuKiemBienDich {
  ok: boolean | null;
  phuongNgu: "st" | "scl" | null;
  soLoi: number;
  chanDoan: { tep: string | null; dong: number | null; cot: number | null; ma: string | null; thongDiep: string }[];
  nguon: "code" | "path" | null;
  path: string | null;
}

const RONG: DuLieuKiemBienDich = { ok: null, phuongNgu: null, soLoi: 0, chanDoan: [], nguon: null, path: null };

/** Mã thô (không rào) ⇒ một khối; có rào ⇒ trích như vòng /v1 (nghi ngờ thì bỏ qua). */
function khoiTuMa(chu: string, tenTep: string | null): KhoiMaST[] {
  const coRao = /```/.test(chu);
  if (coRao) return trichMaST(chu);
  const dh = dauHieuScl(chu);
  const laScl = /\.scl$/i.test(tenTep ?? "") || dh.tenKhoiNgoacKep || dh.soThamChieuThang > 0;
  return [{ ma: chu, nhan: laScl ? "scl" : "st", laScl, batDau: 0, ketThuc: chu.length }];
}

const kiemBienDichStTool: Tool<z.infer<typeof thamSo>, DuLieuKiemBienDich> = {
  name: "kiem_bien_dich_st",
  description:
    "Biên dịch THỬ mã Structured Text IEC 61131-3 (ST/SCL) bằng RuSTy trong sandbox cách ly — CHỈ biên dịch, không chạy, " +
    "không nạp thiết bị. Truyền `code` (mã hoặc khối ```st) hoặc `path` (tệp .st/.scl trong dự án). Trả lỗi theo dòng để " +
    "tự sửa trước khi kết thúc. CHỈ ĐỌC, quyền ai_repo_read/canView. Compile-check IEC 61131-3 Structured Text (no execution).",
  parameters: thamSo,
  triggers: [],
  chiChoAgent: true,
  kind: "read",
  requiredPermission: QUYEN,
  handler: async (params) => {
    const title = "Biên dịch thử ST";
    const raw = params as unknown as Record<string, unknown>;
    const denied = await rbacGate<DuLieuKiemBienDich>(raw.__authCtx, QUYEN, KIEU, title, RONG);
    if (denied) return denied;

    let chu = typeof raw.code === "string" ? raw.code : "";
    let nguon: "code" | "path" = "code";
    let duong: string | null = null;
    if (!chu && typeof raw.path === "string" && raw.path.trim()) {
      const p = authCtxSchema.safeParse(raw.__authCtx);
      const goc = typeof raw.__projectRoot === "string" && raw.__projectRoot ? raw.__projectRoot : gocHopCat();
      const kq = moTepTrongHopCat(raw.path, { khoaNganSach: p.success ? `u:${p.data.userId}` : undefined, goc });
      // Từ chối của hộp cát ⇒ DÙNG LẠI đúng mã + câu của `read_file` (không đẻ mã trùng nghĩa — toolNoteCensus).
      if (!kq.ok) return ketQuaTuChoiHopCat(title, { ...RONG, nguon: "path" as const }, kq.ma, kq.chiTiet);
      chu = kq.noiDung;
      nguon = "path";
      duong = kq.relPath;
    }
    if (!chu.trim()) {
      return { type: KIEU, title, data: RONG, note: "MISSING_REQUIRED_ARG", textSummary: "Thiếu `code` (mã ST) hoặc `path` (tệp .st/.scl)." };
    }
    const khoi = khoiTuMa(chu, duong);
    if (!khoi.length) {
      return { type: KIEU, title, data: { ...RONG, nguon, path: duong }, note: "NO_ST_CODE", textSummary: "Không thấy mã Structured Text để biên dịch (khối rào phải mang nhãn st/scl/iecst, hoặc là mã thô)." };
    }
    const g = ghepMaST(khoi);
    try {
      const r = await bienDichST(g.ma);
      const chanDoan = chanDoanTheoKhoi(r.chanDoan, g.bang, khoi.length).map((d) => ({ ...d, tep: duong && khoi.length === 1 ? duong : d.tep }));
      const loi = chanDoan.filter((d) => d.mucDo === "error");
      const data: DuLieuKiemBienDich = {
        ok: r.ok, phuongNgu: g.phuongNgu, soLoi: loi.length,
        chanDoan: loi.slice(0, 20).map(({ tep, dong, cot, ma, thongDiep }) => ({ tep, dong, cot, ma, thongDiep })),
        nguon, path: duong,
      };
      const textSummary = r.ok
        ? `Biên dịch OK (RuSTy, ${g.phuongNgu === "scl" ? "SCL đã chuẩn hoá sang ST" : "ST"}) — không lỗi.`
        : `Biên dịch THẤT BẠI: ${loi.length} lỗi (RuSTy${g.phuongNgu === "scl" ? ", SCL đã chuẩn hoá — số dòng giữ nguyên" : ""}):\n${chanDoanChoModel(chanDoan)}`;
      return { type: KIEU, title, data, textSummary };
    } catch (e) {
      const lyDo = e instanceof LoiBienDichST ? `${e.loai}: ${e.message}` : String((e as Error)?.message ?? e);
      return { type: KIEU, title, data: { ...RONG, nguon, path: duong }, note: "COMPILER_UNAVAILABLE", textSummary: `Chưa biên dịch thử được (${lyDo.slice(0, 200)}).` };
    }
  },
};

let _daDangKy = false;
export function dangKyKiemBienDichStTool(): void {
  if (_daDangKy) return;
  _daDangKy = true;
  registerTool(kiemBienDichStTool);
}

dangKyKiemBienDichStTool();

export { kiemBienDichStTool };
