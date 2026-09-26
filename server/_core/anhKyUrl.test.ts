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
  kyAnhTrongThan,
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

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §13-§19 — `kyAnhTrongThan`: ký cả một THÂN PHẢN HỒI
  // ══════════════════════════════════════════════════════════════════════════════════════════

  /** Vé trong URL này có KIỂM ĐƯỢC không (chứ không chỉ "trông giống vé"). */
  function veHopLe(url: string, muc: "anh" | "zip" = "anh"): boolean {
    return kiemChuKyAnh(duongDanCua(url), queryCua(url), muc).ok;
  }

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§13 — ký NHIỀU TẦNG và trong MẢNG; mỗi vé phải KIỂM ĐƯỢC, không chỉ 'trông giống vé'", () => {
    // ⚠ Hình dạng lấy đúng từ `/api/external/statistics/measurement-points` (sâu 4 tầng) — nơi một
    //   bộ ký theo-tên-trường ở tầng ngoài sẽ bỏ sót toàn bộ.
    const than = kyAnhTrongThan(
      {
        success: true,
        data: {
          points: [
            {
              pointCode: "R105",
              images: {
                okImages: [{ imageUrl: "/uploads/inspections/1/a.jpg" }],
                ngImages: [
                  { imageUrl: "/uploads/inspections/1/b.jpg" },
                  { imageUrl: "/api/aoi/image/PKG1/c.png" },
                ],
              },
            },
          ],
        },
      },
      "anh",
    );

    const ok = than.data.points[0].images.okImages[0].imageUrl;
    const ng0 = than.data.points[0].images.ngImages[0].imageUrl;
    const ng1 = than.data.points[0].images.ngImages[1].imageUrl;

    // Chiều DƯƠNG mạnh: vé phải qua được CHÍNH bộ kiểm mà cổng ảnh dùng.
    expect(veHopLe(ok)).toBe(true);
    expect(veHopLe(ng0)).toBe(true);
    expect(veHopLe(ng1)).toBe(true);
    // …và đúng đường dẫn gốc, không bị đổi.
    expect(duongDanCua(ok)).toBe("/uploads/inspections/1/a.jpg");
    expect(duongDanCua(ng1)).toBe("/api/aoi/image/PKG1/c.png");
    // Trường không phải ảnh không bị đụng.
    expect(than.data.points[0].pointCode).toBe("R105");
    expect(than.success).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§14 — CHỈ ký tiền tố CÓ CỔNG CANH; mọi dạng khác giữ NGUYÊN VĂN (chống vá quá tay)", () => {
    // ⚠ Ca này là cầu chì chống "ký cho đủ bảng": ký một tiền tố không có bộ kiểm ở đầu kia chỉ làm
    //   URL dài hơn chứ không mở được gì, và với `data:`/URL tuyệt đối thì nó PHÁ ảnh đang chạy.
    const goc = {
      tuyetDoi: "http://kho-cu.local/uploads/x.jpg",
      dataUri: "data:image/png;base64,AAAA",
      khoaTho: "inspections/1/a.jpg", // `imageKey` — KHÔNG có tiền tố `/uploads/`
      apiKhac: "/api/external/reports/9/download",
      rong: "",
      soLuong: 42,
      vang: null,
    };
    const than = kyAnhTrongThan(goc, "anh");
    expect(than.tuyetDoi).toBe(goc.tuyetDoi);
    expect(than.dataUri).toBe(goc.dataUri);
    expect(than.khoaTho).toBe(goc.khoaTho);
    expect(than.apiKhac).toBe(goc.apiKhac);
    expect(than.rong).toBe("");
    expect(than.soLuong).toBe(42);
    expect(than.vang).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§15 — vé cấp bởi `kyAnhTrongThan` HẾT HẠN thì bộ kiểm phải TỪ CHỐI", () => {
    // ⚠ Đột biến tối thiểu của brief: "vé hết hạn vẫn qua ⇒ ĐỎ". Ca này phát biểu điều ngược lại.
    process.env.ANH_KY_TTL_SECONDS = "60";
    const than = kyAnhTrongThan({ imageUrl: "/uploads/inspections/1/a.jpg" }, "anh");
    const url = than.imageUrl;
    // Còn hạn ⇒ qua.
    expect(kiemChuKyAnh(duongDanCua(url), queryCua(url), "anh", T0).ok).toBe(true);
    // Quá hạn 61 giây ⇒ TRƯỢT, và trượt vì ĐÚNG lý do.
    const qua = kiemChuKyAnh(duongDanCua(url), queryCua(url), "anh", Date.now() + 61_000);
    expect(qua.ok).toBe(false);
    expect(qua.ok === false && qua.lyDo).toBe("het-han");
    delete process.env.ANH_KY_TTL_SECONDS;
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§16 — MỤC được truyền qua: vé `zip` KHÔNG mở được tuyến ảnh", () => {
    const than = kyAnhTrongThan({ u: "/uploads/a.jpg" }, "zip");
    expect(veHopLe(than.u, "zip")).toBe(true);
    expect(veHopLe(than.u, "anh")).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§17 — KHÔNG sửa tại chỗ: đối tượng gốc vẫn giữ đường dẫn THÔ", () => {
    // ⚠ Người gọi có thể vẫn đang giữ đối tượng gốc để ghi log hoặc để so khớp. Một hàm ký mà sửa
    //   tại chỗ sẽ làm những chỗ ấy hỏng theo, ở xa nơi gây ra.
    const goc = { data: [{ imageUrl: "/uploads/a.jpg" }] };
    const than = kyAnhTrongThan(goc, "anh");
    expect(goc.data[0].imageUrl).toBe("/uploads/a.jpg");
    expect(than.data[0].imageUrl).not.toBe("/uploads/a.jpg");
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§18 — THAM CHIẾU VÒNG và đối tượng KHÔNG-THUẦN không làm hàm treo hay méo hình dạng", () => {
    // ⚠⚠ Ràng buộc sống-còn của repo: `ResolvedDataScope.filter` là SQL drizzle **có tham chiếu
    //   vòng**, và `tsc` KHÔNG bắt được. Một bộ đi-sâu ngây thơ sẽ treo ở đây.
    const vong: Record<string, unknown> = { imageUrl: "/uploads/a.jpg" };
    vong.tuTro = vong;
    class SqlGia {
      constructor(public queryChunks: unknown[]) {}
    }
    const sqlGia = new SqlGia([]);
    (sqlGia.queryChunks as unknown[]).push(sqlGia); // vòng bên trong một CLASS

    const ngay = new Date("2026-08-18T00:00:00.000Z");
    const dem = Buffer.from("abc");

    const than = kyAnhTrongThan({ vong, sqlGia, ngay, dem, u: "/uploads/b.jpg" }, "anh");

    // Không treo, và đường dẫn ngoài cùng vẫn được ký.
    expect(veHopLe(than.u)).toBe(true);
    // Đối tượng KHÔNG-THUẦN được trả NGUYÊN (cùng tham chiếu) — hình dạng không bị méo.
    expect(than.ngay).toBe(ngay);
    expect(than.ngay instanceof Date).toBe(true);
    expect(than.dem).toBe(dem);
    expect(Buffer.isBuffer(than.dem)).toBe(true);
    expect(than.sqlGia).toBe(sqlGia);
    // Object THUẦN có vòng: vẫn ký được trường ảnh, và không đệ quy vô hạn.
    expect(veHopLe((than.vong as { imageUrl: string }).imageUrl)).toBe(true);
    // JSON hoá được ⇒ `res.json` sẽ không chết (ràng buộc superjson/JSON của repo).
    expect(() => JSON.stringify({ u: than.u, ngay: than.ngay })).not.toThrow();
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  it("§19 — LUỸ ĐẲNG: ký lại một thân ĐÃ ký vẫn cho vé HỢP LỆ, không chồng query", () => {
    // ⚠ Quan trọng vì `/api/inspection/:id/images` đã ký TỪNG TRƯỜNG từ trước; nếu sau này ai đó
    //   bọc thêm `kyAnhTrongThan` ở biên tuyến ấy, kết quả phải vẫn dùng được.
    const mot = kyAnhTrongThan({ u: "/uploads/a.jpg" }, "anh");
    const hai = kyAnhTrongThan(mot, "anh");
    expect(veHopLe(hai.u)).toBe(true);
    expect(duongDanCua(hai.u)).toBe("/uploads/a.jpg");
    expect((hai.u.match(/\?/g) || []).length).toBe(1);
    expect((hai.u.match(/sig=/g) || []).length).toBe(1);
  });
});
