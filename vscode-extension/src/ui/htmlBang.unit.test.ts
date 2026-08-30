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
  // TASK 5 — vị trí con trỏ trong ô nhập, dùng cho lưới @-mention (`viTriMention` trong htmlBang.ts
  // đọc `selectionStart` để biết đang gõ "@..." ở đâu). `undefined` mặc định — script thật rơi về
  // cuối chuỗi khi thiếu, đúng hành vi một textarea thật lúc mới gõ xong.
  selectionStart: number | undefined = undefined;
  selectionEnd: number | undefined = undefined;
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
