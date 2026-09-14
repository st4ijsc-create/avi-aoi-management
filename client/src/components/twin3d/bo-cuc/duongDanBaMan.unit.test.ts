/**
 * Lưới cho QĐ-21 — **đường dẫn phân cấp** của ba màn Twin (§14p.4).
 *
 *     /twin              → màn NHÀ MÁY   (đã có, App.tsx)
 *     /twin/line/:id     → màn LINE      (Đợt 30, `TwinLine.tsx`)
 *     /twin/may/:id      → màn MÁY       (Đợt 31, `TwinMay.tsx`)
 *     /twin-studio       → màn THIẾT KẾ  (đã có)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO PHẢI ĐO CHỨ KHÔNG ĐƯỢC TIN LỜI KHAI
 * ════════════════════════════════════════════════════════════════════════════
 * §14p.4 khẳng định *"Wouter khớp CHÍNH XÁC, không phải tiền tố"*. Nếu điều đó
 * SAI thì `/twin` sẽ **nuốt** `/twin/line/2` và màn Line không bao giờ hiện —
 * mà triệu chứng là **màn nhà máy hiện ra**, không phải một lỗi. Đúng lớp
 * **G67**: URL bị nuốt im lặng, ghi được, đọc ra thứ khác, không lỗi nào nổ.
 *
 * ⇒ Lưới này đo bằng **chính bộ khớp của wouter** (`useRoute` qua `Router` với
 *   `memoryLocation`), không phải bằng một regex tôi tự viết — một regex tự
 *   viết chỉ chứng minh regex ấy, không chứng minh định tuyến thật.
 */

import { describe, expect, it } from "vitest";

/*
 * ★ `parse` không nằm trong `exports` của wouter 3.7.1 (đo được: subpath
 *   './matcher' không export). Nên ta dùng `regexparam` — CHÍNH thư viện wouter
 *   3.x dùng bên trong để biên dịch pattern, và nó CÓ trong node_modules như
 *   một phụ thuộc của wouter. Đo bộ khớp thật, không bịa bộ khớp thứ hai.
 */
import { parse } from "regexparam";

function khop(mau: string, duongDan: string): boolean {
  const { pattern } = parse(mau);
  return pattern.test(duongDan);
}

describe("★★★ QĐ-21 — /twin KHÔNG được nuốt hai đường con", () => {
  it("/twin khớp đúng chính nó", () => {
    expect(khop("/twin", "/twin")).toBe(true);
  });

  it("★★★ /twin KHÔNG khớp /twin/line/2 — nếu đỏ, màn Line bị nuốt IM LẶNG", () => {
    expect(khop("/twin", "/twin/line/2")).toBe(false);
  });

  it("★★★ /twin KHÔNG khớp /twin/may/5", () => {
    expect(khop("/twin", "/twin/may/5")).toBe(false);
  });

  it("★ /twin KHÔNG khớp /twin-studio (và ngược lại) — hai màn đã có, không đụng nhau", () => {
    expect(khop("/twin", "/twin-studio")).toBe(false);
    expect(khop("/twin-studio", "/twin")).toBe(false);
  });
});

describe("★ hai mẫu mới khớp đúng đường của mình, và KHÔNG khớp của nhau", () => {
  it("/twin/line/:id khớp /twin/line/2", () => {
    expect(khop("/twin/line/:id", "/twin/line/2")).toBe(true);
  });

  it("/twin/may/:id khớp /twin/may/5", () => {
    expect(khop("/twin/may/:id", "/twin/may/5")).toBe(true);
  });

  it("★★★ /twin/line/:id KHÔNG khớp /twin/may/5 — hai màn không tráo nhau", () => {
    expect(khop("/twin/line/:id", "/twin/may/5")).toBe(false);
    expect(khop("/twin/may/:id", "/twin/line/2")).toBe(false);
  });

  it("★ không khớp khi THIẾU id — /twin/line trần không rơi vào màn Line", () => {
    // Mẫu khai `:id` bắt buộc (không `:id?`), nên đây là hành vi mong đợi.
    expect(khop("/twin/line/:id", "/twin/line")).toBe(false);
  });

  it("★ ĐỐI CHỨNG — bộ đo này BIẾT KÊU: mẫu sai thì false", () => {
    expect(khop("/twin/line/:id", "/hoan-toan-khac")).toBe(false);
    expect(khop("/khong-ton-tai", "/khong-ton-tai")).toBe(true);
  });
});

/*
 * ★★★ ĐỢT 31 — màn MÁY `/twin/may/:id` (`TwinMay.tsx`). Cùng bộ khớp, thêm
 *   đúng những ca mà màn Máy có thể SAI KHÁC màn Line: id nhiều chữ số, thiếu
 *   id, đuôi thừa, và hai màn máy tên gần nhau (`/machine/:id`, §11b).
 */
describe("★★★ ĐỢT 31 — `/twin/may/:id` khớp đúng đường của mình, không hơn", () => {
  it("khớp id nhiều chữ số (`/twin/may/114`) — id máy thật trong CSDL không phải một chữ số", () => {
    expect(khop("/twin/may/:id", "/twin/may/114")).toBe(true);
  });

  it("★ KHÔNG khớp khi THIẾU id — `/twin/may` trần không rơi vào màn Máy", () => {
    expect(khop("/twin/may/:id", "/twin/may")).toBe(false);
    expect(khop("/twin/may/:id", "/twin/may/")).toBe(false);
  });

  it("★★★ KHÔNG khớp khi có ĐUÔI THỪA — wouter khớp chính xác, `/twin/may/5/x` không phải màn Máy", () => {
    expect(khop("/twin/may/:id", "/twin/may/5/x")).toBe(false);
  });

  it("★★★ §11b — `/machine/:id` (cockpit 2D toàn trang) và `/twin/may/:id` KHÔNG tráo nhau", () => {
    expect(khop("/machine/:id", "/twin/may/5")).toBe(false);
    expect(khop("/twin/may/:id", "/machine/5")).toBe(false);
    // ★ Và cả hai vẫn khớp đúng đường của mình — không phải "đo trên tập rỗng".
    expect(khop("/machine/:id", "/machine/5")).toBe(true);
    expect(khop("/twin/may/:id", "/twin/may/5")).toBe(true);
  });

  it("★ `/twin-studio` không nuốt `/twin/may/5` (và ngược lại)", () => {
    expect(khop("/twin-studio", "/twin/may/5")).toBe(false);
    expect(khop("/twin/may/:id", "/twin-studio")).toBe(false);
  });
});
