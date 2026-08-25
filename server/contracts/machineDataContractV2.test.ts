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

  it("v1.0 và v1.1 vẫn CÓ trong map — để từ chối CÓ LÝ DO, không phải để nhận", () => {
    expect(MACHINE_CONTRACT_VERSIONS["1.0"]).toBeDefined();
    expect(MACHINE_CONTRACT_VERSIONS["1.1"]).toBeDefined();
  });

  it("lỗi từ chối máy cũ NÊU RÕ phiên bản cần, không phải lỗi zod thô", () => {
    const e = loiMayChuaNangCap("1.1");
    expect(e.message).toContain("1.1");
    expect(e.message).toContain("2.0");
  });
});
