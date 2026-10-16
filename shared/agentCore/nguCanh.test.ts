import { describe, expect, it } from "vitest";
import { catDauDuoi, nenLichSu, uocLuongTinNhan, uocLuongTokenMacDinh } from "./nguCanh";
import type { TinNhan } from "./kieu";

const demKyTu = (s: string) => s.length; // ước lượng tiêm: 1 ký tự = 1 token cho dễ tính

function luotTool(i: number, ten: string, duong: string, noiDung: string): TinNhan[] {
  return [
    {
      role: "assistant",
      content: `buoc ${i}`,
      tool_calls: [{ id: `c${i}`, type: "function", function: { name: ten, arguments: JSON.stringify({ path: duong }) } }],
    },
    { role: "tool", tool_call_id: `c${i}`, name: ten, content: noiDung },
  ];
}

describe("uocLuongTokenMacDinh", () => {
  it("2,8 ký tự / token, làm tròn lên, nguyên", () => {
    expect(uocLuongTokenMacDinh("")).toBe(0);
    expect(uocLuongTokenMacDinh("a")).toBe(1);
    expect(uocLuongTokenMacDinh("x".repeat(28))).toBe(10);
    expect(uocLuongTokenMacDinh("x".repeat(29))).toBe(11);
  });
});

describe("catDauDuoi", () => {
  it("ngắn hơn trần ⇒ nguyên văn", () => {
    expect(catDauDuoi("abc", 10)).toBe("abc");
  });

  it("dài ⇒ giữ đầu + đuôi, báo số ký tự bị cắt, không vượt trần quá dấu cắt", () => {
    const s = "D".repeat(500) + "M".repeat(10_000) + "T".repeat(500);
    const r = catDauDuoi(s, 1000);
    expect(r.startsWith("D".repeat(400))).toBe(true);
    expect(r.endsWith("T".repeat(400))).toBe(true);
    expect(r).toMatch(/10[\s.,]?000 chars? (omitted|cut)/);
    expect(r.length).toBeLessThanOrEqual(1100);
  });
});

describe("nenLichSu", () => {
  const he: TinNhan = { role: "system", content: "SYS" };
  const hoi: TinNhan = { role: "user", content: "CAU HOI GOC" };

  it("dưới 70 % ngân sách ⇒ không đổi", () => {
    const ds = [he, hoi, ...luotTool(1, "read_file", "a.ts", "x".repeat(100))];
    const r = nenLichSu(ds, { nganSachToken: 10_000, uocLuong: demKyTu });
    expect(r.soNen).toBe(0);
    expect(r.tinNhan).toEqual(ds);
  });

  it("> 70 % ⇒ rút gọn kết quả tool CŨ (cũ nhất trước), giữ nguyên 2 lượt gần nhất, system và câu hỏi gốc", () => {
    const ds = [
      he,
      hoi,
      ...luotTool(1, "read_file", "src/mot.ts", "1".repeat(3000)),
      ...luotTool(2, "grep", "src", "2".repeat(3000)),
      ...luotTool(3, "read_file", "src/ba.ts", "3".repeat(3000)),
      ...luotTool(4, "read_file", "src/bon.ts", "4".repeat(3000)),
    ];
    const r = nenLichSu(ds, { nganSachToken: 10_000, uocLuong: demKyTu });
    expect(r.tokenTruoc).toBeGreaterThan(7000);
    expect(r.tokenSau).toBeLessThanOrEqual(7000);
    expect(r.tinNhan[0]).toEqual(he);
    expect(r.tinNhan[1]).toEqual(hoi);
    // lượt 1 bị rút gọn với tên tool + đường + số ký tự
    const t1 = r.tinNhan.find((m) => m.role === "tool" && m.tool_call_id === "c1")!;
    expect(t1.content).toMatch(/compacted/);
    expect(t1.content).toContain("read_file");
    expect(t1.content).toContain("src/mot.ts");
    expect(t1.content).toContain("3000");
    // 2 lượt gần nhất nguyên văn
    expect(r.tinNhan.find((m) => m.tool_call_id === "c3")!.content).toBe("3".repeat(3000));
    expect(r.tinNhan.find((m) => m.tool_call_id === "c4")!.content).toBe("4".repeat(3000));
    // tool_call_id vẫn khớp, số tin nhắn không đổi (rút gọn, không xoá)
    expect(r.tinNhan).toHaveLength(ds.length);
    // không đột biến đầu vào
    expect(ds[3].content).toBe("1".repeat(3000));
  });

  it("chỉ rút gọn vừa đủ: dừng khi đã dưới ngưỡng (lượt 2 còn nguyên nếu lượt 1 đủ)", () => {
    const ds = [
      he,
      hoi,
      ...luotTool(1, "read_file", "a", "1".repeat(4000)),
      ...luotTool(2, "read_file", "b", "2".repeat(500)),
      ...luotTool(3, "read_file", "c", "3".repeat(1500)),
      ...luotTool(4, "read_file", "d", "4".repeat(1500)),
    ];
    const r = nenLichSu(ds, { nganSachToken: 10_000, uocLuong: demKyTu });
    expect(r.soNen).toBe(1);
    expect(r.tinNhan.find((m) => m.tool_call_id === "c2")!.content).toBe("2".repeat(500));
  });

  it("câu hỏi gốc và system KHÔNG bao giờ bị đụng kể cả khi chúng tự vượt ngân sách", () => {
    const heDai: TinNhan = { role: "system", content: "S".repeat(9000) };
    const ds = [heDai, hoi, ...luotTool(1, "read_file", "a", "1".repeat(3000))];
    const r = nenLichSu(ds, { nganSachToken: 10_000, uocLuong: demKyTu });
    expect(r.tinNhan[0]).toEqual(heDai);
    expect(r.tinNhan[1]).toEqual(hoi);
  });

  it("ước lượng mặc định = 2,8 ký tự/token khi không tiêm", () => {
    const ds = [he, hoi];
    expect(uocLuongTinNhan(ds)).toBe(uocLuongTinNhan(ds, uocLuongTokenMacDinh));
  });

  it("ước lượng có tính cả arguments của tool_calls", () => {
    const a: TinNhan[] = [{ role: "assistant", content: "" }];
    const b: TinNhan[] = [
      { role: "assistant", content: "", tool_calls: [{ id: "x", type: "function", function: { name: "n", arguments: "y".repeat(100) } }] },
    ];
    expect(uocLuongTinNhan(b, demKyTu) - uocLuongTinNhan(a, demKyTu)).toBeGreaterThanOrEqual(100);
  });
});
