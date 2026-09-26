// server/contracts/hopDongVsIngest.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { machineDataContractV2 } from "./machineDataContractV2";
import { mauHopLe } from "./machineDataContractV2.test-helpers";

/**
 * BG-14 (§13 Đ-17). Hợp đồng v2.0 NHẬN `serialNumber` rỗng (đúng tài liệu máy:
 * "rỗng nếu máy chưa gửi"). Đường ingest thật thì TỪ CHỐI, và đó là CHỦ ĐÍCH:
 * `uq_inspections_machine_serial_time` là chỉ mục RIÊNG PHẦN `WHERE serialNumber <> ''`
 * ⇒ serial rỗng THOÁT khoá duy nhất ⇒ nhận nó là mở lại lỗ đếm trùng (doc 51 P0).
 *
 * Lưới này KHÔNG đòi hai bên phải giống nhau. Nó đòi sự KHÁC NHAU phải được NÓI RA,
 * để không ai "sửa cho nhất quán" mà vô tình mở lại lỗ.
 */
describe("cửa sổ lệch giữa hợp đồng và ingest — có CHỦ ĐÍCH, phải nói ra", () => {
  it("hợp đồng NHẬN serialNumber rỗng", () => {
    const p = mauHopLe();
    p.serialNumber = "";
    expect(machineDataContractV2.safeParse(p).success).toBe(true);
  });

  it("ingest thật vẫn ĐÒI serialNumber không rỗng — đừng nới cho tới khi có đường khử trùng khác", () => {
    const nguon = readFileSync("server/routers/machineApiRouters.ts", "utf8");
    expect(
      /serialNumber:\s*z\.string\(\)\.trim\(\)\.min\(1\)/.test(nguon),
      "ingest đã nới serialNumber mà chưa thấy đường khử trùng thay thế — xem §13 Đ-17 trước khi làm việc này",
    ).toBe(true);
  });
});
