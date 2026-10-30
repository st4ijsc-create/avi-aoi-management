/**
 * Đợt 11.3-B — bộ chọn THUẦN của "Tổng quan duyệt thay đổi": phân loại thẻ ghi, kết quả kiểm chứng (chỉ khi có CẤU TRÚC), tiến độ, điều hướng J/K.
 */
import { describe, expect, it } from "vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import { giamSuKien, TRANG_THAI_RONG, type TrangThaiAgent } from "./trangThaiAgent";
import { chiSoKe, ketQuaKiemChung, khoaTheCon, tienDoQuyet, timTheDuyet, tongQuanThayDoi } from "./tongQuanThayDoi";

const chay = (es: SuKienAgent[]): TrangThaiAgent => es.reduce((s, e) => giamSuKien(s, e), TRANG_THAI_RONG);
const BD = { loai: "bat-dau", runId: "r", cheDo: "sua" } as SuKienAgent;
const cd = (id: string, ten: string, thamSo: Record<string, unknown>, xemTruoc?: unknown): SuKienAgent =>
  ({ loai: "can-duyet", id, deXuat: { ten, thamSo, ...(xemTruoc ? { xemTruoc } : {}) } }) as SuKienAgent;
const lenhXong = (id: string, hienThi: unknown): SuKienAgent[] => [
  { loai: "goi-tool", luot: 1, goi: { id, ten: "run_command", thamSo: { command: "npm run check" } } } as SuKienAgent,
  { loai: "ket-qua-tool", id, ok: true, tomTat: "x", hienThi } as SuKienAgent,
];

describe("tongQuanThayDoi", () => {
  it("phân loại sửa/tạo/xoá/đổi tên + đường; thẻ lệnh KHÔNG vào danh sách; giữ thứ tự", () => {
    const s = chay([
      BD,
      cd("a", "edit_file", { path: "src/a.cs" }),
      cd("b", "write_file", { path: "src/b.cs" }),
      cd("c", "delete_file", { path: "old.txt" }),
      cd("d", "rename_file", { from: "x.cs", to: "y.cs" }),
      cd("e", "run_command", { command: "npm run check" }),
    ]);
    expect(tongQuanThayDoi(s).map((m) => [m.id, m.loai, m.tep, m.trangThai])).toEqual([
      ["a", "sua", "src/a.cs", "cho"],
      ["b", "tao", "src/b.cs", "cho"],
      ["c", "xoa", "old.txt", "cho"],
      ["d", "doi-ten", "x.cs → y.cs", "cho"],
    ]);
  });
  it("lấy đường từ diff của xemTruoc khi có; trạng thái theo sự kiện da-duyet / bi-bac", () => {
    const xt = { pendingAction: { tool: "apply_diff", args: { path: "lib/z.cs", original: "a", modified: "b" }, preview: { warnings: [] } } };
    const s = chay([BD, cd("a", "edit_file", {}, xt), cd("b", "delete_file", { path: "p" }), { loai: "da-duyet", id: "a" } as SuKienAgent, { loai: "bi-bac", id: "b" } as SuKienAgent]);
    expect(tongQuanThayDoi(s).map((m) => [m.tep, m.trangThai])).toEqual([["lib/z.cs", "da-duyet"], ["p", "bi-bac"]]);
  });
  it("thẻ thiếu đường ⇒ tep rỗng (giao diện nói 'không rõ đường'), không ném", () => {
    expect(tongQuanThayDoi(chay([BD, cd("a", "delete_file", {})]))[0]!.tep).toBe("");
  });
});

describe("ketQuaKiemChung", () => {
  it("chỉ nhận khi hienThi có CẤU TRÚC (xanh boolean); thiếu ⇒ null; lấy lần chạy GẦN NHẤT", () => {
    expect(ketQuaKiemChung(chay([BD, ...lenhXong("t1", { tool: "run_command", lenh: "x" })]))).toBeNull();
    expect(ketQuaKiemChung(chay([BD, ...lenhXong("t1", "văn bản thô: all tests passed")]))).toBeNull();
    expect(ketQuaKiemChung(chay([BD, ...lenhXong("t1", { lenh: "x", xanh: "true" })]))).toBeNull(); // không phải boolean ⇒ không đoán
    expect(ketQuaKiemChung(chay([BD, ...lenhXong("t1", { lenh: "x", xanh: 1 })]))).toBeNull();
    const s = chay([BD, ...lenhXong("t1", { lenh: "npm run check", xanh: false, soDo: 2, soXanh: 5 }), ...lenhXong("t2", { lenh: "npm run check", xanh: true, soDo: 0, soXanh: 7 })]);
    expect(ketQuaKiemChung(s)).toMatchObject({ lenh: "npm run check", xanh: true, soDo: 0, soXanh: 7, hetGio: false, truocThayDoiCuoi: false });
  });
  it("truocThayDoiCuoi: kết quả cũ hơn thay đổi đã DUYỆT gần nhất; thay đổi chỉ chờ/bác không tính", () => {
    const base = [BD, ...lenhXong("t1", { lenh: "c", xanh: true })];
    expect(ketQuaKiemChung(chay([...base, cd("a", "edit_file", { path: "p" }), { loai: "da-duyet", id: "a" } as SuKienAgent]))!.truocThayDoiCuoi).toBe(true);
    expect(ketQuaKiemChung(chay([...base, cd("a", "edit_file", { path: "p" })]))!.truocThayDoiCuoi).toBe(false);
    expect(ketQuaKiemChung(chay([...base, cd("a", "edit_file", { path: "p" }), { loai: "bi-bac", id: "a" } as SuKienAgent]))!.truocThayDoiCuoi).toBe(false);
    expect(ketQuaKiemChung(chay([BD, cd("a", "edit_file", { path: "p" }), { loai: "da-duyet", id: "a" } as SuKienAgent, ...lenhXong("t2", { lenh: "c", xanh: true })]))!.truocThayDoiCuoi).toBe(false);
  });
  it("số âm/NaN ⇒ null (không bịa); lệnh cắt 200 ký tự; hetGio chỉ khi đúng true", () => {
    const s = chay([BD, ...lenhXong("t", { lenh: "x".repeat(500), xanh: false, soDo: -1, soXanh: Number.NaN, hetGio: "true" })]);
    expect(ketQuaKiemChung(s)).toMatchObject({ soDo: null, soXanh: null, hetGio: false });
    expect(ketQuaKiemChung(s)!.lenh.length).toBe(200);
  });
});

describe("tienDoQuyet / chiSoKe / timTheDuyet", () => {
  it("đếm đã quyết (duyệt + bác) và còn chờ; hết hiệu lực không tính là đã quyết", () => {
    expect(
      tienDoQuyet([
        { id: "1", loai: "sua", tep: "a", trangThai: "da-duyet" },
        { id: "2", loai: "sua", tep: "b", trangThai: "bi-bac" },
        { id: "3", loai: "sua", tep: "c", trangThai: "cho" },
        { id: "4", loai: "sua", tep: "d", trangThai: "het-hieu-luc" },
      ]),
    ).toEqual({ tong: 4, daQuyet: 2, conCho: 1 });
  });
  it("chiSoKe: vòng tròn; chưa chọn + J ⇒ 0, + K ⇒ cuối; rỗng ⇒ -1", () => {
    expect(chiSoKe(-1, 3, 1)).toBe(0);
    expect(chiSoKe(-1, 3, -1)).toBe(2);
    expect(chiSoKe(2, 3, 1)).toBe(0);
    expect(chiSoKe(0, 3, -1)).toBe(2);
    expect(chiSoKe(1, 3, 1)).toBe(2);
    expect(chiSoKe(0, 0, 1)).toBe(-1);
    expect(chiSoKe(9, 3, 1)).toBe(0);
  });
  it("timTheDuyet theo id sự kiện; không có ⇒ null", () => {
    const s = chay([BD, cd("a", "edit_file", { path: "p" })]);
    expect(timTheDuyet(s, "a")?.id).toBe("a");
    expect(timTheDuyet(s, "zzz")).toBeNull();
  });
});

describe("thẻ ghi của AGENT CON (11.8 × 11.3-B)", () => {
  const CON = { loai: "con-bat-dau", runIdCon: "c1", agent: "reviewer", nguon: "tuRepo", sau: 1, cheDo: "sua", nhiemVu: "x" } as SuKienAgent;
  const conCD = (id: string, ten: string, thamSo: Record<string, unknown>): SuKienAgent =>
    ({ loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "can-duyet", id, deXuat: { ten, thamSo } } }) as SuKienAgent;

  it("thẻ ghi của con vào danh sách, gắn nhãn con; khoá không đụng id của cha (cùng id 'a')", () => {
    const s = chay([BD, cd("a", "delete_file", { path: "cha.txt" }), CON, conCD("a", "edit_file", { path: "con.ts" })]);
    const ds = tongQuanThayDoi(s);
    expect(ds.map((x) => x.id)).toEqual(["a", khoaTheCon("c1", "a")]);
    expect(ds[0]!.con).toBeUndefined();
    expect(ds[1]).toMatchObject({ loai: "sua", tep: "con.ts", con: { runIdCon: "c1", agent: "reviewer" }, trangThai: "cho" });
  });
  it("thẻ lệnh của con KHÔNG vào danh sách; con không có thẻ ghi ⇒ không thêm gì", () => {
    expect(tongQuanThayDoi(chay([BD, CON, conCD("l", "run_command", { command: "ls" })]))).toEqual([]);
  });
  it("timTheDuyet tìm được thẻ của con bằng khoá kép; id trần của con KHÔNG khớp nhầm", () => {
    const s = chay([BD, CON, conCD("x1", "delete_file", { path: "p" })]);
    expect(timTheDuyet(s, khoaTheCon("c1", "x1"))?.id).toBe("x1");
    expect(timTheDuyet(s, "x1")).toBeNull();
    expect(timTheDuyet(s, khoaTheCon("c2", "x1"))).toBeNull();
  });
  it("tienDoQuyet tính cả thẻ của con (da-duyet của con đếm là đã quyết)", () => {
    const s = chay([BD, cd("a", "delete_file", { path: "p" }), CON, conCD("b", "delete_file", { path: "q" }), { loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "da-duyet", id: "b" } } as SuKienAgent]);
    expect(tienDoQuyet(tongQuanThayDoi(s))).toEqual({ tong: 2, daQuyet: 1, conCho: 1 });
  });
});
