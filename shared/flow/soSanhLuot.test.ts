/**
 * Đợt 9.2 — so sánh hai lượt chạy (THUẦN): khớp bước theo `nodeId#lan` (lấy lần thử cuối) · khác trạng thái · khác thời gian ·
 * khác vào/ra theo ĐƯỜNG DẪN JSON · bước chỉ có một bên · dữ liệu bị cắt không đoán bừa.
 */
import { describe, expect, it } from "vitest";
import { khacJson, soSanhLuot, type LuotTho } from "./soSanhLuot";

const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const buoc = (nodeId: string, o: Partial<LuotTho["buoc"][number]> = {}): LuotTho["buoc"][number] => ({
  nodeId, lan: 1, lanThu: 1, status: "xong", startedAt: t(0), finishedAt: t(1), input: { main: [{ json: { a: 1 } }] }, output: { main: [{ json: { a: 1 } }] }, error: null, ...o,
});
const luot = (id: string, buocs: LuotTho["buoc"], run: Partial<LuotTho["run"]> = {}): LuotTho => ({
  run: { id, version: 1, status: "xong", startedAt: t(0), finishedAt: t(5), ...run },
  buoc: buocs,
});

describe("khacJson", () => {
  it("giống nhau ⇒ rỗng; đổi/thêm/bỏ ⇒ đường dẫn có chỉ số mảng", () => {
    expect(khacJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual({ muc: [], catBot: false, bi: false });
    const r = khacJson({ a: [1, { b: 2 }], x: 1 }, { a: [1, { b: 3 }], y: 2 });
    expect(r.muc).toEqual(
      expect.arrayContaining([
        { duong: "$.a[1].b", loai: "doi", a: 2, b: 3 },
        { duong: "$.x", loai: "bo", a: 1, b: undefined },
        { duong: "$.y", loai: "them", a: undefined, b: 2 },
      ]),
    );
  });
  it("khác kiểu / null ≠ vắng; thứ tự khoá không quan trọng", () => {
    expect(khacJson({ a: 1, b: 2 }, { b: 2, a: 1 }).muc).toEqual([]);
    expect(khacJson({ a: null }, {}).muc).toEqual([{ duong: "$.a", loai: "bo", a: null, b: undefined }]);
    expect(khacJson("1", 1).muc[0]).toMatchObject({ duong: "$", loai: "doi" });
  });
  it("dữ liệu bị cắt (__catBot) ở một bên ⇒ catBot=true và KHÔNG khẳng định giống/khác từng trường", () => {
    const r = khacJson({ __catBot: true, kichThuoc: 9000, dau: "{" }, { main: [] });
    expect(r.catBot).toBe(true);
  });
  it("trần số mục: quá nhiều ⇒ cắt và bi=true", () => {
    const a = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
    const b = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i + 1]));
    const r = khacJson(a, b, 50);
    expect(r.muc).toHaveLength(50);
    expect(r.bi).toBe(true);
  });
  it("không tuần hoàn vô hạn: độ sâu quá lớn ⇒ coi là bi", () => {
    let a: Record<string, unknown> = { v: 1 };
    let b: Record<string, unknown> = { v: 2 };
    for (let i = 0; i < 100; i++) {
      a = { n: a };
      b = { n: b };
    }
    expect(khacJson(a, b).bi).toBe(true);
  });
});

describe("soSanhLuot", () => {
  it("hai lượt y hệt ⇒ mọi bước 'giong', tóm tắt 0 khác", () => {
    const x = luot("A", [buoc("n1"), buoc("n2")]);
    const y = luot("B", [buoc("n1"), buoc("n2")]);
    const r = soSanhLuot(x, y);
    expect(r.cacBuoc.map((b) => b.ket)).toEqual(["giong", "giong"]);
    expect(r.tomTat).toMatchObject({ giong: 2, khac: 0, chiA: 0, chiB: 0 });
    expect(r.khacPhienBan).toBe(false);
  });

  it("khác trạng thái + lỗi + đầu ra + thời gian", () => {
    const x = luot("A", [buoc("n1", { finishedAt: t(1) }), buoc("n2", { output: { main: [{ json: { v: 1 } }] } })]);
    const y = luot("B", [buoc("n1", { finishedAt: t(4) }), buoc("n2", { status: "loi", output: null, error: { message: "hỏng" } })], { status: "loi" });
    const r = soSanhLuot(x, y);
    const n1 = r.cacBuoc.find((b) => b.nodeId === "n1")!;
    const n2 = r.cacBuoc.find((b) => b.nodeId === "n2")!;
    expect(n1).toMatchObject({ ket: "giong", msA: 1000, msB: 4000, chenhMs: 3000 });
    expect(n2.ket).toBe("khac");
    expect(n2.khacTrangThai).toBe(true);
    expect(n2.khacLoi.muc.length).toBeGreaterThan(0);
    expect(n2.khacRa.muc.length).toBeGreaterThan(0);
    expect(r.tomTat).toMatchObject({ giong: 1, khac: 1 });
    expect(r.khacTrangThaiLuot).toBe(true);
  });

  it("khác đầu vào ⇒ chỉ ra đường dẫn; bước chỉ có một bên; khác phiên bản", () => {
    const x = luot("A", [buoc("n1"), buoc("chiA")], { version: 1 });
    const y = luot("B", [buoc("n1", { input: { main: [{ json: { a: 2 } }] } }), buoc("chiB")], { version: 2 });
    const r = soSanhLuot(x, y);
    expect(r.cacBuoc.find((b) => b.nodeId === "n1")!.khacVao.muc[0]).toMatchObject({ duong: "$.main[0].json.a", a: 1, b: 2 });
    expect(r.cacBuoc.find((b) => b.nodeId === "chiA")!.ket).toBe("chi-a");
    expect(r.cacBuoc.find((b) => b.nodeId === "chiB")!.ket).toBe("chi-b");
    expect(r.khacPhienBan).toBe(true);
    expect(r.tomTat).toMatchObject({ chiA: 1, chiB: 1, khac: 1 });
  });

  it("nhiều lần thử cùng nodeId#lan ⇒ lấy lần thử CUỐI; lan khác nhau là bước khác nhau", () => {
    const x = luot("A", [buoc("n1", { lanThu: 1, status: "loi" }), buoc("n1", { lanThu: 2 }), buoc("n1", { lan: 2 })]);
    const y = luot("B", [buoc("n1", { lanThu: 1 }), buoc("n1", { lan: 2 })]);
    const r = soSanhLuot(x, y);
    expect(r.cacBuoc).toHaveLength(2);
    expect(r.cacBuoc.map((b) => b.ket)).toEqual(["giong", "giong"]);
  });

  it("bước đang chạy (chưa có finishedAt) ⇒ thời gian null, không NaN", () => {
    const r = soSanhLuot(luot("A", [buoc("n1", { finishedAt: null })]), luot("B", [buoc("n1")]));
    expect(r.cacBuoc[0].msA).toBeNull();
    expect(r.cacBuoc[0].chenhMs).toBeNull();
  });
});
