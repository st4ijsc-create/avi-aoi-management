/**
 * ★★★ Luồng AI Đợt 8.5 — CỔNG OT CỦA LUỒNG: hàm bao DUY NHẤT `kiemVaDeXuat()`. Spec §4.5 (nhóm OT), §4.6 (hạng `ot`),
 * quyết định D4 của chủ dự án: Luồng chạm OT bản đầu CHỈ ĐỌC + ĐỀ XUẤT ở CHẾ ĐỘ MÔ PHỎNG.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN (lưới `otLuongCensus.test.ts` canh ∀, không canh danh sách):
 *   1. Tệp này là chỗ DUY NHẤT dưới `server/services/flow/**` import `server/services/ot/*` (chỉ `aiControlGate`).
 *   2. ∀ node đăng ký hạng `ot` gọi `kiemVaDeXuat` — và không node nào dưới `flow/**` import/gọi dispatcher, động cơ FOE,
 *      `confirmAction`, driver hay `sendCommand`.
 *   3. KHÔNG CÓ ĐƯỜNG THỰC THI. Hàm này chỉ trả một YÊU CẦU CHỜ DUYỆT (hàng `ai_flow_waits`); không có hàm `execute` nào gắn
 *      vào hàng đó. Người duyệt đồng ý ⇒ item đi tiếp với `thucThi.daGui = false` — "đã duyệt (mô phỏng) — không gửi".
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * VÌ SAO KHÔNG `proposeAction` (spec §4.5 ghi "đi `aiControlGate` + `proposeAction`"): `proposeAction` cần một `Tool` đăng ký
 * trong `toolRegistry` (lộ ra cho model chat) và `confirmAction` gọi `tool.execute()` — tức một đường thực thi tồn tại THEO
 * CẤU TẠO, cộng nhánh tự trị D2 có thể tự confirm; hàng `ai_pending_actions` còn gắn MỘT người (người đề xuất = người duyệt),
 * trong khi lượt Luồng chạy nền không có phiên người dùng. Hàng chờ duyệt của Luồng (`nguoi.duyet` 8.1) là bản ghi tương
 * đương: duyệt theo vai trên trang duyệt sẵn có, có hạn, sống qua sập, và không mang hàm thực thi nào.
 *
 * FAIL-CLOSED, CHẶT HƠN CỔNG CHUNG (cổng chung phục vụ tool chat; đường Luồng nhận tham số từ BIỂU THỨC — dữ liệu không tin cậy):
 *   • tên lệnh khớp CHÍNH XÁC (không hạ chữ, không cắt khoảng trắng) — `"STOP"`, `" stop"`, `"ѕtop"` (chữ Kirin) ⇒ không nhận
 *     ra ⇒ `phanLoaiMuc` ⇒ mức 5;
 *   • tag phải đúng khuôn ASCII, và sau khi chuẩn hoá NFKC + bỏ dấu nối vẫn không khớp khuôn tag an toàn (`E-STOP`, `ｓafety`…),
 *     và phải TỒN TẠI trong `device_tags` của máy (đọc) — không thì mức 5;
 *   • tham số sai kiểu (máy không phải số nguyên dương, giá trị lạ) ⇒ mức 5.
 *   `kiemCongAi` được gọi với `env: {}` (cờ `AI_OT_CONTROL_ENABLED` luôn coi là TẮT trên đường này — chế độ mô phỏng là HẰNG
 *   SỐ, không đọc env), bộ đếm riêng, `tieuQuota: false` ⇒ nó KHÔNG BAO GIỜ trả `choPhep: true`; nếu có ⇒ ném (bất biến hỏng).
 */
import { and, eq } from "drizzle-orm";
import { BoDemTanSuat, kiemCongAi, laTagAnToan, phanLoaiMuc, type MucRuiRo } from "../../ot/aiControlGate";
import type { ItemLuong } from "../../../../shared/flow/bieuThuc";
import type { BoKiemPhamVi, YeuCauCho } from "../dangKyNut";
import { chuanHoaIdMay } from "../idTaiNguyen";

/** ★ Chế độ mô phỏng — HẰNG SỐ của pha 8.5. Không cờ env nào tắt được; mở đường thực thi là một pha khác, có duyệt riêng. */
export const CHE_DO_MO_PHONG = true as const;
export const NGUON_LUONG_AI = "luong-ai" as const;
export const GHI_CHU_DA_DUYET_MO_PHONG = "đã duyệt (mô phỏng) — không gửi";

/** Động từ lệnh của Luồng / FOE ⇒ tên tool trong bảng tra của `aiControlGate`. KHỚP CHÍNH XÁC; tên khác đi thẳng vào `phanLoaiMuc`. */
const LENH_SANG_TOOL: ReadonlyMap<string, string> = new Map([
  ["stop", "machine_stop"],
  ["pause", "machine_pause"],
  ["start", "machine_start"],
  ["reset", "machine_reset"],
]);

/** Tên tool dùng để phân loại một lệnh. Không phải chuỗi ⇒ "" (⇒ mức 5). Không chuẩn hoá gì cả — cố ý. */
export function toolChoLenh(lenh: unknown): string {
  if (typeof lenh !== "string") return "";
  return LENH_SANG_TOOL.get(lenh) ?? lenh;
}

const RE_TAG = /^[A-Za-z0-9_.]{1,64}$/;

/** Tag KHÔNG được đường Luồng chấp nhận theo tên: sai khuôn ASCII, hoặc (kể cả sau chuẩn hoá) khớp khuôn tag an toàn. */
export function laTagBiChan(tag: string): boolean {
  if (!RE_TAG.test(tag)) return true;
  if (laTagAnToan(tag)) return true;
  const chuan = tag.normalize("NFKC");
  return laTagAnToan(chuan.replace(/[^A-Za-z0-9]+/g, "_")) || laTagAnToan(chuan.replace(/[^A-Za-z0-9]+/g, ""));
}

export interface YeuCauLenhOt {
  loai: "lenh";
  may: unknown;
  lenh: unknown;
  tag?: unknown;
  giaTri?: unknown;
  hetHanGio?: unknown;
}

export interface YeuCauLuongFoe {
  loai: "luong-foe";
  workflowId: unknown;
  version: unknown;
  thamSo?: unknown;
  hetHanGio?: unknown;
}

export type YeuCauOt = YeuCauLenhOt | YeuCauLuongFoe;

/** Nguồn ĐỌC mà cổng cần (tiêm được cho lưới). Mặc định: đọc CSDL, không ghi gì. */
export interface PhuThuocCongOt {
  tagTonTai(may: number, tag: string): Promise<boolean>;
  docLuongFoe(workflowId: number, version: number): Promise<{ ref: string; ten: string; trangThai: string; definition: unknown } | null>;
}

export interface NguCanhDeXuat {
  runId: string;
  nodeId: string;
  idempotencyKey: string;
  /** Đợt 9 (IDOR) — có ⇒ FOE workflow có bước tham chiếu máy ngoài phạm vi bị coi như KHÔNG CÓ (cùng câu trả lời với không tồn tại). */
  boKiem?: BoKiemPhamVi;
}

export type KetQuaKiemOt =
  | { ketQua: "tu-choi-muc-cao"; muc: 4 | 5; ma: string; lyDo: string }
  | { ketQua: "da-de-xuat"; deXuatId: string; muc: 1 | 3; yeuCauCho: YeuCauCho };

export class LoiCongOt extends Error {
  constructor(
    public readonly muc: number,
    message: string,
  ) {
    super(message);
    this.name = "LoiCongOt";
  }
}

// ── phụ thuộc mặc định: CHỈ ĐỌC ──────────────────────────────────────────────────────────────────

const phuThuocMacDinh: PhuThuocCongOt = {
  async tagTonTai(may, tag) {
    const { getDb } = await import("../../../db/connection");
    const { deviceAdapters, deviceTags } = await import("../../../../drizzle/schema");
    const db = await getDb();
    if (!db) return false;
    const rows = await db
      .select({ id: deviceTags.id })
      .from(deviceTags)
      .innerJoin(deviceAdapters, eq(deviceAdapters.id, deviceTags.adapterId))
      .where(and(eq(deviceAdapters.machineId, may), eq(deviceTags.tagKey, tag)))
      .limit(1);
    return rows.length > 0;
  },
  async docLuongFoe(workflowId, version) {
    const { getDb } = await import("../../../db/connection");
    const { orchestrationWorkflows, orchestrationWorkflowVersions } = await import("../../../../drizzle/schema");
    const db = await getDb();
    if (!db) return null;
    const [wf] = await db.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, workflowId)).limit(1);
    if (!wf) return null;
    const [v] = await db
      .select()
      .from(orchestrationWorkflowVersions)
      .where(and(eq(orchestrationWorkflowVersions.workflowId, workflowId), eq(orchestrationWorkflowVersions.version, version)))
      .limit(1);
    const definition = v ? v.definitionJson : wf.version === version ? wf.definitionJson : null;
    if (definition == null) return null;
    return { ref: wf.ref, ten: wf.name, trangThai: wf.status, definition };
  },
};

let phuThuocHienHanh: PhuThuocCongOt = phuThuocMacDinh;

/** Đọc một FOE workflow qua nguồn HIỆN HÀNH (mặc định: CSDL, chỉ đọc) — dùng chung với kiểm tham chiếu tĩnh lúc BẬT luồng. */
export function docLuongFoeHienHanh(workflowId: number, version: number) {
  return phuThuocHienHanh.docLuongFoe(workflowId, version);
}

/**
 * ★★★ Đợt 9 (IDOR) — MỌI bước FOE mang `machineId` phải trỏ máy TỒN TẠI và thuộc phạm vi (`boKiem`). Hình dạng lạ / `machineId` sai kiểu ⇒
 * `false` (đóng theo mặc định). FOE workflow không có cột tenant: phạm vi của nó CHÍNH LÀ phạm vi các máy nó nhắm tới.
 */
export async function luongFoeTrongPhamVi(definition: unknown, boKiem: BoKiemPhamVi): Promise<boolean> {
  const steps = buocFoe((definition as { steps?: unknown } | null)?.steps ?? null);
  if (!steps) return false;
  for (const b of steps) {
    if (!("machineId" in b) || b.machineId === undefined) continue;
    const id = b.machineId;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || !(await boKiem.may(id))) return false;
  }
  return true;
}

/** Chỉ lưới: thay nguồn đọc (tag / FOE). `null` ⇒ về mặc định. */
export function __datPhuThuocCongOtChoTest(p: Partial<PhuThuocCongOt> | null): void {
  phuThuocHienHanh = p ? { ...phuThuocMacDinh, ...p } : phuThuocMacDinh;
}

// ── phân loại ────────────────────────────────────────────────────────────────────────────────────

interface PhanLoai {
  muc: MucRuiRo;
  ma: string;
  lyDo: string;
}

const MUC_5 = (lyDo: string): PhanLoai => ({ muc: 5, ma: "KHONG_NHAN_RA", lyDo: `TỪ CHỐI (fail-closed, mức 5) — ${lyDo}` });

const laSoNguyenDuong = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2_147_483_647;

/** Giá trị ghi chấp nhận được: số hữu hạn, boolean, chuỗi ngắn in được. */
function giaTriHopLe(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  if (typeof v === "string") return v.length <= 64 && /^[\x20-\x7E]*$/.test(v);
  return false;
}

/**
 * Phân loại MỘT lệnh trên MỘT máy qua `aiControlGate`. Thứ tự: kiểm hình dạng (fail-closed) ⇒ `phanLoaiMuc` ⇒ tag (tên, rồi
 * tồn tại — chỉ khi mức còn ≤ 3) ⇒ `kiemCongAi` (env rỗng) lấy lý do. Mức cuối = max(các lớp).
 */
async function phanLoaiLenh(may: unknown, lenh: unknown, tag: unknown, giaTri: unknown, coGiaTri: boolean, p: PhuThuocCongOt): Promise<PhanLoai> {
  if (!laSoNguyenDuong(may)) return MUC_5(`máy phải là số nguyên dương (nhận ${JSON.stringify(may)?.slice(0, 40)})`);
  if (typeof lenh !== "string" || lenh.length === 0 || lenh.length > 64) return MUC_5("lệnh phải là chuỗi khác rỗng");
  const toolName = toolChoLenh(lenh);
  const coTag = tag !== undefined && tag !== null && tag !== "";
  if (coTag && typeof tag !== "string") return MUC_5("tag phải là chuỗi");
  const tagKey = coTag ? (tag as string) : null;
  let muc: MucRuiRo = phanLoaiMuc(toolName, tagKey);
  let lyDoThem: string | null = null;
  if (muc < 4 && toolName === "set_machine_param") {
    if (!tagKey) {
      muc = 5;
      lyDoThem = "ghi tham số cần tag";
    } else if (!coGiaTri || !giaTriHopLe(giaTri)) {
      muc = 5;
      lyDoThem = "giá trị ghi không hợp lệ";
    }
  }
  if (muc < 4 && tagKey && laTagBiChan(tagKey)) {
    muc = 5;
    lyDoThem = `tag "${tagKey.slice(0, 64)}" sai khuôn hoặc thuộc nhóm an toàn`;
  }
  if (muc < 4 && tagKey && !(await p.tagTonTai(may, tagKey))) {
    muc = 5;
    lyDoThem = `tag "${tagKey}" không có trong máy #${may} (không nhận ra ⇒ chặn)`;
  }
  const cong = kiemCongAi({
    toolName,
    tagKey,
    userId: 0,
    adapterId: 0,
    safety: "UNKNOWN",
    env: {},
    boDem: new BoDemTanSuat(),
    tieuQuota: false,
  });
  if (cong.choPhep) throw new LoiCongOt(5, "bất biến hỏng: cổng AI cho phép trên đường Luồng mô phỏng (env rỗng)");
  const mucCuoi = Math.max(muc, cong.muc) as MucRuiRo;
  if (mucCuoi >= 4) {
    return { muc: mucCuoi, ma: cong.ma === "MUC_QUA_CAO" ? "MUC_QUA_CAO" : "KHONG_NHAN_RA", lyDo: cong.ma === "MUC_QUA_CAO" ? cong.lyDo : `TỪ CHỐI (mức 5) — ${lyDoThem ?? "không nhận ra"}` };
  }
  return { muc: mucCuoi, ma: cong.ma, lyDo: cong.lyDo };
}

const LOAI_BUOC_FOE_KHONG_LENH = new Set(["sequence", "parallel", "branch", "wait_state", "wait_telemetry", "hitl_gate", "delay"]);

/** Mọi bước của cây định nghĩa FOE (con, nhánh, bù trừ). Tự đi — KHÔNG import động cơ FOE. `null` ⇒ hình dạng lạ. */
function buocFoe(steps: unknown, ra: Record<string, unknown>[] = [], sau = 0): Record<string, unknown>[] | null {
  if (sau > 32) return null;
  if (steps === undefined) return ra;
  if (!Array.isArray(steps)) return null;
  for (const s of steps) {
    if (!s || typeof s !== "object") return null;
    const b = s as Record<string, unknown>;
    ra.push(b);
    for (const k of ["steps", "then", "else"]) if (buocFoe(b[k], ra, sau + 1) === null) return null;
    if (b.compensation !== undefined && buocFoe([b.compensation], ra, sau + 1) === null) return null;
  }
  return ra;
}

/** Phân loại một FOE workflow = mức CAO NHẤT của các bước `command` (cùng bảng tra, cùng lớp tag). Không bước lệnh ⇒ mức 1. */
async function phanLoaiLuongFoe(definition: unknown, p: PhuThuocCongOt): Promise<PhanLoai & { soLenh: number }> {
  const steps = buocFoe((definition as { steps?: unknown } | null)?.steps ?? null);
  if (!steps || steps.length === 0) return { ...MUC_5("định nghĩa FOE không đọc được"), soLenh: 0 };
  let tot: PhanLoai = { muc: 1, ma: "CO_TAT", lyDo: "không có bước lệnh" };
  let soLenh = 0;
  for (const b of steps) {
    if (b.type !== "command") {
      if (typeof b.type !== "string" || !LOAI_BUOC_FOE_KHONG_LENH.has(b.type)) return { ...MUC_5(`bước FOE loại lạ ${JSON.stringify(b.type)?.slice(0, 40)}`), soLenh };
      continue;
    }
    soLenh++;
    const args = (b.args && typeof b.args === "object" ? b.args : {}) as Record<string, unknown>;
    const tags: unknown[] = [];
    if (args.paramKey !== undefined) tags.push(args.paramKey);
    if (args.tagKey !== undefined) tags.push(args.tagKey);
    if (Array.isArray(args.writes)) for (const w of args.writes) tags.push((w as { tagKey?: unknown } | null)?.tagKey);
    const dsTag = tags.length ? tags : [undefined];
    for (const t of dsTag) {
      const pl = await phanLoaiLenh(b.machineId, b.command, t, args.paramValue ?? args.value ?? 0, true, p);
      if (pl.muc > tot.muc) tot = { ...pl, lyDo: `bước "${String(b.id ?? "?").slice(0, 64)}": ${pl.lyDo}` };
      if (tot.muc >= 4) return { ...tot, soLenh };
    }
  }
  return { ...tot, soLenh };
}

// ── hàm bao ──────────────────────────────────────────────────────────────────────────────────────

function hetHanMs(hetHanGio: unknown): number {
  const gio = Number(hetHanGio ?? 24);
  return (Number.isFinite(gio) && gio > 0 ? Math.min(gio, 24 * 7) : 24) * 3600_000;
}

/**
 * ★★★ ĐIỂM GỌI DUY NHẤT của mọi node hạng `ot`. Kiểm qua `aiControlGate` (fail-closed) ⇒ mức 4–5: trả `tu-choi-muc-cao`
 * (node ném lỗi, KHÔNG tạo đề xuất) · mức ≤ 3: trả yêu cầu CHỜ DUYỆT (mô phỏng) mà động cơ ghi thành hàng `ai_flow_waits`.
 * Không có nhánh nào gửi lệnh.
 */
export async function kiemVaDeXuat(yc: YeuCauOt, ngu: NguCanhDeXuat, p: PhuThuocCongOt = phuThuocHienHanh): Promise<KetQuaKiemOt> {
  if (!CHE_DO_MO_PHONG) throw new LoiCongOt(5, "Đợt 8.5: chỉ có chế độ mô phỏng");
  // Đợt 9 — MỘT luật chuẩn hoá id cho mọi đường vào (số hoặc chuỗi số ⇒ số; khác ⇒ giữ nguyên để bị từ chối theo hình dạng).
  const chuan = (v: unknown): unknown => chuanHoaIdMay(v) ?? v;
  if (yc.loai === "lenh") yc = { ...yc, may: chuan(yc.may) };
  else if (yc.loai === "luong-foe") yc = { ...yc, workflowId: chuan(yc.workflowId), version: chuan(yc.version) };
  let pl: PhanLoai;
  let deXuat: Record<string, unknown>;
  let tieuDe: string;
  if (yc.loai === "lenh") {
    pl = await phanLoaiLenh(yc.may, yc.lenh, yc.tag, yc.giaTri, yc.giaTri !== undefined, p);
    deXuat = { loai: "lenh", may: yc.may, lenh: yc.lenh, tool: toolChoLenh(yc.lenh), tag: yc.tag ?? null, giaTri: yc.giaTri ?? null };
    tieuDe = `[MÔ PHỎNG] Đề xuất lệnh "${String(yc.lenh).slice(0, 40)}" cho máy #${String(yc.may).slice(0, 12)}`;
  } else if (yc.loai === "luong-foe") {
    if (!laSoNguyenDuong(yc.workflowId) || !laSoNguyenDuong(yc.version)) {
      pl = MUC_5("workflowId/version phải là số nguyên dương");
      deXuat = { loai: "luong-foe" };
      tieuDe = "";
    } else {
      let wf = await p.docLuongFoe(yc.workflowId, yc.version);
      if (wf && ngu.boKiem && !(await luongFoeTrongPhamVi(wf.definition, ngu.boKiem))) wf = null;
      if (!wf) pl = MUC_5(`không có FOE workflow #${yc.workflowId}@${yc.version}`);
      else if (wf.trangThai !== "active") pl = MUC_5(`FOE workflow #${yc.workflowId} chưa được duyệt (trạng thái ${wf.trangThai})`);
      else pl = await phanLoaiLuongFoe(wf.definition, p);
      deXuat = { loai: "luong-foe", workflowId: yc.workflowId, version: yc.version, ref: wf?.ref ?? null, ten: wf?.ten ?? null, thamSo: yc.thamSo ?? {} };
      tieuDe = `[MÔ PHỎNG] Đề xuất chạy FOE workflow "${String(wf?.ref ?? yc.workflowId).slice(0, 60)}"@${yc.version}`;
    }
  } else {
    pl = MUC_5("loại yêu cầu lạ");
    deXuat = {};
    tieuDe = "";
  }

  if (pl.muc >= 4) return { ketQua: "tu-choi-muc-cao", muc: pl.muc as 4 | 5, ma: pl.ma, lyDo: pl.lyDo };

  const deXuatId = `ot:${ngu.idempotencyKey}`;
  const muc = pl.muc as 1 | 3;
  const item: ItemLuong = { json: { deXuatId, muc, ketQua: "da-de-xuat", nguon: NGUON_LUONG_AI, moPhong: true, deXuat } };
  return {
    ketQua: "da-de-xuat",
    deXuatId,
    muc,
    yeuCauCho: {
      __cho: {
        kind: "duyet",
        items: [item],
        hetHanMs: hetHanMs(yc.hetHanGio),
        payload: {
          tieuDe: tieuDe.slice(0, 200),
          noiDung:
            `Đề xuất mức ${muc} từ Luồng AI — CHẾ ĐỘ MÔ PHỎNG: đồng ý KHÔNG gửi lệnh nào tới thiết bị. ` +
            `Cổng AI: ${pl.ma}. ${pl.lyDo}`.slice(0, 4000),
          vaiTroDuyet: "supervisor",
          nguon: NGUON_LUONG_AI,
          moPhong: true,
          deXuatId,
          muc,
          deXuat,
        },
      },
    },
  };
}

/** Hàng chờ này là một đề xuất OT của Luồng (mô phỏng)? */
export function laDeXuatOtLuong(payload: unknown): boolean {
  const p = payload as { nguon?: unknown; moPhong?: unknown } | null;
  return !!p && p.nguon === NGUON_LUONG_AI && p.moPhong === true;
}

/**
 * Trường gắn vào item khi người trả lời một đề xuất OT mô phỏng. KHÔNG có nhánh gửi: đồng ý ⇒ chỉ ghi "đã duyệt (mô phỏng)
 * — không gửi" + một kết quả giả lập.
 */
export function ketQuaSauDuyetMoPhong(dongY: boolean): { thucThi: Record<string, unknown> } {
  return {
    thucThi: dongY
      ? { moPhong: true, daGui: false, trangThai: "da-duyet-mo-phong", ghiChu: GHI_CHU_DA_DUYET_MO_PHONG, ketQuaGiaLap: { ok: true, simulated: true, status: "mo-phong" } }
      : { moPhong: true, daGui: false, trangThai: "bi-tu-choi", ghiChu: "bị từ chối — không gửi", ketQuaGiaLap: null },
  };
}
