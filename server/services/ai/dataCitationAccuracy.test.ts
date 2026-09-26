/**
 * ★★★ PHÉP ĐO ĐỘ CHÍNH XÁC của bộ đối chiếu số — **CÓ MẪU SỐ, CÔNG KHAI**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * ⚠ PHẠM VI CỦA CON SỐ NÀY — ĐỌC TRƯỚC KHI TRÍCH DẪN NÓ ĐI ĐÂU
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Đây là phép đo trên **CORPUS DỰNG TAY** dưới đây, **KHÔNG PHẢI** lưu lượng sản xuất.
 * Nó trả lời đúng một câu: *"trên bốn dạng câu trả lời đã biết trước đáp án, bộ đối
 * chiếu phân loại đúng bao nhiêu?"*. Nó **KHÔNG** cho phép khẳng định điều gì về tỷ lệ
 * bịa số của model trong thực tế — muốn thế phải lấy mẫu lượt hỏi thật, và chưa ai làm.
 * Khai nhầm hai thứ đó cho nhau chính là *"thước xanh giả có hình dạng đúng bằng kết
 * luận thật"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO ĐO CẢ HAI CHIỀU
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Bắt được số bịa (độ NHẠY) là vô nghĩa nếu đồng thời gắn cờ đầy số hợp lệ (BÁO ĐỘNG
 * GIẢ). Nhóm C dưới đây là các con số **DẪN XUẤT hợp pháp** (tổng, hiệu, phần trăm) —
 * chúng KHÔNG có trong `data` nên bộ đối chiếu **phải** kêu, và đó chính là lý do
 * `numberCheck` **CHỈ ĐƯỢC ĐÁNH DẤU, KHÔNG ĐƯỢC CHẶN** câu trả lời ở lượt này.
 * Tỷ lệ báo động giả đo được ở nhóm C là bằng chứng ĐỊNH LƯỢNG cho quyết định ấy.
 */
import { describe, it, expect } from "vitest";
import { reconcileAnswerNumbers, type ToolResultLike } from "./dataCitation";

interface Ca {
  ten: string;
  nhom: "A_chep" | "B_dienGiai" | "C_danXuat" | "D_bia";
  answer: string;
  result: ToolResultLike;
  /** Những số PHẢI bị gắn cờ (nhóm D), hoặc [] khi không có số bịa nào. */
  biaThatSu: number[];
}

const KQ_TOP_DEFECT: ToolResultLike = {
  type: "top_defects",
  data: { rows: [{ code: "solder_bridge", count: 128 }, { code: "missing_component", count: 64 }, { code: "tombstone", count: 32 }] },
  textSummary: "Top lỗi: solder_bridge 128, missing_component 64, tombstone 32.",
};
const KQ_OEE: ToolResultLike = {
  type: "oee",
  data: { availability: 91.2, performance: 87.5, quality: 99.1, oee: 79.1 },
  textSummary: "OEE 79.1% (A 91.2% · P 87.5% · Q 99.1%).",
};
const KQ_HOM_NAY: ToolResultLike = {
  type: "today_stats",
  data: { total: 1284, ng: 37, machines: [{ code: "M-01", ng: 21 }, { code: "M-02", ng: 16 }] },
  textSummary: "Hôm nay: 1284 sản phẩm, 37 NG. M-01: 21 NG, M-02: 16 NG.",
};

const CORPUS: Ca[] = [
  // ── Nhóm A: câu trả lời LÀ `textSummary` (đường provider="tool", rất phổ biến) ──
  { ten: "A1 top-defect nguyên văn", nhom: "A_chep", answer: KQ_TOP_DEFECT.textSummary!, result: KQ_TOP_DEFECT, biaThatSu: [] },
  { ten: "A2 oee nguyên văn", nhom: "A_chep", answer: KQ_OEE.textSummary!, result: KQ_OEE, biaThatSu: [] },
  { ten: "A3 hôm nay nguyên văn", nhom: "A_chep", answer: KQ_HOM_NAY.textSummary!, result: KQ_HOM_NAY, biaThatSu: [] },

  // ── Nhóm B: LLM diễn giải, DÙNG LẠI đúng các con số ──
  {
    ten: "B1 diễn giải top-defect",
    nhom: "B_dienGiai",
    answer: "Lỗi cầu chì hàn (solder_bridge) dẫn đầu với 128 lượt, tiếp theo là missing_component 64 lượt và tombstone 32 lượt.",
    result: KQ_TOP_DEFECT,
    biaThatSu: [],
  },
  {
    ten: "B2 diễn giải oee",
    nhom: "B_dienGiai",
    answer: "OEE hiện ở mức 79.1%. Khả dụng đạt 91.2%, hiệu suất 87.5%, chất lượng 99.1%.",
    result: KQ_OEE,
    biaThatSu: [],
  },
  {
    ten: "B3 diễn giải hôm nay + làm tròn",
    nhom: "B_dienGiai",
    answer: "Hôm nay sản xuất 1.284 sản phẩm với 37 NG; M-01 chiếm 21 NG còn M-02 là 16 NG.",
    result: KQ_HOM_NAY,
    biaThatSu: [],
  },

  // ── Nhóm C: số DẪN XUẤT hợp pháp (KHÔNG có trong data ⇒ báo động giả có chủ đích) ──
  {
    ten: "C1 tổng của ba loại lỗi (128+64+32=224)",
    nhom: "C_danXuat",
    answer: "Tổng cộng 224 lượt NG trên ba loại lỗi hàng đầu.",
    result: KQ_TOP_DEFECT,
    biaThatSu: [],
  },
  {
    ten: "C2 tỷ lệ NG suy ra (37/1284 = 2.88%)",
    nhom: "C_danXuat",
    answer: "Tỷ lệ NG hôm nay là 2.88%.",
    result: KQ_HOM_NAY,
    biaThatSu: [],
  },
  {
    ten: "C3 hiệu giữa hai máy (21-16=5)",
    nhom: "C_danXuat",
    answer: "M-01 nhiều hơn M-02 đúng 5 lượt NG.",
    result: KQ_HOM_NAY,
    biaThatSu: [],
  },

  // ── Nhóm D: số BỊA (không chép, không dẫn xuất được) ──
  {
    ten: "D1 bịa một loại lỗi và số lượng",
    nhom: "D_bia",
    answer: "Ngoài ra còn 512 lượt lỗi cong vênh và 77 lượt lệch chân.",
    result: KQ_TOP_DEFECT,
    biaThatSu: [512, 77],
  },
  {
    ten: "D2 bịa chỉ số OEE của tuần trước",
    nhom: "D_bia",
    answer: "Tuần trước OEE là 68.4%, tuần này đã cải thiện.",
    result: KQ_OEE,
    biaThatSu: [68.4],
  },
  {
    ten: "D3 bịa sản lượng máy thứ ba",
    nhom: "D_bia",
    answer: "Máy M-03 ghi nhận 249 NG trong ca hôm nay.",
    result: KQ_HOM_NAY,
    biaThatSu: [249],
  },
];

describe("★ ĐỘ CHÍNH XÁC ĐO ĐƯỢC của bộ đối chiếu số (corpus dựng tay)", () => {
  it("báo cáo bảng đo + ghim ngưỡng để không trôi âm thầm", () => {
    let tongToken = 0;
    let tongCoNguon = 0;
    const theoNhom: Record<string, { token: number; coNguon: number; ganCo: number }> = {};
    let biaBatDuoc = 0;
    let biaTongCong = 0;
    let baoDongGiaC = 0;
    let tokenC = 0;

    for (const ca of CORPUS) {
      const r = reconcileAnswerNumbers(ca.answer, ca.result);
      tongToken += r.checked;
      tongCoNguon += r.supported;
      const g = (theoNhom[ca.nhom] ??= { token: 0, coNguon: 0, ganCo: 0 });
      g.token += r.checked;
      g.coNguon += r.supported;
      g.ganCo += r.unsupported.length;

      if (ca.nhom === "D_bia") {
        biaTongCong += ca.biaThatSu.length;
        for (const x of ca.biaThatSu) if (r.unsupported.includes(x)) biaBatDuoc++;
      }
      if (ca.nhom === "C_danXuat") {
        tokenC += r.checked;
        baoDongGiaC += r.unsupported.length;
      }
    }

    const bang = Object.entries(theoNhom)
      .map(([k, v]) => `${k}: ${v.coNguon}/${v.token} có nguồn, ${v.ganCo} bị gắn cờ`)
      .join(" | ");
    console.log(
      `[dataCitation] MẪU SỐ = ${tongToken} token số trên ${CORPUS.length} ca dựng tay.\n` +
        `  ${bang}\n` +
        `  độ nhạy với số BỊA = ${biaBatDuoc}/${biaTongCong}\n` +
        `  báo động giả trên số DẪN XUẤT hợp lệ = ${baoDongGiaC}/${tokenC}`,
    );

    // ── Ghim ──
    // MẪU SỐ ghim CHÍNH XÁC, không phải "≥ một ngưỡng": con số này là thứ được báo
    // cáo ra ngoài, nên mọi thay đổi của nó — thêm ca, đổi cách tách token — phải
    // buộc người sửa đọc lại và khai lại, chứ không được trôi âm thầm.
    // ⚠ 29 (không phải 33): lượt đo đầu đếm nhầm cả chữ số trong MÃ MÁY (`M-01`,
    //   `M-02`) là "trị đo", và chính chỗ đó phơi ra lỗi bất đối xứng tokenizer
    //   (nguồn đọc `-1`, câu trả lời đọc `1`) — xem `trichSo` trong dataCitation.ts.
    expect(tongToken, "mẫu số đổi ⇒ cập nhật con số được báo cáo ra ngoài").toBe(29);
    // Nhóm A+B (chép/diễn giải): phải nhận ra HẾT, không được kêu oan một số nào.
    expect(theoNhom.A_chep.ganCo).toBe(0);
    expect(theoNhom.B_dienGiai.ganCo).toBe(0);
    // Nhóm D: bắt được TOÀN BỘ số bịa.
    expect(biaBatDuoc).toBe(biaTongCong);
    expect(biaTongCong).toBeGreaterThanOrEqual(4);
    // Nhóm C: báo động giả CÓ THẬT và không nhỏ ⇒ bằng chứng cho "chỉ đánh dấu, không chặn".
    expect(baoDongGiaC).toBeGreaterThan(0);
  });

  it("★ ĐÂY LÀ LÝ DO KHÔNG ĐƯỢC CHẶN: số dẫn xuất HỢP LỆ vẫn bị gắn cờ", () => {
    // Nếu ai đó biến `numberCheck` thành cổng chặn, ca này là bằng chứng câu trả lời
    // ĐÚNG sẽ bị giết: 224 = 128+64+32, hoàn toàn hợp lệ, nhưng không có trong `data`.
    const r = reconcileAnswerNumbers("Tổng cộng 224 lượt NG trên ba loại lỗi hàng đầu.", KQ_TOP_DEFECT);
    expect(r.unsupported).toContain(224);
  });
});
