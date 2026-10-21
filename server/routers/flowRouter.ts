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
import { and, desc, eq, sql } from "drizzle-orm";
import { router, moduleProcedure, moduleGate, writeProcedure, adminProcedure, deployProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import { getDb } from "../db/connection";
import { aiFlowEvents, aiFlowRuns, aiFlowSteps, aiFlowVersions, aiFlows, machines } from "../../drizzle/schema";
import { THU_TU_HANG, NodeInstanceSchema, kiemLuong, type FlowDefinition, type HangTacDungPhu } from "../../shared/flow/model";
import { LoiNgoaiPhamVi, chayThuNut, type BoKiemPhamVi } from "../services/flow/chayThuNut";
import { trongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import { LoiLuong, batDauRun, hangLuongConTuDb, luuPhienBan, traLoiCho } from "../services/flow/dongCo";
import { taoTuMoTa } from "../services/flow/taoTuMoTa";
import { danhSachNut, layNut } from "../services/flow/dangKyNut";
import { kiemThamSoKichHoat, napLaiLich } from "../services/flow/kichHoat/lich";
import { capTokenWebhook, coNodeWebhook, coTokenWebhook } from "../services/flow/kichHoat/webhook";
import { LOAI_BI_MAT, LoiBiMat, lietKeBiMat, taoBiMat, xoaBiMat } from "../services/flow/biMat";
import { ketQuaSauDuyetMoPhong, laDeXuatOtLuong } from "../services/flow/ot/congOtLuong";

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
async function chanTruocBatLuongOt({ ctx, rawInput }: { ctx: { user?: { role?: string } | null }; rawInput: unknown }): Promise<void> {
  if (ctx.user?.role !== "admin") {
    throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao" }, "Luồng hạng ot chỉ quản trị viên (kèm 2FA) được bật.");
  }
  const r = rawInput as { flowId?: unknown; version?: unknown } | null | undefined;
  if (!r || typeof r.flowId !== "string" || !RE_ID_OT.test(r.flowId) || typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) {
    throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowKichHoat" }, "Thiếu flowId/version hợp lệ.");
  }
  const db = await layDb("flowKichHoat");
  const [v] = await db.select({ riskClass: aiFlowVersions.riskClass }).from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, r.flowId), eq(aiFlowVersions.version, r.version)));
  if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowKichHoat" }, `Không có luồng ${r.flowId}@${r.version}.`);
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

type Op = "flowXem" | "flowLuu" | "flowKichHoat" | "flowChayTay" | "flowDuyet" | "flowBiMatTao" | "flowBiMatXoa" | "flowBiMatXem" | "flowTaoTuMoTa" | "flowChayThu";

/** `LoiBiMat` ⇒ `appError` (thông điệp của LoiBiMat không bao giờ chứa giá trị). Lỗi khác ném lại nguyên. */
function loiBiMat(e: unknown, op: Op): never {
  if (e instanceof LoiBiMat) {
    const ma = ({ THIEU_KHOA: "SERVICE_UNAVAILABLE", KHONG_CO_DB: "SERVICE_UNAVAILABLE", KHONG_HOP_LE: "BAD_REQUEST", DA_CO: "CONFLICT", KHONG_CO: "NOT_FOUND", GIAI_MA_HONG: "INTERNAL_SERVER_ERROR" } as const)[e.code];
    throw appError(ma, "OPERATION_FAILED", { operation: op }, e.message);
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

export const flowRouter = router({
  /** Mọi luồng + phiên bản hoạt động + phiên bản mới nhất + hạng. */
  danhSach: xemProcedure.query(async () => {
    const db = await layDb("flowXem");
    const rows = (await db.execute(sql`
      SELECT f.id, f.name, f."activeVersion", f.enabled, f."riskClass", f."updatedAt",
             (SELECT max(v.version) FROM ai_flow_versions v WHERE v."flowId" = f.id)::int AS "phienBanMoiNhat",
             (SELECT r.status FROM ai_flow_runs r WHERE r."flowId" = f.id ORDER BY r."startedAt" DESC LIMIT 1) AS "trangThaiLuotCuoi"
        FROM ai_flows f ORDER BY f."updatedAt" DESC LIMIT 500`)) as unknown as Record<string, unknown>[];
    return rows;
  }),

  /** Định nghĩa của phiên bản yêu cầu / hoạt động / mới nhất + danh sách phiên bản. */
  chiTiet: xemProcedure.input(z.object({ flowId: flowIdSchema, version: z.number().int().min(1).optional() })).query(async ({ input }) => {
    const db = await layDb("flowXem");
    const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, input.flowId));
    if (!f) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowXem" }, `Không có luồng ${input.flowId}.`);
    const dsPhienBan = await db
      .select({ version: aiFlowVersions.version, riskClass: aiFlowVersions.riskClass, createdAt: aiFlowVersions.createdAt, createdBy: aiFlowVersions.createdBy })
      .from(aiFlowVersions)
      .where(eq(aiFlowVersions.flowId, input.flowId))
      .orderBy(desc(aiFlowVersions.version));
    const chon = input.version ?? f.activeVersion ?? dsPhienBan[0]?.version;
    const [v] = chon
      ? await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, chon)))
      : [];
    if (input.version && !v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowXem" }, `Không có phiên bản ${input.version}.`);
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
  luu: ghiProcedure.input(z.object({ definition: z.record(z.string(), z.unknown()) })).mutation(async ({ input, ctx }) => {
    const loiKichHoat = kiemThamSoKichHoat(input.definition);
    if (loiKichHoat.length) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowLuu" }, `Luồng không hợp lệ: ${loiKichHoat.join("; ")}`);
    try {
      return await luuPhienBan(input.definition, ctx.user.id);
    } catch (e) {
      if (e instanceof LoiLuong && e.code === "LUONG_KHONG_HOP_LE") throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowLuu" }, `Luồng không hợp lệ: ${e.message}`);
      if (e instanceof LoiLuong && e.code === "KHONG_CO_DB") throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "flowLuu" }, e.message);
      throw e;
    }
  }),

  /**
   * Đặt phiên bản hoạt động + bật/tắt. Bật phiên bản hạng ≥ `ngoai-ghi` ⇒ admin. Luồng có node webhook mà chưa có token
   * (hoặc `xoayToken`) ⇒ sinh token, trả THÔ đúng một lần trong `tokenWebhook`.
   */
  datPhienBanHoatDong: ghiProcedure
    .input(z.object({ flowId: flowIdSchema, version: z.number().int().min(1), bat: z.boolean(), xoayToken: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await layDb("flowKichHoat");
      const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, input.version)));
      if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowKichHoat" }, `Không có luồng ${input.flowId}@${input.version}.`);
      if (input.bat && v.riskClass === "ot") {
        // Đợt 8.5 — hạng `ot` CHỈ bật qua `batLuongOt` (admin + 2FA mới); thủ tục này không còn là đường vòng.
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao" }, "Luồng hạng ot chỉ bật qua batLuongOt (quản trị viên + mã 2FA).");
      }
      if (input.bat && laHangCao(v.riskClass) && ctx.user.role !== "admin") {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao" }, `Luồng hạng ${v.riskClass} chỉ quản trị viên được bật.`);
      }
      await db
        .update(aiFlows)
        .set({ activeVersion: input.version, enabled: input.bat, updatedAt: sql`now()` })
        .where(eq(aiFlows.id, input.flowId));
      let tokenWebhook: string | null = null;
      if (input.bat && coNodeWebhook(v.definition as FlowDefinition)) tokenWebhook = await capTokenWebhook(input.flowId, input.xoayToken === true);
      await napLaiLich();
      return { flowId: input.flowId, version: input.version, bat: input.bat, hang: v.riskClass, tokenWebhook };
    }),

  /**
   * ★★★ Đợt 8.5 — BẬT một phiên bản hạng `ot`: admin + 2FA mới (`deployProcedure`: OTP tươi mỗi lượt khi step-up bật). Node OT
   * ở 8.5 chỉ ĐỀ XUẤT ở chế độ mô phỏng; cổng này vẫn là sàn của hạng `ot` (spec §4.6).
   */
  batLuongOt: batOtProcedure
    .meta({ chanTruocStepUp: chanTruocBatLuongOt })
    .input(z.object({ flowId: flowIdSchema, version: z.number().int().min(1), totpCode: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ input }) => {
      const db = await layDb("flowKichHoat");
      const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, input.version)));
      if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowKichHoat" }, `Không có luồng ${input.flowId}@${input.version}.`);
      if (v.riskClass !== "ot") throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "flowKichHoat" }, `Luồng ${input.flowId}@${input.version} không phải hạng ot.`);
      await db
        .update(aiFlows)
        .set({ activeVersion: input.version, enabled: true, updatedAt: sql`now()` })
        .where(eq(aiFlows.id, input.flowId));
      let tokenWebhook: string | null = null;
      if (coNodeWebhook(v.definition as FlowDefinition)) tokenWebhook = await capTokenWebhook(input.flowId, false);
      await napLaiLich();
      return { flowId: input.flowId, version: input.version, bat: true, hang: v.riskClass, tokenWebhook };
    }),

  /**
   * Chạy tay: phiên bản hoạt động nếu luồng bật, ngược lại phiên bản yêu cầu / mới nhất (chạy thử của người sửa). Phiên bản
   * hạng ≥ `ngoai-ghi` CHƯA được bật ⇒ admin (chạy tay không được là đường vòng qua cổng bật).
   */
  chayTay: ghiProcedure
    .input(z.object({ flowId: flowIdSchema, items: z.array(itemSchema).max(100).optional(), version: z.number().int().min(1).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await layDb("flowChayTay");
      const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, input.flowId));
      if (!f) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowChayTay" }, `Không có luồng ${input.flowId}.`);
      const [moiNhat] = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${input.flowId}`)) as unknown as { v: number | null }[];
      const version = input.version ?? (f.enabled && f.activeVersion ? f.activeVersion : moiNhat?.v ?? null);
      if (!version) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowChayTay" }, "Luồng chưa có phiên bản nào.");
      const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, input.flowId), eq(aiFlowVersions.version, version)));
      if (!v) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowChayTay" }, `Không có phiên bản ${version}.`);
      const daBat = f.enabled && f.activeVersion === version;
      if (!daBat && v.riskClass === "ot") {
        // Đợt 8.5 — chạy thử một phiên bản `ot` chưa bật = bỏ qua cổng admin + 2FA ⇒ từ chối mọi vai.
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao" }, "Luồng hạng ot phải được bật (batLuongOt: quản trị viên + mã 2FA) trước khi chạy.");
      }
      if (!daBat && laHangCao(v.riskClass) && ctx.user.role !== "admin") {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao" }, `Luồng hạng ${v.riskClass} chưa bật — chỉ quản trị viên được chạy thử.`);
      }
      const def = v.definition as FlowDefinition;
      const thuCong = def.nodes.find((n) => n.type === "kich-hoat.thu-cong" && !n.disabled);
      const runId = await batDauRun({ flowId: input.flowId, version, items: input.items, nutKichHoat: thuCong?.id, triggerKind: "thu-cong" });
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
      const pv = phamViCua(ctx);
      const boKiem: BoKiemPhamVi = {
        may: async (id) => {
          const db = await layDb("flowChayThu");
          const [m] = await db.select({ id: machines.id }).from(machines).where(eq(machines.id, id)).limit(1);
          return !!m && (await trongPhamVi("machine", id, pv));
        },
      };
      let r;
      try {
        r = await chayThuNut(input, boKiem);
      } catch (e) {
        if (e instanceof LoiNgoaiPhamVi) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowChayThu" }, "Không tìm thấy máy.");
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
    .query(async ({ input }) => {
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

  /** Dòng thời gian một lượt: bước (input/output cắt ở `TRAN_CHU_BUOC`) + sự kiện. */
  dongThoiGian: xemProcedure.input(z.object({ runId: z.string().uuid() })).query(async ({ input }) => {
    const db = await layDb("flowXem");
    const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, input.runId));
    if (!run) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowXem" }, `Không có lượt ${input.runId}.`);
    const buoc = await db.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, input.runId)).orderBy(aiFlowSteps.id);
    const suKien = await db.select().from(aiFlowEvents).where(eq(aiFlowEvents.runId, input.runId)).orderBy(aiFlowEvents.id).limit(2000);
    return {
      run,
      buoc: buoc.map((b) => ({ ...b, input: catJson(b.input), output: catJson(b.output), error: catJson(b.error) })),
      suKien: suKien.map((e) => ({ ...e, payload: catJson(e.payload, 1000) })),
    };
  }),

  /** Hàng chờ DUYỆT còn hạn (trang duyệt). */
  danhSachCho: xemProcedure.query(async () => {
    const db = await layDb("flowXem");
    const rows = (await db.execute(sql`
      SELECT w."runId", w."nodeId", w."expiresAt", w.payload, r."flowId", r.version, r."startedAt", f.name AS "tenLuong"
        FROM ai_flow_waits w
        JOIN ai_flow_runs r ON r.id = w."runId"
        LEFT JOIN ai_flows f ON f.id = r."flowId"
       WHERE w.kind = 'duyet' AND (w."expiresAt" IS NULL OR w."expiresAt" > now())
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
    }));
  }),

  /** Duyệt / bác một bước `nguoi.duyet`. Hai người bấm cùng lúc ⇒ người sau nhận CONFLICT. */
  duyet: ghiProcedure
    .input(z.object({ runId: z.string().uuid(), nodeId: z.string().regex(RE_ID), dongY: z.boolean(), lyDo: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await layDb("flowDuyet");
      const [w] = (await db.execute(sql`SELECT kind, payload FROM ai_flow_waits WHERE "runId" = ${input.runId} AND "nodeId" = ${input.nodeId}`)) as unknown as { kind: string; payload: unknown }[];
      if (!w) {
        const [xong] = (await db.execute(sql`SELECT 1 AS c FROM ai_flow_steps WHERE "runId" = ${input.runId} AND "nodeId" = ${input.nodeId} AND status = 'xong' LIMIT 1`)) as unknown as unknown[];
        if (xong) throw appError("CONFLICT", "OPERATION_FAILED", { operation: "flowDuyet" }, "Bước này đã được trả lời.");
      }
      if (!w || w.kind !== "duyet") throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowDuyet" }, "Không có bước nào đang chờ duyệt ở đây.");
      const kq = await traLoiCho({
        runId: input.runId,
        nodeId: input.nodeId,
        cong: input.dongY ? "dong-y" : "tu-choi",
        them: {
          duyet: { dongY: input.dongY, nguoi: ctx.user.id, lyDo: input.lyDo ?? null },
          // Đợt 8.5 — đề xuất OT của Luồng: CHẾ ĐỘ MÔ PHỎNG, không có đường gửi — chỉ ghi kết quả giả lập.
          ...(laDeXuatOtLuong(w.payload) ? ketQuaSauDuyetMoPhong(input.dongY) : {}),
        },
      });
      if (!kq.ok) throw appError("CONFLICT", "OPERATION_FAILED", { operation: "flowDuyet" }, "Bước này đã được trả lời hoặc lượt đã kết thúc.");
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
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await taoBiMat(input, ctx.user.id);
      } catch (e) {
        loiBiMat(e, "flowBiMatTao");
      }
    }),

  /** Xoá một bí mật — admin. Luồng còn trỏ tới nó sẽ lỗi rõ ở node lúc chạy. */
  biMatXoa: adminAiProcedure.input(z.object({ id: z.string().regex(RE_ID) })).mutation(async ({ input }) => {
    let xoa: boolean;
    try {
      xoa = await xoaBiMat(input.id);
    } catch (e) {
      loiBiMat(e, "flowBiMatXoa");
    }
    if (!xoa) throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowBiMatXoa" }, `Không có bí mật ${input.id}.`);
    return { id: input.id, daXoa: true };
  }),

  /** Danh sách bí mật (id, tên, loại, phiên bản khoá, ngày) — quyền sửa luồng; KHÔNG giá trị. */
  biMatDanhSach: ghiProcedure.query(async () => {
    try {
      return await lietKeBiMat();
    } catch (e) {
      loiBiMat(e, "flowBiMatXem");
    }
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
  taoTuMoTa: ghiProcedure.input(z.object({ moTa: z.string().trim().min(10).max(4000) })).mutation(async ({ input }) => {
    try {
      return await taoTuMoTa(input.moTa, {
        hangLuongCon: async (ids) => {
          const m = await hangLuongConTuDb(ids);
          return (id) => m.get(id) ?? null;
        },
      });
    } catch (e) {
      throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "flowTaoTuMoTa" }, `Không tạo được bản nháp: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
    }
  }),

  /** Khai báo các loại node đã đăng ký (Flow Studio). */
  danhMucNode: xemProcedure.query(() =>
    danhSachNut()
      .map((n) => ({
        type: n.type, typeVersion: n.typeVersion, laKichHoat: n.laKichHoat, congVao: [...n.congVao], congRa: [...n.congRa],
        tacDungPhu: n.tacDungPhu, lapLai: n.lapLai, choDuCong: n.choDuCong === true, nhanBiMat: n.nhanBiMat === true,
      }))
      .sort((a, b) => a.type.localeCompare(b.type)),
  ),
});
