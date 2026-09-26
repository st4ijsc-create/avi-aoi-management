/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ G4-A VIỆC 1 — **BÁO CÁO ĐIỀU HÀNH LUÔN SINH TIẾNG ANH TRONG MỘT NHÀ MÁY VIỆT NAM.**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Ba lớp xếp chồng, mỗi lớp một mình đã đủ để ra tiếng Anh (đã xác minh trực tiếp):
 *   ① `AIReportsPage.tsx` gửi `{startDate, endDate}` cho **cả 4 tab**, KHÔNG có `language`;
 *      `aiReportRouter.ts` khai `.default("en")` ⇒ mọi lượt bấm nút đều là một lượt xin tiếng Anh.
 *   ② Kể cả khi truyền `vi`, **14 chuỗi vẫn hard-code tiếng Anh** trong `aiReportGenerator.ts`
 *      (anomalies · recommendations · actionItems · trends · concerns · forecast). Chỉ `narrative`
 *      đổi ngôn ngữ — tức phần **do model sinh** thì đúng ngôn ngữ, phần **do mã sinh** thì không.
 *   ③ `aiRcaCopilot.synthesize(input, lang, ev)` nhận `lang` mà **thân hàm không dùng nó một lần
 *      nào**; system prompt + user prompt 100% tiếng Anh ⇒ model trả lời tiếng Anh.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG ĐỔ CÂU VÀO `client/src/i18n/locales/*.json`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Máy chủ repo này **không có i18next**: `client/src/i18n/index.ts` là mã **trình duyệt**
 * (`i18next-browser-languagedetector`, `./locales/vi.json?url`). Đổ câu vào đó buộc phải đẻ một
 * **người đọc thứ hai ở máy chủ** (nạp 3 file JSON của client vào tiến trình server + dựng một
 * instance i18next nữa) cho những chuỗi **không bao giờ đi qua trình duyệt** — chúng được nhồi
 * thẳng vào prompt LLM và vào JSON trả về của tRPC.
 *
 * ⇒ File này dùng **đúng cơ chế dịch đang có ở máy chủ** — hàm `w(lang, vi, en, zh)`, hiện có
 * **tám bản sao** trong `aiLocalTools/**` — và **lập bảng hoá** nó y hệt tiền lệ đã được duyệt
 * `aiLocalTools/vramPhrases.ts` (Pha 5 N10). Lợi ích so với `i18n.exists()`: thiếu một ngôn ngữ
 * thì **`tsc` không biên dịch được**, chứ không phải "chạy rồi mới biết".
 * ⚠ Và file này **KHÔNG** là bản sao thứ chín của `w()`: nó là **một bảng**, tra bằng khoá; mỗi
 * câu tồn tại **đúng một lần** cho cả ba ngôn ngữ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LUẬT PHÂN CÔNG (mượn nguyên từ `vramPhrases.ts`): **VĂN XUÔI ⇒ KHOÁ · DỮ LIỆU ⇒ THAM SỐ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mã máy (`AOI-01`), tên loại lỗi (`Solder Bridge`), con số đã định dạng (`12.0`) là **dữ liệu** —
 * chúng giống nhau ở mọi ngôn ngữ, được ghép ở nơi gọi rồi truyền vào làm tham số. Mọi thứ **có
 * nghĩa cho người đọc** là một khoá ở bảng dưới. Nhờ luật này, cổng vét cạn
 * (`aiReportPhrases.exhaustive.test.ts`) áp được cho **TOÀN BẢNG, không một miễn trừ nào** —
 * miễn trừ là chỗ phần tử thứ N+1 chui vào.
 *
 * ⚠⚠ **THÂN MỖI Ô NGÔN NGỮ PHẢI LÀ MỘT BIỂU THỨC CHUỖI, KHÔNG RẼ NHÁNH THEO GIÁ TRỊ THAM SỐ.**
 * Bài học I-3 của `vramPhrases.ts`: một `p.x ? "<tiếng Việt>" : "<tiếng Anh>"` nằm trong ô `en`
 * làm cổng vét cạn xanh 100% (nó chỉ render mỗi khuôn **một lần**, quan sát được **một** nhánh)
 * trong khi nhánh kia tới được thật. Mọi rẽ nhánh phải nằm ở nơi GỌI và chọn giữa **HAI KHOÁ**.
 */

import type { ToolLang } from "./aiLocalTools/toolRegistry";

/** Ngôn ngữ hiển thị của báo cáo. Trùng `ToolLang` — **cùng ba mã**, không đẻ enum thứ hai. */
export type ReportLang = ToolLang;

export const NGON_NGU_BAO_CAO: readonly ReportLang[] = ["vi", "en", "zh"] as const;

/** Giá trị nhét vào khuôn câu: **dữ liệu đã định dạng**, không bao giờ là văn xuôi chưa dịch. */
export type Tham = Record<string, string | number>;

/** Khuôn không tham số. */
export type KhongTham = Record<string, never>;

/**
 * Một **cụm** = ba khuôn, một cho mỗi ngôn ngữ. Ba ô **bắt buộc theo KIỂU** ⇒ quên một ngôn ngữ
 * thì `tsc` đỏ ngay, không cần chờ một ca chạy.
 */
export interface Cum<P extends Tham> {
  vi: (p: P) => string;
  en: (p: P) => string;
  zh: (p: P) => string;
}

const cum = <P extends Tham>(c: Cum<P>): Cum<P> => c;

// ════════════════════════════════════════════════════════════════════════════════════════════
// BẢNG CÂU
// ════════════════════════════════════════════════════════════════════════════════════════════

export const CAU_BAO_CAO = {
  // ─── ① Daily Quality Summary — anomalies + recommendations ─────────────────────────────
  tyLeLoiCao: cum<{ rate: string }>({
    vi: (p) => `Tỷ lệ lỗi cao: ${p.rate}%`,
    en: (p) => `High defect rate: ${p.rate}%`,
    zh: (p) => `不良率偏高：${p.rate}%`,
  }),
  loiApDao: cum<{ type: string; pct: string }>({
    vi: (p) => `Loại lỗi "${p.type}" chiếm áp đảo ${p.pct}% tổng số lỗi`,
    en: (p) => `Dominant defect type "${p.type}" accounts for ${p.pct}% of all defects`,
    zh: (p) => `主导不良类型“${p.type}”占全部不良的 ${p.pct}%`,
  }),
  khuyenNghiSoatTieuChi: cum<KhongTham>({
    vi: () => "Rà soát lại tiêu chí kiểm tra và hiệu chuẩn máy",
    en: () => "Review inspection criteria and machine calibration",
    zh: () => "复核检测判定标准并校准设备",
  }),
  khuyenNghiTapTrungLoi: cum<{ type: string }>({
    vi: (p) => `Tập trung cải tiến loại lỗi "${p.type}"`,
    en: (p) => `Focus improvement on "${p.type}" defect type`,
    zh: (p) => `优先改善不良类型“${p.type}”`,
  }),
  khuyenNghiTheoDoiTiep: cum<KhongTham>({
    vi: () => "Tiếp tục theo dõi và so sánh với các kỳ trước",
    en: () => "Continue monitoring and compare with previous periods",
    zh: () => "持续监控并与既往周期对比",
  }),

  // ─── ② RCA report — trigger, timeline, evidence, action items ──────────────────────────
  rcaKichHoatMacDinh: cum<KhongTham>({
    vi: () => "Phát hiện tỷ lệ lỗi tăng đột biến",
    en: () => "Defect rate spike detected",
    zh: () => "检测到不良率突增",
  }),
  moc_batDauDieuTra: cum<KhongTham>({
    vi: () => "Bắt đầu kỳ điều tra",
    en: () => "Investigation period start",
    zh: () => "调查周期开始",
  }),
  moc_canhBaoKichHoat: cum<KhongTham>({
    vi: () => "Cảnh báo được kích hoạt",
    en: () => "Alert triggered",
    zh: () => "告警已触发",
  }),
  moc_ketThucDieuTra: cum<KhongTham>({
    vi: () => "Kết thúc kỳ điều tra",
    en: () => "Investigation period end",
    zh: () => "调查周期结束",
  }),
  bangChungSoLan: cum<{ count: number; total: number }>({
    vi: (p) => `${p.count} lần xuất hiện trên tổng số ${p.total} lỗi`,
    en: (p) => `${p.count} occurrences out of ${p.total} total defects`,
    zh: (p) => `在全部 ${p.total} 个不良中出现 ${p.count} 次`,
  }),
  hanhDongTruyNguyenNhan: cum<{ type: string }>({
    vi: (p) => `Truy nguyên nhân gốc của loại lỗi "${p.type}"`,
    en: (p) => `Investigate root cause of "${p.type}" defect type`,
    zh: (p) => `追查不良类型“${p.type}”的根本原因`,
  }),
  hanhDongKiemTraMay: cum<{ code: string }>({
    vi: (p) => `Kiểm tra máy "${p.code}" — tỷ lệ lỗi cao nhất`,
    en: (p) => `Check machine "${p.code}" — highest defect rate`,
    zh: (p) => `检查设备“${p.code}”——不良率最高`,
  }),
  hanhDongSoatThamSo: cum<KhongTham>({
    vi: () => "Rà soát thông số công đoạn trong khoảng thời gian bất thường",
    en: () => "Review process parameters for anomalous period",
    zh: () => "复核异常时段的工艺参数",
  }),
  hanhDongLenBaoTri: cum<KhongTham>({
    vi: () => "Lên lịch bảo trì phòng ngừa nếu nghi máy đang xuống cấp",
    en: () => "Schedule preventive maintenance if machine degradation suspected",
    zh: () => "若怀疑设备劣化，应安排预防性维护",
  }),

  // ─── ③ Model performance — retrain recommendations ─────────────────────────────────────
  retrainDichChuyen: cum<{ code: string }>({
    vi: (p) => `Mô hình "${p.code}" có dịch chuyển độ chính xác — nên huấn luyện lại`,
    en: (p) => `Model "${p.code}" shows accuracy drift — recommend retraining`,
    zh: (p) => `模型“${p.code}”出现精度漂移——建议重新训练`,
  }),
  retrainSuyGiam: cum<{ code: string }>({
    vi: (p) => `Độ chính xác của mô hình "${p.code}" đang giảm — xem lại phân bố dữ liệu đầu vào`,
    en: (p) => `Model "${p.code}" accuracy is declining — investigate data distribution changes`,
    zh: (p) => `模型“${p.code}”精度持续下降——请排查输入数据分布变化`,
  }),
  retrainDuoiNguong: cum<{ code: string }>({
    vi: (p) => `Độ chính xác mô hình "${p.code}" dưới 90% — cân nhắc đổi kiến trúc mô hình`,
    en: (p) => `Model "${p.code}" accuracy below 90% — consider model architecture update`,
    zh: (p) => `模型“${p.code}”精度低于 90%——可考虑调整模型结构`,
  }),
  retrainLoiSuyLuan: cum<{ code: string; pct: string; n: number }>({
    vi: (p) =>
      `Mô hình "${p.code}" có tỷ lệ lỗi suy luận ${p.pct}% trên ${p.n} lượt — kiểm tra sức khoẻ đường ống/mô hình`,
    en: (p) =>
      `Model "${p.code}" inference error rate ${p.pct}% over ${p.n} predictions — investigate pipeline/model health`,
    zh: (p) => `模型“${p.code}”在 ${p.n} 次推理中错误率达 ${p.pct}%——请排查推理链路与模型健康度`,
  }),
  soLieuModelChuaCo: cum<KhongTham>({
    vi: () =>
      "Số liệu hiệu suất model chưa khả dụng cho kỳ báo cáo này — chưa có hoạt động suy luận thực nào được ghi nhận",
    en: () => "Model performance metrics unavailable for this period — no real inference activity recorded yet",
    zh: () => "本报告周期暂无模型性能数据——尚未记录到真实推理活动",
  }),
  moiModelTrongNguong: cum<KhongTham>({
    vi: () => "Tất cả mô hình nằm trong ngưỡng cho phép — chưa cần hành động ngay",
    en: () => "All models performing within acceptable ranges — no immediate action needed",
    zh: () => "所有模型均在可接受范围内——暂无需立即处理",
  }),

  // ─── ④ Executive summary — trends / concerns / forecast ────────────────────────────────
  xuHuongYieldTang: cum<{ pts: string }>({
    vi: (p) => `Tỷ lệ đạt tăng ${p.pts} điểm phần trăm`,
    en: (p) => `Yield improved by ${p.pts} percentage points`,
    zh: (p) => `良率提升 ${p.pts} 个百分点`,
  }),
  xuHuongYieldGiam: cum<{ pts: string }>({
    vi: (p) => `Tỷ lệ đạt giảm ${p.pts} điểm phần trăm`,
    en: (p) => `Yield decreased by ${p.pts} percentage points`,
    zh: (p) => `良率下降 ${p.pts} 个百分点`,
  }),
  xuHuongSanLuongTang: cum<KhongTham>({
    vi: () => "Sản lượng tăng đáng kể",
    en: () => "Production volume increased significantly",
    zh: () => "产量显著上升",
  }),
  xuHuongSanLuongGiam: cum<KhongTham>({
    vi: () => "Sản lượng giảm",
    en: () => "Production volume decreased",
    zh: () => "产量下降",
  }),
  quanNgaiTyLeLoi: cum<{ rate: string }>({
    vi: (p) => `Tỷ lệ lỗi ở mức ${p.rate}% — vượt mục tiêu`,
    en: (p) => `Defect rate at ${p.rate}% — above target`,
    zh: (p) => `不良率为 ${p.rate}%——高于目标值`,
  }),
  quanNgaiYieldSut: cum<KhongTham>({
    vi: () => "Tỷ lệ đạt sụt đáng kể so với kỳ trước",
    en: () => "Significant yield decline vs previous period",
    zh: () => "与上期相比良率明显下滑",
  }),
  duBaoTichCuc: cum<KhongTham>({
    vi: () => "Xu hướng tích cực — tỷ lệ đạt dự kiến tiếp tục cải thiện nếu giữ cách làm hiện tại",
    en: () => "Positive trend — yield expected to continue improving with current practices",
    zh: () => "趋势向好——维持现行做法，良率预计将继续改善",
  }),
  duBaoSutGiam: cum<KhongTham>({
    vi: () => "Xu hướng đi xuống — cần hành động khắc phục để chặn đà xấu đi",
    en: () => "Declining trend — corrective actions recommended to prevent further degradation",
    zh: () => "趋势走弱——建议采取纠正措施以防进一步恶化",
  }),

  // ─── ⑤ Câu dẫn hệ thống của phần tường thuật (narrative) ───────────────────────────────
  // ⚠ Bốn khoá này ĐI VÀO PROMPT của model. Mỗi bản phải **tự nói ngôn ngữ của nó** — dịch
  //   nguyên văn rồi kèm một câu "trả lời bằng tiếng X" là hai câu nói cùng một điều; ở đây bản
  //   thân câu dẫn đã viết bằng đúng ngôn ngữ đích, và câu chốt nêu đích danh ngôn ngữ trả lời
  //   (model đa ngữ trôi ngôn ngữ khi dữ liệu đầu vào toàn tiếng Anh — dữ liệu là JSON có khoá
  //   tiếng Anh, nên câu chốt là cần thiết chứ không thừa).
  dan_tomTatNgay: cum<KhongTham>({
    vi: () => "Bạn là chuyên gia chất lượng AOI. Viết tóm tắt báo cáo chất lượng hàng ngày. Trả lời hoàn toàn bằng tiếng Việt.",
    en: () => "You are an AOI quality expert. Write a brief daily quality summary report. Answer entirely in English.",
    zh: () => "你是 AOI 质量专家。请撰写一份简明的每日质量汇总报告。请全部用中文作答。",
  }),
  dan_rca: cum<KhongTham>({
    vi: () => "Bạn là chuyên gia phân tích nguyên nhân gốc AOI. Viết báo cáo RCA chi tiết. Trả lời hoàn toàn bằng tiếng Việt.",
    en: () => "You are an AOI root cause analysis expert. Write a concise RCA report. Answer entirely in English.",
    zh: () => "你是 AOI 根本原因分析专家。请撰写一份简明的根因分析报告。请全部用中文作答。",
  }),
  dan_hieuSuatModel: cum<KhongTham>({
    vi: () => "Bạn là chuyên gia AI/ML. Viết báo cáo hiệu suất mô hình. Trả lời hoàn toàn bằng tiếng Việt.",
    en: () => "You are an AI/ML expert. Write a brief model performance summary report. Answer entirely in English.",
    zh: () => "你是 AI/ML 专家。请撰写一份简明的模型性能报告。请全部用中文作答。",
  }),
  dan_dieuHanh: cum<KhongTham>({
    vi: () => "Bạn là giám đốc chất lượng. Viết tóm tắt điều hành cho ban lãnh đạo. Trả lời hoàn toàn bằng tiếng Việt.",
    en: () => "You are a quality director. Write a concise executive summary for management. Answer entirely in English.",
    zh: () => "你是质量总监。请为管理层撰写一份简明的高管摘要。请全部用中文作答。",
  }),

  // ─── ⑥ Bản mẫu NGOẠI TUYẾN khi không có model nào trả lời ──────────────────────────────
  offline_khongXacDinh: cum<KhongTham>({
    vi: () => "không xác định",
    en: () => "unknown",
    zh: () => "未知",
  }),
  offline_ngay: cum<{ period: string; total: string; yieldRate: string; ng: string }>({
    vi: (p) =>
      `Trong kỳ báo cáo ${p.period}, hệ thống đã kiểm tra ${p.total} sản phẩm với tỷ lệ đạt ${p.yieldRate}% và ${p.ng} sản phẩm lỗi. `,
    en: (p) =>
      `During period ${p.period}, ${p.total} inspections were completed with a ${p.yieldRate}% yield rate and ${p.ng} defective items. `,
    zh: (p) => `在报告周期 ${p.period} 内，共检测 ${p.total} 件产品，良率 ${p.yieldRate}%，不良 ${p.ng} 件。`,
  }),
  offline_ngayLoiPhoBien: cum<{ type: string }>({
    vi: (p) => `Loại lỗi phổ biến nhất là "${p.type}". `,
    en: (p) => `The most common defect type was "${p.type}". `,
    zh: (p) => `最常见的不良类型为“${p.type}”。`,
  }),
  offline_ngayBatThuong: cum<{ list: string }>({
    vi: (p) => `Phát hiện bất thường: ${p.list}. `,
    en: (p) => `Anomalies detected: ${p.list}. `,
    zh: (p) => `发现异常：${p.list}。`,
  }),
  offline_ngayKhep: cum<KhongTham>({
    vi: () => "Cần theo dõi và so sánh với kỳ trước để xác định xu hướng.",
    en: () => "Continue monitoring and compare with previous periods to identify trends.",
    zh: () => "建议持续监控并与既往周期对比以判定趋势。",
  }),
  offline_rca: cum<{ trigger: string }>({
    vi: (p) => `Cuộc điều tra nguyên nhân gốc được kích hoạt bởi: ${p.trigger}. `,
    en: (p) => `Root cause investigation triggered by: ${p.trigger}. `,
    zh: (p) => `根本原因调查由以下事件触发：${p.trigger}。`,
  }),
  offline_rcaYeuTo: cum<{ factor: string; impact: string }>({
    vi: (p) => `Yếu tố đóng góp chính là "${p.factor}" (${p.impact}% tác động). `,
    en: (p) => `The primary contributing factor was "${p.factor}" (${p.impact}% impact). `,
    zh: (p) => `主要贡献因子为“${p.factor}”（影响度 ${p.impact}%）。`,
  }),
  offline_rcaHanhDong: cum<{ list: string }>({
    vi: (p) => `Hành động đề xuất: ${p.list}.`,
    en: (p) => `Recommended actions: ${p.list}.`,
    zh: (p) => `建议采取的措施：${p.list}。`,
  }),
  offline_model: cum<{ n: number }>({
    vi: (p) => `Báo cáo hiệu suất gồm ${p.n} mô hình AI. `,
    en: (p) => `Performance report covers ${p.n} AI models. `,
    zh: (p) => `本性能报告涵盖 ${p.n} 个 AI 模型。`,
  }),
  offline_modelDichChuyen: cum<{ n: number }>({
    vi: (p) => `${p.n} mô hình phát hiện dịch chuyển độ chính xác. `,
    en: (p) => `${p.n} model(s) show accuracy drift. `,
    zh: (p) => `有 ${p.n} 个模型出现精度漂移。`,
  }),
  offline_modelKhuyenNghi: cum<{ first: string }>({
    vi: (p) => `Khuyến nghị: ${p.first}.`,
    en: (p) => `Recommendation: ${p.first}.`,
    zh: (p) => `建议：${p.first}。`,
  }),
  offline_dieuHanh: cum<{ period: string; yieldVal: string; change: string }>({
    vi: (p) => `Tóm tắt điều hành kỳ ${p.period}: tỷ lệ đạt ${p.yieldVal}% (${p.change} điểm so với kỳ trước). `,
    en: (p) => `Executive summary for period ${p.period}: overall yield ${p.yieldVal}% (${p.change}pp vs previous period). `,
    zh: (p) => `${p.period} 高管摘要：整体良率 ${p.yieldVal}%（较上期 ${p.change} 个百分点）。`,
  }),
  offline_dieuHanhXuHuong: cum<{ first: string }>({
    vi: (p) => `Xu hướng: ${p.first}. `,
    en: (p) => `Key trend: ${p.first}. `,
    zh: (p) => `主要趋势：${p.first}。`,
  }),
  offline_dieuHanhQuanNgai: cum<{ first: string }>({
    vi: (p) => `Vấn đề cần chú ý: ${p.first}.`,
    en: (p) => `Concern: ${p.first}.`,
    zh: (p) => `需关注的问题：${p.first}。`,
  }),
  offline_dieuHanhKhongVanDe: cum<KhongTham>({
    vi: () => "Không có vấn đề nghiêm trọng trong kỳ này.",
    en: () => "No critical issues identified in this period.",
    zh: () => "本周期未发现严重问题。",
  }),
  offline_chung: cum<KhongTham>({
    vi: () => "Báo cáo được tạo tự động từ dữ liệu cục bộ (chế độ ngoại tuyến).",
    en: () => "Report generated automatically from local data (offline mode).",
    zh: () => "本报告由本地数据自动生成（离线模式）。",
  }),

  // ─── ⑦ RCA Copilot (`aiRcaCopilot.ts`) — lớp ③ của lỗi ─────────────────────────────────
  rcaCopilot_heThong: cum<KhongTham>({
    vi: () =>
      "Bạn là chuyên gia phân tích nguyên nhân gốc trong sản xuất SMT/AOI. CHỈ dùng bằng chứng được cung cấp để " +
      "đưa ra các giả thuyết nguyên nhân, xếp theo độ tin cậy. TUYỆT ĐỐI không bịa bằng chứng. Bằng chứng yếu thì " +
      "trả về ít giả thuyết hơn với độ tin cậy thấp hơn. Chỉ xuất đúng JSON theo schema. " +
      "recommendedFix.kind phải là WRITE (khớp một write-tool đã biết), MANUAL (các bước làm tay), hoặc " +
      "INVESTIGATE (cần thêm dữ liệu). Với WRITE, chỉ đặt tool + args khi bạn thực sự chắc chắn. " +
      "Viết MỌI trường văn xuôi (cause, evidence, rationale, steps) bằng tiếng Việt.",
    en: () =>
      "You are an SMT/AOI manufacturing root-cause analyst. Using ONLY the supplied evidence, produce ranked " +
      "hypotheses for the defect. NEVER invent evidence. If evidence is weak, return fewer hypotheses with lower " +
      "confidence. Output strictly the JSON schema. recommendedFix.kind must be WRITE (maps to a known write-tool), " +
      "MANUAL (hands-on steps), or INVESTIGATE (more data needed). For WRITE, set tool + args only if you are " +
      "confident. Write EVERY prose field (cause, evidence, rationale, steps) in English.",
    zh: () =>
      "你是 SMT/AOI 制造领域的根本原因分析专家。请仅依据所提供的证据，给出按置信度排序的原因假设。" +
      "严禁编造证据。证据不足时，请给出更少且置信度更低的假设。请严格按 JSON schema 输出。" +
      "recommendedFix.kind 必须是 WRITE（对应已知的写入工具）、MANUAL（人工操作步骤）或 INVESTIGATE（需补充数据）。" +
      "对于 WRITE，只有在确有把握时才填写 tool 与 args。所有叙述性字段（cause、evidence、rationale、steps）请用中文书写。",
  }),
  rcaCopilot_nhan: cum<{ defectType: string; machine: string; evidence: string; max: number; tools: string }>({
    vi: (p) =>
      `Loại lỗi: ${p.defectType}\nMáy: ${p.machine}\n\nBẰNG CHỨNG:\n${p.evidence}\n\n` +
      `Các write-tool bạn có thể tham chiếu cho một fix dạng WRITE: ${p.tools}.\n` +
      `Trả về tối đa ${p.max} giả thuyết, xếp theo độ tin cậy (0..1, giảm dần).`,
    en: (p) =>
      `Defect type: ${p.defectType}\nMachine: ${p.machine}\n\nEVIDENCE:\n${p.evidence}\n\n` +
      `Known write-tools you may reference for a WRITE fix: ${p.tools}.\n` +
      `Return up to ${p.max} hypotheses ranked by confidence (0..1, descending).`,
    zh: (p) =>
      `不良类型：${p.defectType}\n设备：${p.machine}\n\n证据：\n${p.evidence}\n\n` +
      `可用于 WRITE 修复方案的已知写入工具：${p.tools}。\n` +
      `请返回最多 ${p.max} 条假设，按置信度（0..1）降序排列。`,
  }),
  rcaCopilot_khongNeu: cum<KhongTham>({
    vi: () => "(không nêu)",
    en: () => "(unspecified)",
    zh: () => "（未指定）",
  }),
  rcaCopilot_khongCoBangChung: cum<KhongTham>({
    vi: () => "(không có bằng chứng định lượng nào)",
    en: () => "(no quantitative evidence available)",
    zh: () => "（无可用的定量证据）",
  }),
  rcaCopilot_khongCoLyLe: cum<KhongTham>({
    vi: () => "Không có lý lẽ kèm theo.",
    en: () => "No rationale provided.",
    zh: () => "未提供理由说明。",
  }),
} as const;

export type KhoaCauBaoCao = keyof typeof CAU_BAO_CAO;

export const KHOA_CAU_BAO_CAO = Object.keys(CAU_BAO_CAO) as KhoaCauBaoCao[];

type ThamCua<K extends KhoaCauBaoCao> = (typeof CAU_BAO_CAO)[K] extends Cum<infer P> ? P : never;

/**
 * Tra một câu theo khoá + ngôn ngữ.
 *
 * ⚠ **KHÔNG có nhánh dự phòng "thiếu thì lấy tiếng Anh"**, và đó là chủ ý: một fallback im lặng
 * chính là cơ chế đã tạo ra lỗ này (báo cáo "hỗ trợ tiếng Việt" mà chạy ra tiếng Anh, không ai
 * thấy). Thiếu một ô ⇒ `tsc` đỏ ở chỗ khai bảng, trước khi có gì để fallback.
 */
export function cauBaoCao<K extends KhoaCauBaoCao>(lang: ReportLang, khoa: K, tham: ThamCua<K>): string {
  return (CAU_BAO_CAO[khoa] as Cum<Tham>)[lang](tham as Tham);
}
