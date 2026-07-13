import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { requirePermission } from "../_core/accessControl";
import * as db from "../db";
import * as cachedStats from "../functions/cachedStatistics";
import { MACHINE_TYPES } from "../constants/machineTypes";
import { resolveThresholdEditGate } from "../services/thresholdGovernanceService";

export const importRouter = router({  
  importFactories: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        address: z.string().optional(),
        region: z.string().optional(),
        country: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
      replaceIfExists: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          const existing = await db.getFactoryByCode(item.code);
          if (existing) {
            if (input.replaceIfExists) {
              await db.updateFactory(existing.id, item);
              results.success++;
            } else {
              throw new Error('Factory code already exists');
            }
          } else {
            await db.createFactory(item);
            results.success++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importWorkshops: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        factoryCode: z.string(),
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
      replaceIfExists: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          const factory = await db.getFactoryByCode(item.factoryCode);
          if (!factory) {
            throw new Error(`Factory ${item.factoryCode} not found`);
          }
          
          const existing = await db.getWorkshopByCode(item.code);
          if (existing) {
            if (input.replaceIfExists) {
              await db.updateWorkshop(existing.id, {
                factoryId: factory.id,
                name: item.name,
                description: item.description,
                isActive: item.isActive ?? true,
              });
              results.success++;
            } else {
              throw new Error('Workshop code already exists');
            }
          } else {
            await db.createWorkshop({
              factoryId: factory.id,
              code: item.code,
              name: item.name,
              description: item.description,
              isActive: item.isActive ?? true,
            });
            results.success++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importMachines: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        stationCode: z.string(),
        code: z.string(),
        name: z.string(),
        machineType: z.enum(MACHINE_TYPES),
        model: z.string().optional(),
        manufacturer: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
      replaceIfExists: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          const station = await db.getStationByCode(item.stationCode);
          if (!station) {
            throw new Error(`Station ${item.stationCode} not found`);
          }
          
          const existing = await db.getMachineByCode(item.code);
          if (existing) {
            if (input.replaceIfExists) {
              await db.updateMachine(existing.id, {
                stationId: station.id,
                name: item.name,
                machineType: item.machineType,
                model: item.model,
                manufacturer: item.manufacturer,
                isActive: item.isActive ?? true,
              });
              results.success++;
            } else {
              throw new Error('Machine code already exists');
            }
          } else {
            const crypto = await import('crypto');
            const apiKey = crypto.randomBytes(32).toString('hex');
            
            await db.createMachine({
              stationId: station.id,
              code: item.code,
              name: item.name,
              machineType: item.machineType,
              model: item.model,
              manufacturer: item.manufacturer,
              apiKey,
              isActive: item.isActive ?? true,
            });
            results.success++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importProducts: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        category: z.string().optional(),
        version: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
      replaceIfExists: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          const existing = await db.getProductModelByCode(item.code);
          if (existing) {
            if (input.replaceIfExists) {
              await db.updateProductModel(existing.id, {
                name: item.name,
                description: item.description,
                category: item.category,
                isActive: item.isActive ?? true,
              });
              results.success++;
            } else {
              throw new Error('Product code already exists');
            }
          } else {
            await db.createProductModel({
              code: item.code,
              name: item.name,
              description: item.description,
              category: item.category,
              isActive: item.isActive ?? true,
            });
            results.success++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importMeasurementPoints: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        productModelCode: z.string(),
        code: z.string(),
        name: z.string(),
        measurementType: z.enum(['DIMENSION', 'VISUAL', 'ELECTRICAL', 'POSITION', 'COLOR', 'SURFACE', 'OTHER']),
        unit: z.string().optional(),
        nominalValue: z.number().optional(),
        upperLimit: z.number().optional(),
        lowerLimit: z.number().optional(),
        isActive: z.boolean().optional(),
      })),
      replaceIfExists: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      // Doc 31 B.6 — `skipped` counts points whose limit change was blocked by the
      // lifecycle gate (live product → approval queue). Additive to the response.
      const results = { success: 0, failed: 0, skipped: 0, errors: [] as string[] };

      for (const item of input.data) {
        try {
          const productModel = await db.getProductModelByCode(item.productModelCode);
          if (!productModel) {
            throw new Error(`Product model ${item.productModelCode} not found`);
          }

          const existing = await db.getMeasurementPointDefByCode(productModel.id, item.code);
          if (existing) {
            if (input.replaceIfExists) {
              // Doc 31 B.6 — a bulk import overwriting the limits of an EXISTING point
              // is a direct limit-write and must respect the lifecycle gate (decision
              // #4). Bulk import normally happens at setup on `development` products;
              // on a live/released product the limit overwrite is BLOCKED (skipped
              // with a clear message) so approved limits aren't silently replaced.
              const touchesLimits =
                item.upperLimit !== undefined ||
                item.lowerLimit !== undefined ||
                item.nominalValue !== undefined;
              const gate = touchesLimits ? await resolveThresholdEditGate(existing.id) : null;
              if (gate && gate.decision === "requires_approval" && gate.enforced) {
                results.skipped++;
                results.errors.push(
                  `${item.code}: skipped — product ${gate.hasReleasedProgram ? "has a released program" : `is '${gate.lifecycleStatus}'`}; limit changes require approval (Threshold Approvals queue). / bị bỏ qua — thay đổi ngưỡng phải qua duyệt.`,
                );
                continue;
              }
              await db.updateMeasurementPointDef(existing.id, {
                name: item.name,
                measurementType: item.measurementType,
                unit: item.unit,
                nominalValue: item.nominalValue?.toString(),
                upperLimit: item.upperLimit?.toString(),
                lowerLimit: item.lowerLimit?.toString(),
                isActive: item.isActive ?? true,
              });
              // Audit the allowed direct limit edit (development products only).
              if (gate) {
                try {
                  await db.createAuditLog({
                    userId: (ctx as any)?.user?.id ?? null,
                    userName: (ctx as any)?.user?.name ?? undefined,
                    action: "threshold.directEdit",
                    entityType: "measurement_point_def",
                    entityId: existing.id,
                    entityName: existing.code ?? item.code,
                    details: {
                      source: "bulkImport.importMeasurementPoints",
                      productModelId: productModel.id,
                      lifecycleStatus: gate.lifecycleStatus,
                      gateDecision: gate.decision,
                      gateEnforced: gate.enforced,
                      hasReleasedProgram: gate.hasReleasedProgram,
                      before: {
                        lowerLimit: existing.lowerLimit ?? null,
                        upperLimit: existing.upperLimit ?? null,
                        nominalValue: existing.nominalValue ?? null,
                      },
                      after: {
                        lowerLimit: item.lowerLimit?.toString() ?? null,
                        upperLimit: item.upperLimit?.toString() ?? null,
                        nominalValue: item.nominalValue?.toString() ?? null,
                      },
                    },
                    status: "success",
                  });
                } catch {
                  /* audit is best-effort — never fail the import on an audit write */
                }
              }
              results.success++;
            } else {
              throw new Error('Measurement point code already exists');
            }
          } else {
            await db.createMeasurementPointDef({
              productModelId: productModel.id,
              code: item.code,
              name: item.name,
              measurementType: item.measurementType,
              unit: item.unit,
              nominalValue: item.nominalValue?.toString(),
              upperLimit: item.upperLimit?.toString(),
              lowerLimit: item.lowerLimit?.toString(),
              isActive: item.isActive ?? true,
              positionX: 0,
              positionY: 0,
              radius: 20,
            });
            results.success++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importLines: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        workshopCode: z.string(),
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        capacityPerHour: z.number().optional(),
        maxConcurrentOrders: z.number().optional(),
        isActive: z.boolean().optional(),
      })),
      replaceIfExists: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          const workshop = await db.getWorkshopByCode(item.workshopCode);
          if (!workshop) {
            throw new Error(`Workshop ${item.workshopCode} not found`);
          }
          
          const existing = await db.getProductionLineByCode(item.code);
          if (existing) {
            if (input.replaceIfExists) {
              await db.updateProductionLine(existing.id, {
                workshopId: workshop.id,
                name: item.name,
                description: item.description,
                capacityPerHour: item.capacityPerHour,
                maxConcurrentOrders: item.maxConcurrentOrders,
                isActive: item.isActive ?? true,
              });
              results.success++;
            } else {
              throw new Error('Line code already exists');
            }
          } else {
            await db.createProductionLine({
              workshopId: workshop.id,
              code: item.code,
              name: item.name,
              description: item.description,
              capacityPerHour: item.capacityPerHour,
              maxConcurrentOrders: item.maxConcurrentOrders,
              isActive: item.isActive ?? true,
            });
            results.success++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importStations: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        lineCode: z.string(),
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        orderIndex: z.number().optional(),
        isActive: z.boolean().optional(),
      })),
      replaceIfExists: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          const line = await db.getProductionLineByCode(item.lineCode);
          if (!line) {
            throw new Error(`Line ${item.lineCode} not found`);
          }
          
          const existing = await db.getStationByCode(item.code);
          if (existing) {
            if (input.replaceIfExists) {
              await db.updateStation(existing.id, {
                lineId: line.id,
                name: item.name,
                description: item.description,
                orderIndex: item.orderIndex ?? 0,
                isActive: item.isActive ?? true,
              });
              results.success++;
            } else {
              throw new Error('Station code already exists');
            }
          } else {
            await db.createStation({
              lineId: line.id,
              code: item.code,
              name: item.name,
              description: item.description,
              orderIndex: item.orderIndex ?? 0,
              isActive: item.isActive ?? true,
            });
            results.success++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importWorkstations: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        factoryCode: z.string().optional(),
        workshopCode: z.string().optional(),
        lineCode: z.string().optional(),
        processType: z.enum(['SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'OTHER']).optional(),
        orderIndex: z.number().optional(),
        isActive: z.boolean().optional(),
      })),
      replaceIfExists: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          let factoryId: number | undefined;
          let workshopId: number | undefined;
          let lineId: number | undefined;
          
          if (item.factoryCode) {
            const factory = await db.getFactoryByCode(item.factoryCode);
            if (!factory) throw new Error(`Factory ${item.factoryCode} not found`);
            factoryId = factory.id;
          }
          if (item.workshopCode) {
            const workshop = await db.getWorkshopByCode(item.workshopCode);
            if (!workshop) throw new Error(`Workshop ${item.workshopCode} not found`);
            workshopId = workshop.id;
          }
          if (item.lineCode) {
            const line = await db.getProductionLineByCode(item.lineCode);
            if (!line) throw new Error(`Line ${item.lineCode} not found`);
            lineId = line.id;
          }
          
          const existing = await db.getWorkstationByCode(item.code);
          if (existing) {
            if (input.replaceIfExists) {
              await db.updateWorkstation(existing.id, {
                name: item.name,
                description: item.description,
                factoryId,
                workshopId,
                lineId,
                processType: item.processType,
                orderIndex: item.orderIndex ?? 0,
                isActive: item.isActive ?? true,
              });
              results.success++;
            } else {
              throw new Error('Workstation code already exists');
            }
          } else {
            await db.createWorkstation({
              code: item.code,
              name: item.name,
              description: item.description,
              factoryId,
              workshopId,
              lineId,
              processType: item.processType,
              orderIndex: item.orderIndex ?? 0,
              isActive: item.isActive ?? true,
            });
            results.success++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),
});

export const exportRouter = router({
  // doc 46 FE-W2 — GENERIC font-safe report renderer. Reuses the canonical engine
  // (universalExportService.renderReport), which embeds BeVietnamPro for VN/Latin
  // and Noto Sans SC for Chinese (doc 48 R4), so vi/en/zh all render real glyphs —
  // unlike client-side jsPDF, which had no VN glyphs and stripped "Ngày xuất" →
  // "Ngay xuat" (and no CJK glyphs, tofuing Chinese). Session-auth (protectedProcedure): any
  // logged-in user renders their OWN already-displayed table data into a branded
  // PDF/XLSX/CSV in the language they pick. Row/col-capped to bound memory.
  renderReport: protectedProcedure
    .input(z.object({
      type: z.string().min(1).max(64).default("report"),
      title: z.string().min(1).max(200),
      subtitle: z.string().max(300).optional(),
      format: z.enum(["pdf", "xlsx", "csv"]),
      language: z.enum(["vi", "en", "zh"]).default("vi"),
      columns: z.array(z.object({
        key: z.string().min(1).max(64),
        header: z.string().max(120),
        width: z.number().int().positive().max(400).optional(),
        format: z.enum(["number", "percentage", "date", "datetime", "text"]).optional(),
      })).min(1).max(60),
      data: z.array(z.record(z.string(), z.any())).max(20000),
      fileName: z.string().max(120).optional(),
    }))
    .mutation(async ({ input }) => {
      const { renderReport } = await import("../services/universalExportService");
      const out = await renderReport({
        type: input.type,
        title: input.title,
        subtitle: input.subtitle,
        format: input.format,
        locale: input.language,
        columns: input.columns,
        data: input.data,
        fileName: input.fileName,
      });
      // base64 so the (superjson) tRPC transport carries the binary safely; the
      // client rebuilds a Blob and triggers a download.
      return {
        base64: out.buffer.toString("base64"),
        mimeType: out.mimeType,
        filename: out.filename,
        format: out.format,
      };
    }),
  exportInspections: protectedProcedure
    .use(requirePermission('history_export', 'canExport'))
    .input(z.object({
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const XLSX = await import('xlsx');
      
      const inspections = await db.getProductInspections({
        corporateCode: input.corporateCode,
        factoryCode: input.factoryCode,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: 10000, // Max export limit
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });

      // Transform data for Excel
      const data = inspections.data.map((i: any) => ({
        'Inspection ID': i.id,
        'Corporate Code': i.corporateCode || 'N/A',
        'Factory Code': i.factoryCode || 'N/A',
        'Serial Number': i.serialNumber,
        'Product Model': i.productModelName || i.productModelCode,
        'Result': i.overallResult,
        'Inspection Time': new Date(i.inspectionTime).toLocaleString('vi-VN'),
        'Batch Number': i.batchNumber || '',
        'Machine Code': i.machineCode,
        'Station Code': i.stationCode,
      }));

      // Create workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Inspections');

      // Generate buffer
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      // Upload to S3
      const { storagePut } = await import('../storage');
      const filename = `inspections_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportStatistics: adminProcedure
    .use(requirePermission('reports_export', 'canExport'))
    .input(z.object({
      startDate: z.date(),
      endDate: z.date(),
    }))
    .mutation(async ({ input }) => {
      const XLSX = await import('xlsx');
      
      const corporateStats = await db.getYieldRateByCorporate(input);
      const factoryStats = await db.getYieldRateByFactory(input);

      const wb = XLSX.utils.book_new();
      
      // Corporate sheet
      const corporateWs = XLSX.utils.json_to_sheet(corporateStats.map((s: any) => ({
        'Corporate Code': s.corporateCode,
        'Total Inspections': s.totalInspections,
        'OK Count': s.okCount,
        'NG Count': s.ngCount,
        'NTF Count': s.ntfCount,
        'Yield Rate (%)': s.yieldRate,
      })));
      XLSX.utils.book_append_sheet(wb, corporateWs, 'Corporate Stats');

      // Factory sheet
      const factoryWs = XLSX.utils.json_to_sheet(factoryStats.map((s: any) => ({
        'Corporate Code': s.corporateCode,
        'Factory Code': s.factoryCode,
        'Total Inspections': s.totalInspections,
        'OK Count': s.okCount,
        'NG Count': s.ngCount,
        'NTF Count': s.ntfCount,
        'Yield Rate (%)': s.yieldRate,
      })));
      XLSX.utils.book_append_sheet(wb, factoryWs, 'Factory Stats');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `statistics_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename };
    }),

  // Export Dashboard Statistics to Excel/PDF
  exportDashboardStats: protectedProcedure
    .use(requirePermission('dashboard_export', 'canExport'))
    .input(z.object({
      startDate: z.date(),
      endDate: z.date(),
      format: z.enum(['excel', 'pdf']).default('excel'),
      corporateCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const XLSX = await import('xlsx');
      
      // Get statistics with access control
      const corporateStats = await cachedStats.getCachedYieldRateByCorporate({
        startDate: input.startDate,
        endDate: input.endDate,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
      
      const factoryStats = await cachedStats.getCachedYieldRateByFactory({
        corporateCode: input.corporateCode,
        startDate: input.startDate,
        endDate: input.endDate,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
      
      const throughputCorporate = await cachedStats.getCachedThroughputByCorporate({
        startDate: input.startDate,
        endDate: input.endDate,
        interval: 'day',
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });

      if (input.format === 'excel') {
        const wb = XLSX.utils.book_new();
        
        // Summary sheet
        const totalInspections = corporateStats.reduce((sum, s) => sum + s.totalInspections, 0);
        const totalOK = corporateStats.reduce((sum, s) => sum + s.okCount, 0);
        const totalNG = corporateStats.reduce((sum, s) => sum + s.ngCount, 0);
        const totalNTF = corporateStats.reduce((sum, s) => sum + s.ntfCount, 0);
        const overallYield = totalInspections > 0 ? ((totalOK / totalInspections) * 100).toFixed(2) : '0.00';
        
        const summaryData = [
          { 'Metric': 'Report Period', 'Value': `${input.startDate.toLocaleDateString('vi-VN')} - ${input.endDate.toLocaleDateString('vi-VN')}` },
          { 'Metric': 'Total Inspections', 'Value': totalInspections },
          { 'Metric': 'OK Count', 'Value': totalOK },
          { 'Metric': 'NG Count', 'Value': totalNG },
          { 'Metric': 'NTF Count', 'Value': totalNTF },
          { 'Metric': 'Overall Yield Rate', 'Value': `${overallYield}%` },
          { 'Metric': 'Number of Corporates', 'Value': corporateStats.length },
          { 'Metric': 'Number of Factories', 'Value': factoryStats.length },
          { 'Metric': 'Generated At', 'Value': new Date().toLocaleString('vi-VN') },
          { 'Metric': 'Generated By', 'Value': ctx.user.name || ctx.user.email },
        ];
        const summaryWs = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
        
        // Corporate Stats sheet
        const corporateWs = XLSX.utils.json_to_sheet(corporateStats.map((s: any) => ({
          'Mã Công ty': s.corporateCode,
          'Tổng kiểm tra': s.totalInspections,
          'Số OK': s.okCount,
          'Số NG': s.ngCount,
          'Số NTF': s.ntfCount,
          'Tỷ lệ đạt (%)': s.yieldRate,
        })));
        XLSX.utils.book_append_sheet(wb, corporateWs, 'Corporate Stats');

        // Factory Stats sheet
        const factoryWs = XLSX.utils.json_to_sheet(factoryStats.map((s: any) => ({
          'Mã Công ty': s.corporateCode,
          'Mã Nhà máy': s.factoryCode,
          'Tổng kiểm tra': s.totalInspections,
          'Số OK': s.okCount,
          'Số NG': s.ngCount,
          'Số NTF': s.ntfCount,
          'Tỷ lệ đạt (%)': s.yieldRate,
        })));
        XLSX.utils.book_append_sheet(wb, factoryWs, 'Factory Stats');

        // Daily Throughput sheet
        const throughputWs = XLSX.utils.json_to_sheet(throughputCorporate.map((t: any) => ({
          'Mã Công ty': t.corporateCode,
          'Ngày': t.timeInterval,
          'Số lượng': t.count,
        })));
        XLSX.utils.book_append_sheet(wb, throughputWs, 'Daily Throughput');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        const { storagePut } = await import('../storage');
        const filename = `dashboard_stats_${Date.now()}.xlsx`;
        const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        
        return { url, filename, format: 'excel' };
      } else {
        // PDF export using HTML template
        const totalInspections = corporateStats.reduce((sum, s) => sum + s.totalInspections, 0);
        const totalOK = corporateStats.reduce((sum, s) => sum + s.okCount, 0);
        const totalNG = corporateStats.reduce((sum, s) => sum + s.ngCount, 0);
        const totalNTF = corporateStats.reduce((sum, s) => sum + s.ntfCount, 0);
        const overallYield = totalInspections > 0 ? ((totalOK / totalInspections) * 100).toFixed(2) : '0.00';
        
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Dashboard Statistics Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #1a1a2e; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
    h2 { color: #1a1a2e; margin-top: 30px; }
    .summary { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .stat-card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; color: #3b82f6; }
    .stat-label { color: #64748b; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    tr:nth-child(even) { background: #f8fafc; }
    .ok { color: #10b981; }
    .ng { color: #ef4444; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Báo cáo Thống kê Dashboard</h1>
  
  <div class="summary">
    <p><strong>Kỳ báo cáo:</strong> ${input.startDate.toLocaleDateString('vi-VN')} - ${input.endDate.toLocaleDateString('vi-VN')}</p>
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${totalInspections.toLocaleString()}</div>
        <div class="stat-label">Tổng kiểm tra</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ok">${totalOK.toLocaleString()}</div>
        <div class="stat-label">Số OK</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ng">${totalNG.toLocaleString()}</div>
        <div class="stat-label">Số NG</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${overallYield}%</div>
        <div class="stat-label">Tỷ lệ đạt</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${corporateStats.length}</div>
        <div class="stat-label">Số công ty</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${factoryStats.length}</div>
        <div class="stat-label">Số nhà máy</div>
      </div>
    </div>
  </div>

  <h2>Thống kê theo Công ty</h2>
  <table>
    <thead>
      <tr>
        <th>Mã Công ty</th>
        <th>Tổng kiểm tra</th>
        <th>OK</th>
        <th>NG</th>
        <th>NTF</th>
        <th>Tỷ lệ đạt (%)</th>
      </tr>
    </thead>
    <tbody>
      ${corporateStats.map((s: any) => `
        <tr>
          <td>${s.corporateCode}</td>
          <td>${s.totalInspections.toLocaleString()}</td>
          <td class="ok">${s.okCount.toLocaleString()}</td>
          <td class="ng">${s.ngCount.toLocaleString()}</td>
          <td>${s.ntfCount.toLocaleString()}</td>
          <td>${s.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Thống kê theo Nhà máy</h2>
  <table>
    <thead>
      <tr>
        <th>Mã Công ty</th>
        <th>Mã Nhà máy</th>
        <th>Tổng kiểm tra</th>
        <th>OK</th>
        <th>NG</th>
        <th>NTF</th>
        <th>Tỷ lệ đạt (%)</th>
      </tr>
    </thead>
    <tbody>
      ${factoryStats.map((s: any) => `
        <tr>
          <td>${s.corporateCode}</td>
          <td>${s.factoryCode}</td>
          <td>${s.totalInspections.toLocaleString()}</td>
          <td class="ok">${s.okCount.toLocaleString()}</td>
          <td class="ng">${s.ngCount.toLocaleString()}</td>
          <td>${s.ntfCount.toLocaleString()}</td>
          <td>${s.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>Báo cáo được tạo lúc: ${new Date().toLocaleString('vi-VN')}</p>
    <p>Người tạo: ${ctx.user.name || ctx.user.email}</p>
  </div>
</body>
</html>
        `;
        
        // Convert HTML to PDF using WeasyPrint or return HTML for now
        const { storagePut } = await import('../storage');
        const filename = `dashboard_stats_${Date.now()}.html`;
        const { url } = await storagePut(`exports/${filename}`, Buffer.from(htmlContent), 'text/html');
        
        return { url, filename, format: 'html' };
      }
    }),

  exportProducts: protectedProcedure
    .use(requirePermission('settings_products', 'canExport'))
    .mutation(async () => {
      const XLSX = await import('xlsx');
      
      const allProducts = await db.getProductModels();
      
      // Filter only active items
      const products = allProducts.filter((p: any) => p.isActive);
      
      // Limit to 10,000 rows
      const limitedProducts = products.slice(0, 10000);
      
      const data = limitedProducts.map((p: any) => ({
        'Code': p.code,
        'Name': p.name,
        'Description': p.description || '',
        'Category': p.category || '',
        'Version': p.version || '',
        'Created At': new Date(p.createdAt).toLocaleString('vi-VN'),
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Products');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `products_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportMachines: protectedProcedure
    .use(requirePermission('settings_machines', 'canExport'))
    .mutation(async () => {
      const XLSX = await import('xlsx');
      
      const allMachines = await db.getMachines();
      const stations = await db.getStations();
      
      // Filter only active items
      const machines = allMachines.filter((m: any) => m.isActive);
      
      // Limit to 10,000 rows
      const limitedMachines = machines.slice(0, 10000);
      
      const data = limitedMachines.map((m: any) => {
        const station = stations.find(s => s.id === m.stationId);
        return {
          'Code': m.code,
          'Name': m.name,
          'Station Code': station?.code || '',
          'Machine Type': m.machineType,
          'Model': m.model || '',
          'Manufacturer': m.manufacturer || '',
          'Created At': new Date(m.createdAt).toLocaleString('vi-VN'),
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Machines');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `machines_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportMeasurementPoints: protectedProcedure
    .use(requirePermission('settings_measurement_points', 'canExport'))
    .input(z.object({
      productModelId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const XLSX = await import('xlsx');
      
      // Fetch all measurement points or filter by product
      const allMeasurementPoints = input.productModelId 
        ? await db.getMeasurementPointDefsByProductModel(input.productModelId)
        : await db.getAllMeasurementPoints();  // Need to add this function to db
      
      const products = await db.getProductModels();
      
      // Filter only active items
      const measurementPoints = allMeasurementPoints.filter((mp: any) => mp.isActive);
      
      // Limit to 10,000 rows
      const limitedMeasurementPoints = measurementPoints.slice(0, 10000);
      
      const data = limitedMeasurementPoints.map((mp: any) => {
        const product = products.find(p => p.id === mp.productModelId);
        return {
          'Product Code': product?.code || '',
          'Code': mp.code,
          'Name': mp.name,
          'Measurement Type': mp.measurementType,
          'Unit': mp.unit || '',
          'Nominal Value': mp.nominalValue || '',
          'Upper Limit': mp.upperLimit || '',
          'Lower Limit': mp.lowerLimit || '',
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Measurement Points');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `measurement_points_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportFactories: protectedProcedure
    .use(requirePermission('settings_factory', 'canExport'))
    .mutation(async () => {
      const XLSX = await import('xlsx');
      
      const allFactories = await db.getFactories();
      // Filter only active items
      const factories = allFactories.filter((f: any) => f.isActive);
      
      // Limit to 10,000 rows
      const limitedFactories = factories.slice(0, 10000);
      
      const data = limitedFactories.map((f: any) => ({
        'Code': f.code,
        'Name': f.name,
        'Description': f.description || '',
        'Address': f.address || '',
        'Region': f.region || '',
        'Country': f.country || '',
        'Created At': new Date(f.createdAt).toLocaleString('vi-VN'),
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Factories');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `factories_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportWorkshops: protectedProcedure
    .use(requirePermission('settings_workshop', 'canExport'))
    .mutation(async () => {
      const XLSX = await import('xlsx');
      
      const allWorkshops = await db.getWorkshops();
      const factories = await db.getFactories();
      
      // Filter only active items
      const workshops = allWorkshops.filter((w: any) => w.isActive);
      
      // Limit to 10,000 rows
      const limitedWorkshops = workshops.slice(0, 10000);
      
      const data = limitedWorkshops.map((w: any) => {
        const factory = factories.find(f => f.id === w.factoryId);
        return {
          'Factory Code': factory?.code || '',
          'Code': w.code,
          'Name': w.name,
          'Description': w.description || '',
          'Created At': new Date(w.createdAt).toLocaleString('vi-VN'),
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Workshops');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `workshops_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportLines: protectedProcedure
    .use(requirePermission('settings_production_line', 'canExport'))
    .mutation(async () => {
      const XLSX = await import('xlsx');
      
      const allLines = await db.getProductionLines();
      const workshops = await db.getWorkshops();
      
      // Filter only active items
      const lines = allLines.filter((l: any) => l.isActive);
      
      // Limit to 10,000 rows
      const limitedLines = lines.slice(0, 10000);
      
      const data = limitedLines.map((l: any) => {
        const workshop = workshops.find(w => w.id === l.workshopId);
        return {
          'Workshop Code': workshop?.code || '',
          'Code': l.code,
          'Name': l.name,
          'Description': l.description || '',
          'Capacity Per Hour': l.capacityPerHour ?? '',
          'Max Concurrent Orders': l.maxConcurrentOrders ?? '',
          'Created At': new Date(l.createdAt).toLocaleString('vi-VN'),
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Lines');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `lines_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportStations: protectedProcedure
    .use(requirePermission('settings_station', 'canExport'))
    .mutation(async () => {
      const XLSX = await import('xlsx');
      
      const allStations = await db.getStations();
      const lines = await db.getProductionLines();
      
      // Filter only active items
      const stations = allStations.filter((s: any) => s.isActive);
      
      // Limit to 10,000 rows
      const limitedStations = stations.slice(0, 10000);
      
      const data = limitedStations.map((s: any) => {
        const line = lines.find(l => l.id === s.lineId);
        return {
          'Line Code': line?.code || '',
          'Code': s.code,
          'Name': s.name,
          'Description': s.description || '',
          'Order Index': s.orderIndex ?? '',
          'Created At': new Date(s.createdAt).toLocaleString('vi-VN'),
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Stations');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `stations_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportWorkstations: protectedProcedure
    .use(requirePermission('settings_workstation', 'canExport'))
    .mutation(async () => {
      const XLSX = await import('xlsx');
      
      const allWorkstations = await db.getWorkstations();
      const factories = await db.getFactories();
      const workshops = await db.getWorkshops();
      const lines = await db.getProductionLines();
      
      // Filter only active items
      const workstations = allWorkstations.filter((ws: any) => ws.isActive);
      
      // Limit to 10,000 rows
      const limitedWorkstations = workstations.slice(0, 10000);
      
      const data = limitedWorkstations.map((ws: any) => {
        const factory = factories.find(f => f.id === ws.factoryId);
        const workshop = workshops.find(w => w.id === ws.workshopId);
        const line = lines.find(l => l.id === ws.lineId);
        return {
          'Code': ws.code,
          'Name': ws.name,
          'Description': ws.description || '',
          'Factory Code': factory?.code || '',
          'Workshop Code': workshop?.code || '',
          'Line Code': line?.code || '',
          'Process Type': ws.processType || '',
          'Order Index': ws.orderIndex ?? '',
          'Created At': new Date(ws.createdAt).toLocaleString('vi-VN'),
        };
      });

      const wb = XLSX.utils.book_new();
      const wsSheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, wsSheet, 'Workstations');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('../storage');
      const filename = `workstations_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),
});
