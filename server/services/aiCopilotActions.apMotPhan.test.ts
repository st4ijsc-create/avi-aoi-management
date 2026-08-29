/**
 * ★★★ ĐỢT B · RÀ SOÁT CUỐI (2026-08-29) — **BẢN VÁ CHO LỜI KHAI `executed` LẠI ĐẺ RA MỘT LỜI KHAI SAI KHÁC.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI — LẦN THỨ TƯ CỦA CÙNG MỘT CÁI TẬT: KHAI KẾT CỤC MÀ KHÔNG ĐỌC KẾT CỤC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 6 vá `status='executed'` nói dối bằng `trangThaiSauThucThi()`, dựa trên vị từ chung
 * `daBiTuChoiGhi()` — *"`ToolResult` có `note` không rỗng ⇒ TỪ CHỐI GHI"*. Đúng cho `apply_diff`
 * (một tệp: hoặc ghi, hoặc không). **SAI cho `apply_diff_batch`.**
 *
 * `applyDiffBatch.ts:44-51` chia lượt ghi làm HAI PHA có chủ ý: pha 1 phán quyết CẢ LÔ (một tệp đỏ
 * ⇒ từ chối cả lô, 0 byte), pha 2 GHI. Pha 2 hỏng giữa chừng ⇒ tệp `1..k−1` **ĐÃ TRÊN ĐĨA** và tool
 * trả `note:"BATCH_PARTIAL"` (`applyDiffBatch.ts:126-136` gọi đây là *"mã quan trọng nhất của file
 * này: nó tồn tại để trạng thái nửa vời KHÔNG BAO GIỜ im lặng"*).
 *
 * Với `note` không rỗng, `daBiTuChoiGhi()` trả `true` ⇒ trước bản vá này cột `status` nhận
 * `'bi_tu_choi_ghi'` — mà hợp đồng CHỮ của chính giá trị đó (docblock `drizzle/0341_….sql` và
 * `drizzle/schema/enums.ts`) là **"0 byte vào đĩa"**. Lời khai trả về cho người gọi còn nói thẳng
 * *"không byte nào vào đĩa"*. Cả hai đều SAI ở đúng ca nguy hiểm nhất: người đọc tin cây làm việc
 * còn nguyên rồi **đề xuất lại CẢ LÔ** trên một cây đã nửa vời.
 *
 * ⚠ Repo NÀY đã bắt đúng cái bẫy đó một tầng trên: `AICodingWorkspace.tsx:1535-1542` tách riêng
 *   `BATCH_PARTIAL` *"TUYỆT ĐỐI không dùng câu 'tệp trên đĩa KHÔNG đổi' — nó SAI"*. Tầng CSDL thì
 *   chưa. Hai giá trị không phát biểu nổi BA sự thật (ghi · không ghi · **ghi MỘT PHẦN**).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯỚI NÀY THUẦN (không DB, không repo git) — VÀ VÌ SAO THẾ LÀ ĐỦ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ca `BATCH_PARTIAL` chỉ sinh ra được khi **hệ tệp hỏng GIỮA** hai lượt ghi của một lô (đĩa đầy,
 * EACCES, tệp bị khoá) — không dựng lại được một cách tất định trên máy CI. Nhưng mệnh đề cần khoá
 * KHÔNG phải "hệ tệp hỏng thế nào"; nó là *"khi kết quả mang `BATCH_PARTIAL`, hệ dán nhãn gì và
 * nói câu gì"* — và đó đúng là bề mặt của hai hàm THUẦN mà `confirmAction` gọi TẠI ĐIỂM ghi CSDL
 * lẫn điểm trả `ConfirmResult` (xem `aiCopilotActions.ts`, `trangThaiThat` dùng ở cả hai chỗ).
 * Đo hàm thuần ở đây, và ca vòng-thật `aiCopilotActions.tuChoiGhi.test.ts` khoá phần "hàm này
 * THẬT SỰ được gọi ở đường chạy" bằng DB + repo git thật. Hai lưới, hai mệnh đề, không trùng.
 */
import { describe, it, expect } from "vitest";
import {
  trangThaiSauThucThi,
  cauKetCucThucThi,
  type TrangThaiSauThucThi,
} from "./aiCopilotActions";
import { MA_GHI_MOT_PHAN } from "./aiLocalTools/writeHandlers/applyDiffBatch";

/** Hình dạng THẬT của `ToolResult` mà `apply_diff_batch.execute` trả ở lượt áp một phần
 *  (`applyDiffBatch.ts:422`): `note` là HẰNG chữ viết thẳng, `data.daGhi` liệt kê tệp ĐÃ trên đĩa. */
function ketQuaLoApMotPhan() {
  return {
    type: "action_result",
    title: "Áp thay đổi vào nhiều tệp repo",
    note: "BATCH_PARTIAL",
    data: {
      ok: false,
      soTep: 3,
      daGhi: [{ path: "src/a.ts", bytes: 42, created: false, sha256Before: "aa", sha256After: "bb" }],
      chuaGhi: [{ path: "src/b.ts", ma: "EACCES" }, { path: "src/c.ts", ma: "EACCES" }],
    },
    textSummary: "⚠ LÔ ÁP MỘT PHẦN — cây làm việc đang ở trạng thái NỬA VỜI.",
  };
}

/** Từ chối THẬT SỰ 0 byte — chiều ÂM của mọi ca dưới đây. */
function ketQuaTuChoiThat() {
  return { type: "action_result", title: "Áp thay đổi", note: "BASE_MISMATCH", data: { ok: false } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — danh sách mã 'đã có byte vào đĩa' phải ĐẾN TỪ `applyDiffBatch.ts`, không được bịa", () => {
  it("★★ `MA_GHI_MOT_PHAN` là hằng do chính tool lô xuất ra, và chứa BATCH_PARTIAL", () => {
    // Nếu một đợt sau thêm một mã nửa-vời thứ hai, nó phải được thêm ở ĐÚNG file sinh ra mã đó —
    // và bản đồ trạng thái ở `aiCopilotActions` đi theo mà không ai phải nhớ.
    expect([...MA_GHI_MOT_PHAN]).toContain("BATCH_PARTIAL");
  });
});

describe("§2 — `BATCH_PARTIAL` KHÔNG được dán nhãn 'bi_tu_choi_ghi'", () => {
  it("★★★ lô áp MỘT PHẦN ⇒ trạng thái riêng 'ap_mot_phan' (không phải 'bi_tu_choi_ghi', không phải 'executed')", () => {
    const tt = trangThaiSauThucThi(ketQuaLoApMotPhan());
    // Hợp đồng CHỮ của 'bi_tu_choi_ghi' (drizzle/0341 + enums.ts) là "0 byte vào đĩa" — mà ở đây
    // `data.daGhi` có một tệp THẬT trên đĩa. Dán nhãn đó là khai sai, không phải khai thiếu.
    expect(tt, "'bi_tu_choi_ghi' nghĩa là 0 byte vào đĩa — lô áp một phần ĐÃ ghi tệp 1..k−1").not.toBe(
      "bi_tu_choi_ghi",
    );
    expect(tt, "'executed' cũng sai: phần còn lại CHƯA vào đĩa").not.toBe("executed");
    expect(tt).toBe("ap_mot_phan");
  });

  it("★★ chiều ÂM — từ chối THẬT (BASE_MISMATCH, 0 byte) vẫn phải là 'bi_tu_choi_ghi'", () => {
    // Không được "sửa" một lời khai sai bằng cách làm hỏng lời khai đang ĐÚNG.
    expect(trangThaiSauThucThi(ketQuaTuChoiThat())).toBe("bi_tu_choi_ghi");
  });

  it("★★ chiều ÂM — lượt ghi thành công (không `note`) vẫn phải là 'executed'", () => {
    expect(trangThaiSauThucThi({ type: "action_result", data: { ok: true } })).toBe("executed");
    expect(trangThaiSauThucThi(null)).toBe("executed");
  });
});

describe("§3 — lời khai trả về người gọi KHÔNG được nói 'không byte nào vào đĩa' cho lô một phần", () => {
  it("★★★ câu của 'ap_mot_phan' không chứa lời khai 0-byte, và nói rõ MỘT PHẦN đã ghi", () => {
    const cau = cauKetCucThucThi("ap_mot_phan" as TrangThaiSauThucThi);
    expect(cau, "câu này là thứ người dùng đọc rồi quyết định có đề xuất lại cả lô hay không").not.toContain(
      "không byte nào vào đĩa",
    );
    expect(cau.toLowerCase()).toContain("một phần");
  });

  it("★★ chiều ÂM — 'bi_tu_choi_ghi' PHẢI giữ nguyên lời khai 0 byte (đó là sự thật của nó)", () => {
    expect(cauKetCucThucThi("bi_tu_choi_ghi")).toContain("không byte nào vào đĩa");
  });

  it("★ 'executed' giữ nguyên câu cũ — hợp đồng client/CLI/extension không đổi", () => {
    expect(cauKetCucThucThi("executed")).toBe("Đã thực thi.");
  });
});
