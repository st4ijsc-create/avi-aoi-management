import { readFileSync, writeFileSync } from 'fs';

// Helper: read file normalizing CRLF and BOM
function readF(p) {
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

// Helper: write file with CRLF
function writeF(p, content) {
  writeFileSync(p, content.replace(/\n/g, '\r\n'), 'utf8');
}

const base = 'client/src/pages';
const localeBase = 'client/src/i18n/locales';

// ============================================================
// PART 1: Fix Dashboard.tsx misses (5)
// ============================================================
let dash = readF(`${base}/Dashboard.tsx`);
let dashHits = 0;
let dashMisses = 0;

function dashReplace(oldStr, newStr, label) {
  if (dash.includes(oldStr)) {
    dash = dash.replace(oldStr, newStr);
    dashHits++;
    console.log(`  [DASH HIT] ${label}`);
  } else {
    dashMisses++;
    console.log(`  [DASH MISS] ${label}`);
  }
}

// 1. "Cảnh báo" button text (L930)
dashReplace(
  `<Bell className="h-4 w-4 mr-1" />\n                    Cảnh báo`,
  `<Bell className="h-4 w-4 mr-1" />\n                    {t("dashboard.alerts")}`,
  'alerts button'
);

// 2. "Chi tiết" button text (L1226)
dashReplace(
  `<Button variant="ghost" size="sm" className="h-6 text-xs px-2">\n                    Chi tiết`,
  `<Button variant="ghost" size="sm" className="h-6 text-xs px-2">\n                    {t("common.details")}`,
  'details button'
);

// 3. "Xóa bộ lọc" with XCircle icon (L1816)
dashReplace(
  `<XCircle className="h-4 w-4 mr-1" />\n                          Xóa bộ lọc`,
  `<XCircle className="h-4 w-4 mr-1" />\n                          {t("history.clearFilters")}`,
  'clearFilters XCircle'
);

// 4. noPointData EmptyState (L1957)
dashReplace(
  `title="Chưa có dữ liệu điểm đo"\n                      description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra."`,
  `title={t("dashboard.noPointData")}\n                      description={t("dashboard.noPointDataDesc")}`,
  'noPointData EmptyState'
);

writeF(`${base}/Dashboard.tsx`, dash);
console.log(`Dashboard.tsx: ${dashHits} hits, ${dashMisses} misses\n`);

// ============================================================
// PART 2: Fix History.tsx misses (20)
// ============================================================
let hist = readF(`${base}/History.tsx`);
let histHits = 0;
let histMisses = 0;

function histReplace(oldStr, newStr, label) {
  if (hist.includes(oldStr)) {
    hist = hist.replace(oldStr, newStr);
    histHits++;
    console.log(`  [HIST HIT] ${label}`);
  } else {
    histMisses++;
    console.log(`  [HIST MISS] ${label}`);
  }
}

// 1. "Lưu bộ lọc hiện tại" (L1030-1031)
histReplace(
  `<Save className="h-4 w-4 mr-2" />\n                      Lưu bộ lọc hiện tại`,
  `<Save className="h-4 w-4 mr-2" />\n                      {t("history.saveCurrentFilter")}`,
  'saveCurrentFilter'
);

// 2. "Hiển thị cột" (L1096)
histReplace(
  `<h4 className="font-medium text-sm">Hiển thị cột</h4>`,
  `<h4 className="font-medium text-sm">{t("history.showColumns")}</h4>`,
  'showColumns'
);

// 3. "Xuất Excel" button text (L1138)
histReplace(
  `<Download className="h-4 w-4" />\n                      )}\n                      Xuất Excel`,
  `<Download className="h-4 w-4" />\n                      )}\n                      {t("history.exportExcelBtn")}`,
  'exportExcel button'
);

// 4. "Chọn tất cả" label with count (L1153)
histReplace(
  `<label htmlFor="select-all" className="text-sm cursor-pointer">\n                        Chọn tất cả ({data.data.length})`,
  `<label htmlFor="select-all" className="text-sm cursor-pointer">\n                        {t("common.selectAll")} ({data.data.length})`,
  'selectAll label'
);

// 5. "Xuất ({selectedIds.size})" (L1176)
histReplace(
  `<Download className="h-4 w-4" />\n                          )}\n                          Xuất ({selectedIds.size})`,
  `<Download className="h-4 w-4" />\n                          )}\n                          {t("common.export")} ({selectedIds.size})`,
  'export count'
);

// 6. "Xác nhận ({selectedIds.size})" (L1190)
histReplace(
  `<CheckCheck className="h-4 w-4" />\n                          )}\n                          Xác nhận ({selectedIds.size})`,
  `<CheckCheck className="h-4 w-4" />\n                          )}\n                          {t("common.confirm")} ({selectedIds.size})`,
  'confirm count'
);

// 7. "Máy" table header (L1465)
histReplace(
  `<th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Máy</th>`,
  `<th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">{t("history.machine")}</th>`,
  'machine th'
);

// 8. "Tải thêm dữ liệu ({analysisLimit}/...)" (L1508)
histReplace(
  `Tải thêm dữ liệu ({analysisLimit}/{allData?.total || 0})`,
  `{t("history.loadMoreData")} ({analysisLimit}/{allData?.total || 0})`,
  'loadMore with count'
);

// 9. "Tổng" product stats header (L1576) 
histReplace(
  `<th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Tổng</th>`,
  `<th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">{t("common.total")}</th>`,
  'total product stats th'
);

// 10. "Thử tìm kiếm với bộ lọc khác" (L1610)
histReplace(
  `<p className="text-sm text-muted-foreground mt-1">Thử tìm kiếm với bộ lọc khác</p>`,
  `<p className="text-sm text-muted-foreground mt-1">{t("history.tryDifferentFilters")}</p>`,
  'tryDifferentFilters'
);

// 11. "Tất cả" time filter button (L1665)
histReplace(
  `onClick={() => setWorkstationDateRange("all")}\n                        className="w-full"\n                      >\n                        Tất cả`,
  `onClick={() => setWorkstationDateRange("all")}\n                        className="w-full"\n                      >\n                        {t("common.all")}`,
  'all time filter'
);

// 12. "Hôm nay" time filter button (L1672)
histReplace(
  `onClick={() => setWorkstationDateRange("today")}\n                        className="w-full"\n                      >\n                        Hôm nay`,
  `onClick={() => setWorkstationDateRange("today")}\n                        className="w-full"\n                      >\n                        {t("history.today")}`,
  'today time filter'
);

// 13. "Tuần này" time filter button (L1679)
histReplace(
  `onClick={() => setWorkstationDateRange("week")}\n                        className="w-full"\n                      >\n                        Tuần này`,
  `onClick={() => setWorkstationDateRange("week")}\n                        className="w-full"\n                      >\n                        {t("history.thisWeek")}`,
  'thisWeek time filter'
);

// 14. "Tháng này" time filter button (L1686)
histReplace(
  `onClick={() => setWorkstationDateRange("month")}\n                        className="w-full"\n                      >\n                        Tháng này`,
  `onClick={() => setWorkstationDateRange("month")}\n                        className="w-full"\n                      >\n                        {t("history.thisMonth")}`,
  'thisMonth time filter'
);

// 15. "Từ ngày" label (L1692)
histReplace(
  `<label className="text-sm font-medium">Từ ngày</label>`,
  `<label className="text-sm font-medium">{t("history.fromDate")}</label>`,
  'fromDate label'
);

// 16. "Đến ngày" label (L1701)
histReplace(
  `<label className="text-sm font-medium">Đến ngày</label>`,
  `<label className="text-sm font-medium">{t("history.toDate")}</label>`,
  'toDate label'
);

// 17. noPointData EmptyState History (L1851)
histReplace(
  `title="Chưa có dữ liệu điểm đo"\n                        description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo."`,
  `title={t("history.noPointData")}\n                        description={t("history.noPointDataDesc")}`,
  'noPointData EmptyState'
);

// 18. "Mã" table header (L1871)
histReplace(
  `<th className="text-left py-2 px-2">Mã</th>`,
  `<th className="text-left py-2 px-2">{t("common.code")}</th>`,
  'code th'
);

// 19. noWorkstationData EmptyState History (L1912)
histReplace(
  `title="Chưa có dữ liệu công trạm"\n                                description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo được gán công trạm."`,
  `title={t("dashboard.noWorkstationData")}\n                                description={t("dashboard.noWorkstationDataDesc")}`,
  'noWorkstationData EmptyState'
);

writeF(`${base}/History.tsx`, hist);
console.log(`History.tsx: ${histHits} hits, ${histMisses} misses\n`);

// ============================================================
// PART 3: Fix ProductModels.tsx misses (26+)
// ============================================================
let prod = readF(`${base}/ProductModels.tsx`);
let prodHits = 0;
let prodMisses = 0;

function prodReplace(oldStr, newStr, label) {
  if (prod.includes(oldStr)) {
    prod = prod.replace(oldStr, newStr);
    prodHits++;
    console.log(`  [PROD HIT] ${label}`);
  } else {
    prodMisses++;
    console.log(`  [PROD MISS] ${label}`);
  }
}

// 1. "Đã lọc" badge (L1168)
prodReplace(
  `<Badge variant="secondary" className="gap-1">\n                    Đã lọc`,
  `<Badge variant="secondary" className="gap-1">\n                    {t("common.filtered")}`,
  'filtered badge'
);

// 2. "Chỉnh sửa" dropdown menu item (L1222)
prodReplace(
  `<Edit className="h-4 w-4 mr-2" />\n                            Chỉnh sửa`,
  `<Edit className="h-4 w-4 mr-2" />\n                            {t("common.edit")}`,
  'edit dropdown'
);

// 3. "Xóa" dropdown menu item (L1233)
prodReplace(
  `<Trash2 className="h-4 w-4 mr-2" />\n                            Xóa`,
  `<Trash2 className="h-4 w-4 mr-2" />\n                            {t("common.delete")}`,
  'delete dropdown'
);

// 4. "Chưa có sản phẩm nào" (L1243)
prodReplace(
  `<p>Chưa có sản phẩm nào</p>`,
  `<p>{t("products.noProductsYet")}</p>`,
  'noProductsYet'
);

// 5. 'Nhấn "Thêm" để tạo sản phẩm mới' (L1244)
prodReplace(
  `<p className="text-sm">Nhấn "Thêm" để tạo sản phẩm mới</p>`,
  `<p className="text-sm">{t("products.clickAddToCreate")}</p>`,
  'clickAddToCreate'
);

// 6. pointsDefined (L1261) - template literal
prodReplace(
  '? `${measurementPoints.length} điểm đo đã định nghĩa`',
  '? t("products.pointsDefined", { count: measurementPoints.length })',
  'pointsDefined'
);

// 7. "Đóng" close button in edit mode (L1288)
prodReplace(
  `<X className="h-4 w-4 mr-1" />\n                      Đóng`,
  `<X className="h-4 w-4 mr-1" />\n                      {t("common.close")}`,
  'close button edit'
);

// 8. "Sửa" button (L1315)
prodReplace(
  `<Edit className="h-4 w-4" />\n                      Sửa`,
  `<Edit className="h-4 w-4" />\n                      {t("common.edit")}`,
  'edit button'
);

// 9. "Đã chọn: N điểm đo" (L1329)
prodReplace(
  `Đã chọn: {selectedPointIds.size} điểm đo`,
  `{t("products.selectedPoints", { count: selectedPointIds.size })}`,
  'selectedPoints'
);

// 10. "Chọn tất cả" button (L1334)
prodReplace(
  `<CheckSquare className="h-3 w-3" />\n                        Chọn tất cả`,
  `<CheckSquare className="h-3 w-3" />\n                        {t("common.selectAll")}`,
  'selectAll'
);

// 11. "Bỏ chọn" button (L1338)
prodReplace(
  `<Square className="h-3 w-3" />\n                        Bỏ chọn`,
  `<Square className="h-3 w-3" />\n                        {t("common.deselectAll")}`,
  'deselectAll'
);

// 12. "Xuất CSV" button (L1348)
prodReplace(
  `<Download className="h-3 w-3" />\n                        Xuất CSV`,
  `<Download className="h-3 w-3" />\n                        {t("history.exportCsv")}`,
  'exportCsv'
);

// 13. "Bán kính:" label in zoom controls (L1415)
prodReplace(
  `<span className="text-sm text-muted-foreground">Bán kính:</span>`,
  `<span className="text-sm text-muted-foreground">{t("products.radius")}:</span>`,
  'radius label zoom'
);

// 14. "Mã điểm đo" label (L1512)
prodReplace(
  `<Label htmlFor="pointCode">Mã điểm đo <span className="text-destructive">*</span></Label>`,
  `<Label htmlFor="pointCode">{t("products.pointCodeLabel")} <span className="text-destructive">*</span></Label>`,
  'pointCodeLabel'
);

// 15. "Tên điểm đo" label (L1525)
prodReplace(
  `<Label htmlFor="pointName">Tên điểm đo <span className="text-destructive">*</span></Label>`,
  `<Label htmlFor="pointName">{t("products.pointNameLabel")} <span className="text-destructive">*</span></Label>`,
  'pointNameLabel'
);

// 16. "Bán kính:" in info box (L1673)
prodReplace(
  `<p>Bán kính: {measurementPoints[selectedPointIndex]?.radius}px</p>`,
  `<p>{t("products.radius")}: {measurementPoints[selectedPointIndex]?.radius}px</p>`,
  'radius info'
);

// 17. "Rộng (px)" label (L1681)
prodReplace(
  `<Label htmlFor="cropWidth" className="text-xs text-muted-foreground">Rộng (px)</Label>`,
  `<Label htmlFor="cropWidth" className="text-xs text-muted-foreground">{t("products.width")} (px)</Label>`,
  'widthPx'
);

// 18. "Cao (px)" label (L1693)
prodReplace(
  `<Label htmlFor="cropHeight" className="text-xs text-muted-foreground">Cao (px)</Label>`,
  `<Label htmlFor="cropHeight" className="text-xs text-muted-foreground">{t("products.height")} (px)</Label>`,
  'heightPx'
);

// 19. "Tự động cắt" button (L1715)
prodReplace(
  `>\n                              Tự động cắt\n                            </Button>`,
  `>\n                              {t("products.autoCrop")}\n                            </Button>`,
  'autoCrop button'
);

// 20. "Upload ảnh" button (L1725)
prodReplace(
  `>\n                              Upload ảnh\n                            </Button>`,
  `>\n                              {t("products.uploadImage")}\n                            </Button>`,
  'uploadImage button'
);

// 21. "Đang lưu..." saving state (L1758)
prodReplace(
  `Đang lưu...`,
  `{t("products.saving")}`,
  'saving text'
);

// 22. "Lưu" save button (L1762-1764)
prodReplace(
  `<Save className="h-4 w-4 mr-1" />\n                                  Lưu`,
  `<Save className="h-4 w-4 mr-1" />\n                                  {t("common.save")}`,
  'save button'
);

// 23. "Danh mục" label in edit dialog (L1836)
prodReplace(
  `<Label htmlFor="editProductCategory">Danh mục</Label>`,
  `<Label htmlFor="editProductCategory">{t("common.category")}</Label>`,
  'category label edit'
);

// 24. "Lưu trữ" archived select item (L1874)
prodReplace(
  `<SelectItem value="archived">Lưu trữ</SelectItem>`,
  `<SelectItem value="archived">{t("products.archived")}</SelectItem>`,
  'archived status'
);

// 25. "Quản lý Templates" dialog title (L1982)
prodReplace(
  `Quản lý Templates`,
  `{t("products.manageTemplates")}`,
  'manageTemplates title'
);

// 26. "Danh mục" label in template dialog (L2003)
prodReplace(
  `<Label>Danh mục</Label>\n                  <Select value={templateCategory}`,
  `<Label>{t("common.category")}</Label>\n                  <Select value={templateCategory}`,
  'category label template'
);

// 27. "Mô tả template..." placeholder (L2022)
prodReplace(
  `placeholder="Mô tả template..."`,
  `placeholder={t("products.templateDescPlaceholder")}`,
  'template desc placeholder'
);

// 28. "Lưu N điểm đo thành template" (L2032)
prodReplace(
  `Lưu {measurementPoints.length} điểm đo thành template`,
  `{t("products.savePointsAsTemplate", { count: measurementPoints.length })}`,
  'savePointsAsTemplate'
);

// 29. "Áp dụng" apply template button (L2061)
prodReplace(
  `<Download className="h-3 w-3" />\n                            Áp dụng`,
  `<Download className="h-3 w-3" />\n                            {t("common.apply")}`,
  'apply template'
);

// 30. "Đóng" close template dialog button (L2086)
prodReplace(
  `<Button variant="outline" onClick={() => setIsTemplateDialogOpen(false)}>\n              Đóng`,
  `<Button variant="outline" onClick={() => setIsTemplateDialogOpen(false)}>\n              {t("common.close")}`,
  'close template dialog'
);

writeF(`${base}/ProductModels.tsx`, prod);
console.log(`ProductModels.tsx: ${prodHits} hits, ${prodMisses} misses\n`);

// ============================================================
// PART 4: Add missing locale keys
// ============================================================

// New keys needed:
// products.templateDescPlaceholder (vi: "Mô tả template...", en: "Describe template...", zh: "描述模板...")
// products.width (already exists at L820)
// products.height (already exists at L821)
// history.today (already exists at L336)
// etc.

// Let me check what's TRULY missing:
// - products.templateDescPlaceholder - NEW
// - common.filtered already exists at L176

// Check if all keys exist:
const viLocale = readF(`${localeBase}/vi.json`);
const keysToCheck = [
  'dashboard.alerts', 'common.details', 'history.clearFilters', 'dashboard.noPointData',
  'dashboard.noPointDataDesc', 'history.saveCurrentFilter', 'history.showColumns',
  'history.exportExcelBtn', 'common.selectAll', 'common.export', 'common.confirm',
  'history.machine', 'history.loadMoreData', 'common.total', 'history.tryDifferentFilters',
  'common.all', 'history.today', 'history.thisWeek', 'history.thisMonth',
  'history.fromDate', 'history.toDate', 'history.noPointData', 'history.noPointDataDesc',
  'common.code', 'dashboard.noWorkstationData', 'dashboard.noWorkstationDataDesc',
  'common.filtered', 'common.edit', 'common.delete', 'products.noProductsYet',
  'products.clickAddToCreate', 'products.pointsDefined', 'common.close',
  'products.selectedPoints', 'common.deselectAll', 'history.exportCsv',
  'products.radius', 'products.pointCodeLabel', 'products.pointNameLabel',
  'products.width', 'products.height', 'products.autoCrop', 'products.uploadImage',
  'products.saving', 'common.save', 'common.category', 'products.archived',
  'products.manageTemplates', 'products.savePointsAsTemplate', 'common.apply',
];

const missingKeys = [];
for (const key of keysToCheck) {
  const parts = key.split('.');
  const section = parts[0];
  const name = parts[1];
  // Simple check: look for "name": in viLocale
  if (!viLocale.includes(`"${name}"`)) {
    missingKeys.push(key);
  }
}
console.log(`\nMissing locale keys (simple check): ${missingKeys.length > 0 ? missingKeys.join(', ') : 'NONE'}`);

// Add missing keys to locale files
function addLocaleKeys(filePath, keysToAdd) {
  let content = readF(filePath);
  for (const { section, key, value } of keysToAdd) {
    // Find the section and add key before the closing }
    const sectionPattern = `"${section}": {`;
    const sectionIdx = content.indexOf(sectionPattern);
    if (sectionIdx === -1) {
      console.log(`  Section "${section}" not found in ${filePath}`);
      continue;
    }
    // Check if key already exists
    if (content.includes(`"${key}"`)) {
      continue;
    }
    // Find the last key-value pair in the section (before closing })
    let braceCount = 0;
    let sectionEndIdx = -1;
    for (let i = sectionIdx + sectionPattern.length; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') {
        if (braceCount === 0) {
          sectionEndIdx = i;
          break;
        }
        braceCount--;
      }
    }
    if (sectionEndIdx > -1) {
      // Find the last newline before the closing brace
      const beforeClose = content.lastIndexOf('\n', sectionEndIdx);
      const insertStr = `,\n    "${key}": "${value}"`;
      // Find the last non-whitespace char before closing brace
      let lastContent = content.lastIndexOf('\n', sectionEndIdx);
      let lineBeforeClose = content.substring(lastContent + 1, sectionEndIdx).trim();
      // Insert before the closing brace
      if (lineBeforeClose === '') {
        // Empty section
        content = content.substring(0, sectionEndIdx) + `\n    "${key}": "${value}"\n  ` + content.substring(sectionEndIdx);
      } else {
        // Find position just before closing brace's line
        content = content.substring(0, sectionEndIdx) + `  ,\n    "${key}": "${value}"\n  ` + content.substring(sectionEndIdx);
      }
    }
  }
  writeF(filePath, content);
}

// Keys that definitely need adding:
const newKeysVi = [
  { section: 'products', key: 'templateDescPlaceholder', value: 'Mô tả template...' },
];

const newKeysEn = [
  { section: 'products', key: 'templateDescPlaceholder', value: 'Describe template...' },
];

const newKeysZh = [
  { section: 'products', key: 'templateDescPlaceholder', value: '描述模板...' },
];

// Only add if truly missing
const viContent = readF(`${localeBase}/vi.json`);
if (!viContent.includes('"templateDescPlaceholder"')) {
  addLocaleKeys(`${localeBase}/vi.json`, newKeysVi);
  addLocaleKeys(`${localeBase}/en.json`, newKeysEn);
  addLocaleKeys(`${localeBase}/zh.json`, newKeysZh);
  console.log('\nAdded templateDescPlaceholder to all locale files');
} else {
  console.log('\ntemplateDescPlaceholder already exists in locale files');
}

console.log('\n=== DONE ===');
