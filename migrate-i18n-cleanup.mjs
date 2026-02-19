#!/usr/bin/env node
/**
 * i18n Cleanup Migration Script - Phase 2
 * Handles all remaining hardcoded Vietnamese/English strings that the initial
 * migration script missed: toast messages, template literals, CSV headers,
 * PDF text, validation returns, placeholders, card descriptions, etc.
 */
import fs from 'fs';
import path from 'path';

const BASE = 'client/src';
const PAGES = `${BASE}/pages`;
const LOCALES = `${BASE}/i18n/locales`;

function readFile(fp) { return fs.readFileSync(fp, 'utf-8').replace(/\r\n/g, '\n'); }
function writeFile(fp, c) { fs.writeFileSync(fp, c, 'utf-8'); }
function readJsonFile(fp) {
  let c = fs.readFileSync(fp, 'utf-8');
  if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
  return JSON.parse(c);
}
function writeJsonFile(fp, data) {
  const BOM = '\uFEFF';
  fs.writeFileSync(fp, BOM + JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

/** Replace first occurrence only */
function r1(content, old, repl) {
  const idx = content.indexOf(old);
  if (idx === -1) {
    console.warn(`  ⚠ Not found: "${old.substring(0, 60)}..."`);
    return content;
  }
  return content.substring(0, idx) + repl + content.substring(idx + old.length);
}

/** Replace all occurrences */
function rAll(content, old, repl) {
  if (!content.includes(old)) {
    console.warn(`  ⚠ Not found (all): "${old.substring(0, 60)}..."`);
    return content;
  }
  return content.split(old).join(repl);
}

// ═══════════════════════════════════════════════
// DASHBOARD.TSX
// ═══════════════════════════════════════════════
function processDashboard() {
  console.log('\n📊 Processing Dashboard.tsx...');
  const fp = path.join(PAGES, 'Dashboard.tsx');
  let c = readFile(fp);

  // 1. timeRangeLabel "Hôm nay" → t("dashboard.todayPeriod") - but this is inside a ternary
  c = r1(c,
    'const timeRangeLabel = ngTimeFilter === "day" ? "Hôm nay" : ngTimeFilter === "week" ? t("dashboard.7daysPeriod") : t("dashboard.30daysPeriod");',
    'const timeRangeLabel = ngTimeFilter === "day" ? t("dashboard.today") : ngTimeFilter === "week" ? t("dashboard.7daysPeriod") : t("dashboard.30daysPeriod");'
  );

  // 2. HTML template strings for PDF export
  c = r1(c, '<title>Báo cáo NG Visual - ${timeRangeLabel}</title>', '<title>${t("dashboard.ngReportTitle")} - ${timeRangeLabel}</title>');
  c = r1(c, '<h1>Báo cáo NG Visual</h1>', '<h1>${t("dashboard.ngReportTitle")}</h1>');
  c = r1(c, '<p>Khoảng thời gian: <strong>${timeRangeLabel}</strong></p>', '<p>${t("dashboard.timeRangeLabel")}: <strong>${timeRangeLabel}</strong></p>');
  c = r1(c, '<p>Ngày xuất: ${exportDate}</p>', '<p>${t("dashboard.exportDateLabel")}: ${exportDate}</p>');
  c = r1(c, '<h2>Tỉ lệ NG theo Công trạm</h2>', '<h2>${t("dashboard.ngRateByWorkstation")}</h2>');
  c = r1(c, '<th>Mã</th>\n                <th>Tên công trạm</th>\n                <th>Tổng kiểm tra</th>\n                <th>Số NG</th>\n                <th>Tỉ lệ NG (%)</th>',
    '<th>${t("dashboard.codeCol")}</th>\n                <th>${t("dashboard.workstationNameCol")}</th>\n                <th>${t("dashboard.totalInspectionCol")}</th>\n                <th>${t("dashboard.ngCountCol")}</th>\n                <th>${t("dashboard.ngRateCol")}</th>');
  c = r1(c, '<h2>Top Điểm đo có tỉ lệ NG cao</h2>', '<h2>${t("dashboard.topNgPoints")}</h2>');
  c = r1(c, '<th>Mã</th>\n                <th>Tên điểm đo</th>\n                <th>Công trạm</th>\n                <th>Tổng kiểm tra</th>\n                <th>Số NG</th>\n                <th>Tỉ lệ NG (%)</th>',
    '<th>${t("dashboard.codeCol")}</th>\n                <th>${t("dashboard.pointNameCol")}</th>\n                <th>${t("dashboard.workstationCol")}</th>\n                <th>${t("dashboard.totalInspectionCol")}</th>\n                <th>${t("dashboard.ngCountCol")}</th>\n                <th>${t("dashboard.ngRateCol")}</th>');
  c = r1(c, '<p>Báo cáo được tạo tự động bởi hệ thống AVI/AOI Management</p>', '<p>${t("dashboard.reportFooter")}</p>');

  // 3. Toast messages for export
  c = r1(c,
    'toast.success("Xuất báo cáo thành công!", {\n        description: "File HTML đã được tải xuống. Bạn có thể mở và in thành PDF.",\n      });',
    'toast.success(t("dashboard.exportSuccess"), {\n        description: t("dashboard.exportSuccessDesc"),\n      });'
  );
  c = r1(c,
    'toast.error("Lỗi xuất báo cáo", {\n        description: "Không thể tạo file báo cáo. Vui lòng thử lại.",\n      });',
    'toast.error(t("dashboard.exportReportError"), {\n        description: t("dashboard.exportReportErrorDesc"),\n      });'
  );

  // 4. Fallback strings 'Chưa phân loại'
  c = rAll(c, "'Chưa phân loại'", "t('dashboard.unclassified')");

  // 5. Alert threshold messages
  c = r1(c,
    "message: `${threshold.metricType} ${isHigherBetter ? 'dưới' : 'vượt'} ngưỡng nguy hiểm: ${currentValue.toFixed(2)}% (ngưỡng: ${criticalVal}%)`",
    "message: t('dashboard.criticalThresholdMsg', { metric: threshold.metricType, direction: isHigherBetter ? t('dashboard.below') : t('dashboard.exceeds'), value: currentValue.toFixed(2), threshold: criticalVal })"
  );
  c = r1(c,
    "message: `${threshold.metricType} ${isHigherBetter ? 'dưới' : 'vượt'} ngưỡng cảnh báo: ${currentValue.toFixed(2)}% (ngưỡng: ${warningVal}%)`",
    "message: t('dashboard.warningThresholdMsg', { metric: threshold.metricType, direction: isHigherBetter ? t('dashboard.below') : t('dashboard.exceeds'), value: currentValue.toFixed(2), threshold: warningVal })"
  );

  writeFile(fp, c);
  console.log('  ✅ Dashboard.tsx done');
}

// ═══════════════════════════════════════════════
// HISTORY.TSX
// ═══════════════════════════════════════════════
function processHistory() {
  console.log('\n📜 Processing History.tsx...');
  const fp = path.join(PAGES, 'History.tsx');
  let c = readFile(fp);

  // 1. Quick filter names
  c = r1(c, '{ name: "NG hôm nay", filters:', '{ name: t("history.filterNgToday"), filters:');
  c = r1(c, '{ name: "Tuần này", filters:', '{ name: t("history.filterThisWeek"), filters:');

  // 2. Export toast - no data
  c = r1(c,
    'toast.error("Không có dữ liệu để xuất");',
    'toast.error(t("history.noDataToExport"));'
  );

  // 3. CSV headers for main export (first occurrence)
  c = r1(c, `const headers = [
        "STT",
        "Mã SN",
        "Mã nhà máy",
        "Mã nhà xưởng",
        "Dây chuyền",
        "Công trạm",
        "Máy",
        "Loại máy",
        "Mã sản phẩm",
        "Kết quả",
        "Tổng điểm đo",
        "OK",
        "NG",
        "NTF",
        "Yield Rate (%)",
        "Thời gian kiểm tra",
        "Ghi chú"
      ];`, `const headers = [
        t("history.csvStt"),
        t("history.csvSnCode"),
        t("history.csvFactoryCode"),
        t("history.csvWorkshopCode"),
        t("history.csvLine"),
        t("history.csvWorkstation"),
        t("history.csvMachine"),
        t("history.csvMachineType"),
        t("history.csvProductCode"),
        t("history.csvResult"),
        t("history.csvTotalPoints"),
        "OK",
        "NG",
        "NTF",
        "Yield Rate (%)",
        t("history.csvInspectionTime"),
        t("history.csvRemarks")
      ];`);

  // 4. Export success toast (template literal)
  c = r1(c,
    'toast.success(`Đã xuất ${data.data.length} bản ghi thành công`);',
    'toast.success(t("history.exportedRecords", { count: data.data.length }));'
  );

  // 5. Export error toast
  c = r1(c,
    'toast.error("Lỗi khi xuất dữ liệu");',
    'toast.error(t("history.exportError"));'
  );

  // 6. Bulk export - select at least 1 (first occurrence)
  c = r1(c,
    'toast.error("Vui lòng chọn ít nhất 1 bản ghi");',
    'toast.error(t("history.pleaseSelectAtLeast1"));'
  );

  // 7. Second CSV headers array (bulk export)
  c = r1(c, `const headers = [
        "STT",
        "Mã SN",
        "Mã nhà máy",
        "Mã nhà xưởng",
        "Dây chuyền",
        "Công trạm",
        "Máy",
        "Loại máy",
        "Mã sản phẩm",
        "Kết quả",
        "Tổng điểm đo",
        "OK",
        "NG",
        "NTF",
        "Yield Rate (%)",
        "Thời gian kiểm tra",
        "Ghi chú"
      ];`, `const headers = [
        t("history.csvStt"),
        t("history.csvSnCode"),
        t("history.csvFactoryCode"),
        t("history.csvWorkshopCode"),
        t("history.csvLine"),
        t("history.csvWorkstation"),
        t("history.csvMachine"),
        t("history.csvMachineType"),
        t("history.csvProductCode"),
        t("history.csvResult"),
        t("history.csvTotalPoints"),
        "OK",
        "NG",
        "NTF",
        "Yield Rate (%)",
        t("history.csvInspectionTime"),
        t("history.csvRemarks")
      ];`);

  // 8. Bulk export success
  c = r1(c,
    'toast.success(`Đã xuất ${selectedIds.size} bản ghi thành công`);',
    'toast.success(t("history.exportedRecords", { count: selectedIds.size }));'
  );

  // 9. Bulk export error
  c = r1(c,
    'toast.error("Lỗi khi xuất dữ liệu hàng loạt");',
    'toast.error(t("history.bulkExportError"));'
  );

  // 10. Second "Vui lòng chọn ít nhất 1 bản ghi" (bulk acknowledge)
  c = r1(c,
    'toast.error("Vui lòng chọn ít nhất 1 bản ghi");',
    'toast.error(t("history.pleaseSelectAtLeast1"));'
  );

  // 11. Bulk acknowledge success
  c = r1(c,
    'toast.success(`Đã xác nhận ${selectedIds.size} bản ghi thành công`);',
    'toast.success(t("history.acknowledgedRecords", { count: selectedIds.size }));'
  );

  // 12. Bulk acknowledge error
  c = r1(c,
    'toast.error("Lỗi khi xác nhận hàng loạt");',
    'toast.error(t("history.acknowledgeError"));'
  );

  // 13. No yield data to export
  c = r1(c,
    'toast.error("Không có dữ liệu Yield để xuất");',
    'toast.error(t("history.noYieldData"));'
  );

  // 14. Yield export headers
  c = r1(c, `const headers = [
        "Ngày",
        "Tổng sản phẩm",
        "OK",
        "NG", 
        "NTF",
        "FPY (%)",
        "Fail Rate (%)",
        "NTF Rate (%)",
        "UPH"
      ];`, `const headers = [
        t("history.yieldDate"),
        t("history.yieldTotalProducts"),
        "OK",
        "NG", 
        "NTF",
        "FPY (%)",
        "Fail Rate (%)",
        "NTF Rate (%)",
        "UPH"
      ];`);

  // 15. Summary row "Tổng cộng"
  c = r1(c, '"Tổng cộng",', 't("history.yieldSummary"),');

  // 16. Yield export success toasts  
  c = r1(c,
    "toast.success(`Đã xuất báo cáo Yield thành công (${format.toUpperCase()})`);",
    "toast.success(t('history.yieldExportSuccess', { format: format.toUpperCase() }));"
  );
  c = r1(c,
    "toast.success('Đã xuất báo cáo Yield thành công (PDF)');",
    "toast.success(t('history.yieldExportSuccess', { format: 'PDF' }));"
  );

  // 17. Yield export error
  c = r1(c,
    'toast.error("Lỗi khi xuất báo cáo Yield");',
    'toast.error(t("history.yieldExportError"));'
  );

  // 18. PDF report: Yield title
  c = r1(c, "doc.text('BÁO CÁO YIELD - FPY/FY/NTF/UPH', 14, 20);", "doc.text(t('history.yieldReportTitle'), 14, 20);");
  // 19. PDF: Ngày xuất
  c = r1(c,
    "doc.text(`Ngày xuất: ${formatDate(new Date(), 'dd/MM/yyyy')}`, 14, 30);",
    "doc.text(`${t('history.dateExport')}: ${formatDate(new Date(), 'dd/MM/yyyy')}`, 14, 30);"
  );
  // At this point there are TWO "Ngày xuất:" lines (yield and workstation). Handle the second one too.
  c = r1(c,
    "doc.text(`Ngày xuất: ${formatDate(new Date(), 'dd/MM/yyyy')}`, 14, 30);",
    "doc.text(`${t('history.dateExport')}: ${formatDate(new Date(), 'dd/MM/yyyy')}`, 14, 30);"
  );

  // 20. PDF: Tổng quan
  c = r1(c, "doc.text('Tổng quan:', 14, 45);", "doc.text(t('history.overviewLabel') + ':', 14, 45);");

  // 21. Workstation export headers
  c = r1(c,
    "const headers = ['Công trạm', 'Mã', 'Tổng', 'OK', 'NG', 'NTF', 'Yield'];",
    "const headers = [t('history.wsWorkstation'), t('history.wsCode'), t('history.wsTotal'), 'OK', 'NG', 'NTF', 'Yield'];"
  );

  // 22. Workstation export CSV success
  c = r1(c,
    "toast.success('Đã xuất báo cáo công trạm thành công (CSV)');",
    "toast.success(t('history.workstationExportSuccess', { format: 'CSV' }));"
  );

  // 23. Workstation export Excel - sheet name and success
  c = r1(c, "XLSX.utils.book_append_sheet(wb, ws, 'Công trạm');", "XLSX.utils.book_append_sheet(wb, ws, t('history.wsWorkstation'));");
  c = r1(c,
    "toast.success('Đã xuất báo cáo công trạm thành công (Excel)');",
    "toast.success(t('history.workstationExportSuccess', { format: 'Excel' }));"
  );

  // 24. Workstation PDF report title
  c = r1(c, "doc.text('BÁO CÁO PHÂN TÍCH CÔNG TRẠM', 14, 20);", "doc.text(t('history.workstationReportTitle'), 14, 20);");

  // 25. Workstation PDF: Tóm tắt
  c = r1(c, "doc.text('Tóm tắt:', 14, 45);", "doc.text(t('history.summaryLabel') + ':', 14, 45);");

  // 26. Workstation PDF: stats lines
  c = r1(c,
    "doc.text(`- Tổng công trạm: ${summaryData.length}`, 20, 52);",
    "doc.text(`- ${t('history.totalWorkstations')}: ${summaryData.length}`, 20, 52);"
  );
  c = r1(c,
    "doc.text(`- Tổng lỗi NG: ${totalDefects}`, 20, 59);",
    "doc.text(`- ${t('history.totalNgDefects')}: ${totalDefects}`, 20, 59);"
  );
  c = r1(c,
    "doc.text(`- Yield trung bình: ${avgYield.toFixed(2)}%`, 20, 66);",
    "doc.text(`- ${t('history.avgYield')}: ${avgYield.toFixed(2)}%`, 20, 66);"
  );

  // 27. Workstation PDF success
  c = r1(c,
    "toast.success('Đã xuất báo cáo công trạm thành công (PDF)');",
    "toast.success(t('history.workstationExportSuccess', { format: 'PDF' }));"
  );

  // 28. Workstation export error
  c = r1(c,
    "toast.error('Lỗi khi xuất báo cáo công trạm');",
    "toast.error(t('history.workstationExportError'));"
  );

  // 29. Search filter section - JSX text
  c = r1(c,
    `<Filter className="h-5 w-5 text-primary" />
              Bộ lọc tìm kiếm`,
    `<Filter className="h-5 w-5 text-primary" />
              {t("history.searchFilter")}`
  );
  c = r1(c,
    '<CardDescription>Lọc theo mã nhà máy, nhà xưởng, SN sản phẩm, dây chuyền, công trạm, máy</CardDescription>',
    '<CardDescription>{t("history.filterDescription")}</CardDescription>'
  );

  // 30. Filter labels
  c = r1(c, '<label className="text-sm text-muted-foreground">Mã nhà máy</label>', '<label className="text-sm text-muted-foreground">{t("history.factoryCodeLabel")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Mã nhà xưởng</label>', '<label className="text-sm text-muted-foreground">{t("history.workshopCodeLabel")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Mã dây chuyền</label>', '<label className="text-sm text-muted-foreground">{t("history.lineCodeLabel")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Mã công trạm</label>', '<label className="text-sm text-muted-foreground">{t("history.stationCodeLabel")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Mã máy</label>', '<label className="text-sm text-muted-foreground">{t("history.machineCodeLabel")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Mã sản phẩm</label>', '<label className="text-sm text-muted-foreground">{t("history.productCodeLabel")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Kết quả</label>', '<label className="text-sm text-muted-foreground">{t("history.resultLabel")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Khoảng thời gian</label>', '<label className="text-sm text-muted-foreground">{t("history.dateRangeLabel")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Từ ngày</label>', '<label className="text-sm text-muted-foreground">{t("history.fromDate")}</label>');
  c = r1(c, '<label className="text-sm text-muted-foreground">Đến ngày</label>', '<label className="text-sm text-muted-foreground">{t("history.toDate")}</label>');

  // 31. Select options for result filter
  c = r1(c, '<SelectItem value="all">Tất cả</SelectItem>\n                    <SelectItem value="OK">OK</SelectItem>\n                    <SelectItem value="NG">NG</SelectItem>\n                    <SelectItem value="NTF">NTF</SelectItem>',
    '<SelectItem value="all">{t("common.all")}</SelectItem>\n                    <SelectItem value="OK">OK</SelectItem>\n                    <SelectItem value="NG">NG</SelectItem>\n                    <SelectItem value="NTF">NTF</SelectItem>');

  // 32. Select options for date range
  c = r1(c, `<SelectItem value="all">Tất cả</SelectItem>
                    <SelectItem value="today">Hôm nay</SelectItem>
                    <SelectItem value="week">7 ngày qua</SelectItem>
                    <SelectItem value="month">30 ngày qua</SelectItem>
                    <SelectItem value="custom">Tùy chọn</SelectItem>`,
    `<SelectItem value="all">{t("common.all")}</SelectItem>
                    <SelectItem value="today">{t("dashboard.today")}</SelectItem>
                    <SelectItem value="week">{t("dashboard.last7Days")}</SelectItem>
                    <SelectItem value="month">{t("dashboard.last30Days")}</SelectItem>
                    <SelectItem value="custom">{t("dashboard.customRange")}</SelectItem>`);

  // 33. Button text
  c = r1(c,
    `<Search className="h-4 w-4" />
                  Tìm kiếm`,
    `<Search className="h-4 w-4" />
                  {t("common.search")}`
  );
  c = r1(c,
    `<Button variant="outline" onClick={handleClearFilters}>
                  Xóa bộ lọc`,
    `<Button variant="outline" onClick={handleClearFilters}>
                  {t("history.clearFilters")}`
  );
  c = r1(c,
    `<Save className="h-4 w-4" />
                      Bộ lọc đã lưu`,
    `<Save className="h-4 w-4" />
                      {t("history.savedFiltersBtn")}`
  );

  // 34. Scan barcode title
  c = r1(c, 'title="Quét mã vạch/QR"', 'title={t("history.scanBarcode")}');

  // 35. Serial Number label (keep as is since it's English)
  // Already in English, no change needed

  writeFile(fp, c);
  console.log('  ✅ History.tsx done');
}

// ═══════════════════════════════════════════════
// SETTINGS.TSX
// ═══════════════════════════════════════════════
function processSettings() {
  console.log('\n⚙️ Processing Settings.tsx...');
  const fp = path.join(PAGES, 'Settings.tsx');
  let c = readFile(fp);

  // 1. Validation returns
  c = r1(c, 'if (!val || isNaN(Number(val))) return "Phải là số";', 'if (!val || isNaN(Number(val))) return t("validation.mustBeNumber");');
  c = r1(c, 'if (num < 0 || num > 100) return "Giá trị từ 0-100";', 'if (num < 0 || num > 100) return t("validation.valueRange0to100");');

  // 2. Alert CRUD toasts
  c = r1(c, 'toast.success("Tạo cảnh báo thành công");', 'toast.success(t("settings.createAlertSuccess"));');
  c = r1(c, 'toast.success("Cập nhật cảnh báo thành công");', 'toast.success(t("settings.updateAlertSuccess"));');
  c = r1(c, 'toast.success("Xóa cảnh báo thành công");', 'toast.success(t("settings.deleteAlertSuccess"));');

  // 3. Factory CRUD toasts
  c = r1(c, 'toast.success("Tạo nhà máy thành công");', 'toast.success(t("settings.createFactorySuccess"));');
  c = r1(c, 'toast.success("Cập nhật nhà máy thành công");', 'toast.success(t("settings.updateFactorySuccess"));');
  c = r1(c, 'toast.success("Xóa nhà máy thành công");', 'toast.success(t("settings.deleteFactorySuccess"));');

  // 4. Workshop CRUD toasts
  c = r1(c, 'toast.success("Tạo nhà xưởng thành công");', 'toast.success(t("settings.createWorkshopSuccess"));');
  c = r1(c, 'toast.success("Cập nhật nhà xưởng thành công");', 'toast.success(t("settings.updateWorkshopSuccess"));');
  c = r1(c, 'toast.success("Xóa nhà xưởng thành công");', 'toast.success(t("settings.deleteWorkshopSuccess"));');

  // 5. Line CRUD toasts
  c = r1(c, 'toast.success("Tạo dây chuyền thành công");', 'toast.success(t("settings.createLineSuccess"));');
  c = r1(c, 'toast.success("Cập nhật dây chuyền thành công");', 'toast.success(t("settings.updateLineSuccess"));');
  c = r1(c, 'toast.success("Xóa dây chuyền thành công");', 'toast.success(t("settings.deleteLineSuccess"));');

  // 6. Station CRUD toasts
  c = r1(c, 'toast.success("Tạo công trạm thành công");', 'toast.success(t("settings.createStationSuccess"));');
  c = r1(c, 'toast.success("Cập nhật công trạm thành công");', 'toast.success(t("settings.updateStationSuccess"));');
  c = r1(c, 'toast.success("Xóa công trạm thành công");', 'toast.success(t("settings.deleteStationSuccess"));');

  // 7. Machine CRUD toasts
  c = r1(c, 'toast.success(`Tạo máy thành công. API Key: ${data.apiKey}`);', 'toast.success(t("settings.createMachineSuccessWithKey", { apiKey: data.apiKey }));');
  c = r1(c, 'toast.success("Cập nhật máy thành công");', 'toast.success(t("settings.updateMachineSuccess"));');
  c = r1(c, 'toast.success("Xóa máy thành công");', 'toast.success(t("settings.deleteMachineSuccess"));');

  // 8. Upload image toast
  c = r1(c, 'toast.success(`Upload ảnh ${variables.imageType} thành công`);', 'toast.success(t("settings.uploadImageSuccess", { imageType: variables.imageType }));');

  // 9. Image validation toasts
  c = r1(c, 'toast.error("Vui lòng chọn file ảnh");', 'toast.error(t("settings.pleaseSelectImageFile"));');
  c = r1(c, 'toast.error("Kích thước file tối đa 5MB");', 'toast.error(t("settings.maxFileSize5mb"));');
  c = r1(c, 'toast.error("Lỗi khi upload ảnh");', 'toast.error(t("settings.uploadImageError"));');

  // 10. Shift CRUD toasts
  c = r1(c, 'toast.success("Tạo ca làm việc thành công");', 'toast.success(t("settings.createShiftSuccess"));');
  c = r1(c, 'toast.success("Cập nhật ca làm việc thành công");', 'toast.success(t("settings.updateShiftSuccess"));');
  c = r1(c, 'toast.success("Xóa ca làm việc thành công");', 'toast.success(t("settings.deleteShiftSuccess"));');

  // 11. Stage CRUD toasts
  c = r1(c, 'toast.success("Tạo công đoạn thành công");', 'toast.success(t("settings.createStageSuccess"));');
  c = r1(c, 'toast.success("Cập nhật công đoạn thành công");', 'toast.success(t("settings.updateStageSuccess"));');
  c = r1(c, 'toast.success("Xóa công đoạn thành công");', 'toast.success(t("settings.deleteStageSuccess"));');

  // 12. Reorder & clipboard toasts
  c = r1(c, 'toast.success("Sắp xếp lại thành công");', 'toast.success(t("settings.reorderSuccess"));');
  c = r1(c, 'toast.success("Đã copy vào clipboard");', 'toast.success(t("settings.copiedToClipboard"));');

  // 13. Button text: seed data
  c = r1(c,
    `{seedDataMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Tạo dữ liệu mẫu`,
    `{seedDataMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t("settings.seedDataBtn")}`
  );
  c = r1(c,
    `{seedInspectionsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Tạo 100 inspection`,
    `{seedInspectionsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t("settings.seedInspectionsBtn")}`
  );

  // 14. CardDescription counts
  c = r1(c, '<CardDescription>{factories?.length || 0} nhà máy</CardDescription>', '<CardDescription>{t("settings.factoryCount", { count: factories?.length || 0 })}</CardDescription>');
  c = r1(c, '<CardDescription>{workshops?.length || 0} nhà xưởng</CardDescription>', '<CardDescription>{t("settings.workshopCount", { count: workshops?.length || 0 })}</CardDescription>');
  c = r1(c, '<CardDescription>{lines?.length || 0} dây chuyền</CardDescription>', '<CardDescription>{t("settings.lineCount", { count: lines?.length || 0 })}</CardDescription>');
  c = r1(c, '<CardDescription>{stations?.length || 0} công trạm</CardDescription>', '<CardDescription>{t("settings.stationCount", { count: stations?.length || 0 })}</CardDescription>');
  c = r1(c, '<CardDescription>{machines?.length || 0} máy</CardDescription>', '<CardDescription>{t("settings.machineCount", { count: machines?.length || 0 })}</CardDescription>');
  c = r1(c, '<CardDescription>{stages?.length || 0} công đoạn</CardDescription>', '<CardDescription>{t("settings.stageCount", { count: stages?.length || 0 })}</CardDescription>');

  // 15. Placeholders
  c = r1(c, 'placeholder="VD: Nhà máy Bắc Ninh"', 'placeholder={t("settings.factoryNamePlaceholder")}');
  c = r1(c, 'placeholder="VD: Xưởng lắp ráp A"', 'placeholder={t("settings.workshopNamePlaceholder")}');
  c = r1(c, 'placeholder="VD: Dây chuyền SMT 1"', 'placeholder={t("settings.lineNamePlaceholder")}');
  c = r1(c, 'placeholder="VD: Trạm kiểm tra AOI"', 'placeholder={t("settings.stationNamePlaceholder")}');
  c = r1(c, 'placeholder="VD: Máy AVI kiểm tra PCB"', 'placeholder={t("settings.machineNamePlaceholder")}');
  c = rAll(c, 'placeholder="Nhà sản xuất"', 'placeholder={t("settings.manufacturerPlaceholder")}');
  c = r1(c, 'placeholder="VD: Cảnh báo FPY thấp"', 'placeholder={t("settings.alertNamePlaceholder")}');
  c = r1(c, 'placeholder="VD: Ca sáng"', 'placeholder={t("settings.shiftNamePlaceholder")}');
  c = r1(c, 'placeholder="VD: Lắp ráp, Kiểm tra..."', 'placeholder={t("settings.stageNamePlaceholder")}');
  c = r1(c, 'placeholder="VD: A, B, C..."', 'placeholder={t("settings.stageCodePlaceholder")}');
  // Hour/Minute placeholders  
  c = rAll(c, 'placeholder="Giờ"', 'placeholder={t("settings.hourPlaceholder")}');
  c = rAll(c, 'placeholder="Phút"', 'placeholder={t("settings.minutePlaceholder")}');

  // 16. "Tạo" button text in create dialogs (multiple occurrences)
  // Factory create button
  c = r1(c,
    `{createFactoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo`,
    `{createFactoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}`
  );
  // Workshop create button
  c = r1(c,
    `{createWorkshopMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo`,
    `{createWorkshopMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}`
  );
  // Line create button
  c = r1(c,
    `{createLineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo`,
    `{createLineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}`
  );
  // Station create button
  c = r1(c,
    `{createStationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo`,
    `{createStationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}`
  );
  // Machine create button
  c = r1(c,
    `{createMachineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo`,
    `{createMachineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}`
  );
  // Shift create button: "Tạo ca"
  c = r1(c,
    `{createShiftMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo ca`,
    `{createShiftMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("settings.createShiftBtn")}`
  );
  // Stage create button: "Tạo công đoạn"
  c = r1(c,
    `{createStageMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Tạo công đoạn`,
    `{createStageMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            {t("settings.createStageBtn")}`
  );

  // 17. Delete confirmations
  c = r1(c,
    'Bạn có chắc muốn xóa nhà máy "{factory.name}"? Hành động này không thể hoàn tác.',
    '{t("settings.deleteFactoryConfirm", { name: factory.name })}'
  );
  c = r1(c,
    'Bạn có chắc muốn xóa nhà xưởng "{workshop.name}"?',
    '{t("settings.deleteWorkshopConfirm", { name: workshop.name })}'
  );
  c = r1(c,
    'Bạn có chắc muốn xóa dây chuyền "{line.name}"?',
    '{t("settings.deleteLineConfirm", { name: line.name })}'
  );
  c = r1(c,
    'Bạn có chắc muốn xóa công trạm "{station.name}"?',
    '{t("settings.deleteStationConfirm", { name: station.name })}'
  );

  // 18. Shift status
  c = r1(c, "{shift.isActive ? 'Hoạt động' : 'Tạm dừng'}", "{shift.isActive ? t('settings.shiftActive') : t('settings.shiftPaused')}");

  // 19. "Tất cả nhà máy" in shift form select
  c = r1(c, '<SelectTrigger><SelectValue placeholder="Tất cả nhà máy" /></SelectTrigger>', '<SelectTrigger><SelectValue placeholder={t("settings.allFactoriesShift")} /></SelectTrigger>');
  c = r1(c, '<SelectItem value="all">Tất cả nhà máy</SelectItem>', '<SelectItem value="all">{t("settings.allFactoriesShift")}</SelectItem>');

  // 20. "Không liên kết" in stage form
  c = r1(c, '<SelectItem value="none">Không liên kết</SelectItem>', '<SelectItem value="none">{t("settings.noLink")}</SelectItem>');

  // 21. "Mô tả" label in stage form
  c = r1(c, '<label className="text-sm font-medium">Mô tả</label>', '<label className="text-sm font-medium">{t("common.description")}</label>');

  // 22. Stage count in parentheses
  c = r1(c,
    '<span className="text-sm text-muted-foreground">({lineStages.length} công đoạn)</span>',
    '<span className="text-sm text-muted-foreground">({t("settings.stageCountLabel", { count: lineStages.length })})</span>'
  );

  writeFile(fp, c);
  console.log('  ✅ Settings.tsx done');
}

// ═══════════════════════════════════════════════
// PRODUCTMODELS.TSX
// ═══════════════════════════════════════════════
function processProductModels() {
  console.log('\n📦 Processing ProductModels.tsx...');
  const fp = path.join(PAGES, 'ProductModels.tsx');
  let c = readFile(fp);

  // 1. Validation returns - "Phải là số" (two occurrences in pointValidation)
  c = r1(c, 'if (val && isNaN(Number(val))) return "Phải là số";\n      return null;\n    }},\n    upperLimit:', 'if (val && isNaN(Number(val))) return t("validation.mustBeNumber");\n      return null;\n    }},\n    upperLimit:');
  c = r1(c, 'if (val && isNaN(Number(val))) return "Phải là số";\n      return null;\n    }},\n  });', 'if (val && isNaN(Number(val))) return t("validation.mustBeNumber");\n      return null;\n    }},\n  });');

  // 2. Product CRUD toasts
  c = r1(c, 'toast.success("Tạo sản phẩm thành công");', 'toast.success(t("products.createSuccess"));');
  c = r1(c, 'toast.success("Cập nhật sản phẩm thành công");', 'toast.success(t("products.updateSuccess"));');
  c = r1(c, 'toast.success("Xóa sản phẩm thành công");', 'toast.success(t("products.deleteSuccess"));');

  // 3. Template toasts
  c = r1(c, 'toast.success("Lưu template thành công");', 'toast.success(t("products.templateSaveSuccess"));');
  c = r1(c, 'toast.success("Xóa template thành công");', 'toast.success(t("products.templateDeleteSuccess"));');

  // 4. Measurement point CRUD toasts
  c = r1(c, 'toast.success("Tạo điểm đo thành công");', 'toast.success(t("products.pointCreateSuccess"));');
  c = r1(c, 'toast.success("Cập nhật điểm đo thành công");', 'toast.success(t("products.pointUpdateSuccess"));');
  c = r1(c, 'toast.success("Xóa điểm đo thành công");', 'toast.success(t("products.pointDeleteSuccess"));');

  // 5. Cropped image toast
  c = r1(c, 'toast.success("Đã lưu ảnh mẫu vùng cắt thành công");', 'toast.success(t("products.croppedImageSaveSuccess"));');

  // 6. Error toasts with template literals: `Lỗi: ${error.message}` 
  c = rAll(c, 'toast.error(`Lỗi: ${error.message}`);', 'toast.error(t("common.errorWithMessage", { message: error.message }));');
  c = rAll(c, 'toast.error(`Lỗi upload ảnh: ${error.message}`);', 'toast.error(t("products.uploadImageError", { message: error.message }));');

  // 7. Default measurement point name
  c = r1(c, 'name: `Điểm đo ${measurementPoints.length + 1}`,', 'name: t("products.defaultPointName", { n: measurementPoints.length + 1 }),');

  // 8. Validation toasts
  c = r1(c, 'toast.error("Vui lòng kiểm tra lại thông tin nhập");', 'toast.error(t("validation.pleaseCheckInput"));');
  c = r1(c, 'toast.error("Vui lòng nhập mã và tên sản phẩm");', 'toast.error(t("validation.pleaseEnterCodeAndName"));');
  c = r1(c, 'toast.error("Vui lòng nhập tên template");', 'toast.error(t("validation.pleaseEnterTemplateName"));');
  c = r1(c, 'toast.error("Không có điểm đo nào để lưu");', 'toast.error(t("validation.noPointsToSave"));');
  c = r1(c, 'toast.error("Lỗi khi áp dụng template");', 'toast.error(t("products.templateApplyError"));');

  // 9. Duplicate point toast
  c = r1(c, 'toast.success("Đã sao chép điểm đo");', 'toast.success(t("products.pointDuplicated"));');

  // 10. Template applied toast (template literal)
  c = r1(c,
    'toast.success(`Đã áp dụng template "${template.name}" với ${newPoints.length} điểm đo`);',
    'toast.success(t("products.templateApplied", { name: template.name, count: newPoints.length }));'
  );

  // 11. Batch operations - "Vui lòng chọn ít nhất một điểm đo" (two occurrences)
  c = r1(c, 'toast.error("Vui lòng chọn ít nhất một điểm đo");\n      return;\n    }\n    const newPoints', 'toast.error(t("validation.pleaseSelectAtLeastOnePoint"));\n      return;\n    }\n    const newPoints');
  c = r1(c, 'toast.error("Vui lòng chọn ít nhất một điểm đo");\n      return;\n    }\n    const selectedPoints', 'toast.error(t("validation.pleaseSelectAtLeastOnePoint"));\n      return;\n    }\n    const selectedPoints');

  // 12. Batch delete success
  c = r1(c,
    'toast.success(`Đã xóa ${selectedPointIds.size} điểm đo`);',
    'toast.success(t("products.batchDeleted", { count: selectedPointIds.size }));'
  );

  // 13. CSV export header
  c = r1(c,
    '"Mã,Tên,Loại,Đơn vị,Giới hạn dưới,Giới hạn trên,Giá trị danh định"',
    '[t("products.csvCode"), t("products.csvName"), t("products.csvType"), t("products.csvUnit"), t("products.csvLowerLimit"), t("products.csvUpperLimit"), t("products.csvNominalValue")].join(",")'
  );

  // 14. Batch export success
  c = r1(c,
    'toast.success(`Đã xuất ${selectedPoints.length} điểm đo`);',
    'toast.success(t("products.batchExported", { count: selectedPoints.length }));'
  );

  // 15. Validation function error messages
  c = r1(c, 'errors.code = "Mã điểm đo là bắt buộc";', 'errors.code = t("validation.pointCodeRequired");');
  c = r1(c, 'errors.name = "Tên điểm đo là bắt buộc";', 'errors.name = t("validation.pointNameRequired");');
  c = r1(c, 'errors.code = "Mã điểm đo đã tồn tại";', 'errors.code = t("validation.pointCodeDuplicate");');
  c = r1(c, 'errors.limits = "Giới hạn dưới phải nhỏ hơn giới hạn trên";', 'errors.limits = t("validation.lowerLimitLessThanUpper");');

  writeFile(fp, c);
  console.log('  ✅ ProductModels.tsx done');
}

// ═══════════════════════════════════════════════
// LOCALE FILES
// ═══════════════════════════════════════════════
function updateLocales() {
  console.log('\n🌐 Updating locale files...');

  const newViKeys = {
    common: {
      createBtn: "Tạo",
      errorWithMessage: "Lỗi: {{message}}",
    },
    validation: {
      mustBeNumber: "Phải là số",
      valueRange0to100: "Giá trị từ 0-100",
      pleaseCheckInput: "Vui lòng kiểm tra lại thông tin nhập",
      pleaseEnterCodeAndName: "Vui lòng nhập mã và tên sản phẩm",
      pleaseEnterTemplateName: "Vui lòng nhập tên template",
      noPointsToSave: "Không có điểm đo nào để lưu",
      pleaseSelectAtLeastOnePoint: "Vui lòng chọn ít nhất một điểm đo",
      pointCodeRequired: "Mã điểm đo là bắt buộc",
      pointNameRequired: "Tên điểm đo là bắt buộc",
      pointCodeDuplicate: "Mã điểm đo đã tồn tại",
      lowerLimitLessThanUpper: "Giới hạn dưới phải nhỏ hơn giới hạn trên",
    },
    dashboard: {
      ngReportTitle: "Báo cáo NG Visual",
      timeRangeLabel: "Khoảng thời gian",
      exportDateLabel: "Ngày xuất",
      ngRateByWorkstation: "Tỉ lệ NG theo Công trạm",
      codeCol: "Mã",
      workstationNameCol: "Tên công trạm",
      totalInspectionCol: "Tổng kiểm tra",
      ngCountCol: "Số NG",
      ngRateCol: "Tỉ lệ NG (%)",
      topNgPoints: "Top Điểm đo có tỉ lệ NG cao",
      pointNameCol: "Tên điểm đo",
      workstationCol: "Công trạm",
      reportFooter: "Báo cáo được tạo tự động bởi hệ thống AVI/AOI Management",
      exportSuccess: "Xuất báo cáo thành công!",
      exportSuccessDesc: "File HTML đã được tải xuống. Bạn có thể mở và in thành PDF.",
      exportReportError: "Lỗi xuất báo cáo",
      exportReportErrorDesc: "Không thể tạo file báo cáo. Vui lòng thử lại.",
      below: "dưới",
      exceeds: "vượt",
      criticalThresholdMsg: "{{metric}} {{direction}} ngưỡng nguy hiểm: {{value}}% (ngưỡng: {{threshold}}%)",
      warningThresholdMsg: "{{metric}} {{direction}} ngưỡng cảnh báo: {{value}}% (ngưỡng: {{threshold}}%)",
    },
    history: {
      filterNgToday: "NG hôm nay",
      filterThisWeek: "Tuần này",
      noDataToExport: "Không có dữ liệu để xuất",
      exportedRecords: "Đã xuất {{count}} bản ghi thành công",
      exportError: "Lỗi khi xuất dữ liệu",
      bulkExportError: "Lỗi khi xuất dữ liệu hàng loạt",
      pleaseSelectAtLeast1: "Vui lòng chọn ít nhất 1 bản ghi",
      acknowledgedRecords: "Đã xác nhận {{count}} bản ghi thành công",
      acknowledgeError: "Lỗi khi xác nhận hàng loạt",
      noYieldData: "Không có dữ liệu Yield để xuất",
      yieldExportSuccess: "Đã xuất báo cáo Yield thành công ({{format}})",
      yieldExportError: "Lỗi khi xuất báo cáo Yield",
      csvStt: "STT",
      csvSnCode: "Mã SN",
      csvFactoryCode: "Mã nhà máy",
      csvWorkshopCode: "Mã nhà xưởng",
      csvLine: "Dây chuyền",
      csvWorkstation: "Công trạm",
      csvMachine: "Máy",
      csvMachineType: "Loại máy",
      csvProductCode: "Mã sản phẩm",
      csvResult: "Kết quả",
      csvTotalPoints: "Tổng điểm đo",
      csvInspectionTime: "Thời gian kiểm tra",
      csvRemarks: "Ghi chú",
      yieldDate: "Ngày",
      yieldTotalProducts: "Tổng sản phẩm",
      yieldSummary: "Tổng cộng",
      yieldReportTitle: "BÁO CÁO YIELD - FPY/FY/NTF/UPH",
      dateExport: "Ngày xuất",
      overviewLabel: "Tổng quan",
      wsWorkstation: "Công trạm",
      wsCode: "Mã",
      wsTotal: "Tổng",
      workstationReportTitle: "BÁO CÁO PHÂN TÍCH CÔNG TRẠM",
      summaryLabel: "Tóm tắt",
      totalWorkstations: "Tổng công trạm",
      totalNgDefects: "Tổng lỗi NG",
      avgYield: "Yield trung bình",
      workstationExportSuccess: "Đã xuất báo cáo công trạm thành công ({{format}})",
      workstationExportError: "Lỗi khi xuất báo cáo công trạm",
      searchFilter: "Bộ lọc tìm kiếm",
      filterDescription: "Lọc theo mã nhà máy, nhà xưởng, SN sản phẩm, dây chuyền, công trạm, máy",
      factoryCodeLabel: "Mã nhà máy",
      workshopCodeLabel: "Mã nhà xưởng",
      lineCodeLabel: "Mã dây chuyền",
      stationCodeLabel: "Mã công trạm",
      machineCodeLabel: "Mã máy",
      productCodeLabel: "Mã sản phẩm",
      resultLabel: "Kết quả",
      dateRangeLabel: "Khoảng thời gian",
      fromDate: "Từ ngày",
      toDate: "Đến ngày",
      clearFilters: "Xóa bộ lọc",
      savedFiltersBtn: "Bộ lọc đã lưu",
      scanBarcode: "Quét mã vạch/QR",
    },
    settings: {
      createAlertSuccess: "Tạo cảnh báo thành công",
      updateAlertSuccess: "Cập nhật cảnh báo thành công",
      deleteAlertSuccess: "Xóa cảnh báo thành công",
      createFactorySuccess: "Tạo nhà máy thành công",
      updateFactorySuccess: "Cập nhật nhà máy thành công",
      deleteFactorySuccess: "Xóa nhà máy thành công",
      createWorkshopSuccess: "Tạo nhà xưởng thành công",
      updateWorkshopSuccess: "Cập nhật nhà xưởng thành công",
      deleteWorkshopSuccess: "Xóa nhà xưởng thành công",
      createLineSuccess: "Tạo dây chuyền thành công",
      updateLineSuccess: "Cập nhật dây chuyền thành công",
      deleteLineSuccess: "Xóa dây chuyền thành công",
      createStationSuccess: "Tạo công trạm thành công",
      updateStationSuccess: "Cập nhật công trạm thành công",
      deleteStationSuccess: "Xóa công trạm thành công",
      createMachineSuccessWithKey: "Tạo máy thành công. API Key: {{apiKey}}",
      updateMachineSuccess: "Cập nhật máy thành công",
      deleteMachineSuccess: "Xóa máy thành công",
      uploadImageSuccess: "Upload ảnh {{imageType}} thành công",
      pleaseSelectImageFile: "Vui lòng chọn file ảnh",
      maxFileSize5mb: "Kích thước file tối đa 5MB",
      uploadImageError: "Lỗi khi upload ảnh",
      createShiftSuccess: "Tạo ca làm việc thành công",
      updateShiftSuccess: "Cập nhật ca làm việc thành công",
      deleteShiftSuccess: "Xóa ca làm việc thành công",
      createStageSuccess: "Tạo công đoạn thành công",
      updateStageSuccess: "Cập nhật công đoạn thành công",
      deleteStageSuccess: "Xóa công đoạn thành công",
      reorderSuccess: "Sắp xếp lại thành công",
      copiedToClipboard: "Đã copy vào clipboard",
      seedDataBtn: "Tạo dữ liệu mẫu",
      seedInspectionsBtn: "Tạo 100 inspection",
      factoryCount: "{{count}} nhà máy",
      workshopCount: "{{count}} nhà xưởng",
      lineCount: "{{count}} dây chuyền",
      stationCount: "{{count}} công trạm",
      machineCount: "{{count}} máy",
      stageCount: "{{count}} công đoạn",
      factoryNamePlaceholder: "VD: Nhà máy Bắc Ninh",
      workshopNamePlaceholder: "VD: Xưởng lắp ráp A",
      lineNamePlaceholder: "VD: Dây chuyền SMT 1",
      stationNamePlaceholder: "VD: Trạm kiểm tra AOI",
      machineNamePlaceholder: "VD: Máy AVI kiểm tra PCB",
      manufacturerPlaceholder: "Nhà sản xuất",
      alertNamePlaceholder: "VD: Cảnh báo FPY thấp",
      shiftNamePlaceholder: "VD: Ca sáng",
      stageNamePlaceholder: "VD: Lắp ráp, Kiểm tra...",
      stageCodePlaceholder: "VD: A, B, C...",
      hourPlaceholder: "Giờ",
      minutePlaceholder: "Phút",
      createShiftBtn: "Tạo ca",
      createStageBtn: "Tạo công đoạn",
      deleteFactoryConfirm: "Bạn có chắc muốn xóa nhà máy \"{{name}}\"? Hành động này không thể hoàn tác.",
      deleteWorkshopConfirm: "Bạn có chắc muốn xóa nhà xưởng \"{{name}}\"?",
      deleteLineConfirm: "Bạn có chắc muốn xóa dây chuyền \"{{name}}\"?",
      deleteStationConfirm: "Bạn có chắc muốn xóa công trạm \"{{name}}\"?",
      shiftActive: "Hoạt động",
      shiftPaused: "Tạm dừng",
      allFactoriesShift: "Tất cả nhà máy",
      noLink: "Không liên kết",
      stageCountLabel: "{{count}} công đoạn",
    },
    products: {
      createSuccess: "Tạo sản phẩm thành công",
      updateSuccess: "Cập nhật sản phẩm thành công",
      deleteSuccess: "Xóa sản phẩm thành công",
      templateSaveSuccess: "Lưu template thành công",
      templateDeleteSuccess: "Xóa template thành công",
      pointCreateSuccess: "Tạo điểm đo thành công",
      pointUpdateSuccess: "Cập nhật điểm đo thành công",
      pointDeleteSuccess: "Xóa điểm đo thành công",
      croppedImageSaveSuccess: "Đã lưu ảnh mẫu vùng cắt thành công",
      uploadImageError: "Lỗi upload ảnh: {{message}}",
      defaultPointName: "Điểm đo {{n}}",
      templateApplied: "Đã áp dụng template \"{{name}}\" với {{count}} điểm đo",
      templateApplyError: "Lỗi khi áp dụng template",
      pointDuplicated: "Đã sao chép điểm đo",
      batchDeleted: "Đã xóa {{count}} điểm đo",
      batchExported: "Đã xuất {{count}} điểm đo",
      csvCode: "Mã",
      csvName: "Tên",
      csvType: "Loại",
      csvUnit: "Đơn vị",
      csvLowerLimit: "Giới hạn dưới",
      csvUpperLimit: "Giới hạn trên",
      csvNominalValue: "Giá trị danh định",
    },
  };

  const newEnKeys = {
    common: {
      createBtn: "Create",
      errorWithMessage: "Error: {{message}}",
    },
    validation: {
      mustBeNumber: "Must be a number",
      valueRange0to100: "Value must be 0-100",
      pleaseCheckInput: "Please check input information",
      pleaseEnterCodeAndName: "Please enter product code and name",
      pleaseEnterTemplateName: "Please enter template name",
      noPointsToSave: "No measurement points to save",
      pleaseSelectAtLeastOnePoint: "Please select at least one measurement point",
      pointCodeRequired: "Point code is required",
      pointNameRequired: "Point name is required",
      pointCodeDuplicate: "Point code already exists",
      lowerLimitLessThanUpper: "Lower limit must be less than upper limit",
    },
    dashboard: {
      ngReportTitle: "NG Visual Report",
      timeRangeLabel: "Time Range",
      exportDateLabel: "Export Date",
      ngRateByWorkstation: "NG Rate by Workstation",
      codeCol: "Code",
      workstationNameCol: "Workstation Name",
      totalInspectionCol: "Total Inspections",
      ngCountCol: "NG Count",
      ngRateCol: "NG Rate (%)",
      topNgPoints: "Top Measurement Points with High NG Rate",
      pointNameCol: "Point Name",
      workstationCol: "Workstation",
      reportFooter: "Report automatically generated by AVI/AOI Management system",
      exportSuccess: "Report exported successfully!",
      exportSuccessDesc: "HTML file has been downloaded. You can open and print as PDF.",
      exportReportError: "Export report error",
      exportReportErrorDesc: "Cannot create report file. Please try again.",
      below: "below",
      exceeds: "exceeds",
      criticalThresholdMsg: "{{metric}} {{direction}} critical threshold: {{value}}% (threshold: {{threshold}}%)",
      warningThresholdMsg: "{{metric}} {{direction}} warning threshold: {{value}}% (threshold: {{threshold}}%)",
    },
    history: {
      filterNgToday: "NG Today",
      filterThisWeek: "This Week",
      noDataToExport: "No data to export",
      exportedRecords: "Exported {{count}} records successfully",
      exportError: "Error exporting data",
      bulkExportError: "Error bulk exporting data",
      pleaseSelectAtLeast1: "Please select at least 1 record",
      acknowledgedRecords: "Acknowledged {{count}} records successfully",
      acknowledgeError: "Error bulk acknowledging",
      noYieldData: "No Yield data to export",
      yieldExportSuccess: "Yield report exported successfully ({{format}})",
      yieldExportError: "Error exporting Yield report",
      csvStt: "No.",
      csvSnCode: "SN Code",
      csvFactoryCode: "Factory Code",
      csvWorkshopCode: "Workshop Code",
      csvLine: "Line",
      csvWorkstation: "Workstation",
      csvMachine: "Machine",
      csvMachineType: "Machine Type",
      csvProductCode: "Product Code",
      csvResult: "Result",
      csvTotalPoints: "Total Points",
      csvInspectionTime: "Inspection Time",
      csvRemarks: "Remarks",
      yieldDate: "Date",
      yieldTotalProducts: "Total Products",
      yieldSummary: "Total",
      yieldReportTitle: "YIELD REPORT - FPY/FY/NTF/UPH",
      dateExport: "Export Date",
      overviewLabel: "Overview",
      wsWorkstation: "Workstation",
      wsCode: "Code",
      wsTotal: "Total",
      workstationReportTitle: "WORKSTATION ANALYSIS REPORT",
      summaryLabel: "Summary",
      totalWorkstations: "Total Workstations",
      totalNgDefects: "Total NG Defects",
      avgYield: "Average Yield",
      workstationExportSuccess: "Workstation report exported successfully ({{format}})",
      workstationExportError: "Error exporting workstation report",
      searchFilter: "Search Filters",
      filterDescription: "Filter by factory code, workshop, product SN, line, workstation, machine",
      factoryCodeLabel: "Factory Code",
      workshopCodeLabel: "Workshop Code",
      lineCodeLabel: "Line Code",
      stationCodeLabel: "Station Code",
      machineCodeLabel: "Machine Code",
      productCodeLabel: "Product Code",
      resultLabel: "Result",
      dateRangeLabel: "Date Range",
      fromDate: "From Date",
      toDate: "To Date",
      clearFilters: "Clear Filters",
      savedFiltersBtn: "Saved Filters",
      scanBarcode: "Scan Barcode/QR",
    },
    settings: {
      createAlertSuccess: "Alert created successfully",
      updateAlertSuccess: "Alert updated successfully",
      deleteAlertSuccess: "Alert deleted successfully",
      createFactorySuccess: "Factory created successfully",
      updateFactorySuccess: "Factory updated successfully",
      deleteFactorySuccess: "Factory deleted successfully",
      createWorkshopSuccess: "Workshop created successfully",
      updateWorkshopSuccess: "Workshop updated successfully",
      deleteWorkshopSuccess: "Workshop deleted successfully",
      createLineSuccess: "Line created successfully",
      updateLineSuccess: "Line updated successfully",
      deleteLineSuccess: "Line deleted successfully",
      createStationSuccess: "Station created successfully",
      updateStationSuccess: "Station updated successfully",
      deleteStationSuccess: "Station deleted successfully",
      createMachineSuccessWithKey: "Machine created successfully. API Key: {{apiKey}}",
      updateMachineSuccess: "Machine updated successfully",
      deleteMachineSuccess: "Machine deleted successfully",
      uploadImageSuccess: "Image {{imageType}} uploaded successfully",
      pleaseSelectImageFile: "Please select an image file",
      maxFileSize5mb: "Maximum file size is 5MB",
      uploadImageError: "Error uploading image",
      createShiftSuccess: "Shift created successfully",
      updateShiftSuccess: "Shift updated successfully",
      deleteShiftSuccess: "Shift deleted successfully",
      createStageSuccess: "Stage created successfully",
      updateStageSuccess: "Stage updated successfully",
      deleteStageSuccess: "Stage deleted successfully",
      reorderSuccess: "Reordered successfully",
      copiedToClipboard: "Copied to clipboard",
      seedDataBtn: "Generate sample data",
      seedInspectionsBtn: "Generate 100 inspections",
      factoryCount: "{{count}} factories",
      workshopCount: "{{count}} workshops",
      lineCount: "{{count}} lines",
      stationCount: "{{count}} stations",
      machineCount: "{{count}} machines",
      stageCount: "{{count}} stages",
      factoryNamePlaceholder: "E.g.: Main Factory",
      workshopNamePlaceholder: "E.g.: Assembly Workshop A",
      lineNamePlaceholder: "E.g.: SMT Line 1",
      stationNamePlaceholder: "E.g.: AOI Inspection Station",
      machineNamePlaceholder: "E.g.: AVI PCB Inspection Machine",
      manufacturerPlaceholder: "Manufacturer",
      alertNamePlaceholder: "E.g.: Low FPY Alert",
      shiftNamePlaceholder: "E.g.: Morning Shift",
      stageNamePlaceholder: "E.g.: Assembly, Inspection...",
      stageCodePlaceholder: "E.g.: A, B, C...",
      hourPlaceholder: "Hour",
      minutePlaceholder: "Minute",
      createShiftBtn: "Create Shift",
      createStageBtn: "Create Stage",
      deleteFactoryConfirm: "Are you sure you want to delete factory \"{{name}}\"? This action cannot be undone.",
      deleteWorkshopConfirm: "Are you sure you want to delete workshop \"{{name}}\"?",
      deleteLineConfirm: "Are you sure you want to delete line \"{{name}}\"?",
      deleteStationConfirm: "Are you sure you want to delete station \"{{name}}\"?",
      shiftActive: "Active",
      shiftPaused: "Paused",
      allFactoriesShift: "All Factories",
      noLink: "No Link",
      stageCountLabel: "{{count}} stages",
    },
    products: {
      createSuccess: "Product created successfully",
      updateSuccess: "Product updated successfully",
      deleteSuccess: "Product deleted successfully",
      templateSaveSuccess: "Template saved successfully",
      templateDeleteSuccess: "Template deleted successfully",
      pointCreateSuccess: "Measurement point created successfully",
      pointUpdateSuccess: "Measurement point updated successfully",
      pointDeleteSuccess: "Measurement point deleted successfully",
      croppedImageSaveSuccess: "Cropped reference image saved successfully",
      uploadImageError: "Image upload error: {{message}}",
      defaultPointName: "Point {{n}}",
      templateApplied: "Applied template \"{{name}}\" with {{count}} points",
      templateApplyError: "Error applying template",
      pointDuplicated: "Measurement point duplicated",
      batchDeleted: "Deleted {{count}} measurement points",
      batchExported: "Exported {{count}} measurement points",
      csvCode: "Code",
      csvName: "Name",
      csvType: "Type",
      csvUnit: "Unit",
      csvLowerLimit: "Lower Limit",
      csvUpperLimit: "Upper Limit",
      csvNominalValue: "Nominal Value",
    },
  };

  const newZhKeys = {
    common: {
      createBtn: "创建",
      errorWithMessage: "错误：{{message}}",
    },
    validation: {
      mustBeNumber: "必须是数字",
      valueRange0to100: "值必须在0-100之间",
      pleaseCheckInput: "请检查输入信息",
      pleaseEnterCodeAndName: "请输入产品编码和名称",
      pleaseEnterTemplateName: "请输入模板名称",
      noPointsToSave: "没有测量点可保存",
      pleaseSelectAtLeastOnePoint: "请至少选择一个测量点",
      pointCodeRequired: "测量点编码是必填项",
      pointNameRequired: "测量点名称是必填项",
      pointCodeDuplicate: "测量点编码已存在",
      lowerLimitLessThanUpper: "下限必须小于上限",
    },
    dashboard: {
      ngReportTitle: "NG可视化报告",
      timeRangeLabel: "时间范围",
      exportDateLabel: "导出日期",
      ngRateByWorkstation: "按工站的NG率",
      codeCol: "编码",
      workstationNameCol: "工站名称",
      totalInspectionCol: "总检测数",
      ngCountCol: "NG数量",
      ngRateCol: "NG率 (%)",
      topNgPoints: "NG率最高的测量点",
      pointNameCol: "测量点名称",
      workstationCol: "工站",
      reportFooter: "报告由AVI/AOI管理系统自动生成",
      exportSuccess: "报告导出成功！",
      exportSuccessDesc: "HTML文件已下载。您可以打开并打印为PDF。",
      exportReportError: "导出报告错误",
      exportReportErrorDesc: "无法创建报告文件。请重试。",
      below: "低于",
      exceeds: "超过",
      criticalThresholdMsg: "{{metric}} {{direction}} 危险阈值：{{value}}%（阈值：{{threshold}}%）",
      warningThresholdMsg: "{{metric}} {{direction}} 警告阈值：{{value}}%（阈值：{{threshold}}%）",
    },
    history: {
      filterNgToday: "今日NG",
      filterThisWeek: "本周",
      noDataToExport: "没有数据可导出",
      exportedRecords: "成功导出 {{count}} 条记录",
      exportError: "导出数据时出错",
      bulkExportError: "批量导出数据时出错",
      pleaseSelectAtLeast1: "请至少选择1条记录",
      acknowledgedRecords: "成功确认 {{count}} 条记录",
      acknowledgeError: "批量确认时出错",
      noYieldData: "没有Yield数据可导出",
      yieldExportSuccess: "Yield报告导出成功 ({{format}})",
      yieldExportError: "导出Yield报告时出错",
      csvStt: "序号",
      csvSnCode: "SN编码",
      csvFactoryCode: "工厂编码",
      csvWorkshopCode: "车间编码",
      csvLine: "产线",
      csvWorkstation: "工站",
      csvMachine: "设备",
      csvMachineType: "设备类型",
      csvProductCode: "产品编码",
      csvResult: "结果",
      csvTotalPoints: "总测量点",
      csvInspectionTime: "检测时间",
      csvRemarks: "备注",
      yieldDate: "日期",
      yieldTotalProducts: "总产品",
      yieldSummary: "合计",
      yieldReportTitle: "良率报告 - FPY/FY/NTF/UPH",
      dateExport: "导出日期",
      overviewLabel: "总览",
      wsWorkstation: "工站",
      wsCode: "编码",
      wsTotal: "总计",
      workstationReportTitle: "工站分析报告",
      summaryLabel: "摘要",
      totalWorkstations: "总工站数",
      totalNgDefects: "总NG缺陷",
      avgYield: "平均良率",
      workstationExportSuccess: "工站报告导出成功 ({{format}})",
      workstationExportError: "导出工站报告时出错",
      searchFilter: "搜索过滤器",
      filterDescription: "按工厂编码、车间、产品SN、产线、工站、设备筛选",
      factoryCodeLabel: "工厂编码",
      workshopCodeLabel: "车间编码",
      lineCodeLabel: "产线编码",
      stationCodeLabel: "工站编码",
      machineCodeLabel: "设备编码",
      productCodeLabel: "产品编码",
      resultLabel: "结果",
      dateRangeLabel: "时间范围",
      fromDate: "从日期",
      toDate: "到日期",
      clearFilters: "清除过滤器",
      savedFiltersBtn: "已保存的过滤器",
      scanBarcode: "扫描条码/二维码",
    },
    settings: {
      createAlertSuccess: "创建警报成功",
      updateAlertSuccess: "更新警报成功",
      deleteAlertSuccess: "删除警报成功",
      createFactorySuccess: "创建工厂成功",
      updateFactorySuccess: "更新工厂成功",
      deleteFactorySuccess: "删除工厂成功",
      createWorkshopSuccess: "创建车间成功",
      updateWorkshopSuccess: "更新车间成功",
      deleteWorkshopSuccess: "删除车间成功",
      createLineSuccess: "创建产线成功",
      updateLineSuccess: "更新产线成功",
      deleteLineSuccess: "删除产线成功",
      createStationSuccess: "创建工站成功",
      updateStationSuccess: "更新工站成功",
      deleteStationSuccess: "删除工站成功",
      createMachineSuccessWithKey: "创建设备成功。API Key：{{apiKey}}",
      updateMachineSuccess: "更新设备成功",
      deleteMachineSuccess: "删除设备成功",
      uploadImageSuccess: "{{imageType}} 图片上传成功",
      pleaseSelectImageFile: "请选择图片文件",
      maxFileSize5mb: "文件最大5MB",
      uploadImageError: "上传图片时出错",
      createShiftSuccess: "创建班次成功",
      updateShiftSuccess: "更新班次成功",
      deleteShiftSuccess: "删除班次成功",
      createStageSuccess: "创建工序成功",
      updateStageSuccess: "更新工序成功",
      deleteStageSuccess: "删除工序成功",
      reorderSuccess: "重新排序成功",
      copiedToClipboard: "已复制到剪贴板",
      seedDataBtn: "生成示例数据",
      seedInspectionsBtn: "生成100条检测",
      factoryCount: "{{count}} 个工厂",
      workshopCount: "{{count}} 个车间",
      lineCount: "{{count}} 条产线",
      stationCount: "{{count}} 个工站",
      machineCount: "{{count}} 台设备",
      stageCount: "{{count}} 个工序",
      factoryNamePlaceholder: "例如：主工厂",
      workshopNamePlaceholder: "例如：装配车间A",
      lineNamePlaceholder: "例如：SMT产线1",
      stationNamePlaceholder: "例如：AOI检测站",
      machineNamePlaceholder: "例如：AVI PCB检测机",
      manufacturerPlaceholder: "制造商",
      alertNamePlaceholder: "例如：FPY低警报",
      shiftNamePlaceholder: "例如：早班",
      stageNamePlaceholder: "例如：装配、检测...",
      stageCodePlaceholder: "例如：A、B、C...",
      hourPlaceholder: "时",
      minutePlaceholder: "分",
      createShiftBtn: "创建班次",
      createStageBtn: "创建工序",
      deleteFactoryConfirm: "确定要删除工厂\"{{name}}\"吗？此操作不可撤销。",
      deleteWorkshopConfirm: "确定要删除车间\"{{name}}\"吗？",
      deleteLineConfirm: "确定要删除产线\"{{name}}\"吗？",
      deleteStationConfirm: "确定要删除工站\"{{name}}\"吗？",
      shiftActive: "运行中",
      shiftPaused: "已暂停",
      allFactoriesShift: "所有工厂",
      noLink: "不关联",
      stageCountLabel: "{{count}} 个工序",
    },
    products: {
      createSuccess: "创建产品成功",
      updateSuccess: "更新产品成功",
      deleteSuccess: "删除产品成功",
      templateSaveSuccess: "模板保存成功",
      templateDeleteSuccess: "模板删除成功",
      pointCreateSuccess: "创建测量点成功",
      pointUpdateSuccess: "更新测量点成功",
      pointDeleteSuccess: "删除测量点成功",
      croppedImageSaveSuccess: "裁剪参考图片保存成功",
      uploadImageError: "图片上传错误：{{message}}",
      defaultPointName: "测量点 {{n}}",
      templateApplied: "已应用模板\"{{name}}\"，包含 {{count}} 个测量点",
      templateApplyError: "应用模板时出错",
      pointDuplicated: "已复制测量点",
      batchDeleted: "已删除 {{count}} 个测量点",
      batchExported: "已导出 {{count}} 个测量点",
      csvCode: "编码",
      csvName: "名称",
      csvType: "类型",
      csvUnit: "单位",
      csvLowerLimit: "下限",
      csvUpperLimit: "上限",
      csvNominalValue: "标称值",
    },
  };

  // Update vi.json
  const viPath = path.join(LOCALES, 'vi.json');
  const vi = readJsonFile(viPath);
  deepMerge(vi, newViKeys);
  writeJsonFile(viPath, vi);
  console.log('  ✅ vi.json updated');

  // Update en.json
  const enPath = path.join(LOCALES, 'en.json');
  const en = readJsonFile(enPath);
  deepMerge(en, newEnKeys);
  writeJsonFile(enPath, en);
  console.log('  ✅ en.json updated');

  // Update zh.json
  const zhPath = path.join(LOCALES, 'zh.json');
  const zh = readJsonFile(zhPath);
  deepMerge(zh, newZhKeys);
  writeJsonFile(zhPath, zh);
  console.log('  ✅ zh.json updated');
}

// ═══════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════
console.log('🚀 i18n Cleanup Migration - Phase 2');
console.log('====================================\n');

// First, revert TSX files to clean state before phase 2
// (Not needed - we build on top of phase 1 results)

processDashboard();
processHistory();
processSettings();
processProductModels();
updateLocales();

console.log('\n====================================');
console.log('🎉 Phase 2 migration complete!');
console.log('Run: npx tsc --noEmit to verify.');
