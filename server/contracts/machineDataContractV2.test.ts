// server/contracts/machineDataContractV2.test.ts
import { describe, it, expect } from "vitest";
import { machineDataContractV2 } from "./machineDataContractV2";
import { LATEST_MACHINE_CONTRACT_VERSION, MACHINE_CONTRACT_VERSIONS, loiMayChuaNangCap } from "./machineDataContract";

const boHopLe = {
  schemaVersion: "2.0",
  apiKey: "mk_test",
  identity: { station: "AIC-MA3", machine: "ASSY 04", line: "JUNIPER", plant: "FAC-HN", country: "VN", solutionName: "MODEL-X-SOLUTION", appVersion: "1.0.0" },
  productId: "b3f1c2a0-1111-4a2b-9c3d-000000000001",
  serialNumber: "SN123456",
  productModel: "MODEL-X",
  overallResult: "NG",
  ntf: false,
  machineProductIndex: 128,
  startedAt: "2026-08-18T09:30:00.000",
  completedAt: "2026-08-18T09:30:14.400",
  summary: { surfaces: { total: 1, pass: 0, ng: 1, ntf: 0 }, positions: { total: 1, pass: 0, ng: 1, ntf: 0 }, captures: { total: 1, pass: 0, ng: 1, ntf: 0 }, components: { total: 1, pass: 0, ng: 1, ntf: 0 } },
  surfaces: [{
    name: "TOP", result: "NG", ntf: false,
    positions: [{
      positionId: "P01", positionNumber: 1, result: "NG", ntf: false,
      captures: [{
        captureId: "a1b2c3d4-0000-4000-8000-000000001011", captureName: "Default", index: 0, result: "NG", ntf: false,
        components: [{
          componentId: "a1b2c3d4-0000-4000-8000-000000010111", componentName: "R12",
          result: "NG", ntf: false, value: "12.5", lowerLimit: "9", upperLimit: "11",
          errorCode: "E-VAL-01", errorDesc: "vuot nguong tren",
        }],
      }],
    }],
  }],
};

describe("machineDataContractV2 — cây 4 cấp", () => {
  it("nhận payload hợp lệ đủ 4 cấp", () => {
    expect(machineDataContractV2.safeParse(boHopLe).success).toBe(true);
  });

  it("giữ NGUYÊN VĂN componentId — khoá join sang teach data", () => {
    const p = machineDataContractV2.parse(boHopLe);
    expect(p.surfaces[0].positions[0].captures[0].components[0].componentId)
      .toBe("a1b2c3d4-0000-4000-8000-000000010111");
  });

  it("giữ NGUYÊN VĂN captureId — khoá join sang manifest ảnh", () => {
    const p = machineDataContractV2.parse(boHopLe);
    expect(p.surfaces[0].positions[0].captures[0].captureId)
      .toBe("a1b2c3d4-0000-4000-8000-000000001011");
  });

  it("capture KHÔNG có component nào vẫn HỢP LỆ (đèn chụp vùng trống)", () => {
    const b = structuredClone(boHopLe);
    b.surfaces[0].positions[0].captures[0].components = [];
    expect(machineDataContractV2.safeParse(b).success).toBe(true);
  });

  it("`ntf` là BOOL riêng, KHÔNG phải giá trị của result", () => {
    const b = structuredClone(boHopLe);
    b.surfaces[0].positions[0].captures[0].components[0].result = "NTF";
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU captureId ⇒ TỪ CHỐI (sai hợp đồng, không phải lệch nội dung)", () => {
    const b = structuredClone(boHopLe);
    delete (b.surfaces[0].positions[0].captures[0] as any).captureId;
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
    const b = structuredClone(boHopLe);
    delete (b.surfaces[0].positions[0].captures[0].components[0] as any).componentId;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  // F8 — ba trường brief yêu cầu tường minh mà đột biến .optional() từng lọt qua.
  it("THIẾU identity ⇒ TỪ CHỐI", () => {
    const b: any = structuredClone(boHopLe);
    delete b.identity;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU summary ⇒ TỪ CHỐI", () => {
    const b: any = structuredClone(boHopLe);
    delete b.summary;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU summary.surfaces ⇒ TỪ CHỐI (nhóm đếm bắt buộc TỪNG PHẦN, không chỉ object cha summary có mặt)", () => {
    const b: any = structuredClone(boHopLe);
    delete b.summary.surfaces;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU positionId ⇒ TỪ CHỐI", () => {
    const b = structuredClone(boHopLe);
    delete (b.surfaces[0].positions[0] as any).positionId;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  // F3 — serialNumber KHÔNG phải khoá join ⇒ rỗng không bị từ chối (§4.5).
  it("serialNumber RỖNG vẫn HỢP LỆ — không phải khoá join, máy có thể chưa gán serial", () => {
    const b = structuredClone(boHopLe);
    b.serialNumber = "";
    expect(machineDataContractV2.safeParse(b).success).toBe(true);
  });

  // F9 — khoá join toàn khoảng trắng không join được với gì.
  it("captureId TOÀN KHOẢNG TRẮNG ⇒ TỪ CHỐI (khoá join rỗng-thực-chất)", () => {
    const b = structuredClone(boHopLe);
    b.surfaces[0].positions[0].captures[0].captureId = "   ";
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });
});
