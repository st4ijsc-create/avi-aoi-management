/**
 * ★★★ **CỔNG ĐIỀU TRA DÂN SỐ GIẤY PHÉP `MOD_AI`** — và nửa quan trọng hơn của nó là **KHÔNG HỒI QUY**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BÀI TOÁN THƯƠNG MẠI, PHÁT BIỂU BẰNG LƯỢNG TỪ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chủ dự án bán hệ cho **hai** loại khách: doanh nghiệp **KHÔNG** mua AI và doanh nghiệp **CÓ** mua
 * AI. Yêu cầu số một, nguyên văn: *"đảm bảo rằng các hệ thống khác không dùng AI sẽ KHÔNG bị ảnh
 * hưởng"*. Tức **không hồi quy** đứng TRÊN phủ sóng.
 *
 * ⇒ File này canh **HAI** lượng từ đi NGƯỢC chiều nhau. Chỉ có một là không đủ:
 *
 *   §3 (KHÔNG HỒI QUY — quan trọng nhất)
 *       ∀ thủ tục dưới `server/**` **KHÔNG** thuộc bề mặt AI: nó **KHÔNG** được đứng sau `MOD_AI`.
 *       Một lượt "bọc cho chắc" quanh `productionRouters.ts` sẽ làm ĐỎ ô này — và đó chính là kiểu
 *       hỏng mà khách không-AI phải chịu.
 *
 *   §4 (PHỦ SÓNG)
 *       ∀ thủ tục **thuộc** bề mặt AI: nó phải đứng sau `MOD_AI`, **trừ** những tên đã **KÝ** trong
 *       `MIEN_TRU_VAN_HANH` — mỗi tên kèm lý do đo được, không phải khẩu vị.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ CỔNG XANH **KHÔNG** CHỨNG MINH "khách không-AI không bị ảnh hưởng". Nó chứng minh BỐN điều:
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   (1) bề mặt đã được **ĐẾM** — 2.219 thủ tục, không còn là ước lượng. Con số này trùng **ĐÚNG**
 *       với `phamViDocCensus.test.ts#GHIM.tong` — hai bộ suy AST **độc lập hoàn toàn** (một đi tìm
 *       phạm vi đọc, một đi tìm cổng giấy phép) đếm ra **cùng một dân số**. Đó là phép đối chiếu
 *       rẻ nhất chống "bộ suy quét trúng nửa cây rồi tự khai đủ".
 *   (2) **0** thủ tục ngoài AI bị khoá nhầm — đo trên **toàn bộ** sổ, không phải trên vài ca mẫu;
 *   (3) món nợ "AI chưa khoá" **KHÔNG PHÌNH** mà không ai ký tên;
 *   (4) vị từ **BẮT ĐƯỢC** cả hai hình dạng hỏng — §7 là **ĐỘT BIẾN THẬT** (ghi router ra đĩa,
 *       quét lại bằng CHÍNH bộ suy đang canh sản phẩm, đòi ĐỎ), kèm một ca **ĐỐI CHỨNG** chống
 *       "vá quá tay".
 *
 * Nó **không** chứng minh 62 thủ tục miễn trừ là vô hại — chúng là **NỢ SẢN PHẨM**, và §2 in con số
 * ấy mỗi lượt chạy để không ai quên. Nó cũng **không** phát biểu gì về hành vi lúc chạy: ba tình
 * huống SKU (không mua AI · có mua AI · chưa khai SKU) được đo ở
 * `server/_core/moduleGate.congGiayPhep.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  quetCongGiayPhep,
  quetCongAiExpress,
  khoaCong,
  type ThuTucCong,
} from "./congGiayPhepScan";

const GOC_REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QUET = quetCongGiayPhep(GOC_REPO);

/**
 * ★★★ **BỀ MẶT AI** — tập file mà "thuộc SKU AI" là mặc định.
 *
 * ⚠ Nó là một **VỊ TỪ**, không phải một danh sách file: mọi `server/routers/ai<Hoa>*.ts` đều thuộc
 *   bề mặt, nên `aiFooRouter.ts` tạo ngày mai **tự vào** tập này và §4 sẽ đòi nó có cổng — không ai
 *   phải nhớ khai thêm. Đúng một file được khai TƯỜNG MINH: `repoWorkspaceRouter.ts` (không gauge
 *   tên "ai…" nhưng là không-gian-làm-việc của tác nhân AI, và nó ĐÃ đứng sau `MOD_AI` từ doc 78).
 */
const FILE_AI_TUONG_MINH = new Set([
  "server/routers/repoWorkspaceRouter.ts",
  // `causalGraph` đã được `server/_core/moduleAccessMap.ts` khai là MOD_AI từ doc 38 (chỉ chưa nối
  // dây), và `/causal-graph` đã nằm trong `MOD_AI.routes`. Tên file không mang tiền tố `ai`.
  "server/routers/causalGraphRouter.ts",
]);
const laBeMatAi = (file: string): boolean =>
  /^server\/routers\/ai[A-Z]/.test(file) || FILE_AI_TUONG_MINH.has(file);

const beMatAi = QUET.thuTuc.filter((t) => laBeMatAi(t.file));
const aiCoCong = beMatAi.filter((t) => t.module === "MOD_AI");
const aiKhongCong = beMatAi.filter((t) => t.module !== "MOD_AI");
const ngoaiAiCoCong = QUET.thuTuc.filter((t) => !laBeMatAi(t.file) && t.module === "MOD_AI");

/**
 * ★★★ **SỔ KÝ TÊN: thủ tục nằm trong file AI mà CỐ Ý KHÔNG khoá sau `MOD_AI`.**
 *
 * ⚠⚠⚠ Đây **KHÔNG** phải một cửa miễn trừ để làm cổng xanh. Mỗi dòng là một **lời khai**: *"thủ tục
 *      này ở trong một file tên `ai…` nhưng nó là dữ liệu/hành vi **VẬN HÀNH**, và khoá nó sẽ làm
 *      hỏng khách KHÔNG mua AI"*. Tiêu chuẩn để một tên được vào đây — cả hai vế:
 *        (a) dữ liệu/hành vi **không** độc quyền AI, **HOẶC**
 *        (b) có ít nhất **một** nơi gọi ở client nằm trên tuyến **KHÔNG** thuộc `MOD_AI`.
 *      Bằng chứng (b) được đo bằng cách tra `trpc.<khônggiantên>.<thủtục>` dưới `client/src` rồi
 *      truy ngược ra tuyến trong `App.tsx` và chủ tuyến trong `shared/module-registry.ts`.
 *
 * ⚠ Sổ này **chỉ được CO LẠI**. Một tên rời sổ khi (i) bề mặt client của nó đã được ẩn theo module,
 *   rồi (ii) thủ tục được nối cổng — và §5 sẽ ĐỎ nếu ai đó nối cổng mà quên xoá dòng.
 */
const MIEN_TRU_VAN_HANH: readonly string[] = [
  // ── aiAgentRouter — CÔNG TẮC DỪNG KHẨN. Giấy phép có thể HẾT HẠN trong lúc phiên agent đang
  //    chạy; khoá cái nút DỪNG sau chính hợp đồng thương mại ấy là ngược chiều an toàn.
  "server/routers/aiAgentRouter.ts#aiAgentRouter.getKillSwitchStatus",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.tripKillSwitch",
  "server/routers/aiAgentRouter.ts#aiAgentRouter.untripKillSwitch",
  // ── aiAnomalyRouter — `MachineAISummary` hiện ở `/production-dashboard` (MOD_PRODUCTION),
  //    `/quality-cockpit`, `/repair-station`, `MachineWorkspace`: màn của khách KHÁC, không phải AI.
  "server/routers/aiAnomalyRouter.ts#aiAnomalyRouter.latestForMachine",
  // ── aiFeedbackRouter — `AISuggestionsPanel` được `pages/InspectionDetail.tsx` gắn VÔ ĐIỀU KIỆN;
  //    `/inspection/:id` là màn CỐT LÕI của mọi khách.
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.getSuggestionsByInspection",
  "server/routers/aiFeedbackRouter.ts#aiFeedbackRouter.submitFeedback",
  // ── aiImageSearchRouter — `RepairAISummary` nằm trong `pages/RepairStation.tsx` (MOD_QUALITY).
  "server/routers/aiImageSearchRouter.ts#aiImageSearchRouter.searchByUpload",
  // ── aiInboxRouter — `AIActionInboxLauncher` nằm trong HEADER của `DashboardLayout`, tức trên MỌI
  //    trang; `count` còn tự bắn theo nhịp. Thêm `OperatorHome`/`MaintenanceHome`/`ApprovalsInbox`/
  //    `ExecutiveMobile` — hộp duyệt gộp AI với duyệt ngưỡng và duyệt triển khai.
  "server/routers/aiInboxRouter.ts#aiInboxRouter.count",
  "server/routers/aiInboxRouter.ts#aiInboxRouter.dismiss",
  "server/routers/aiInboxRouter.ts#aiInboxRouter.list",
  // ── aiInsightRouter — `ai_insights` KHÔNG chỉ do AI ghi: `services/machineAuthService.ts` ghi
  //    cảnh báo HẾT HẠN KHOÁ API MÁY vào đúng bảng ấy (an ninh vận hành, không một lượt suy luận
  //    nào). Người đọc gồm `ControlTower` (topRisks) và `ExecutiveMobile`.
  "server/routers/aiInsightRouter.ts#aiInsightRouter.list",
  "server/routers/aiInsightRouter.ts#aiInsightRouter.setStatus",
  // ── aiInspectionAnalyticsRouter — TOÀN BỘ router là SQL/SPC/thống kê thuần (bản có kể chuyện
  //    bằng LLM nằm trong service nhưng KHÔNG được nối vào router này). `DrillDownDashboard.tsx`
  //    gọi `defectTrend`/`defectPareto`, và `/drill-down` thuộc **CORE_DASHBOARD** — module LÕI.
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.comprehensiveReport",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.controlChart",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.correlations",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.defectHeatmap",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.defectPareto",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.defectTrend",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.machinePerformance",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.riskAssessment",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.rolloutStatus",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.shiftAnalysis",
  "server/routers/aiInspectionAnalyticsRouter.ts#aiInspectionAnalyticsRouter.yieldForecast",
  // ── aiLocalKbRouter — phép dò TRẠNG THÁI (`publicProcedure`, trả `ready:false` khi hỏng), người
  //    gọi là bong bóng chat gắn ở GỐC `App.tsx`.
  "server/routers/aiLocalKbRouter.ts#aiLocalKbRouter.health",
  // ── aiModelRouter — `Step4DeployModel` là bước 4 của `MachineOnboardingWizard`: luồng LẮP ĐẶT
  //    MÁY, việc vận hành. Đây là lượt ĐỌC sổ đăng ký model, không suy luận, không tiêu VRAM.
  "server/routers/aiModelRouter.ts#aiModelRouter.list",
  // ── aiOrchestrationRouter — người gọi duy nhất là `pages/OrchestrationStudio.tsx`, và tuyến
  //    `/orchestration-studio` **KHÔNG thuộc module nào** trong registry ⇒ mọi khách vào được.
  "server/routers/aiOrchestrationRouter.ts#aiOrchestrationRouter.optimizeWorkflow",
  "server/routers/aiOrchestrationRouter.ts#aiOrchestrationRouter.status",
  "server/routers/aiOrchestrationRouter.ts#aiOrchestrationRouter.suggestWorkflow",
  // ── aiProgrammingKbRouter — `components/ManualHelp.tsx` được gắn ở `AndonBoard`
  //    (CORE_DASHBOARD), `DeviceAdapterManagement` (MOD_MONITORING) và `EngineeringWorkspace`.
  "server/routers/aiProgrammingKbRouter.ts#aiProgrammingKbRouter.collections",
  "server/routers/aiProgrammingKbRouter.ts#aiProgrammingKbRouter.reload",
  "server/routers/aiProgrammingKbRouter.ts#aiProgrammingKbRouter.search",
  // ── aiRcaCopilotRouter — người gọi là `pages/TechnicianCopilot.tsx`, và `/technician-copilot`
  //    thuộc **MOD_MONITORING** trong registry (không phải MOD_AI).
  "server/routers/aiRcaCopilotRouter.ts#aiRcaCopilotRouter.applyTopFix",
  "server/routers/aiRcaCopilotRouter.ts#aiRcaCopilotRouter.diagnose",
  "server/routers/aiRcaCopilotRouter.ts#aiRcaCopilotRouter.latest",
  // ── aiRouters.ts / predictiveAlertRouter — `predictive_alerts` là SỔ CẢNH BÁO TRUNG TÂM, được
  //    ghi bởi SPC (`spcCentralAlertBridge`), SLO burn-rate, leo thang, trôi cấu hình, quality-gate
  //    và KPI báo động; `pages/OpsConsole.tsx` đọc + xác nhận nó. Khoá = tắt bảng cảnh báo.
  "server/routers/aiRouters.ts#predictiveAlertRouter.acknowledge",
  "server/routers/aiRouters.ts#predictiveAlertRouter.dismiss",
  "server/routers/aiRouters.ts#predictiveAlertRouter.generatePredictions",
  "server/routers/aiRouters.ts#predictiveAlertRouter.get",
  "server/routers/aiRouters.ts#predictiveAlertRouter.list",
  "server/routers/aiRouters.ts#predictiveAlertRouter.resolve",
  "server/routers/aiRouters.ts#predictiveAlertRouter.stats",
  // ── aiRouters.ts / rootCauseRouter — tuyến `/root-cause-analysis` **KHÔNG thuộc module nào**
  //    trong registry ⇒ mọi khách vào được; và `generateRCAInsights` có nhánh dự phòng THEO LUẬT
  //    (không LLM) nên trang này VẪN CHẠY được khi không có AI.
  "server/routers/aiRouters.ts#rootCauseRouter.analyze",
  "server/routers/aiRouters.ts#rootCauseRouter.delete",
  "server/routers/aiRouters.ts#rootCauseRouter.get",
  "server/routers/aiRouters.ts#rootCauseRouter.list",
  "server/routers/aiRouters.ts#rootCauseRouter.update",
  // ── aiSetupAdvisorRouter — KHÔNG một lời gọi LLM/embedding nào: đọc `machines` + điểm đo + ngưỡng
  //    rồi cho một bộ cấu hình gợi ý. Người gọi là `components/onboarding/AISetupSuggestion.tsx`.
  "server/routers/aiSetupAdvisorRouter.ts#aiSetupAdvisorRouter.status",
  "server/routers/aiSetupAdvisorRouter.ts#aiSetupAdvisorRouter.suggestSetup",
  // ── aiSmartAlertRoutingRouter — đường GHI/ACK/LEO THANG của `predictive_alerts`. Phần AI duy
  //    nhất (`enrichRoutingWithAI`) là tuỳ chọn và trả `null` khi hỏng: định tuyến, lưu và gửi
  //    thông báo xảy ra bất kể có AI hay không.
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.acknowledge",
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.cleanup",
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.detectSpike",
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.detectYieldDrop",
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.processEscalation",
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.route",
  "server/routers/aiSmartAlertRoutingRouter.ts#aiSmartAlertRoutingRouter.stats",
  // ── aiThresholdAdvisorRouter — thống kê cổ điển (`utils/thresholdSuggestion`), KHÔNG LLM.
  //    `AIThresholdSuggestButton` được gắn ở `ProductModels` và `MqttNgRateThreshold` — màn dữ liệu
  //    chủ / ngưỡng, việc vận hành hằng ngày.
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.applyNgThreshold",
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.recommendForPoint",
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.recommendInspectionParam",
  "server/routers/aiThresholdAdvisorRouter.ts#aiThresholdAdvisorRouter.recommendNgThreshold",
  // ── aiTodayRouter — `TodayBriefing` là màn CHÀO SAU ĐĂNG NHẬP của TÁM trang chủ theo vai; phần
  //    lớn nội dung (OEE, sản lượng, tỷ lệ NG, Pareto) là vận hành thuần.
  "server/routers/aiTodayRouter.ts#aiTodayRouter.get",
  // ── aiVisionRouter — hai lượt đọc `defect_catalog`: DỮ LIỆU CHỦ vận hành, không suy luận.
  "server/routers/aiVisionRouter.ts#aiVisionRouter.defectCodes",
  "server/routers/aiVisionRouter.ts#aiVisionRouter.suggestDefectCodes",
];

/**
 * ★★★ CON SỐ GHIM (đo 2026-08-19, sau lượt nối cổng đầu tiên).
 *
 * ⚠ Đổi một số ở đây là một **lời khai**, không phải một lượt bảo trì. `aiCoCong + aiMienTru`
 *   **PHẢI** bằng `beMatAi`, nên không sửa lén được một ô.
 *
 * ★ `tong: 2219` trùng ĐÚNG với `phamViDocCensus.test.ts#GHIM.tong` — hai bộ suy AST độc lập,
 *   viết cho hai mục đích khác nhau, đếm ra cùng một dân số thủ tục. Nếu một ngày hai con số lệch,
 *   **một trong hai bộ suy đã mù đi một phần cây** và cả hai cổng đều đáng ngờ cho tới khi giải
 *   thích được chênh lệch.
 *
 * ⚠⚠ **ĐỪNG đo con số này trong lúc suite đang chạy song song.** §7 của chính file này (và §7 của
 *    `phamViDocCensus.test.ts`) **ghi router thật ra `server/routers/`** rồi xoá đi. Một lượt đo
 *    chen vào giữa sẽ thấy `tong` cao hơn 2-4 đơn vị, và người đo sẽ sửa GHIM theo một con số MA.
 *    Đã cắn đúng một lần ở lượt này: đo được **2221**, chạy lại một mình ra **2219**.
 *
 * ★ 2026-08-19 lượt 2 — **beMatAi 345 → 353 · aiCoCong 283 → 291.** Lời khai: `causalGraphRouter.ts`
 *   (8 thủ tục) được nối cổng và khai vào `FILE_AI_TUONG_MINH`. `moduleAccessMap.ts` đã ghi
 *   `causalGraph: MOD.AI` từ doc 38 mà **chưa bao giờ nối dây**, còn `/causal-graph` thì đã nằm
 *   trong `MOD_AI.routes` — tức client chặn tuyến trong khi máy chủ vẫn mở. `tong` KHÔNG đổi
 *   (router ấy vốn đã được đếm), `aiMienTru` KHÔNG đổi, `ngoaiAiCoCong` vẫn **0**.
 */
const GHIM = { tong: 2219, beMatAi: 353, aiCoCong: 291, aiMienTru: 62, ngoaiAiCoCong: 0 } as const;

/**
 * ★★ Dân số cổng của **các module KHÁC** — chiều thứ hai của "không hồi quy".
 *
 * Lượt việc này nói về `MOD_AI` và **chỉ** `MOD_AI`. Nếu một con số dưới đây đổi, ai đó đã chạm vào
 * cổng giấy phép của một SKU khác — dù vô tình. Đó là tin xấu cần biết ngay, không phải ba tuần sau
 * khi một khách MOD_QUALITY gọi điện.
 */
const GHIM_MODULE_KHAC = {
  MOD_PRODUCTION: 62,
  MOD_QUALITY: 67,
  MOD_ENGINEERING: 68,
  MOD_FEDERATION: 8,
  MOD_OT_CONTROL: 105,
} as const;

describe("§1 — CẦU CHÌ: bộ suy có thật sự nhìn thấy gì không", () => {
  it("★ không có ô MÙ nào (mỗi ô mù là một chỗ KHÔNG AI CANH)", () => {
    expect(
      QUET.mu,
      "Bộ suy tự khai là không còn đủ. Đọc từng dòng — ĐỪNG nới lượng từ để làm nó im.",
    ).toEqual([]);
  });

  it("quét trúng đủ file / đủ router / đủ thủ tục (chống 'xanh vì quét trúng 0 thứ')", () => {
    // Ngưỡng đặt THẤP HƠN hẳn số đo (1.983 file · 204 file router · 2.219 thủ tục) — chúng chỉ bắt
    // cái chết hẳn (đổi cấu trúc thư mục, đổi hình dạng `router({…})`), không bắt độ trôi bình thường.
    expect(QUET.soFileDuyet).toBeGreaterThan(1500);
    expect(QUET.soFileParse).toBeGreaterThan(150);
    expect(QUET.thuTuc.length).toBeGreaterThan(1800);
  });

  it("★ bộ suy đọc được NHIỀU module, không chỉ MOD_AI (chống vị từ chỉ biết một chữ)", () => {
    const co = new Set(QUET.thuTuc.map((t) => t.module).filter((m): m is string => m !== null));
    // Sáu SKU đang có cổng thật trong mã. Vị từ chỉ nhận ra `MOD_AI` sẽ làm §3 xanh TỰ THOẢ.
    expect([...co].sort()).toEqual([
      "MOD_AI",
      "MOD_ENGINEERING",
      "MOD_FEDERATION",
      "MOD_OT_CONTROL",
      "MOD_PRODUCTION",
      "MOD_QUALITY",
    ]);
  });

  it("★ tập bề mặt AI khác rỗng VÀ không nuốt cả cây (vị từ `laBeMatAi` còn phân biệt được)", () => {
    expect(beMatAi.length).toBeGreaterThan(200);
    expect(beMatAi.length).toBeLessThan(QUET.thuTuc.length / 2);
  });
});

describe("§2 — CON SỐ GHIM", () => {
  it("★ dân số cổng ĐÚNG BẰNG số đã ghim", () => {
    expect(
      {
        tong: QUET.thuTuc.length,
        beMatAi: beMatAi.length,
        aiCoCong: aiCoCong.length,
        aiMienTru: aiKhongCong.length,
        ngoaiAiCoCong: ngoaiAiCoCong.length,
      },
      "Dân số đã đổi. Sửa `GHIM` cho khớp SỐ ĐO ĐƯỢC và ghi lý do — đừng sửa cho xanh.",
    ).toEqual(GHIM);
  });

  it("★ phép cộng khớp: có cổng + miễn trừ = bề mặt AI (không ô nào rơi ra ngoài)", () => {
    expect(GHIM.aiCoCong + GHIM.aiMienTru).toBe(GHIM.beMatAi);
    expect(aiCoCong.length + aiKhongCong.length).toBe(beMatAi.length);
  });
});

describe("§3 — ★★★ KHÔNG HỒI QUY: KHÔNG thủ tục nào NGOÀI bề mặt AI bị khoá sau MOD_AI", () => {
  it("★★★ ∀ thủ tục ngoài AI ⇒ KHÔNG có cổng MOD_AI", () => {
    expect(
      ngoaiAiCoCong.map((t) => `${khoaCong(t)} (dòng ${t.dong}; sàn: ${t.san})`),
      "MỘT THỦ TỤC **KHÔNG THUỘC AI** ĐANG ĐỨNG SAU GIẤY PHÉP `MOD_AI`.\n" +
        "Khách mua module khác mà không mua AI sẽ nhận FORBIDDEN trên màn của HỌ — đó là vi phạm\n" +
        "ràng buộc số một của cả lượt việc (*'hệ thống khác không dùng AI KHÔNG bị ảnh hưởng'*).\n" +
        "Cách đúng: gỡ `moduleGate(\"MOD_AI\")` khỏi thủ tục ấy. Nếu nó THẬT SỰ là AI, hãy chuyển\n" +
        "file sang bề mặt AI (đổi tên router) hoặc khai tường minh trong `FILE_AI_TUONG_MINH` —\n" +
        "và khi đó phải kiểm lại MỌI nơi gọi ở client, vì bề mặt AI kéo theo cả cổng client.",
    ).toEqual([]);
  });

  it("★★ dân số cổng của các SKU KHÁC không đổi (lượt này chỉ nói về MOD_AI)", () => {
    const dem: Record<string, number> = {};
    for (const m of Object.keys(GHIM_MODULE_KHAC)) dem[m] = 0;
    for (const t of QUET.thuTuc) {
      if (t.module !== null && t.module !== "MOD_AI") dem[t.module] = (dem[t.module] ?? 0) + 1;
    }
    expect(dem, "Cổng của một SKU KHÁC vừa đổi — lượt này không được phép chạm vào chúng.").toEqual(
      GHIM_MODULE_KHAC,
    );
  });
});

describe("§4 — PHỦ SÓNG: thủ tục AI chưa khoá phải CÓ TÊN TRONG SỔ", () => {
  it("★★★ ∀ thủ tục trên bề mặt AI ⇒ có cổng MOD_AI, hoặc đã KÝ trong `MIEN_TRU_VAN_HANH`", () => {
    const so = new Set(MIEN_TRU_VAN_HANH);
    const moi = aiKhongCong
      .filter((t) => !so.has(khoaCong(t)))
      .map((t) => `${khoaCong(t)} (dòng ${t.dong}; ${t.loai}; sàn: ${t.san})`);
    expect(
      moi,
      "MỘT THỦ TỤC AI MỚI KHÔNG ĐỨNG SAU CỔNG GIẤY PHÉP.\n" +
        "Cách đúng (mẫu: `aiChatRouter.ts`):\n" +
        '  import { router, moduleProcedure } from "../_core/trpc";\n' +
        '  const protectedProcedure = moduleProcedure("MOD_AI");\n' +
        "và cho sàn `adminProcedure`/`roleProcedure`: `.use(moduleGate(\"MOD_AI\"))`.\n" +
        "NẾU nó thật sự là dữ liệu VẬN HÀNH mà khách không-AI vẫn cần: thêm tên vào\n" +
        "`MIEN_TRU_VAN_HANH` KÈM lý do đo được (nơi gọi ở client + tuyến + chủ tuyến).\n" +
        "⚠ Thêm một dòng im lặng vào sổ ký tên là đúng thứ sổ ấy tồn tại để ngăn.",
    ).toEqual([]);
  });
});

describe("§5 — SỔ KÝ TÊN KHÔNG ĐƯỢC HOÁ THẠCH", () => {
  it("★ mọi mục trong sổ vẫn là một thủ tục CÓ THẬT", () => {
    const co = new Set(QUET.thuTuc.map(khoaCong));
    expect(
      MIEN_TRU_VAN_HANH.filter((k) => !co.has(k)),
      "Sổ giữ mục không còn tồn tại (đổi tên / gỡ bỏ) — xoá dòng của nó đi.",
    ).toEqual([]);
  });

  it("★★ mọi mục trong sổ vẫn ĐANG không có cổng — nối cổng rồi thì phải GỠ DÒNG", () => {
    const congTheoKhoa = new Map(QUET.thuTuc.map((t) => [khoaCong(t), t.module]));
    const daCong = MIEN_TRU_VAN_HANH.filter((k) => congTheoKhoa.get(k) === "MOD_AI");
    expect(
      daCong,
      "Mục này đã được nối cổng nhưng còn tên trong sổ miễn trừ. Xoá dòng của nó và hạ\n" +
        "`GHIM.aiMienTru` / nâng `GHIM.aiCoCong` cho khớp — trả nợ phải NHÌN THẤY ĐƯỢC trong diff.",
    ).toEqual([]);
  });

  it("sổ GOM THEO FILE, mỗi file một khối liền mạch, trong khối đã sắp xếp, không lặp", () => {
    const fileCua = (k: string): string => k.split("#")[0] ?? "";
    const thuTuFile: string[] = [];
    for (const k of MIEN_TRU_VAN_HANH) {
      const f = fileCua(k);
      if (thuTuFile[thuTuFile.length - 1] !== f) thuTuFile.push(f);
    }
    expect(
      [...new Set(thuTuFile)].length,
      "một file xuất hiện ở HAI khối rời nhau — gom chúng lại.",
    ).toBe(thuTuFile.length);
    for (const f of thuTuFile) {
      const cua = MIEN_TRU_VAN_HANH.filter((k) => fileCua(k) === f);
      expect([...cua].sort(), `khối \`${f}\` chưa sắp xếp`).toEqual(cua);
    }
    expect(new Set(MIEN_TRU_VAN_HANH).size).toBe(MIEN_TRU_VAN_HANH.length);
  });
});

describe("§6 — BỐN CA CHUẨN: cổng đã thật sự đến được các hình dạng sàn khác nhau", () => {
  /**
   * Bốn hình dạng sàn khác nhau trong mã thật. Nếu bộ suy chỉ đọc được một hình dạng, §4 sẽ xanh
   * cho ba hình dạng kia **vì không thấy chúng**, chứ không vì chúng đã có cổng.
   */
  const CA_CHUAN: readonly [string, string][] = [
    // shadow `protectedProcedure = moduleProcedure("MOD_AI")`
    ["server/routers/aiChatRouter.ts#aiChatRouter.chat", "MOD_AI"],
    // `adminProcedure` (từ `./_shared`) + `.use(moduleGate(...))`
    ["server/routers/aiSettingsRouter.ts#aiSettingsRouter.createApiKey", "MOD_AI"],
    // `roleProcedure(...).use(require2FA).use(moduleGate(...))`
    ["server/routers/aiModelRouter.ts#aiModelRouter.createCard", "MOD_AI"],
    // `roleProcedure(...).use(moduleGate(...))` có từ trước lượt này
    ["server/routers/aiSpecialistAgentRouter.ts#aiSpecialistAgentRouter.run", "MOD_AI"],
  ];

  for (const [khoa, module] of CA_CHUAN) {
    it(`${khoa} — đứng sau ${module}`, () => {
      const t = QUET.thuTuc.find((x) => khoaCong(x) === khoa);
      expect(t, `không còn thấy thủ tục \`${khoa}\` — nó bị đổi tên/gỡ bỏ?`).toBeDefined();
      expect(t?.module, "hoàn nguyên cổng của thủ tục này ⇒ ô này phải ĐỎ").toBe(module);
    });
  }

  it("★ CHIỀU DƯƠNG — một thủ tục VẬN HÀNH ngoài AI vẫn KHÔNG có cổng nào", () => {
    // Chống "vá quá tay": một bộ suy trả `MOD_AI` cho mọi thứ cũng làm bốn ô trên xanh.
    const t = QUET.thuTuc.find((x) => khoaCong(x) === "server/routers/aiRouters.ts#predictiveAlertRouter.list");
    expect(t).toBeDefined();
    expect(t?.module, "sổ cảnh báo trung tâm KHÔNG được đứng sau giấy phép AI").toBeNull();
  });
});

describe("§7 — ĐỘT BIẾN THẬT: cổng có ĐỎ khi ai đó phá theo HAI chiều không", () => {
  /**
   * ⚠⚠ Không có phần này thì §3/§4 xanh **không chứng minh gì**: một vị từ luôn trả "không có mục
   * mới" cũng cho đúng màu ấy. Nên phần này **ghi thật router ra đĩa**, chạy lại **đúng** bộ suy
   * đang canh sản phẩm, rồi đòi nó bị bắt — theo cả hai chiều, cộng một ca ĐỐI CHỨNG.
   */
  const FILE_AI_MOI = join(GOC_REPO, "server", "routers", "aiDotBienRouter.ts");
  const FILE_NGOAI_AI = join(GOC_REPO, "server", "routers", "__dotBienNgoaiAiRouter.ts");

  const MA_AI_MOI = `import { z } from "zod";
import { protectedProcedure, moduleProcedure, router } from "../_core/trpc";

const daCong = moduleProcedure("MOD_AI");

export const aiDotBienRouter = router({
  // (a) thủ tục AI MỚI, KHÔNG cổng — §4 phải ĐỎ.
  khongCong: protectedProcedure.input(z.object({ q: z.string() })).query(async () => ({ ok: true })),
  // (c) ĐỐI CHỨNG: cùng file, CÓ cổng — phải KHÔNG bị bắt.
  coCong: daCong.query(async () => ({ ok: true })),
});
`;

  const MA_NGOAI_AI = `import { moduleProcedure, router } from "../_core/trpc";

const khoaNham = moduleProcedure("MOD_AI");

export const dotBienNgoaiAiRouter = router({
  // (b) thủ tục VẬN HÀNH bị khoá nhầm sau MOD_AI — §3 phải ĐỎ.
  danhSachMay: khoaNham.query(async () => []),
});
`;

  /**
   * ⚠⚠⚠ **BA lời khai trong MỘT ô, và đó là một quyết định có lý do — không phải lười.**
   * Hai file đột biến được ghi và xoá **trong cùng một cửa sổ**, và bộ suy chỉ chạy **một lần**.
   * Lý do: các cổng khác của repo duyệt `server/**` rồi `readFileSync` **từng file** — đo được ở
   * lượt này: `server/_core/neoTenXacThuc.test.ts` và `server/_core/xacThucNoiBo.test.ts` (cả hai
   * dùng `moiFileDuoi` + `readFileSync`). Khi vitest chạy song song, một file đột biến **biến mất
   * giữa lượt LIỆT KÊ và lượt ĐỌC** ⇒ chúng nổ `ENOENT` vì một lý do **chẳng liên quan gì tới
   * chúng**. Hai ô riêng ⇒ hai cửa sổ ~2,3 s; gộp lại ⇒ **một** cửa sổ.
   *
   * ⚠⚠ **Nguy cơ KHÔNG xoá được hẳn, và nó CÓ TRƯỚC lượt này**: `phamViDocCensus.test.ts` §7 và
   *    `phamViTuyenCensus.test.ts` §7 đã ghi file tạm vào `server/routers/` từ trước. Đo được ở
   *    lượt này (chạy `server/routers server/_core server/routes client/src`): **NỀN 38 file đỏ /
   *    141 ca — SAU 35 file đỏ / 136 ca**, và tập file đỏ lệch nhau theo **CẢ HAI** chiều (4 file
   *    chỉ đỏ ở nền, 1 file chỉ đỏ ở sau) — cả 5 đều **XANH khi chạy riêng**. Nếu bạn thấy một
   *    `ENOENT` trỏ vào `aiDotBienRouter.ts` / `__dotBienNgoaiAiRouter.ts` / `__dotBienPhamViDoc.ts`:
   *    đó là **đúng khuôn này**, không phải một lỗi của file đang đỏ. Chạy lại file ấy MỘT MÌNH.
   */
  it("★★★ (a) AI mới KHÔNG cổng ⇒ bị bắt · (b) NGOÀI AI bị khoá nhầm ⇒ bị bắt · (c) ĐỐI CHỨNG có cổng ⇒ KHÔNG bị bắt", () => {
    for (const f of [FILE_AI_MOI, FILE_NGOAI_AI]) {
      expect(existsSync(f), `file đột biến còn sót từ lượt trước — dọn đi trước khi chạy: ${f}`).toBe(false);
    }
    try {
      writeFileSync(FILE_AI_MOI, MA_AI_MOI, "utf8");
      writeFileSync(FILE_NGOAI_AI, MA_NGOAI_AI, "utf8");
      const lai = quetCongGiayPhep(GOC_REPO);
      const tim = (duoi: string, ten: string): ThuTucCong | undefined =>
        lai.thuTuc.find((t) => t.file.endsWith(duoi) && t.ten === ten);

      // (a) — thủ tục AI MỚI không cổng: đúng thứ §4 tồn tại để bắt.
      const khongCong = tim("aiDotBienRouter.ts", "khongCong");
      expect(khongCong, "bộ suy KHÔNG THẤY thủ tục mới — lượng từ đã thủng, mọi ô khác vô nghĩa").toBeDefined();
      expect(laBeMatAi((khongCong as ThuTucCong).file), "file `ai…Router.ts` phải TỰ vào bề mặt AI").toBe(true);
      expect((khongCong as ThuTucCong).module, "thủ tục AI không cổng ⇒ module phải là null").toBeNull();
      expect(MIEN_TRU_VAN_HANH).not.toContain(khoaCong(khongCong as ThuTucCong));

      // (c) — ĐỐI CHỨNG: cùng file, CÓ cổng ⇒ KHÔNG bị bắt. Chống "vá quá tay": một bộ suy trả
      //       `null` cho mọi thứ cũng thoả (a) nhưng sẽ hỏng ở đây.
      const coCong = tim("aiDotBienRouter.ts", "coCong");
      expect(coCong).toBeDefined();
      expect(coCong?.module, "CHỐNG VÁ QUÁ TAY: có cổng ⇒ KHÔNG bị §4 bắt").toBe("MOD_AI");

      // (b) — CHIỀU CHỐNG HỒI QUY: thủ tục vận hành bị khoá nhầm sau MOD_AI.
      const khoaNham = tim("__dotBienNgoaiAiRouter.ts", "danhSachMay");
      expect(khoaNham, "bộ suy KHÔNG THẤY thủ tục mới — lượng từ đã thủng").toBeDefined();
      expect(laBeMatAi((khoaNham as ThuTucCong).file), "file này KHÔNG được coi là bề mặt AI").toBe(false);
      expect((khoaNham as ThuTucCong).module, "cổng khoá nhầm phải ĐỌC RA ĐƯỢC là MOD_AI").toBe("MOD_AI");
      // Chính là phép so mà §3 chạy — nay nó KHÁC RỖNG.
      const roRi = lai.thuTuc.filter((x) => !laBeMatAi(x.file) && x.module === "MOD_AI");
      expect(roRi.map(khoaCong)).toContain(khoaCong(khoaNham as ThuTucCong));
    } finally {
      rmSync(FILE_AI_MOI, { force: true });
      rmSync(FILE_NGOAI_AI, { force: true });
    }
    for (const f of [FILE_AI_MOI, FILE_NGOAI_AI]) {
      expect(existsSync(f), "phép đột biến phải tự dọn — file đột biến không được ở lại cây").toBe(false);
    }
  }, 300_000);
});

describe("§8 — NỬA EXPRESS: `moduleGate` là middleware tRPC, không với tới `/api/ai/**`", () => {
  const EXPRESS = quetCongAiExpress(GOC_REPO);

  it("★ không có ô mù + có THẬT tuyến AI để canh (chống 'xanh vì canh 0 tuyến')", () => {
    expect(EXPRESS.mu).toEqual([]);
    const tuyenThat = EXPRESS.tuyen.filter((t) => t.duongTuyen.length > "/api/ai".length);
    expect(
      tuyenThat.length,
      "không thấy tuyến `/api/ai/**` nào — bộ suy đang canh một tập RỖNG (tự thoả).",
    ).toBeGreaterThanOrEqual(6);
  });

  it("★★★ middleware giấy phép được gắn, và gắn TRƯỚC mọi lượt đăng ký tuyến AI", () => {
    expect(
      EXPRESS.dongGanCong,
      "KHÔNG thấy `app.use(\"/api/ai\", chanTuyenAiTheoGiayPhep())` trong server/_core/index.ts.",
    ).toBeGreaterThan(0);
    expect(
      EXPRESS.dongDangKySomNhat,
      "không thấy lượt `registerAi*(app)` nào — bộ suy mất mốc so sánh.",
    ).toBeGreaterThan(0);
    expect(
      EXPRESS.dongGanCong,
      "Middleware giấy phép gắn SAU lượt đăng ký tuyến ⇒ Express khớp tuyến trước, cổng canh RỖNG.",
    ).toBeLessThan(EXPRESS.dongDangKySomNhat);
  });
});
