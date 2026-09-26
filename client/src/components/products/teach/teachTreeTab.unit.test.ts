// Khối C Task 10 — lưới logic THUẦN của tab "Cây dạy" (map dữ liệu + trạng thái). KHÔNG cần
// DOM/DB: import trực tiếp hàm thuần từ `teachTreeLogic.ts` (đúng khuôn `batchSuggest.logic.
// unit.test.ts` — vitest.config.ts chạy `*.unit.test.ts` ở `environment: "node"`, không có
// jsdom/@testing-library/react trong repo này nên "render + mock trpc" không thể chạy được).
import { describe, it, expect } from "vitest";
import { POINT_LIMIT_SPEC } from "@shared/pointLimitSpec";
import {
  mapComponentRow,
  mapComponentRows,
  formatRoi,
  trangThaiGioiHan,
  layMayMacDinh,
  formatThongKe,
  COT_GIOI_HAN_HIEN_THI,
  type ComponentCayDay,
  type MayCoBanDay,
} from "./teachTreeLogic";

/** Component mẫu — 18 khoá `gioiHan` như Task 9 thật sự trả (đo hợp đồng, không suy đoán). */
function mauComponent(overrides: Partial<ComponentCayDay> = {}): ComponentCayDay {
  const gioiHanRong: Record<string, string | null> = {};
  for (const m of POINT_LIMIT_SPEC) gioiHanRong[m.field] = null;
  return {
    id: 1,
    componentExtId: "C1",
    name: "R1",
    roiX: 10,
    roiY: 20,
    roiWidth: 30,
    roiHeight: 40,
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    coGioiHan: false,
    gioiHan: gioiHanRong,
    ...overrides,
  };
}

describe("layMayMacDinh", () => {
  it("danh sách RỖNG ⇒ null — TeachTreeTab render empty-state, không bịa máy", () => {
    expect(layMayMacDinh([])).toBeNull();
  });

  it("có máy ⇒ trả về machineId của máy ĐẦU TIÊN theo thứ tự server trả", () => {
    const danhSach: MayCoBanDay[] = [
      { machineId: 7, machineCode: "M07", machineName: "Máy 7", banDayHienHanh: null },
      { machineId: 3, machineCode: "M03", machineName: "Máy 3", banDayHienHanh: null },
    ];
    expect(layMayMacDinh(danhSach)).toBe(7);
  });
});

describe("mapComponentRows — đếm đúng số hàng component", () => {
  it("cây có N component ⇒ bảng có ĐÚNG N hàng, giữ nguyên thứ tự id", () => {
    const list = [mauComponent({ id: 1 }), mauComponent({ id: 2 }), mauComponent({ id: 3 })];
    const rows = mapComponentRows(list);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("danh sách RỖNG (capture chưa có linh kiện) ⇒ 0 hàng, không ném lỗi", () => {
    expect(mapComponentRows([])).toEqual([]);
  });
});

describe("mapComponentRow — CHỈ 5 cột giới hạn ĐANG DÙNG (quyết định #2 chủ dự án)", () => {
  it("gioiHanHienThi có ĐÚNG 5 khoá: lowerLimit/upperLimit/unit/heightMin/heightMax", () => {
    const row = mapComponentRow(mauComponent());
    expect(Object.keys(row.gioiHanHienThi).sort()).toEqual(
      ["heightMax", "heightMin", "lowerLimit", "unit", "upperLimit"].sort(),
    );
  });

  it("KHÔNG có nominalValue (không nằm trong POINT_LIMIT_SPEC — brief Task 10 sai điểm này)", () => {
    const row = mapComponentRow(mauComponent());
    expect(row.gioiHanHienThi).not.toHaveProperty("nominalValue");
  });

  it("KHÔNG có 13 trường 3D/GDT khác (area*/volume*/coplanarity/warpage/voidPct/offset*/tilt/thickness*/criteria) — đo trên 3.252 điểm: 0 dữ liệu", () => {
    const row = mapComponentRow(mauComponent());
    const CAM = ["areaMin", "areaMax", "volumeMin", "volumeMax", "coplanarityMax", "warpageMax",
      "voidPctMax", "offsetXMax", "offsetYMax", "tiltMax", "thicknessMin", "thicknessMax", "criteria"];
    for (const field of CAM) expect(row.gioiHanHienThi).not.toHaveProperty(field);
  });

  it("giá trị gioiHanHienThi CHIẾU THẲNG từ gioiHan gốc (Task 9), không đổi số", () => {
    const c = mauComponent({
      gioiHan: {
        ...mauComponent().gioiHan,
        lowerLimit: "1.5", upperLimit: "2.5", unit: "mm", heightMin: "0.1", heightMax: "0.9",
      },
    });
    const row = mapComponentRow(c);
    expect(row.gioiHanHienThi).toEqual({
      lowerLimit: "1.5", upperLimit: "2.5", unit: "mm", heightMin: "0.1", heightMax: "0.9",
    });
  });

  it("coGioiHan CHIẾU THẲNG từ Task 9 (server tính bằng tinhGioiHan), không suy lại ở client", () => {
    expect(mapComponentRow(mauComponent({ coGioiHan: true })).coGioiHan).toBe(true);
    expect(mapComponentRow(mauComponent({ coGioiHan: false })).coGioiHan).toBe(false);
  });
});

describe("COT_GIOI_HAN_HIEN_THI — TẬP CON lọc từ shared/pointLimitSpec.ts, không chép tay", () => {
  it("đúng 5 mục, mỗi mục field/i18nKey KHỚP NGUYÊN VĂN mục tương ứng trong POINT_LIMIT_SPEC", () => {
    expect(COT_GIOI_HAN_HIEN_THI).toHaveLength(5);
    for (const cot of COT_GIOI_HAN_HIEN_THI) {
      const goc = POINT_LIMIT_SPEC.find((m) => m.field === cot.field);
      expect(goc, `field '${cot.field}' phải tồn tại trong POINT_LIMIT_SPEC`).toBeDefined();
      expect(cot.i18nKey).toBe(goc!.i18nKey);
      expect(cot.nhom).toBe(goc!.nhom);
    }
  });
});

describe("formatRoi", () => {
  it("đủ 4 toạ độ ⇒ chuỗi gọn 'x,y (w×h)'", () => {
    expect(formatRoi({ roiX: 10, roiY: 20, roiWidth: 30, roiHeight: 40 })).toBe("10,20 (30×40)");
  });
  it("thiếu BẤT KỲ toạ độ nào ⇒ '—' — không bịa số một phần", () => {
    expect(formatRoi({ roiX: null, roiY: 20, roiWidth: 30, roiHeight: 40 })).toBe("—");
    expect(formatRoi({ roiX: 10, roiY: 20, roiWidth: null, roiHeight: 40 })).toBe("—");
  });
});

describe("trangThaiGioiHan — BG-105: chỉ nói 'đã dạy / chưa dạy', KHÔNG ngụ ý 'chấm được'", () => {
  it("coGioiHan=true ⇒ 'Đã dạy giới hạn', variant secondary", () => {
    const tt = trangThaiGioiHan(true);
    expect(tt.defaultText).toBe("Đã dạy giới hạn");
    expect(tt.variant).toBe("secondary");
  });
  it("coGioiHan=false ⇒ 'Chưa dạy', variant destructive", () => {
    const tt = trangThaiGioiHan(false);
    expect(tt.defaultText).toBe("Chưa dạy");
    expect(tt.variant).toBe("destructive");
  });
  it("nhãn KHÔNG chứa từ ngữ ngụ ý spec-gate ('chấm', 'sẵn sàng', 'kiểm')", () => {
    for (const coGioiHan of [true, false]) {
      const text = trangThaiGioiHan(coGioiHan).defaultText;
      expect(text).not.toMatch(/chấm|sẵn sàng|kiểm/);
    }
  });
});

describe("formatThongKe — chiếu THẲNG thongKeGioiHan (Task 9), KHÔNG tự đếm lại ở client", () => {
  it("trả lại đúng {daDay, tong} từ thongKeGioiHan, không tính toán gì thêm", () => {
    expect(formatThongKe({ tongComponent: 16, daDay: 5, chuaCoGioiHan: 11 })).toEqual({ daDay: 5, tong: 16 });
  });

  it("khớp BẰNG CẤU TẠO với con số của một cây LỚN hơn capture đang xem (16 vs 2 của một capture)", () => {
    // thongKeGioiHan đếm TOÀN CÂY (16 component, 8 capture × 2), listComponents chỉ trả MỘT
    // capture (2 hàng) — formatThongKe phải trả con số TOÀN CÂY (16), không phải 2.
    const toanCay = { tongComponent: 16, daDay: 3, chuaCoGioiHan: 13 };
    const mongMuon = formatThongKe(toanCay);
    const hangCuaMotCapture = mapComponentRows([mauComponent({ id: 1 }), mauComponent({ id: 2 })]);
    expect(mongMuon.tong).toBe(16);
    expect(mongMuon.tong).not.toBe(hangCuaMotCapture.length);
  });
});
