/**
 * LƯỚI khung HTML của webview: CSP phải KHOÁ, và script phải chạy bằng nonce. Một webview lỡ mở
 * `script-src *` là lỗ hổng im lặng — không ai thấy cho tới lúc bị lợi dụng.
 */
import { describe, it, expect } from "vitest";
import { dungHtmlBang } from "./htmlBang";

describe("dungHtmlBang", () => {
  const html = dungHtmlBang({ nonce: "NONCE123" });

  it("★★★ có CSP và script chạy bằng nonce", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("nonce-NONCE123");
    expect(html).toContain('<script nonce="NONCE123">');
  });

  it("★★★ KHÔNG mở script-src cho mọi nguồn", () => {
    expect(html).not.toMatch(/script-src[^;]*\*/);
    expect(html).not.toContain("unsafe-inline");
  });

  it("★★ có ô nhập, nút gửi và vùng hội thoại", () => {
    expect(html).toContain('id="o-nhap"');
    expect(html).toContain('id="nut-gui"');
    expect(html).toContain('id="hoi-thoai"');
  });

  it("★★★ TASK 4: có nút Dừng, và nó MẶC ĐỊNH ẨN trong khung HTML (không hiện khi rảnh)", () => {
    // Đo trên chính THUỘC TÍNH `hidden` trong markup — đây là trạng thái BAN ĐẦU trước khi bất kỳ
    // script nào chạy, tức đúng nghĩa "lúc rảnh" (chưa có lượt hỏi nào được gửi).
    expect(html).toContain('<button id="nut-dung" hidden>Dừng</button>');
  });

  it("★★★ có ô chọn dự án", () => {
    expect(html).toContain('id="o-du-an"');
  });

  it("★★★ I3: webview xử `hoan_tat` — thay chữ khi degraded, hiện cảnh báo cắt ngang/khung hỏng", () => {
    expect(html).toContain('m.loai === "hoan_tat"');
    expect(html).toContain("m.vanBanCuoi");
    expect(html).toContain("m.canhBao");
  });

  it("★★★ webview BÁO SẴN SÀNG sau khi đăng ký lắng nghe (chống đua mất danh sách dự án)", () => {
    // Nếu extension gửi danh sách TRƯỚC khi webview lắng nghe, danh sách rơi mất mà không có lỗi
    // nào — ô chọn trống một cách im lặng. Bắt tay bằng `san_sang` là thứ chặn đúng lớp lỗi đó.
    const viTriDangKy = html.indexOf('addEventListener("message"');
    const viTriBao = html.indexOf('loai: "san_sang"');
    expect(viTriDangKy).toBeGreaterThan(-1);
    expect(viTriBao).toBeGreaterThan(viTriDangKy); // báo SAU khi đã lắng nghe
  });

  it("★★★ thẻ duyệt tồn tại và MẶC ĐỊNH ẨN", () => {
    expect(html).toContain('id="the-duyet" hidden');
  });

  it("★★★ thẻ duyệt có nhãn nguồn, đường dẫn, tóm tắt, hạn duyệt và đủ ba nút", () => {
    expect(html).toContain('id="duyet-nguon"');
    expect(html).toContain('id="duyet-duong"');
    expect(html).toContain('id="duyet-tom-tat"');
    expect(html).toContain('id="duyet-han"');
    expect(html).toContain('id="nut-xem-diff"');
    expect(html).toContain('id="nut-duyet"');
    expect(html).toContain('id="nut-huy"');
  });

  it("★★★ nút ghi KHÔNG có chữ mặc định — chữ phải do extension gửi ở MỖI lần hiện thẻ", () => {
    /**
     * ★★★ ĐỢT C ĐỔI BẤT BIẾN NÀY, KHÔNG NỚI NÓ. Trước Đợt C chỉ có MỘT nơi ghi (máy chủ) nên chữ
     * "Duyệt & ghi trên SERVER" đóng cứng trong HTML là đúng. Nay có HAI nơi ghi (máy chủ · đĩa máy
     * lập trình viên) ⇒ một chữ đóng cứng là một câu khai về nơi ghi khi CHƯA AI nói nơi ghi là
     * đâu, và nếu extension quên gửi nhãn thì nút sẽ đeo chữ của chế độ KIA — đúng "tai nạn không
     * cứu được" ở spec §7. Nên: nút RỖNG trong HTML, chữ do `m.nhanNut` đặt mỗi lần hiện thẻ.
     */
    const m = html.match(/<button id="nut-duyet">([^<]*)<\/button>/);
    expect(m).not.toBeNull();
    expect(m![1].trim()).toBe("");
    expect(html).toContain('document.getElementById("nut-duyet").textContent = m.nhanNut');
  });

  it("★★★ FAIL-CLOSED: thiếu nhãn nguồn hoặc chữ nút ⇒ thẻ duyệt KHÔNG hiện", () => {
    // Không được rơi về "hiện thẻ với chữ cũ": chữ cũ có thể là chữ của chế độ còn lại.
    expect(html).toContain("if (!m.nhanNguon || !m.nhanNut)");
    const viTriChan = html.indexOf("if (!m.nhanNguon || !m.nhanNut)");
    const viTriHien = html.indexOf("theDuyet.hidden = false");
    expect(viTriChan).toBeGreaterThan(-1);
    expect(viTriHien).toBeGreaterThan(viTriChan); // chặn TRƯỚC, hiện SAU
  });

  it("★★ đề xuất KHÔNG có hạn (chế độ LOCAL) không được in 'Hạn duyệt:' cụt đuôi", () => {
    expect(html).toContain('m.han ? "Hạn duyệt: " + m.han :');
  });

  it("★★ webview chuyển tiếp cú bấm ba nút thẻ duyệt cho extension, KHÔNG tự quyết", () => {
    expect(html).toContain('loai: "xem_diff"');
    expect(html).toContain('loai: "duyet"');
    expect(html).toContain('loai: "huy"');
  });

  it("★★ webview xử lý the_duyet (hiện thẻ) / an_the_duyet (ẩn thẻ) / thong_bao (báo kết quả)", () => {
    expect(html).toContain('m.loai === "the_duyet"');
    expect(html).toContain('m.loai === "an_the_duyet"');
    expect(html).toContain('m.loai === "thong_bao"');
  });
});

/**
 * ★★★ ĐỢT G / TASK G1 / B2 — markup TĨNH của vùng đăng nhập: MỘT icon (`#nut-tai-khoan`), không
 * còn ba phần tử (nút to + tên + nút đăng xuất) của Đợt F. `title`/`aria-label` phải khác nhau
 * theo `dv.daDangNhap` NGAY từ HTML tĩnh, và tên tài khoản (chưa biết ở thời điểm dựng trang) KHÔNG
 * BAO GIỜ xuất hiện — nó chỉ tới sau qua tin `trang_thai_dang_nhap` (xem nhóm ca "webview" dưới).
 */
describe("dungHtmlBang — ĐỢT G / TASK G1 / B2: icon tài khoản", () => {
  it("★★★ CHƯA đăng nhập ⇒ nút tài khoản có title/aria-label 'Đăng nhập'", () => {
    const html = dungHtmlBang({ nonce: "N", daDangNhap: false });
    expect(html).toContain('id="nut-tai-khoan"');
    expect(html).toMatch(/id="nut-tai-khoan"[^>]*title="Đăng nhập"/);
    expect(html).toMatch(/id="nut-tai-khoan"[^>]*aria-label="Đăng nhập"/);
  });

  it("★★★ NHÁNH KIA: ĐÃ đăng nhập ⇒ title/aria-label đổi sang 'Đăng xuất' (chưa có tên tài khoản ở markup tĩnh)", () => {
    const html = dungHtmlBang({ nonce: "N", daDangNhap: true });
    expect(html).toMatch(/id="nut-tai-khoan"[^>]*title="Đăng xuất"/);
    expect(html).toMatch(/id="nut-tai-khoan"[^>]*aria-label="Đăng xuất"/);
    expect(html).not.toContain('title="Đăng nhập"');
  });

  it("★ không truyền `daDangNhap` (mặc định) ⇒ rơi về nhánh AN TOÀN 'chưa đăng nhập'", () => {
    // Constructor của BangChat không thể biết trạng thái thật TRƯỚC khi gán `webview.html` (đọc
    // cookie là bất đồng bộ) — rơi về "chưa đăng nhập" là lựa chọn fail-closed đúng khuôn `cheDoHienTai`.
    const html = dungHtmlBang({ nonce: "N" });
    expect(html).toMatch(/id="nut-tai-khoan"[^>]*title="Đăng nhập"/);
  });

  it("★★ chỉ MỘT phần tử cho vùng tài khoản — không còn nút to/span tên/nút đăng xuất riêng của Đợt F", () => {
    const html = dungHtmlBang({ nonce: "N", daDangNhap: true });
    expect(html).not.toContain('id="nut-dang-nhap"');
    expect(html).not.toContain('id="ten-tai-khoan"');
    expect(html).not.toContain('id="nut-dang-xuat"');
  });

  it("★★ nút tài khoản KHÔNG mang `hidden` ở bất kỳ trạng thái nào — nó LUÔN hiện (chỉ đổi title/aria-label)", () => {
    expect(dungHtmlBang({ nonce: "N", daDangNhap: false })).not.toMatch(/id="nut-tai-khoan"[^>]*hidden/);
    expect(dungHtmlBang({ nonce: "N", daDangNhap: true })).not.toMatch(/id="nut-tai-khoan"[^>]*hidden/);
  });
});

/**
 * ★★★ ĐỢT G / TASK G1 / B3 — ô chọn dự án (`#o-du-an`) mặc định ẨN trong markup TĨNH: tránh một cú
 * chớp ô-chọn-rỗng trước khi tin "duAn" đầu tiên tới (script tự bật lại `hidden` đúng lúc — xem
 * nhóm ca "webview" dưới).
 */
describe("dungHtmlBang — ĐỢT G / TASK G1 / B3: ô chọn dự án mặc định ẨN", () => {
  it("★★★ markup tĩnh: #o-du-an mang `hidden`", () => {
    const html = dungHtmlBang({ nonce: "N" });
    expect(html).toMatch(/<select id="o-du-an"[^>]*\bhidden\b/);
  });
});

/**
 * ★★★ ĐỢT G / TASK G1 / B4 — nút Gửi thu nhỏ thành icon nhưng PHẢI giữ `aria-label`: nhỏ gọn không
 * đồng nghĩa vô danh với trình đọc màn hình (yêu cầu tường minh của kế hoạch).
 */
describe("dungHtmlBang — ĐỢT G / TASK G1 / B4: nút Gửi có aria-label", () => {
  it("★★★ #nut-gui mang aria-label khẳng định được bằng chữ (không rỗng)", () => {
    const html = dungHtmlBang({ nonce: "N" });
    const m = html.match(/<button id="nut-gui"[^>]*aria-label="([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1].trim().length).toBeGreaterThan(0);
  });

  it("★★ #nut-gui không còn chữ 'Gửi' TRẦN làm nội dung nút (đã thành icon) nhưng vẫn còn trong nhãn", () => {
    const html = dungHtmlBang({ nonce: "N" });
    const than = html.match(/<button id="nut-gui"[^>]*>([\s\S]*?)<\/button>/);
    expect(than).not.toBeNull();
    expect(than![1]).not.toContain(">Gửi<");
    expect(html).toMatch(/id="nut-gui"[^>]*aria-label="[^"]*Gửi/);
  });
});

/**
 * ★★★ ĐỢT F / TASK 1 / B6 — mật khẩu KHÔNG BAO GIỜ chạm webview. Hai trục đo:
 *   (1) không có PHẦN TỬ nào để nhập mật khẩu (thực ra: không có `<input>` nào hết — toàn bộ ô
 *       nhập của khung chat là MỘT `<textarea id="o-nhap">` cho câu hỏi, không phải form đăng nhập);
 *   (2) dù `dv` bị truyền THÊM một trường trông như mật khẩu (test cố tình ép qua `as never` vì
 *       kiểu TypeScript của `dungHtmlBang` không hề khai trường đó), hàm THUẦN này cũng không có
 *       chỗ nào đọc/in nó ra — chỉ `nonce` và `daDangNhap` được đưa vào chuỗi HTML.
 * ⚠ KHÔNG cấm chuỗi "mật khẩu"/"password" TRẦN: docblock của `htmlBang.ts` cố ý GIẢI THÍCH vì sao
 *   mật khẩu không đi qua đây (yêu cầu bình luận nói VÌ SAO của cả dự án) — cấm cả chuỗi sẽ biến
 *   một bình luận đúng đắn thành lỗi lưới. Trục đo đúng là HÀNH VI (phần tử/giá trị), không phải
 *   một từ khoá xuất hiện trong bình luận giải thích.
 */
describe("dungHtmlBang — ĐỢT F / TASK 1 / B6: mật khẩu không qua webview", () => {
  it("★★★ KHÔNG có phần tử <input> nào trong HTML dựng ra (cả hai trạng thái đăng nhập)", () => {
    expect(dungHtmlBang({ nonce: "N", daDangNhap: false })).not.toContain("<input");
    expect(dungHtmlBang({ nonce: "N", daDangNhap: true })).not.toContain("<input");
  });

  it("★★★ KHÔNG có thuộc tính type=\"password\" ở bất kỳ đâu", () => {
    expect(dungHtmlBang({ nonce: "N", daDangNhap: false })).not.toMatch(/type=["']password["']/i);
    expect(dungHtmlBang({ nonce: "N", daDangNhap: true })).not.toMatch(/type=["']password["']/i);
  });

  it("★★★ CỐ TÌNH truyền thêm một trường trông như mật khẩu vào `dv` ⇒ HTML dựng ra vẫn KHÔNG in nó ra", () => {
    // `as never` để vượt qua TypeScript — mô phỏng đúng câu hỏi census muốn trả lời: "dù có ai đó
    // (nhầm lẫn hoặc cố ý) nhét thêm một trường mật khẩu vào tham số, hàm này có LỠ in nó ra không?"
    const html = dungHtmlBang({ nonce: "N", daDangNhap: true, matKhau: "MAT_KHAU_THAT_KHONG_DUOC_LO" } as never);
    expect(html).not.toContain("MAT_KHAU_THAT_KHONG_DUOC_LO");
  });
});

/**
 * ★★★ ĐỢT F / TASK 1 / B3+B4+B5 — KẾT CỤC thật, chạy script THẬT của webview (cùng khuôn "CHỐNG
 * BẤM HAI LẦN"/"nút Dừng"/"@-mention" ở trên). Đây là lớp lỗi chữ ký của dự án: "khai kết cục mà
 * không đọc kết cục" — nên nhóm ca này đo DOM THẬT đổi (thuộc tính `hidden`, `textContent`), không
 * chỉ đo "đã gửi đúng tin nhắn".
 */
describe("webview — ĐỢT G / TASK G1 / B2: khung TỰ đổi trạng thái đăng nhập, không cần đóng/mở lại", () => {
  it("★★★ nhận `trang_thai_dang_nhap` (đã đăng nhập) ⇒ tooltip mang TÊN tài khoản, lớp 'da-dang-nhap' bật", () => {
    const w = chayWebview();
    w.banTin({ loai: "trang_thai_dang_nhap", daDangNhap: true, tenTaiKhoan: "ky_su_an" });

    const nut = w.nut("nut-tai-khoan");
    expect(nut.title).toContain("ky_su_an");
    expect(nut.getAttribute("aria-label")).toContain("ky_su_an");
    expect(nut.classList.contains("da-dang-nhap")).toBe(true);
  });

  it("★★★ NHÁNH KIA: nhận `trang_thai_dang_nhap` (đã đăng xuất) ⇒ tooltip quay về 'Đăng nhập', lớp 'da-dang-nhap' tắt", () => {
    const w = chayWebview();
    // Bắt đầu từ trạng thái ĐÃ đăng nhập để chắc chắn đo được một cú CHUYỂN NGƯỢC, không phải tình
    // cờ khớp trạng thái ban đầu của DOM giả.
    w.banTin({ loai: "trang_thai_dang_nhap", daDangNhap: true, tenTaiKhoan: "ky_su_an" });
    expect(w.nut("nut-tai-khoan").classList.contains("da-dang-nhap")).toBe(true);

    w.banTin({ loai: "trang_thai_dang_nhap", daDangNhap: false, tenTaiKhoan: "" });

    const nut = w.nut("nut-tai-khoan");
    expect(nut.title).toBe("Đăng nhập");
    expect(nut.getAttribute("aria-label")).toBe("Đăng nhập");
    expect(nut.classList.contains("da-dang-nhap")).toBe(false);
  });

  it("★★★ B4 (kỷ luật giữ nguyên từ Đợt F): câu hỏi đang GÕ DỞ trong ô nhập KHÔNG bị mất khi trạng thái đăng nhập đổi", () => {
    const w = chayWebview();
    const oNhap = w.nut("o-nhap");
    oNhap.value = "câu hỏi đang gõ dở, chưa bấm Gửi";

    w.banTin({ loai: "trang_thai_dang_nhap", daDangNhap: true, tenTaiKhoan: "ky_su_an" });

    expect(oNhap.value).toBe("câu hỏi đang gõ dở, chưa bấm Gửi");
  });

  it("★★★ CHƯA đăng nhập ⇒ bấm icon tài khoản ⇒ extension nhận ĐÚNG MỘT tin `dangNhap`, KHÔNG phải `dangXuat`", () => {
    const w = chayWebview();
    w.nut("nut-tai-khoan").bam();
    expect(w.daGui.filter((m) => m.loai === "dangNhap")).toHaveLength(1);
    expect(w.daGui.filter((m) => m.loai === "dangXuat")).toHaveLength(0);
  });

  it("★★★ ĐÃ đăng nhập ⇒ bấm CHÍNH icon đó ⇒ extension nhận ĐÚNG MỘT tin `dangXuat`, KHÔNG lẫn với `dangNhap`", () => {
    // ★★★ MỘT nút, HAI vai trò: cùng phần tử `#nut-tai-khoan` — hành vi bấm phải tự đổi theo trạng
    // thái GẦN NHẤT mà `trang_thai_dang_nhap` báo, không phải một nút thứ hai được lộ ra.
    const w = chayWebview();
    w.banTin({ loai: "trang_thai_dang_nhap", daDangNhap: true, tenTaiKhoan: "ky_su_an" });
    w.nut("nut-tai-khoan").bam();
    expect(w.daGui.filter((m) => m.loai === "dangXuat")).toHaveLength(1);
    expect(w.daGui.filter((m) => m.loai === "dangNhap")).toHaveLength(0);
  });
});

/**
 * ★★★ ĐỢT G / TASK G1 / B3 — ô chọn dự án (`#o-du-an`): KẾT CỤC thật của tin "duAn", chạy script
 * THẬT. Trục đo, BA nhánh (bản vá NHÁNH KIA 2026-09-03 — luật cũ "toàn local ⇒ luôn ẩn" bỏ sót
 * workspace ĐA GỐC: `bangChat.ts#thuMucLocalDangChon`/`#dsGocDoc` dùng chính mục ĐANG CHỌN làm GỐC
 * ƯU TIÊN cho cả đọc lẫn ghi khi có nhiều gốc — ẩn ô chọn trong trường hợp đó lấy đi một chức năng
 * THẬT, không chỉ trang trí):
 *   1. ĐÚNG MỘT gốc LOCAL (không có SERVER) ⇒ ẨN — ô chọn không đổi được gì (chỉ một lựa chọn).
 *   2. HAI gốc LOCAL trở lên (không có SERVER) ⇒ HIỆN — chọn gốc nào ưu tiên là một quyết định THẬT.
 *   3. Có ÍT NHẤT một dự án SERVER (bất kể số gốc local) ⇒ HIỆN — lựa chọn THẬT, không suy ra được
 *      từ workspace.
 */
describe("webview — ĐỢT G / TASK G1 / B3: ô chọn dự án ẨN ở LOCAL, GIỮ ở SERVER", () => {
  it("★★★ NHÁNH 1: ĐÚNG MỘT gốc LOCAL (một thư mục workspace) ⇒ #o-du-an ẨN", () => {
    const w = chayWebview();
    w.banTin({ loai: "duAn", ds: [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }] });
    expect(w.nut("o-du-an").hidden).toBe(true);
  });

  it("★★★ NHÁNH 2 (bản vá NHÁNH KIA): HAI gốc LOCAL trở lên, KHÔNG có SERVER ⇒ #o-du-an HIỆN", () => {
    // Workspace ĐA GỐC toàn local: `dsGocDoc()`/`thuMucLocalDangChon()` (bangChat.ts) tôn trọng mục
    // ĐANG CHỌN làm gốc ưu tiên cho cả ba tool đọc lẫn đường ghi — ẩn ô chọn ở đây lấy đi đúng chức
    // năng đó (các gốc còn lại vẫn là dự phòng nên không thảm hoạ, nhưng vẫn là mất mát thật).
    const w = chayWebview();
    w.banTin({
      loai: "duAn",
      ds: [
        { id: "local:C:\\ws-a", nhan: "LOCAL · C:\\ws-a", loai: "local" },
        { id: "local:C:\\ws-b", nhan: "LOCAL · C:\\ws-b", loai: "local" },
      ],
    });
    expect(w.nut("o-du-an").hidden).toBe(false);
  });

  it("★★★ NHÁNH 3: danh sách CÓ một dự án SERVER (dù có thêm local) ⇒ #o-du-an HIỆN", () => {
    const w = chayWebview();
    w.banTin({
      loai: "duAn",
      ds: [
        { id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" },
        { id: "server:p1", nhan: "SERVER · dự án 1", loai: "server" },
      ],
    });
    expect(w.nut("o-du-an").hidden).toBe(false);
  });

  it("★★ KHÔNG cái bẫy: chọn một mục LOCAL trong danh sách hỗn hợp KHÔNG tự ẩn lại ô chọn", () => {
    // Nếu ẩn/hiện theo MỤC ĐANG CHỌN (thay vì theo toàn danh sách), người dùng chọn một thư mục
    // LOCAL trong danh sách hỗn hợp sẽ mất luôn đường quay lại chọn dự án SERVER — xem docblock
    // `htmlBang.ts` nhánh "duAn". Danh sách "duAn" (KHÔNG đổi) không kèm sự kiện "change" nào ở đây
    // vì #o-du-an chỉ tự đổi `hidden` khi NHẬN một danh sách mới, không khi người dùng đổi lựa chọn.
    const w = chayWebview();
    w.banTin({
      loai: "duAn",
      ds: [
        { id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" },
        { id: "server:p1", nhan: "SERVER · dự án 1", loai: "server" },
      ],
    });
    expect(w.nut("o-du-an").hidden).toBe(false);
    w.nut("o-du-an").value = "local:C:\\ws";
    w.nut("o-du-an").kichHoat("change", { target: { value: "local:C:\\ws" } });
    expect(w.nut("o-du-an").hidden).toBe(false);
  });

  it("★ danh sách RỖNG ⇒ #o-du-an ẨN (không có gì để chọn)", () => {
    const w = chayWebview();
    w.banTin({ loai: "duAn", ds: [] });
    expect(w.nut("o-du-an").hidden).toBe(true);
  });
});

/**
 * ★★★ CHỐNG BẤM HAI LẦN — LƯỚI **CHẠY THẬT** SCRIPT CỦA WEBVIEW, KHÔNG SOI CHỮ.
 *
 * ⚠ Mọi ca ở trên khẳng định HTML **CHỨA** một chuỗi nào đó — đo CƠ CHẾ, không đo KẾT CỤC. Với một
 *   hàng rào chống bấm-hai-lần thì kết cục là thứ duy nhất đáng đo: "bấm hai phát ⇒ extension chỉ
 *   nhận MỘT tin". Nên nhóm này bóc phần `<script>` ra và CHẠY nó trên một DOM giả tối thiểu.
 * ⚠ DOM giả cố ý NGHÈO — chỉ đủ những gì script thật gọi tới. Dựng thêm là dựng một trình duyệt
 *   thứ hai để rồi nó trôi khỏi trình duyệt thật.
 */
class PhanTuGia {
  hidden = false;
  disabled = false;
  textContent = "";
  value = "";
  className = "";
  scrollTop = 0;
  scrollHeight = 0;
  // ★★★ ĐỢT I / TASK I-5a — script thật gán `d.id = "rong-lan-dau"` khi dựng lại hướng dẫn lần-đầu
  // (`hienLaiRongLanDau`, htmlBang.ts) để lưới phân biệt được nó với bong bóng hội thoại thật trong
  // `#hoi-thoai.con` bằng CÙNG thuộc tính DOM chuẩn (`Element.id`) mà script thật đọc/ghi.
  id = "";
  // ★★★ ĐỢT G / TASK G1 / B2 — script thật đọc `dataset.daDangNhap` (từ `data-da-dang-nhap` của
  // markup TĨNH) và ghi `title`/`aria-label`/lớp `da-dang-nhap` thay vì `hidden`/`textContent` của
  // BA phần tử riêng như bản Đợt F cũ. Đối tượng RỖNG mặc định (không phải `undefined`) — script
  // đọc `nutTaiKhoan.dataset.daDangNhap === "true"` phải chạy được kể cả khi thuộc tính chưa từng
  // được đặt (đúng hành vi `DOMStringMap` thật: khoá vắng mặt đọc ra `undefined`, không ném lỗi).
  dataset: Record<string, string> = {};
  title = "";
  private thuocTinh: Record<string, string> = {};
  setAttribute(k: string, v: string): void {
    this.thuocTinh[k] = v;
  }
  getAttribute(k: string): string | undefined {
    return this.thuocTinh[k];
  }
  private lopCss = new Set<string>();
  classList = {
    toggle: (ten: string, bat?: boolean): void => {
      const batThat = bat === undefined ? !this.lopCss.has(ten) : bat;
      if (batThat) this.lopCss.add(ten);
      else this.lopCss.delete(ten);
    },
    contains: (ten: string): boolean => this.lopCss.has(ten),
  };
  // TASK 5 — vị trí con trỏ trong ô nhập, dùng cho lưới @-mention (`viTriMention` trong htmlBang.ts
  // đọc `selectionStart` để biết đang gõ "@..." ở đâu). `undefined` mặc định — script thật rơi về
  // cuối chuỗi khi thiếu, đúng hành vi một textarea thật lúc mới gõ xong.
  selectionStart: number | undefined = undefined;
  selectionEnd: number | undefined = undefined;
  private nghe: Record<string, Array<(e: unknown) => void>> = {};
  addEventListener(loai: string, h: (e: unknown) => void): void {
    (this.nghe[loai] ??= []).push(h);
  }
  // ★★★ ĐỢT F / TASK 2 — TRACK con để lưới khôi phục hội thoại đo được NỘI DUNG bong bóng đã vẽ
  // (nhãn + chữ), không chỉ đo "có gọi appendChild hay không". Mảng RỖNG mặc định giữ NGUYÊN hành
  // vi cũ cho mọi ca không đọc `con` (DOM giả vẫn "nghèo" — không dựng cây THẬT, chỉ ghi lại quan hệ
  // cha/con nông để soi được).
  con: PhanTuGia[] = [];
  appendChild(c?: PhanTuGia): void {
    if (c) this.con.push(c);
  }
  // ★★★ ĐỢT F / TASK 3 — `innerHTML` PHẢI mô phỏng ĐÚNG hành vi trình duyệt thật khi script gán
  // chuỗi RỖNG: xoá SẠCH cây con (`xoaKhungChoPhienKhac` trong htmlBang.ts dựa vào đúng hiệu ứng
  // này để dọn `#hoi-thoai` trước khi vẽ lại). Script thật CHỈ BAO GIỜ gán `innerHTML = ""` (dọn
  // trước khi dựng lại bằng `appendChild`) — không có chỗ nào gán một chuỗi HTML có nội dung, nên
  // không cần một trình phân tích HTML giả ở đây; một getter/setter tối giản là đủ trung thực.
  private _innerHTML = "";
  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(v: string) {
    this._innerHTML = v;
    if (v === "") this.con = [];
  }
  /** Mô phỏng một cú BẤM CHUỘT thật (kể cả khi nút đang `disabled` — trình duyệt tự chặn, ta thì
   *  cố ý KHÔNG chặn, để đo chính hàng rào trong script chứ không đo hộ trình duyệt). */
  bam(): void {
    this.kichHoat("click", {});
  }
  /** Phát một sự kiện BẤT KỲ đã đăng ký qua `addEventListener` — tổng quát hoá của `bam()`, dùng
   *  cho những phím KHÔNG phải click (vd `keydown` của Task 5 — chọn gợi ý @-mention bằng Tab). */
  kichHoat(loai: string, e: unknown): void {
    for (const h of this.nghe[loai] ?? []) h(e);
  }
}

function chayWebview(): {
  nut: (id: string) => PhanTuGia;
  daGui: Array<Record<string, unknown>>;
  banTin: (m: Record<string, unknown>) => void;
} {
  const ma = dungHtmlBang({ nonce: "N" }).match(/<script nonce="N">([\s\S]*?)<\/script>/)![1];
  const kho = new Map<string, PhanTuGia>();
  const nut = (id: string): PhanTuGia => {
    if (!kho.has(id)) kho.set(id, new PhanTuGia());
    return kho.get(id)!;
  };
  const daGui: Array<Record<string, unknown>> = [];
  const ngheCuaWindow: Array<(e: { data: Record<string, unknown> }) => void> = [];
  const documentGia = { getElementById: nut, createElement: () => new PhanTuGia() };
  const windowGia = {
    addEventListener: (_l: string, h: (e: { data: Record<string, unknown> }) => void) => ngheCuaWindow.push(h),
  };
  // ⚠ `new Function` ở đây KHÔNG phải lỗ tiêm mã: `ma` là văn bản do CHÍNH `dungHtmlBang` trong
  //   repo này sinh ra (không có đầu vào ngoài nào chạm tới nó — `nonce` là hằng của lưới), và đây
  //   là tệp LƯỚI, không vào `dist`. Đó cũng chính là điều làm ca này đáng giá: nó chạy ĐÚNG đoạn
  //   mã sẽ chạy trong webview, chứ không chạy một bản chép lại.
  new Function("document", "window", "acquireVsCodeApi", ma)(documentGia, windowGia, () => ({
    postMessage: (m: Record<string, unknown>) => daGui.push(m),
  }));
  return { nut, daGui, banTin: (m) => ngheCuaWindow.forEach((h) => h({ data: m })) };
}

describe("webview — nút GHI không được gửi hai lượt cho một quyết định", () => {
  it("★★★ BẤM HAI LẦN liên tiếp ⇒ extension chỉ nhận ĐÚNG MỘT tin `duyet`", () => {
    /**
     * ★★★ Phía extension xoá trạng thái đề xuất SAU `await` (secret · mạng · đĩa), nên cú bấm thứ
     * hai chạy trọn đường ghi lần nữa và MỞ HÀNG KIỂM TOÁN THỨ HAI. Lượt ghi ấy gần như chắc chắn
     * bị chặn ở phép so băm, nhưng hàng `ap_client_that_bai` thì ở lại VĨNH VIỄN — sổ kể một câu
     * chuyện sai về hành vi người dùng.
     */
    const w = chayWebview();
    w.banTin({ loai: "the_duyet", nhanNguon: "LOCAL · C:\\ws", nhanNut: "Ghi vào workspace", duong: "a.ts", tomTat: "+1 / −0", han: "" });

    w.nut("nut-duyet").bam();
    w.nut("nut-duyet").bam();
    w.nut("nut-duyet").bam();

    expect(w.daGui.filter((m) => m.loai === "duyet")).toHaveLength(1);
    expect(w.nut("nut-duyet").disabled).toBe(true);
  });

  it("★★★ KẾT QUẢ VỀ (`thong_bao`) ⇒ MỞ KHOÁ — ca 'KHÔNG RÕ KẾT CỤC' phải bấm lại được", () => {
    /**
     * ★★★ Đường SERVER CỐ Ý giữ thẻ lại khi mất mạng giữa chừng và chỉ gửi `thong_bao`: bấm Duyệt
     * lần nữa là cách DUY NHẤT để biết lượt trước ra sao (`confirmAction` idempotent). Một hàng rào
     * chống-bấm-hai-lần khoá vĩnh viễn sẽ lấy mất đúng đường thoát ấy — chữa một lỗi bằng một lỗi.
     */
    const w = chayWebview();
    w.banTin({ loai: "the_duyet", nhanNguon: "SERVER · repo", nhanNut: "Duyệt & ghi trên SERVER", duong: "a.cs", tomTat: "+1 / −0", han: "12:00" });
    w.nut("nut-duyet").bam();
    w.nut("nut-duyet").bam();
    expect(w.daGui.filter((m) => m.loai === "duyet")).toHaveLength(1);

    w.banTin({ loai: "thong_bao", thongDiep: "KHÔNG RÕ KẾT CỤC — …" });
    expect(w.nut("nut-duyet").disabled).toBe(false);

    w.nut("nut-duyet").bam();
    expect(w.daGui.filter((m) => m.loai === "duyet")).toHaveLength(2);
  });

  it("★★★ THẺ MỚI (`the_duyet`) hoặc THẺ BỊ ẨN (`an_the_duyet`) ⇒ MỞ KHOÁ", () => {
    const w = chayWebview();
    w.nut("nut-duyet").bam();
    w.banTin({ loai: "an_the_duyet" });
    expect(w.nut("nut-duyet").disabled).toBe(false);

    w.nut("nut-duyet").bam();
    expect(w.nut("nut-duyet").disabled).toBe(true);
    w.banTin({ loai: "the_duyet", nhanNguon: "LOCAL · C:\\ws", nhanNut: "Ghi vào workspace", duong: "b.ts", tomTat: "+2 / −1", han: "" });
    expect(w.nut("nut-duyet").disabled).toBe(false);
  });

  it("★★ hàng rào CHỈ áp cho nút GHI — 'Xem diff' và 'Huỷ' vẫn bấm được bao nhiêu lần cũng được", () => {
    // Hai nút kia không đẻ hàng kiểm toán nào; khoá chúng là làm giao diện đơ mà không được gì.
    const w = chayWebview();
    w.nut("nut-duyet").bam();
    w.nut("nut-xem-diff").bam();
    w.nut("nut-xem-diff").bam();
    w.nut("nut-huy").bam();
    w.nut("nut-huy").bam();
    expect(w.daGui.filter((m) => m.loai === "xem_diff")).toHaveLength(2);
    expect(w.daGui.filter((m) => m.loai === "huy")).toHaveLength(2);
  });
});

/**
 * ★★★ TASK 4 — NÚT DỪNG: KẾT CỤC, không chỉ CHỮ TRONG HTML. Cùng khuôn với nhóm "CHỐNG BẤM HAI
 * LẦN" ở trên — chạy THẬT script của webview, quan sát `hidden` đổi và tin nhắn thật được gửi.
 */
describe("webview — nút Dừng chỉ hiện khi ĐANG chạy", () => {
  it("★★★ rảnh ⇒ ẩn; gửi câu hỏi ⇒ HIỆN; nhận `hoan_tat` ⇒ ẨN lại", () => {
    const w = chayWebview();
    // Trạng thái ban đầu của DOM giả (`PhanTuGia.hidden = false` mặc định) không mô phỏng thuộc
    // tính `hidden` tĩnh trong HTML — cái đó đã có lưới riêng ở trên. Ở đây ta đo ĐỘNG: script
    // phải TỰ ẩn nút khi có tín hiệu "đã xong", không nhờ vào trạng thái ban đầu của trình duyệt.
    w.nut("o-nhap").value = "hỏi gì đó";
    w.nut("nut-gui").bam();
    expect(w.nut("nut-dung").hidden).toBe(false);

    w.banTin({ loai: "hoan_tat", vanBanCuoi: null, canhBao: null });
    expect(w.nut("nut-dung").hidden).toBe(true);
  });

  it("★★ nhận `loi` ⇒ CŨNG ẩn nút Dừng (đường lỗi thật, không phải AbortError, vẫn phải kết thúc)", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "hỏi gì đó";
    w.nut("nut-gui").bam();
    expect(w.nut("nut-dung").hidden).toBe(false);

    w.banTin({ loai: "loi", thongDiep: "lỗi thật" });
    expect(w.nut("nut-dung").hidden).toBe(true);
  });

  it("★★★ bấm nút Dừng ⇒ extension nhận ĐÚNG MỘT tin `dung_hoi`, KHÔNG lẫn với `huy` (huỷ đề xuất ghi)", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "hỏi gì đó";
    w.nut("nut-gui").bam();
    w.nut("nut-dung").bam();

    expect(w.daGui.filter((m) => m.loai === "dung_hoi")).toHaveLength(1);
    expect(w.daGui.filter((m) => m.loai === "huy")).toHaveLength(0);
  });

  it("★★ chỉ `thong_bao`/`token` giữa chừng KHÔNG được ẩn nút — chúng là tiến độ, không phải kết thúc", () => {
    // Vòng lặp tác nhân (Task 3) bắn `thong_bao` nhiều lần GIỮA một lượt hỏi còn đang chạy (báo
    // "vòng N/3 — đang đọc tệp…"). Ẩn nút Dừng theo tín hiệu đó là ẩn nhầm lúc còn đang chạy.
    const w = chayWebview();
    w.nut("o-nhap").value = "hỏi gì đó";
    w.nut("nut-gui").bam();
    w.banTin({ loai: "token", chu: "a" });
    w.banTin({ loai: "thong_bao", thongDiep: "vòng 2/3 — đang đọc tệp" });
    expect(w.nut("nut-dung").hidden).toBe(false);
  });
});

/**
 * ★★★ TASK 5 — @-MENTION: KẾT CỤC thật, chạy script THẬT (cùng khuôn "CHỐNG BẤM HAI LẦN"/"nút
 * Dừng" ở trên). Trục đo trọng tâm — bài học `/ai-coding-workspace` đã trả giá: đường dẫn CHÈN RA
 * phải SẠCH, không kèm ký tự "@".
 */
describe("webview — @-mention", () => {
  it("★★★ gõ '@' ⇒ hỏi extension gợi ý ĐÚNG phần chữ sau '@' (không kèm '@')", () => {
    const w = chayWebview();
    const oNhap = w.nut("o-nhap");
    oNhap.value = "sửa giúp @src/A";
    oNhap.selectionStart = oNhap.value.length;
    oNhap.kichHoat("input", {});

    const yc = w.daGui.filter((m) => m.loai === "xin_goi_y_mention");
    expect(yc).toHaveLength(1);
    expect(yc[0].truy).toBe("src/A");
  });

  it("★★★ CHỌN gợi ý (Tab) ⇒ đường dẫn CHÈN RA là SẠCH, KHÔNG có ký tự '@' nào trong ô nhập", () => {
    const w = chayWebview();
    const oNhap = w.nut("o-nhap");
    oNhap.value = "sửa giúp @src/A";
    oNhap.selectionStart = oNhap.value.length;
    oNhap.kichHoat("input", {});

    w.banTin({ loai: "goi_y_mention", ds: ["src/A.ts", "src/A.spec.ts"] });
    expect(w.nut("mention-ds").hidden).toBe(false);

    // Tab chọn gợi ý ĐẦU TIÊN — đường bàn phím-trước, không cần dựng lại cây DOM động của dropdown
    // (DOM giả không dựng cây thật — xem docblock `PhanTuGia`), nhưng đi qua ĐÚNG hàm chèn `chonGoiY`
    // mà cú click chuột cũng gọi.
    oNhap.kichHoat("keydown", { key: "Tab", preventDefault: () => undefined });

    expect(oNhap.value).toBe("sửa giúp src/A.ts ");
    expect(oNhap.value).not.toContain("@");
    // Dropdown phải TỰ ẨN sau khi chọn — một dropdown còn mở sau khi đã chèn là trạng thái mồ côi.
    expect(w.nut("mention-ds").hidden).toBe(true);
  });

  it("★★★ câu hỏi gửi đi mang ĐÚNG đường dẫn đã mention, và KHÔNG kèm '@' trong tepMention", () => {
    const w = chayWebview();
    const oNhap = w.nut("o-nhap");
    oNhap.value = "@src/A";
    oNhap.selectionStart = oNhap.value.length;
    oNhap.kichHoat("input", {});
    w.banTin({ loai: "goi_y_mention", ds: ["src/A.ts"] });
    oNhap.kichHoat("keydown", { key: "Tab", preventDefault: () => undefined });

    w.nut("nut-gui").bam();

    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi).toHaveLength(1);
    expect(hoi[0].tepMention).toEqual(["src/A.ts"]);
    expect(hoi[0].cauHoi).not.toContain("@");
  });

  it("★★ chọn gợi ý xong rồi GỬI ⇒ danh sách mention của lượt SAU rỗng (không rò sang câu hỏi tiếp theo)", () => {
    const w = chayWebview();
    const oNhap = w.nut("o-nhap");
    oNhap.value = "@src/A";
    oNhap.selectionStart = oNhap.value.length;
    oNhap.kichHoat("input", {});
    w.banTin({ loai: "goi_y_mention", ds: ["src/A.ts"] });
    oNhap.kichHoat("keydown", { key: "Tab", preventDefault: () => undefined });
    w.nut("nut-gui").bam();

    oNhap.value = "câu hỏi tiếp theo, không mention gì";
    w.nut("nut-gui").bam();

    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi).toHaveLength(2);
    expect(hoi[1].tepMention).toEqual([]);
  });

  it("★ Escape đóng dropdown mà KHÔNG chèn gì vào ô nhập", () => {
    const w = chayWebview();
    const oNhap = w.nut("o-nhap");
    oNhap.value = "@src/A";
    oNhap.selectionStart = oNhap.value.length;
    oNhap.kichHoat("input", {});
    w.banTin({ loai: "goi_y_mention", ds: ["src/A.ts"] });
    expect(w.nut("mention-ds").hidden).toBe(false);

    oNhap.kichHoat("keydown", { key: "Escape", preventDefault: () => undefined });

    expect(w.nut("mention-ds").hidden).toBe(true);
    expect(oNhap.value).toBe("@src/A"); // KHÔNG chèn gì — Escape chỉ đóng dropdown.
  });

  it("★★ '@' KHÔNG đứng đầu và KHÔNG sau khoảng trắng (như email) ⇒ KHÔNG kích hoạt gợi ý", () => {
    const w = chayWebview();
    const oNhap = w.nut("o-nhap");
    oNhap.value = "lien he ten@mien.com";
    oNhap.selectionStart = oNhap.value.length;
    oNhap.kichHoat("input", {});

    expect(w.daGui.filter((m) => m.loai === "xin_goi_y_mention")).toHaveLength(0);
  });
});

/**
 * ★★★ H3(b) (review toàn nhánh 2026-08-30) — KẾT CỤC thật, chạy script THẬT của webview. Đây là
 * cách DUY NHẤT phía extension (`bangChat.ts`) biết một lượt "hoi" đến từ Cmd+K hay từ người dùng
 * tự gõ — nội dung `cauHoi` lúc đó trông giống hệt nhau. Sai ở TẦNG NÀY (quên đặt cờ, đặt cờ rồi
 * không reset, đặt cờ SAI THỜI ĐIỂM) sẽ không lộ ra ở lưới `bangChat.unit.test.ts` (lưới đó bơm
 * thẳng `tuLenh` vào tin nhắn, bỏ qua đúng khâu webview này).
 */
describe("webview — H3(b): cờ `tuLenh` đánh dấu ĐÚNG lượt đến từ Cmd+K", () => {
  it("★★★ `dat_cau_hoi_tu_lenh` (Cmd+K) ⇒ tin `hoi` gửi đi mang `tuLenh:true`", () => {
    const w = chayWebview();
    w.banTin({ loai: "dat_cau_hoi_tu_lenh", cauHoi: "Sửa đoạn mã sau..." });

    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi).toHaveLength(1);
    expect(hoi[0].cauHoi).toBe("Sửa đoạn mã sau...");
    expect(hoi[0].tuLenh).toBe(true);
  });

  it("★★ NHÁNH KIA: người dùng tự gõ rồi bấm Gửi ⇒ `tuLenh` KHÔNG phải `true`", () => {
    const w = chayWebview();
    const oNhap = w.nut("o-nhap");
    oNhap.value = "câu hỏi tự gõ, không qua Cmd+K";
    w.nut("nut-gui").bam();

    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi).toHaveLength(1);
    expect(hoi[0].tuLenh).not.toBe(true);
  });

  it("★★★ cờ KHÔNG dính: lượt Cmd+K xong, câu gõ tay KẾ TIẾP không được ăn theo `tuLenh:true` của lượt trước", () => {
    const w = chayWebview();
    w.banTin({ loai: "dat_cau_hoi_tu_lenh", cauHoi: "câu hỏi Cmd+K" });

    const oNhap = w.nut("o-nhap");
    oNhap.value = "câu hỏi tự gõ ngay sau đó";
    w.nut("nut-gui").bam();

    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi).toHaveLength(2);
    expect(hoi[0].tuLenh).toBe(true);
    expect(hoi[1].tuLenh).not.toBe(true);
  });
});

/**
 * ★★★ ĐỢT F / TASK 2 / B5 — khôi phục hội thoại: KẾT CỤC người dùng THẤY (bong bóng vẽ lại trong
 * khung), không chỉ "đã gửi tin đúng hình dạng". Cùng khuôn CHẠY THẬT script với hai nhóm ca trên.
 */
describe("webview — 'khoi_phuc_hoi_thoai' vẽ lại ĐÚNG bong bóng đã có trước khi đóng VSCode", () => {
  it("★★★ NHIỀU lượt user/assistant ⇒ MỖI lượt một bong bóng, ĐÚNG nhãn, ĐÚNG THỨ TỰ", () => {
    const w = chayWebview();
    w.banTin({
      loai: "khoi_phuc_hoi_thoai",
      luot: [
        { vaiTro: "user", noiDung: "Câu hỏi từ phiên trước" },
        { vaiTro: "assistant", noiDung: "Trả lời từ phiên trước" },
        { vaiTro: "user", noiDung: "Câu hỏi thứ hai" },
      ],
    });

    // ★★★ ĐỢT I / TASK I-5a — `xoaKhungChoPhienKhac` (chạy TRƯỚC khi vẽ lại) dựng lại `#rong-lan-dau`
    // rồi mỗi lượt `themLuot` sau đó tự ẨN nó (không xoá khỏi DOM) — nên nó vẫn là CON ĐẦU TIÊN của
    // `#hoi-thoai`, chỉ với `hidden === true`. Lọc nó ra trước khi so bong bóng thật, đúng những gì
    // người dùng THẤY (một phần tử `hidden` không hiển thị, dù vẫn còn trong DOM).
    const bongBongThat = w.nut("hoi-thoai").con.filter((x) => x.id !== "rong-lan-dau");
    expect(bongBongThat).toHaveLength(3);
    expect(w.nut("hoi-thoai").con.find((x) => x.id === "rong-lan-dau")?.hidden).toBe(true);
    // Mỗi bong bóng (`d` trong `themLuot`) có ĐÚNG hai con: nhãn (`t`) rồi tới nội dung (`c`).
    expect(bongBongThat[0]!.con.map((x) => x.textContent)).toEqual(["Bạn", "Câu hỏi từ phiên trước"]);
    expect(bongBongThat[1]!.con.map((x) => x.textContent)).toEqual(["AI Local", "Trả lời từ phiên trước"]);
    expect(bongBongThat[2]!.con.map((x) => x.textContent)).toEqual(["Bạn", "Câu hỏi thứ hai"]);
  });

  it("★ NHÁNH KIA — mảng `luot` RỖNG (hoặc thiếu hẳn) ⇒ KHÔNG vẽ bong bóng nào, KHÔNG ném lỗi", () => {
    // ★★★ ĐỢT I / TASK I-5a — khôi phục một hội thoại 0 lượt (hoặc mảng vắng mặt) nghĩa là khung
    // THẬT SỰ trống ⇒ hướng dẫn lần-đầu phải HIỆN LẠI (NHÁNH KIA thứ hai của I-5a, cạnh "có lượt thì
    // ẩn") — không phải một khoảng trắng vô nghĩa khi #hoi-thoai không còn gì để vẽ.
    const w = chayWebview();
    expect(() => w.banTin({ loai: "khoi_phuc_hoi_thoai", luot: [] })).not.toThrow();
    expect(w.nut("hoi-thoai").con).toHaveLength(1);
    expect(w.nut("hoi-thoai").con[0]!.id).toBe("rong-lan-dau");
    expect(w.nut("hoi-thoai").con[0]!.hidden).toBe(false);
    expect(() => w.banTin({ loai: "khoi_phuc_hoi_thoai" })).not.toThrow();
    expect(w.nut("hoi-thoai").con).toHaveLength(1);
    expect(w.nut("hoi-thoai").con[0]!.hidden).toBe(false);
  });
});

/**
 * ★★★ ĐỢT F / TASK 3 / B3 — "Chat mới": KẾT CỤC là khung TRẮNG, kể cả khi phiên vừa rời còn treo
 * bong bóng, thẻ duyệt, nút Dừng đang hiện, hoặc một câu đang gõ dở. Cùng khuôn CHẠY THẬT script.
 */
describe("webview — ĐỢT F / TASK 3 / B3: tin 'chat_moi' xoá SẠCH khung", () => {
  it("★★★ có bong bóng + thẻ duyệt đang mở + nút Dừng đang hiện + câu gõ dở ⇒ 'chat_moi' xoá HẾT", () => {
    const w = chayWebview();
    // Dựng một "phiên đang sống": một lượt hỏi đã gửi (2 bong bóng: Bạn + AI Local rỗng), nút Dừng
    // đang hiện (gui() bật nó), rồi một thẻ duyệt đang mở.
    w.nut("o-nhap").value = "câu hỏi cũ";
    w.nut("nut-gui").bam();
    w.banTin({
      loai: "the_duyet",
      nhanNguon: "LOCAL · C:\\ws",
      nhanNut: "Ghi vào workspace",
      duong: "a.ts",
      tomTat: "+1 / −0",
      han: "",
    });
    expect(w.nut("hoi-thoai").con.length).toBeGreaterThan(0);
    expect(w.nut("the-duyet").hidden).toBe(false);
    expect(w.nut("nut-dung").hidden).toBe(false);
    // Một câu MỚI đang gõ dở, chưa gửi — phải bị xoá vì đây là phiên TRẮNG, không phải trạng thái
    // đăng nhập đổi (khác hẳn hàng rào B4 của Task 1, xem docblock `xoaKhungChoPhienKhac`).
    w.nut("o-nhap").value = "câu đang gõ dở, chưa bấm Gửi";

    w.banTin({ loai: "chat_moi" });

    // ★★★ ĐỢT I / TASK I-5a — "Chat mới" là khung THẬT SỰ trống (không lượt nào sắp được vẽ lại,
    // khác `khoi_phuc_hoi_thoai`) ⇒ hướng dẫn lần-đầu phải HIỆN LẠI, đúng NHÁNH KIA của I-5a. Đây
    // là phần tử DUY NHẤT còn lại trong `#hoi-thoai` sau khi "xoá HẾT" — không phải một khung rỗng
    // vô nghĩa mà một hướng dẫn có chủ đích.
    expect(w.nut("hoi-thoai").con).toHaveLength(1);
    expect(w.nut("hoi-thoai").con[0]!.id).toBe("rong-lan-dau");
    expect(w.nut("hoi-thoai").con[0]!.hidden).toBe(false);
    expect(w.nut("the-duyet").hidden).toBe(true);
    expect(w.nut("nut-dung").hidden).toBe(true);
    expect(w.nut("o-nhap").value).toBe("");
  });

  it("★ 'chat_moi' không ném lỗi khi khung ĐÃ trắng sẵn (rảnh, chưa hỏi gì)", () => {
    const w = chayWebview();
    expect(() => w.banTin({ loai: "chat_moi" })).not.toThrow();
    // ★★★ ĐỢT I / TASK I-5a — vẫn ĐÚNG MỘT phần tử: hướng dẫn lần-đầu (dựng lại, hiện).
    expect(w.nut("hoi-thoai").con).toHaveLength(1);
    expect(w.nut("hoi-thoai").con[0]!.id).toBe("rong-lan-dau");
  });

  it("★★ nút duyệt đang KHOÁ (chống bấm hai lần) từ phiên cũ ⇒ 'chat_moi' cũng MỞ KHOÁ lại", () => {
    // Nếu không mở khoá, một phiên MỚI mà lỡ nhận một thẻ duyệt MỚI (không nên xảy ra, nhưng đây là
    // hàng rào phòng thủ) sẽ thấy nút Duyệt bị khoá bởi quyết định của phiên đã rời từ lâu.
    const w = chayWebview();
    w.banTin({ loai: "the_duyet", nhanNguon: "LOCAL · C:\\ws", nhanNut: "Ghi vào workspace", duong: "a.ts", tomTat: "+1 / −0", han: "" });
    w.nut("nut-duyet").bam();
    expect(w.nut("nut-duyet").disabled).toBe(true);

    w.banTin({ loai: "chat_moi" });

    expect(w.nut("nut-duyet").disabled).toBe(false);
  });
});

/**
 * ★★★ ĐỢT F / TASK 3 / B4 — "Lịch sử": chọn một hội thoại khác PHẢI THAY THẾ nội dung đang hiện,
 * không nối thêm vào nó — nếu không, hai cuộc hội thoại không liên quan chồng lên nhau trên cùng
 * một khung và người dùng không thể phân biệt đâu là hội thoại vừa chọn.
 */
describe("webview — ĐỢT F / TASK 3 / B4: 'khoi_phuc_hoi_thoai' THAY THẾ nội dung phiên cũ", () => {
  it("★★★ đang hiện hội thoại A ⇒ chọn hội thoại B ⇒ khung chỉ còn ĐÚNG nội dung của B, không lẫn A", () => {
    const w = chayWebview();
    w.banTin({ loai: "khoi_phuc_hoi_thoai", luot: [{ vaiTro: "user", noiDung: "Câu hỏi của phiên A" }] });
    // ★★★ ĐỢT I / TASK I-5a — lọc bỏ `#rong-lan-dau` (dựng lại rồi tự ẨN NGAY bởi `themLuot` của
    // lượt vừa vẽ — xem docblock nhóm ca "NHIỀU lượt" ở trên) khỏi phép đếm bong bóng THẬT.
    const bongBongThat = () => w.nut("hoi-thoai").con.filter((x) => x.id !== "rong-lan-dau");
    expect(bongBongThat()).toHaveLength(1);

    w.banTin({
      loai: "khoi_phuc_hoi_thoai",
      luot: [
        { vaiTro: "user", noiDung: "Câu hỏi của phiên B" },
        { vaiTro: "assistant", noiDung: "Trả lời của phiên B" },
      ],
    });

    const bongBong = bongBongThat();
    expect(bongBong).toHaveLength(2);
    expect(bongBong.map((b) => b.con.map((x) => x.textContent))).toEqual([
      ["Bạn", "Câu hỏi của phiên B"],
      ["AI Local", "Trả lời của phiên B"],
    ]);
    // Không còn dấu vết nào của phiên A trong khung.
    expect(bongBong.some((b) => b.con.some((x) => x.textContent === "Câu hỏi của phiên A"))).toBe(false);
  });

  it("★ nạp một hội thoại khác cũng đóng thẻ duyệt/nút Dừng còn treo của phiên vừa rời", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi cũ";
    w.nut("nut-gui").bam();
    w.banTin({
      loai: "the_duyet",
      nhanNguon: "LOCAL · C:\\ws",
      nhanNut: "Ghi vào workspace",
      duong: "a.ts",
      tomTat: "+1 / −0",
      han: "",
    });
    expect(w.nut("the-duyet").hidden).toBe(false);
    expect(w.nut("nut-dung").hidden).toBe(false);

    w.banTin({ loai: "khoi_phuc_hoi_thoai", luot: [{ vaiTro: "user", noiDung: "Câu hỏi B" }] });

    expect(w.nut("the-duyet").hidden).toBe(true);
    expect(w.nut("nut-dung").hidden).toBe(true);
  });

  /**
   * ★★★ BẢN VÁ (2026-09-03, phán quyết cùng Đợt F / Task 4) — "Lịch sử" KHÔNG được xoá câu đang gõ
   * dở: Task 1 đã đặt nguyên tắc "câu hỏi đang gõ dở KHÔNG được mất"; xem lại một hội thoại cũ rồi
   * quay ra mà mất nháp là phá đúng nguyên tắc đó. Ca này là NHÁNH KIA của ca "chat_moi xoá HẾT ...
   * câu gõ dở" ở describe B3 phía trên — cùng một hành động của người dùng (đang gõ dở một câu),
   * hai lối vào khác nhau, hai kết cục PHẢI khác nhau.
   */
  it("★★★ NHÁNH KIA của 'chat_moi': đang gõ dở một câu ⇒ chọn 'Lịch sử' ⇒ nháp CÒN NGUYÊN", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "câu đang gõ dở, chưa bấm Gửi";

    w.banTin({ loai: "khoi_phuc_hoi_thoai", luot: [{ vaiTro: "user", noiDung: "Câu hỏi B" }] });

    expect(w.nut("o-nhap").value).toBe("câu đang gõ dở, chưa bấm Gửi");
  });
});

/**
 * ★★★ ĐỢT G / TASK G2 / B1 — markup TĨNH của nút đính kèm + danh sách đính kèm + thanh ngữ cảnh.
 * Bộ chọn THẬT (danh sách đã gạn + hộp thoại) nằm ở phía extension — xem lưới "webview" bên dưới
 * cho KẾT CỤC (chạy thật script).
 */
describe("dungHtmlBang — ĐỢT G / TASK G2 / B1-B3: markup tĩnh", () => {
  const html = dungHtmlBang({ nonce: "N" });

  it("★★★ có nút đính kèm, danh sách đính kèm MẶC ĐỊNH ẨN, thanh ngữ cảnh với ba nhãn ban đầu", () => {
    expect(html).toContain('id="nut-dinh-kem"');
    expect(html).toMatch(/<div id="ds-dinh-kem"[^>]*\bhidden\b/);
    expect(html).toContain('id="thanh-ngu-canh"');
    expect(html).toContain('id="tk-luot"');
    expect(html).toContain('id="tk-ky-tu"');
    expect(html).toContain('id="tk-dinh-kem"');
  });

  it("★★★ nhãn của thanh ngữ cảnh nói RÕ đây KHÔNG phải số token (tránh hiểu nhầm là % ngữ cảnh model)", () => {
    // ★★★ KHÔNG BỊA SỐ TOKEN — lưới khẳng định chính lời cảnh báo đó có mặt trên giao diện (title),
    // không chỉ có mặt trong bình luận mã mà không ai nhìn thấy lúc dùng thật.
    const m = html.match(/<div id="thanh-ngu-canh"\s+title="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("KHÔNG PHẢI số token");
  });
});

/**
 * ★★★ ĐỢT G / TASK G2 / B1+B2 — ĐÍNH KÈM TỆP: KẾT CỤC thật, chạy THẬT script (cùng khuôn "CHỐNG BẤM
 * HAI LẦN"/"@-mention" ở trên). Bộ chọn (hàng rào rời máy) không chạy được ở lớp webview THUẦN này —
 * xem `bangChat.unit.test.ts` (mock `showQuickPick`) cho lưới đó; ở đây chỉ đo webview THẬT SỰ dựng
 * danh sách/gỡ/hợp nhất `tepMention` đúng như KẾ HOẠCH B2 đòi.
 */
describe("webview — ĐỢT G / TASK G2 / B1+B2: danh sách tệp đính kèm", () => {
  it("★★★ bấm nút đính kèm ⇒ extension nhận ĐÚNG MỘT tin 'xin_dinh_kem'", () => {
    const w = chayWebview();
    w.nut("nut-dinh-kem").bam();
    expect(w.daGui.filter((m) => m.loai === "xin_dinh_kem")).toHaveLength(1);
  });

  it("★★★ nhận 'them_dinh_kem' ⇒ #ds-dinh-kem HIỆN, có ĐÚNG một mục mang tên tệp + nút gỡ", () => {
    const w = chayWebview();
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });

    expect(w.nut("ds-dinh-kem").hidden).toBe(false);
    const muc = w.nut("ds-dinh-kem").con;
    expect(muc).toHaveLength(1);
    // Mỗi mục có ĐÚNG hai con: nhãn (đường dẫn) rồi tới nút gỡ (đúng khuôn `themLuot`/thẻ duyệt).
    expect(muc[0]!.con[0]!.textContent).toBe("src/A.ts");
  });

  it("★★ đính kèm CÙNG một đường dẫn hai lần ⇒ chỉ MỘT mục (khử trùng lặp, không đẻ hai chip)", () => {
    const w = chayWebview();
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });
    expect(w.nut("ds-dinh-kem").con).toHaveLength(1);
  });

  it("★★★ gỡ MỘT tệp giữa nhiều tệp ⇒ CHỈ tệp đó biến mất, các tệp khác còn nguyên", () => {
    const w = chayWebview();
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });
    w.banTin({ loai: "them_dinh_kem", duong: "src/B.ts" });
    w.banTin({ loai: "them_dinh_kem", duong: "src/C.ts" });
    expect(w.nut("ds-dinh-kem").con).toHaveLength(3);

    // Nút gỡ là con THỨ HAI của mục "src/B.ts" (chỉ số 1 trong danh sách ba mục).
    const nutGoB = w.nut("ds-dinh-kem").con[1]!.con[1]!;
    nutGoB.bam();

    const conLai = w.nut("ds-dinh-kem").con.map((muc) => muc.con[0]!.textContent);
    expect(conLai).toEqual(["src/A.ts", "src/C.ts"]);
  });

  it("★★★ B2 NHÁNH KIA: gỡ tệp CUỐI CÙNG ⇒ #ds-dinh-kem tự ẨN, KHÔNG để lại khung rỗng lơ lửng", () => {
    const w = chayWebview();
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });
    expect(w.nut("ds-dinh-kem").hidden).toBe(false);

    const nutGo = w.nut("ds-dinh-kem").con[0]!.con[1]!;
    nutGo.bam();

    expect(w.nut("ds-dinh-kem").hidden).toBe(true);
    expect(w.nut("ds-dinh-kem").con).toHaveLength(0);
  });

  it("★★★ gửi câu hỏi ⇒ tepMention HỢP NHẤT @-mention (trong câu) VÀ tệp đính kèm (qua nút), khử trùng lặp", () => {
    const w = chayWebview();
    // Đính kèm "src/A.ts" qua NÚT.
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });
    // @-mention "src/B.ts" NGAY TRONG câu hỏi — nguồn KHÁC, phải có mặt CÙNG "src/A.ts".
    const oNhap = w.nut("o-nhap");
    oNhap.value = "xem giúp @src/B";
    oNhap.selectionStart = oNhap.value.length;
    oNhap.kichHoat("input", {});
    w.banTin({ loai: "goi_y_mention", ds: ["src/B.ts"] });
    oNhap.kichHoat("keydown", { key: "Tab", preventDefault: () => undefined });

    w.nut("nut-gui").bam();

    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi).toHaveLength(1);
    expect((hoi[0]!.tepMention as string[]).sort()).toEqual(["src/A.ts", "src/B.ts"]);
  });

  it("★ CÙNG một tệp đến từ CẢ HAI đường (đính kèm qua nút + @-mention trong câu) ⇒ tepMention chỉ mang nó MỘT LẦN", () => {
    const w = chayWebview();
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" }); // đính kèm qua nút
    const oNhap = w.nut("o-nhap");
    oNhap.value = "@src/A"; // mention CHÍNH tệp đã đính kèm
    oNhap.selectionStart = oNhap.value.length;
    oNhap.kichHoat("input", {});
    w.banTin({ loai: "goi_y_mention", ds: ["src/A.ts"] });
    oNhap.kichHoat("keydown", { key: "Tab", preventDefault: () => undefined });

    w.nut("nut-gui").bam();

    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi[0]!.tepMention).toEqual(["src/A.ts"]); // KHÔNG phải ["src/A.ts", "src/A.ts"]
  });

  it("★★★ tệp đính kèm SỐNG QUA NHIỀU LƯỢT GỬI — khác @-mention (bị xoá sau MỖI lượt gửi)", () => {
    const w = chayWebview();
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });

    w.nut("o-nhap").value = "câu hỏi 1";
    w.nut("nut-gui").bam();
    w.nut("o-nhap").value = "câu hỏi 2";
    w.nut("nut-gui").bam();

    const hoi = w.daGui.filter((m) => m.loai === "hoi");
    expect(hoi).toHaveLength(2);
    expect(hoi[0]!.tepMention).toEqual(["src/A.ts"]);
    expect(hoi[1]!.tepMention).toEqual(["src/A.ts"]); // vẫn còn ở lượt THỨ HAI
    // Danh sách hiển thị cũng còn nguyên — không tự gỡ sau khi gửi.
    expect(w.nut("ds-dinh-kem").hidden).toBe(false);
  });

  it("★★ 'chat_moi' xoá SẠCH danh sách đính kèm (thuộc về phiên VỪA RỜI)", () => {
    const w = chayWebview();
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });
    expect(w.nut("ds-dinh-kem").con).toHaveLength(1);

    w.banTin({ loai: "chat_moi" });

    expect(w.nut("ds-dinh-kem").hidden).toBe(true);
    expect(w.nut("ds-dinh-kem").con).toHaveLength(0);
  });

  it("★★ 'khoi_phuc_hoi_thoai' (mở một hội thoại KHÁC ở Lịch sử) cũng xoá đính kèm của phiên vừa rời", () => {
    const w = chayWebview();
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });
    expect(w.nut("ds-dinh-kem").con).toHaveLength(1);

    w.banTin({ loai: "khoi_phuc_hoi_thoai", luot: [{ vaiTro: "user", noiDung: "câu hỏi hội thoại khác" }] });

    expect(w.nut("ds-dinh-kem").hidden).toBe(true);
    expect(w.nut("ds-dinh-kem").con).toHaveLength(0);
  });
});

/**
 * ★★★ ĐỢT G / TASK G2 / B3 — THANH TRẠNG THÁI NGỮ CẢNH: nhãn phải khớp ĐÚNG thứ đang đếm. Ba ca
 * đầu dùng BA GIÁ TRỊ KHÁC NHAU cho ba nguồn (lượt/ký tự/tệp đính kèm) rồi kiểm TỪNG span RIÊNG —
 * nếu một bản vá lỡ đổi đơn vị đếm mà không đổi nhãn (hoặc gán NHẦM số của nguồn này cho nhãn của
 * nguồn khác), một trong ba khẳng định dưới đây phải ĐỎ vì ba con số không hề trùng nhau.
 */
describe("webview — ĐỢT G / TASK G2 / B3: thanh ngữ cảnh — nhãn khớp ĐÚNG nguồn đang đếm", () => {
  it("★★★ 'hoan_tat' mang soLuot/soKyTu ⇒ #tk-luot và #tk-ky-tu hiện ĐÚNG từng số, KHÔNG lẫn nhau", () => {
    const w = chayWebview();
    w.banTin({ loai: "hoan_tat", vanBanCuoi: null, canhBao: null, soLuot: 7, soKyTu: 4213 });

    expect(w.nut("tk-luot").textContent).toBe("Lượt hội thoại: 7");
    expect(w.nut("tk-ky-tu").textContent).toBe("Ký tự lịch sử: 4213");
    // ★ CHỐNG TỰ THOẢ: hai số 7 và 4213 KHÁC HẲN nhau — một bản vá lỡ gán CHÉO (soKyTu vào #tk-luot
    // hay ngược lại) sẽ làm MỘT trong hai khẳng định trên đỏ, không thể tự thoả bằng cách trùng số.
    expect(w.nut("tk-dinh-kem").textContent).toBe("Tệp đính kèm: 0"); // KHÔNG đổi — nguồn khác hẳn
  });

  it("★★★ đính kèm tệp ⇒ CHỈ #tk-dinh-kem đổi, #tk-luot/#tk-ky-tu KHÔNG bị đụng tới (độc lập nguồn)", () => {
    const w = chayWebview();
    w.banTin({ loai: "hoan_tat", vanBanCuoi: null, canhBao: null, soLuot: 3, soKyTu: 99 });
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });
    w.banTin({ loai: "them_dinh_kem", duong: "src/B.ts" });

    expect(w.nut("tk-dinh-kem").textContent).toBe("Tệp đính kèm: 2");
    expect(w.nut("tk-luot").textContent).toBe("Lượt hội thoại: 3");
    expect(w.nut("tk-ky-tu").textContent).toBe("Ký tự lịch sử: 99");
  });

  it("★★ 'chat_moi' đưa CẢ BA về ĐÚNG 0 — khớp khung TRẮNG THẬT (kể cả đính kèm vừa có trước đó)", () => {
    const w = chayWebview();
    w.banTin({ loai: "hoan_tat", vanBanCuoi: null, canhBao: null, soLuot: 5, soKyTu: 500 });
    w.banTin({ loai: "them_dinh_kem", duong: "src/A.ts" });

    w.banTin({ loai: "chat_moi", soLuot: 0, soKyTu: 0 });

    expect(w.nut("tk-luot").textContent).toBe("Lượt hội thoại: 0");
    expect(w.nut("tk-ky-tu").textContent).toBe("Ký tự lịch sử: 0");
    expect(w.nut("tk-dinh-kem").textContent).toBe("Tệp đính kèm: 0");
  });

  it("★★★ 'khoi_phuc_hoi_thoai' mang thống kê của HỘI THOẠI VỪA MỞ — không phải 0, không phải của phiên trước", () => {
    const w = chayWebview();
    w.banTin({ loai: "hoan_tat", vanBanCuoi: null, canhBao: null, soLuot: 9, soKyTu: 900 });

    w.banTin({
      loai: "khoi_phuc_hoi_thoai",
      luot: [{ vaiTro: "user", noiDung: "câu hỏi cũ" }],
      soLuot: 2,
      soKyTu: 250,
    });

    expect(w.nut("tk-luot").textContent).toBe("Lượt hội thoại: 2");
    expect(w.nut("tk-ky-tu").textContent).toBe("Ký tự lịch sử: 250");
  });
});

/**
 * ★★★ ĐỢT G / TASK G3 / B4 — MARKUP TĨNH của ô chọn mức quyền: đúng BA \`<option>\`, mặc định AN
 * TOÀN "Hỏi trước khi ghi" được \`selected\` NGAY TỪ HTML TĨNH (trước khi bất kỳ script nào chạy).
 */
describe("dungHtmlBang — ĐỢT G / TASK G3 / B4: markup ô chọn mức quyền", () => {
  const html = dungHtmlBang({ nonce: "N" });

  it("★★★ có ĐÚNG BA option với giá trị khớp `MucQuyen`", () => {
    expect(html).toContain('id="o-muc-quyen"');
    expect(html).toContain('<option value="chi_doc">Chỉ đọc</option>');
    expect(html).toContain('<option value="hoi_truoc_khi_ghi" selected>Hỏi trước khi ghi</option>');
    expect(html).toContain('<option value="tu_ghi">Tự ghi trong workspace</option>');
  });

  it("★★★ MẶC ĐỊNH TĨNH là 'hoi_truoc_khi_ghi' — AN TOÀN LÀ MẶC ĐỊNH, không phải 'tu_ghi'", () => {
    // Đúng MỘT thuộc tính `selected` trong cả markup — và nó phải rơi đúng vào mức an toàn.
    const soLanSelected = (html.match(/ selected(?=[ >])/g) ?? []).length;
    expect(soLanSelected).toBe(1);
    expect(html).toMatch(/<option value="hoi_truoc_khi_ghi" selected>/);
    expect(html).not.toMatch(/<option value="tu_ghi" selected>/);
    expect(html).not.toMatch(/<option value="chi_doc" selected>/);
  });
});

/**
 * ★★★ ĐỢT G / TASK G3 / B4 — WEBVIEW: KẾT CỤC thật (chạy script THẬT, cùng khuôn "CHỐNG BẤM HAI
 * LẦN"/"@-mention" ở trên) cho ô chọn mức quyền.
 *
 * ⚠ Webview KHÔNG PHẢI hàng rào (xem ghi chú tại markup \`#o-muc-quyen\` trong \`htmlBang.ts\`) — lưới
 *   ở đây chỉ đo đúng phần việc của webview: CHUYỂN TIẾP ý định đổi mức, và HIỂN THỊ mức được
 *   extension xác nhận. Hàng rào THẬT (mức "Chỉ đọc" chặn tại điểm ghi) có lưới RIÊNG trên đĩa THẬT
 *   ở \`ui/apBanVa.mucQuyen.unit.test.ts\`.
 */
describe("webview — ĐỢT G / TASK G3 / B4: ô chọn mức quyền", () => {
  it("★★★ đổi ô chọn ⇒ extension nhận ĐÚNG MỘT tin 'dat_muc_quyen' mang giá trị vừa chọn", () => {
    const w = chayWebview();
    w.nut("o-muc-quyen").value = "tu_ghi";
    w.nut("o-muc-quyen").kichHoat("change", { target: { value: "tu_ghi" } });

    const tin = w.daGui.filter((m) => m.loai === "dat_muc_quyen");
    expect(tin).toHaveLength(1);
    expect(tin[0].mucQuyen).toBe("tu_ghi");
  });

  it("★★★ nhận 'muc_quyen' HỢP LỆ ⇒ ô chọn cập nhật ĐÚNG giá trị extension xác nhận", () => {
    const w = chayWebview();
    w.banTin({ loai: "muc_quyen", mucQuyen: "chi_doc" });
    expect(w.nut("o-muc-quyen").value).toBe("chi_doc");

    w.banTin({ loai: "muc_quyen", mucQuyen: "tu_ghi" });
    expect(w.nut("o-muc-quyen").value).toBe("tu_ghi");
  });

  it("★ NHÁNH KIA — 'muc_quyen' mang giá trị KHÔNG HỢP LỆ (tin giả mạo/webview khác lỗi) ⇒ BỊ BỎ QUA, ô chọn GIỮ NGUYÊN", () => {
    const w = chayWebview();
    w.banTin({ loai: "muc_quyen", mucQuyen: "chi_doc" });
    expect(w.nut("o-muc-quyen").value).toBe("chi_doc");

    w.banTin({ loai: "muc_quyen", mucQuyen: "vo_han_quyen_luc" });
    // Giá trị TRƯỚC ĐÓ phải còn nguyên — một chuỗi lạ không được phép đổi ô chọn.
    expect(w.nut("o-muc-quyen").value).toBe("chi_doc");
  });
});

/**
 * ★★★ PHÂN BIỆT CÂU HỎI / TRẢ LỜI (B1-B5) — CSS tĩnh: lớp `.luot-*` phải tồn tại, phải khác nhau
 * theo vai, và chỉ lấy màu từ biến `--vscode-*` (KHÔNG hardcode mã hex) để đọc đúng ở cả hai theme.
 *
 * ⚠ Đo trên ĐÚNG đoạn CSS mới thêm (giữa dấu mốc `.luot {` và hết `.luot-he-thong { … }`) — không
 *   quét toàn bộ `<style>` (phần cũ có `rgba(128,128,128,.2)` làm nền dự phòng, không thuộc phạm vi
 *   yêu cầu B4 "phần CSS mới").
 */
describe("dungHtmlBang — phân biệt câu hỏi/trả lời: CSS lớp .luot-*", () => {
  const html = dungHtmlBang({ nonce: "N" });
  const batDau = html.indexOf(".luot { margin-bottom");
  const ketThuc = html.indexOf(".nhan { opacity");
  const cssMoi = html.slice(batDau, ketThuc);

  it("★★★ có ĐỦ BA lớp vai, mỗi lớp một `border-left-color` KHÁC NHAU", () => {
    expect(cssMoi).toContain(".luot-nguoi-dung");
    expect(cssMoi).toContain(".luot-ai");
    expect(cssMoi).toContain(".luot-he-thong");
    // Khớp nguyên khối `.luot-<vai> { … border-left-color: var(--vscode-X); … }` cho từng vai, X
    // phải khác nhau — nếu hai vai TRÙNG biến, thị giác sẽ trùng nhau y hệt bug đang được vá.
    const layMauVienTrai = (lop: string): string => {
      const m = cssMoi.match(new RegExp("\\." + lop + "[^}]*border-left-color:\\s*var\\((--vscode-[a-zA-Z.-]+)"));
      expect(m, `không tìm thấy border-left-color var(--vscode-...) cho ${lop}`).not.toBeNull();
      return m![1];
    };
    const mauNguoiDung = layMauVienTrai("luot-nguoi-dung");
    const mauAi = layMauVienTrai("luot-ai");
    const mauHeThong = layMauVienTrai("luot-he-thong");
    expect(new Set([mauNguoiDung, mauAi, mauHeThong]).size).toBe(3);
  });

  it("★★★ KHÔNG hardcode mã màu #rrggbb trong phần CSS mới — chỉ biến `--vscode-*`", () => {
    expect(cssMoi).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Ít nhất bốn tham chiếu `var(--vscode-…)` (2 cho người dùng: nền+viền, 1 cho AI, 1 cho hệ
    // thống) — một con số THẤP là dấu hiệu ai đó đã âm thầm thay một biến bằng giá trị cứng.
    const soLanVar = (cssMoi.match(/var\(--vscode-/g) ?? []).length;
    expect(soLanVar).toBeGreaterThanOrEqual(4);
  });

  it("★ NHÁNH KIA — tên biến theme dùng phải THẬT SỰ tồn tại trong danh sách gợi ý của kế hoạch", () => {
    // Không đo được bảng màu thật của VSCode ở lưới đơn vị (không có `vscode` API) — nhưng đo được
    // rằng ta không bịa một tên KHÔNG nằm trong tập biến kế hoạch đã liệt kê/đã dùng nơi khác trong
    // CHÍNH tệp này (nơi khác dùng ⇒ chắc chắn đã từng chạy được trong webview thật).
    for (const bien of ["--vscode-textBlockQuote-background", "--vscode-focusBorder",
      "--vscode-textBlockQuote-border", "--vscode-descriptionForeground"]) {
      expect(cssMoi).toContain(bien);
    }
  });
});

/**
 * ★★★ PHÂN BIỆT CÂU HỎI / TRẢ LỜI (B1+B5) — KẾT CỤC THẬT: chạy script (cùng khuôn `chayWebview` ở
 * trên), không chỉ soi chữ trong HTML tĩnh. Đo đúng những gì B5 đòi: lịch sử khôi phục, streaming,
 * bong bóng lỗi/thông báo KHÔNG bị nhầm thành câu trả lời AI.
 */
describe("webview — phân biệt câu hỏi/trả lời bằng VAI (class + nhãn cùng một nguồn)", () => {
  it("★★★ B1 — hỏi rồi nhận bong bóng AI: HAI lớp KHÁC NHAU, nhãn ĐÚNG vai", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi của tôi";
    w.nut("nut-gui").bam();

    const bongBong = w.nut("hoi-thoai").con;
    expect(bongBong).toHaveLength(2);
    expect(bongBong[0]!.className).toBe("luot luot-nguoi-dung");
    expect(bongBong[1]!.className).toBe("luot luot-ai");
    expect(bongBong[0]!.className).not.toBe(bongBong[1]!.className);
    // Nhãn (con đầu của mỗi bong bóng) vẫn đúng chữ cũ — B1 đổi CƠ CHẾ truyền vai, KHÔNG đổi chữ
    // người dùng thấy.
    expect(bongBong[0]!.con[0]!.textContent).toBe("Bạn");
    expect(bongBong[1]!.con[0]!.textContent).toBe("AI Local");
  });

  it("★★★ B5 (streaming) — token đổ về từng mảnh vẫn nối vào ĐÚNG bong bóng AI, lớp KHÔNG đổi", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "hỏi gì đó";
    w.nut("nut-gui").bam();
    const bongBongAi = w.nut("hoi-thoai").con[1]!;
    expect(bongBongAi.className).toBe("luot luot-ai");

    w.banTin({ loai: "token", chu: "Phần " });
    w.banTin({ loai: "token", chu: "một." });

    // Vẫn CÙNG một bong bóng (không đẻ thêm bong bóng mới cho mỗi mảnh token).
    expect(w.nut("hoi-thoai").con).toHaveLength(2);
    expect(bongBongAi.className).toBe("luot luot-ai");
    expect(bongBongAi.con[1]!.textContent).toBe("Phần một.");
  });

  it("★★★ B5 (nhánh kia) — khôi phục LỊCH SỬ: mỗi lượt `user`/`assistant` ra ĐÚNG lớp theo vai", () => {
    const w = chayWebview();
    w.banTin({
      loai: "khoi_phuc_hoi_thoai",
      luot: [
        { vaiTro: "user", noiDung: "Câu hỏi cũ" },
        { vaiTro: "assistant", noiDung: "Trả lời cũ" },
      ],
    });
    // ★★★ ĐỢT I / TASK I-5a — lọc `#rong-lan-dau` (dựng lại rồi tự ẩn ngay khi lượt đầu được vẽ).
    const bongBong = w.nut("hoi-thoai").con.filter((x) => x.id !== "rong-lan-dau");
    expect(bongBong[0]!.className).toBe("luot luot-nguoi-dung");
    expect(bongBong[1]!.className).toBe("luot luot-ai");
  });

  it("★★★ B5 (nhánh kia) — bong bóng LỖI mang vai THỨ BA, KHÔNG bị ép vào lớp của AI/người dùng", () => {
    const w = chayWebview();
    w.banTin({ loai: "loi", thongDiep: "Không nối được máy chủ" });

    const bongBong = w.nut("hoi-thoai").con;
    expect(bongBong).toHaveLength(1);
    expect(bongBong[0]!.className).toBe("luot luot-he-thong");
    expect(bongBong[0]!.className).not.toBe("luot luot-ai");
    expect(bongBong[0]!.className).not.toBe("luot luot-nguoi-dung");
    expect(bongBong[0]!.con[0]!.textContent).toBe("Lỗi");
  });

  it("★★★ B5 (nhánh kia) — bong bóng THÔNG BÁO cũng mang vai thứ ba (không phải AI)", () => {
    const w = chayWebview();
    w.banTin({ loai: "thong_bao", thongDiep: "Đề xuất vẫn còn hiệu lực" });

    const bongBong = w.nut("hoi-thoai").con;
    expect(bongBong[0]!.className).toBe("luot luot-he-thong");
    expect(bongBong[0]!.con[0]!.textContent).toBe("Thông báo");
  });

  it("★★★ B5 (nhánh kia) — LƯU Ý (cảnh báo cắt ngang trong `hoan_tat`) cũng vai thứ ba", () => {
    const w = chayWebview();
    w.banTin({ loai: "hoan_tat", canhBao: "Bị dừng giữa chừng" });

    const bongBong = w.nut("hoi-thoai").con;
    expect(bongBong[0]!.className).toBe("luot luot-he-thong");
    expect(bongBong[0]!.con[0]!.textContent).toBe("Lưu ý");
  });
});

/**
 * ★★★ ĐỢT I / TASK I-1a+I-1b — CHỈ BÁO ĐANG CHẠY: kết cục, không chỉ cơ chế. Bong bóng AI vừa tạo
 * (chưa có token nào) phải mang một PHẦN TỬ chỉ báo (`cho-ai`, ba chấm nhấp nháy CSS) làm CON của
 * `khoiTraLoi` (chính `c` trong `themLuot`, chỗ `bongBong[1].con[1]` giữ). I-1b là NHÁNH KIA và là
 * chỗ dễ sai nhất theo brief: lưới BỐN kết cục riêng biệt (xong · dừng · lỗi · mất kết nối) phải
 * đều xoá chỉ báo — một spinner không tắt còn tệ hơn không có spinner.
 */
describe("webview — ĐỢT I / TASK I-1: chỉ báo ĐANG CHẠY trong bong bóng AI", () => {
  /** Bong bóng AI của lượt vừa gửi — `con[1]` là `c` (nội dung), `con[1].con[1]` là chỉ báo (sau
   *  nhãn "AI Local" ở `con[0]`, chỉ báo là con THỨ HAI của `c`, đứng sau `t`... — thực ra chỉ báo
   *  là con của `c` chứ không phải của `d`; xem `khoiTraLoi.appendChild(choAiHienTai)` trong
   *  htmlBang.ts). `c` chính là `bongBongAi.con[1]` (d.appendChild(t) rồi d.appendChild(c)). */
  function choAiCuaBongBongAi(w: ReturnType<typeof chayWebview>) {
    const bongBongAi = w.nut("hoi-thoai").con.find((x) => x.id !== "rong-lan-dau" && x.className === "luot luot-ai")!;
    const noiDungAi = bongBongAi.con[1]!; // c — xem themLuot: d.appendChild(t); d.appendChild(c)
    return noiDungAi.con[0]; // choAiHienTai — phần tử DUY NHẤT được appendChild vào c lúc tạo
  }

  it("★★★ I-1a — gửi câu hỏi ⇒ bong bóng AI có NGAY chỉ báo ba-chấm (KHÔNG rỗng-im-lìm)", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi";
    w.nut("nut-gui").bam();

    const choAi = choAiCuaBongBongAi(w);
    expect(choAi).toBeDefined();
    expect(choAi!.className).toBe("cho-ai");
    // Ba chấm — CSS `@keyframes` tự chạy trên MỖI span con, không phải một JS timer nào ở đây.
    expect(choAi!.con).toHaveLength(3);
  });

  it("★★★ I-1a — `thong_bao` (tiến độ CÓ NGHĨA) ĐỔI chữ chỉ báo, KHÔNG xoá nó khỏi bong bóng hệ thống", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi cần đọc tệp";
    w.nut("nut-gui").bam();

    w.banTin({ loai: "thong_bao", thongDiep: "vòng 2/3 — đang đọc tệp \"a.ts\"" });

    const choAi = choAiCuaBongBongAi(w);
    expect(choAi!.className).toBe("cho-ai-chu");
    expect(choAi!.textContent).toBe('vòng 2/3 — đang đọc tệp "a.ts"');
    // NHÁNH KIA — sổ tiến trình đầy đủ (bong bóng hệ thống) vẫn giữ NGUYÊN, không bị thay bằng
    // chỉ báo trong bong bóng AI: đây là một BẢN TÓM TẮT thêm, không phải một đường thay thế.
    const bongBongHeThong = w.nut("hoi-thoai").con.filter((x) => x.className === "luot luot-he-thong");
    expect(bongBongHeThong).toHaveLength(1);
    expect(bongBongHeThong[0]!.con[1]!.textContent).toBe('vòng 2/3 — đang đọc tệp "a.ts"');
  });

  /**
   * ★★★ QA "kết cục thứ NĂM" (2026-09-06, `qa-toan-module.md` §1) — BẤT BIẾN thật của I-1b KHÔNG
   * PHẢI "bốn loại tin nhắn cụ thể xoá chỉ báo" (một danh sách ĐÓNG — đúng cách audit gốc đặt tên
   * các ca dưới đây, `N/4`), mà là:
   *
   *   ★ CHỈ BÁO CHỜ-AI PHẢI BIẾN MẤT Ở MỌI ĐƯỜNG KẾT THÚC PHIÊN ĐANG HIỂN THỊ NÓ — bất kể đường đó
   *     là tin từ SERVER (token/hoan_tat/loi) hay một HÀNH ĐỘNG CỦA NGƯỜI DÙNG khiến webview rời
   *     khỏi phiên đó (Chat mới/Lịch sử) — KHÔNG một chỉ báo mồ côi nào được phép sống sót để bị
   *     tin nhắn TỚI MUỘN của phiên cũ ghi đè lên phiên MỚI.
   *
   * Danh sách MỌI đường kết thúc đã biết tính tới nay (đặt tên theo đường, không theo số thứ tự —
   * một danh sách có thể mọc thêm phần tử thứ N+1 mà không ai đổi TÊN lưới, đúng bài học Khối D):
   *   1. XONG — token đầu tiên tới.
   *   2. XONG, KHÔNG STREAM — `hoan_tat` mang thẳng `vanBanCuoi` (degraded), không token nào trước đó.
   *   3. DỪNG — người dùng bấm nút Dừng, rồi `hoan_tat` xác nhận.
   *   4. LỖI / MẤT KẾT NỐI — `loi` (kèm hoặc không `moSettings`).
   *   5. ĐỔI PHIÊN GIỮA LÚC ĐANG CHẠY — "Chat mới" hoặc "Lịch sử" trong khi lượt cũ chưa có kết cục
   *      nào ở trên (đây LÀ lỗi QA vừa bắt: `xoaKhungChoPhienKhac` không hề dọn `choAiHienTai`).
   *
   * Đây KHÔNG phải trần cuối cùng — bất kỳ đường thoát MỚI nào (ví dụ một loại tin nhắn tương lai)
   * đều phải cộng thêm một ca ở ĐÚNG hình dạng này, đặt tên theo TÊN đường, không theo số thứ tự.
   */
  it("★★★ ĐƯỜNG KẾT THÚC 'XONG' — token đầu tiên XOÁ chỉ báo, chữ thật ghi vào ĐÚNG chỗ", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi";
    w.nut("nut-gui").bam();
    expect(choAiCuaBongBongAi(w)).toBeDefined();

    w.banTin({ loai: "token", chu: "Đây là " });

    expect(choAiCuaBongBongAi(w)).toBeUndefined();
    const bongBongAi = w.nut("hoi-thoai").con.find((x) => x.className === "luot luot-ai")!;
    expect(bongBongAi.con[1]!.textContent).toBe("Đây là ");
  });

  it("★★★ ĐƯỜNG KẾT THÚC 'XONG, KHÔNG STREAM' — `hoan_tat` không kèm token nào cũng XOÁ chỉ báo", () => {
    // Ca CÓ THẬT: câu trả lời degraded thay hẳn bằng `vanBanCuoi` mà KHÔNG một token nào từng đổ về
    // trước đó (xem `bangChat.ts`, nhánh degraded gửi thẳng `hoan_tat` mà không stream token).
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi";
    w.nut("nut-gui").bam();
    expect(choAiCuaBongBongAi(w)).toBeDefined();

    w.banTin({ loai: "hoan_tat", vanBanCuoi: "Câu trả lời thay thế" });

    expect(choAiCuaBongBongAi(w)).toBeUndefined();
    const bongBongAi = w.nut("hoi-thoai").con.find((x) => x.className === "luot luot-ai")!;
    expect(bongBongAi.con[1]!.textContent).toBe("Câu trả lời thay thế");
    expect(w.nut("nut-dung").hidden).toBe(true);
  });

  it("★★★ ĐƯỜNG KẾT THÚC 'DỪNG' — nút Dừng bấm ⇒ `hoan_tat` sau đó vẫn XOÁ chỉ báo, không quay mãi", () => {
    // Đường SERVER/LOCAL đều gửi `hoan_tat` sau khi báo 'đã dừng' — xem docblock `bangChat.ts`. Chỉ
    // báo phải biến mất Ở ĐÂY hệt như đường "xong bình thường" — đây CHÍNH LÀ nhánh brief cảnh báo
    // "một spinner không bao giờ tắt còn tệ hơn không có spinner".
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi dài";
    w.nut("nut-gui").bam();
    expect(choAiCuaBongBongAi(w)).toBeDefined();

    w.nut("nut-dung").bam(); // báo Ý ĐỊNH dừng — extension xử lý huỷ SSE thật, webview chỉ chờ tin về
    expect(w.daGui.filter((m) => m.loai === "dung_hoi")).toHaveLength(1);
    // Chỉ báo vẫn còn TRONG LÚC chờ extension xác nhận đã dừng xong (webview không tự đoán).
    expect(choAiCuaBongBongAi(w)).toBeDefined();

    w.banTin({ loai: "hoan_tat", vanBanCuoi: null });

    expect(choAiCuaBongBongAi(w)).toBeUndefined();
    expect(w.nut("nut-dung").hidden).toBe(true);
  });

  it("★★★ ĐƯỜNG KẾT THÚC 'LỖI' — `loi` (lỗi máy chủ thường) XOÁ chỉ báo", () => {
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi";
    w.nut("nut-gui").bam();
    expect(choAiCuaBongBongAi(w)).toBeDefined();

    w.banTin({ loai: "loi", thongDiep: "Máy chủ báo lỗi 500." });

    expect(choAiCuaBongBongAi(w)).toBeUndefined();
    expect(w.nut("nut-dung").hidden).toBe(true);
  });

  it("★★★ ĐƯỜNG KẾT THÚC 'MẤT KẾT NỐI' — `loi` kèm `moSettings:true` cũng XOÁ chỉ báo", () => {
    // Mất-kết-nối-máy-chủ đi qua ĐÚNG cùng loại tin `loi` với `moSettings:true` (không có một loại
    // tin riêng cho "mất kết nối" — xem `bangChat.ts#laLoiKhongNoiDuocMayChu`), nên đây là ca RIÊNG
    // BIỆT với "LỖI" ở trên theo brief (bốn kết cục: xong/dừng/lỗi/mất kết nối), dù cùng nhánh mã.
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi";
    w.nut("nut-gui").bam();
    expect(choAiCuaBongBongAi(w)).toBeDefined();

    w.banTin({ loai: "loi", thongDiep: "Không nối được máy chủ.", moSettings: true });

    expect(choAiCuaBongBongAi(w)).toBeUndefined();
    expect(w.nut("nut-dung").hidden).toBe(true);
  });

  it("★★★ ĐƯỜNG KẾT THÚC 'ĐỔI PHIÊN GIỮA LÚC ĐANG CHẠY' (kết cục thứ NĂM, QA 2026-09-06) — 'Chat mới' XOÁ chỉ báo mồ côi, tin `thong_bao` TỚI MUỘN của phiên cũ KHÔNG được ghi vào node mồ côi đó", () => {
    // Kịch bản QA đo được NGUYÊN VĂN (đúng thứ tự): hỏi câu A (vòng ≥2, chỉ báo còn "ba chấm" — CHƯA
    // có token nào tới) → bấm "Chat mới" GIỮA LÚC đang chờ → luồng SSE cũ của A "bay muộn" và bắn một
    // `thong_bao` tiến độ TRƯỚC KHI người dùng kịp gõ câu B. Trước bản vá, `xoaKhungChoPhienKhac`
    // không gọi `xoaChiBaoChoAi()` nên `choAiHienTai` (biến closure, KHÔNG phải con mà `innerHTML=""`
    // biết dọn) vẫn trỏ vào chỉ báo mồ côi của phiên A — `thong_bao` muộn ghi ĐÈ đúng vào node đó.
    //
    // ★ CHÚ Ý THỨ TỰ: bài lưới TRƯỚC (rút gọn) gửi tin muộn SAU KHI đã gõ câu B — nhưng `gui()` (xử
    // lý nút Gửi) tự gọi `xoaChiBaoChoAi()` Ở ĐẦU (dọn "chỉ báo lượt TRƯỚC nếu còn sót vì lý do bất
    // thường" — xem docblock tại đó) TRƯỚC KHI tạo chỉ báo của B, nên nó VÔ TÌNH dọn luôn node mồ côi
    // và CHE MẤT lỗ hổng thật của `xoaKhungChoPhienKhac` (xác nhận bằng đột biến: gỡ dòng
    // `xoaChiBaoChoAi()` khỏi `xoaKhungChoPhienKhac` KHÔNG làm ca cũ đỏ). Ca ĐÚNG phải đo NGAY SAU
    // 'chat_moi', TRƯỚC khi có bất kỳ `gui()` nào khác chạy — đúng thời điểm QA mô tả.
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi A — vòng đang chạy";
    w.nut("nut-gui").bam();
    const choAiPhienA = choAiCuaBongBongAi(w);
    expect(choAiPhienA, "phiên A phải có chỉ báo trước khi bị đổi phiên").toBeDefined();
    // Phiên A CHƯA có kết cục nào (không token, không hoan_tat, không loi) — đúng khe hở QA mô tả.

    w.banTin({ loai: "chat_moi", soLuot: 0, soKyTu: 0 }); // "Chat mới" — dựng lại DOM cho khung TRẮNG

    // Bong bóng AI của phiên A đã bị `innerHTML=""` xoá khỏi DOM — khung giờ TRẮNG (chỉ còn hướng
    // dẫn rỗng lần đầu, không còn bong bóng "luot-ai" nào).
    expect(w.nut("hoi-thoai").con.some((x) => x.className === "luot luot-ai")).toBe(false);

    // ★★★ TIN `thong_bao` MUỘN của luồng SSE cũ (phiên A) "bay" tới NGAY SAU 'chat_moi' — TRƯỚC khi
    // người dùng kịp gõ/gửi câu B (đúng thứ tự QA đo được thật). Nếu `xoaKhungChoPhienKhac` không tự
    // dọn `choAiHienTai`, tin này ghi THẲNG vào node mồ côi của phiên A — TRỤC ĐO của ca này là node
    // đó phải BẤT ĐỘNG trước tin muộn (dù ở lớp extension đã có hàng rào `aborted` chặn từ NGUỒN, ca
    // này đo LỚP PHÒNG THỦ THỨ HAI ở webview một cách ĐỘC LẬP — hai lớp phải cùng đứng vững).
    w.banTin({ loai: "thong_bao", thongDiep: "vòng 2/3 — đang đọc tệp a.ts" });

    expect(
      choAiPhienA!.className,
      "node mồ côi của phiên A KHÔNG được đổi className bởi tin thong_bao muộn",
    ).toBe("cho-ai");
    expect(choAiPhienA!.textContent, "node mồ côi của phiên A KHÔNG được đổi textContent").toBe("");

    // NHÁNH KIA — người dùng sau đó gõ câu B: phiên B phải có chỉ báo CỦA RIÊNG nó, không tái dùng
    // node mồ côi, và tin thong_bao TIẾP THEO phải cập nhật ĐÚNG chỉ báo của B.
    w.nut("o-nhap").value = "câu hỏi B — phiên mới";
    w.nut("nut-gui").bam();
    const choAiPhienB = choAiCuaBongBongAi(w);
    expect(choAiPhienB, "phiên B phải có chỉ báo CỦA RIÊNG nó").toBeDefined();
    expect(choAiPhienB).not.toBe(choAiPhienA); // hai node KHÁC NHAU — không tái dùng node mồ côi

    w.banTin({ loai: "thong_bao", thongDiep: "vòng 2/3 — đang đọc tệp b.ts" });
    // ĐÚNG NHƯ THIẾT KẾ CÓ SẴN (I-1a): tin `thong_bao` cập nhật chỉ báo CỦA PHIÊN ĐANG HIỆN (B).
    expect(choAiPhienB!.className).toBe("cho-ai-chu");
    expect(choAiPhienB!.textContent).toBe("vòng 2/3 — đang đọc tệp b.ts");
  });

  it("★★ NHÁNH KIA của kết cục thứ NĂM — 'Lịch sử' (khôi phục hội thoại khác) cũng XOÁ chỉ báo mồ côi y hệt 'Chat mới'", () => {
    // `xoaKhungChoPhienKhac` là hàm DÙNG CHUNG cho cả `chat_moi` lẫn `khoi_phuc_hoi_thoai` — bản vá
    // phải đóng CẢ HAI đường gọi nó, không chỉ đường "Chat mới" đã đo ở ca trên.
    const w = chayWebview();
    w.nut("o-nhap").value = "câu hỏi A — vòng đang chạy";
    w.nut("nut-gui").bam();
    const choAiPhienA = choAiCuaBongBongAi(w);
    expect(choAiPhienA).toBeDefined();

    w.banTin({ loai: "khoi_phuc_hoi_thoai", luot: [{ vaiTro: "user", noiDung: "câu cũ" }], soLuot: 1, soKyTu: 6 });

    w.banTin({ loai: "thong_bao", thongDiep: "vòng 2/3 — đang đọc tệp a.ts" });

    // Không bong bóng "luot-ai" nào của hội thoại vừa khôi phục (chỉ có "user") mang chỉ báo bị ghi
    // đè — nếu `xoaChiBaoChoAi()` bị bỏ sót, chỉ báo mồ côi vẫn "sống" nhưng không có bong bóng AI
    // nào để hiện trong khung mới nên phép đo trực tiếp nhất là: node cũ KHÔNG bị đổi bởi tin muộn.
    expect(choAiPhienA!.className).toBe("cho-ai");
    expect(choAiPhienA!.textContent).toBe("");
  });

  it("★ NHÁNH KIA của kết cục thứ NĂM — hai lượt hỏi CHỒNG NHAU (gửi câu B khi câu A đang chạy, KHÔNG qua Chat mới/Lịch sử) — chỉ báo KHÔNG kẹt", () => {
    // ★★★ B3 của brief — đo thêm một đường ĐỔI PHIÊN nữa: gõ thẳng câu hỏi thứ hai trong khi câu hỏi
    // thứ nhất vẫn đang hiện chỉ báo (không đi qua "Chat mới"/"Lịch sử"). `gui()` tạo bong bóng AI
    // MỚI cho MỖI lượt hỏi (không tái dùng bong bóng cũ) — đây là đường "kết cục thứ SÁU" phải kiểm.
    const w = chayWebview();
    // ★ `choAiCuaBongBongAi` chọn bong bóng AI ĐẦU TIÊN (đủ cho mọi ca khác — chỉ có MỘT bong bóng
    // AI tại một thời điểm ở đó); ca này CỐ Ý có HAI bong bóng AI cùng lúc nên tự truy theo CHỈ SỐ.
    const choAiThuN = (n: number) => {
      const bongBong = w.nut("hoi-thoai").con.filter((x) => x.className === "luot luot-ai")[n]!;
      return bongBong.con[1]!.con[0];
    };
    w.nut("o-nhap").value = "câu hỏi A";
    w.nut("nut-gui").bam();
    const choAiPhienA = choAiThuN(0);
    expect(choAiPhienA).toBeDefined();

    // Người dùng KHÔNG đợi kết cục của A — gõ câu B và bấm Gửi ngay (webview không cấm việc này;
    // hàng rào "một lượt tại một thời điểm" nằm ở PHÍA EXTENSION — `hoi()` tự abort `this.huy` cũ).
    w.nut("o-nhap").value = "câu hỏi B";
    w.nut("nut-gui").bam();
    const choAiPhienB = choAiThuN(1);
    expect(choAiPhienB).toBeDefined();
    expect(choAiPhienB).not.toBe(choAiPhienA);

    // Chỉ báo của A vẫn còn TRONG DOM (bong bóng "Bạn: câu hỏi A" + bong bóng AI của nó chưa bị xoá
    // — webview không dọn lượt CŨ khi một câu hỏi MỚI chỉ đơn giản được GÕ THÊM, khác hẳn "Chat mới"
    // chủ động dọn khung). Đây KHÔNG phải một chỉ báo "kẹt" theo nghĩa QA lo ngại: nó vẫn là sổ tiến
    // trình THẬT của lượt A (chưa có kết cục), không bị lượt B ghi đè — mỗi bong bóng AI giữ chỉ báo
    // CỦA RIÊNG NÓ (biến `choAiHienTai` chỉ theo dõi bong bóng MỚI NHẤT, nhưng node CŨ không bị mất
    // nội dung — nó chỉ không còn được `capNhatChiBaoChoAi`/`xoaChiBaoChoAi` cập nhật nữa).
    w.banTin({ loai: "hoan_tat", vanBanCuoi: "Trả lời B", soLuot: 1, soKyTu: 5 });

    // Kết cục của B xoá ĐÚNG chỉ báo của B — không kẹt.
    expect(choAiPhienB!.className).toBe("cho-ai");
    expect(choAiPhienB!.textContent).toBe("");
    const bongBongAiB = w.nut("hoi-thoai").con.filter((x) => x.className === "luot luot-ai")[1]!;
    expect(bongBongAiB.con[1]!.textContent).toBe("Trả lời B");
  });

  it("★ chỉ báo mang MÀU của theme qua biến --vscode-*, không hardcode màu", () => {
    const html = dungHtmlBang({ nonce: "N" });
    const khoiCss = html.slice(html.indexOf(".cho-ai "), html.indexOf(".cho-ai-chu"));
    expect(khoiCss).toContain("var(--vscode-");
    expect(khoiCss).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("★ hoạt ảnh chỉ báo là CSS @keyframes thuần — không setInterval/setTimeout nào trong toàn script", () => {
    const html = dungHtmlBang({ nonce: "N" });
    expect(html).toContain("@keyframes");
    const ma = html.match(/<script nonce="N">([\s\S]*?)<\/script>/)![1];
    expect(ma).not.toContain("setInterval");
    expect(ma).not.toContain("setTimeout");
  });
});
