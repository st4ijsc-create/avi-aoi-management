// server/contracts/machineDataContractV2.test.ts
import { describe, it, expect } from "vitest";
import { machineDataContractV2 } from "./machineDataContractV2";
import { LATEST_MACHINE_CONTRACT_VERSION, MACHINE_CONTRACT_VERSIONS, loiMayChuaNangCap } from "./machineDataContract";
import { mauHopLe } from "./machineDataContractV2.test-helpers";

describe("machineDataContractV2 — cây 4 cấp", () => {
  it("nhận payload hợp lệ đủ 4 cấp", () => {
    expect(machineDataContractV2.safeParse(mauHopLe()).success).toBe(true);
  });

  it("giữ NGUYÊN VĂN componentId — khoá join sang teach data", () => {
    const p = machineDataContractV2.parse(mauHopLe());
    expect(p.surfaces[0].positions[0].captures[0].components[0].componentId)
      .toBe("a1b2c3d4-0000-4000-8000-000000010111");
  });

  it("giữ NGUYÊN VĂN captureId — khoá join sang manifest ảnh", () => {
    const p = machineDataContractV2.parse(mauHopLe());
    expect(p.surfaces[0].positions[0].captures[0].captureId)
      .toBe("a1b2c3d4-0000-4000-8000-000000001011");
  });

  it("capture KHÔNG có component nào vẫn HỢP LỆ (đèn chụp vùng trống)", () => {
    const b = mauHopLe();
    b.surfaces[0].positions[0].captures[0].components = [];
    expect(machineDataContractV2.safeParse(b).success).toBe(true);
  });

  it("`ntf` là BOOL riêng, KHÔNG phải giá trị của result", () => {
    const b = mauHopLe();
    b.surfaces[0].positions[0].captures[0].components[0].result = "NTF";
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU captureId ⇒ TỪ CHỐI (sai hợp đồng, không phải lệch nội dung)", () => {
    const b = mauHopLe();
    delete b.surfaces[0].positions[0].captures[0].captureId;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("LATEST trỏ 2.0 và 2.0 có trong map phiên bản", () => {
    expect(LATEST_MACHINE_CONTRACT_VERSION).toBe("2.0");
    expect(MACHINE_CONTRACT_VERSIONS["2.0"]).toBeDefined();
  });

  it("v1.0 và v1.1 vẫn CÓ trong map — registry còn tra cứu được (KHÔNG suy ra đã bị chặn ở ingest)", () => {
    expect(MACHINE_CONTRACT_VERSIONS["1.0"]).toBeDefined();
    expect(MACHINE_CONTRACT_VERSIONS["1.1"]).toBeDefined();
  });

  it("thông điệp loiMayChuaNangCap nêu rõ cả phiên bản đang gửi lẫn phiên bản cần (gọi thẳng hàm — không qua đường quyết định nào)", () => {
    const e = loiMayChuaNangCap("1.1");
    expect(e.message).toContain("1.1");
    expect(e.message).toContain("2.0");
  });

  // ── Vòng sửa 1 (review 10-đột-biến) ────────────────────────────────────────

  // F2 — componentId đối xứng với captureId: cả hai đều là khoá join bắt buộc.
  it("THIẾU componentId ⇒ TỪ CHỐI (khoá join thật, đối xứng với captureId)", () => {
    const b = mauHopLe();
    delete b.surfaces[0].positions[0].captures[0].components[0].componentId;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  // F8 — ba trường brief yêu cầu tường minh mà đột biến .optional() từng lọt qua.
  it("THIẾU identity ⇒ TỪ CHỐI", () => {
    const b = mauHopLe();
    delete b.identity;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU summary ⇒ TỪ CHỐI", () => {
    const b = mauHopLe();
    delete b.summary;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU summary.surfaces ⇒ TỪ CHỐI (nhóm đếm bắt buộc TỪNG PHẦN, không chỉ object cha summary có mặt)", () => {
    const b = mauHopLe();
    delete b.summary.surfaces;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU positionId ⇒ TỪ CHỐI", () => {
    const b = mauHopLe();
    delete b.surfaces[0].positions[0].positionId;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  // F3 — serialNumber KHÔNG phải khoá join ⇒ rỗng không bị từ chối (§4.5).
  it("serialNumber RỖNG vẫn HỢP LỆ — không phải khoá join, máy có thể chưa gán serial", () => {
    const b = mauHopLe();
    b.serialNumber = "";
    expect(machineDataContractV2.safeParse(b).success).toBe(true);
  });

  // F9 — khoá join toàn khoảng trắng không join được với gì.
  it("captureId TOÀN KHOẢNG TRẮNG ⇒ TỪ CHỐI (khoá join rỗng-thực-chất)", () => {
    const b = mauHopLe();
    b.surfaces[0].positions[0].captures[0].captureId = "   ";
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  // ── Vòng sửa 2 (Pha 1B Task 3, BG-9) ────────────────────────────────────────
  // Cột DB thật: captureExtId/positionId varchar(64), surfaceName varchar(100).
  // Không .max() ở hợp đồng ⇒ lỗi rơi SAU cửa dưới dạng [22001] Postgres.

  it("khoá join dài quá sức chứa cột DB (64) ⇒ TỪ CHỐI NGAY CỬA, không để DB ném 22001", () => {
    const p = mauHopLe();
    p.surfaces[0].positions[0].captures[0].captureId = "x".repeat(80);
    expect(machineDataContractV2.safeParse(p).success).toBe(false);
  });

  it("surface.name dài quá sức chứa cột (100) ⇒ TỪ CHỐI", () => {
    const p = mauHopLe();
    p.surfaces[0].name = "y".repeat(150);
    expect(machineDataContractV2.safeParse(p).success).toBe(false);
  });

  it("độ dài ĐÚNG BẰNG sức chứa vẫn HỢP LỆ — biên không bị siết nhầm", () => {
    const p = mauHopLe();
    p.surfaces[0].positions[0].captures[0].captureId = "x".repeat(64);
    p.surfaces[0].name = "y".repeat(100);
    expect(machineDataContractV2.safeParse(p).success).toBe(true);
  });
});
