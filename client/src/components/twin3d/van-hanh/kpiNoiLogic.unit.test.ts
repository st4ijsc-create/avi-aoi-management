/**
 * kpiNoiLogic.unit.test.ts — lưới cho §11 #16 (bảng KPI nổi trên cảnh 3D).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LƯỚI NÀY ĐƯỢC VIẾT ĐỂ **KÊU** — G5 / G32
 * ════════════════════════════════════════════════════════════════════════════
 * `phaVeNen` từng là `f(x) = x` mà mọi cổng vẫn xanh, vì mọi test của nó đo trên
 * tập rỗng hoặc chỉ hỏi "có chạy không ném lỗi không". Nên mỗi nhóm dưới đây
 * phải trả lời ĐƯỢC câu: *đầu ra có KHÁC đầu vào / khác nhánh rỗng không?*
 *
 * Cụ thể, ba bản cài đặt SAI mà lưới này bắt được (đã tiêm thử, xem báo cáo):
 *   (a) `f(x) = 0` mọi ô          → bắt bởi "tập khác rỗng cho số KHÁC nhánh rỗng"
 *   (b) `oeePercent ?? 0`         → bắt bởi "OEE toàn null phải ra null, không 0"
 *   (c) bỏ cờ `chuaDo`            → bắt bởi "chuaDo THẮNG cả dữ liệu khác rỗng"
 */
import { describe, it, expect } from "vitest";
import { tinhKpiNoi, type MayTongQuanKpi } from "./kpiNoiLogic";

/** Dựng một máy với mặc định "im lặng", chỉ ghi đè cái đang được đo. */
function may(p: Partial<MayTongQuanKpi> & { id: number }): MayTongQuanKpi {
  return {
    status: "idle",
    oeePercent: null,
    andonActive: false,
    pdmRiskHigh: false,
    ...p,
  };
}

/** Tiện tra một ô theo khoá — test không được phụ thuộc THỨ TỰ mảng. */
function o(kq: ReturnType<typeof tinhKpiNoi>, khoa: string) {
  const found = kq.o.find((x) => x.khoa === khoa);
  expect(found, `thiếu ô "${khoa}"`).toBeDefined();
  return found!;
}

describe("tinhKpiNoi — nhánh CHƯA ĐO ĐƯỢC (NT-3.5 / CHẶN-2)", () => {
  it("tập RỖNG ⇒ MỌI ô là null, không ô nào là 0", () => {
    const kq = tinhKpiNoi([]);
    expect(kq.mauSo).toBe(0);
    expect(kq.mauSoOee).toBe(0);
    expect(kq.o.length).toBeGreaterThan(0);
    for (const x of kq.o) {
      expect(x.giaTri, `ô "${x.khoa}" phải là null khi chưa đo`).toBeNull();
      expect(x.sacThai).toBe("trung_tinh");
    }
  });

  it("★ `chuaDo` THẮNG cả dữ liệu KHÁC RỖNG — 403 không được in ra số", () => {
    // Ca dương: cùng tập máy này, `chuaDo=false` cho ra số thật (khẳng định
    // ngay dưới). Nếu bỏ cờ `chuaDo` khỏi cài đặt, test này đỏ.
    const ds = [may({ id: 1, status: "running" }), may({ id: 2, status: "down" })];
    const bi403 = tinhKpiNoi(ds, true);
    for (const x of bi403.o) expect(x.giaTri).toBeNull();
    expect(bi403.mauSo).toBe(0);

    const doDuoc = tinhKpiNoi(ds, false);
    expect(o(doDuoc, "dangChay").giaTri).toBe(1);
    expect(o(doDuoc, "dungLoi").giaTri).toBe(1);
  });

  it("nhánh rỗng và nhánh đủ có CÙNG tập khoá và CÙNG đơn vị", () => {
    // Hai nhánh dựng ô ở hai chỗ khác nhau là chỗ G12 hay chui vào: một nhánh
    // quên `%` thì "72" và "72 %" cùng hiện ra tuỳ trạng thái tải.
    const rong = tinhKpiNoi([]);
    const du = tinhKpiNoi([may({ id: 1, status: "running", oeePercent: 80 })]);
    expect(du.o.map((x) => x.khoa)).toEqual(rong.o.map((x) => x.khoa));
    expect(du.o.map((x) => x.donVi)).toEqual(rong.o.map((x) => x.donVi));
    expect(o(du, "tyLeChay").donVi).toBe("%");
    expect(o(du, "oeeTrungBinh").donVi).toBe("%");
  });
});

describe("tinhKpiNoi — G32: đầu ra phải KHÁC nhánh rỗng, và khác nhau theo đầu vào", () => {
  it("đếm từng trạng thái ĐÚNG, và tổng khác 0", () => {
    const ds: MayTongQuanKpi[] = [
      may({ id: 1, status: "running" }),
      may({ id: 2, status: "running" }),
      may({ id: 3, status: "down" }),
      may({ id: 4, status: "maintenance" }),
      may({ id: 5, status: "offline" }),
      may({ id: 6, status: "idle" }),
    ];
    const kq = tinhKpiNoi(ds);
    expect(kq.mauSo).toBe(6);
    expect(o(kq, "dangChay").giaTri).toBe(2);
    expect(o(kq, "dungLoi").giaTri).toBe(1);
    expect(o(kq, "baoTri").giaTri).toBe(1);
    expect(o(kq, "matKetNoi").giaTri).toBe(1);
    // ★ `idle` KHÔNG được gộp vào ô nào — tổng bốn ô < mẫu số, và đó là ĐÚNG.
    const tong =
      (o(kq, "dangChay").giaTri ?? 0) +
      (o(kq, "dungLoi").giaTri ?? 0) +
      (o(kq, "baoTri").giaTri ?? 0) +
      (o(kq, "matKetNoi").giaTri ?? 0);
    expect(tong).toBe(5);
    expect(tong).toBeLessThan(kq.mauSo);
  });

  it("★ ĐỔI ĐẦU VÀO ⇒ ĐỔI ĐẦU RA (không phải hằng số)", () => {
    const a = tinhKpiNoi([may({ id: 1, status: "running" }), may({ id: 2, status: "idle" })]);
    const b = tinhKpiNoi([may({ id: 1, status: "running" }), may({ id: 2, status: "running" })]);
    expect(o(a, "tyLeChay").giaTri).toBe(50);
    expect(o(b, "tyLeChay").giaTri).toBe(100);
    expect(o(a, "tyLeChay").giaTri).not.toBe(o(b, "tyLeChay").giaTri);
    // ...và cả hai khác nhánh rỗng.
    expect(o(a, "tyLeChay").giaTri).not.toBeNull();
  });

  it("andon và PdM đếm ĐỘC LẬP với trạng thái (một máy running vẫn có thể có andon)", () => {
    const kq = tinhKpiNoi([
      may({ id: 1, status: "running", andonActive: true }),
      may({ id: 2, status: "running", pdmRiskHigh: true }),
      may({ id: 3, status: "running", andonActive: true, pdmRiskHigh: true }),
    ]);
    expect(o(kq, "dangChay").giaTri).toBe(3);
    expect(o(kq, "andonMo").giaTri).toBe(2);
    expect(o(kq, "ruiRoPdm").giaTri).toBe(2);
  });
});

describe("tinhKpiNoi — OEE honest-null (ca THẬT của DB này)", () => {
  it("★ MỌI máy oeePercent=null ⇒ oeeTrungBinh null, KHÔNG phải 0", () => {
    // Đây chính xác là hình dạng `factoryCommand.overview` trả cho SIM-FAC
    // (đo 2026-09-07): 42 máy, oeePercent null hết. Một bản cài `?? 0` sẽ in
    // "OEE 0 %" — lời khai SAI về một nhà máy chưa gắn đủ cảm biến.
    const kq = tinhKpiNoi([
      may({ id: 1, status: "running" }),
      may({ id: 2, status: "idle" }),
      may({ id: 3, status: "down" }),
    ]);
    expect(o(kq, "oeeTrungBinh").giaTri).toBeNull();
    expect(kq.mauSoOee).toBe(0);
    // ...trong khi các ô KHÁC vẫn có số ⇒ null này là honest-null, không phải
    // cả bảng chết.
    expect(o(kq, "dangChay").giaTri).toBe(1);
  });

  it("trung bình chỉ trên nhóm CÓ SỐ — máy null không kéo trung bình xuống", () => {
    const kq = tinhKpiNoi([
      may({ id: 1, oeePercent: 80 }),
      may({ id: 2, oeePercent: 60 }),
      may({ id: 3, oeePercent: null }),
      may({ id: 4, oeePercent: null }),
    ]);
    // Đúng: (80+60)/2 = 70. Sai (`?? 0`): (80+60+0+0)/4 = 35.
    expect(o(kq, "oeeTrungBinh").giaTri).toBe(70);
    expect(kq.mauSoOee).toBe(2);
    expect(kq.mauSo).toBe(4);
    expect(o(kq, "oeeTrungBinh").giaTri).not.toBe(35);
  });

  it("mẫu số OEE hiện ra được — 1/42 phân biệt được với 42/42", () => {
    const mot = tinhKpiNoi([
      may({ id: 1, oeePercent: 72 }),
      ...Array.from({ length: 41 }, (_, i) => may({ id: i + 2 })),
    ]);
    const tatCa = tinhKpiNoi(Array.from({ length: 42 }, (_, i) => may({ id: i + 1, oeePercent: 72 })));
    expect(o(mot, "oeeTrungBinh").giaTri).toBe(72);
    expect(o(tatCa, "oeeTrungBinh").giaTri).toBe(72);
    // Cùng con số 72, nhưng mẫu số phân biệt hai câu.
    expect(mot.mauSoOee).toBe(1);
    expect(tatCa.mauSoOee).toBe(42);
    expect(mot.mauSoOee).not.toBe(tatCa.mauSoOee);
  });

  it("giá trị OEE rác (NaN/Infinity) bị loại như null, không làm hỏng trung bình", () => {
    const kq = tinhKpiNoi([
      may({ id: 1, oeePercent: 50 }),
      may({ id: 2, oeePercent: Number.NaN }),
      may({ id: 3, oeePercent: Number.POSITIVE_INFINITY }),
    ]);
    expect(o(kq, "oeeTrungBinh").giaTri).toBe(50);
    expect(kq.mauSoOee).toBe(1);
    expect(Number.isFinite(o(kq, "oeeTrungBinh").giaTri as number)).toBe(true);
  });
});

describe("tinhKpiNoi — sắc thái (KHÔNG sinh mã màu — G29)", () => {
  it("không ô nào mang chuỗi màu; sắc thái nằm trong tập đóng", () => {
    // G29: `THREE.Color` không đọc `oklch()` — WARN rồi trả TRẮNG mà KHÔNG ném.
    // Nên module thuần này không được sinh chuỗi màu nào để lọt xuống three.
    const hopLe = new Set(["trung_tinh", "tot", "canh_bao", "xau"]);
    const kq = tinhKpiNoi([may({ id: 1, status: "running", oeePercent: 90 })]);
    for (const x of kq.o) {
      expect(hopLe.has(x.sacThai), `sắc thái lạ: ${x.sacThai}`).toBe(true);
      expect(String(x.sacThai)).not.toMatch(/oklch|#|rgb|hsl/i);
    }
  });

  it("null luôn trung_tinh — 'chưa đo' không phải tin tốt cũng không phải tin xấu", () => {
    const kq = tinhKpiNoi([may({ id: 1, status: "idle" })]);
    expect(o(kq, "oeeTrungBinh").giaTri).toBeNull();
    expect(o(kq, "oeeTrungBinh").sacThai).toBe("trung_tinh");
  });

  it("sắc thái ĐỔI theo giá trị — ba bậc phân biệt được", () => {
    const cao = tinhKpiNoi([may({ id: 1, oeePercent: 85 })]);
    const vua = tinhKpiNoi([may({ id: 1, oeePercent: 55 })]);
    const thap = tinhKpiNoi([may({ id: 1, oeePercent: 10 })]);
    expect(o(cao, "oeeTrungBinh").sacThai).toBe("tot");
    expect(o(vua, "oeeTrungBinh").sacThai).toBe("canh_bao");
    expect(o(thap, "oeeTrungBinh").sacThai).toBe("xau");
  });

  it("ô sự cố: 0 là trung_tinh, >0 là xấu/cảnh báo (0 KHÔNG được tô đỏ)", () => {
    const sach = tinhKpiNoi([may({ id: 1, status: "running" })]);
    expect(o(sach, "dungLoi").giaTri).toBe(0);
    expect(o(sach, "dungLoi").sacThai).toBe("trung_tinh");
    const hong = tinhKpiNoi([may({ id: 1, status: "down", andonActive: true, pdmRiskHigh: true })]);
    expect(o(hong, "dungLoi").sacThai).toBe("xau");
    expect(o(hong, "andonMo").sacThai).toBe("xau");
    expect(o(hong, "ruiRoPdm").sacThai).toBe("canh_bao");
  });
});

describe("tinhKpiNoi — thuần & không phá đầu vào", () => {
  it("KHÔNG sửa mảng/đối tượng đầu vào", () => {
    const ds = [may({ id: 1, status: "running", oeePercent: 50 })];
    const chup = JSON.stringify(ds);
    tinhKpiNoi(ds);
    expect(JSON.stringify(ds)).toBe(chup);
  });

  it("gọi hai lần cùng đầu vào ⇒ cùng đầu ra (không đồng hồ ẩn)", () => {
    const ds = [may({ id: 1, status: "running" }), may({ id: 2, status: "down" })];
    expect(JSON.stringify(tinhKpiNoi(ds))).toBe(JSON.stringify(tinhKpiNoi(ds)));
  });
});
