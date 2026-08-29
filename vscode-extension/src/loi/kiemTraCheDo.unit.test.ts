/**
 * LƯỚI vị từ chặn thẻ duyệt hiện sai chế độ. Hàng rào cuối trước khi người dùng lỡ tay ghi lên
 * SERVER trong khi tưởng đang ở LOCAL — xem docblock `kiemTraCheDo.ts` để biết vì sao trường hợp
 * này "không nên xảy ra" nhưng vẫn phải chặn.
 */
import { describe, it, expect } from "vitest";
import { coDuocHienTheDuyet } from "./kiemTraCheDo";

describe("coDuocHienTheDuyet", () => {
  it("★★★ chế độ SERVER ⇒ được hiện thẻ duyệt", () => {
    expect(coDuocHienTheDuyet("server")).toBe(true);
  });

  it("★★★ chế độ LOCAL ⇒ KHÔNG được hiện thẻ duyệt", () => {
    expect(coDuocHienTheDuyet("local")).toBe(false);
  });
});
