import { protectedProcedure, qualityProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";
import { invokeLLM } from "../_core/llm";
import { finalYield } from "../utils/kpi";

// ============ INSPECTION ROUTER ============
export const inspectionRouter = router({
  list: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
      serialNumber: z.string().optional(),
      result: z.enum(["OK", "NG", "NTF"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(1000).optional(),
      offset: z.number().min(0).optional(),
    }))
    .query(async ({ input, ctx }) => {
      return db.getProductInspections({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as "user" | "admin" | undefined,
      });
    }),

  search: protectedProcedure
    .input(z.object({
      factoryCode: z.string().optional(),
      workshopCode: z.string().optional(),
      lineCode: z.string().optional(),
      stationCode: z.string().optional(),
      machineCode: z.string().optional(),
      serialNumber: z.string().optional(),
      productModel: z.string().optional(),
      result: z.enum(["OK", "NG", "NTF"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(1000).optional(),
      offset: z.number().min(0).optional(),
      // W7-B (doc 27 V3): "ntfScore" pre-sorts the verify queue by suspected
      // false-call likelihood (DESC NULLS LAST). Default: newest first.
      sortBy: z.enum(["time", "ntfScore"]).optional(),
      // doc 64 IA-10 S3 (DEP-S3) — trục phạm vi gửi ID; server resolve id→CODE rồi
      // tái dùng đường lọc theo code sẵn có. CODE tường minh (gõ tay) luôn THẮNG id.
      factoryId: z.number().int().positive().optional(),
      lineId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const { factoryId, lineId, machineId, ...codeInput } = input;
      // Resolve id→code (chỉ khi code tương ứng chưa được truyền — code thắng id).
      if (factoryId !== undefined || lineId !== undefined || machineId !== undefined) {
        const { getDb } = await import("../db/connection");
        const { machines, productionLines, factories } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const dbc = await getDb();
        if (dbc) {
          if (machineId !== undefined && !codeInput.machineCode) {
            const [m] = await dbc.select({ code: machines.code }).from(machines).where(eq(machines.id, machineId)).limit(1);
            if (m?.code) codeInput.machineCode = m.code;
          }
          if (lineId !== undefined && !codeInput.lineCode) {
            const [l] = await dbc.select({ code: productionLines.code }).from(productionLines).where(eq(productionLines.id, lineId)).limit(1);
            if (l?.code) codeInput.lineCode = l.code;
          }
          if (factoryId !== undefined && !codeInput.factoryCode) {
            const [f] = await dbc.select({ code: factories.code }).from(factories).where(eq(factories.id, factoryId)).limit(1);
            if (f?.code) codeInput.factoryCode = f.code;
          }
        }
      }
      return db.searchInspections({ ...codeInput, userId: ctx.user.id, userRole: ctx.user.role });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const inspection = await db.getProductInspectionById(input.id);
      if (!inspection) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'inspection' }, 'Inspection not found');
      }
      
      const measurements = await db.getMeasurementResultsByInspection(input.id);
      const machine = await db.getMachineById(inspection.machineId);
      
      return { inspection, measurements, machine };
    }),

  confirmNTF: qualityProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const inspection = await db.getProductInspectionById(input.id);
      if (!inspection) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'inspection' }, 'Inspection not found');
      }
      if (inspection.originalResult !== 'NG') {
        throw appError('BAD_REQUEST', 'OPERATION_FAILED', { operation: 'markInspectionNtf' }, 'Only NG results can be marked as NTF');
      }

      await db.updateProductInspectionNTF(input.id, ctx.user.id, input.reason);

      // W7-B (doc 27 V2) — harvest the human verdict as structured labels
      // (measurement_corrections + ai_label_queue feed). ADDITIVE + FAIL-OPEN:
      // the NTF confirm above already happened and is never blocked by harvest.
      try {
        const { harvestNtfConfirmation } = await import("../services/ai/measurementCorrectionsService");
        await harvestNtfConfirmation({
          inspectionId: input.id,
          machineId: inspection.machineId,
          operatorUserId: ctx.user.id,
          reason: input.reason,
          aiModelId: inspection.aiModelId ?? null,
        });
      } catch (err) {
        console.warn("[inspection.confirmNTF] correction harvest skipped (fail-open):", err instanceof Error ? err.message : err);
      }

      return { success: true };
    }),

  // Bulk acknowledge (doc 27 gap F1) — real disposition for History bulk action.
  // Idempotent (first acknowledger wins), audited, returns honest counts.
  bulkAcknowledge: protectedProcedure
    .input(z.object({
      ids: z.array(z.number().int().positive()).min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const ids = Array.from(new Set(input.ids));
      const { updatedIds, alreadyAcknowledgedIds } = await db.bulkAcknowledgeInspections({
        ids,
        userId: ctx.user.id,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "inspection.bulkAcknowledge",
        entityType: "inspection",
        details: {
          requestedCount: ids.length,
          acknowledgedCount: updatedIds.length,
          alreadyAcknowledgedCount: alreadyAcknowledgedIds.length,
          acknowledgedIds: updatedIds,
        },
        status: "success",
      });

      return {
        success: true,
        acknowledgedCount: updatedIds.length,
        alreadyAcknowledgedCount: alreadyAcknowledgedIds.length,
        notFoundCount: ids.length - updatedIds.length - alreadyAcknowledgedIds.length,
      };
    }),

  // Cursor-based pagination for large datasets
  listCursor: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(500).optional(),
      direction: z.enum(['forward', 'backward']).optional(),
      machineId: z.number().optional(),
      serialNumber: z.string().optional(),
      productModel: z.string().optional(),
      result: z.enum(["OK", "NG", "NTF"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      return db.getProductInspectionsCursor({ ...input, userId: ctx.user.id, userRole: ctx.user.role });
    }),

  topNGPoints: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(50).optional(),
    }))
    .query(async ({ input, ctx }) => {
      return db.getTopNGMeasurementPoints({ ...input, userId: ctx.user.id, userRole: ctx.user.role });
    }),

  aiAnalysis: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      // Get daily statistics for analysis
      const stats = await db.getDailyStatistics({
        startDate: input.startDate,
        endDate: input.endDate,
      });

      if (!stats || stats.length < 3) {
        return {
          trendPrediction: null,
          anomalies: [],
          recommendations: [],
          summary: "Không đủ dữ liệu để phân tích (cần tối thiểu 3 ngày dữ liệu)",
        };
      }

      // Calculate yield rates
      const yieldRates = stats.map(s => {
        const total = s.okCount + s.ngCount + s.ntfCount;
        return {
          date: s.date,
          yieldRate: finalYield({ ok: s.okCount, ntf: s.ntfCount, total }),
          total,
          okCount: s.okCount,
          ngCount: s.ngCount,
          ntfCount: s.ntfCount,
        };
      });

      // Linear regression for trend prediction
      const n = yieldRates.length;
      const xMean = (n - 1) / 2;
      const yMean = yieldRates.reduce((sum, r) => sum + r.yieldRate, 0) / n;
      
      let numerator = 0;
      let denominator = 0;
      yieldRates.forEach((r, i) => {
        numerator += (i - xMean) * (r.yieldRate - yMean);
        denominator += (i - xMean) ** 2;
      });
      
      const slope = denominator !== 0 ? numerator / denominator : 0;
      const intercept = yMean - slope * xMean;

      // Predict next 7 days
      const predictions = [];
      for (let i = 1; i <= 7; i++) {
        const predictedYield = Math.max(0, Math.min(100, intercept + slope * (n + i - 1)));
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + i);
        predictions.push({
          date: futureDate.toISOString().split('T')[0],
          predictedYield: Math.round(predictedYield * 100) / 100,
        });
      }

      // Anomaly detection using Z-score
      const stdDev = Math.sqrt(
        yieldRates.reduce((sum, r) => sum + (r.yieldRate - yMean) ** 2, 0) / n
      );
      
      const anomalies = yieldRates
        .filter(r => {
          const zScore = stdDev > 0 ? Math.abs(r.yieldRate - yMean) / stdDev : 0;
          return zScore > 2; // More than 2 standard deviations
        })
        .map(r => ({
          date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
          yieldRate: r.yieldRate,
          deviation: r.yieldRate - yMean,
          type: r.yieldRate < yMean ? 'low' as const : 'high' as const,
          severity: Math.abs(r.yieldRate - yMean) / (stdDev || 1) > 3 ? 'critical' as const : 'warning' as const,
        }));

      // Generate recommendations
      const recommendations: string[] = [];
      const currentYield = yieldRates[yieldRates.length - 1]?.yieldRate || 0;
      const avgYield = yMean;

      if (slope < -0.5) {
        recommendations.push("⚠️ Xu hướng giảm: Yield Rate đang giảm dần. Cần kiểm tra quy trình sản xuất và chất lượng nguyên liệu.");
      } else if (slope > 0.5) {
        recommendations.push("✅ Xu hướng tăng: Yield Rate đang cải thiện. Tiếp tục duy trì các biện pháp hiện tại.");
      }

      if (currentYield < 90) {
        recommendations.push("🚨 Yield Rate hiện tại dưới 90%. Cần hành động ngay để cải thiện chất lượng.");
      } else if (currentYield < 95) {
        recommendations.push("🔶 Yield Rate hiện tại dưới 95%. Xem xét các điểm đo lỗi nhiều nhất để cải thiện.");
      }

      if (anomalies.length > 0) {
        recommendations.push(`🔍 Phát hiện ${anomalies.length} ngày bất thường. Kiểm tra lại dữ liệu và điều kiện sản xuất trong những ngày này.`);
      }

      if (stdDev > 5) {
        recommendations.push("📉 Độ biến động cao: Yield Rate không ổn định. Cần chuẩn hóa quy trình sản xuất.");
      }

      return {
        trendPrediction: {
          slope: Math.round(slope * 1000) / 1000,
          trend: slope > 0.5 ? 'increasing' : slope < -0.5 ? 'decreasing' : 'stable',
          predictions,
          confidence: Math.min(100, Math.max(0, 100 - stdDev * 5)),
        },
        anomalies,
        recommendations,
        summary: `Phân tích ${n} ngày dữ liệu. Yield Rate trung bình: ${avgYield.toFixed(1)}%, Độ lệch chuẩn: ${stdDev.toFixed(2)}%`,
        statistics: {
          mean: avgYield,
          stdDev,
          min: Math.min(...yieldRates.map(r => r.yieldRate)),
          max: Math.max(...yieldRates.map(r => r.yieldRate)),
          current: currentYield,
        },
      };
    }),

  defectPatternClusters: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(20).optional(),
    }))
    .query(async ({ input }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return [];

      const { measurementResults } = await import("../../drizzle/schema/inspection");
      const { measurementPointDefs, productModels } = await import("../../drizzle/schema/product");
      const { productInspections } = await import("../../drizzle/schema/inspection");
      const { sql, eq, and, gte, lte, desc } = await import("drizzle-orm");

      const conditions: any[] = [eq(measurementResults.result, "NG")];
      if (input.startDate) {
        conditions.push(gte(productInspections.inspectionTime, input.startDate));
      }
      if (input.endDate) {
        conditions.push(lte(productInspections.inspectionTime, input.endDate));
      }

      const limit = input.limit ?? 10;

      // Group NG measurement results by point definition to find defect clusters
      const clusters = await dbInstance
        .select({
          pointDefId: measurementResults.pointDefId,
          pointCode: measurementPointDefs.code,
          pointName: measurementPointDefs.name,
          productModelId: measurementPointDefs.productModelId,
          productCode: productModels.code,
          productName: productModels.name,
          measurementType: measurementPointDefs.measurementType,
          ngCount: sql<number>`count(*)::int`.as("ngCount"),
          distinctInspections: sql<number>`count(distinct ${measurementResults.inspectionId})::int`.as("distinctInspections"),
        })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
        .leftJoin(productModels, eq(measurementPointDefs.productModelId, productModels.id))
        .where(and(...conditions))
        .groupBy(
          measurementResults.pointDefId,
          measurementPointDefs.code,
          measurementPointDefs.name,
          measurementPointDefs.productModelId,
          productModels.code,
          productModels.name,
          measurementPointDefs.measurementType,
        )
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      // Group clusters by measurement type to form pattern groups
      const typeGroups = new Map<string, typeof clusters>();
      for (const c of clusters) {
        const key = c.measurementType ?? "unknown";
        if (!typeGroups.has(key)) typeGroups.set(key, []);
        typeGroups.get(key)!.push(c);
      }

      const patterns = Array.from(typeGroups.entries()).map(([type, points]) => ({
        clusterName: type === "visual" ? "Lỗi ngoại quan (Visual)"
          : type === "dimension" ? "Lỗi k�ch thước (Dimension)"
          : type === "electrical" ? "Lỗi điện (Electrical)"
          : `Lỗi ${type}`,
        type,
        totalNG: points.reduce((s, p) => s + p.ngCount, 0),
        affectedInspections: points.reduce((s, p) => s + p.distinctInspections, 0),
        topPoints: points.slice(0, 5).map(p => ({
          pointDefId: p.pointDefId,
          code: p.pointCode,
          name: p.pointName,
          ngCount: p.ngCount,
          productModelId: p.productModelId,
          productCode: p.productCode,
          productName: p.productName,
        })),
      }));

      return patterns;
    }),

  gallery: protectedProcedure
    .input(z.object({
      factoryCode: z.string().optional(),
      workshopCode: z.string().optional(),
      lineCode: z.string().optional(),
      stationCode: z.string().optional(),
      machineCode: z.string().optional(),
      serialNumber: z.string().optional(),
      productModel: z.string().optional(),
      result: z.enum(["OK", "NG", "NTF"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(500).optional(),
      offset: z.number().min(0).optional(),
    }))
    .query(async ({ input, ctx }) => {
      return db.getGalleryImages({ ...input, userId: ctx.user.id, userRole: ctx.user.role });
    }),
});

// ============ MEASUREMENT RESULT ROUTER ============
export const measurementResultRouter = router({
  getByInspection: protectedProcedure
    .input(z.object({ inspectionId: z.number() }))
    .query(async ({ input }) => {
      return db.getMeasurementResultsByInspection(input.inspectionId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const result = await db.getMeasurementResultById(input.id);
      if (!result) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'measurementResult' }, 'Measurement result not found');
      }
      
      // Get point definition for reference image
      const { measurementPointDefs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      if (dbInstance) {
        const pointDef = await dbInstance.select().from(measurementPointDefs)
          .where(eq(measurementPointDefs.id, result.pointDefId)).limit(1);
        return { result, pointDef: pointDef[0] };
      }
      
      return { result, pointDef: null };
    }),

  updateRemark: protectedProcedure
    .input(z.object({
      id: z.number(),
      remark: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.updateMeasurementResultRemark(input.id, input.remark);
      return { success: true };
    }),

  analyzeWithAI: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const result = await db.getMeasurementResultById(input.id);
      // Review cuối — ghi sổ trước: `!result || !result.imageUrl` gộp hai tình huống
      // khác nhau (kết quả đo không tồn tại vs. kết quả CÓ nhưng không có ảnh) vào MỘT
      // câu chỉ nói về ảnh. Tách để entity đúng với điều kiện thật đã xảy ra.
      if (!result) {
        throw appError('BAD_REQUEST', 'ENTITY_NOT_FOUND', { entity: 'measurementResult' }, 'Measurement result not found');
      }
      if (!result.imageUrl) {
        throw appError('BAD_REQUEST', 'ENTITY_NOT_FOUND', { entity: 'image' }, 'No image available for analysis');
      }

      // Get point definition for context
      const { measurementPointDefs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      let pointDef = null;
      if (dbInstance) {
        const pointDefResult = await dbInstance.select().from(measurementPointDefs)
          .where(eq(measurementPointDefs.id, result.pointDefId)).limit(1);
        pointDef = pointDefResult[0];
      }

      const prompt = `Analyze this inspection image from an AVI/AOI machine.
${pointDef ? `Measurement point: ${pointDef.name} (${pointDef.measurementType})
${pointDef.description ? `Description: ${pointDef.description}` : ''}` : ''}

Please analyze the image and provide:
1. Overall quality assessment (OK/NG)
2. Detected defects or issues (if any)
3. Confidence level (0-100%)
4. Recommendations

Respond in JSON format:
{
  "assessment": "OK" or "NG",
  "defects": ["list of detected defects"],
  "confidence": 85,
  "recommendations": "your recommendations"
}`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are an expert quality inspection AI for manufacturing. Analyze inspection images and provide detailed assessments." },
            { 
              role: "user", 
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: result.imageUrl, detail: "high" } }
              ]
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "inspection_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  assessment: { type: "string", enum: ["OK", "NG"] },
                  defects: { type: "array", items: { type: "string" } },
                  confidence: { type: "number" },
                  recommendations: { type: "string" }
                },
                required: ["assessment", "defects", "confidence", "recommendations"],
                additionalProperties: false
              }
            }
          }
        });

        const messageContent = response.choices[0].message.content;
        const contentStr = typeof messageContent === 'string'
          ? messageContent
          : Array.isArray(messageContent)
            ? (messageContent.find((c: { type: string; text?: string }) => c.type === 'text') as { type: string; text?: string } | undefined)?.text || '{}'
            : '{}';
        const analysisResult = JSON.parse(contentStr);

        // Update the measurement result with AI analysis.
        // Re-running is allowed (V24) — a second analyze simply overwrites; the
        // client asks for confirm-overwrite before calling again.
        const { measurementResults } = await import("../../drizzle/schema");
        if (dbInstance) {
          await dbInstance.update(measurementResults).set({
            aiAnalysisResult: JSON.stringify(analysisResult),
            aiConfidence: String(analysisResult.confidence / 100)
          }).where(eq(measurementResults.id, input.id));
        }

        // W7-C (doc 27 V9) — PRODUCER for AISuggestionsPanel: the VLM verdict also
        // lands in ai_suggestions (same shape aiFeedback.createSuggestion writes),
        // so the panel fills, feedback buttons work, and the correction/training
        // export gains a source. Direct db insert — the orphan endpoint stays unused.
        // Best-effort: a suggestion-write failure must not fail the analysis itself.
        try {
          if (dbInstance) {
            const { aiSuggestions } = await import("../../drizzle/schema");
            const confidence01 = Math.max(0, Math.min(1, (Number(analysisResult.confidence) || 0) / 100));
            const defects: string[] = Array.isArray(analysisResult.defects)
              ? analysisResult.defects.map((d: unknown) => String(d)).filter(Boolean)
              : [];
            const suggestionText = analysisResult.assessment === "NG"
              ? (defects.length > 0 ? `NG — ${defects.join("; ")}` : "NG — defect detected (unspecified)")
              : "OK — no defect detected by VLM analysis";
            await dbInstance.insert(aiSuggestions).values({
              inspectionId: result.inspectionId,
              measurementResultId: input.id,
              // NG verdicts are defect classifications; OK verdicts are quality predictions.
              suggestionType: analysisResult.assessment === "NG" ? "DEFECT_CLASSIFICATION" : "QUALITY_PREDICTION",
              suggestion: suggestionText,
              confidence: confidence01.toFixed(4),
              reasoning: typeof analysisResult.recommendations === "string" && analysisResult.recommendations.length > 0
                ? analysisResult.recommendations
                : null,
              modelVersion: "1.0.0",
              modelName: "vlm-inspection-analyze",
              status: "PENDING",
            });
          }
        } catch (suggestionErr) {
          console.warn("[analyzeWithAI] ai_suggestions write failed (non-fatal):", suggestionErr);
        }

        return { ...analysisResult, degraded: false as const };
      } catch (error) {
        // W7-C (doc 27 V24) — HONEST fallback instead of a hard
        // INTERNAL_SERVER_ERROR: surface the provider's degradation reason so the
        // UI can tell the user AI vision is unavailable. Nothing is written to the
        // measurement (no fake result), so the analyze button stays actionable.
        console.error("AI analysis error:", error);
        const reason = error instanceof Error ? error.message : String(error);
        return {
          degraded: true as const,
          assessment: null,
          defects: [] as string[],
          confidence: 0,
          recommendations: "",
          message: `Phân tích AI không khả dụng: ${reason}`,
        };
      }
    }),

  // Batch operations for history.
  // NOTE: legacy namespace — despite living under measurementResult, this
  // acknowledges product_inspections rows (ids are inspection ids as strings).
  // Delegates to the same idempotent + audited path as inspection.bulkAcknowledge.
  batchAcknowledge: protectedProcedure
    .input(z.object({
      ids: z.array(z.string().regex(/^\d+$/)).min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const ids = Array.from(new Set(input.ids.map((id) => parseInt(id, 10))));
      const { updatedIds, alreadyAcknowledgedIds } = await db.bulkAcknowledgeInspections({
        ids,
        userId: ctx.user.id,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "inspection.bulkAcknowledge",
        entityType: "inspection",
        details: {
          requestedCount: ids.length,
          acknowledgedCount: updatedIds.length,
          alreadyAcknowledgedCount: alreadyAcknowledgedIds.length,
          acknowledgedIds: updatedIds,
        },
        status: "success",
      });

      return { success: true, count: updatedIds.length };
    }),

  batchAddNote: protectedProcedure
    .input(z.object({
      ids: z.array(z.string()),
      note: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const { productInspections } = await import("../../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      
      if (!dbInstance) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      const timestamp = new Date().toISOString();
      const noteEntry = `[${timestamp}] ${ctx.user.name}: ${input.note}`;

      // For each inspection, append the note
      for (const id of input.ids) {
        const inspection = await db.getProductInspectionById(parseInt(id));
        if (inspection) {
          const existingNotes = inspection.notes || '';
          const newNotes = existingNotes ? `${existingNotes}\n${noteEntry}` : noteEntry;
          await dbInstance.update(productInspections).set({
            notes: newNotes,
          }).where(inArray(productInspections.id, [parseInt(id)]));
        }
      }

      return { success: true, count: input.ids.length };
    }),

  batchAddTag: protectedProcedure
    .input(z.object({
      ids: z.array(z.string()),
      tag: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const { productInspections } = await import("../../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      
      if (!dbInstance) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      // For each inspection, add the tag
      for (const id of input.ids) {
        const inspection = await db.getProductInspectionById(parseInt(id));
        if (inspection) {
          const existingTags = inspection.tags ? JSON.parse(inspection.tags) : [];
          if (!existingTags.includes(input.tag)) {
            existingTags.push(input.tag);
            await dbInstance.update(productInspections).set({
              tags: JSON.stringify(existingTags),
            }).where(inArray(productInspections.id, [parseInt(id)]));
          }
        }
      }

      return { success: true, count: input.ids.length };
    }),

  batchArchive: protectedProcedure
    .input(z.object({
      ids: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      const { productInspections } = await import("../../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      
      if (!dbInstance) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      await dbInstance.update(productInspections).set({
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: ctx.user.id,
      }).where(inArray(productInspections.id, input.ids.map(id => parseInt(id))));

      return { success: true, count: input.ids.length };
    }),

  correctResult: qualityProcedure
    .input(z.object({
      id: z.number(),
      result: z.enum(["OK", "NG", "NTF"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { measurementResults, productInspections } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      
      if (!dbInstance) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      // Get the measurement result
      const result = await db.getMeasurementResultById(input.id);
      if (!result) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'measurementResult' }, 'Measurement result not found');
      }
      // W7-B (doc 27 V2): capture the pre-update verdict for the harvest below.
      const originalResult = result.result;

      // Update the measurement result
      // ★★★ Pha 1F Task 5 (BG-82 ⛔, review lượt 7 C-1) — NGƯỜI vừa xác lập
      // phán quyết cho dòng này một cách TƯỜNG MINH, nên nó không còn là
      // "máy không khai" nữa: ghi ntf/ntfSource='human' khi giá trị mới là
      // NTF, và xoá (null) khi không phải — đối xứng với cách ingest ghi
      // 'machine' (aoiPackageRouter.ts, hàm buildRecord). KHÔNG ghi lại tín
      // hiệu này ở đây thì một dòng người vừa sửa thành NTF sẽ bị CHÍNH lỗ
      // BG-82 loại khỏi header ở một lượt correctResult SAU, trên một điểm
      // KHÁC của cùng bo — tái phát đúng lỗ vừa vá.
      await dbInstance.update(measurementResults).set({
        result: input.result,
        ntf: input.result === "NTF",
        ntfSource: input.result === "NTF" ? "human" : null,
        remark: input.reason ? `[Corrected by ${ctx.user.name}] ${input.reason}` : result.remark,
      }).where(eq(measurementResults.id, input.id));

      // Recalculate overall inspection result — đọc lại TOÀN BỘ dòng đo (dòng
      // vừa UPDATE ở trên đã phản ánh giá trị MỚI vì SELECT chạy SAU UPDATE).
      // Một lượt duyệt DUY NHẤT tính đồng thời hasNG/hasNTF/nguồn NTF — tránh
      // hai công thức "dòng này có phải NTF thật không" lệch nhau.
      const allResults = await db.getMeasurementResultsByInspection(result.inspectionId);
      let hasNG = false;
      let ntfCoMay = false;
      let ntfCoNguoi = false;
      for (const r of allResults) {
        const laDongDangSua = r.id === input.id;
        const ketQuaHienTai = laDongDangSua ? input.result : r.result;
        if (ketQuaHienTai === "NG") hasNG = true;
        if (ketQuaHienTai !== "NTF") continue;
        // BG-82 ⛔ — TRƯỚC bản vá, dòng này tự động tính là NTF THẬT chỉ vì cột
        // `result` đọc ra "NTF". Nhưng `measurement_results.result` là NOT
        // NULL nên một lá máy KHÔNG hề khai phán quyết (manifest ảnh thuần,
        // xem `metaJsonSchema` — `result` `.optional()` ở CẢ HAI nhánh) cũng
        // bị ép ghi "NTF" tại `aoiPackageRouter.ts` (buildRecord). Hệ quả đo
        // được (review lượt 7): sửa MỘT điểm KHÁC thành OK ⇒ các lá "bị ép
        // NTF" còn lại (chưa ai đụng tới) vẫn đọc `result==="NTF"` ⇒ header bị
        // lật OK→NTF — một thao tác chất lượng BÌNH THƯỜNG làm hồ sơ XẤU ĐI,
        // ghi vào bảng WORM (`product_inspections`). SAU bản vá: chỉ tính là
        // NTF khi có NGUỒN thật (`ntfSource !== null` — 'machine' từ ingest
        // hoặc 'human' từ chính lượt sửa này/một lượt correctResult trước đó).
        const nguon = laDongDangSua ? "human" : r.ntfSource;
        if (nguon === null || nguon === undefined) continue; // NTF BỊ ÉP — không tính
        if (nguon === "machine" || nguon === "both") ntfCoMay = true;
        if (nguon === "human" || nguon === "both") ntfCoNguoi = true;
      }
      const hasNTF = ntfCoMay || ntfCoNguoi;

      let overallResult: "OK" | "NG" | "NTF" = "OK";
      if (hasNG) overallResult = "NG";
      else if (hasNTF) overallResult = "NTF";

      // BG-82 — mở rộng bất biến BG-41 (db/inspection.ts:805) sang
      // correctResult: header NTF PHẢI có nguồn (machine/human/both), KHÔNG
      // BAO GIỜ để NULL (mệnh đề 4). Tính lại TỪ ĐẦU theo trạng thái CÁC DÒNG
      // hiện tại — không cộng dồn CASE như `updateProductInspectionNTF` (hàm
      // đó CHỈ đi một chiều luôn-hoá-NTF; `correctResult` có thể đổi header
      // sang bất kỳ verdict nào, kể cả rời khỏi NTF, nên phải XOÁ nguồn cũ khi
      // không còn NTF thay vì để nó đứng lại lỗi thời).
      const ntfSource: "machine" | "human" | "both" | null =
        overallResult !== "NTF" ? null
        : ntfCoMay && ntfCoNguoi ? "both"
        : ntfCoMay ? "machine"
        : "human";

      await dbInstance.update(productInspections).set({
        overallResult,
        ntfSource,
      }).where(eq(productInspections.id, result.inspectionId));

      // W7-B (doc 27 V2) — harvest the correction as a structured label
      // (measurement_corrections ledger + ai_label_queue feed). ADDITIVE +
      // FAIL-OPEN: everything above (the original behaviour) already happened
      // and is never blocked/reverted by harvest problems.
      if (originalResult !== input.result) {
        try {
          const inspection = await db.getProductInspectionById(result.inspectionId);
          if (inspection) {
            const { recordCorrection } = await import("../services/ai/measurementCorrectionsService");
            await recordCorrection({
              measurementResultId: result.id,
              inspectionId: result.inspectionId,
              machineId: inspection.machineId,
              pointDefId: result.pointDefId,
              originalResult,
              correctedResult: input.result,
              reason: input.reason ?? null,
              operatorUserId: ctx.user.id,
              imageKey: result.imageKey,
              imageUrl: result.imageUrl,
              source: "correct_result",
              aiModelId: inspection.aiModelId ?? null,
            });
          }
        } catch (err) {
          console.warn("[measurementResult.correctResult] correction harvest skipped (fail-open):", err instanceof Error ? err.message : err);
        }
      }

      return { success: true, newOverallResult: overallResult };
    }),

  // Classify an NG measurement result with an IPC-A-610 defect code.
  // Sets measurement_results.defectCatalogId (+ denormalised severity) — the
  // canonical NG→defect-code link, shared by BOTH ingest paths (direct API and
  // AOI ZIP package) since both write into measurement_results.
  // Pass defectCatalogId=null to clear an existing classification.
  classifyDefect: qualityProcedure
    .input(z.object({
      id: z.number().int().positive(),
      defectCatalogId: z.number().int().positive().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { measurementResults } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const dbInstance = await db.getDb();

      if (!dbInstance) {
        throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      }

      const result = await db.getMeasurementResultById(input.id);
      if (!result) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'measurementResult' }, 'Measurement result not found');
      }

      // Only NG (or NTF) results should carry a defect classification.
      if (input.defectCatalogId !== null && result.result === "OK") {
        throw appError('BAD_REQUEST', 'OPERATION_FAILED', { operation: 'classifyDefect' }, 'Only NG results can be classified with a defect code');
      }

      // Resolve & validate the catalog entry; pull severity to denormalise.
      let defectSeverity: string | null = null;
      let defectCode: string | undefined;
      if (input.defectCatalogId !== null) {
        const entry = await db.getDefectCatalogById(input.defectCatalogId);
        if (!entry) {
          throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'defectCatalogCode' }, 'Defect catalog code not found');
        }
        defectSeverity = entry.severity ?? null;
        defectCode = entry.code;
      }

      await dbInstance.update(measurementResults).set({
        defectCatalogId: input.defectCatalogId,
        defectSeverity,
      }).where(eq(measurementResults.id, input.id));

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: input.defectCatalogId === null ? "measurementResult.clearDefect" : "measurementResult.classifyDefect",
        entityType: "inspection",
        entityId: input.id,
        entityName: defectCode,
        details: { defectCatalogId: input.defectCatalogId, defectSeverity, inspectionId: result.inspectionId },
        status: "success",
      });

      return { success: true, defectCatalogId: input.defectCatalogId, defectSeverity };
    }),

  // Measurement point statistics by product with date range
  measurementPointStats: protectedProcedure
    .input(z.object({
      productModelId: z.number(),
      startDate: z.date(),
      endDate: z.date(),
    }))
    .query(async ({ input, ctx }) => {
      const productModel = await db.getProductModelById(input.productModelId);
      if (!productModel) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'productModel' }, 'Product model not found');
      }
      const stats = await db.getMeasurementPointStatsByProduct({
        productModelId: input.productModelId,
        startDate: input.startDate,
        endDate: input.endDate,
        userId: ctx.user.id,
        userRole: ctx.user.role,
      });
      return {
        productModel: { id: productModel.id, code: productModel.code, name: productModel.name },
        startDate: input.startDate,
        endDate: input.endDate,
        points: stats,
      };
    }),

});
