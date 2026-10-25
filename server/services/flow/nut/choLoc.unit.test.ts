/**
 * Lô logic-cho / logic-loc — node thuần: `logic.cho` (trả `__hen`), `logic.dung-loi`, `logic.loc` (giu/loai), `logic.sap-xep` (ổn định, khoá sai kiểu xếp cuối) và bộ kiểm tham số tĩnh.
 */
import { describe, expect, it } from "vitest";
import { layNut, type KetQuaChay, type NguCanhChay } from "../dangKyNut";
import "../nut";
import { kiemThamSoNutMoi } from "../kiemThamSoNut";
import { CHO_TOI_DA_GIAY, LoiDungLoi } from "./cho";
import { TRAN_ITEM_LOC } from "./loc";

type Item = { json: Record<string, unknown> };
const ngu = (main: Item[]): NguCanhChay => ({
  runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" },
});
const chay = async (type: string, tham: Record<string, unknown>, main: Item[]) => (await layNut(type)!.chay(tham, ngu(main))) as Record<string, unknown>;
const ids = (r: KetQuaChay, cong: string) => (r[cong] ?? []).map((x) => x.json.i);
const dinh = (type: string, parameters: Record<string, unknown>) => ({ nodes: [{ id: "n", type, parameters }] });

describe("logic.cho", () => {
  it("trả __hen {ms, ra.main = item nguyên vẹn}; mặc định 60 s; 0 ⇒ ms 0; số lẻ làm tròn mili-giây", async () => {
    const vao = [{ json: { i: 1 } }, { json: { i: 2 } }];
    expect(await chay("logic.cho", { giay: 3600 }, vao)).toEqual({ __hen: { ms: 3_600_000, ra: { main: vao } } });
    expect(((await chay("logic.cho", {}, vao)) as { __hen: { ms: number } }).__hen.ms).toBe(60_000);
    expect(((await chay("logic.cho", { giay: 0 }, vao)) as { __hen: { ms: number } }).__hen.ms).toBe(0);
    expect(((await chay("logic.cho", { giay: 1.5 }, vao)) as { __hen: { ms: number } }).__hen.ms).toBe(1500);
    expect(((await chay("logic.cho", { giay: CHO_TOI_DA_GIAY }, vao)) as { __hen: { ms: number } }).__hen.ms).toBe(86_400_000);
  });
  it("★ ngoài 0…86400 / không phải số ⇒ node từ chối lúc chạy; biểu thức theo item được đánh giá", async () => {
    for (const giay of [-1, 86_401, "abc", Number.NaN, null]) await expect(chay("logic.cho", { giay }, [{ json: {} }]), String(giay)).rejects.toThrow(/giay phải là số/);
    expect(((await chay("logic.cho", { giay: "{{ $json.g }}" }, [{ json: { g: 5 } }])) as { __hen: { ms: number } }).__hen.ms).toBe(5000);
  });
  it("bộ kiểm tham số tĩnh: giay ngoài khoảng / chuỗi trần ⇒ lỗi; trong khoảng và biểu thức ⇒ qua", () => {
    expect(kiemThamSoNutMoi(dinh("logic.cho", { giay: 60 }))).toEqual([]);
    expect(kiemThamSoNutMoi(dinh("logic.cho", { giay: "{{ $json.g }}" }))).toEqual([]);
    expect(kiemThamSoNutMoi(dinh("logic.cho", {}))).toEqual([]);
    expect(kiemThamSoNutMoi(dinh("logic.cho", { giay: 86_401 }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.cho", { giay: -1 }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.cho", { giay: "60" }))).toHaveLength(1);
  });
});

describe("logic.dung-loi", () => {
  it("ném LoiDungLoi với thông điệp đã đánh giá (≤ 200 ký tự), mã DUNG_LOI; biểu thức lỗi ⇒ thông điệp mặc định", async () => {
    const e = await chay("logic.dung-loi", { thongDiep: "Dừng vì {{ $json.lyDo }}" }, [{ json: { lyDo: "x" } }]).catch((x) => x);
    expect(e).toBeInstanceOf(LoiDungLoi);
    expect(e.message).toBe("Dừng vì x");
    expect(e.ma).toBe("DUNG_LOI");
    expect((await chay("logic.dung-loi", { thongDiep: "a".repeat(500) }, [{ json: {} }]).catch((x) => x)).message).toHaveLength(200);
    expect((await chay("logic.dung-loi", { thongDiep: "{{ $json.a.b.c( }}" }, [{ json: {} }]).catch((x) => x)).message).toBe("Luồng dừng có chủ ý");
    await expect(chay("logic.dung-loi", {}, [])).rejects.toThrow("Luồng dừng có chủ ý");
  });
  it("không có cổng ra; bộ kiểm tĩnh: thongDiep phải là chuỗi ≤ 200", () => {
    expect(layNut("logic.dung-loi")!.congRa).toEqual([]);
    expect(kiemThamSoNutMoi(dinh("logic.dung-loi", { thongDiep: "ok" }))).toEqual([]);
    expect(kiemThamSoNutMoi(dinh("logic.dung-loi", { thongDiep: 5 }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.dung-loi", { thongDiep: "a".repeat(201) }))).toHaveLength(1);
  });
});

describe("logic.loc", () => {
  const vao = [{ json: { i: 1, oee: 0.5, nhan: "a" } }, { json: { i: 2, oee: 0.9, nhan: "b" } }, { json: { i: 3, oee: "0.1", nhan: "a" } }, { json: { i: 4, nhan: "a" } }, { json: { i: 5, oee: 0.7, nhan: "a" } }];
  it("★ một điều kiện: gte nghiêm ngặt kiểu — chuỗi '0.1' và thiếu trường ra `loai`; Σ giu + loai = vào", async () => {
    const r = (await chay("logic.loc", { dieuKien: [{ giaTri: "{{ $json.oee }}", so: "gte", dich: 0.6 }] }, vao)) as KetQuaChay;
    expect(ids(r, "giu")).toEqual([2, 5]);
    expect(ids(r, "loai")).toEqual([1, 3, 4]);
  });
  it("nhiều điều kiện là VÀ; eq / in; thứ tự item giữ nguyên", async () => {
    const r = (await chay("logic.loc", { dieuKien: [{ giaTri: "{{ $json.nhan }}", so: "eq", dich: "a" }, { giaTri: "{{ $json.oee }}", so: "lt", dich: 0.8 }] }, vao)) as KetQuaChay;
    expect(ids(r, "giu")).toEqual([1, 5]);
    const r2 = (await chay("logic.loc", { dieuKien: [{ giaTri: "{{ $json.i }}", so: "in", dich: [4, 2, 99] }] }, vao)) as KetQuaChay;
    expect(ids(r2, "giu")).toEqual([2, 4]);
  });
  it("biểu thức lỗi ⇒ item ra `loai` (không rơi); dich là biểu thức theo item", async () => {
    const r = (await chay("logic.loc", { dieuKien: [{ giaTri: "{{ $json.a.b.c( }}", so: "eq", dich: 1 }] }, vao)) as KetQuaChay;
    expect(ids(r, "giu")).toEqual([]);
    expect(ids(r, "loai")).toHaveLength(5);
    const r2 = (await chay("logic.loc", { dieuKien: [{ giaTri: "{{ $json.i }}", so: "gt", dich: "{{ $json.i - 1 }}" }] }, vao)) as KetQuaChay;
    expect(ids(r2, "giu")).toEqual([1, 2, 3, 4, 5]);
  });
  it("0 điều kiện / > 5 / quá 1000 item ⇒ lỗi rõ", async () => {
    await expect(chay("logic.loc", { dieuKien: [] }, vao)).rejects.toThrow(/ít nhất một điều kiện/);
    await expect(chay("logic.loc", { dieuKien: Array.from({ length: 6 }, () => ({ giaTri: "1", so: "eq", dich: 1 })) }, vao)).rejects.toThrow(/tối đa 5/);
    await expect(chay("logic.loc", { dieuKien: [{ giaTri: "1", so: "eq", dich: 1 }] }, Array.from({ length: TRAN_ITEM_LOC + 1 }, () => ({ json: {} })))).rejects.toThrow(/tối đa 1000/);
    expect(((await chay("logic.loc", { dieuKien: [{ giaTri: "{{ 1 }}", so: "eq", dich: 1 }] }, Array.from({ length: TRAN_ITEM_LOC }, () => ({ json: {} })))) as KetQuaChay).giu).toHaveLength(TRAN_ITEM_LOC);
  });
  it("bộ kiểm tĩnh: thiếu điều kiện, toán tử lạ (regex), biểu thức khoá rỗng, 'gt' với chuỗi ⇒ lỗi; hợp lệ ⇒ qua", () => {
    const ok = { giaTri: "{{ $json.x }}", so: "gte", dich: 1 };
    expect(kiemThamSoNutMoi(dinh("logic.loc", { dieuKien: [ok] }))).toEqual([]);
    expect(kiemThamSoNutMoi(dinh("logic.loc", {}))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.loc", { dieuKien: [] }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.loc", { dieuKien: [{ ...ok, so: "regex" }] }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.loc", { dieuKien: [{ ...ok, giaTri: "" }] }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.loc", { dieuKien: [{ ...ok, dich: "5" }] }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.loc", { dieuKien: Array.from({ length: 6 }, () => ok) }))).toHaveLength(1);
  });
});

describe("logic.sap-xep", () => {
  const vao = [{ json: { i: 1, k: 3 } }, { json: { i: 2, k: 1 } }, { json: { i: 3, k: "x" } }, { json: { i: 4, k: 3 } }, { json: { i: 5 } }, { json: { i: 6, k: 2 } }];
  it("★ số tăng/giảm: ỔN ĐỊNH (k bằng nhau giữ thứ tự cũ), khoá sai kiểu / thiếu xếp CUỐI theo thứ tự cũ, bất kể hướng", async () => {
    const tang = (await chay("logic.sap-xep", { giaTri: "{{ $json.k }}", huong: "tang", kieu: "so" }, vao)) as KetQuaChay;
    expect(ids(tang, "main")).toEqual([2, 6, 1, 4, 3, 5]);
    const giam = (await chay("logic.sap-xep", { giaTri: "{{ $json.k }}", huong: "giam", kieu: "so" }, vao)) as KetQuaChay;
    expect(ids(giam, "main")).toEqual([1, 4, 6, 2, 3, 5]);
  });
  it("chuỗi theo mã UTF-16 (xác định); mặc định tang + so; item không đổi nội dung", async () => {
    const ds = [{ json: { i: 1, t: "b" } }, { json: { i: 2, t: "B" } }, { json: { i: 3, t: "a" } }];
    expect(ids((await chay("logic.sap-xep", { giaTri: "{{ $json.t }}", kieu: "chu" }, ds)) as KetQuaChay, "main")).toEqual([2, 3, 1]);
    expect((await chay("logic.sap-xep", { giaTri: "{{ $json.t }}", kieu: "chu" }, ds)).main).toEqual([ds[1], ds[2], ds[0]]);
    expect(ids((await chay("logic.sap-xep", { giaTri: "{{ $json.i }}" }, [{ json: { i: 2 } }, { json: { i: 1 } }])) as KetQuaChay, "main")).toEqual([1, 2]);
  });
  it("huong/kieu lạ ⇒ lỗi; vượt 1000 ⇒ lỗi; bộ kiểm tĩnh", async () => {
    await expect(chay("logic.sap-xep", { giaTri: "1", huong: "xuoi" }, vao)).rejects.toThrow(/huong phải là/);
    await expect(chay("logic.sap-xep", { giaTri: "1", kieu: "ngay" }, vao)).rejects.toThrow(/kieu phải là/);
    await expect(chay("logic.sap-xep", { giaTri: "1" }, Array.from({ length: TRAN_ITEM_LOC + 1 }, () => ({ json: {} })))).rejects.toThrow(/tối đa 1000/);
    expect(kiemThamSoNutMoi(dinh("logic.sap-xep", { giaTri: "{{ $json.k }}", huong: "giam", kieu: "chu" }))).toEqual([]);
    expect(kiemThamSoNutMoi(dinh("logic.sap-xep", { giaTri: "" }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.sap-xep", { giaTri: "x", huong: "xuoi" }))).toHaveLength(1);
    expect(kiemThamSoNutMoi(dinh("logic.sap-xep", { giaTri: "x", kieu: "ngay" }))).toHaveLength(1);
  });
});
