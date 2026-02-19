/**
 * Comprehensive i18n migration script for Dashboard.tsx, History.tsx, ProductModels.tsx
 * Replaces ALL remaining Vietnamese hardcoded strings with t() calls
 * and adds new locale keys to vi.json, en.json, zh.json
 */
import fs from 'fs';

const PAGES_DIR = 'client/src/pages';
const LOCALES_DIR = 'client/src/i18n/locales';

function readF(path) {
  let c = fs.readFileSync(path, 'utf-8');
  c = c.replace(/^\uFEFF/, '');
  c = c.replace(/\r\n/g, '\n');
  return c;
}

function writeF(path, content) {
  fs.writeFileSync(path, '\uFEFF' + content.replace(/\n/g, '\r\n'), 'utf-8');
}

function writeTSX(path, content) {
  fs.writeFileSync(path, content.replace(/\n/g, '\r\n'), 'utf-8');
}

let totalHits = 0;
let totalMiss = 0;

function r(content, old, replacement, label) {
  if (content.includes(old)) {
    content = content.replace(old, replacement);
    totalHits++;
    console.log(`  ✅ ${label}`);
  } else {
    totalMiss++;
    console.log(`  ❌ MISS: ${label}`);
  }
  return content;
}

// replaceAll occurrences  
function ra(content, old, replacement, label) {
  if (content.includes(old)) {
    const count = content.split(old).length - 1;
    content = content.split(old).join(replacement);
    totalHits += count;
    console.log(`  ✅ ${label} (${count}x)`);
  } else {
    totalMiss++;
    console.log(`  ❌ MISS: ${label}`);
  }
  return content;
}

// ============================================================
// DASHBOARD.TSX
// ============================================================
console.log('\n=== DASHBOARD.TSX ===');
let dash = readF(`${PAGES_DIR}/Dashboard.tsx`);

// L725: || "Chưa phân loại"
dash = r(dash,
  '|| "Chưa phân loại"',
  '|| t("dashboard.unclassified")',
  'unclassified fallback');

// L817-819: status labels
dash = r(dash,
  'label: "Tốt"',
  'label: t("dashboard.good")',
  'status good');
dash = r(dash,
  'label: "Cảnh báo"',
  'label: t("dashboard.warning")',
  'status warning');
dash = r(dash,
  'label: "Cần xử lý"',
  'label: t("dashboard.needsAttention")',
  'status needsAttention');

// L930: Cảnh báo button text
dash = r(dash,
  `<Bell className="h-4 w-4" />\n                    Cảnh báo`,
  `<Bell className="h-4 w-4" />\n                    {t("dashboard.alerts")}`,
  'alerts button');

// L946: placeholder="Nhà máy"
dash = r(dash,
  'placeholder="Nhà máy"',
  'placeholder={t("dashboard.factory")}',
  'factory placeholder');

// L949: Tất cả nhà máy
dash = r(dash,
  '>Tất cả nhà máy</SelectItem>',
  '>{t("dashboard.allFactories")}</SelectItem>',
  'allFactories');

// L963: placeholder="Xưởng"
dash = r(dash,
  'placeholder="Xưởng"',
  'placeholder={t("dashboard.workshop")}',
  'workshop placeholder');

// L966: Tất cả xưởng
dash = r(dash,
  '>Tất cả xưởng</SelectItem>',
  '>{t("dashboard.allWorkshops")}</SelectItem>',
  'allWorkshops');

// L980: Tất cả line
dash = r(dash,
  '>Tất cả line</SelectItem>',
  '>{t("dashboard.allLines")}</SelectItem>',
  'allLines');

// L1015: auto-refresh ternary
dash = r(dash,
  `{isAutoRefreshing ? 'Tạm dừng auto-refresh' : 'Bật auto-refresh'}`,
  `{isAutoRefreshing ? t('dashboard.pauseAutoRefresh') : t('dashboard.enableAutoRefresh')}`,
  'auto-refresh labels');

// L1199: Mục tiêu / Ngưỡng
dash = r(dash,
  '>Mục tiêu: {alert.target}% | Ngưỡng: {alert.threshold}%</p>',
  '>{t("dashboard.target")}: {alert.target}% | {t("dashboard.threshold")}: {alert.threshold}%</p>',
  'target/threshold info');

// L1208: Không có cảnh báo
dash = r(dash,
  `Không có cảnh báo\n`,
  `{t("dashboard.noAlerts")}\n`,
  'noAlerts');

// L1226: Chi tiết
dash = r(dash,
  `<Eye className="h-3 w-3" />\n                    Chi tiết`,
  `<Eye className="h-3 w-3" />\n                    {t("common.details")}`,
  'details button');

// L1233: Tổng
dash = r(dash,
  `<p className="text-[10px] text-muted-foreground">Tổng</p>`,
  `<p className="text-[10px] text-muted-foreground">{t("common.total")}</p>`,
  'total label');

// L1370: FPY, FY, NTFY và Output theo từng giờ
dash = r(dash,
  '<CardDescription>FPY, FY, NTFY và Output theo từng giờ</CardDescription>',
  '<CardDescription>{t("dashboard.hourlyChartDesc")}</CardDescription>',
  'hourly chart desc');

// L1470: Tỷ lệ OK/NG/NTF tổng hợp
dash = r(dash,
  '<CardDescription>Tỷ lệ OK/NG/NTF tổng hợp</CardDescription>',
  '<CardDescription>{t("dashboard.resultDistributionDesc")}</CardDescription>',
  'result distribution desc');

// L1507: 10 máy có output cao nhất
dash = r(dash,
  '<CardDescription>10 máy có output cao nhất</CardDescription>',
  '<CardDescription>{t("dashboard.top10MachinesDesc")}</CardDescription>',
  'top10 machines');

// L1547: Công trạm cần ưu tiên cải thiện
dash = r(dash,
  '<CardDescription>Công trạm cần ưu tiên cải thiện</CardDescription>',
  '<CardDescription>{t("dashboard.workstationsNeedImprovement")}</CardDescription>',
  'workstations need improvement');

// L1572: Lỗi div
dash = r(dash,
  `<div className="text-xs text-muted-foreground">Lỗi</div>`,
  `<div className="text-xs text-muted-foreground">{t("common.error")}</div>`,
  'error label');

// L1585-86: EmptyState - first occurrence (workstation data)
dash = r(dash,
  `title="Chưa có dữ liệu công trạm"\n                    description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo."`,
  `title={t("dashboard.noWorkstationData")}\n                    description={t("dashboard.noWorkstationDataDesc")}`,
  'noWorkstationData EmptyState 1');

// Second EmptyState same strings  
dash = r(dash,
  `title="Chưa có dữ liệu công trạm"\n                    description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo."`,
  `title={t("dashboard.noWorkstationData")}\n                    description={t("dashboard.noWorkstationDataDesc")}`,
  'noWorkstationData EmptyState 2');

// L1602: Mức độ NG:
dash = r(dash,
  '>Mức độ NG:</span>',
  '>{t("dashboard.ngSeverityLabel")}</span>',
  'NG severity label');

// L1605: ≤2% (Tốt)
dash = r(dash,
  '<span>≤2% (Tốt)</span>',
  '<span>{t("dashboard.ngLevelGood")}</span>',
  'ngLevelGood');

// L1609: 2-5% (Chấp nhận)
dash = r(dash,
  '<span>2-5% (Chấp nhận)</span>',
  '<span>{t("dashboard.ngLevelAcceptable")}</span>',
  'ngLevelAcceptable');

// L1613: 5-10% (Cảnh báo)
dash = r(dash,
  '<span>5-10% (Cảnh báo)</span>',
  '<span>{t("dashboard.ngLevelWarning")}</span>',
  'ngLevelWarning');

// L1617: >10% (Nghiêm trọng)
dash = r(dash,
  '<span>&gt;10% (Nghiêm trọng)</span>',
  '<span>{t("dashboard.ngLevelCritical")}</span>',
  'ngLevelCritical');

// L1628: 7 ngày qua
dash = r(dash,
  '>7 ngày qua</SelectItem>',
  '>{t("dashboard.last7Days")}</SelectItem>',
  'last7Days');

// L1629: 30 ngày qua
dash = r(dash,
  '>30 ngày qua</SelectItem>',
  '>{t("dashboard.last30Days")}</SelectItem>',
  'last30Days');

// L1644: Đang xuất... / Xuất báo cáo
dash = r(dash,
  `{exportingPDF ? "Đang xuất..." : "Xuất báo cáo"}`,
  `{exportingPDF ? t("dashboard.exporting") : t("dashboard.exportReport")}`,
  'export labels');

// L1655: "Hôm nay" in ternary 
dash = r(dash,
  `{ngTimeFilter === "day" ? "Hôm nay" : ngTimeFilter === "week" ? t("dashboard.7daysPeriod") : t("dashboard.30daysPeriod")}`,
  `{ngTimeFilter === "day" ? t("dashboard.today") : ngTimeFilter === "week" ? t("dashboard.7daysPeriod") : t("dashboard.30daysPeriod")}`,
  'today in ternary');

// L1667, L1696: Tỉ lệ NG (2 occurrences in spans)
dash = ra(dash,
  '>Tỉ lệ NG</span>',
  '>{t("dashboard.ngRate")}</span>',
  'ngRate spans');

// L1670: Tổng: {ngComparisonData.current
dash = r(dash,
  '>Tổng: {ngComparisonData.current',
  '>{t("common.total")}: {ngComparisonData.current',
  'total current');

// L1699: Tổng: {ngComparisonData.previous
dash = r(dash,
  '>Tổng: {ngComparisonData.previous',
  '>{t("common.total")}: {ngComparisonData.previous',
  'total previous');

// L1675, L1704, L1742: Không có dữ liệu (3x in divs)
dash = ra(dash,
  '>Không có dữ liệu</div>',
  '>{t("common.noData")}</div>',
  'noData divs');

// L1684: Hôm qua / 7 ngày trước / 30 ngày trước
dash = r(dash,
  `{ngTimeFilter === "day" ? "Hôm qua" : ngTimeFilter === "week" ? "7 ngày trước" : "30 ngày trước"}`,
  `{ngTimeFilter === "day" ? t("common.yesterday") : ngTimeFilter === "week" ? t("dashboard.7daysBefore") : t("dashboard.30daysBefore")}`,
  'previous period labels');

// L1712: So sánh
dash = r(dash,
  `>So sánh</CardTitle>`,
  `>{t("dashboard.ngCompare")}</CardTitle>`,
  'compare title');

// L1733: Cải thiện so với kỳ trước
dash = r(dash,
  '>Cải thiện so với kỳ trước</span>',
  '>{t("dashboard.improvedVsPrevious")}</span>',
  'improved vs previous');

// L1735: Không thay đổi
dash = r(dash,
  '>Không thay đổi</span>',
  '>{t("dashboard.noChange")}</span>',
  'no change');

// L1737: Tăng so với kỳ trước
dash = r(dash,
  '>Tăng so với kỳ trước</span>',
  '>{t("dashboard.increasedVsPrevious")}</span>',
  'increased vs previous');

// L1755: Xu hướng tỉ lệ NG theo ngày
dash = r(dash,
  `Xu hướng tỉ lệ NG theo ngày`,
  `{t("dashboard.ngTrendByDay")}`,
  'ngTrendByDay title');

// L1757: Đã lọc Badge
dash = r(dash,
  '>Đã lọc</Badge>',
  '>{t("common.filtered")}</Badge>',
  'filtered badge');

// L1761: Biểu đồ thể hiện xu hướng tỉ lệ NG theo thời gian
dash = r(dash,
  `Biểu đồ thể hiện xu hướng tỉ lệ NG theo thời gian`,
  `{t("dashboard.ngTrendChartDesc")}`,
  'ngTrendChartDesc');

// L1773: placeholder="Chọn công trạm"
dash = r(dash,
  'placeholder="Chọn công trạm"',
  'placeholder={t("dashboard.selectWorkstation")}',
  'selectWorkstation placeholder');

// L1776: Tất cả công trạm
dash = r(dash,
  '>Tất cả công trạm</SelectItem>',
  '>{t("dashboard.allWorkstations")}</SelectItem>',
  'allWorkstations');

// L1791: placeholder="Chọn điểm đo"
dash = r(dash,
  'placeholder="Chọn điểm đo"',
  'placeholder={t("dashboard.selectPoint")}',
  'selectPoint placeholder');

// L1794: Tất cả điểm đo
dash = r(dash,
  '>Tất cả điểm đo</SelectItem>',
  '>{t("dashboard.allPoints")}</SelectItem>',
  'allPoints');

// L1816: Xóa bộ lọc
dash = r(dash,
  `<X className="h-3 w-3 mr-1" />\n                          Xóa bộ lọc`,
  `<X className="h-3 w-3 mr-1" />\n                          {t("history.clearFilters")}`,
  'clearFilters');

// L1854-56: Tooltip formatter labels
dash = r(dash,
  `'Tỉ lệ NG'];`,
  `t('dashboard.ngRate')];`,
  'tooltip ngRate');
dash = r(dash,
  `'Tổng kiểm tra'];`,
  `t('dashboard.totalInspections')];`,
  'tooltip totalInspections');
dash = r(dash,
  `'Số lỗi NG'];`,
  `t('dashboard.ngCountLabel')];`,
  'tooltip ngCountLabel');

// L1874-75: EmptyState trend
dash = r(dash,
  `title="Chưa có dữ liệu xu hướng"\n                      description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra theo ngày."`,
  `title={t("dashboard.noTrendData")}\n                      description={t("dashboard.noTrendDataDesc")}`,
  'noTrendData EmptyState');

// L1887: Tỉ lệ NG theo Công trạm (card title text)
dash = r(dash,
  `Tỉ lệ NG theo Công trạm`,
  `{t("dashboard.ngRateByWorkstation")}`,
  'ngRateByWorkstation title');

// L1890: workstation heatmap description
dash = r(dash,
  `Hiển thị tỉ lệ lỗi của từng công trạm, màu sắc thể hiện mức độ nghiêm trọng`,
  `{t("dashboard.ngRateByWorkstationDesc")}`,
  'ngRateByWorkstation desc');

// L1930: Top Điểm đo có tỉ lệ NG cao
dash = r(dash,
  `Top Điểm đo có tỉ lệ NG cao`,
  `{t("dashboard.topNgPoints")}`,
  'topNgPoints title');

// L1932: description for top NG points
dash = r(dash,
  `Các điểm đo có tỉ lệ lỗi cao nhất, cần ưu tiên kiểm tra và cải thiện`,
  `{t("dashboard.topNgPointsDesc")}`,
  'topNgPoints desc');

// L1950-53: EmptyState point data
dash = r(dash,
  `title="Chưa có dữ liệu điểm đo"\n                    description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra."`,
  `title={t("dashboard.noPointData")}\n                    description={t("dashboard.noPointDataDesc")}`,
  'noPointData EmptyState');

// L1973: placeholder="Trạng thái" in layout tab
dash = r(dash,
  'placeholder="Trạng thái"',
  'placeholder={t("common.status")}',
  'status placeholder');

// L1976: Tất cả in layout tab
dash = r(dash,
  `<SelectItem value="all">Tất cả</SelectItem>`,
  `<SelectItem value="all">{t("common.all")}</SelectItem>`,
  'all filter layout');

// L2003: dây chuyền • máy badge
dash = r(dash,
  `{machinesByLine.size} dây chuyền • {Array.from(machinesByLine.values()).flat().length} máy`,
  `{machinesByLine.size} {t("dashboard.productionLines")} • {Array.from(machinesByLine.values()).flat().length} {t("dashboard.machines")}`,
  'lines machines badge');

// L2345: Tỷ lệ sản phẩm đạt lần đầu
dash = r(dash,
  '>Tỷ lệ sản phẩm đạt lần đầu</p>',
  '>{t("dashboard.fpyDescription")}</p>',
  'fpy description');

// L2354, 2372, 2390, 2416: "Hiển thị" : "Ẩn" (4x)
dash = ra(dash,
  `{visibleMetrics.fpy ? "Hiển thị" : "Ẩn"}`,
  `{visibleMetrics.fpy ? t("dashboard.shown") : t("dashboard.hidden")}`,
  'fpy shown/hidden');
dash = ra(dash,
  `{visibleMetrics.fy ? "Hiển thị" : "Ẩn"}`,
  `{visibleMetrics.fy ? t("dashboard.shown") : t("dashboard.hidden")}`,
  'fy shown/hidden');
dash = ra(dash,
  `{visibleMetrics.ntfy ? "Hiển thị" : "Ẩn"}`,
  `{visibleMetrics.ntfy ? t("dashboard.shown") : t("dashboard.hidden")}`,
  'ntfy shown/hidden');
dash = ra(dash,
  `{visibleMetrics.output ? "Hiển thị" : "Ẩn"}`,
  `{visibleMetrics.output ? t("dashboard.shown") : t("dashboard.hidden")}`,
  'output shown/hidden');

// L2363: Tỷ lệ sản phẩm lỗi
dash = r(dash,
  '>Tỷ lệ sản phẩm lỗi</p>',
  '>{t("dashboard.fyDescription")}</p>',
  'fy description');

// L2381: Tỷ lệ không tìm thấy kết quả
dash = r(dash,
  '>Tỷ lệ không tìm thấy kết quả</p>',
  '>{t("dashboard.ntfyDescription")}</p>',
  'ntfy description');

// L2407: Tổng số sản phẩm đã kiểm tra
dash = r(dash,
  '>Tổng số sản phẩm đã kiểm tra</p>',
  '>{t("dashboard.outputDescription")}</p>',
  'output description');

// L2467: Dữ liệu từ (in drilldown dialog)
dash = r(dash,
  `• Dữ liệu từ `,
  `• {t("dashboard.dataFrom")} `,
  'dataFrom');

// L2529: Tổng (in drilldown stats grid)
dash = ra(dash,
  `<p className="text-xs text-muted-foreground">Tổng</p>`,
  `<p className="text-xs text-muted-foreground">{t("common.total")}</p>`,
  'drilldown total labels');

// L2567-68: EmptyState no measurement points
dash = r(dash,
  `title="Chưa có điểm đo"\n                description="Công trạm này chưa có điểm đo nào được gán hoặc chưa có dữ liệu kiểm tra."`,
  `title={t("dashboard.noMeasurementPoints")}\n                description={t("dashboard.noMeasurementPointsDesc")}`,
  'noMeasurementPoints EmptyState');

writeTSX(`${PAGES_DIR}/Dashboard.tsx`, dash);
console.log(`Dashboard.tsx saved. Hits: ${totalHits}, Misses: ${totalMiss}`);

// ============================================================
// HISTORY.TSX
// ============================================================
const dashHits = totalHits;
const dashMiss = totalMiss;
totalHits = 0;
totalMiss = 0;
console.log('\n=== HISTORY.TSX ===');
let hist = readF(`${PAGES_DIR}/History.tsx`);

// L1012: toast.success filter applied
hist = r(hist,
  'toast.success(`Đã áp dụng bộ lọc: ${sf.name}`)',
  'toast.success(t("history.filterApplied", { name: sf.name }))',
  'filterApplied toast');

// L1022: prompt enter filter name
hist = r(hist,
  'prompt("Nhập tên bộ lọc:")',
  'prompt(t("history.enterFilterName"))',
  'enterFilterName prompt');

// L1025: toast.success filter saved
hist = r(hist,
  'toast.success(`Đã lưu bộ lọc: ${name}`)',
  'toast.success(t("history.filterSaved", { name }))',
  'filterSaved toast');

// L1030: Lưu bộ lọc hiện tại
hist = r(hist,
  '>Lưu bộ lọc hiện tại</DropdownMenuItem>',
  '>{t("history.saveCurrentFilter")}</DropdownMenuItem>',
  'saveCurrentFilter');

// L1068: Kết quả tìm kiếm
hist = r(hist,
  `Kết quả tìm kiếm`,
  `{t("history.searchResults")}`,
  'searchResults');

// L1070: Tìm thấy ... kết quả / Chưa có dữ liệu
hist = r(hist,
  'data?.total ? `Tìm thấy ${data.total} kết quả` : "Chưa có dữ liệu"',
  'data?.total ? t("history.foundResults", { count: data.total }) : t("dashboard.noDataYet")',
  'foundResults/noDataYet');

// L1096: Hiển thị cột
hist = r(hist,
  `>Hiển thị cột</Button>`,
  `>{t("history.showColumns")}</Button>`,
  'showColumns');

// L1099-1106: Column name map
hist = r(hist,
  'machine: "Máy"',
  'machine: t("history.machine")',
  'column machine');
hist = r(hist,
  'result: "Kết quả"',
  'result: t("history.result")',
  'column result');
hist = r(hist,
  'time: "Thời gian"',
  'time: t("common.time")',
  'column time');
hist = r(hist,
  'factory: "Nhà máy"',
  'factory: t("history.factory")',
  'column factory');
hist = r(hist,
  'workshop: "Nhà xưởng"',
  'workshop: t("history.workshopLabel")',
  'column workshop');
hist = r(hist,
  'line: "Dây chuyền"',
  'line: t("dashboard.productionLine")',
  'column line');
hist = r(hist,
  'station: "Công trạm"',
  'station: t("history.station")',
  'column station');

// L1138: Xuất Excel
hist = r(hist,
  `>Xuất Excel</Button>`,
  `>{t("history.exportExcel")}</Button>`,
  'exportExcel button');

// L1153: Chọn tất cả
hist = r(hist,
  `>Chọn tất cả ({data.data.length})</Button>`,
  `>{t("common.selectAll")} ({data.data.length})</Button>`,
  'selectAll button');

// L1158: Đã chọn
hist = r(hist,
  `Đã chọn {selectedIds.size}`,
  `{t("history.selectedCount")} {selectedIds.size}`,
  'selectedCount');

// L1176: Xuất (N)
hist = r(hist,
  `>Xuất ({selectedIds.size})</Button>`,
  `>{t("common.export")} ({selectedIds.size})</Button>`,
  'export N');

// L1190: Xác nhận (N)
hist = r(hist,
  `>Xác nhận ({selectedIds.size})</Button>`,
  `>{t("common.confirm")} ({selectedIds.size})</Button>`,
  'confirm N');

// L1257: Chi tiết button
hist = r(hist,
  `Chi tiết\n                          </Button>`,
  `{t("common.details")}\n                          </Button>`,
  'details button');

// L1267: Trang {page} / {totalPages}
hist = r(hist,
  `Trang {page} / {totalPages}`,
  `{t("common.page")} {page} / {totalPages}`,
  'page label');

// L1293-94: Không tìm thấy kết quả nào
hist = r(hist,
  `>Không tìm thấy kết quả nào</p>`,
  `>{t("common.noResults")}</p>`,
  'noResults');

// Try changing filters
hist = r(hist,
  `>Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>`,
  `>{t("history.tryChangingFilters")}</p>`,
  'tryChangingFilters');

// L1465-66: Table headers in machine stats
hist = r(hist,
  `<th className="text-left p-3 text-muted-foreground">Máy</th>`,
  `<th className="text-left p-3 text-muted-foreground">{t("history.machine")}</th>`,
  'machine th');

// Tổng in table header  
hist = r(hist,
  `<th className="text-right p-3 text-muted-foreground">Tổng</th>\n                            <th`,
  `<th className="text-right p-3 text-muted-foreground">{t("common.total")}</th>\n                            <th`,
  'total th machine stats');

// L1508: Tải thêm dữ liệu
hist = r(hist,
  `>Tải thêm dữ liệu</Button>`,
  `>{t("history.loadMoreData")}</Button>`,
  'loadMoreData');

// L1520: top NG points description
hist = r(hist,
  `Những điểm đo có tỷ lệ NG cao nhất cần ưu tiên cải thiện`,
  `{t("history.topNgPointsDesc")}`,
  'topNgPointsDesc');

// L1545: % của tổng NG
hist = r(hist,
  `% của tổng NG`,
  `% {t("history.ofTotalNg")}`,
  'ofTotalNg');

// L1575-76: Model sản phẩm & Tổng
hist = r(hist,
  `>Model sản phẩm</th>`,
  `>{t("products.productModel")}</th>`,
  'productModel th');

// Tổng in product stats
hist = r(hist,
  `<th className="text-right p-3 text-muted-foreground">Tổng</th>\n                            <th className="text-right`,
  `<th className="text-right p-3 text-muted-foreground">{t("common.total")}</th>\n                            <th className="text-right`,
  'total th product stats');

// L1609-10: No data to analyze
hist = r(hist,
  `>Không có dữ liệu để phân tích</p>`,
  `>{t("history.noDataToAnalyze")}</p>`,
  'noDataToAnalyze');
hist = r(hist,
  `>Thử tìm kiếm với bộ lọc khác</p>\n                  </CardContent>\n                </Card>\n              </div>\n            </TabsContent>`,
  `>{t("history.tryDifferentFilters")}</p>\n                  </CardContent>\n                </Card>\n              </div>\n            </TabsContent>`,
  'tryDifferentFilters 1');

// L1625: workstation analysis description
hist = r(hist,
  `Thống kê lỗi theo công trạm sản xuất và điểm đo để xác định nguyên nhân lỗi`,
  `{t("history.workstationAnalysisDesc")}`,
  'workstationAnalysisDesc');

// L1634: Bộ lọc theo thời gian
hist = r(hist,
  `Bộ lọc theo thời gian`,
  `{t("history.timeFilter")}`,
  'timeFilter');

// L1665-86: Time filter buttons
hist = r(hist,
  `>Tất cả</Button>`,
  `>{t("common.all")}</Button>`,
  'all time filter');
hist = r(hist,
  `>Hôm nay</Button>`,
  `>{t("common.today")}</Button>`,
  'today time filter');
hist = r(hist,
  `>Tuần này</Button>`,
  `>{t("dashboard.thisWeek")}</Button>`,
  'thisWeek time filter');
hist = r(hist,
  `>Tháng này</Button>`,
  `>{t("dashboard.thisMonth")}</Button>`,
  'thisMonth time filter');

// L1692: Từ ngày
hist = r(hist,
  `>Từ ngày</Label>`,
  `>{t("history.fromDate")}</Label>`,
  'fromDate label');

// L1701: Đến ngày
hist = r(hist,
  `>Đến ngày</Label>`,
  `>{t("history.toDate")}</Label>`,
  'toDate label');

// L1718: Tóm tắt theo Công trạm
hist = r(hist,
  `Tóm tắt theo Công trạm`,
  `{t("history.summaryByWorkstation")}`,
  'summaryByWorkstation');

// L1722: workstation list desc
hist = r(hist,
  `Danh sách các công trạm sản xuất và thống kê lỗi`,
  `{t("history.workstationListDesc")}`,
  'workstationListDesc');

// L1743: Mã:
hist = r(hist,
  `Mã: {ws.workstationCode}`,
  `{t("common.code")}: {ws.workstationCode}`,
  'workstation code label');

// L1778: Lỗi theo Công trạm
hist = r(hist,
  `Lỗi theo Công trạm`,
  `{t("history.defectsByWorkstation")}`,
  'defectsByWorkstation');

// L1819-20: Top 10 / points need improvement
hist = r(hist,
  `Top 10 Điểm đo có lỗi cao nhất`,
  `{t("history.top10HighestDefectPoints")}`,
  'top10HighestDefectPoints');
hist = r(hist,
  `Các điểm đo cần ưu tiên cải thiện`,
  `{t("history.pointsNeedImprovement")}`,
  'pointsNeedImprovement');

// L1851-52: EmptyState point data
hist = r(hist,
  `title="Chưa có dữ liệu điểm đo"\n                          description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo."`,
  `title={t("history.noPointData")}\n                          description={t("history.noPointDataDesc")}`,
  'noPointData EmptyState');

// L1863: Điểm đo theo Công trạm
hist = r(hist,
  `Điểm đo theo Công trạm`,
  `{t("history.pointsByWorkstation")}`,
  'pointsByWorkstation');

// L1874: Mã table header
hist = r(hist,
  `<th className="text-left p-3 text-muted-foreground">Mã</th>`,
  `<th className="text-left p-3 text-muted-foreground">{t("common.code")}</th>`,
  'code th');

// L1875: Số điểm đo
hist = r(hist,
  `>Số điểm đo</th>`,
  `>{t("history.pointCount")}</th>`,
  'pointCount th');

// L1912-13: EmptyState workstation data (different desc)
hist = r(hist,
  `title="Chưa có dữ liệu công trạm"\n                          description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo được gán công trạm."`,
  `title={t("history.noWorkstationData")}\n                          description={t("history.noWorkstationDataDesc")}`,
  'noWorkstationData EmptyState');

// L1938: SPC description line
hist = r(hist,
  `Phân tích thống kê quá trình sản xuất - Control Charts, Histogram, Pareto`,
  `{t("history.spcDescription")}`,
  'spcDescription');

// L1948: Control chart desc
hist = r(hist,
  `Biểu đồ kiểm soát Yield Rate theo ngày với UCL, CL, LCL`,
  `{t("history.controlChartDesc")}`,
  'controlChartDesc');

// L2033: name="Số lượng" (Bar chart)
hist = r(hist,
  'name="Số lượng"',
  'name={t("history.quantity")}',
  'quantity bar name');

// L2091: name="Số lỗi NG" (Pareto chart)
hist = r(hist,
  'name="Số lỗi NG"',
  'name={t("history.ngErrorCount")}',
  'ngErrorCount bar name');

// L2092: name="Tích lũy %"
hist = r(hist,
  'name="Tích lũy %"',
  'name={t("history.cumulativePercent")}',
  'cumulativePercent bar name');

// L2097: Không có dữ liệu lỗi để hiển thị
hist = r(hist,
  `Không có dữ liệu lỗi để hiển thị`,
  `{t("history.noErrorDataToShow")}`,
  'noErrorDataToShow');

// L2178: Cp/Cpk explanation paragraph
hist = r(hist,
  `Cp đo lường khả năng tiềm năng của quá trình, Cpk đo lường khả năng thực tế có tính đến độ lệch tâm.\n                          Giá trị ≥ 1.33 được coi là xuất sắc, ≥ 1.0 là chấp nhận được, &lt; 1.0 cần cải thiện.`,
  `{t("history.cpCpkExplanation")}`,
  'cpCpk explanation');

// L2189-90: Heatmap title
hist = r(hist,
  `Heatmap - Phân bố NG theo giờ và ngày`,
  `{t("history.heatmapTitle")}`,
  'heatmap title');

// L2191: Heatmap desc
hist = r(hist,
  `Biểu đồ nhiệt thể hiện mật độ lỗi theo thời gian trong ngày`,
  `{t("history.heatmapDesc")}`,
  'heatmap desc');

// L2266: Western Electric Rules title
hist = r(hist,
  `Western Electric Rules - Cảnh báo`,
  `{t("history.westernElectricRules")}`,
  'western electric rules');

// L2287: Rule 1 violation
hist = r(hist,
  'description: `${beyond3Sigma.length} điểm vượt quá 3σ - Cần kiểm tra ngay`',
  'description: t("history.rule1Violation", { count: beyond3Sigma.length })',
  'rule1 violation');

// L2303: Rule 2 violation
hist = r(hist,
  `description: '2 trong 3 điểm liên tiếp vượt 2σ'`,
  `description: t("history.rule2Violation")`,
  'rule2 violation');

// L2316: Rule 3 violation
hist = r(hist,
  `description: '4 trong 5 điểm liên tiếp vượt 1σ'`,
  `description: t("history.rule3Violation")`,
  'rule3 violation');

// L2330: Rule 4 violation
hist = r(hist,
  `description: '8 điểm liên tiếp cùng phía với đường tâm'`,
  `description: t("history.rule4Violation")`,
  'rule4 violation');

// L2365-66: No SPC data
hist = r(hist,
  `>Không có dữ liệu để phân tích SPC</p>`,
  `>{t("history.noSPCData")}</p>`,
  'noSPCData');
hist = r(hist,
  `>Thử tìm kiếm với bộ lọc khác</p>\n                  </CardContent>\n                </Card>\n              )}`,
  `>{t("history.tryDifferentFilters")}</p>\n                  </CardContent>\n                </Card>\n              )}`,
  'tryDifferentFilters 2');

// L2476: Hiện tại
hist = r(hist,
  `>Hiện tại</p>`,
  `>{t("history.current")}</p>`,
  'current label');

// L2497: Dự đoán xu hướng
hist = r(hist,
  `Dự đoán xu hướng`,
  `{t("history.trendPrediction")}`,
  'trendPrediction title');

// L2499: Tăng / Giảm / Ổn định
hist = r(hist,
  `{aiAnalysis.trendPrediction.trend === 'increasing' ? 'Tăng' :\n                             aiAnalysis.trendPrediction.trend === 'decreasing' ? 'Giảm' : 'Ổn định'}`,
  `{aiAnalysis.trendPrediction.trend === 'increasing' ? t('history.increasing') :\n                             aiAnalysis.trendPrediction.trend === 'decreasing' ? t('history.decreasing') : t('history.stable')}`,
  'trend badges');

// L2504: Prediction description
hist = r(hist,
  `Dự đoán Yield Rate cho 7 ngày tới (Linear Regression, độ tin cậy: {aiAnalysis.trendPrediction.confidence.toFixed(0)}%)`,
  `{t("history.predictionDesc", { confidence: aiAnalysis.trendPrediction.confidence.toFixed(0) })}`,
  'prediction description');

// L2518: formatter Dự đoán Yield
hist = r(hist,
  `'Dự đoán Yield'`,
  `t('history.predictedYield')`,
  'predicted yield formatter');

// L2519: name="Dự đoán"
hist = r(hist,
  'name="Dự đoán"',
  'name={t("history.prediction")}',
  'prediction bar name');

// L2529: Phát hiện bất thường
hist = r(hist,
  `Phát hiện bất thường`,
  `{t("history.anomalyDetection")}`,
  'anomaly detection');

// L2530: N điểm
hist = r(hist,
  `{aiAnalysis.anomalies.length} điểm`,
  `{aiAnalysis.anomalies.length} {t("history.points")}`,
  'anomaly points');

// L2533: Anomaly desc
hist = r(hist,
  `Các ngày có Yield Rate bất thường (vượt 2σ)`,
  `{t("history.anomalyDesc")}`,
  'anomaly desc');

// L2556: so với TB
hist = r(hist,
  `so với TB)`,
  `{t("history.vsAverage")})`,
  'vs average');

// L2559: Nghiêm trọng / Cảnh báo badge
hist = r(hist,
  `{anomaly.severity === 'critical' ? 'Nghiêm trọng' : 'Cảnh báo'}`,
  `{anomaly.severity === 'critical' ? t('history.critical') : t('history.warningLabel')}`,
  'severity badges');

// L2582-83: No AI data
hist = r(hist,
  `>Không có dữ liệu để phân tích AI</p>`,
  `>{t("history.noAIData")}</p>`,
  'noAIData');
hist = r(hist,
  `>Cần tối thiểu 3 ngày dữ liệu để dự đoán xu hướng</p>`,
  `>{t("history.minDataRequired")}</p>`,
  'minDataRequired');

// L2601: Yield stats desc
hist = r(hist,
  `Biểu đồ và chỉ số hiệu suất sản xuất theo thời gian`,
  `{t("history.yieldStatsDesc")}`,
  'yieldStatsDesc');

// L2829: Ngày table header
hist = r(hist,
  `>Ngày</th>`,
  `>{t("common.date")}</th>`,
  'date th');

// L2830: Tổng table header (yield summary)
hist = r(hist,
  `text-muted-foreground">Tổng</th>`,
  `text-muted-foreground">{t("common.total")}</th>`,
  'total th yield summary');

// L2870-71: No yield data
hist = r(hist,
  `>Không có dữ liệu để thống kê Yield</p>`,
  `>{t("history.noYieldData")}</p>`,
  'noYieldData');
hist = r(hist,
  `>Thử tìm kiếm với bộ lọc khác</p>\n                  </CardContent>\n                </Card>`,
  `>{t("history.tryDifferentFilters")}</p>\n                  </CardContent>\n                </Card>`,
  'tryDifferentFilters 3');

// L2890-91: Gallery desc
hist = r(hist,
  `Xem tất cả hình ảnh từ các điểm đo trong kết quả kiểm tra`,
  `{t("history.galleryDesc")}`,
  'galleryDesc');

// L2907: Điểm in image title  
hist = r(hist,
  'title: `${inspection.serialNumber} - Điểm ${result.measurementPointDefId || idx + 1}`',
  'title: `${inspection.serialNumber} - ${t("history.pointLabel")} ${result.measurementPointDefId || idx + 1}`',
  'image point title');

// L2909: Điểm đo in measurementPointName fallback
hist = r(hist,
  '`Điểm đo ${result.measurementPointDefId || idx + 1}`',
  '`${t("history.measurementPoint")} ${result.measurementPointDefId || idx + 1}`',
  'measurementPoint fallback');

// L2919: title="Hình ảnh điểm đo"
hist = r(hist,
  'title="Hình ảnh điểm đo"',
  'title={t("history.measurementImages")}',
  'measurementImages title');

// L2928-29: No images EmptyState
hist = r(hist,
  `title="Chưa có hình ảnh"\n                    description="Không có hình ảnh nào trong kết quả tìm kiếm hiện tại"`,
  `title={t("history.noImages")}\n                    description={t("history.noImagesDesc")}`,
  'noImages EmptyState');

writeTSX(`${PAGES_DIR}/History.tsx`, hist);
console.log(`History.tsx saved. Hits: ${totalHits}, Misses: ${totalMiss}`);

// ============================================================
// PRODUCTMODELS.TSX
// ============================================================
const histHits = totalHits;
const histMiss = totalMiss;
totalHits = 0;
totalMiss = 0;
console.log('\n=== PRODUCTMODELS.TSX ===');
let prod = readF(`${PAGES_DIR}/ProductModels.tsx`);

// L976: toast.error save point before upload
prod = r(prod,
  'toast.error("Vui lòng lưu điểm đo trước khi upload ảnh")',
  'toast.error(t("products.savePointBeforeUpload"))',
  'savePointBeforeUpload toast');

// L1111: placeholder search
prod = r(prod,
  'placeholder="Tìm theo mã hoặc tên sản phẩm..."',
  'placeholder={t("products.searchByCodeOrName")}',
  'searchByCodeOrName');

// L1133: placeholder="Trạng thái"
prod = r(prod,
  'placeholder="Trạng thái"',
  'placeholder={t("common.status")}',
  'status placeholder');

// L1136-40: Filter items
prod = r(prod,
  `<SelectItem value="all">Tất cả</SelectItem>`,
  `<SelectItem value="all">{t("common.all")}</SelectItem>`,
  'all filter');
prod = r(prod,
  `<SelectItem value="development">Phát triển</SelectItem>`,
  `<SelectItem value="development">{t("products.development")}</SelectItem>`,
  'development filter');
prod = r(prod,
  `<SelectItem value="active">Đang dùng</SelectItem>`,
  `<SelectItem value="active">{t("products.active")}</SelectItem>`,
  'active filter');
prod = r(prod,
  `<SelectItem value="archived">Lưu trữ</SelectItem>`,
  `<SelectItem value="archived">{t("products.archived")}</SelectItem>`,
  'archived filter');

// L1151: placeholder="Sắp xếp"
prod = r(prod,
  'placeholder="Sắp xếp"',
  'placeholder={t("products.sortPlaceholder")}',
  'sort placeholder');

// L1154-59: Sort items
prod = r(prod,
  '>Mới nhất</SelectItem>',
  '>{t("products.newestFirst")}</SelectItem>',
  'newestFirst');
prod = r(prod,
  '>Cũ nhất</SelectItem>',
  '>{t("products.oldestFirst")}</SelectItem>',
  'oldestFirst');
prod = r(prod,
  '>Tên A-Z</SelectItem>',
  '>{t("products.nameAZ")}</SelectItem>',
  'nameAZ');
prod = r(prod,
  '>Tên Z-A</SelectItem>',
  '>{t("products.nameZA")}</SelectItem>',
  'nameZA');
prod = r(prod,
  '>Mã A-Z</SelectItem>',
  '>{t("products.codeAZ")}</SelectItem>',
  'codeAZ');
prod = r(prod,
  '>Mã Z-A</SelectItem>',
  '>{t("products.codeZA")}</SelectItem>',
  'codeZA');

// L1168: Đã lọc badge
prod = r(prod,
  '>Đã lọc</Badge>',
  '>{t("common.filtered")}</Badge>',
  'filtered badge');

// L1179: Xóa bộ lọc
prod = r(prod,
  `Xóa bộ lọc\n`,
  `{t("history.clearFilters")}\n`,
  'clearFilters');

// L1222: Chỉnh sửa
prod = r(prod,
  '>Chỉnh sửa</DropdownMenuItem>',
  '>{t("common.edit")}</DropdownMenuItem>',
  'edit dropdown');

// L1233: Xóa
prod = r(prod,
  '>Xóa</DropdownMenuItem>',
  '>{t("common.delete")}</DropdownMenuItem>',
  'delete dropdown');

// L1243-44: No products
prod = r(prod,
  `title="Chưa có sản phẩm nào"`,
  `title={t("products.noProductsYet")}`,
  'noProductsYet');
prod = r(prod,
  `description='Nhấn "Thêm" để tạo sản phẩm mới'`,
  `description={t("products.clickAddToCreate")}`,
  'clickAddToCreate');

// L1257: Points header / select product
prod = r(prod,
  'selectedProduct ? `Điểm đo - ${selectedProduct.name}` : "Chọn sản phẩm"',
  'selectedProduct ? `${t("products.measurementPointsFor")} - ${selectedProduct.name}` : t("products.selectProduct")',
  'measurementPointsFor / selectProduct');

// L1261-62: N points defined / select product desc
prod = r(prod,
  '`${count} điểm đo đã định nghĩa`',
  't("products.pointsDefined", { count })',
  'pointsDefined');
prod = r(prod,
  '"Chọn một sản phẩm từ danh sách bên trái"',
  't("products.noProductSelectedDesc")',
  'noProductSelectedDesc');

// L1276: Drawing.../Add point
prod = r(prod,
  `"Đang vẽ..." : "Thêm điểm"`,
  `t("products.drawing") : t("products.addPointBtn")`,
  'drawing / addPoint');

// L1288: Đóng button
prod = r(prod,
  `>Đóng</Button>\n`,
  `>{t("common.close")}</Button>\n`,
  'close button 1');

// L1311: Thoát / Chọn
prod = r(prod,
  `"Thoát" : "Chọn"`,
  `t("products.exitMode") : t("products.selectMode")`,
  'exitMode / selectMode');

// L1315: Sửa
prod = r(prod,
  `>Sửa</Button>`,
  `>{t("common.edit")}</Button>`,
  'edit button');

// L1329: Đã chọn: N điểm đo
prod = r(prod,
  `Đã chọn: {count} điểm đo`,
  `{t("products.selectedPoints", { count })}`,
  'selectedPoints');

// L1334: Chọn tất cả
prod = r(prod,
  `>Chọn tất cả</Button>`,
  `>{t("common.selectAll")}</Button>`,
  'selectAll');

// L1338: Bỏ chọn
prod = r(prod,
  `>Bỏ chọn</Button>`,
  `>{t("common.deselectAll")}</Button>`,
  'deselectAll');

// L1348: Xuất CSV
prod = r(prod,
  `>Xuất CSV</Button>`,
  `>{t("history.exportCsv")}</Button>`,
  'exportCsv');

// L1415: Bán kính: (first occurrence in zoom area)
prod = r(prod,
  `Bán kính: {selectedPoint.radius`,
  `{t("products.radius")}: {selectedPoint.radius`,
  'radius label 1');

// L1445: Cập nhật ảnh trong phần chỉnh sửa sản phẩm
prod = r(prod,
  `Cập nhật ảnh trong phần chỉnh sửa sản phẩm`,
  `{t("products.updateImageInEdit")}`,
  'updateImageInEdit');

// L1451: Click để đặt điểm đo
prod = r(prod,
  `Click để đặt điểm đo`,
  `{t("products.clickToPlace")}`,
  'clickToPlace');

// L1457: Đang di chuyển điểm
prod = r(prod,
  `Đang di chuyển điểm`,
  `{t("products.movingPoint")}`,
  'movingPoint');

// L1464: Danh sách điểm đo
prod = r(prod,
  `Danh sách điểm đo`,
  `{t("products.pointList")}`,
  'pointList');

// L1503: Chi tiết điểm đo #
prod = r(prod,
  `Chi tiết điểm đo #`,
  `{t("products.pointDetails")} #`,
  'pointDetails');

// L1512: Mã điểm đo label
prod = r(prod,
  `>Mã điểm đo</Label>`,
  `>{t("products.pointCodeLabel")}</Label>`,
  'pointCodeLabel');

// L1525: Tên điểm đo label
prod = r(prod,
  `>Tên điểm đo</Label>`,
  `>{t("products.pointNameLabel")}</Label>`,
  'pointNameLabel');

// L1548-54: Measurement type SelectItems
prod = r(prod,
  '>Kiểm tra hình ảnh</SelectItem>',
  '>{t("products.typeVisual")}</SelectItem>',
  'typeVisual');
prod = r(prod,
  '>Kích thước</SelectItem>',
  '>{t("products.typeDimension")}</SelectItem>',
  'typeDimension');
prod = r(prod,
  '>Vị trí</SelectItem>',
  '>{t("products.typePosition")}</SelectItem>',
  'typePosition');
prod = r(prod,
  '>Màu sắc</SelectItem>',
  '>{t("products.typeColor")}</SelectItem>',
  'typeColor');
prod = r(prod,
  '>Bề mặt</SelectItem>',
  '>{t("products.typeSurface")}</SelectItem>',
  'typeSurface');
prod = r(prod,
  '>Điện</SelectItem>',
  '>{t("products.typeElectrical")}</SelectItem>',
  'typeElectrical');
prod = r(prod,
  '>Khác</SelectItem>',
  '>{t("products.typeOther")}</SelectItem>',
  'typeOther');

// L1622: Ảnh mẫu điểm đo
prod = r(prod,
  `Ảnh mẫu điểm đo`,
  `{t("products.pointReferenceImage")}`,
  'pointReferenceImage');

// L1645: Chưa có ảnh mẫu
prod = r(prod,
  `Chưa có ảnh mẫu`,
  `{t("products.noReferenceImagePoint")}`,
  'noReferenceImagePoint');

// L1651: Công trạm (tùy chọn)
prod = r(prod,
  `>Công trạm (tùy chọn)</Label>`,
  `>{t("products.workstationOptional")}</Label>`,
  'workstationOptional');

// L1654: placeholder="Chọn công trạm"
prod = r(prod,
  'placeholder="Chọn công trạm"',
  'placeholder={t("products.selectWorkstation")}',
  'selectWorkstation');

// L1672: Vị trí:
prod = r(prod,
  `Vị trí: `,
  `{t("products.position")}: `,
  'position label');

// L1673: Bán kính: (second occurrence in details)
prod = r(prod,
  `Bán kính: {selectedPoint.radius}`,
  `{t("products.radius")}: {selectedPoint.radius}`,
  'radius label 2');

// L1678: Vùng cắt ảnh mẫu
prod = r(prod,
  `Vùng cắt ảnh mẫu (tâm là điểm đo)`,
  `{t("products.cropAreaLabel")}`,
  'cropAreaLabel');

// L1713/1722: Tự động cắt / Upload ảnh buttons
prod = r(prod,
  `>Tự động cắt</Button>`,
  `>{t("products.autoCrop")}</Button>`,
  'autoCrop button');
prod = r(prod,
  `>Upload ảnh</Button>`,
  `>{t("products.uploadImage")}</Button>`,
  'uploadImage button');

// L1729-30: Auto-crop/upload descriptions
prod = r(prod,
  `"Hệ thống sẽ tự động cắt ảnh mẫu từ ảnh sản phẩm với tâm là vị trí điểm đo."`,
  `t("products.autoCropDesc")`,
  'autoCropDesc');
prod = r(prod,
  `"Upload ảnh mẫu riêng cho điểm đo này."`,
  `t("products.uploadDesc")`,
  'uploadDesc');

// L1737: Upload ảnh mẫu
prod = r(prod,
  `>Upload ảnh mẫu</Label>`,
  `>{t("products.uploadPointImage")}</Label>`,
  'uploadPointImage');

// L1755/1759: Đang lưu.../Lưu (save button)
prod = r(prod,
  `"Đang lưu..." : "Lưu"`,
  `t("products.saving") : t("common.save")`,
  'saving / save');

// L1771-73: Select point to view / add point hint
prod = r(prod,
  `Chọn một điểm đo để xem chi tiết`,
  `{t("products.selectPointToView")}`,
  'selectPointToView');
prod = r(prod,
  `Hoặc click "Thêm điểm" rồi click trên ảnh`,
  `{t("products.orClickAddPoint")}`,
  'orClickAddPoint');

// L1781: mangled Vietnamese text (no diacritics)
prod = r(prod,
  'Chon mot san pham de quan ly diem do',
  '{t("products.selectToManage")}',
  'selectToManage');

// L1797: Mã sản phẩm label (edit dialog)
prod = r(prod,
  '>Mã sản phẩm</Label>',
  '>{t("products.productCodeLabel")}</Label>',
  'productCodeLabel edit');

// L1803: Tên sản phẩm label
prod = r(prod,
  '>Tên sản phẩm</Label>',
  '>{t("products.productNameLabel")}</Label>',
  'productNameLabel edit');

// L1818: Danh mục label (edit dialog)  
prod = r(prod,
  `>Danh mục</Label>\n                        <Input`,
  `>{t("common.category")}</Label>\n                        <Input`,
  'category label edit');

// L1822: placeholder="VD: Điện tử"
prod = r(prod,
  'placeholder="VD: Điện tử"',
  'placeholder={t("products.categoryPlaceholder")}',
  'categoryPlaceholder');

// L1827: Dòng sản phẩm
prod = r(prod,
  '>Dòng sản phẩm</Label>',
  '>{t("products.productLine")}</Label>',
  'productLine');

// L1831: placeholder="VD: Premium"
prod = r(prod,
  'placeholder="VD: Premium"',
  'placeholder={t("products.linePlaceholder")}',
  'linePlaceholder');

// L1838: Biến thể
prod = r(prod,
  '>Biến thể</Label>',
  '>{t("products.variant")}</Label>',
  'variant');

// L1847: Trạng thái label (edit dialog)
prod = r(prod,
  `>Trạng thái</Label>\n`,
  `>{t("common.status")}</Label>\n`,
  'status label edit');

// L1852-55: Lifecycle options in edit dialog
prod = r(prod,
  '>Phát triển</SelectItem>\n',
  '>{t("products.development")}</SelectItem>\n',
  'development edit');
prod = r(prod,
  '>Hoạt động</SelectItem>',
  '>{t("products.activeStatus")}</SelectItem>',
  'activeStatus edit');
prod = r(prod,
  '>Kết thúc vòng đời</SelectItem>',
  '>{t("products.endOfLife")}</SelectItem>',
  'endOfLife edit');
// archived already done above as filter, handle the edit dialog one differently
prod = r(prod,
  `>Lưu trữ</SelectItem>\n                      </SelectContent>`,
  `>{t("products.archived")}</SelectItem>\n                      </SelectContent>`,
  'archived edit');

// L1861: Mục tiêu Yield (%)
prod = r(prod,
  '>Mục tiêu Yield (%)</Label>',
  '>{t("products.targetYieldLabel")}</Label>',
  'targetYieldLabel');

// L1873: Yield tối thiểu (%)
prod = r(prod,
  '>Yield tối thiểu (%)</Label>',
  '>{t("products.minYieldLabel")}</Label>',
  'minYieldLabel');

// L1884: Ảnh tham chiếu mới (tùy chọn)
prod = r(prod,
  '>Ảnh tham chiếu mới (tùy chọn)</Label>',
  '>{t("products.newReferenceImage")}</Label>',
  'newReferenceImage');

// L1898: Ảnh hiện tại:
prod = r(prod,
  `Ảnh hiện tại:`,
  `{t("products.currentImage")}:`,
  'currentImage');

// L1910: Đang lưu.../Lưu thay đổi
prod = r(prod,
  `"Đang lưu..." : "Lưu thay đổi"`,
  `t("products.saving") : t("products.saveChanges")`,
  'saving / saveChanges');

// L1918: itemType="sản phẩm"
prod = r(prod,
  'itemType="sản phẩm"',
  'itemType={t("products.productItemType")}',
  'productItemType');

// L1926: itemType="điểm đo"
prod = r(prod,
  'itemType="điểm đo"',
  'itemType={t("products.pointItemType")}',
  'pointItemType');

// L1945: Quản lý Templates
prod = r(prod,
  `>Quản lý Templates</DialogTitle>`,
  `>{t("products.manageTemplates")}</DialogTitle>`,
  'manageTemplates');

// L1947: template dialog desc
prod = r(prod,
  `Lưu hoặc áp dụng template điểm đo cho sản phẩm`,
  `{t("products.templateDialogDesc")}`,
  'templateDialogDesc');

// L1952: Save as new template 
prod = r(prod,
  `Lưu thành Template mới`,
  `{t("products.saveAsNewTemplate")}`,
  'saveAsNewTemplate');

// L1955: Tên template *
prod = r(prod,
  '>Tên template *</Label>',
  '>{t("products.templateNameLabel")}</Label>',
  'templateNameLabel');

// L1961: Danh mục label (template)
prod = r(prod,
  `>Danh mục</Label>\n                        <Select`,
  `>{t("common.category")}</Label>\n                        <Select`,
  'category label template');

// L1963: placeholder="Chọn danh mục"
prod = r(prod,
  'placeholder="Chọn danh mục"',
  'placeholder={t("products.selectCategory")}',
  'selectCategory');

// L1966-69: Template categories
prod = r(prod,
  '>Điện tử</SelectItem>',
  '>{t("products.catElectronics")}</SelectItem>',
  'catElectronics');
prod = r(prod,
  '>Cơ khí</SelectItem>',
  '>{t("products.catMechanical")}</SelectItem>',
  'catMechanical');
prod = r(prod,
  '>Lắp ráp</SelectItem>',
  '>{t("products.catAssembly")}</SelectItem>',
  'catAssembly');
prod = r(prod,
  '>Chung</SelectItem>',
  '>{t("products.catGeneral")}</SelectItem>',
  'catGeneral');

// L1983: Lưu N điểm đo thành template
prod = r(prod,
  'Lưu {points?.length || 0} điểm đo thành template',
  '{t("products.savePointsAsTemplate", { count: points?.length || 0 })}',
  'savePointsAsTemplate');

// L1988: Áp dụng Template có sẵn
prod = r(prod,
  `Áp dụng Template có sẵn`,
  `{t("products.applyExistingTemplate")}`,
  'applyExistingTemplate');

// L1998: Không có mô tả
prod = r(prod,
  `'Không có mô tả'`,
  `t("products.noDescription")`,
  'noDescription');

// L2005: Áp dụng
prod = r(prod,
  `>Áp dụng</Button>`,
  `>{t("common.apply")}</Button>`,
  'apply button');

// L2020: Chưa có template nào
prod = r(prod,
  `Chưa có template nào`,
  `{t("products.noTemplatesYet")}`,
  'noTemplatesYet');

// L2027: Đóng (close button)
prod = r(prod,
  `>Đóng</Button>\n              </DialogFooter>`,
  `>{t("common.close")}</Button>\n              </DialogFooter>`,
  'close button template dialog');

writeTSX(`${PAGES_DIR}/ProductModels.tsx`, prod);
console.log(`ProductModels.tsx saved. Hits: ${totalHits}, Misses: ${totalMiss}`);

const prodHits = totalHits;
const prodMiss = totalMiss;

// ============================================================
// UPDATE LOCALE FILES
// ============================================================
console.log('\n=== UPDATING LOCALE FILES ===');

const newKeys = {
  common: {
    time: { vi: "Thời gian", en: "Time", zh: "时间" },
    error: { vi: "Lỗi", en: "Error", zh: "错误" },
    filtered: { vi: "Đã lọc", en: "Filtered", zh: "已筛选" },
    date: { vi: "Ngày", en: "Date", zh: "日期" },
    apply: { vi: "Áp dụng", en: "Apply", zh: "应用" },
    code: { vi: "Mã", en: "Code", zh: "代码" },
    category: { vi: "Danh mục", en: "Category", zh: "类别" },
  },
  dashboard: {
    pauseAutoRefresh: { vi: "Tạm dừng auto-refresh", en: "Pause auto-refresh", zh: "暂停自动刷新" },
    enableAutoRefresh: { vi: "Bật auto-refresh", en: "Enable auto-refresh", zh: "启用自动刷新" },
    target: { vi: "Mục tiêu", en: "Target", zh: "目标" },
    threshold: { vi: "Ngưỡng", en: "Threshold", zh: "阈值" },
    noAlerts: { vi: "Không có cảnh báo", en: "No alerts", zh: "没有警报" },
    hourlyChartDesc: { vi: "FPY, FY, NTFY và Output theo từng giờ", en: "FPY, FY, NTFY and Output by hour", zh: "FPY、FY、NTFY 和每小时产量" },
    resultDistributionDesc: { vi: "Tỷ lệ OK/NG/NTF tổng hợp", en: "OK/NG/NTF overall distribution", zh: "OK/NG/NTF 总体分布" },
    top10MachinesDesc: { vi: "10 máy có output cao nhất", en: "Top 10 machines by output", zh: "产量最高的10台机器" },
    workstationsNeedImprovement: { vi: "Công trạm cần ưu tiên cải thiện", en: "Workstations needing improvement", zh: "需要改进的工位" },
    noWorkstationData: { vi: "Chưa có dữ liệu công trạm", en: "No workstation data yet", zh: "暂无工位数据" },
    noWorkstationDataDesc: { vi: "Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo.", en: "Data will be displayed when inspection results from measurement points are available.", zh: "当有测量点的检查结果时将显示数据。" },
    ngSeverityLabel: { vi: "Mức độ NG:", en: "NG Severity:", zh: "NG严重程度：" },
    ngLevelGood: { vi: "≤2% (Tốt)", en: "≤2% (Good)", zh: "≤2% (良好)" },
    ngLevelAcceptable: { vi: "2-5% (Chấp nhận)", en: "2-5% (Acceptable)", zh: "2-5% (可接受)" },
    ngLevelWarning: { vi: "5-10% (Cảnh báo)", en: "5-10% (Warning)", zh: "5-10% (警告)" },
    ngLevelCritical: { vi: ">10% (Nghiêm trọng)", en: ">10% (Critical)", zh: ">10% (严重)" },
    exporting: { vi: "Đang xuất...", en: "Exporting...", zh: "正在导出..." },
    exportReport: { vi: "Xuất báo cáo", en: "Export report", zh: "导出报告" },
    ngRate: { vi: "Tỉ lệ NG", en: "NG Rate", zh: "NG率" },
    "7daysBefore": { vi: "7 ngày trước", en: "7 days ago", zh: "7天前" },
    "30daysBefore": { vi: "30 ngày trước", en: "30 days ago", zh: "30天前" },
    improvedVsPrevious: { vi: "Cải thiện so với kỳ trước", en: "Improved vs previous period", zh: "较上期改善" },
    noChange: { vi: "Không thay đổi", en: "No change", zh: "无变化" },
    increasedVsPrevious: { vi: "Tăng so với kỳ trước", en: "Increased vs previous period", zh: "较上期增加" },
    ngTrendChartDesc: { vi: "Biểu đồ thể hiện xu hướng tỉ lệ NG theo thời gian", en: "Chart showing NG rate trend over time", zh: "显示NG率随时间变化趋势的图表" },
    selectWorkstation: { vi: "Chọn công trạm", en: "Select workstation", zh: "选择工位" },
    allWorkstations: { vi: "Tất cả công trạm", en: "All workstations", zh: "所有工位" },
    selectPoint: { vi: "Chọn điểm đo", en: "Select measurement point", zh: "选择测量点" },
    allPoints: { vi: "Tất cả điểm đo", en: "All measurement points", zh: "所有测量点" },
    totalInspections: { vi: "Tổng kiểm tra", en: "Total inspections", zh: "总检查数" },
    ngCountLabel: { vi: "Số lỗi NG", en: "NG count", zh: "NG数量" },
    noTrendData: { vi: "Chưa có dữ liệu xu hướng", en: "No trend data yet", zh: "暂无趋势数据" },
    noTrendDataDesc: { vi: "Dữ liệu sẽ hiển thị khi có kết quả kiểm tra theo ngày.", en: "Data will be displayed when daily inspection results are available.", zh: "当有每日检查结果时将显示数据。" },
    ngRateByWorkstationDesc: { vi: "Hiển thị tỉ lệ lỗi của từng công trạm, màu sắc thể hiện mức độ nghiêm trọng", en: "Showing defect rate per workstation, color indicates severity", zh: "显示每个工位的缺陷率，颜色表示严重程度" },
    topNgPoints: { vi: "Top Điểm đo có tỉ lệ NG cao", en: "Top measurement points with high NG rate", zh: "NG率最高的测量点" },
    topNgPointsDesc: { vi: "Các điểm đo có tỉ lệ lỗi cao nhất, cần ưu tiên kiểm tra và cải thiện", en: "Measurement points with highest defect rate, prioritize for inspection and improvement", zh: "缺陷率最高的测量点，需优先检查和改善" },
    noPointData: { vi: "Chưa có dữ liệu điểm đo", en: "No measurement point data", zh: "暂无测量点数据" },
    noPointDataDesc: { vi: "Dữ liệu sẽ hiển thị khi có kết quả kiểm tra.", en: "Data will be displayed when inspection results are available.", zh: "当有检查结果时将显示数据。" },
    productionLines: { vi: "dây chuyền", en: "lines", zh: "产线" },
    machines: { vi: "máy", en: "machines", zh: "机器" },
    fpyDescription: { vi: "Tỷ lệ sản phẩm đạt lần đầu", en: "First pass yield rate", zh: "首次通过率" },
    shown: { vi: "Hiển thị", en: "Shown", zh: "显示" },
    hidden: { vi: "Ẩn", en: "Hidden", zh: "隐藏" },
    fyDescription: { vi: "Tỷ lệ sản phẩm lỗi", en: "Product fail rate", zh: "产品不良率" },
    ntfyDescription: { vi: "Tỷ lệ không tìm thấy kết quả", en: "No test found rate", zh: "未找到测试结果率" },
    outputDescription: { vi: "Tổng số sản phẩm đã kiểm tra", en: "Total products inspected", zh: "已检查产品总数" },
    dataFrom: { vi: "Dữ liệu từ", en: "Data from", zh: "数据来自" },
    noMeasurementPoints: { vi: "Chưa có điểm đo", en: "No measurement points", zh: "暂无测量点" },
    noMeasurementPointsDesc: { vi: "Công trạm này chưa có điểm đo nào được gán hoặc chưa có dữ liệu kiểm tra.", en: "This workstation has no assigned measurement points or inspection data.", zh: "此工位尚未分配测量点或没有检查数据。" },
  },
  history: {
    filterApplied: { vi: "Đã áp dụng bộ lọc: {{name}}", en: "Filter applied: {{name}}", zh: "已应用筛选器: {{name}}" },
    enterFilterName: { vi: "Nhập tên bộ lọc:", en: "Enter filter name:", zh: "输入筛选器名称：" },
    filterSaved: { vi: "Đã lưu bộ lọc: {{name}}", en: "Filter saved: {{name}}", zh: "已保存筛选器: {{name}}" },
    saveCurrentFilter: { vi: "Lưu bộ lọc hiện tại", en: "Save current filter", zh: "保存当前筛选器" },
    foundResults: { vi: "Tìm thấy {{count}} kết quả", en: "Found {{count}} results", zh: "找到 {{count}} 条结果" },
    showColumns: { vi: "Hiển thị cột", en: "Show columns", zh: "显示列" },
    workshopLabel: { vi: "Nhà xưởng", en: "Workshop", zh: "车间" },
    tryChangingFilters: { vi: "Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm", en: "Try changing filters or search keywords", zh: "尝试更改筛选条件或搜索关键词" },
    loadMoreData: { vi: "Tải thêm dữ liệu", en: "Load more data", zh: "加载更多数据" },
    topNgPointsDesc: { vi: "Những điểm đo có tỷ lệ NG cao nhất cần ưu tiên cải thiện", en: "Measurement points with highest NG rate needing improvement", zh: "NG率最高的测量点需优先改善" },
    ofTotalNg: { vi: "của tổng NG", en: "of total NG", zh: "占总NG" },
    noDataToAnalyze: { vi: "Không có dữ liệu để phân tích", en: "No data to analyze", zh: "没有可分析的数据" },
    tryDifferentFilters: { vi: "Thử tìm kiếm với bộ lọc khác", en: "Try searching with different filters", zh: "尝试使用不同的筛选条件搜索" },
    workstationAnalysisDesc: { vi: "Thống kê lỗi theo công trạm sản xuất và điểm đo để xác định nguyên nhân lỗi", en: "Defect stats by workstation and measurement point to identify root causes", zh: "按工位和测量点统计缺陷以确定根本原因" },
    timeFilter: { vi: "Bộ lọc theo thời gian", en: "Time filter", zh: "时间筛选" },
    summaryByWorkstation: { vi: "Tóm tắt theo Công trạm", en: "Summary by Workstation", zh: "按工位汇总" },
    workstationListDesc: { vi: "Danh sách các công trạm sản xuất và thống kê lỗi", en: "List of production workstations and defect statistics", zh: "生产工位列表和缺陷统计" },
    defectsByWorkstation: { vi: "Lỗi theo Công trạm", en: "Defects by Workstation", zh: "按工位缺陷" },
    top10HighestDefectPoints: { vi: "Top 10 Điểm đo có lỗi cao nhất", en: "Top 10 Highest Defect Points", zh: "缺陷最多的前10个测量点" },
    pointsNeedImprovement: { vi: "Các điểm đo cần ưu tiên cải thiện", en: "Points needing improvement", zh: "需要改善的测量点" },
    noPointData: { vi: "Chưa có dữ liệu điểm đo", en: "No measurement point data", zh: "暂无测量点数据" },
    noPointDataDesc: { vi: "Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo.", en: "Data will be displayed when inspection results from measurement points are available.", zh: "当有测量点的检查结果时将显示数据。" },
    pointsByWorkstation: { vi: "Điểm đo theo Công trạm", en: "Points by Workstation", zh: "按工位测量点" },
    pointCount: { vi: "Số điểm đo", en: "Point count", zh: "测量点数" },
    noWorkstationData: { vi: "Chưa có dữ liệu công trạm", en: "No workstation data", zh: "暂无工位数据" },
    noWorkstationDataDesc: { vi: "Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo được gán công trạm.", en: "Data will display when inspection results from workstation-assigned points are available.", zh: "当有分配给工位的测量点的检查结果时将显示数据。" },
    spcDescription: { vi: "Phân tích thống kê quá trình sản xuất - Control Charts, Histogram, Pareto", en: "Statistical Process Control - Control Charts, Histogram, Pareto", zh: "统计过程控制 - 控制图、直方图、帕累托图" },
    controlChartDesc: { vi: "Biểu đồ kiểm soát Yield Rate theo ngày với UCL, CL, LCL", en: "Yield Rate control chart by day with UCL, CL, LCL", zh: "按日Yield Rate控制图，含UCL、CL、LCL" },
    quantity: { vi: "Số lượng", en: "Quantity", zh: "数量" },
    ngErrorCount: { vi: "Số lỗi NG", en: "NG Error Count", zh: "NG错误数" },
    cumulativePercent: { vi: "Tích lũy %", en: "Cumulative %", zh: "累计 %" },
    noErrorDataToShow: { vi: "Không có dữ liệu lỗi để hiển thị", en: "No error data to display", zh: "没有错误数据可显示" },
    cpCpkExplanation: { vi: "Cp đo lường khả năng tiềm năng của quá trình, Cpk đo lường khả năng thực tế có tính đến độ lệch tâm. Giá trị ≥ 1.33 được coi là xuất sắc, ≥ 1.0 là chấp nhận được, < 1.0 cần cải thiện.", en: "Cp measures potential process capability, Cpk measures actual capability accounting for centering. Values ≥ 1.33 are excellent, ≥ 1.0 acceptable, < 1.0 needs improvement.", zh: "Cp衡量过程的潜在能力，Cpk衡量考虑居中的实际能力。值≥1.33为优秀，≥1.0可接受，<1.0需改善。" },
    heatmapTitle: { vi: "Heatmap - Phân bố NG theo giờ và ngày", en: "Heatmap - NG Distribution by Hour and Day", zh: "热力图 - 按小时和日期的NG分布" },
    heatmapDesc: { vi: "Biểu đồ nhiệt thể hiện mật độ lỗi theo thời gian trong ngày", en: "Heatmap showing defect density by time of day", zh: "显示一天中各时段缺陷密度的热力图" },
    westernElectricRules: { vi: "Western Electric Rules - Cảnh báo", en: "Western Electric Rules - Alerts", zh: "Western Electric 规则 - 警报" },
    rule1Violation: { vi: "{{count}} điểm vượt quá 3σ - Cần kiểm tra ngay", en: "{{count}} points beyond 3σ - Immediate inspection required", zh: "{{count}} 个点超过3σ - 需立即检查" },
    rule2Violation: { vi: "2 trong 3 điểm liên tiếp vượt 2σ", en: "2 of 3 consecutive points beyond 2σ", zh: "连续3个点中有2个超过2σ" },
    rule3Violation: { vi: "4 trong 5 điểm liên tiếp vượt 1σ", en: "4 of 5 consecutive points beyond 1σ", zh: "连续5个点中有4个超过1σ" },
    rule4Violation: { vi: "8 điểm liên tiếp cùng phía với đường tâm", en: "8 consecutive points on same side of center line", zh: "8个连续点位于中心线同一侧" },
    noSPCData: { vi: "Không có dữ liệu để phân tích SPC", en: "No data for SPC analysis", zh: "没有可用于SPC分析的数据" },
    current: { vi: "Hiện tại", en: "Current", zh: "当前" },
    trendPrediction: { vi: "Dự đoán xu hướng", en: "Trend Prediction", zh: "趋势预测" },
    increasing: { vi: "Tăng", en: "Increasing", zh: "上升" },
    decreasing: { vi: "Giảm", en: "Decreasing", zh: "下降" },
    stable: { vi: "Ổn định", en: "Stable", zh: "稳定" },
    predictionDesc: { vi: "Dự đoán Yield Rate cho 7 ngày tới (Linear Regression, độ tin cậy: {{confidence}}%)", en: "Yield Rate prediction for next 7 days (Linear Regression, confidence: {{confidence}}%)", zh: "未来7天Yield Rate预测（线性回归，置信度：{{confidence}}%）" },
    predictedYield: { vi: "Dự đoán Yield", en: "Predicted Yield", zh: "预测Yield" },
    prediction: { vi: "Dự đoán", en: "Prediction", zh: "预测" },
    anomalyDetection: { vi: "Phát hiện bất thường", en: "Anomaly Detection", zh: "异常检测" },
    points: { vi: "điểm", en: "points", zh: "点" },
    anomalyDesc: { vi: "Các ngày có Yield Rate bất thường (vượt 2σ)", en: "Days with abnormal Yield Rate (beyond 2σ)", zh: "Yield Rate异常的日期（超过2σ）" },
    vsAverage: { vi: "so với TB", en: "vs avg", zh: "与平均值比" },
    critical: { vi: "Nghiêm trọng", en: "Critical", zh: "严重" },
    warningLabel: { vi: "Cảnh báo", en: "Warning", zh: "警告" },
    noAIData: { vi: "Không có dữ liệu để phân tích AI", en: "No data for AI analysis", zh: "没有可用于AI分析的数据" },
    minDataRequired: { vi: "Cần tối thiểu 3 ngày dữ liệu để dự đoán xu hướng", en: "Minimum 3 days of data required for trend prediction", zh: "需要至少3天的数据才能进行趋势预测" },
    yieldStatsDesc: { vi: "Biểu đồ và chỉ số hiệu suất sản xuất theo thời gian", en: "Charts and production performance metrics over time", zh: "随时间变化的图表和生产绩效指标" },
    noYieldData: { vi: "Không có dữ liệu để thống kê Yield", en: "No data for Yield statistics", zh: "没有可用于Yield统计的数据" },
    galleryDesc: { vi: "Xem tất cả hình ảnh từ các điểm đo trong kết quả kiểm tra", en: "View all images from measurement points in inspection results", zh: "查看检查结果中测量点的所有图片" },
    pointLabel: { vi: "Điểm", en: "Point", zh: "点" },
    measurementPoint: { vi: "Điểm đo", en: "Measurement point", zh: "测量点" },
    measurementImages: { vi: "Hình ảnh điểm đo", en: "Measurement point images", zh: "测量点图片" },
    noImages: { vi: "Chưa có hình ảnh", en: "No images yet", zh: "暂无图片" },
    noImagesDesc: { vi: "Không có hình ảnh nào trong kết quả tìm kiếm hiện tại", en: "No images found in current search results", zh: "当前搜索结果中没有找到图片" },
  },
  products: {
    savePointBeforeUpload: { vi: "Vui lòng lưu điểm đo trước khi upload ảnh", en: "Please save the point before uploading an image", zh: "请在上传图片前保存测量点" },
    searchByCodeOrName: { vi: "Tìm theo mã hoặc tên sản phẩm...", en: "Search by product code or name...", zh: "按产品代码或名称搜索..." },
    sortPlaceholder: { vi: "Sắp xếp", en: "Sort", zh: "排序" },
    newestFirst: { vi: "Mới nhất", en: "Newest first", zh: "最新优先" },
    oldestFirst: { vi: "Cũ nhất", en: "Oldest first", zh: "最早优先" },
    nameAZ: { vi: "Tên A-Z", en: "Name A-Z", zh: "名称 A-Z" },
    nameZA: { vi: "Tên Z-A", en: "Name Z-A", zh: "名称 Z-A" },
    codeAZ: { vi: "Mã A-Z", en: "Code A-Z", zh: "代码 A-Z" },
    codeZA: { vi: "Mã Z-A", en: "Code Z-A", zh: "代码 Z-A" },
    noProductsYet: { vi: "Chưa có sản phẩm nào", en: "No products yet", zh: "暂无产品" },
    clickAddToCreate: { vi: "Nhấn \"Thêm\" để tạo sản phẩm mới", en: "Click \"Add\" to create a new product", zh: "点击\"添加\"创建新产品" },
    measurementPointsFor: { vi: "Điểm đo", en: "Measurement Points", zh: "测量点" },
    pointsDefined: { vi: "{{count}} điểm đo đã định nghĩa", en: "{{count}} measurement points defined", zh: "已定义 {{count}} 个测量点" },
    drawing: { vi: "Đang vẽ...", en: "Drawing...", zh: "正在绘制..." },
    exitMode: { vi: "Thoát", en: "Exit", zh: "退出" },
    selectMode: { vi: "Chọn", en: "Select", zh: "选择" },
    selectedPoints: { vi: "Đã chọn: {{count}} điểm đo", en: "Selected: {{count}} points", zh: "已选择: {{count}} 个测量点" },
    updateImageInEdit: { vi: "Cập nhật ảnh trong phần chỉnh sửa sản phẩm", en: "Update image in product edit section", zh: "在产品编辑中更新图片" },
    movingPoint: { vi: "Đang di chuyển điểm", en: "Moving point", zh: "正在移动点" },
    pointDetails: { vi: "Chi tiết điểm đo", en: "Point details", zh: "测量点详情" },
    pointReferenceImage: { vi: "Ảnh mẫu điểm đo", en: "Point reference image", zh: "测量点参考图片" },
    noReferenceImagePoint: { vi: "Chưa có ảnh mẫu", en: "No reference image", zh: "暂无参考图片" },
    workstationOptional: { vi: "Công trạm (tùy chọn)", en: "Workstation (optional)", zh: "工位（可选）" },
    selectWorkstation: { vi: "Chọn công trạm", en: "Select workstation", zh: "选择工位" },
    cropAreaLabel: { vi: "Vùng cắt ảnh mẫu (tâm là điểm đo)", en: "Reference image crop area (centered on point)", zh: "参考图片裁剪区域（以测量点为中心）" },
    autoCrop: { vi: "Tự động cắt", en: "Auto crop", zh: "自动裁剪" },
    uploadImage: { vi: "Upload ảnh", en: "Upload image", zh: "上传图片" },
    autoCropDesc: { vi: "Hệ thống sẽ tự động cắt ảnh mẫu từ ảnh sản phẩm với tâm là vị trí điểm đo.", en: "System will auto-crop reference image from product image centered on the point position.", zh: "系统将自动从产品图片中裁剪以测量点位置为中心的参考图片。" },
    uploadDesc: { vi: "Upload ảnh mẫu riêng cho điểm đo này.", en: "Upload a separate reference image for this point.", zh: "为此测量点上传单独的参考图片。" },
    uploadPointImage: { vi: "Upload ảnh mẫu", en: "Upload reference image", zh: "上传参考图片" },
    saving: { vi: "Đang lưu...", en: "Saving...", zh: "正在保存..." },
    selectPointToView: { vi: "Chọn một điểm đo để xem chi tiết", en: "Select a measurement point to view details", zh: "选择一个测量点查看详情" },
    orClickAddPoint: { vi: "Hoặc click \"Thêm điểm\" rồi click trên ảnh", en: "Or click \"Add Point\" then click on the image", zh: "或点击\"添加点\"然后在图片上点击" },
    selectToManage: { vi: "Chọn một sản phẩm để quản lý điểm đo", en: "Select a product to manage measurement points", zh: "选择一个产品来管理测量点" },
    productCodeLabel: { vi: "Mã sản phẩm", en: "Product code", zh: "产品代码" },
    productNameLabel: { vi: "Tên sản phẩm", en: "Product name", zh: "产品名称" },
    categoryPlaceholder: { vi: "VD: Điện tử", en: "e.g.: Electronics", zh: "例如：电子产品" },
    productLine: { vi: "Dòng sản phẩm", en: "Product line", zh: "产品线" },
    linePlaceholder: { vi: "VD: Premium", en: "e.g.: Premium", zh: "例如：Premium" },
    variant: { vi: "Biến thể", en: "Variant", zh: "变体" },
    activeStatus: { vi: "Hoạt động", en: "Active", zh: "活跃" },
    endOfLife: { vi: "Kết thúc vòng đời", en: "End of life", zh: "生命周期结束" },
    targetYieldLabel: { vi: "Mục tiêu Yield (%)", en: "Target Yield (%)", zh: "目标Yield (%)" },
    minYieldLabel: { vi: "Yield tối thiểu (%)", en: "Minimum Yield (%)", zh: "最低Yield (%)" },
    newReferenceImage: { vi: "Ảnh tham chiếu mới (tùy chọn)", en: "New reference image (optional)", zh: "新参考图片（可选）" },
    currentImage: { vi: "Ảnh hiện tại", en: "Current image", zh: "当前图片" },
    saveChanges: { vi: "Lưu thay đổi", en: "Save changes", zh: "保存更改" },
    productItemType: { vi: "sản phẩm", en: "product", zh: "产品" },
    pointItemType: { vi: "điểm đo", en: "measurement point", zh: "测量点" },
    manageTemplates: { vi: "Quản lý Templates", en: "Manage Templates", zh: "管理模板" },
    templateDialogDesc: { vi: "Lưu hoặc áp dụng template điểm đo cho sản phẩm", en: "Save or apply measurement point template for product", zh: "保存或应用产品的测量点模板" },
    saveAsNewTemplate: { vi: "Lưu thành Template mới", en: "Save as New Template", zh: "保存为新模板" },
    templateNameLabel: { vi: "Tên template *", en: "Template name *", zh: "模板名称 *" },
    selectCategory: { vi: "Chọn danh mục", en: "Select category", zh: "选择类别" },
    catElectronics: { vi: "Điện tử", en: "Electronics", zh: "电子" },
    catMechanical: { vi: "Cơ khí", en: "Mechanical", zh: "机械" },
    catAssembly: { vi: "Lắp ráp", en: "Assembly", zh: "组装" },
    catGeneral: { vi: "Chung", en: "General", zh: "通用" },
    savePointsAsTemplate: { vi: "Lưu {{count}} điểm đo thành template", en: "Save {{count}} points as template", zh: "将 {{count}} 个测量点保存为模板" },
    applyExistingTemplate: { vi: "Áp dụng Template có sẵn", en: "Apply Existing Template", zh: "应用现有模板" },
    noDescription: { vi: "Không có mô tả", en: "No description", zh: "无描述" },
    noTemplatesYet: { vi: "Chưa có template nào", en: "No templates yet", zh: "暂无模板" },
  }
};

// Process each locale file
for (const lang of ['vi', 'en', 'zh']) {
  const localeFile = `${LOCALES_DIR}/${lang}.json`;
  let locale = JSON.parse(readF(localeFile));
  let addedCount = 0;

  for (const [section, keys] of Object.entries(newKeys)) {
    if (!locale[section]) locale[section] = {};
    for (const [key, translations] of Object.entries(keys)) {
      if (!locale[section][key]) {
        locale[section][key] = translations[lang];
        addedCount++;
      }
    }
  }

  const jsonStr = JSON.stringify(locale, null, 2);
  writeF(localeFile, jsonStr);
  console.log(`${lang}.json: added ${addedCount} new keys`);
}

console.log('\n=== SUMMARY ===');
console.log(`Dashboard.tsx: ${dashHits} hits, ${dashMiss} misses`);
console.log(`History.tsx: ${histHits} hits, ${histMiss} misses`);
console.log(`ProductModels.tsx: ${prodHits} hits, ${prodMiss} misses`);
console.log(`Total: ${dashHits + histHits + prodHits} hits, ${dashMiss + histMiss + prodMiss} misses`);
