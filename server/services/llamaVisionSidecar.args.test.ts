import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Test cấu trúc: đọc chính mã nguồn để khẳng định args có "-np".
 *  Lý do không mock spawn: mảng args nằm trong closure của startPromise,
 *  không xuất khẩu ra ngoài. Đọc nguồn là cách rẻ và trung thực nhất. */
describe("llamaVisionSidecar — tham số spawn", () => {
  const src = readFileSync("server/services/llamaVisionSidecar.ts", "utf8");

  it("truyền -np để llama-server không tự lấy 4 khe song song", () => {
    expect(src).toContain('"-np"');
  });

  it("vẫn giữ các tham số bắt buộc hiện có", () => {
    for (const flag of ['"-m"', '"--mmproj"', '"-ngl"', '"-c"', '"--jinja"']) {
      expect(src).toContain(flag);
    }
  });
});
