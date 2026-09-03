// server/contracts/limitRangeGateCensus.test.ts
//
// ★★★ BG-113 (review Khối C lượt 9, I-2 + I-3) — census đếm ĐIỂM GỌI của gate
// khoảng giới hạn (`assertCapGioiHanHopLe`/`loiCapGioiHanSauMerge`,
// `server/utils/measurementPointLimitGate.ts`) trên ĐÚNG SÁU đường ghi
// lowerLimit/upperLimit/heightMin/heightMax hôm nay:
//   1. `productRouters.ts` — `measurementPoint.update`
//   2. `productRouters.ts` — `measurementPoint.setLimitsBatch`
//   3. `db/product.ts`     — `updateMeasurementPointLimitsBatch` (phòng thủ kép)
//   4. `utils/measurementPointImport.ts` — `buildInsertFromImportPoint` (bulk import)
//   5. `aiLocalTools/writeHandlers/measurementPoint.ts` — `update_measurement_point.execute`
//   6. `routers/productVariantRouter.ts` — `setOverride` (I-3 — nguồn giới hạn THỨ HAI,
//      patchJson biến thể cũng có thể mang lowerLimit/upperLimit ⇒ CÙNG lỗ I-2)
//
// Kỹ thuật: CÙNG khuôn `vungTuyenUploadZip`/`aoiPackageZipCuaNoiDoi.test.ts` — đọc
// nguồn THẬT, cắt đúng VÙNG bằng hai mốc văn bản (mở đầu procedure liên quan → mốc
// kết thúc trước lời gọi HẠ NGUỒN kế tiếp), rồi hỏi "vùng đó có nhắc tên MỘT trong
// hai hàm gate không". KHÔNG dùng AST nặng — sáu vùng đều đủ hẹp và mốc đủ riêng để
// một quét chuỗi con là chính xác (đối chứng bằng cầu chì "0 vùng chồng lấn" §2).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // .../server

interface DiemGate {
  readonly ten: string;
  readonly tep: string; // tương đối SERVER_ROOT
  /** Mốc mở đầu vùng — chuỗi CHỈ xuất hiện ĐÚNG một lần, ngay TRƯỚC chỗ gate phải đứng. */
  readonly mocBatDau: string;
  /** Mốc kết thúc vùng — đứng SAU gate, TRƯỚC bất kỳ đường ghi/procedure nào khác. */
  readonly mocKetThuc: string;
}

/**
 * ★★★ SÁU điểm gọi — brief I-3 đòi rõ: "Census I-2 phải đếm đường này [variant
 * setOverride] là thứ 6". Thêm/bớt một đường ghi giới hạn KHÔNG tự động vào danh
 * sách này (đây là sổ TAY, như MIEN_TRU_CUA_INGEST_ZIP) — đúng và ĐỦ hôm nay theo
 * review lượt 9 §I-2/I-3; một đường ghi thứ bảy xuất hiện SAU review này sẽ KHÔNG
 * bị census bắt cho tới khi ai đó thêm nó vào đây — hạn chế đã biết, khai rõ (cùng
 * lớp "sổ tay hữu hạn" mà mọi census kiểu allowlist trong repo này mang).
 */
const DIEM_GATE: readonly DiemGate[] = [
  {
    ten: "productRouters.ts#measurementPoint.update",
    tep: "routers/productRouters.ts",
    mocBatDau: "data.lowerLimit = legacyLimits.lowerLimit;",
    mocKetThuc: "P1: derive legacy x/y/r from supplied geometry",
  },
  {
    ten: "productRouters.ts#measurementPoint.setLimitsBatch",
    tep: "routers/productRouters.ts",
    mocBatDau: "must belong to the same product model",
    mocKetThuc: "Cửa duyệt ngưỡng — MỘT lần cho cả batch",
  },
  {
    ten: "db/product.ts#updateMeasurementPointLimitsBatch",
    tep: "db/product.ts",
    mocBatDau: "does not belong to the same product model as the rest of the batch",
    mocKetThuc: "Snapshot PRE-edit state",
  },
  {
    ten: "utils/measurementPointImport.ts#buildInsertFromImportPoint",
    tep: "utils/measurementPointImport.ts",
    mocBatDau: "coplanarityMax: strip ? undefined : dec(point.coplanarityMax),",
    mocKetThuc: "return { row, limitsStripped: strip, rangeError };",
  },
  {
    ten: "aiLocalTools/writeHandlers/measurementPoint.ts#update_measurement_point.execute",
    tep: "services/aiLocalTools/writeHandlers/measurementPoint.ts",
    mocBatDau: "if (gateBlocked(gate)) {",
    mocKetThuc: "await updateMeasurementPointDef(p.id, patch as any",
  },
  {
    ten: "routers/productVariantRouter.ts#setOverride (I-3 — nguồn giới hạn thứ hai)",
    tep: "routers/productVariantRouter.ts",
    mocBatDau: "await assertThresholdEditAllowed(input.basePointDefId);",
    mocKetThuc: "await db.recordVariantOverrideVersion",
  },
];

const TEN_HAM_GATE = ["assertCapGioiHanHopLe(", "loiCapGioiHanSauMerge("];

/** Cắt vùng [mocBatDau, mocKetThuc) từ `ma`. Ném lỗi (không trả rỗng im lặng) nếu mất mốc. */
function catVung(ma: string, d: DiemGate): string {
  const iBatDau = ma.indexOf(d.mocBatDau);
  if (iBatDau === -1) throw new Error(`[${d.ten}] không tìm thấy mốc BẮT ĐẦU "${d.mocBatDau}" — bộ suy đã đổi neo?`);
  const iKetThuc = ma.indexOf(d.mocKetThuc, iBatDau);
  if (iKetThuc === -1) throw new Error(`[${d.ten}] không tìm thấy mốc KẾT THÚC "${d.mocKetThuc}" — bộ suy đã đổi neo?`);
  return ma.slice(iBatDau, iKetThuc);
}

/** `true` nếu vùng có nhắc MỘT trong hai hàm gate. */
function coGate(vung: string): boolean {
  return TEN_HAM_GATE.some((h) => vung.includes(h));
}

const NGUON_TEP = new Map<string, string>(
  [...new Set(DIEM_GATE.map((d) => d.tep))].map((tep) => [tep, readFileSync(join(SERVER_ROOT, tep), "utf8")]),
);

function quetTatCa(nguon: Map<string, string> = NGUON_TEP): { diem: DiemGate; coGate: boolean }[] {
  return DIEM_GATE.map((d) => {
    const ma = nguon.get(d.tep);
    if (ma === undefined) throw new Error(`[${d.ten}] không đọc được ${d.tep}`);
    return { diem: d, coGate: coGate(catVung(ma, d)) };
  });
}

describe("BG-113 census — gate khoảng giới hạn (lowerLimit≤upperLimit/heightMin≤heightMax) trên ĐÚNG 6 đường ghi", () => {
  it("cầu chì 1: cả sáu mốc phải cắt được vùng KHÔNG RỖNG (không thì đang canh chuỗi rỗng)", () => {
    for (const d of DIEM_GATE) {
      const ma = NGUON_TEP.get(d.tep)!;
      const vung = catVung(ma, d);
      expect(vung.length, `[${d.ten}] vùng cắt được rỗng/quá ngắn`).toBeGreaterThan(10);
    }
  });

  it("cầu chì 2: sáu vùng cắt được KHÔNG trùng lặp lẫn nhau trong CÙNG một file (mốc đủ riêng)", () => {
    const theoTep = new Map<string, string[]>();
    for (const d of DIEM_GATE) {
      const ma = NGUON_TEP.get(d.tep)!;
      const vung = catVung(ma, d);
      const ds = theoTep.get(d.tep) ?? [];
      ds.push(vung);
      theoTep.set(d.tep, ds);
    }
    for (const [tep, vungs] of theoTep) {
      if (vungs.length < 2) continue;
      for (let i = 0; i < vungs.length; i++) {
        for (let j = i + 1; j < vungs.length; j++) {
          expect(vungs[i] === vungs[j], `[${tep}] hai vùng #${i}/#${j} TRÙNG NHAU — mốc không đủ riêng, census có thể tự thoả`).toBe(false);
        }
      }
    }
  });

  it("★★★ BẤT BIẾN: cả SÁU điểm ghi giới hạn đều gọi gate — không đường nào ghi lowerLimit/upperLimit mà 0 kiểm khoảng", () => {
    const ket = quetTatCa();
    const thieu = ket.filter((k) => !k.coGate).map((k) => k.diem.ten);
    if (thieu.length) console.error("[BG-113] thiếu gate ở:", thieu);
    expect(thieu, "đường ghi giới hạn sau đây KHÔNG gọi assertCapGioiHanHopLe/loiCapGioiHanSauMerge").toEqual([]);
  });

  it("đúng SÁU điểm được canh — không phải 5 (I-2) cũng không phải 7+ (một đường ghi ẩn danh lọt lưới)", () => {
    expect(DIEM_GATE.length).toBe(6);
    expect(quetTatCa().length).toBe(6);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ ĐỘT BIẾN THẬT (mô phỏng TRONG BỘ NHỚ, 0 byte chạm đĩa): bỏ gate ở ĐÚNG MỘT
  // đường ⇒ census phải ĐỎ ĐÚNG đường đó, KHÔNG đỏ toàn bộ (chứng minh census phân
  // biệt được TỪNG điểm, không chỉ "có lỗi ở đâu đó").
  // ══════════════════════════════════════════════════════════════════════════
  for (const bi of [0, 1, 2, 3, 4, 5]) {
    const d = DIEM_GATE[bi];
    it(`★★★ ĐỘT BIẾN: bỏ gate ở "${d.ten}" ⇒ census ĐỎ ĐÚNG đường này, 5 đường còn lại vẫn XANH`, () => {
      const nguonDotBien = new Map(NGUON_TEP);
      const goc = nguonDotBien.get(d.tep)!;
      const vungGoc = catVung(goc, d);
      expect(coGate(vungGoc), "vùng gốc phải ĐANG có gate — nếu không thì đột biến không đột biến gì cả").toBe(true);

      // Xoá NGUYÊN VĂN lời gọi gate khỏi vùng đó (cả hai tên hàm, phòng đường nào
      // dùng cái nào) — chỉ trong VÙNG của đúng điểm bi, giữ nguyên phần còn lại của
      // file (một điểm gọi khác trong CÙNG file, vd hai vùng của productRouters.ts,
      // KHÔNG được ăn theo).
      let vungDotBien = vungGoc;
      for (const h of TEN_HAM_GATE) {
        const i = vungDotBien.indexOf(h);
        if (i !== -1) vungDotBien = vungDotBien.slice(0, i) + "/* BG-113 DOT BIEN: gate bi xoa */" + vungDotBien.slice(i + h.length);
      }
      expect(vungDotBien).not.toBe(vungGoc);
      const maDotBien = goc.replace(vungGoc, vungDotBien);
      expect(maDotBien).not.toBe(goc);
      nguonDotBien.set(d.tep, maDotBien);

      const ketDotBien = quetTatCa(nguonDotBien);
      const thieuSauDotBien = ketDotBien.filter((k) => !k.coGate).map((k) => k.diem.ten);
      expect(thieuSauDotBien, `đột biến PHẢI làm census bắt được ĐÚNG "${d.ten}"`).toEqual([d.ten]);

      // Đột biến chỉ sống trong Map `nguonDotBien` — chưa từng ghi đĩa.
      const docLai = readFileSync(join(SERVER_ROOT, d.tep), "utf8");
      expect(docLai, `[${d.ten}] file thật KHÔNG được đổi`).toBe(NGUON_TEP.get(d.tep));
    });
  }
});
