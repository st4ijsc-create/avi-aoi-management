import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { requirePermission } from "../_core/accessControl";
import * as db from "../db";
import * as cachedStats from "../functions/cachedStatistics";

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
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Check if factory code already exists
          const existing = await db.getFactoryByCode(item.code);
          if (existing) {
            throw new Error('Factory code already exists');
          }
          
          await db.createFactory(item);
          results.success++;
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
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Lookup factory by code
          const factory = await db.getFactoryByCode(item.factoryCode);
          if (!factory) {
            throw new Error(`Factory ${item.factoryCode} not found`);
          }
          
          // Check if workshop code already exists
          const existing = await db.getWorkshopByCode(item.code);
          if (existing) {
            throw new Error('Workshop code already exists');
          }
          
          await db.createWorkshop({
            factoryId: factory.id,
            code: item.code,
            name: item.name,
            description: item.description,
            isActive: item.isActive ?? true,
          });
          results.success++;
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
        machineType: z.enum(['AVI', 'AOI', 'AUTOMATION']),
        model: z.string().optional(),
        manufacturer: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Lookup station by code
          const station = await db.getStationByCode(item.stationCode);
          if (!station) {
            throw new Error(`Station ${item.stationCode} not found`);
          }
          
          // Generate API key
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
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Check if product code already exists
          const existing = await db.getProductModelByCode(item.code);
          if (existing) {
            throw new Error('Product code already exists');
          }
          
          await db.createProductModel({
            code: item.code,
            name: item.name,
            description: item.description,
            category: item.category,
            isActive: item.isActive ?? true,
          });
          results.success++;
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
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Lookup product model by code
          const productModel = await db.getProductModelByCode(item.productModelCode);
          if (!productModel) {
            throw new Error(`Product model ${item.productModelCode} not found`);
          }
          
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
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),
});

export const exportRouter = router({
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
      
      const products = await db.getProductModels();
      
      const data = products.map((p: any) => ({
        'Code': p.code,
        'Name': p.name,
        'Description': p.description || '',
        'Category': p.category || '',
        'Version': p.version || '',
        'Is Active': p.isActive ? 'Yes' : 'No',
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
      
      const machines = await db.getMachines();
      const stations = await db.getStations();
      
      const data = machines.map((m: any) => {
        const station = stations.find(s => s.id === m.stationId);
        return {
          'Code': m.code,
          'Name': m.name,
          'Station Code': station?.code || '',
          'Machine Type': m.machineType,
          'Model': m.model || '',
          'Manufacturer': m.manufacturer || '',
          'Is Active': m.isActive ? 'Yes' : 'No',
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
      
      const measurementPoints = input.productModelId 
        ? await db.getMeasurementPointDefsByProductModel(input.productModelId)
        : [];
      const products = await db.getProductModels();
      
      const data = measurementPoints.map((mp: any) => {
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
          'Is Active': mp.isActive ? 'Yes' : 'No',
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
      
      const factories = await db.getFactories();
      
      const data = factories.map((f: any) => ({
        'Code': f.code,
        'Name': f.name,
        'Description': f.description || '',
        'Address': f.address || '',
        'Region': f.region || '',
        'Country': f.country || '',
        'Is Active': f.isActive ? 'Yes' : 'No',
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
      
      const workshops = await db.getWorkshops();
      const factories = await db.getFactories();
      
      const data = workshops.map((w: any) => {
        const factory = factories.find(f => f.id === w.factoryId);
        return {
          'Factory Code': factory?.code || '',
          'Code': w.code,
          'Name': w.name,
          'Description': w.description || '',
          'Is Active': w.isActive ? 'Yes' : 'No',
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
});
