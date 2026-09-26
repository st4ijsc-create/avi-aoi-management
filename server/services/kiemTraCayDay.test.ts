/**
 * Khối B — Task 2: lưới cho `kiemTraCayDay` (hàm THUẦN, không CSDL).
 *
 * Bốn phép kiểm trùng khoá ở đây tương ứng ĐÚNG bốn khoá hội tụ của đường ghi.
 * Không có chúng, một payload trùng khoá **hội tụ vào chính nó**: hai phần tử
 * cùng khoá ghi đè nhau trong CÙNG một lượt, hệ nhận N nhưng lưu N-1, và KHÔNG
 * lỗi nào được ném — lớp "mất dữ liệu IM LẶNG" mà lưới DB (đếm hàng) KHÔNG bắt
 * được, vì số hàng vẫn đúng bằng số khoá phân biệt.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { machineTemplateContract } from "../contracts/machineTemplateContract";
import { kiemTraCayDay, TRAN_MA_DIEM_DO, TRAN_SO_COMPONENT_MOI_LUOT } from "./kiemTraCayDay";

const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT);
const mauThat = () => JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));

/** Cây tối thiểu dựng tay — 1/1/1/1, dùng cho các ca không cần mẫu máy thật. */
function cayToiThieu() {
  return machineTemplateContract.parse({
    surfaces: [{
      surfaceId: "S-1",
      surfaceName: "TOP",
      positions: [{
        id: "PU-1",
        positionId: "P01",
        positionIndex: 1,
        name: "P01",
        captures: [{
          id: "C-1",
          name: "Default",
          components: [{ id: "K-1", componentName: "K1", roi: { x: 0, y: 0, width: 10, height: 10 } }],
        }],
      }],
    }],
  });
}

describe("kiemTraCayDay — §1 mẫu máy THẬT đi lọt (chống 'chặn hết cho an toàn')", () => {
  it.skipIf(!CO_MAU)("mẫu máy thật ⇒ 0 lỗi, đếm đúng 2 / 4 / 8 / 16", () => {
    const cay = machineTemplateContract.parse(mauThat());
    const r = kiemTraCayDay(cay);
    expect(r.loi, r.loi.join("\n")).toEqual([]);
    expect([r.soSurface, r.soPosition, r.soCapture, r.soComponent]).toEqual([2, 4, 8, 16]);
  });

  it("cây tối thiểu 1/1/1/1 ⇒ 0 lỗi", () => {
    expect(kiemTraCayDay(cayToiThieu()).loi).toEqual([]);
  });
});

describe("kiemTraCayDay — §2 CÂY RỖNG bị TỪ CHỐI (bẫy Task 1 bàn giao)", () => {
  it("`surfaces: []` ⇒ lỗi nêu rõ vì sao, không im lặng", () => {
    const r = kiemTraCayDay({ surfaces: [] });
    expect(r.loi.length).toBe(1);
    expect(r.loi[0]).toContain("RỖNG");
    expect(r.loi[0]).toContain("xoá mềm");
  });

  it("ĐỐI CHỨNG — hợp đồng zod VẪN nhận `surfaces: []` (phép từ chối sống ở ĐƯỜNG GHI, không ở hình dạng)", () => {
    expect(machineTemplateContract.safeParse({ surfaces: [] }).success).toBe(true);
  });
});

describe("kiemTraCayDay — §3 BỐN khoá hội tụ, mỗi khoá một ca trùng", () => {
  it("surfaceName trùng ⇒ TỪ CHỐI (unique index THẬT là (productModelId, surfaceName))", () => {
    const cay = cayToiThieu();
    cay.surfaces.push({ ...structuredClone(cay.surfaces[0]), surfaceId: "S-2" });
    const r = kiemTraCayDay(cay);
    expect(r.loi.some((l) => l.includes('surfaceName "TOP"'))).toBe(true);
  });

  it("ĐỐI CHỨNG — HAI surface KHÁC tên (dù trùng gì khác) ⇒ hợp lệ", () => {
    const cay = cayToiThieu();
    const hai = structuredClone(cay.surfaces[0]);
    hai.surfaceId = "S-2";
    hai.surfaceName = "BOTTOM";
    hai.positions[0].captures[0].id = "C-2";
    hai.positions[0].captures[0].components[0].id = "K-2";
    cay.surfaces.push(hai);
    expect(kiemTraCayDay(cay).loi).toEqual([]);
  });

  it("positionId trùng trong CÙNG surface ⇒ TỪ CHỐI", () => {
    const cay = cayToiThieu();
    const p2 = structuredClone(cay.surfaces[0].positions[0]);
    p2.id = "PU-2";
    p2.captures[0].id = "C-2";
    p2.captures[0].components[0].id = "K-2";
    cay.surfaces[0].positions.push(p2);
    expect(kiemTraCayDay(cay).loi.some((l) => l.includes('positionId "P01"'))).toBe(true);
  });

  it("capture id trùng trong CÙNG position ⇒ TỪ CHỐI", () => {
    const cay = cayToiThieu();
    const c2 = structuredClone(cay.surfaces[0].positions[0].captures[0]);
    c2.components[0].id = "K-2";
    cay.surfaces[0].positions[0].captures.push(c2);
    expect(kiemTraCayDay(cay).loi.some((l) => l.includes('capture id "C-1"'))).toBe(true);
  });

  it("★★★ component id trùng TOÀN CÂY (khác capture, khác surface) ⇒ TỪ CHỐI — phạm vi RỘNG HƠN chỗ nó được ghi", () => {
    const cay = cayToiThieu();
    const hai = structuredClone(cay.surfaces[0]);
    hai.surfaceId = "S-2";
    hai.surfaceName = "BOTTOM";
    hai.positions[0].captures[0].id = "C-2";
    // `components[0].id` GIỮ NGUYÊN "K-1" — hợp lệ với MỌI unique index cấp capture,
    // nhưng vỡ `uq_point_defs_product_variant_code` (code duy nhất theo productModelId)
    // và làm join của Task 4 (componentExtId → pointDefId) ra HAI hàng.
    cay.surfaces.push(hai);
    const r = kiemTraCayDay(cay);
    expect(r.loi.some((l) => l.includes('component id "K-1"'))).toBe(true);
    expect(r.loi.join(" ")).toContain("Task 4");
  });
});

describe("kiemTraCayDay — §4 hai TRẦN", () => {
  it(`component id dài ${TRAN_MA_DIEM_DO + 1} ⇒ TỪ CHỐI (cột measurement_point_defs.code varchar(50), hợp đồng cho tới 64)`, () => {
    const cay = cayToiThieu();
    cay.surfaces[0].positions[0].captures[0].components[0].id = "K".repeat(TRAN_MA_DIEM_DO + 1);
    const r = kiemTraCayDay(cay);
    expect(r.loi.some((l) => l.includes("varchar(50)"))).toBe(true);
  });

  it(`component id dài ĐÚNG ${TRAN_MA_DIEM_DO} ⇒ hợp lệ (ca canh biên)`, () => {
    const cay = cayToiThieu();
    cay.surfaces[0].positions[0].captures[0].components[0].id = "K".repeat(TRAN_MA_DIEM_DO);
    expect(kiemTraCayDay(cay).loi).toEqual([]);
  });

  it("ĐỐI CHỨNG — hợp đồng zod VẪN nhận id 64 ký tự (khoảng 51..64 chỉ chết ở cột `code`, cửa nêu tên)", () => {
    const cay = cayToiThieu();
    cay.surfaces[0].positions[0].captures[0].components[0].id = "K".repeat(64);
    expect(machineTemplateContract.safeParse(cay).success).toBe(true);
    expect(kiemTraCayDay(cay).loi.length).toBe(1);
  });

  it(`quá ${TRAN_SO_COMPONENT_MOI_LUOT} linh kiện MỘT lượt ⇒ TỪ CHỐI`, () => {
    const cay = cayToiThieu();
    const capture = cay.surfaces[0].positions[0].captures[0];
    capture.components = Array.from({ length: TRAN_SO_COMPONENT_MOI_LUOT + 1 }, (_, i) => ({
      id: `K-${i}`,
      componentName: `K${i}`,
      roi: { x: 0, y: 0, width: 1, height: 1 },
    }));
    const r = kiemTraCayDay(cay);
    expect(r.soComponent).toBe(TRAN_SO_COMPONENT_MOI_LUOT + 1);
    expect(r.loi.some((l) => l.includes("quá trần"))).toBe(true);
  });
});
