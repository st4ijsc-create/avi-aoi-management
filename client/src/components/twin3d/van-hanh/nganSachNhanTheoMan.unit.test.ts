/**
 * nganSachNhanTheoMan.unit.test.ts — **NGÂN SÁCH NHÃN THEO MÀN** (chủ dự án chốt 2026-09-20).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO ĐỔI — VÀ VÌ SAO CHỈ ĐỔI SAU KHI ĐO
 * ════════════════════════════════════════════════════════════════════════════
 * `TRAN_NHAN_DOM = 30` là hằng **toàn cục** của bảng ngân sách §4, hiệu chỉnh cho **ca xấu nhất**:
 * cảnh nhiều nhà máy với **1.108 máy**. Màn Line thì có tập ứng viên bị chặn sẵn bởi **chính một
 * chuyền**, nên nó đang trả giá của một ca không phải của nó.
 *
 * Đo `/twin/line/526` (39 máy) TRƯỚC khi đổi, ở trạng thái đứng yên:
 *   `ve` **30/39** · `vuotTran` **8–9** · `chongLap` 0–1 · `vuotMep` **0** · `biChe` **0**
 * ⇒ cái chặn đúng là **trần**, không phải chồng lấn hay lớp phủ.
 *
 * ⚠ Và lượt A/B trước đó (trần 30 ↔ 60) đã cho thấy **nâng trần suông không phải cái thắng sạch**:
 *   +5 tên @1280×720 nhưng **0** @1920×1080 — ở tư thế sau khi kéo camera thì cái chặn là
 *   `deKhoiKhac`. Nên bản này **không nâng một hằng**; nó **thay hằng bằng chính số máy của
 *   chuyền**, tức trả trần về đúng phạm vi của màn.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ HAI MỐC KẸP, MỖI MỐC MỘT LÝ DO — và ca nghịch cho từng mốc
 * ════════════════════════════════════════════════════════════════════════════
 *   · **sàn `TRAN_NHAN_DOM`** — một ngân sách theo màn chỉ được **NỚI** cho ca nhẹ, **không được
 *     siết thêm**. Chuyền 5 máy mà nhận trần 5 là màn Line tự làm mình tệ hơn mặc định.
 *   · **trần 60** — DOM là chi phí thật; một chuyền bệnh lý 500 máy vẫn phải dừng lại.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { TRAN_NHAN_MAN_LINE_TOI_DA, tranNhanManLine } from "./manLine";
import { TRAN_NHAN_DOM } from "../loi/locNhan";
import { docMaNguon } from "@shared/testing/docMaNguon";

const doc = (t: string) =>
  docMaNguon(resolve(__dirname, "../../../..", "src/pages", t))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("tranNhanManLine", () => {
  it("★★★ KẾT CỤC ĐANG CHỮA: chuyền 39 máy ⇒ trần 39, không còn bị chặn ở 30", () => {
    expect(tranNhanManLine(39)).toBe(39);
    expect(tranNhanManLine(39)).toBeGreaterThan(TRAN_NHAN_DOM);
  });

  it("★★★ CA NGHỊCH (sàn) — chuyền NHỎ KHÔNG bị siết xuống dưới mặc định", () => {
    // Trả về 5 ở đây là màn Line tự làm mình tệ hơn `/twin`, tức ngân sách theo màn đi ngược
    // chính lý do nó tồn tại.
    expect(tranNhanManLine(5)).toBe(TRAN_NHAN_DOM);
    expect(tranNhanManLine(0)).toBe(TRAN_NHAN_DOM);
  });

  it("★★★ CA NGHỊCH (trần) — chuyền bệnh lý vẫn phải dừng: DOM là chi phí THẬT", () => {
    expect(tranNhanManLine(500)).toBe(TRAN_NHAN_MAN_LINE_TOI_DA);
    expect(tranNhanManLine(Number.MAX_SAFE_INTEGER)).toBe(TRAN_NHAN_MAN_LINE_TOI_DA);
  });

  it("★★★ `soMay` RÁC ⇒ rơi về mặc định, KHÔNG ra NaN", () => {
    // Một trần `NaN` làm mọi phép so `>= tran` sai ⇒ **mọi** nhãn lọt qua, đúng kiểu hỏng mà
    // một ngân sách sinh ra để chặn.
    for (const rac of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(tranNhanManLine(rac)).toBe(TRAN_NHAN_DOM);
    }
  });

  it("★ luôn là số NGUYÊN dương (trần lẻ 0,5 nhãn là vô nghĩa)", () => {
    for (const n of [33.7, 41.2, 59.9]) {
      const t = tranNhanManLine(n);
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
    }
  });

  it("★ đơn điệu KHÔNG GIẢM theo số máy — thêm máy không bao giờ làm mất tên", () => {
    let truoc = 0;
    for (const n of [1, 10, 30, 31, 45, 60, 61, 200]) {
      const t = tranNhanManLine(n);
      expect(t).toBeGreaterThanOrEqual(truoc);
      truoc = t;
    }
  });
});

describe("★★★ G93 — trang Line THẬT SỰ truyền trần của chính nó", () => {
  it("`<CanhVanHanh>` nhận `tranNhan={tranNhanManLine(mayVe.length)}`", () => {
    const ma = doc("TwinLine.tsx");
    expect(ma).toContain("tranNhan={tranNhanManLine(mayVe.length)}");
  });

  it("★★★ đếm trên `mayVe` (máy ĐANG VẼ), không trên một danh sách rộng hơn", () => {
    // `mayTatCa` gồm cả máy chuyền khác; lấy nó làm trần là cấp ngân sách cho những máy
    // KHÔNG có mặt trên cảnh — một con số đúng cú pháp mà sai nghĩa.
    const ma = doc("TwinLine.tsx");
    expect(ma).not.toContain("tranNhanManLine(mayTatCa.length)");
    expect(ma).not.toContain("tranNhanManLine(mayLine.length)");
  });

  it("★★★ CHẶNG TRUNG GIAN — `CanhVanHanh` phải chuyền `tranNhan` XUỐNG `LopNhan`", () => {
    /*
     * ⚠ Bẫy G5: trang truyền đúng, hàm thuần đúng, `tsc` xanh — mà tính năng **mất sạch** vì một
     *   chặng ở giữa không chuyền tiếp. Ở đây có HAI chặng phải ghim: bàn đạp (`props.tranNhan`
     *   xuống thân cảnh) và chỗ dựng `<LopNhan>`. Ca "trang truyền đúng" ở trên KHÔNG bắt được
     *   việc gỡ chúng — đột biến B6 của lượt này sống sót cho tới khi có ca này.
     */
    const canh = docMaNguon(resolve(__dirname, "CanhVanHanh.tsx"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Khai trong hợp đồng props…
    expect(canh).toMatch(/tranNhan\?:\s*number;/);
    // …bàn đạp chuyền xuống…
    expect(canh).toContain("tranNhan={props.tranNhan}");
    // …và ĐÚNG HAI lần xuất hiện của `tranNhan={props.tranNhan}` (bàn đạp + `<LopNhan>`).
    expect(canh.split("tranNhan={props.tranNhan}").length - 1).toBe(2);
  });

  it("★★★ màn VẬN HÀNH giữ nguyên mặc định — ngân sách theo màn KHÔNG lan sang ca xấu nhất", () => {
    // `/twin` có tới 1.108 máy; nới trần ở đó là bỏ chính lý do §4 đặt ra con số 30.
    expect(doc("TwinVanHanh.tsx")).not.toContain("tranNhan=");
  });
});
