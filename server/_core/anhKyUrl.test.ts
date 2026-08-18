/**
 * Lưới cho **URL ảnh ký HMAC** (`server/_core/anhKyUrl.ts`).
 *
 * ⚠ Mọi ca ở đây đều **tất định theo `nowMs` truyền tay** — không một ca nào phụ thuộc đồng hồ
 *   thật. Một lưới hạn-dùng mà chờ `setTimeout` là một lưới chậm VÀ lung lay.
 *
 * ⚠ §4 và §5 là hai ca **cầu chì**: chúng phát biểu rằng ô `pv` (mục) và phép so hạn có tải trọng
 *   THẬT. Gỡ phép so mục ⇒ §4 đỏ; gỡ phép so hạn ⇒ §5 đỏ. Bằng chứng đột biến đã ăn nằm trong báo
 *   cáo của lượt này.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  duongDanChuanHoa,
  hanKySeconds,
  kiemChuKyAnh,
  kyDuongDanAnh,
  kyNeuLaDuongDanNoiBo,
} from "./anhKyUrl";

/** Tách `?exp=&pv=&sig=` của một URL đã ký thành object query như express dựng. */
function queryCua(url: string): { exp?: string; pv?: string; sig?: string } {
  const q = url.split("?")[1] ?? "";
  const out: Record<string, string> = {};
  for (const cap of q.split("&")) {
    const [k, v] = cap.split("=");
    if (k) out[k] = decodeURIComponent(v ?? "");
  }
  return out;
}

function duongDanCua(url: string): string {
  return url.split("?")[0] ?? "";
}

const T0 = 1_700_000_000_000; // mốc thời gian cố định (ms)

describe("anhKyUrl — vé ảnh ký HMAC", () => {
  beforeEach(() => {
    process.env.ANH_KY_SECRET = "bi-mat-cho-luoi-nay-khong-dung-o-dau-khac";
    delete process.env.ANH_KY_TTL_SECONDS;
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§1 — vé vừa cấp, đúng đường dẫn, đúng mục ⇒ HỢP LỆ (chiều DƯƠNG)", () => {
    const dd = "/uploads/inspections/142/R105.jpg";
    const url = kyDuongDanAnh(dd, "anh", T0);

    expect(duongDanCua(url)).toBe(dd);
    const kq = kiemChuKyAnh(dd, queryCua(url), "anh", T0 + 1000);
    expect(kq).toEqual({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§2 — ĐỔI ĐƯỜNG DẪN mà giữ nguyên chữ ký ⇒ TỪ CHỐI", () => {
    // Đây là lượt tấn công thực tế: cầm một vé hợp lệ của ảnh mình ĐƯỢC xem, đổi đường dẫn sang
    // ảnh của nhà máy khác. Nếu chữ ký không phủ đường dẫn thì một vé mở được TOÀN BỘ kho ảnh.
    const url = kyDuongDanAnh("/uploads/inspections/142/R105.jpg", "anh", T0);
    const kq = kiemChuKyAnh("/uploads/inspections/999/BIMAT.jpg", queryCua(url), "anh", T0 + 1000);
    expect(kq).toEqual({ ok: false, lyDo: "sai-chu-ky" });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§3 — NỚI `exp` ra tương lai mà giữ chữ ký cũ ⇒ TỪ CHỐI", () => {
    // `exp` nằm TRONG chuỗi được ký, nên tự gia hạn phải làm chữ ký trượt.
    const dd = "/uploads/inspections/142/R105.jpg";
    const url = kyDuongDanAnh(dd, "anh", T0);
    const q = queryCua(url);
    const noiRong = { ...q, exp: String(Number(q.exp) + 86_400) };

    const kq = kiemChuKyAnh(dd, noiRong, "anh", T0 + 1000);
    expect(kq).toEqual({ ok: false, lyDo: "sai-chu-ky" });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§4 — CẦU CHÌ: vé mục `anh` gõ vào cổng mục `zip` ⇒ TỪ CHỐI (`sai-muc`)", () => {
    // Ô `pv` phải có tải trọng. Vé còn hạn, chữ ký đúng tuyệt đối, chỉ sai MỤC — vẫn phải chặn.
    const dd = "/api/aoi/download/PKG-001";
    const veAnh = kyDuongDanAnh(dd, "anh", T0);

    const kq = kiemChuKyAnh(dd, queryCua(veAnh), "zip", T0 + 1000);
    expect(kq).toEqual({ ok: false, lyDo: "sai-muc" });

    // …và chiều ngược lại cũng thế, để ca này không thoả được bằng một hằng số.
    const veZip = kyDuongDanAnh(dd, "zip", T0);
    expect(kiemChuKyAnh(dd, queryCua(veZip), "anh", T0 + 1000)).toEqual({
      ok: false,
      lyDo: "sai-muc",
    });
    // Chiều DƯƠNG: đúng mục thì qua.
    expect(kiemChuKyAnh(dd, queryCua(veZip), "zip", T0 + 1000)).toEqual({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§5 — CẦU CHÌ: vé HẾT HẠN ⇒ TỪ CHỐI, dù chữ ký đúng tuyệt đối", () => {
    process.env.ANH_KY_TTL_SECONDS = "60";
    const dd = "/uploads/inspections/142/R105.jpg";
    const url = kyDuongDanAnh(dd, "anh", T0);

    // Ngay trước hạn: còn sống (chiều DƯƠNG — chống "vá quá tay thành chặn tất cả").
    expect(kiemChuKyAnh(dd, queryCua(url), "anh", T0 + 59_000)).toEqual({ ok: true });
    // Một giây sau hạn: chết.
    expect(kiemChuKyAnh(dd, queryCua(url), "anh", T0 + 61_000)).toEqual({
      ok: false,
      lyDo: "het-han",
    });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§6 — thiếu bất kỳ ô nào trong ba ô ⇒ TỪ CHỐI (không có mặc định ngầm)", () => {
    const dd = "/uploads/a.jpg";
    const q = queryCua(kyDuongDanAnh(dd, "anh", T0));

    expect(kiemChuKyAnh(dd, {}, "anh", T0)).toEqual({ ok: false, lyDo: "thieu" });
    expect(kiemChuKyAnh(dd, { exp: q.exp, pv: q.pv }, "anh", T0)).toEqual({ ok: false, lyDo: "thieu" });
    expect(kiemChuKyAnh(dd, { exp: q.exp, sig: q.sig }, "anh", T0)).toEqual({ ok: false, lyDo: "thieu" });
    expect(kiemChuKyAnh(dd, { pv: q.pv, sig: q.sig }, "anh", T0)).toEqual({ ok: false, lyDo: "thieu" });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§7 — ĐỔI BÍ MẬT ⇒ mọi vé cũ chết (khoá thật sự tham gia)", () => {
    const dd = "/uploads/a.jpg";
    const url = kyDuongDanAnh(dd, "anh", T0);
    expect(kiemChuKyAnh(dd, queryCua(url), "anh", T0)).toEqual({ ok: true });

    process.env.ANH_KY_SECRET = "mot-bi-mat-hoan-toan-khac-de-thay-ve-cu-chet";
    expect(kiemChuKyAnh(dd, queryCua(url), "anh", T0)).toEqual({ ok: false, lyDo: "sai-chu-ky" });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§8 — đường dẫn MÃ HOÁ PHẦN TRĂM ở đầu kiểm vẫn khớp vé ký từ dạng đã giải mã", () => {
    // ⚠ Ca này canh đúng lớp lỗi "ảnh nào cũng xem được TRỪ vài ảnh": tên tệp có dấu cách / chữ có
    //   dấu đi qua `req.originalUrl` ở dạng `%20`/`%C3%A1`, còn CSDL giữ dạng đã giải mã.
    const ddGoc = "/uploads/inspections/142/Điểm đo 1.jpg";
    const url = kyDuongDanAnh(ddGoc, "anh", T0);

    const nhuTrinhDuyetGui = encodeURI(ddGoc); // "/uploads/inspections/142/%C4%90i%E1%BB%83m%20do%201.jpg"
    expect(nhuTrinhDuyetGui).not.toBe(ddGoc); // ca sẽ vô nghĩa nếu hai chuỗi vốn đã bằng nhau
    expect(kiemChuKyAnh(nhuTrinhDuyetGui, queryCua(url), "anh", T0)).toEqual({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§9 — query THỪA (`?w=&q=`) KHÔNG làm vé trượt (app đang xin ảnh thu nhỏ)", () => {
    // Chữ ký cố ý KHÔNG phủ query: `FactoryAlertSystem/.../ImageViewerModal.tsx:153-161` tự thêm
    // `?w=400&q=50`. Phủ query ⇒ mọi vé chết khi app đổi bề rộng ⇒ bản vá xanh mà chức năng chết.
    const dd = "/uploads/inspections/142/R105.jpg";
    const q = queryCua(kyDuongDanAnh(dd, "anh", T0));
    expect(kiemChuKyAnh(dd, { ...q, w: "200", q: "60" } as never, "anh", T0)).toEqual({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§10 — `kyNeuLaDuongDanNoiBo` để nguyên URL TUYỆT ĐỐI và `data:`", () => {
    // Ký một URL tuyệt đối sẽ làm hỏng đúng những ảnh đang chạy được: bộ kiểm so với một ĐƯỜNG DẪN.
    const tuyetDoi = "http://kho-cu.local/uploads/x.jpg";
    expect(kyNeuLaDuongDanNoiBo(tuyetDoi, "anh")).toBe(tuyetDoi);
    expect(kyNeuLaDuongDanNoiBo("data:image/png;base64,AAAA", "anh")).toBe(
      "data:image/png;base64,AAAA",
    );
    // …còn đường dẫn nội bộ thì PHẢI được ký (ca này chống "hàm không làm gì cả").
    const noiBo = kyNeuLaDuongDanNoiBo("/uploads/x.jpg", "anh");
    expect(noiBo).toMatch(/^\/uploads\/x\.jpg\?exp=\d+&pv=anh&sig=[0-9a-f]{64}$/);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§11 — hạn bị KẸP BIÊN 60..86400 (một cấu hình sai không đẻ vé vĩnh viễn)", () => {
    process.env.ANH_KY_TTL_SECONDS = "1";
    expect(hanKySeconds()).toBe(60);
    process.env.ANH_KY_TTL_SECONDS = "999999999";
    expect(hanKySeconds()).toBe(86_400);
    process.env.ANH_KY_TTL_SECONDS = "rác";
    expect(hanKySeconds()).toBe(900);
    delete process.env.ANH_KY_TTL_SECONDS;
    expect(hanKySeconds()).toBe(900);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§12 — `duongDanChuanHoa` lùi về chuỗi thô với `%` lạc, KHÔNG ném", () => {
    // Tên tệp kiểu `100%.jpg` làm `decodeURIComponent` ném. Lùi về chuỗi thô là đúng chiều: hai đầu
    // vẫn khớp nhau và không lối thoát nào mở ra.
    expect(duongDanChuanHoa("/uploads/100%.jpg")).toBe("/uploads/100%.jpg");
    expect(duongDanChuanHoa("/uploads/a.jpg?w=200")).toBe("/uploads/a.jpg");
  });
});
