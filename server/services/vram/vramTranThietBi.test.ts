import { describe, it, expect } from "vitest";
import { tranTheoThietBi, apTranThietBi } from "./vramTranThietBi";

const GiB = 1024 ** 3;

describe("tranTheoThietBi — G7 (audit 2026-09-21 · P8)", () => {
  it("★★★ CA THẬT ĐÃ ĐO: card 32.607 MiB, dùng 28.969 MiB ⇒ còn ~3,15 GiB (broker từng khai 22 GiB)", () => {
    const MiB = 1024 ** 2;
    const r = tranTheoThietBi({ totalBytes: 32607 * MiB, usedBytes: 28969 * MiB }, 0);
    expect(r).not.toBeNull();
    expect(r! / GiB).toBeCloseTo(3.55, 1);
  });

  it("★ trừ đệm an toàn", () => {
    const r = tranTheoThietBi({ totalBytes: 10 * GiB, usedBytes: 6 * GiB }, 1 * GiB);
    expect(r).toBe(3 * GiB);
  });

  it("★ KHÔNG kẹp về 0 — đã tiêu quá đệm thì số ÂM là SỰ THẬT", () => {
    expect(tranTheoThietBi({ totalBytes: 10 * GiB, usedBytes: 10 * GiB }, 2 * GiB)).toBe(-2 * GiB);
  });

  it("★ thiếu/hỏng số thiết bị ⇒ null (KHÔNG cap, giữ hành vi cũ)", () => {
    expect(tranTheoThietBi(null, 0)).toBeNull();
    expect(tranTheoThietBi({ totalBytes: null, usedBytes: 1 }, 0)).toBeNull();
    expect(tranTheoThietBi({ totalBytes: 1, usedBytes: null }, 0)).toBeNull();
    expect(tranTheoThietBi({ totalBytes: NaN, usedBytes: 1 }, 0)).toBeNull();
    expect(tranTheoThietBi({ totalBytes: Infinity, usedBytes: 1 }, 0)).toBeNull();
    expect(tranTheoThietBi({ totalBytes: 0, usedBytes: 1 }, 0)).toBeNull();
    expect(tranTheoThietBi({ totalBytes: 10, usedBytes: -1 }, 0)).toBeNull();
  });

  it("★ đệm hỏng/âm ⇒ coi như 0, KHÔNG cộng dư địa", () => {
    expect(tranTheoThietBi({ totalBytes: 10, usedBytes: 4 }, -5)).toBe(6);
    expect(tranTheoThietBi({ totalBytes: 10, usedBytes: 4 }, NaN)).toBe(6);
  });
});

describe("apTranThietBi — HỢP ĐỒNG: chỉ có thể làm NHỎ ĐI", () => {
  it("★★★ CA THẬT: hiệu lực 19,03 GiB nhưng card còn 3,15 GiB ⇒ cắt về 3,15", () => {
    const r = apTranThietBi(19.03 * GiB, 3.15 * GiB);
    expect(r.daCap).toBe(true);
    expect(r.bytes).toBe(3.15 * GiB);
    expect(r.catBotBytes / GiB).toBeCloseTo(15.88, 1);
  });

  it("★ trần rộng hơn ⇒ KHÔNG đụng vào (không bao giờ NỚI)", () => {
    const r = apTranThietBi(2 * GiB, 9 * GiB);
    expect(r).toEqual({ bytes: 2 * GiB, daCap: false, catBotBytes: 0 });
  });

  it("★ trần null (chưa đo được) ⇒ giữ nguyên, hành vi CŨ y hệt", () => {
    expect(apTranThietBi(7 * GiB, null)).toEqual({ bytes: 7 * GiB, daCap: false, catBotBytes: 0 });
  });

  it("★★★ BẤT BIẾN: với MỌI cặp đầu vào, kết quả LUÔN ≤ hiệu lực ban đầu", () => {
    const hl = [-5 * GiB, 0, 1, 3 * GiB, 22 * GiB, 1e15];
    const tr = [null, -9 * GiB, 0, 1, 3 * GiB, 22 * GiB, 1e15, NaN as unknown as number];
    for (const h of hl) {
      for (const t of tr) {
        expect(apTranThietBi(h, t).bytes).toBeLessThanOrEqual(h);
      }
    }
  });

  it("★ trần ÂM vẫn áp (card đã vượt đệm ⇒ mọi lượt xin phải bị từ chối)", () => {
    const r = apTranThietBi(5 * GiB, -2 * GiB);
    expect(r.bytes).toBe(-2 * GiB);
    expect(r.daCap).toBe(true);
  });

  it("★ hiệu lực không hữu hạn ⇒ trả nguyên, không ném", () => {
    expect(apTranThietBi(Number.NEGATIVE_INFINITY, 3).bytes).toBe(Number.NEGATIVE_INFINITY);
  });

  it("★ catBotBytes luôn ≥ 0", () => {
    for (const [h, t] of [[9, 3], [3, 9], [0, 0], [-1, -5]] as const) {
      expect(apTranThietBi(h, t).catBotBytes).toBeGreaterThanOrEqual(0);
    }
  });
});
