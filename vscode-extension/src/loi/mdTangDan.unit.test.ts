import { describe, expect, it } from "vitest";
import { BoDemMdTangDan, type HenGio } from "./mdTangDan";
import type { NutMd } from "./markdownAnToan";

function dongHoGia() {
  let t = 1000;
  const hen: Array<{ id: number; tai: number; fn: () => void }> = [];
  let dem = 0;
  const dh: HenGio = {
    now: () => t,
    datHen: (fn, ms) => {
      const id = ++dem;
      hen.push({ id, tai: t + ms, fn });
      return id;
    },
    huyHen: (h) => {
      const i = hen.findIndex((x) => x.id === h);
      if (i >= 0) hen.splice(i, 1);
    },
  };
  return {
    dh,
    tien(ms: number) {
      t += ms;
      for (const h of [...hen].sort((a, b) => a.tai - b.tai)) if (h.tai <= t) { hen.splice(hen.indexOf(h), 1); h.fn(); }
    },
    soHen: () => hen.length,
  };
}
const phanTichGia = (md: string): NutMd[] => [{ t: "p", con: [{ t: "text", chu: md }] }];
const chuCua = (c: NutMd[]) => ((c[0] as { con: Array<{ chu: string }> }).con[0]!.chu);

describe("BoDemMdTangDan — tiết lưu + luôn gửi bản cuối", () => {
  it("★ lần ĐẦU gửi NGAY; các mảnh dồn dập sau đó GỘP, và bản MỚI NHẤT luôn được gửi cuối nhịp", () => {
    const d = dongHoGia();
    const ra: string[] = [];
    const b = new BoDemMdTangDan((c) => ra.push(chuCua(c)), 100, d.dh, phanTichGia);
    b.capNhat("a");
    expect(ra).toEqual(["a"]);
    b.capNhat("ab");
    b.capNhat("abc");
    b.capNhat("abcd");
    expect(ra).toEqual(["a"]); // đang trong nhịp: chưa gửi thêm
    d.tien(100);
    expect(ra).toEqual(["a", "abcd"]); // một lần duy nhất, với bản mới nhất
  });
  it("★ sau một khoảng lặng dài, mảnh kế tiếp lại gửi NGAY (không trễ vô ích)", () => {
    const d = dongHoGia();
    const ra: string[] = [];
    const b = new BoDemMdTangDan((c) => ra.push(chuCua(c)), 100, d.dh, phanTichGia);
    b.capNhat("x");
    d.tien(500);
    b.capNhat("xy");
    expect(ra).toEqual(["x", "xy"]);
  });
  it("★ dung() huỷ hẹn giờ treo: KHÔNG gửi thêm sau khi lượt kết thúc/huỷ", () => {
    const d = dongHoGia();
    const ra: string[] = [];
    const b = new BoDemMdTangDan((c) => ra.push(chuCua(c)), 100, d.dh, phanTichGia);
    b.capNhat("a");
    b.capNhat("ab");
    expect(d.soHen()).toBe(1);
    b.dung();
    expect(d.soHen()).toBe(0);
    d.tien(1000);
    expect(ra).toEqual(["a"]); // hẹn giờ treo đã bị huỷ — không có bản "ab" trễ
    b.capNhat("abc"); // khối kế tiếp bắt đầu lại, gửi NGAY
    expect(ra).toEqual(["a", "abc"]);
  });
  it("văn bản rỗng/khoảng trắng ⇒ không gửi cây rỗng; gửi lỗi (ném) ⇒ nuốt, không làm hỏng lượt", () => {
    const d = dongHoGia();
    const ra: string[] = [];
    const b = new BoDemMdTangDan((c) => { ra.push(chuCua(c)); throw new Error("webview đóng"); }, 100, d.dh, phanTichGia);
    b.capNhat("   ");
    expect(ra).toEqual([]);
    expect(() => b.capNhat("ok")).not.toThrow();
    expect(ra).toEqual(["ok"]);
  });
  it("★ với bộ phân tích THẬT: khối mã chưa đóng và đoạn dở dang vẫn dựng được (không ném)", async () => {
    const { phanTichMarkdown } = await import("./markdownAnToan");
    const d = dongHoGia();
    let cuoi: NutMd[] = [];
    const b = new BoDemMdTangDan((c) => (cuoi = c), 50, d.dh, phanTichMarkdown);
    b.capNhat("### Tiêu đề\n\nMột **đậm** và\n\n```bash\nnpm in");
    const loai = cuoi.map((n) => n.t);
    expect(loai).toContain("h");
    expect(loai).toContain("code");
  });
});
