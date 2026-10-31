// Đợt 12 / H2 — mảnh thuần dùng chung máy chủ ⇄ extension: bộ đệm ĐẦU+CUỐI và quyết định giết cả cây.
import { describe, expect, it, vi } from "vitest";
import { BoDemDauRa, gietCayTienTrinhChung, type MoGietCay } from "./tienTrinhAnToan";

describe("BoDemDauRa", () => {
  it("ngắn hơn trần đầu ⇒ nguyên văn, không báo cắt", () => {
    const b = new BoDemDauRa(10, 10);
    b.them("abc");
    b.them("def");
    expect(b.ket()).toEqual({ text: "abcdef", boQua: 0 });
    expect(b.catBot).toBe(false);
    expect(b.byteThat).toBe(6);
  });
  it("vượt ⇒ giữ ĐẦU và CUỐI, khai số ký tự bỏ ở giữa", () => {
    const b = new BoDemDauRa(4, 5);
    b.them("0123456789".repeat(100));
    const k = b.ket();
    expect(k.text.startsWith("0123\n")).toBe(true);
    expect(k.text.endsWith("\n56789")).toBe(true);
    expect(k.boQua).toBe(1000 - 4 - 5);
    expect(k.text).toContain("ĐÃ CẮT 991 byte Ở GIỮA");
    expect(b.catBot).toBe(true);
  });
  it("★ chuỗi chia nhiều mảnh nhỏ cho CÙNG kết quả như một mảnh lớn (đầu và cuối không phụ thuộc cách chia)", () => {
    const toanBo = "x".repeat(50) + "LOI-CUOI";
    const a = new BoDemDauRa(6, 8);
    a.them(toanBo);
    const b = new BoDemDauRa(6, 8);
    for (const c of toanBo) b.them(c);
    expect(b.ket()).toEqual(a.ket());
    expect(a.ket().text.endsWith("LOI-CUOI")).toBe(true);
  });
  it("★ bộ nhớ hằng số: nuốt 5 triệu ký tự mà chuỗi giữ lại không vượt đầu+cuối", () => {
    const b = new BoDemDauRa(100, 200);
    const khoi = "a".repeat(50_000);
    for (let i = 0; i < 100; i++) b.them(khoi);
    expect(b.byteThat).toBe(5_000_000);
    expect(b.ket().text.length).toBeLessThan(100 + 200 + 120);
  });
  it("chuỗi rỗng bị bỏ qua", () => {
    const b = new BoDemDauRa(3, 3);
    b.them("");
    expect(b.byteThat).toBe(0);
    expect(b.ket()).toEqual({ text: "", boQua: 0 });
  });
});

const mo = (o: Partial<MoGietCay> = {}): MoGietCay & { taskkill: ReturnType<typeof vi.fn>; tinHieu: ReturnType<typeof vi.fn> } => {
  const taskkill = vi.fn();
  const tinHieu = vi.fn();
  return { windows: false, chayTaskkill: taskkill, guiTinHieu: tinHieu, ...o, taskkill, tinHieu } as never;
};

describe("gietCayTienTrinhChung", () => {
  it("pid không hợp lệ ⇒ khong-co-pid, KHÔNG chạy gì", () => {
    for (const p of [undefined, null, 0, -5, 1.5, Number.NaN, "7" as unknown as number]) {
      const m = mo();
      expect(gietCayTienTrinhChung(p as never, m)).toBe("khong-co-pid");
      expect(m.taskkill).not.toHaveBeenCalled();
      expect(m.tinHieu).not.toHaveBeenCalled();
    }
  });
  it("Windows ⇒ taskkill đúng pid; không gửi tín hiệu", () => {
    const m = mo({ windows: true });
    expect(gietCayTienTrinhChung(4242, m)).toBe("da-ra-lenh");
    expect(m.taskkill).toHaveBeenCalledWith(4242);
    expect(m.tinHieu).not.toHaveBeenCalled();
  });
  it("Windows: taskkill ném ⇒ loi", () => {
    const m = mo({ windows: true, chayTaskkill: () => { throw new Error("x"); } });
    expect(gietCayTienTrinhChung(4242, m)).toBe("loi");
  });
  it("POSIX ⇒ gửi SIGKILL tới pid ÂM (cả nhóm) trước", () => {
    const m = mo();
    expect(gietCayTienTrinhChung(99, m)).toBe("da-ra-lenh");
    expect(m.tinHieu).toHaveBeenCalledTimes(1);
    expect(m.tinHieu).toHaveBeenCalledWith(-99, "SIGKILL");
    expect(m.taskkill).not.toHaveBeenCalled();
  });
  it("POSIX: giết nhóm ném ⇒ rơi về đúng pid; cả hai ném ⇒ loi", () => {
    const goi: number[] = [];
    const m1 = mo({ guiTinHieu: (p) => { goi.push(p); if (p < 0) throw new Error("ESRCH"); } });
    expect(gietCayTienTrinhChung(99, m1)).toBe("da-ra-lenh");
    expect(goi).toEqual([-99, 99]);
    const m2 = mo({ guiTinHieu: () => { throw new Error("EPERM"); } });
    expect(gietCayTienTrinhChung(99, m2)).toBe("loi");
  });
});
