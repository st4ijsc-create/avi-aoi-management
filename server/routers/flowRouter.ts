/**
 * ★★ AI Local Đợt 8.1 Task 5 — API tRPC của LUỒNG AI (kiểu n8n, động cơ `server/services/flow/dongCo.ts`). Spec §4.6, §4.8.
 *
 * Sàn quyền (8.1 — 8.2 làm đủ ma trận vai + 2FA cho hạng `ot`):
 *   • xem (danh sách · chi tiết · lịch sử · dòng thời gian · hàng chờ duyệt · danh mục node) = `moduleProcedure("MOD_AI")`
 *     — đã đăng nhập + giấy phép MOD_AI;
 *   • sửa/lưu/bật/chạy/duyệt = `writeProcedure` (không phải vai chỉ-đọc viewer/user) + `moduleGate("MOD_AI")`;
 *   • BẬT một phiên bản hạng `ngoai-ghi` hoặc `ot` (và chạy tay một phiên bản hạng ấy CHƯA được bật) = vai admin
 *     (kiểm trong thân — hạng là thuộc tính của PHIÊN BẢN, không biết trước khi đọc CSDL).
 * Lỗi qua `appError` + khoá `errors.operation.flow*` / `errors.action.flowKichHoatHangCao` (vi/en/zh).
 * Bảng `ai_flow*` là sổ máy (không cột tenant nào được điền ở 8.1) — phạm vi tenant theo luồng là việc của 8.2.
 *
 * Đợt 8.2 Task 4 — BÍ MẬT (`ai_flow_credentials`, `services/flow/biMat.ts`): `biMatTao` / `biMatXoa` = admin
 * (`adminProcedure` + MOD_AI); `biMatDanhSach` = quyền sửa luồng (`ghiProcedure`) và KHÔNG BAO GIỜ trả giá trị/bản mã.
 * Giá trị chỉ GHI: `biMatTao` trả id/tên/loại/phiên bản khoá. Thông điệp lỗi của `LoiBiMat` không chứa giá trị.
 *
 * Đợt 8.4 — `taoTuMoTa` (mô tả → BẢN NHÁP luồng, không lưu/không bật) = quyền sửa luồng. Hạng của phiên bản (`luu`) nay gồm
 * hạng các LUỒNG CON được tham chiếu (`luong.goi-con`, tool `ai.agent`) ⇒ cổng bật/chạy-tay theo hạng ở dưới áp luôn cho chúng.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { router, moduleProcedure, moduleGate, writeProcedure, adminProcedure, deployProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import { getDb } from "../db/connection";
import { createAuditLog } from "../db";
import { aiFlowCredentials, aiFlowEvents, aiFlowRuns, aiFlowSteps, aiFlowVersions, aiFlows, users } from "../../drizzle/schema";
import { THU_TU_HANG, NodeInstanceSchema, kiemLuong, luongConCuaNut, type FlowDefinition, type HangTacDungPhu } from "../../shared/flow/model";
import { LoiNgoaiPhamVi, chayThuNut, type BoKiemPhamVi } from "../services/flow/chayThuNut";
import { boKiemPhamVi, thamChieuTinhNgoai } from "../services/flow/boKiemPhamVi";
import { biMatTrongPhamVi, luongTrongPhamVi, luotTrongPhamVi, nhaMayChoLuongMoi, nhaMayChoPhep, nhaMayHopLe } from "../services/flow/phamViLuong";
import { phamViCua } from "./_phamViNguoiXem";
import { KIEU_KICH_HOAT_DOC_SAU_DONG, LoiLuong, batDauRun, hangLuongConTuDb, luuPhienBan, traLoiCho } from "../services/flow/dongCo";
import { taoTuMoTa } from "../services/flow/taoTuMoTa";
import { danhSachNut, layNut } from "../services/flow/dangKyNut";
import { kiemThamSoKichHoat, napLaiLich } from "../services/flow/kichHoat/lich";
import { kiemThamSoSuKien, napLaiSuKien } from "../services/flow/kichHoat/suKien";
import { kiemThamSoNutMoi } from "../services/flow/kiemThamSoNut";
import { nguoiNhanHopLeTheoNhaMay } from "../services/flow/nut/thongBao";
import { bieuMauCuaPayload, kiemGiaTriBieuMau } from "../services/flow/nut/bieuMau";
import { banGhiKiemToan, ghiKiemToanLuong } from "../services/flow/kiemToan";
import { idLuongNhap, phanTichGoi, quetBiMat, quetVanBan, taoGoi } from "../services/flow/xuatNhap";
import { dauVetNhaMay } from "../services/flow/xuatNhapDb";
import { nhaMayCuaLuong } from "../services/flow/phamViLuong";
import { capTokenWebhook, coNodeWebhook, coTokenWebhook } from "../services/flow/kichHoat/webhook";
import { LOAI_BI_MAT, LoiBiMat, datHostBiMat, lietKeBiMat, taoBiMat, xoaBiMat } from "../services/flow/biMat";
import { ketQuaSauDuyetMoPhong, laDeXuatOtLuong } from "../services/flow/ot/congOtLuong";
import { kiemQuyenDuyet, layNguoiLienQuan } from "../services/flow/quyenDuyet";

const xemProcedure = moduleProcedure("MOD_AI");
const ghiProcedure = writeProcedure.use(moduleGate("MOD_AI"));
const adminAiProcedure = adminProcedure.use(moduleGate("MOD_AI"));

/**
 * ★★★ Đợt 8.5 — sàn bật luồng hạng `ot` = **admin + 2FA mới**, ĐÚNG thủ tục có sẵn cho deploy: `deployProcedure` (sàn vai
 * actuation + require2FA + step-up OTP tươi MỖI lượt gọi khi `ACTUATION_STEPUP_2FA` bật) + cổng giấy phép MOD_AI. Vai admin và
 * hạng `ot` của phiên bản được kiểm ở `meta.chanTruocStepUp` — CHỈ ĐỌC, chạy TRƯỚC khi tiêu OTP (kỹ sư bị từ chối mà không
 * đốt mã của mình).
 */
const batOtProcedure = deployProcedure.use(moduleGate("MOD_AI"));

const RE_ID_OT = /^[A-Za-z0-9_-]{1,64}$/;

/** Cổng TRƯỚC step-up của `batLuongOt`: admin, và phiên bản tồn tại + hạng `ot`. Đọc raw input (chưa qua zod) — tự kiểm kiểu. */
async function chanTruocBatLuongOt({ ctx, rawInput }: { ctx: { user?: { id?: number; role?: string } | null }; rawInput: unknown }): Promise<void> {
  if (ctx.user?.role !== "admin") {
    throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao", reason: "flowOtChiBatQuaBatLuongOt" }, "Luồng hạng ot chỉ quản trị viên (kèm 2FA) được bật.");
  }
  const r = rawInput as { flowId?: unknown; version?: unknown } | null | undefined;
  if (!r || typeof r.flowId !== "string" || !RE_ID_OT.test(r.flowId) || typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) {
    throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowKichHoat" }, "Thiếu flowId/version hợp lệ.");
  }
  // Đợt 9 (IDOR) — luồng ngoài phạm vi người gọi = không tồn tại (cùng thông điệp), TRƯỚC khi tiêu OTP.
  if (!(await luongTrongPhamVi(phamViCua(ctx as CoCtx), r.flowId))) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowKichHoat", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có luồng ${r.flowId}@${r.version}.`);
  const db = await layDb("flowKichHoat");
  const [v] = await db.select({ riskClass: aiFlowVersions.riskClass }).from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, r.flowId), eq(aiFlowVersions.version, r.version)));
  // Phiên bản không có ⇒ CÙNG một lý do với "ngoài phạm vi" (không phân biệt được để không lộ tồn tại của luồng).
  if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowKichHoat", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có luồng ${r.flowId}@${r.version}.`);
  if (v.riskClass !== "ot") throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowKichHoat" }, `Luồng ${r.flowId}@${r.version} hạng ${v.riskClass} — bật bằng datPhienBanHoatDong.`);
}

const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const flowIdSchema = z.string().regex(RE_ID);
const itemSchema = z.object({ json: z.record(z.string(), z.unknown()) });

/**
 * Đợt 8.3 — thư mục MẪU LUỒNG (`server/services/flow/mau/*.json`). Bản dựng `dist/index.js` không mang tệp JSON theo, nên
 * thử lần lượt: cạnh mã nguồn (dev/vitest) rồi theo thư mục làm việc (production chạy từ gốc repo).
 */
function thuMucMau(): string | null {
  const ungVien = [resolve(process.cwd(), "server/services/flow/mau")];
  try {
    ungVien.unshift(join(dirname(fileURLToPath(import.meta.url)), "../services/flow/mau"));
  } catch {
    /* import.meta.url không phải file: — bỏ qua */
  }
  return ungVien.find((d) => existsSync(d)) ?? null;
}

/** Đọc các mẫu luồng hợp lệ JSON (tệp hỏng bị bỏ qua, không làm hỏng cả danh sách). */
export function docMauLuong(): { tep: string; definition: FlowDefinition }[] {
  const thuMuc = thuMucMau();
  if (!thuMuc) return [];
  const ra: { tep: string; definition: FlowDefinition }[] = [];
  for (const tep of readdirSync(thuMuc).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const def = JSON.parse(readFileSync(join(thuMuc, tep), "utf8")) as FlowDefinition;
      if (def && typeof def.id === "string" && Array.isArray(def.nodes)) ra.push({ tep, definition: def });
    } catch {
      /* tệp mẫu hỏng — bỏ qua */
    }
  }
  return ra;
}

/** Trần chữ của input/output mỗi bước trả về dòng thời gian (cắt ở đây, CSDL giữ nguyên theo `luuDuLieu`). */
export const TRAN_CHU_BUOC = 4000;

type Op = "flowXuat" | "flowNhap" | "flowNguoiNhan" | "flowXem" | "flowLuu" | "flowKichHoat" | "flowChayTay" | "flowDuyet" | "flowBiMatTao" | "flowBiMatXoa" | "flowBiMatXem" | "flowTaoTuMoTa" | "flowChayThu";

/** `LoiBiMat` ⇒ `appError` (thông điệp của LoiBiMat không bao giờ chứa giá trị). Lỗi khác ném lại nguyên. */
function loiBiMat(e: unknown, op: Op): never {
  if (e instanceof LoiBiMat) {
    const ma = ({ THIEU_KHOA: "SERVICE_UNAVAILABLE", KHONG_CO_DB: "SERVICE_UNAVAILABLE", KHONG_HOP_LE: "BAD_REQUEST", DA_CO: "CONFLICT", KHONG_CO: "NOT_FOUND", GIAI_MA_HONG: "INTERNAL_SERVER_ERROR" } as const)[e.code];
    throw appError(ma, "OPERATION_FAILED", { operation: op, reason: "flowChiTietMayChu", chiTiet: e.message.slice(0, 300) }, e.message);
  }
  throw e;
}

async function layDb(op: Op) {
  const db = await getDb();
  if (!db) throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: op }, "Không có kết nối CSDL.");
  return db;
}

const laHangCao = (h: string | null | undefined) => THU_TU_HANG[(h ?? "thuan") as HangTacDungPhu] >= THU_TU_HANG["ngoai-ghi"];

/** Cắt một giá trị JSON dài: giữ nguyên nếu ngắn, ngược lại trả đầu chuỗi + kích thước. */
export function catJson(v: unknown, tran = TRAN_CHU_BUOC): unknown {
  if (v === null || v === undefined) return v;
  const s = JSON.stringify(v);
  if (s.length <= tran) return v;
  return { __catBot: true, kichThuoc: s.length, dau: s.slice(0, tran) };
}

/**
 * ★★★ Đợt 9 (IDOR, duyệt (d)) — PHẠM VI NHÀ MÁY của chính luồng. Mọi thủ tục nhận flowId / runId / credentialId (và mọi danh sách) đi qua
 * các hàm này TRƯỚC khi chạm dữ liệu. Ngoài phạm vi và không tồn tại ⇒ CÙNG MỘT NOT_FOUND (cùng thông điệp, không lộ tồn tại).
 * Census `flowRouterPhamViCensus.test.ts` đọc mã: thủ tục nào không gọi một trong các hàm này (trừ danh sách khai tường minh) ⇒ đỏ.
 */
type CoCtx = { user: { id: number; role: string } };
async function chanLuong(ctx: CoCtx, flowId: string, op: Op, thongDiep = `Không có luồng ${flowId}.`): Promise<void> {
  if (!(await luongTrongPhamVi(phamViCua(ctx), flowId))) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: op, reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, thongDiep);
}
/** `reason` mặc định = MỘT lý do chung cho "không tồn tại hoặc ngoài phạm vi" (cấm lý do phân biệt hai trường hợp — lộ tồn tại). */
async function chanLuot(ctx: CoCtx, runId: string, op: Op, thongDiep = `Không có lượt ${runId}.`, reason = "flowKhongTonTaiHoacNgoaiPhamVi"): Promise<void> {
  if (!(await luotTrongPhamVi(phamViCua(ctx), runId))) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: op, reason }, thongDiep);
}
async function chanBiMat(ctx: CoCtx, id: string, op: Op): Promise<void> {
  if (!(await biMatTrongPhamVi(phamViCua(ctx), id))) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: op, reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có bí mật ${id}.`);
}
/** Mệnh đề SQL `col IN (…)` theo tập nhà máy được phép (`null` = tất cả ⇒ không lọc; `[]` ⇒ không hàng nào). */
function locNhaMay(col: ReturnType<typeof sql>, cho: number[] | null) {
  if (cho === null) return sql`TRUE`;
  if (cho.length === 0) return sql`FALSE`;
  return sql`${col} IN (${sql.join(cho.map((x) => sql`${x}`), sql`, `)})`;
}
/** Nhà máy gán cho luồng / bí mật MỚI (xem `nhaMayChoLuongMoi`); lỗi ⇒ appError rõ lý do. */
async function nhaMayMoi(ctx: CoCtx, yeuCau: number | undefined, op: Op): Promise<number | null> {
  const kq = await nhaMayChoLuongMoi(phamViCua(ctx), yeuCau);
  if (kq.ok) return kq.factoryId;
  if (kq.lyDo === "can-chon-nha-may") throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: op, reason: "flowCanChonNhaMay" }, "Bạn thuộc nhiều nhà máy — phải chọn factoryId.");
  if (kq.lyDo === "chua-co-nha-may") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowPhamVi", reason: "flowChuaGanNhaMay" }, "Tài khoản chưa được gán nhà máy nào.");
  throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowPhamVi", reason: "flowNhaMayNgoaiPhamVi" }, "Nhà máy không nằm trong phạm vi của bạn.");
}
/** Luồng LƯU: mọi `credentialRef` và luồng con được tham chiếu phải tồn tại và thuộc phạm vi NGƯỜI LƯU (cùng thông điệp cho không tồn tại / ngoài phạm vi). */
async function kiemThamChieuKhiLuu(def: Record<string, unknown>, ctx: CoCtx): Promise<void> {
  const pv = phamViCua(ctx);
  const nodes = Array.isArray(def.nodes) ? (def.nodes as { id?: unknown; type?: unknown; parameters?: unknown; credentialRef?: unknown }[]) : [];
  for (const n of nodes) {
    const id = typeof n.id === "string" ? n.id : "?";
    if (typeof n.credentialRef === "string" && !(await biMatTrongPhamVi(pv, n.credentialRef))) {
      const chiTiet = `Luồng không hợp lệ: node '${id}': credentialRef '${n.credentialRef}' không tồn tại hoặc ngoài phạm vi của bạn.`;
      throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowLuu", reason: "flowChiTietMayChu", chiTiet: chiTiet.slice(0, 300) }, chiTiet);
    }
    const { ids } = luongConCuaNut({ id, type: String(n.type ?? ""), parameters: (n.parameters ?? {}) as Record<string, unknown> });
    for (const con of ids) {
      if (con !== def.id && !(await luongTrongPhamVi(pv, con))) {
        const chiTiet = `Luồng không hợp lệ: luồng con '${con}' không tồn tại hoặc chưa có phiên bản hoạt động.`;
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowLuu", reason: "flowChiTietMayChu", chiTiet: chiTiet.slice(0, 300) }, chiTiet);
      }
    }
  }
}

/**
 * ★ Đợt 9 (IDOR) — lúc BẬT: mọi `may` / FOE workflow viết THẲNG trong định nghĩa phải nằm trong phạm vi NGƯỜI BẬT (biểu thức động để kiểm lúc
 * chạy). Ngoài phạm vi / không tồn tại ⇒ NOT_FOUND, cùng thông điệp.
 */
/**
 * ★ Đợt 10.3 — phiên bản có node dùng model AI NGOÀI chỉ bật được khi: luồng thuộc nhà máy, phiên bản đã DUYỆT NGOÀI và băm duyệt khớp
 * băm định nghĩa hiện tại (`aiNgoai.duyetNgoai`). Áp cho CẢ `datPhienBanHoatDong` lẫn `batLuongOt`.
 */
async function kiemNgoaiKhiBat(v: { definition: unknown; ngoaiDuyetLuc: Date | null; ngoaiBamDuyet: string | null }, flowId: string): Promise<void> {
  const db = await layDb("flowKichHoat");
  const [f] = await db.select({ f: aiFlows.factoryId }).from(aiFlows).where(eq(aiFlows.id, flowId));
  const { kiemDuyetNgoaiTruocKhiBat } = await import("../services/ai/ngoai/duyetNgoai");
  try {
    kiemDuyetNgoaiTruocKhiBat(v, f?.f ?? null);
  } catch (e) {
    const ma = (e as { ma?: string }).ma ?? "NGOAI_CHUA_DUYET";
    throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoat", reason: ma }, ma === "NGOAI_LUONG_TOAN_CUC" ? "Luồng toàn hệ thống không dùng được model AI ngoài." : "Phiên bản dùng model AI ngoài cần được duyệt (aiNgoai.duyetNgoai) trước khi bật.");
  }
}

async function kiemTruocKhiBat(def: FlowDefinition, ctx: { user: { id: number; role: string } }): Promise<void> {
  const loi = await thamChieuTinhNgoai(def, boKiemPhamVi(phamViCua(ctx)));
  // MỘT câu cho cả "không tồn tại" lẫn "ngoài phạm vi"; chỉ nêu id node (người soạn luồng biết node nào của mình).
  if (loi.length) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowKichHoat", reason: "flowKhongBatDuocThamChieu", nodeId: loi.map((x) => x.nodeId).join(", ").slice(0, 200) }, `Không bật được: ${loi.map((x) => x.thongDiep).join("; ")}.`);
}

/** Cảnh báo lúc lưu khi luồng khai `settings.errorFlowId` (chưa được động cơ hỗ trợ). */
export const CANH_BAO_ERROR_FLOW_ID = "settings.errorFlowId chưa được hỗ trợ: luồng lỗi sẽ KHÔNG được gọi khi lượt thất bại (giá trị được giữ để nhập/xuất không vỡ).";

/** Lưu phiên bản MỚI (bất biến) — DÙNG CHUNG bởi `flow.luu` và `flow.nhap` (nhập gói đi ĐÚNG đường này). */
async function luuLuongCore(input: { definition: Record<string, unknown>; factoryId?: number }, ctx: CoCtx & { user: { id: number; role: string } }, nguon: "luu" | "nhap" = "luu") {
    const loiKichHoat = [...kiemThamSoKichHoat(input.definition), ...kiemThamSoSuKien(input.definition), ...kiemThamSoNutMoi(input.definition)];
    if (loiKichHoat.length) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowLuu", reason: "flowChiTietMayChu", chiTiet: loiKichHoat.join("; ").slice(0, 300) }, `Luồng không hợp lệ: ${loiKichHoat.join("; ")}`);
    // ★ Đợt 9 (IDOR): id đã có ⇒ phải thuộc phạm vi người lưu (không được thêm phiên bản vào luồng của nhà máy khác); id mới ⇒ gán nhà máy.
    let factoryId: number | null = null;
    const idLuong = typeof input.definition.id === "string" ? input.definition.id : null;
    if (idLuong && RE_ID.test(idLuong)) {
      const dbL = await layDb("flowLuu");
      const [co] = await dbL.select({ id: aiFlows.id }).from(aiFlows).where(eq(aiFlows.id, idLuong)).limit(1);
      if (co) {
        if (!(await luongTrongPhamVi(phamViCua(ctx), idLuong))) throw appError("CONFLICT", "OPERATION_FAILED", { operation: "flowLuu", reason: "flowIdDaDung" }, "Id luồng đã được dùng — chọn id khác.");
      } else factoryId = await nhaMayMoi(ctx, input.factoryId, "flowLuu");
    }
    await kiemThamChieuKhiLuu(input.definition, ctx);
    try {
      const kq = await luuPhienBan(input.definition, ctx.user.id, factoryId);
      await ghiKiemToanLuong({ nguoi: ctx.user.id, hanhDong: "FLOW_LUU", loaiThucThe: "ai_flow", thucThe: kq.flowId, chiTiet: { version: kq.version, hang: kq.hang, nguon, soNode: Array.isArray(input.definition.nodes) ? input.definition.nodes.length : 0 } });
      // settings.errorFlowId được khai trong schema (giữ để nhập/xuất không vỡ) nhưng động cơ CHƯA gọi luồng lỗi (rủi ro vòng luồng lỗi gọi nhau) ⇒ nói thẳng lúc lưu.
      const canhBao: string[] = [];
      const sett = input.definition.settings as { errorFlowId?: unknown } | undefined;
      if (sett && sett.errorFlowId !== undefined && sett.errorFlowId !== null && sett.errorFlowId !== "") canhBao.push(CANH_BAO_ERROR_FLOW_ID);
      return { ...kq, canhBao };
    } catch (e) {
      if (e instanceof LoiLuong && e.code === "LUONG_KHONG_HOP_LE") throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowLuu", reason: "flowChiTietMayChu", chiTiet: e.message.slice(0, 300) }, `Luồng không hợp lệ: ${e.message}`);
      if (e instanceof LoiLuong && e.code === "KHONG_CO_DB") throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "flowLuu", reason: "flowChiTietMayChu", chiTiet: e.message.slice(0, 300) }, e.message);
      throw e;
    }
}

export const flowRouter = router({
  /** Mọi luồng + phiên bản hoạt động + phiên bản mới nhất + hạng. */
  danhSach: xemProcedure.query(async ({ ctx }) => {
    const db = await layDb("flowXem");
    const cho = await nhaMayChoPhep(phamViCua(ctx));
    const rows = (await db.execute(sql`
      SELECT f.id, f.name, f."activeVersion", f.enabled, f."riskClass", f."updatedAt",
             (SELECT max(v.version) FROM ai_flow_versions v WHERE v."flowId" = f.id)::int AS "phienBanMoiNhat",
             (SELECT r.status FROM ai_flow_runs r WHERE r."flowId" = f.id ORDER BY r."startedAt" DESC LIMIT 1) AS "trangThaiLuotCuoi"
        FROM ai_flows f WHERE ${locNhaMay(sql`f."factoryId"`, cho)} ORDER BY f."updatedAt" DESC LIMIT 500`)) as unknown as Record<string, unknown>[];
    return rows;
  }),

  /** Định nghĩa của phiên bản yêu cầu / hoạt động / mới nhất + danh sách phiên bản. */
  /**
   * ★ Chọn NGƯỜI NHẬN cho node `tich-hop.thong-bao` (form có kiểu, lô Luồng-form). Quyền xem luồng như các thủ tục flow khác (ngoài phạm vi ≡ NOT_FOUND).
   * CHỈ trả người ĐANG HOẠT ĐỘNG mà phạm vi của CHÍNH họ chứa nhà máy của luồng — CÙNG hàm `nguoiNhanHopLeTheoNhaMay` mà node dùng lúc chạy (luồng toàn hệ thống ⇒ chỉ người toàn quyền).
   * KHÔNG liệt kê toàn bộ người dùng: bắt buộc tìm theo tên (≥ 2 ký tự), trần 20 kết quả. Chỉ id + tên + vai trò (không email / điện thoại).
   */
  nguoiNhanChoLuong: xemProcedure
    .input(z.object({ flowId: flowIdSchema, tim: z.string().trim().min(2).max(50), gioiHan: z.number().int().min(1).max(20).default(20) }))
    .query(async ({ input, ctx }) => {
      await chanLuong(ctx, input.flowId, "flowNguoiNhan");
      const nhaMay = await nhaMayCuaLuong(input.flowId);
      if (nhaMay === undefined) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowNguoiNhan", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có luồng ${input.flowId}.`);
      const db = await layDb("flowNguoiNhan");
      const mau = `%${input.tim.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
      const ung = await db
        .select({ id: users.id, ten: users.name, vaiTro: users.role, isActive: users.isActive })
        .from(users)
        .where(and(eq(users.isActive, true), or(ilike(users.name, mau), ilike(users.username, mau))))
        .orderBy(users.name, users.id)
        .limit(200);
      const ra: { id: number; ten: string | null; vaiTro: string }[] = [];
      for (const u of ung) {
        if (ra.length >= input.gioiHan) break;
        if (await nguoiNhanHopLeTheoNhaMay({ id: u.id, role: u.vaiTro, isActive: u.isActive }, nhaMay)) ra.push({ id: u.id, ten: u.ten ?? null, vaiTro: String(u.vaiTro) });
      }
      return ra;
    }),

  /**
   * ★ XUẤT luồng thành GÓI (lô nhập/xuất): quyền như `chiTiet` (ngoài phạm vi ≡ NOT_FOUND). Gói đã làm SẠCH (không bí mật / id máy / người nhận / luồng con / dữ liệu ghim / id luồng / chủ);
   * `canhBao` = chuỗi tự do còn nhắc mã máy / tên nhà máy / tên người của nhà máy nguồn (vị trí node + trường) — chỉ để người xuất xem TRƯỚC khi tải, KHÔNG nằm trong gói.
   */
  xuat: xemProcedure
    .input(z.object({ flowId: flowIdSchema, version: z.number().int().min(1).optional() }))
    .query(async ({ input, ctx }) => {
      await chanLuong(ctx, input.flowId, "flowXuat");
      const db = await layDb("flowXuat");
      const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, input.flowId));
      if (!f) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowXuat", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có luồng ${input.flowId}.`);
      const [moiNhat] = await db.select({ v: aiFlowVersions.version }).from(aiFlowVersions).where(eq(aiFlowVersions.flowId, input.flowId)).orderBy(desc(aiFlowVersions.version)).limit(1);
      const chon = input.version ?? f.activeVersion ?? moiNhat?.v;
      const [v] = chon ? await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, chon))) : [];
      if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowXuat", reason: "flowKhongCoPhienBan", version: chon ?? 0 }, "Không có phiên bản để xuất.");
      const def = v.definition as FlowDefinition;
      const { goi, viec } = taoGoi(def);
      // Quét cái SẼ RỜI KHỎI nhà máy: gói đã làm sạch (chữ tự do + id số + mẫu bí mật còn sót)
      const dau = await dauVetNhaMay(f.factoryId ?? null);
      const canhBao = [...quetVanBan(goi.luong, dau), ...quetBiMat(goi.luong)];
      return { goi, viec, canhBao, hang: kiemLuong(goi.luong, layNut).hang, tenLuong: f.name };
    }),

  /** ★ XEM TRƯỚC khi NHẬP gói (không ghi gì): định dạng lạ / quá lớn / sai schema ⇒ BAD_REQUEST; băm thiếu/lệch, có bí mật/dữ liệu ghim/id nhà máy trong gói ⇒ chỉ cảnh báo. */
  nhapXemTruoc: xemProcedure.input(z.object({ goi: z.unknown() })).query(({ input }) => {
    const p = phanTichGoi(input.goi);
    if (!p.ok) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowNhap", reason: "flowChiTietMayChu", chiTiet: p.thongDiep }, p.thongDiep);
    const kq = kiemLuong(p.luong, layNut);
    return { tenGoc: p.luong.name, soNode: p.luong.nodes.length, hang: kq.hang, hopLe: kq.ok, loi: kq.loi.slice(0, 20), canhBao: p.canhBao, viec: p.viec };
  }),

  /**
   * ★ NHẬP gói thành luồng MỚI (TẮT, phiên bản 1) của người nhập — đi ĐÚNG đường `luu` (kiểm luồng, kiểm tham số, gán nhà máy theo phạm vi người nhập, hạng tính lại ở máy chủ).
   * Gói được làm sạch LẠI (không tin): id / bí mật / dữ liệu ghim / tham chiếu theo nhà máy luôn về trống ⇒ người nhập điền (`viec`).
   */
  nhap: ghiProcedure
    .input(z.object({ goi: z.unknown(), ten: z.string().trim().min(1).max(200), factoryId: z.number().int().positive().optional() }))
    .mutation(async ({ input, ctx }) => {
      const p = phanTichGoi(input.goi);
      if (!p.ok) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowNhap", reason: "flowChiTietMayChu", chiTiet: p.thongDiep }, p.thongDiep);
      const definition = { ...p.luong, id: idLuongNhap(input.ten), name: input.ten };
      const kq = await luuLuongCore({ definition: definition as unknown as Record<string, unknown>, ...(input.factoryId !== undefined ? { factoryId: input.factoryId } : {}) }, ctx, "nhap");
      return { ...(kq as object), flowId: definition.id, viec: p.viec, canhBao: [...p.canhBao, ...((kq as { canhBao?: string[] }).canhBao ?? [])] };
    }),

  chiTiet: xemProcedure.input(z.object({ flowId: flowIdSchema, version: z.number().int().min(1).optional() })).query(async ({ input, ctx }) => {
    await chanLuong(ctx, input.flowId, "flowXem");
    const db = await layDb("flowXem");
    const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, input.flowId));
    if (!f) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowXem", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có luồng ${input.flowId}.`);
    const dsPhienBan = await db
      .select({ version: aiFlowVersions.version, riskClass: aiFlowVersions.riskClass, createdAt: aiFlowVersions.createdAt, createdBy: aiFlowVersions.createdBy })
      .from(aiFlowVersions)
      .where(eq(aiFlowVersions.flowId, input.flowId))
      .orderBy(desc(aiFlowVersions.version));
    const chon = input.version ?? f.activeVersion ?? dsPhienBan[0]?.version;
    const [v] = chon
      ? await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, chon)))
      : [];
    if (input.version && !v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowXem", reason: "flowKhongCoPhienBan", version: input.version }, `Không có phiên bản ${input.version}.`);
    return {
      luong: f,
      version: v?.version ?? null,
      hang: v?.riskClass ?? f.riskClass,
      definition: (v?.definition ?? null) as FlowDefinition | null,
      dsPhienBan,
      coTokenWebhook: await coTokenWebhook(input.flowId),
    };
  }),

  /** Lưu phiên bản MỚI (bất biến) sau khi kiểm hợp lệ + tham số kích hoạt. */
  luu: ghiProcedure
    .input(z.object({ definition: z.record(z.string(), z.unknown()), factoryId: z.number().int().positive().optional() }))
    .mutation(({ input, ctx }) => luuLuongCore(input, ctx)),

  /**
   * Đặt phiên bản hoạt động + bật/tắt. Bật phiên bản hạng ≥ `ngoai-ghi` ⇒ admin. Luồng có node webhook mà chưa có token
   * (hoặc `xoayToken`) ⇒ sinh token, trả THÔ đúng một lần trong `tokenWebhook`.
   */
  datPhienBanHoatDong: ghiProcedure
    .input(z.object({ flowId: flowIdSchema, version: z.number().int().min(1), bat: z.boolean(), xoayToken: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      await chanLuong(ctx, input.flowId, "flowKichHoat", `Không có luồng ${input.flowId}@${input.version}.`);
      const db = await layDb("flowKichHoat");
      const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, input.version)));
      if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowKichHoat", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có luồng ${input.flowId}@${input.version}.`);
      if (input.bat && v.riskClass === "ot") {
        // Đợt 8.5 — hạng `ot` CHỈ bật qua `batLuongOt` (admin + 2FA mới); thủ tục này không còn là đường vòng.
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao", reason: "flowOtChiBatQuaBatLuongOt" }, "Luồng hạng ot chỉ bật qua batLuongOt (quản trị viên + mã 2FA).");
      }
      if (input.bat && laHangCao(v.riskClass) && ctx.user.role !== "admin") {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao", reason: "flowChiAdminBat", hang: v.riskClass }, `Luồng hạng ${v.riskClass} chỉ quản trị viên được bật.`);
      }
      if (input.bat) await kiemTruocKhiBat(v.definition as FlowDefinition, ctx);
      if (input.bat) await kiemNgoaiKhiBat(v, input.flowId);
      await db
        .update(aiFlows)
        .set({ activeVersion: input.version, enabled: input.bat, updatedAt: sql`now()` })
        .where(eq(aiFlows.id, input.flowId));
      // Đợt 9 — NGƯỜI BẬT là chủ của các lượt tự kích hoạt (lịch/webhook/MCP) của phiên bản này: ghi lại (không đụng khi tắt).
      if (input.bat) await db.update(aiFlowVersions).set({ approvedBy: ctx.user.id }).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, input.version)));
      let tokenWebhook: string | null = null;
      if (input.bat && coNodeWebhook(v.definition as FlowDefinition)) tokenWebhook = await capTokenWebhook(input.flowId, input.xoayToken === true);
      await napLaiLich();
      napLaiSuKien();
      await ghiKiemToanLuong({ nguoi: ctx.user.id, hanhDong: input.bat ? "FLOW_KICH_HOAT" : "FLOW_TAT", loaiThucThe: "ai_flow", thucThe: input.flowId, chiTiet: { version: input.version, hang: v.riskClass, xoayToken: input.xoayToken === true } });
      return { flowId: input.flowId, version: input.version, bat: input.bat, hang: v.riskClass, tokenWebhook };
    }),

  /**
   * ★★★ Đợt 8.5 — BẬT một phiên bản hạng `ot`: admin + 2FA mới (`deployProcedure`: OTP tươi mỗi lượt khi step-up bật). Node OT
   * ở 8.5 chỉ ĐỀ XUẤT ở chế độ mô phỏng; cổng này vẫn là sàn của hạng `ot` (spec §4.6).
   */
  batLuongOt: batOtProcedure
    .meta({ chanTruocStepUp: chanTruocBatLuongOt })
    .input(z.object({ flowId: flowIdSchema, version: z.number().int().min(1), totpCode: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ input, ctx }) => {
      await chanLuong(ctx, input.flowId, "flowKichHoat", `Không có luồng ${input.flowId}@${input.version}.`);
      const db = await layDb("flowKichHoat");
      const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, input.version)));
      if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowKichHoat", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có luồng ${input.flowId}@${input.version}.`);
      if (v.riskClass !== "ot") throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowKichHoat" }, `Luồng ${input.flowId}@${input.version} không phải hạng ot.`);
      await kiemTruocKhiBat(v.definition as FlowDefinition, ctx);
      await kiemNgoaiKhiBat(v, input.flowId);
      await db
        .update(aiFlows)
        .set({ activeVersion: input.version, enabled: true, updatedAt: sql`now()` })
        .where(eq(aiFlows.id, input.flowId));
      await db.update(aiFlowVersions).set({ approvedBy: ctx.user.id }).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, input.version)));
      let tokenWebhook: string | null = null;
      if (coNodeWebhook(v.definition as FlowDefinition)) tokenWebhook = await capTokenWebhook(input.flowId, false);
      await napLaiLich();
      napLaiSuKien();
      await ghiKiemToanLuong({ nguoi: ctx.user.id, hanhDong: "FLOW_BAT_OT", loaiThucThe: "ai_flow", thucThe: input.flowId, chiTiet: { version: input.version, hang: v.riskClass, hai2fa: true } });
      return { flowId: input.flowId, version: input.version, bat: true, hang: v.riskClass, tokenWebhook };
    }),

  /**
   * Chạy tay: phiên bản hoạt động nếu luồng bật, ngược lại phiên bản yêu cầu / mới nhất (chạy thử của người sửa). Phiên bản
   * hạng ≥ `ngoai-ghi` CHƯA được bật ⇒ admin (chạy tay không được là đường vòng qua cổng bật).
   */
  chayTay: ghiProcedure
    .input(z.object({ flowId: flowIdSchema, items: z.array(itemSchema).max(100).optional(), version: z.number().int().min(1).optional() }))
    .mutation(async ({ input, ctx }) => {
      await chanLuong(ctx, input.flowId, "flowChayTay");
      const db = await layDb("flowChayTay");
      const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, input.flowId));
      if (!f) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowChayTay", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có luồng ${input.flowId}.`);
      const [moiNhat] = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${input.flowId}`)) as unknown as { v: number | null }[];
      const version = input.version ?? (f.enabled && f.activeVersion ? f.activeVersion : moiNhat?.v ?? null);
      if (!version) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowChayTay", reason: "flowChuaCoPhienBan" }, "Luồng chưa có phiên bản nào.");
      const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, version)));
      if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowChayTay", reason: "flowKhongCoPhienBan", version }, `Không có phiên bản ${version}.`);
      const daBat = f.enabled && f.activeVersion === version;
      if (!daBat && v.riskClass === "ot") {
        // Đợt 8.5 — chạy thử một phiên bản `ot` chưa bật = bỏ qua cổng admin + 2FA ⇒ từ chối mọi vai.
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao", reason: "flowOtPhaiBatTruoc" }, "Luồng hạng ot phải được bật (batLuongOt: quản trị viên + mã 2FA) trước khi chạy.");
      }
      // Đợt 9 (L3): hạng ≥ ngoai-ghi chỉ admin chạy tay — kể cả khi phiên bản ĐÃ BẬT (bật bởi admin không biến mọi người ghi thành người được chạy tay).
      if (laHangCao(v.riskClass) && ctx.user.role !== "admin") {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao", reason: "flowChiAdminChayTay", hang: v.riskClass }, `Luồng hạng ${v.riskClass} — chỉ quản trị viên được chạy tay.`);
      }
      const def = v.definition as FlowDefinition;
      const thuCong = def.nodes.find((n) => n.type === "kich-hoat.thu-cong" && !n.disabled);
      let runId: string;
      try {
        runId = await batDauRun({ flowId: input.flowId, version, items: input.items, nutKichHoat: thuCong?.id, triggerKind: "thu-cong", chuLuong: ctx.user.id });
      } catch (e) {
        if (e instanceof LoiLuong && (e.code === "QUA_TRAN_DONG_THOI" || e.code === "QUA_TRAN_LUOT_TREO")) throw appError("CONFLICT", "OPERATION_FAILED", { operation: "flowChayTay", reason: "flowQuaTranDongThoi" }, e.message);
        throw e;
      }
      if (laHangCao(v.riskClass)) await ghiKiemToanLuong({ nguoi: ctx.user.id, hanhDong: "FLOW_CHAY_TAY", loaiThucThe: "ai_flow_run", thucThe: runId, chiTiet: { flowId: input.flowId, version, hang: v.riskClass, soItem: input.items?.length ?? 0, daBat } });
      return { runId, version };
    }),

  /**
   * ★ Đợt 9.1 — CHẠY THỬ MỘT NODE của bản nháp (chưa lưu) với item mẫu. KHÔNG tạo lượt, bước, hàng đợi, hàng chờ; node có tác
   * dụng ra ngoài (HTTP, mã, agent…) chỉ được XEM TRƯỚC tham số; node OT chỉ đọc / đề xuất MÔ PHỎNG. Xem `chayThuNut.ts`.
   */
  chayThuNut: ghiProcedure
    .input(
      z.object({
        nut: NodeInstanceSchema,
        inputs: z.record(z.string().regex(RE_ID), z.array(itemSchema).max(100)).default({ main: [{ json: {} }] }),
        dauRaNutTruoc: z.record(z.string().regex(RE_ID), z.array(itemSchema).max(100)).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // ★ IDOR: id tài nguyên của node (máy…) phải TỒN TẠI và thuộc phạm vi NGƯỜI GỌI (từ ctx, không từ input).
      const boKiem: BoKiemPhamVi = boKiemPhamVi(phamViCua(ctx));
      let r;
      try {
        r = await chayThuNut(input, boKiem);
      } catch (e) {
        if (e instanceof LoiNgoaiPhamVi) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowChayThu", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, "Không tìm thấy máy.");
        throw e;
      }
      return {
        ...r,
        output: catJson(r.output, TRAN_CHU_BUOC * 4) as typeof r.output,
        cho: catJson(r.cho, TRAN_CHU_BUOC * 4) as typeof r.cho,
        thamSoDaDanhGia: catJson(r.thamSoDaDanhGia, TRAN_CHU_BUOC * 4),
      };
    }),

  lichSuChay: xemProcedure
    .input(z.object({ flowId: flowIdSchema, gioiHan: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input, ctx }) => {
      await chanLuong(ctx, input.flowId, "flowXem");
      const db = await layDb("flowXem");
      return db
        .select({
          id: aiFlowRuns.id, version: aiFlowRuns.version, triggerKind: aiFlowRuns.triggerKind, status: aiFlowRuns.status,
          uuTien: aiFlowRuns.uuTien, error: aiFlowRuns.error, startedAt: aiFlowRuns.startedAt, finishedAt: aiFlowRuns.finishedAt,
        })
        .from(aiFlowRuns)
        .where(eq(aiFlowRuns.flowId, input.flowId))
        .orderBy(desc(aiFlowRuns.startedAt))
        .limit(input.gioiHan);
    }),

  /**
   * ★ Lô B7-D — THỐNG KÊ MỘT LUỒNG trong `ngay` ngày gần nhất, tính TRỰC TIẾP bằng SQL trên ai_flow_runs / steps / events (không bảng mới):
   * lượt theo trạng thái + tỉ lệ thành công, p50/p90 thời gian lượt XONG (đồng hồ treo tường — gồm thời gian chờ người), thời gian + lỗi theo node, token + số lời gọi theo model
   * (từ sự kiện `buoc.model`; lời gọi không báo token đếm riêng), số lần ĐỔI MODEL liên tiếp trong một lượt = ƯỚC LƯỢNG số lần đổi khe (không đọc bộ giám sát).
   */
  thongKe: xemProcedure
    .input(z.object({ flowId: flowIdSchema, ngay: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ input, ctx }) => {
      await chanLuong(ctx, input.flowId, "flowXem");
      const db = await layDb("flowXem");
      const cuaSo = sql`"startedAt" > now() - (${input.ngay}::int * interval '1 day')`;
      const so = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v) * 1000) / 1000);
      const theoTrangThai = (await db.execute(sql`SELECT status, count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${input.flowId} AND ${cuaSo} GROUP BY status`)) as unknown as { status: string; n: number }[];
      const dem = (s: string) => theoTrangThai.find((x) => x.status === s)?.n ?? 0;
      const [tg] = (await db.execute(sql`SELECT count(*)::int AS n,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("finishedAt" - "startedAt"))) AS p50,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM ("finishedAt" - "startedAt"))) AS p90
        FROM ai_flow_runs WHERE "flowId" = ${input.flowId} AND ${cuaSo} AND status = 'xong' AND "finishedAt" IS NOT NULL`)) as unknown as { n: number; p50: unknown; p90: unknown }[];
      const theoNut = (await db.execute(sql`SELECT s."nodeId" AS "nodeId", count(*)::int AS n, (count(*) FILTER (WHERE s.status = 'loi'))::int AS loi,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (s."finishedAt" - s."startedAt"))) AS p50,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (s."finishedAt" - s."startedAt"))) AS p90
        FROM ai_flow_steps s JOIN ai_flow_runs r ON r.id = s."runId"
        WHERE r."flowId" = ${input.flowId} AND r.${cuaSo} AND s."finishedAt" IS NOT NULL
        GROUP BY s."nodeId" ORDER BY count(*) DESC, s."nodeId" LIMIT 50`)) as unknown as { nodeId: string; n: number; loi: number; p50: unknown; p90: unknown }[];
      const theoModel = (await db.execute(sql`SELECT coalesce(e.payload->>'model', '(không rõ)') AS model, count(*)::int AS "soLoiGoi",
          coalesce(sum((e.payload->>'tokVao')::numeric), 0)::bigint AS "tokVao", coalesce(sum((e.payload->>'tokRa')::numeric), 0)::bigint AS "tokRa",
          (count(*) FILTER (WHERE e.payload->>'tokVao' IS NULL))::int AS "khongBaoToken"
        FROM ai_flow_events e JOIN ai_flow_runs r ON r.id = e."runId"
        WHERE r."flowId" = ${input.flowId} AND r.${cuaSo} AND e.kind = 'buoc.model'
        GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 20`)) as unknown as { model: string; soLoiGoi: number; tokVao: unknown; tokRa: unknown; khongBaoToken: number }[];
      const [dk] = (await db.execute(sql`WITH m AS (
          SELECT e."runId", e.payload->>'model' AS model, (e.payload->>'kheBan')::boolean AS "kheBan",
                 lag(e.payload->>'model') OVER (PARTITION BY e."runId" ORDER BY e.id) AS truoc
            FROM ai_flow_events e JOIN ai_flow_runs r ON r.id = e."runId"
           WHERE r."flowId" = ${input.flowId} AND r.${cuaSo} AND e.kind = 'buoc.model')
        SELECT (count(*) FILTER (WHERE truoc IS NOT NULL AND model IS NOT NULL AND model IS DISTINCT FROM truoc))::int AS "uocLuong",
               (count(*) FILTER (WHERE "kheBan" IS TRUE))::int AS "luotKheBan" FROM m`)) as unknown as { uocLuong: number; luotKheBan: number }[];
      const dong = dem("xong") + dem("loi") + dem("huy");
      return {
        ngay: input.ngay,
        luot: { tong: theoTrangThai.reduce((a, x) => a + x.n, 0), xong: dem("xong"), loi: dem("loi"), huy: dem("huy"), dangChay: dem("dang-chay"), choDuyet: dem("cho-duyet"), tiLeThanhCong: dong > 0 ? Math.round((dem("xong") / dong) * 10000) / 10000 : null },
        thoiGianLuotXongGiay: { soLuot: tg?.n ?? 0, p50: so(tg?.p50), p90: so(tg?.p90) },
        theoNut: theoNut.map((x) => ({ nodeId: x.nodeId, soBuoc: x.n, soLoi: x.loi, p50Giay: so(x.p50), p90Giay: so(x.p90) })),
        theoModel: theoModel.map((x) => ({ model: x.model, soLoiGoi: x.soLoiGoi, tokenVao: Number(x.tokVao), tokenRa: Number(x.tokRa), khongBaoToken: x.khongBaoToken })),
        doiKhe: { uocLuong: dk?.uocLuong ?? 0, luotKheBan: dk?.luotKheBan ?? 0, ghiChu: "UOC LUONG: so lan model doi giua hai loi goi lien tiep trong cung mot luot (khong doc bo giam sat)." },
      };
    }),

  /** Dòng thời gian một lượt: bước (input/output cắt ở `TRAN_CHU_BUOC`) + sự kiện. */
  dongThoiGian: xemProcedure.input(z.object({ runId: z.string().uuid() })).query(async ({ input, ctx }) => {
    await chanLuot(ctx, input.runId, "flowXem");
    const db = await layDb("flowXem");
    const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, input.runId));
    if (!run) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowXem", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có lượt ${input.runId}.`);
    const buoc = await db.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, input.runId)).orderBy(aiFlowSteps.id);
    const suKien = await db.select().from(aiFlowEvents).where(eq(aiFlowEvents.runId, input.runId)).orderBy(aiFlowEvents.id).limit(2000);
    // Dữ liệu bước đã bị GỠ theo settings.luuDuLieu lúc đóng lượt? (để giao diện nói rõ thay vì hiện ô trống)
    const [cs] = (await db.execute(sql`SELECT v.definition->'settings'->>'luuDuLieu' AS "luuDuLieu" FROM ai_flow_versions v WHERE v."flowId" = ${run.flowId} AND v.version = ${run.version}`)) as unknown as { luuDuLieu: string | null }[];
    const luuDuLieu = cs?.luuDuLieu ?? "day-du";
    const duLieuDaGo = run.status !== "dang-chay" && run.status !== "cho-duyet" && !KIEU_KICH_HOAT_DOC_SAU_DONG.includes(run.triggerKind) && (luuDuLieu === "khong" || (luuDuLieu === "chi-loi" && run.status !== "loi"));
    return {
      run,
      luuDuLieu,
      duLieuDaGo,
      buoc: buoc.map((b) => ({ ...b, input: catJson(b.input), output: catJson(b.output), error: catJson(b.error) })),
      suKien: suKien.map((e) => ({ ...e, payload: catJson(e.payload, 1000) })),
    };
  }),

  /** Hàng chờ DUYỆT còn hạn (trang duyệt). */
  danhSachCho: xemProcedure.query(async ({ ctx }) => {
    const db = await layDb("flowXem");
    const cho = await nhaMayChoPhep(phamViCua(ctx));
    const rows = (await db.execute(sql`
      SELECT w."runId", w."nodeId", w."expiresAt", w.payload, r."flowId", r.version, r."startedAt", f.name AS "tenLuong"
        FROM ai_flow_waits w
        JOIN ai_flow_runs r ON r.id = w."runId"
        LEFT JOIN ai_flows f ON f.id = r."flowId"
       WHERE w.kind = 'duyet' AND (w."expiresAt" IS NULL OR w."expiresAt" > now()) AND ${locNhaMay(sql`f."factoryId"`, cho)}
       ORDER BY r."startedAt" DESC LIMIT 200`)) as unknown as {
      runId: string; nodeId: string; expiresAt: string | null; flowId: string; version: number; startedAt: string; tenLuong: string | null;
      payload: { tieuDe?: string; noiDung?: string; vaiTroDuyet?: string; items?: { json: unknown }[] } | null;
    }[];
    return rows.map(({ payload, ...r }) => ({
      ...r,
      tieuDe: payload?.tieuDe ?? "",
      noiDung: payload?.noiDung ?? "",
      vaiTroDuyet: payload?.vaiTroDuyet ?? null,
      soItem: payload?.items?.length ?? 0,
      itemDau: catJson(payload?.items?.[0]?.json ?? null, 2000),
      // Biểu mẫu (nguoi.bieu-mau): định nghĩa trường cho trang duyệt vẽ ô nhập; thẻ duyệt thường ⇒ null.
      bieuMau: bieuMauCuaPayload(payload)?.truong ?? null,
    }));
  }),

  /** Duyệt / bác một bước `nguoi.duyet`. Hai người bấm cùng lúc ⇒ người sau nhận CONFLICT. */
  duyet: ghiProcedure
    .input(z.object({ runId: z.string().uuid(), nodeId: z.string().regex(RE_ID), dongY: z.boolean(), lyDo: z.string().max(2000).optional(), bieuMau: z.record(z.string().max(48), z.union([z.string().max(2100), z.number(), z.boolean(), z.null()])).refine((o) => Object.keys(o).length <= 40).optional() }))
    .mutation(async ({ input, ctx }) => {
      // Lượt ngoài phạm vi / không tồn tại / không có bước chờ: MỘT lý do (flowKhongCoBuocChoDuyet) — không phân biệt được ⇒ không lộ.
      await chanLuot(ctx, input.runId, "flowDuyet", "Không có bước nào đang chờ duyệt ở đây.", "flowKhongCoBuocChoDuyet");
      const db = await layDb("flowDuyet");
      const [w] = (await db.execute(sql`SELECT kind, payload FROM ai_flow_waits WHERE "runId" = ${input.runId} AND "nodeId" = ${input.nodeId}`)) as unknown as { kind: string; payload: unknown }[];
      if (!w) {
        const [xong] = (await db.execute(sql`SELECT 1 AS c FROM ai_flow_steps WHERE "runId" = ${input.runId} AND "nodeId" = ${input.nodeId} AND status = 'xong' LIMIT 1`)) as unknown as unknown[];
        if (xong) throw appError("CONFLICT", "OPERATION_FAILED", { operation: "flowDuyet", reason: "flowDaTraLoi" }, "Bước này đã được trả lời.");
      }
      if (!w || w.kind !== "duyet") throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowDuyet", reason: "flowKhongCoBuocChoDuyet" }, "Không có bước nào đang chờ duyệt ở đây.");
      // ★ H2: vai đủ thứ bậc so với `vaiTroDuyet` + người duyệt KHÁC người bật phiên bản / người kích hoạt lượt. Sai ⇒ FORBIDDEN,
      // ghi kiểm toán, hàng chờ GIỮ NGUYÊN (bước vẫn chờ người đúng).
      const vaiYeuCau = String((w.payload as { vaiTroDuyet?: unknown } | null)?.vaiTroDuyet ?? "supervisor");
      const quyen = kiemQuyenDuyet({ nguoiDuyet: { id: ctx.user.id, role: String(ctx.user.role) }, vaiTroDuyet: vaiYeuCau, lienQuan: await layNguoiLienQuan(db, input.runId) });
      if (!quyen.ok) {
        await createAuditLog({
          userId: ctx.user.id, action: "FLOW_DUYET_TU_CHOI", entityType: "ai_flow_run", entityName: input.runId, status: "failure",
          details: { ma: quyen.ma, nodeId: input.nodeId, vaiTroDuyet: vaiYeuCau, vaiNguoiDuyet: String(ctx.user.role), dongY: input.dongY },
        }).catch((e: unknown) => console.error("[flow.duyet] không ghi được kiểm toán từ chối:", (e as Error)?.message ?? e));
        // Ba lý do KHÔNG lộ gì ngoài điều người duyệt đã biết (vai của chính họ, vai bước yêu cầu, việc họ đã bật/kích hoạt).
        if (quyen.ma === "VAI_THAP") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowDuyet", reason: "flowDuyetVaiThap", vaiYeuCau, vaiCuaBan: String(ctx.user.role) }, quyen.lyDo);
        if (quyen.ma === "TRUNG_NGUOI_BAT") throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowDuyet", reason: "flowDuyetTrungNguoiBat" }, quyen.lyDo);
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowDuyet", reason: "flowDuyetTrungChuLuot" }, quyen.lyDo);
      }
      // nguoi.bieu-mau: giá trị người điền được KIỂM LẠI theo định nghĩa trường trong hàng chờ (không tin trình duyệt); bác/bỏ qua ⇒ bỏ giá trị.
      const bm = bieuMauCuaPayload(w.payload);
      if (!bm && input.bieuMau !== undefined) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowDuyet", reason: "flowChiTietMayChu", chiTiet: "Bước này không phải biểu mẫu." }, "Bước này không phải biểu mẫu.");
      let giaTriBieuMau: Record<string, unknown> | undefined;
      if (bm && input.dongY) {
        const kt = kiemGiaTriBieuMau(bm.truong, input.bieuMau);
        if (!kt.ok) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowDuyet", reason: "flowChiTietMayChu", chiTiet: kt.loi.slice(0, 300) }, kt.loi);
        giaTriBieuMau = { [bm.truongRa]: kt.v };
      }
      const kq = await traLoiCho({
        runId: input.runId,
        nodeId: input.nodeId,
        cong: input.dongY ? "dong-y" : "tu-choi",
        // Bằng chứng duyệt / điền vào audit_logs (WORM) trong CÙNG giao dịch trả lời. KHÔNG ghi giá trị biểu mẫu / nội dung lý do — chỉ định danh và cờ.
        kiemToan: banGhiKiemToan({
          nguoi: ctx.user.id,
          hanhDong: "FLOW_DUYET",
          loaiThucThe: "ai_flow_run",
          thucThe: input.runId,
          chiTiet: { nodeId: input.nodeId, dongY: input.dongY, vaiTroNguoiDuyet: String(ctx.user.role), laBieuMau: bm !== null, ...(bm && input.dongY ? { truongBieuMau: bm.truong.map((f) => f.ten) } : {}), coLyDo: !!input.lyDo?.trim() },
        }),
        them: {
          duyet: { dongY: input.dongY, nguoi: ctx.user.id, lyDo: input.lyDo ?? null },
          ...(giaTriBieuMau ?? {}),
          // Đợt 8.5 — đề xuất OT của Luồng: CHẾ ĐỘ MÔ PHỎNG, không có đường gửi — chỉ ghi kết quả giả lập.
          ...(laDeXuatOtLuong(w.payload) ? ketQuaSauDuyetMoPhong(input.dongY) : {}),
        },
      });
      if (!kq.ok) throw appError("CONFLICT", "OPERATION_FAILED", { operation: "flowDuyet", reason: "flowDaTraLoi" }, "Bước này đã được trả lời hoặc lượt đã kết thúc.");
      return kq;
    }),

  /** Tạo (hoặc `ghiDe`) một bí mật — admin. Giá trị chỉ GHI: kết quả không có giá trị. */
  biMatTao: adminAiProcedure
    .input(
      z.object({
        id: z.string().regex(RE_ID),
        ten: z.string().trim().min(1).max(120),
        loai: z.enum(LOAI_BI_MAT as [string, ...string[]]),
        giaTri: z.string().min(4).max(8192),
        ghiDe: z.boolean().optional(),
        /** Đợt 9 — nhà máy của bí mật (admin: vắng ⇒ TOÀN HỆ THỐNG, chỉ admin dùng được). */
        factoryId: z.number().int().positive().optional(),
        /** Đợt 9 (M2) — host bí mật được phép gửi tới: BẮT BUỘC khi tạo (1–20 hostname). Ghi đè (`ghiDe`) vắng ⇒ giữ danh sách cũ. */
        hostChoPhep: z.array(z.string().max(253)).min(1).max(20).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // ★ Đợt 9 (IDOR): ghi đè bí mật đã có ⇒ phải thuộc phạm vi; bí mật mới ⇒ gán nhà máy theo cùng luật với luồng.
      const { factoryId: yeuCau, ...phanCon } = input;
      if (!input.hostChoPhep && !input.ghiDe) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowBiMatTao", reason: "flowBiMatCanHost" }, "Phải khai hostChoPhep (host bí mật được gửi tới).");
      let factoryId: number | null | undefined;
      const dbB = await layDb("flowBiMatTao");
      const [co] = await dbB.select({ id: aiFlowCredentials.id }).from(aiFlowCredentials).where(eq(aiFlowCredentials.id, input.id)).limit(1);
      if (co && input.ghiDe) {
        await chanBiMat(ctx, input.id, "flowBiMatTao");
        factoryId = yeuCau === undefined ? undefined : await nhaMayMoi(ctx, yeuCau, "flowBiMatTao");
      } else if (!co) factoryId = await nhaMayMoi(ctx, yeuCau, "flowBiMatTao");
      try {
        const kqTao = await taoBiMat({ ...phanCon, factoryId }, ctx.user.id);
        await ghiKiemToanLuong({ nguoi: ctx.user.id, hanhDong: "FLOW_BI_MAT_TAO", loaiThucThe: "ai_flow_credential", thucThe: input.id, chiTiet: { loai: input.loai, ghiDe: input.ghiDe === true, soHost: input.hostChoPhep?.length ?? null } });
        return kqTao;
      } catch (e) {
        loiBiMat(e, "flowBiMatTao");
      }
    }),

  /** Xoá một bí mật — admin. Luồng còn trỏ tới nó sẽ lỗi rõ ở node lúc chạy. */
  /** Khai / sửa danh sách host của một bí mật (M2) — admin. Bí mật cũ chưa khai host KHÔNG dùng được cho tới khi gọi thủ tục này. */
  biMatDatHost: adminAiProcedure
    .input(z.object({ id: z.string().regex(RE_ID), hostChoPhep: z.array(z.string().max(253)).min(1).max(20) }))
    .mutation(async ({ input, ctx }) => {
      await chanBiMat(ctx, input.id, "flowBiMatTao");
      try {
        const kq = await datHostBiMat(input.id, input.hostChoPhep);
        if (!kq) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowBiMatTao", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có bí mật ${input.id}.`);
        await ghiKiemToanLuong({ nguoi: ctx.user.id, hanhDong: "FLOW_BI_MAT_HOST", loaiThucThe: "ai_flow_credential", thucThe: input.id, chiTiet: { hostChoPhep: kq } });
        return { id: input.id, hostChoPhep: kq };
      } catch (e) {
        loiBiMat(e, "flowBiMatTao");
      }
    }),

  biMatXoa: adminAiProcedure.input(z.object({ id: z.string().regex(RE_ID) })).mutation(async ({ input, ctx }) => {
    await chanBiMat(ctx, input.id, "flowBiMatXoa");
    let xoa: boolean;
    try {
      xoa = await xoaBiMat(input.id);
    } catch (e) {
      loiBiMat(e, "flowBiMatXoa");
    }
    if (!xoa) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowBiMatXoa", reason: "flowKhongTonTaiHoacNgoaiPhamVi" }, `Không có bí mật ${input.id}.`);
    await ghiKiemToanLuong({ nguoi: ctx.user.id, hanhDong: "FLOW_BI_MAT_XOA", loaiThucThe: "ai_flow_credential", thucThe: input.id, chiTiet: {} });
    return { id: input.id, daXoa: true };
  }),

  /** Danh sách bí mật (id, tên, loại, phiên bản khoá, ngày) — quyền sửa luồng; KHÔNG giá trị. */
  biMatDanhSach: ghiProcedure.query(async ({ ctx }) => {
    let ds: Awaited<ReturnType<typeof lietKeBiMat>>;
    try {
      ds = await lietKeBiMat();
    } catch (e) {
      loiBiMat(e, "flowBiMatXem");
    }
    // ★ Đợt 9 (IDOR): chỉ bí mật trong phạm vi người gọi (NULL = toàn hệ thống ⇒ chỉ phạm vi "tất cả").
    const cho = await nhaMayChoPhep(phamViCua(ctx));
    const db = await layDb("flowBiMatXem");
    const nm = new Map((await db.select({ id: aiFlowCredentials.id, f: aiFlowCredentials.factoryId, h: aiFlowCredentials.hostChoPhep }).from(aiFlowCredentials)).map((r) => [r.id, r]));
    return ds.filter((b) => nhaMayHopLe(nm.get(b.id)?.f, cho)).map((b) => ({ ...b, factoryId: nm.get(b.id)?.f ?? null, hostChoPhep: nm.get(b.id)?.h ?? [] }));
  }),

  /**
   * Đợt 8.3 — MẪU LUỒNG cho nút "Tạo từ mẫu" của Flow Studio: định nghĩa + hạng tính bằng `kiemLuong` trên sổ node thật.
   * Chỉ đọc tệp tĩnh trong repo (không CSDL); người dùng lưu bản sao qua `luu` (id mới) — mẫu không bao giờ tự kích hoạt.
   */
  mauLuong: xemProcedure.query(() =>
    docMauLuong().map(({ tep, definition }) => {
      const kq = kiemLuong(definition, layNut);
      return { tep, id: definition.id, ten: definition.name, soNode: definition.nodes.length, hang: kq.hang, hopLe: kq.ok, definition };
    }),
  ),

  /**
   * Đợt 8.4 — MÔ TẢ → LUỒNG (spec §4.9): model (`code.software`, qua Cổng AI) sinh FlowDefinition ⇒ kiểm schema + `kiemLuong`
   * (hạng luồng con đọc CSDL) ⇒ BẢN NHÁP. KHÔNG lưu, KHÔNG bật — người mở bản nháp trên canvas rồi tự `luu`. Quyền = sửa luồng.
   * Mutation (gọi model — tốn, không tất định), không phải query.
   */
  taoTuMoTa: ghiProcedure.input(z.object({ moTa: z.string().trim().min(10).max(4000) })).mutation(async ({ input, ctx }) => {
    try {
      return await taoTuMoTa(input.moTa, {
        hangLuongCon: async (ids) => {
          const m = await hangLuongConTuDb(ids);
          // ★ Đợt 9 (IDOR): luồng con ngoài phạm vi người gọi = không tồn tại (không lộ hạng của luồng nhà máy khác).
          const thay = new Set<string>();
          for (const id of ids) if (await luongTrongPhamVi(phamViCua(ctx), id)) thay.add(id);
          return (id) => (thay.has(id) ? (m.get(id) ?? null) : null);
        },
      });
    } catch (e) {
      throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "flowTaoTuMoTa", reason: "flowChiTietMayChu", chiTiet: String((e as Error)?.message ?? e).slice(0, 300) }, `Không tạo được bản nháp: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
    }
  }),

  /** Khai báo các loại node đã đăng ký (Flow Studio). */
  danhMucNode: xemProcedure.query(() =>
    danhSachNut()
      .map((n) => ({
        type: n.type, typeVersion: n.typeVersion, laKichHoat: n.laKichHoat, congVao: [...n.congVao], congRa: [...n.congRa],
        tacDungPhu: n.tacDungPhu, lapLai: n.lapLai, choDuCong: n.choDuCong === true, nhanBiMat: n.nhanBiMat === true, congNenNoi: [...(n.congNenNoi ?? [])],
      }))
      .sort((a, b) => a.type.localeCompare(b.type)),
  ),
});
