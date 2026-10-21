/**
 * AI GGUF Router — Local LLM model management & inference via .gguf files
 */

import { z } from "zod";
import { desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, moduleProcedure, moduleGate, adminProcedure as adminProcedureCore } from "../_core/trpc";
import { appError } from "../_core/appError";
import { adminProcedure as adminProcedureBase } from "./_shared";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
/**
 * ★ Đợt 6 — ĐỔI MODEL llama-server: dừng server chữ chính (mọi lượt AI xếp hàng ~1–3 phút) rồi nạp model khác lên
 * card. Sàn: `adminProcedure` của `_core` — vai admin + ĐÃ BẬT 2FA (khi `AUTH_2FA_BAT_BUOC` bật) + audit mọi mutation
 * (KHÔNG phải `adminProcedure` của `_shared`, sàn đó không đòi 2FA) — và cổng giấy phép `MOD_AI`.
 * ⚠ CỐ Ý KHÔNG step-up OTP mỗi lượt: tập "đòi OTP" của repo ĐỊNH NGHĨA = tập `deployProcedure` (lưới hai nửa
 * `deployStepUpFreshness.test.ts` + `client/src/lib/vramPanelStepUp.unit.test.ts`: client chỉ được mở hộp OTP cho
 * đúng tập đó, mỗi thủ tục cần một lưới gọi THẬT). Đưa lượt đổi model vào tập ấy là một QUYẾT ĐỊNH cho chủ dự án
 * (sàn `actuation` còn cho supervisor/engineer — phải thêm chặn vai admin). Rào thay thế ở đây: lượt đổi tự kiểm
 * VRAM + `/props` + sinh thử và TỰ QUAY VỀ; không có tham số nào ngoài một tên tệp trong danh sách trắng.
 */
const adminDoiModel = adminProcedureCore.use(moduleGate("MOD_AI"));
import {
  loadGgufModel,
  unloadGgufModel,
  generateText,
  chatCompletion,
  analyzeDefect,
  generateQualityInsights,
  listGgufModels,
  getLoadedGgufModels,
  isGgufAvailable,
  getEngineHealth,
  generateEmbedding,
  generateTextStream,
  chatCompletionStream,
  countTokens,
} from "../services/aiGgufEngine";
import { getAIProviderStatus } from "../services/aiProviderManager";
// ★ G5-E — bộ cắt chuỗi suy luận. Module LÁ (0 import, 0 I/O) ⇒ import TĨNH, hàng rào vô điều kiện.
import { stripThinking } from "../services/ai/thinkingStrip";
import { LoiDoiModel, layDieuPhoiDoiModel, tongQuanDoiModel, type MaLoiDoiModel } from "../services/ai/doiModelLlamaServer";
import { trangThaiLuaChonModel } from "../services/ai/luaChonModelLlamaServer";

/** Mã từ chối của lượt đổi model ⇒ mã tRPC: xung đột trạng thái máy = CONFLICT, đầu vào sai = BAD_REQUEST. */
const MA_TRPC_DOI_MODEL: Record<MaLoiDoiModel, "BAD_REQUEST" | "CONFLICT" | "PRECONDITION_FAILED"> = {
  TAT: "PRECONDITION_FAILED",
  MODEL_KHONG_HOP_LE: "BAD_REQUEST",
  DANG_DOI: "CONFLICT",
  DANG_TAM_DUNG: "CONFLICT",
  GIAM_SAT_DANG_KHOI_DONG: "CONFLICT",
  SERVER_KHONG_SONG: "PRECONDITION_FAILED",
  DA_DANG_CHAY: "CONFLICT",
  VRAM_KHONG_DOC_DUOC: "PRECONDITION_FAILED",
  VRAM_KHONG_DU: "PRECONDITION_FAILED",
};

/**
 * ★ G5-E — `generate`/`chat` trả NGUYÊN VẸN đối tượng của engine cho playground/Vision-Lab: ô
 * `text` đi thẳng vào mắt kỹ sư, không qua một bộ lọc nào. Cả hai đều cho phép `modelId` RỖNG ⇒
 * dùng model MẶC ĐỊNH ⇒ đổi roster sang một model họ Qwen3.x là chỗ này phát `<think>`.
 *
 * `stripThinking().answer` đã `.trim()`. Playground là nơi soi đầu ra THÔ, nên khi không có gì bị
 * cắt ta trả lại nguyên văn: bản vá là **no-op từng ký tự** với roster hiện tại
 * (Qwen3-30B-A3B-Instruct không phát `<think>`). `answer === raw.trim()` xảy ra khi và chỉ khi
 * phép quét không xoá ký tự phi-khoảng-trắng nào — mọi lượt cắt thật đều xoá ít nhất một cặp thẻ.
 *
 * Các ô đo lường (`tokensPrompt`/`tokensGenerated`/`modelId`) giữ nguyên: chúng nói về LƯỢT SINH,
 * không phải về chữ hiển thị — nắn chúng theo phép cắt là làm sai số liệu.
 */
function catSuyLuanGiuBien<T extends { text: string }>(ket: T): T {
  const cut = stripThinking(ket.text);
  return { ...ket, text: cut.answer === ket.text.trim() ? ket.text : cut.answer };
}

export const aiGgufRouter = router({
  // ─── Status ──────────────────────────────────────────
  status: protectedProcedure.query(async () => {
    return {
      available: await isGgufAvailable(),
      loadedModels: getLoadedGgufModels(),
    };
  }),

  // ─── AI Provider Status (all providers) ──────────────
  providerStatus: protectedProcedure.query(async () => {
    return getAIProviderStatus();
  }),

  // ─── Model Management ───────────────────────────────
  listModels: protectedProcedure.query(async () => {
    return listGgufModels();
  }),

  loadModel: adminProcedure
    .input(z.object({
      modelPath: z.string().min(1),
      contextSize: z.number().min(256).max(131072).optional(),
      gpuLayers: z.number().min(-1).max(200).optional(),
      threads: z.number().min(1).max(64).optional(),
      batchSize: z.number().min(32).max(4096).optional(),
      flashAttention: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const modelId = await loadGgufModel(input);
        return { success: true, modelId };
      } catch (err: any) {
        throw appError(
          "INTERNAL_SERVER_ERROR",
          "OPERATION_FAILED",
          { operation: "loadGgufModel" },
          `Failed to load GGUF model: ${err.message}`,
        );
      }
    }),

  unloadModel: adminProcedure
    .input(z.object({ modelId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const success = await unloadGgufModel(input.modelId);
      if (!success) {
        throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "unloadGgufModel" }, `Model "${input.modelId}" is not loaded`);
      }
      return { success: true };
    }),

  // ─── Text Generation ────────────────────────────────
  generate: protectedProcedure
    .input(z.object({
      prompt: z.string().min(1).max(8000),
      systemPrompt: z.string().max(4000).optional(),
      modelId: z.string().optional(),
      maxTokens: z.number().min(1).max(4096).optional(),
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).optional(),
      topK: z.number().min(1).max(100).optional(),
      repeatPenalty: z.number().min(1).max(2).optional(),
      stopSequences: z.array(z.string()).optional(),
      jsonMode: z.boolean().optional(),
      language: z.enum(["en", "vi"]).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { modelId, ...options } = input;
        return catSuyLuanGiuBien(await generateText(options, modelId));
      } catch (err: any) {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "generateText" }, `Generation failed: ${err.message}`);
      }
    }),

  // ─── Chat Completion ────────────────────────────────
  chat: protectedProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })).min(1),
      modelId: z.string().optional(),
      maxTokens: z.number().min(1).max(4096).optional(),
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).optional(),
      topK: z.number().min(1).max(100).optional(),
      repeatPenalty: z.number().min(1).max(2).optional(),
      jsonMode: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { modelId, ...options } = input;
        return catSuyLuanGiuBien(await chatCompletion(options, modelId));
      } catch (err: any) {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "chatCompletion" }, `Chat completion failed: ${err.message}`);
      }
    }),

  // ─── Specialized AOI Functions ──────────────────────
  analyzeDefect: protectedProcedure
    .input(z.object({
      productModel: z.string(),
      measurementPoint: z.string(),
      result: z.string(),
      measuredValue: z.number().optional(),
      confidence: z.number().optional(),
      machineCode: z.string().optional(),
      modelId: z.string().optional(),
      language: z.enum(["en", "vi"]).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { modelId, language, ...defectInfo } = input;
        const analysis = await analyzeDefect(defectInfo, modelId, language ?? "vi");
        return { analysis };
      } catch (err: any) {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "analyzeDefect" }, `Defect analysis failed: ${err.message}`);
      }
    }),

  qualityInsights: protectedProcedure
    .input(z.object({
      data: z.object({
        totalInspections: z.number(),
        passCount: z.number(),
        failCount: z.number(),
        passRate: z.number(),
        topDefects: z.array(z.object({
          type: z.string(),
          count: z.number(),
          percentage: z.number(),
        })),
        periodStart: z.string(),
        periodEnd: z.string(),
        machineCode: z.string().optional(),
      }),
      modelId: z.string().optional(),
      language: z.enum(["en", "vi"]).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const insights = await generateQualityInsights(input.data, input.modelId, input.language ?? "vi");
        return { insights };
      } catch (err: any) {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "generateQualityInsights" }, `Insights generation failed: ${err.message}`);
      }
    }),

  // ─── Engine Health ──────────────────────────────────
  health: protectedProcedure.query(async () => {
    return getEngineHealth();
  }),

  // ─── Model Router telemetry (tier distribution for "AI Brain" dashboard) ──
  // Now DB-backed via the AI Gateway: tier distribution is aggregated from the
  // persisted ai_gateway_metrics table (durable across restarts) and merged with the
  // legacy in-memory router counter so pre-gateway callers still register. Shape is
  // kept backward-compatible ({ total, byTier, fastModelConfigured }) for the frontend.
  routerStats: protectedProcedure.query(async () => {
    const [{ getRouterStats }, { getGatewayStats }] = await Promise.all([
      import("../services/aiModelRouter"),
      import("../services/aiGateway"),
    ]);
    const mem = getRouterStats(); // legacy in-memory (route() callers not yet on the gateway)
    const gw = await getGatewayStats(); // DB-backed (gateway callers)

    // Merge tier distributions so the dashboard reflects ALL routed traffic.
    const byTier: Record<number, number> = { ...mem.byTier };
    for (const [tier, count] of Object.entries(gw.byTier)) {
      byTier[Number(tier)] = (byTier[Number(tier)] ?? 0) + (count as number);
    }
    const total = Object.values(byTier).reduce((a, b) => a + b, 0);
    return {
      total,
      byTier,
      fastModelConfigured: mem.fastModelConfigured || gw.fastModelConfigured,
      // Provenance so the UI can label whether numbers are durable (db) or volatile (memory).
      source: gw.source,
    };
  }),

  // ─── AI Gateway stats (tokens / latency / rate-limit / A/B) — DB-backed ──
  // Richer observability surface for the AI Gateway. Honest-empty (zeroes) when nothing
  // has been routed yet; `source` reports whether numbers came from the durable table.
  gatewayStats: protectedProcedure
    .input(z.object({ sinceHours: z.number().min(1).max(720).optional() }).optional())
    .query(async ({ input }) => {
      const { getGatewayStats, isAbEnabled } = await import("../services/aiGateway");
      const stats = await getGatewayStats(input?.sinceHours ?? 24);
      return { ...stats, abEnabled: isAbEnabled() };
    }),

  // ─── Embedding ──────────────────────────────────────
  embedding: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(8000),
      modelId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await generateEmbedding(input.text, input.modelId);
      } catch (err: any) {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "generateEmbedding" }, `Embedding generation failed: ${err.message}`);
      }
    }),

  // ─── Đợt 6 — Đổi model llama-server (có kiểm /props) ─────────
  /** Kho model + server đang chạy (`/props`) + lựa chọn bền + lượt đổi gần nhất (UI hỏi mỗi 2 s khi đang đổi). */
  doiModelTongQuan: adminDoiModel.query(async () => {
    const tq = await tongQuanDoiModel();
    const dp = layDieuPhoiDoiModel();
    return { ...tq, luaChon: trangThaiLuaChonModel(), phien: dp.trangThai(), phucHoi: dp.phucHoiCuoi() };
  }),

  /**
   * Bắt đầu đổi model. Kiểm trước (danh sách trắng, khoá, `/props` hiện tại, VRAM) ĐỒNG BỘ — từ chối trả về
   * ngay; phần dài (dừng → nạp → `/props` → sinh thử, tự quay về khi hỏng) chạy nền. Kết quả cuối ghi audit
   * riêng (`aiGguf.doiModelKetQua`) — middleware chỉ thấy lượt BẮT ĐẦU.
   */
  doiModelBatDau: adminDoiModel
    .input(z.object({ tenModel: z.string().trim().min(1).max(220) }))
    .mutation(async ({ input, ctx }) => {
      const nguoi = ctx.user.username ?? ctx.user.name ?? String(ctx.user.id);
      let kq: Awaited<ReturnType<ReturnType<typeof layDieuPhoiDoiModel>["batDau"]>>;
      try {
        kq = await layDieuPhoiDoiModel().batDau(input.tenModel, nguoi);
      } catch (e) {
        if (e instanceof LoiDoiModel) {
          throw appError(MA_TRPC_DOI_MODEL[e.code], "OPERATION_FAILED", { operation: "doiModelLlamaServer" }, e.message);
        }
        throw e;
      }
      const ngCanh = {
        userId: ctx.user.id,
        userName: ctx.user.username ?? ctx.user.name ?? null,
        ipAddress: ctx.req?.ip ?? null,
        userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
        source: "trpc" as const,
      };
      void kq.xong
        .then(async (p) => {
          const { logCrudOperation } = await import("../services/auditTrailService");
          await logCrudOperation(ngCanh, {
            action: "aiGguf.doiModelKetQua",
            entityType: "llama_server_model",
            entityName: p.modelMoi,
            details: {
              operation: "update",
              before: { model: p.modelCu, props: p.propsCu },
              after: { model: p.ketQua === "thanh-cong" ? p.modelMoi : p.modelCu, props: p.props },
              metadata: { id: p.id, ketQua: p.ketQua, loi: p.loi, canhBao: p.canhBao, buoc: p.buoc.map((b) => `${b.buoc}:${b.trangThai}`) },
              ...(p.loi ? { errorMessage: p.loi } : {}),
            },
            status: p.ketQua === "thanh-cong" ? "success" : "failure",
          });
        })
        .catch((err) => console.error("[aiGguf.doiModel] ghi audit kết quả hỏng:", err?.message ?? err));
      return { id: kq.id };
    }),

  // ─── ★★ Đợt 7.0 — Sổ model (vai trò → model) ──────────
  /** Vai trò · gán còn hiệu lực · hồ sơ · artifact + model mà MỖI vai trò đang phân giải ra (toàn cục) kèm lý do. */
  soModelTongQuan: adminDoiModel.query(async () => {
    const [{ getDb }, sm, { dinhTuyenVaiTro }, { lamMoiAnhSoModel }, { thongKeKheNang }] = await Promise.all([
      import("../db/connection"),
      import("../../drizzle/schema"),
      import("../services/ai/soModel/dinhTuyenVaiTro"),
      import("../services/ai/soModel/napSoModel"),
      import("../services/ai/soModel/kheNangMacDinh"),
    ]);
    const db = await getDb();
    if (!db) throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "soModelTongQuan" }, "Không có kết nối CSDL.");
    const anh = await lamMoiAnhSoModel();
    const [artifacts, profiles, roles, evalRuns] = await Promise.all([
      db.select().from(sm.aiModelArtifacts),
      db.select().from(sm.aiServingProfiles),
      db.select({ id: sm.aiRoles.id, moTa: sm.aiRoles.moTa, evalSuite: sm.aiRoles.evalSuite }).from(sm.aiRoles),
      // Đợt 7.4 — tab "Đo" của Trung tâm Model: 100 lượt đo mới nhất (bảng rỗng ⇒ "chưa có lượt đo").
      db
        .select({
          id: sm.aiModelEvalRuns.id,
          profileId: sm.aiModelEvalRuns.profileId,
          suite: sm.aiModelEvalRuns.suite,
          nTasks: sm.aiModelEvalRuns.nTasks,
          nPass: sm.aiModelEvalRuns.nPass,
          nRuns: sm.aiModelEvalRuns.nRuns,
          p50Ms: sm.aiModelEvalRuns.p50Ms,
          p90Ms: sm.aiModelEvalRuns.p90Ms,
          gitSha: sm.aiModelEvalRuns.gitSha,
          createdAt: sm.aiModelEvalRuns.createdAt,
        })
        .from(sm.aiModelEvalRuns)
        .orderBy(desc(sm.aiModelEvalRuns.createdAt), desc(sm.aiModelEvalRuns.id))
        .limit(100),
    ]);
    const moTa = new Map(roles.map((r) => [r.id, r]));
    const vaiTro = [...anh.vaiTro.keys()].sort().map((id) => ({
      id,
      ...anh.vaiTro.get(id)!,
      moTa: moTa.get(id)?.moTa ?? null,
      evalSuite: moTa.get(id)?.evalSuite ?? null,
      dinhTuyen: dinhTuyenVaiTro({ vaiTro: id }, anh, process.env),
    }));
    return { taiLuc: anh.taiLuc, vaiTro, gan: anh.gan, profiles, artifacts, evalRuns, kheNang: thongKeKheNang() };
  }),

  /** Quét `GGUF_MODELS_DIR` → `ai_model_artifacts` (thêm mới, đánh dấu mất / có lại). */
  soModelDongBoKho: adminDoiModel.mutation(async () => {
    const { dongBoKhoModel } = await import("../services/ai/soModel/dongBoKhoModel");
    return dongBoKhoModel();
  }),

  /** Đổi gán vai trò → (hồ sơ | khoá .env). Cổng: active + hồ sơ cần lượt đo + giấy phép rõ (xem `soModel/datGan.ts`). */
  soModelDatGan: adminDoiModel
    .input(
      z
        .object({
          roleId: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)?$/).max(48),
          scopeKind: z.enum(["global", "tenant", "project", "flow", "be-mat"]),
          scopeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(),
          profileId: z.string().min(1).max(96).nullable(),
          envKey: z.string().regex(/^GGUF_[A-Z_]+$/).max(32).nullable(),
          fallback: z.array(z.string().min(1).max(96)).max(4).default([]),
          mode: z.enum(["active", "shadow", "thu"]),
        })
        .refine((v) => (v.scopeKind === "global") === (v.scopeId === null), { message: "scopeId bắt buộc trừ phạm vi global" })
        // ★ Đợt 9 — phạm vi bề mặt: scopeId theo danh sách trắng (BE_MAT_GAN, mig 0405).
        .refine((v) => v.scopeKind !== "be-mat" || v.scopeId === "luong", { message: "phạm vi be-mat: scopeId phải là 'luong'" }),
    )
    .mutation(async ({ input, ctx }) => {
      const [{ getDb }, { datGanModel, LoiDatGan }, { lamMoiAnhSoModel }] = await Promise.all([
        import("../db/connection"),
        import("../services/ai/soModel/datGan"),
        import("../services/ai/soModel/napSoModel"),
      ]);
      const db = await getDb();
      if (!db) throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "soModelDatGan" }, "Không có kết nối CSDL.");
      try {
        const kq = await datGanModel(db, input as Parameters<typeof datGanModel>[1], ctx.user.id);
        await lamMoiAnhSoModel();
        return kq;
      } catch (e) {
        if (e instanceof LoiDatGan) {
          const ma = e.ma === "VAI_TRO_KHONG_CO" || e.ma === "PROFILE_KHONG_CO" ? "NOT_FOUND" : e.ma === "DICH_SAI" ? "BAD_REQUEST" : "PRECONDITION_FAILED";
          throw appError(ma, "OPERATION_FAILED", { operation: "soModelDatGan" }, e.message);
        }
        throw e;
      }
    }),

  /**
   * ★★ Đợt 7.4 — khai giấy phép / cách ly một artifact. `missing` KHÔNG đặt tay được (việc của "Đồng bộ kho").
   * Logic + cổng ở `soModel/suaSoModel.ts`; router mỏng.
   */
  soModelSuaArtifact: adminDoiModel
    .input(
      z
        .object({
          id: z.string().min(1).max(96),
          license: z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9.+_-]{0,47}$/).optional(),
          status: z.enum(["available", "quarantined"]).optional(),
        })
        .strict()
        .refine((v) => v.license !== undefined || v.status !== undefined, { message: "cần license hoặc status" }),
    )
    .mutation(async ({ input }) => {
      const [{ getDb }, { suaArtifact, LoiSuaSoModel }, { lamMoiAnhSoModel }] = await Promise.all([
        import("../db/connection"),
        import("../services/ai/soModel/suaSoModel"),
        import("../services/ai/soModel/napSoModel"),
      ]);
      const db = await getDb();
      if (!db) throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "soModelSuaArtifact" }, "Không có kết nối CSDL.");
      try {
        const kq = await suaArtifact(db, input);
        await lamMoiAnhSoModel();
        return kq;
      } catch (e) {
        if (e instanceof LoiSuaSoModel) {
          const ma = e.ma === "ARTIFACT_KHONG_CO" ? "NOT_FOUND" : e.ma === "DAU_VAO_SAI" ? "BAD_REQUEST" : "PRECONDITION_FAILED";
          throw appError(ma, "OPERATION_FAILED", { operation: "soModelSuaArtifact" }, e.message);
        }
        throw e;
      }
    }),

  /** ★★ Đợt 7.4 — tạo/sửa (upsert) hồ sơ phục vụ. `serverArgs`/`sampling` = `{}` ở v1 (chưa mở chỉnh). */
  soModelTaoHoSo: adminDoiModel
    .input(
      z
        .object({
          id: z.string().regex(/^[a-z0-9][a-z0-9.@-]{0,95}$/),
          artifactId: z.string().min(1).max(96),
          slotClass: z.enum(["nang", "nho", "sidecar"]),
          ctx: z.number().int().min(512).max(262_144),
          thinking: z.enum(["on", "off", "auto"]),
          enabled: z.boolean(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const [{ getDb }, { luuHoSo, LoiSuaSoModel }, { lamMoiAnhSoModel }] = await Promise.all([
        import("../db/connection"),
        import("../services/ai/soModel/suaSoModel"),
        import("../services/ai/soModel/napSoModel"),
      ]);
      const db = await getDb();
      if (!db) throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "soModelTaoHoSo" }, "Không có kết nối CSDL.");
      try {
        const kq = await luuHoSo(db, input);
        await lamMoiAnhSoModel();
        return kq;
      } catch (e) {
        if (e instanceof LoiSuaSoModel) {
          const ma = e.ma === "ARTIFACT_KHONG_CO" ? "NOT_FOUND" : e.ma === "DAU_VAO_SAI" ? "BAD_REQUEST" : "PRECONDITION_FAILED";
          throw appError(ma, "OPERATION_FAILED", { operation: "soModelTaoHoSo" }, e.message);
        }
        throw e;
      }
    }),

  // ─── Token Counting ─────────────────────────────────
  tokenCount: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(32000),
      modelId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const count = await countTokens(input.text, input.modelId);
        return { tokenCount: count, textLength: input.text.length };
      } catch (err: any) {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "countTokens" }, `Token counting failed: ${err.message}`);
      }
    }),
});
