import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { invokeLLM } from "../_core/llm";

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
    }))
    .query(async ({ input, ctx }) => {
      return db.searchInspections({ ...input, userId: ctx.user.id, userRole: ctx.user.role });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const inspection = await db.getProductInspectionById(input.id);
      if (!inspection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inspection not found' });
      }
      
      const measurements = await db.getMeasurementResultsByInspection(input.id);
      const machine = await db.getMachineById(inspection.machineId);
      
      return { inspection, measurements, machine };
    }),

  confirmNTF: protectedProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const inspection = await db.getProductInspectionById(input.id);
      if (!inspection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inspection not found' });
      }
      if (inspection.originalResult !== 'NG') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only NG results can be marked as NTF' });
      }
      
      await db.updateProductInspectionNTF(input.id, ctx.user.id, input.reason);
      return { success: true };
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
          summary: "KhÃ´ng Ä‘á»§ dá»¯ liá»‡u Ä‘á»ƒ phÃ¢n tÃ­ch (cáº§n tá»‘i thiá»ƒu 3 ngÃ y dá»¯ liá»‡u)",
        };
      }

      // Calculate yield rates
      const yieldRates = stats.map(s => {
        const total = s.okCount + s.ngCount + s.ntfCount;
        return {
          date: s.date,
          yieldRate: total > 0 ? ((s.okCount + s.ntfCount) / total * 100) : 0,
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
        recommendations.push("âš ï¸ Xu hÆ°á»›ng giáº£m: Yield Rate Ä‘ang giáº£m dáº§n. Cáº§n kiá»ƒm tra quy trÃ¬nh sáº£n xuáº¥t vÃ  cháº¥t lÆ°á»£ng nguyÃªn liá»‡u.");
      } else if (slope > 0.5) {
        recommendations.push("âœ… Xu hÆ°á»›ng tÄƒng: Yield Rate Ä‘ang cáº£i thiá»‡n. Tiáº¿p tá»¥c duy trÃ¬ cÃ¡c biá»‡n phÃ¡p hiá»‡n táº¡i.");
      }

      if (currentYield < 90) {
        recommendations.push("ðŸš¨ Yield Rate hiá»‡n táº¡i dÆ°á»›i 90%. Cáº§n hÃ nh Ä‘á»™ng ngay Ä‘á»ƒ cáº£i thiá»‡n cháº¥t lÆ°á»£ng.");
      } else if (currentYield < 95) {
        recommendations.push("ðŸ”¶ Yield Rate hiá»‡n táº¡i dÆ°á»›i 95%. Xem xÃ©t cÃ¡c Ä‘iá»ƒm Ä‘o lá»—i nhiá»u nháº¥t Ä‘á»ƒ cáº£i thiá»‡n.");
      }

      if (anomalies.length > 0) {
        recommendations.push(`ðŸ” PhÃ¡t hiá»‡n ${anomalies.length} ngÃ y báº¥t thÆ°á»ng. Kiá»ƒm tra láº¡i dá»¯ liá»‡u vÃ  Ä‘iá»u kiá»‡n sáº£n xuáº¥t trong nhá»¯ng ngÃ y nÃ y.`);
      }

      if (stdDev > 5) {
        recommendations.push("ðŸ“‰ Äá»™ biáº¿n Ä‘á»™ng cao: Yield Rate khÃ´ng á»•n Ä‘á»‹nh. Cáº§n chuáº©n hÃ³a quy trÃ¬nh sáº£n xuáº¥t.");
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
        summary: `PhÃ¢n tÃ­ch ${n} ngÃ y dá»¯ liá»‡u. Yield Rate trung bÃ¬nh: ${avgYield.toFixed(1)}%, Äá»™ lá»‡ch chuáº©n: ${stdDev.toFixed(2)}%`,
        statistics: {
          mean: avgYield,
          stdDev,
          min: Math.min(...yieldRates.map(r => r.yieldRate)),
          max: Math.max(...yieldRates.map(r => r.yieldRate)),
          current: currentYield,
        },
      };
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
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement result not found' });
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
      if (!result || !result.imageUrl) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No image available for analysis' });
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
        
        // Update the measurement result with AI analysis
        const { measurementResults } = await import("../../drizzle/schema");
        if (dbInstance) {
          await dbInstance.update(measurementResults).set({
            aiAnalysisResult: JSON.stringify(analysisResult),
            aiConfidence: String(analysisResult.confidence / 100)
          }).where(eq(measurementResults.id, input.id));
        }

        return analysisResult;
      } catch (error) {
        console.error("AI analysis error:", error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI analysis failed' });
      }
    }),

  // Batch operations for history
  batchAcknowledge: protectedProcedure
    .input(z.object({
      ids: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      const { productInspections } = await import("../../drizzle/schema");
      const { inArray } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      
      if (!dbInstance) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      }

      // Update acknowledged status for all selected inspections
      await dbInstance.update(productInspections).set({
        acknowledgedBy: ctx.user.id,
        acknowledgedAt: new Date(),
      }).where(inArray(productInspections.id, input.ids.map(id => parseInt(id))));

      return { success: true, count: input.ids.length };
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      }

      await dbInstance.update(productInspections).set({
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: ctx.user.id,
      }).where(inArray(productInspections.id, input.ids.map(id => parseInt(id))));

      return { success: true, count: input.ids.length };
    }),

  correctResult: protectedProcedure
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      }

      // Get the measurement result
      const result = await db.getMeasurementResultById(input.id);
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement result not found' });
      }

      // Update the measurement result
      await dbInstance.update(measurementResults).set({
        result: input.result,
        remark: input.reason ? `[Corrected by ${ctx.user.name}] ${input.reason}` : result.remark,
      }).where(eq(measurementResults.id, input.id));

      // Recalculate overall inspection result
      const allResults = await db.getMeasurementResultsByInspection(result.inspectionId);
      const hasNG = allResults.some(r => r.id === input.id ? input.result === "NG" : r.result === "NG");
      const hasNTF = allResults.some(r => r.id === input.id ? input.result === "NTF" : r.result === "NTF");
      
      let overallResult: "OK" | "NG" | "NTF" = "OK";
      if (hasNG) overallResult = "NG";
      else if (hasNTF) overallResult = "NTF";

      await dbInstance.update(productInspections).set({
        overallResult,
      }).where(eq(productInspections.id, result.inspectionId));

      return { success: true, newOverallResult: overallResult };
    }),
});
