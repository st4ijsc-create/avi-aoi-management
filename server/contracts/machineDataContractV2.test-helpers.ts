// server/contracts/machineDataContractV2.test-helpers.ts
//
// Helper dùng chung cho các lưới hợp đồng máy v2.0 (`machineDataContractV2.test.ts`
// và `hopDongVsIngest.test.ts`, Pha 1B Task 3 — BG-14). Tách ra khỏi từng file test
// để KHÔNG chép đôi payload mẫu.

/**
 * Một payload HỢP LỆ đủ 4 cấp (surface → position → capture → component), lấy
 * nguyên hình dạng từ `D:\SOURCES\AOIData\dashboard-sample.json` (rút gọn còn
 * một nhánh mỗi cấp). Trả về BẢN SAO MỚI mỗi lần gọi (`structuredClone`) để
 * các ca test mutate tự do mà không rò rỉ sang ca khác.
 */
export function mauHopLe(): any {
  return structuredClone(MAU_GOC);
}

const MAU_GOC = {
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
