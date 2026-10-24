/**
 * SCADA R1a Task 10 (K5/K11) — `kiemCongAi` dùng `max(mức tool, mức KÊNH đích)` khi người gọi biết kênh.
 *
 * Mức kênh = `mucTacDongKenh(tag)` (cột `actuation_level`, NULL ⇒ 5) do người gọi đọc sẵn rồi truyền vào (`mucKenh`) — cổng vẫn
 * là hàm thuần. Vắng `mucKenh` ⇒ hành vi cũ, từng chữ (người gọi không có tag: `set_yield_threshold`, Luồng mô phỏng).
 * Giá trị `mucKenh` lạ lúc chạy (null, 2, "4", NaN…) ⇒ 5 (fail-closed).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BoDemTanSuat, kiemCongAi, mucHieuLuc, type DauVaoCongAi } from "./aiControlGate";

const BAT = { AI_OT_CONTROL_ENABLED: "true" };
let boDem: BoDemTanSuat;
beforeEach(() => {
  boDem = new BoDemTanSuat();
});

const goi = (o: Partial<DauVaoCongAi>) =>
  kiemCongAi({ toolName: "set_machine_param", tagKey: "nhiet_sp", userId: 7, adapterId: 3, safety: "OK", env: BAT, boDem, ...o });

describe("kiemCongAi — mức = max(tool, kênh)", () => {
  it("kênh mức 4 + tool mức 3 ⇒ MUC_QUA_CAO, muc 4 (trước cả cờ/trần/safety)", () => {
    const kq = goi({ mucKenh: 4 });
    expect(kq).toMatchObject({ choPhep: false, ma: "MUC_QUA_CAO", muc: 4 });
    // kể cả khi cờ TẮT: lý do vẫn là mức, không phải cờ
    expect(goi({ mucKenh: 4, env: {} })).toMatchObject({ ma: "MUC_QUA_CAO", muc: 4 });
    expect(boDem.demTrongCuaSo(7, 3, Date.now()), "không tiêu quota").toBe(0);
  });

  it("kênh mức 5 ⇒ MUC_QUA_CAO muc 5; lý do nói mức đến từ KÊNH", () => {
    const kq = goi({ mucKenh: 5 });
    expect(kq).toMatchObject({ choPhep: false, ma: "MUC_QUA_CAO", muc: 5 });
    expect(kq.lyDo).toMatch(/actuation_level|kênh/i);
  });

  it("kênh mức 3 hoặc 1 không HẠ mức tool: set_machine_param vẫn 3 ⇒ CHO_PHEP khi cờ + safety OK", () => {
    expect(goi({ mucKenh: 3 })).toMatchObject({ choPhep: true, muc: 3 });
    expect(goi({ mucKenh: 1 })).toMatchObject({ choPhep: true, muc: 3 });
    // tool mức 5 (tag an toàn) + kênh mức 1 ⇒ vẫn 5
    expect(goi({ tagKey: "safety_door", mucKenh: 1 })).toMatchObject({ ma: "MUC_QUA_CAO", muc: 5 });
  });

  it("tool mức 1 (machine_stop) + kênh mức 3 ⇒ muc 3", () => {
    expect(goi({ toolName: "machine_stop", tagKey: null, mucKenh: 3 })).toMatchObject({ choPhep: true, muc: 3 });
    expect(goi({ toolName: "machine_stop", tagKey: null, mucKenh: 4 })).toMatchObject({ ma: "MUC_QUA_CAO", muc: 4 });
  });

  it("mucKenh lạ lúc chạy ⇒ 5 (fail-closed)", () => {
    for (const x of [null, 2, 0, "4", Number.NaN, 6, 3.5] as unknown[]) {
      expect(goi({ mucKenh: x as never }), String(x)).toMatchObject({ ma: "MUC_QUA_CAO", muc: 5 });
    }
  });

  it("HỒI QUY — vắng mucKenh ⇒ đúng kết quả cũ (người gọi không có tag)", () => {
    expect(goi({})).toMatchObject({ choPhep: true, muc: 3, ma: "CHO_PHEP" });
    const yield3 = kiemCongAi({ toolName: "set_yield_threshold", userId: 7, adapterId: 0, safety: "OK", env: BAT, boDem });
    expect(yield3).toMatchObject({ choPhep: true, muc: 3 });
    expect(kiemCongAi({ toolName: "machine_start", userId: 7, adapterId: 3, safety: "OK", env: BAT, boDem })).toMatchObject({ ma: "MUC_QUA_CAO", muc: 4 });
    expect(goi({ env: {} })).toMatchObject({ ma: "CO_TAT", muc: 3 });
  });

  it("mucHieuLuc = max(phanLoaiMuc(tool, tag), mucKenh); vắng mucKenh = phanLoaiMuc", () => {
    expect(mucHieuLuc("set_machine_param", "sp")).toBe(3);
    expect(mucHieuLuc("set_machine_param", "sp", 4)).toBe(4);
    expect(mucHieuLuc("machine_stop", null, 3)).toBe(3);
    expect(mucHieuLuc("tool_chua_phan_loai", null, 1)).toBe(5);
    expect(mucHieuLuc("machine_pause", null, null as never)).toBe(5);
  });
});
