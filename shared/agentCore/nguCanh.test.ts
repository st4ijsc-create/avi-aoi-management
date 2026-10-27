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

describe("★ Đợt 11.0 (rà kiem-dinh) — suy luận giữ trong lịch sử (`reasoning_content`)", () => {
  it("ước lượng CỘNG suy luận (bỏ sót ⇒ lõi tưởng còn chỗ trong khi llama-server đã vượt ctx)", () => {
    const co: TinNhan[] = [{ role: "assistant", content: "ab", reasoning_content: "x".repeat(100) }];
    const khong: TinNhan[] = [{ role: "assistant", content: "ab" }];
    expect(uocLuongTinNhan(co, demKyTu) - uocLuongTinNhan(khong, demKyTu)).toBe(100);
  });

  const luot = (i: number, nghi: string, kq: string): TinNhan[] => {
    const [a, t] = luotTool(i, "read_file", `f${i}.ts`, kq);
    return [{ ...a, reasoning_content: nghi }, t];
  };
  /** 4 lượt × (nghĩ 400 + kết quả tool 300); tổng ước (1 ký tự = 1 token) ≈ 2,97k. Chỉ số: assistant 2/4/6/8, tool 3/5/7/9. */
  const bonLuot = (): TinNhan[] => [
    { role: "system", content: "s" },
    { role: "user", content: "hỏi" },
    ...luot(1, "n".repeat(400), "k".repeat(300)),
    ...luot(2, "m".repeat(400), "j".repeat(300)),
    ...luot(3, "p".repeat(400), "q".repeat(300)),
    ...luot(4, "r".repeat(400), "z".repeat(300)),
  ];

  it("vượt ngưỡng ⇒ bỏ suy luận lượt CŨ (cũ nhất trước) TRƯỚC khi rút gọn kết quả tool; vùng giữ (2 lượt cuối) nguyên văn; không đột biến đầu vào", () => {
    const ds = bonLuot();
    const truoc = JSON.stringify(ds);
    // ngưỡng 70 % × 3500 = 2450; tổng ≈ 2,97k ⇒ bỏ nghĩ lượt 1 (−400) + lượt 2 (−400) là đủ — KHÔNG đụng kết quả tool
    const kq = nenLichSu(ds, { nganSachToken: 3500, uocLuong: demKyTu });
    expect(JSON.stringify(ds)).toBe(truoc);
    expect(kq.soNen).toBe(2);
    expect(kq.tinNhan[2]).not.toHaveProperty("reasoning_content");
    expect(kq.tinNhan[4]).not.toHaveProperty("reasoning_content");
    expect(kq.tinNhan.filter((m) => m.role === "tool").every((m) => !m.content.startsWith("[compacted:"))).toBe(true);
    expect(kq.tinNhan[6]!.reasoning_content).toBe("p".repeat(400));
    expect(kq.tinNhan[8]!.reasoning_content).toBe("r".repeat(400));
    expect(kq.tokenSau).toBe(uocLuongTinNhan(kq.tinNhan, demKyTu));
    expect(kq.tokenSau).toBeLessThanOrEqual(2450);
  });

  it("rà kiem-dinh — vượt NHẸ ⇒ chỉ bỏ nghĩ của lượt CŨ NHẤT, dừng ngay khi dưới ngưỡng (lượt cũ khác còn nguyên)", () => {
    // ngưỡng 70 % × 4000 = 2800; tổng ≈ 2,97k ⇒ bỏ nghĩ lượt 1 (−400) là đủ
    const kq = nenLichSu(bonLuot(), { nganSachToken: 4000, uocLuong: demKyTu });
    expect(kq.soNen).toBe(1);
    expect(kq.tinNhan[2]).not.toHaveProperty("reasoning_content");
    expect(kq.tinNhan[4]!.reasoning_content).toBe("m".repeat(400));
    expect(kq.tokenSau).toBe(kq.tokenTruoc - 400);
  });

  it("rà kiem-dinh — vượt NẶNG (bỏ hết nghĩ cũ + rút gọn tool cũ vẫn chưa đủ) ⇒ VÙNG GIỮ 2 lượt cuối vẫn còn nghĩ + kết quả tool nguyên văn", () => {
    // ngưỡng 70 % × 2000 = 1400 — không thể đạt nếu không đụng vùng giữ ⇒ phải dừng ở ranh giới, không lấn vào
    const kq = nenLichSu(bonLuot(), { nganSachToken: 2000, uocLuong: demKyTu });
    expect(kq.tokenSau).toBeGreaterThan(1400);
    expect(kq.tinNhan[2]).not.toHaveProperty("reasoning_content");
    expect(kq.tinNhan[4]).not.toHaveProperty("reasoning_content");
    expect(kq.tinNhan[3]!.content.startsWith("[compacted:")).toBe(true);
    expect(kq.tinNhan[5]!.content.startsWith("[compacted:")).toBe(true);
    expect(kq.tinNhan[6]!.reasoning_content).toBe("p".repeat(400));
    expect(kq.tinNhan[8]!.reasoning_content).toBe("r".repeat(400));
    expect(kq.tinNhan[7]!.content).toBe("q".repeat(300));
    expect(kq.tinNhan[9]!.content).toBe("z".repeat(300));
    expect(kq.soNen).toBe(4);
  });
});
