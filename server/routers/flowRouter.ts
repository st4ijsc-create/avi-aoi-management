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
 */
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, moduleProcedure, moduleGate, writeProcedure, adminProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import { getDb } from "../db/connection";
import { aiFlowEvents, aiFlowRuns, aiFlowSteps, aiFlowVersions, aiFlows } from "../../drizzle/schema";
import { THU_TU_HANG, type FlowDefinition, type HangTacDungPhu } from "../../shared/flow/model";
import { LoiLuong, batDauRun, luuPhienBan, traLoiCho } from "../services/flow/dongCo";
import { danhSachNut } from "../services/flow/dangKyNut";
import { kiemThamSoKichHoat, napLaiLich } from "../services/flow/kichHoat/lich";
import { capTokenWebhook, coNodeWebhook, coTokenWebhook } from "../services/flow/kichHoat/webhook";
import { LOAI_BI_MAT, LoiBiMat, lietKeBiMat, taoBiMat, xoaBiMat } from "../services/flow/biMat";

const xemProcedure = moduleProcedure("MOD_AI");
const ghiProcedure = writeProcedure.use(moduleGate("MOD_AI"));
const adminAiProcedure = adminProcedure.use(moduleGate("MOD_AI"));

const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const flowIdSchema = z.string().regex(RE_ID);
const itemSchema = z.object({ json: z.record(z.string(), z.unknown()) });

/** Trần chữ của input/output mỗi bước trả về dòng thời gian (cắt ở đây, CSDL giữ nguyên theo `luuDuLieu`). */
export const TRAN_CHU_BUOC = 4000;

type Op = "flowXem" | "flowLuu" | "flowKichHoat" | "flowChayTay" | "flowDuyet" | "flowBiMatTao" | "flowBiMatXoa" | "flowBiMatXem";

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
      if (!daBat && laHangCao(v.riskClass) && ctx.user.role !== "admin") {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "flowKichHoatHangCao" }, `Luồng hạng ${v.riskClass} chưa bật — chỉ quản trị viên được chạy thử.`);
      }
      const def = v.definition as FlowDefinition;
      const thuCong = def.nodes.find((n) => n.type === "kich-hoat.thu-cong" && !n.disabled);
      const runId = await batDauRun({ flowId: input.flowId, version, items: input.items, nutKichHoat: thuCong?.id, triggerKind: "thu-cong" });
      return { runId, version };
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
      const [w] = (await db.execute(sql`SELECT kind FROM ai_flow_waits WHERE "runId" = ${input.runId} AND "nodeId" = ${input.nodeId}`)) as unknown as { kind: string }[];
      if (!w) {
        const [xong] = (await db.execute(sql`SELECT 1 AS c FROM ai_flow_steps WHERE "runId" = ${input.runId} AND "nodeId" = ${input.nodeId} AND status = 'xong' LIMIT 1`)) as unknown as unknown[];
        if (xong) throw appError("CONFLICT", "OPERATION_FAILED", { operation: "flowDuyet" }, "Bước này đã được trả lời.");
      }
      if (!w || w.kind !== "duyet") throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "flowDuyet" }, "Không có bước nào đang chờ duyệt ở đây.");
      const kq = await traLoiCho({
        runId: input.runId,
        nodeId: input.nodeId,
        cong: input.dongY ? "dong-y" : "tu-choi",
        them: { duyet: { dongY: input.dongY, nguoi: ctx.user.id, lyDo: input.lyDo ?? null } },
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
