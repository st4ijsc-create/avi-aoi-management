import { describe, expect, it } from "vitest";
import {
  anDuoc,
  apDaAn,
  demViec,
  locVaSap,
  nhomNangNhat,
  tachAnToan,
  type MucViec,
} from "./daiHopNhatLogic";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Lưới cho DẢI TRẠNG THÁI HỢP NHẤT (§13b 14.4)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ G5/G32 — mỗi lưới ở đây hỏi **đầu ra có KHÁC đầu vào không**, và mọi ca
 *   ÂM đều đi kèm một ca DƯƠNG trên CÙNG dữ liệu. Lý do: một hàm trả mảng rỗng
 *   với mọi đầu vào sẽ làm mọi khẳng định "không thấy X" thành XANH mà không đo
 *   gì — đúng bốn luật cùng họ G5/G6/G7/G10 đã ghi ở sổ (đo trên tập rỗng).
 */

/** Bộ mẫu: 6 mục, 5 bật (1 an toàn + 2 dữ liệu + 2 phạm vi), 1 tắt. */
function mau(): MucViec[] {
  return [
    { testId: "banner-ha-cap", nhom: "phamVi", hien: true, noiDung: "ha cap" },
    { testId: "canh-bao-estop", nhom: "anToan", hien: true, noiDung: "E-STOP" },
    { testId: "banner-doi-soat", nhom: "duLieu", hien: true, noiDung: "doi soat" },
    { testId: "banner-link-bi-bo-qua", nhom: "phamVi", hien: true, noiDung: "link cu" },
    { testId: "bang-ket-qua-xuat-usd", nhom: "duLieu", hien: false, noiDung: "usd" },
    { testId: "banner-ngoai-luot-nap", nhom: "duLieu", hien: true, noiDung: "373 may" },
  ];
}

describe("locVaSap — lọc mục đang bật rồi sắp theo nhóm", () => {
  it("★ ca DƯƠNG: 5/6 mục bật ⇒ trả đúng 5, và mục tắt KHÔNG lọt", () => {
    const ra = locVaSap(mau());
    expect(ra).toHaveLength(5);
    expect(ra.map((m) => m.testId)).not.toContain("bang-ket-qua-xuat-usd");
  });

  it("★★★ thứ tự NGHIÊM NGẶT: anToan → duLieu → phamVi", () => {
    // Đầu vào cố tình đảo lộn (phamVi đứng đầu) để phép sắp phải LÀM VIỆC.
    const ra = locVaSap(mau()).map((m) => m.nhom);
    expect(ra[0]).toBe("anToan");
    expect(ra.slice(1, 3)).toEqual(["duLieu", "duLieu"]);
    expect(ra.slice(3)).toEqual(["phamVi", "phamVi"]);
    // ★ G5 — đầu ra KHÁC đầu vào: nếu hàm trả nguyên mảng thì mục đầu là phamVi.
    expect(ra[0]).not.toBe(mau()[0].nhom);
  });

  it("★ ca ÂM: 0 mục bật ⇒ rỗng (dải KHÔNG chiếm 26 px khi im lặng)", () => {
    expect(locVaSap(mau().map((m) => ({ ...m, hien: false })))).toHaveLength(0);
  });

  it("KHÔNG làm biến dạng mảng gọi (sort tại chỗ là lỗi ẩn)", () => {
    const vao = mau();
    const truoc = vao.map((m) => m.testId).join(",");
    locVaSap(vao);
    expect(vao.map((m) => m.testId).join(",")).toBe(truoc);
  });
});

describe("★★★ G9 — demViec đếm MỤC đang bật, không đếm LOẠI mục", () => {
  it("6 loại khai báo · 5 bật ⇒ đếm ra 5, KHÔNG ra 6", () => {
    expect(demViec(mau())).toBe(5);
  });

  it("★ ca phân biệt: tắt thêm 2 mục ⇒ số PHẢI giảm còn 3", () => {
    const it3 = mau().map((m) =>
      m.testId === "banner-ha-cap" || m.testId === "banner-link-bi-bo-qua"
        ? { ...m, hien: false }
        : m,
    );
    expect(demViec(it3)).toBe(3);
    // ★ G5/G32 — hai đầu vào khác nhau PHẢI cho hai đầu ra khác nhau. Một hàm
    //   trả hằng số (ví dụ `muc.length`) sẽ ra 6 ở cả hai ca và lọt lưới trên.
    expect(demViec(it3)).not.toBe(demViec(mau()));
  });

  it("mảng rỗng ⇒ 0", () => {
    expect(demViec([])).toBe(0);
  });
});

describe("★★★ LUẬT CỨNG 1 — tachAnToan: an toàn KHÔNG BAO GIỜ bị gộp", () => {
  it("E-STOP đang bật ⇒ nằm ở `anToan`, TUYỆT ĐỐI không ở `gopDuoc`", () => {
    const { anToan, gopDuoc } = tachAnToan(mau());
    expect(anToan.map((m) => m.testId)).toEqual(["canh-bao-estop"]);
    expect(gopDuoc.map((m) => m.testId)).not.toContain("canh-bao-estop");
  });

  it("★★★ đối chiếu TỔNG: hai mảng RỜI NHAU và phủ hết (khuôn BG-127)", () => {
    const v = mau();
    const { anToan, gopDuoc } = tachAnToan(v);
    // Không tin vào bộ lọc — đếm tổng và so với phép đếm ĐỘC LẬP.
    expect(anToan.length + gopDuoc.length).toBe(locVaSap(v).length);
    expect(anToan.length + gopDuoc.length).toBe(demViec(v));
    const chung = anToan.filter((a) => gopDuoc.some((g) => g.testId === a.testId));
    expect(chung, "hai mang phai roi nhau").toHaveLength(0);
  });

  it("★ ca ÂM có đối chứng DƯƠNG: KHÔNG E-STOP ⇒ `anToan` rỗng mà `gopDuoc` VẪN có mục", () => {
    const khongEstop = mau().map((m) => (m.nhom === "anToan" ? { ...m, hien: false } : m));
    const { anToan, gopDuoc } = tachAnToan(khongEstop);
    expect(anToan).toHaveLength(0);
    // ★ Nếu thiếu dòng dưới, một hàm trả `{anToan:[],gopDuoc:[]}` cũng XANH.
    expect(gopDuoc.length, "ca duong: cac muc khac VAN phai con").toBe(4);
  });
});

describe("nhomNangNhat — màu của dải khi THU", () => {
  it("có E-STOP ⇒ `anToan`", () => {
    expect(nhomNangNhat(mau())).toBe("anToan");
  });

  it("không E-STOP nhưng còn dữ liệu ⇒ `duLieu` (KHÁC ca trên)", () => {
    const v = mau().map((m) => (m.nhom === "anToan" ? { ...m, hien: false } : m));
    expect(nhomNangNhat(v)).toBe("duLieu");
    expect(nhomNangNhat(v)).not.toBe(nhomNangNhat(mau()));
  });

  it("★★★ im lặng ⇒ `null`, KHÔNG phải một nhóm mặc định", () => {
    // Trả một nhóm mặc định ở đây làm dải luôn chiếm 26 px — đúng thứ đợt này
    // đi chữa, và không lỗi nào nổ.
    expect(nhomNangNhat(mau().map((m) => ({ ...m, hien: false })))).toBeNull();
  });
});

describe("★★★ LUẬT CỨNG 3 — [ẩn] không giấu được AN TOÀN", () => {
  it("anDuoc: nhóm anToan ⇒ false; hai nhóm kia ⇒ true", () => {
    expect(anDuoc({ testId: "x", nhom: "anToan", hien: true, noiDung: "" })).toBe(false);
    expect(anDuoc({ testId: "x", nhom: "duLieu", hien: true, noiDung: "" })).toBe(true);
    expect(anDuoc({ testId: "x", nhom: "phamVi", hien: true, noiDung: "" })).toBe(true);
  });

  it("★★★ apDaAn: ẩn CẢ HAI khoá ⇒ mục dữ liệu tắt, mục AN TOÀN VẪN BẬT", () => {
    const daAn = new Set(["canh-bao-estop", "banner-doi-soat"]);
    const ra = apDaAn(mau(), daAn);
    const estop = ra.find((m) => m.testId === "canh-bao-estop")!;
    const doiSoat = ra.find((m) => m.testId === "banner-doi-soat")!;
    expect(estop.hien, "E-STOP KHONG duoc an").toBe(true);
    // ★ Ca DƯƠNG bắt buộc: nếu `apDaAn` không làm gì cả, dòng trên vẫn xanh.
    expect(doiSoat.hien, "muc du lieu PHAI bi an").toBe(false);
    expect(demViec(ra)).toBe(4);
  });

  it("tập ẩn rỗng ⇒ không đổi gì (đầu ra = đầu vào về mặt `hien`)", () => {
    const ra = apDaAn(mau(), new Set());
    expect(ra.map((m) => m.hien)).toEqual(mau().map((m) => m.hien));
  });
});
