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
  innerHTML = "";
  className = "";
  scrollTop = 0;
  scrollHeight = 0;
  private nghe: Record<string, Array<(e: unknown) => void>> = {};
  addEventListener(loai: string, h: (e: unknown) => void): void {
    (this.nghe[loai] ??= []).push(h);
  }
  appendChild(): void {
    /* DOM giả không dựng cây thật — script chỉ cần lời gọi không ném */
  }
  /** Mô phỏng một cú BẤM CHUỘT thật (kể cả khi nút đang `disabled` — trình duyệt tự chặn, ta thì
   *  cố ý KHÔNG chặn, để đo chính hàng rào trong script chứ không đo hộ trình duyệt). */
  bam(): void {
    for (const h of this.nghe["click"] ?? []) h({});
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
