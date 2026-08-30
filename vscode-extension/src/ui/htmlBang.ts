/**
 * Khung HTML của bảng trò chuyện. THUẦN (không import `vscode`) để lưới đo được CSP.
 * Script chỉ chạy bằng `nonce` — không `unsafe-inline`, không nguồn ngoài (nhà máy offline).
 */
export function dungHtmlBang(dv: { nonce: string }): string {
  const n = dv.nonce;
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';" />
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         margin: 0; padding: 8px; display: flex; flex-direction: column; height: 100vh; }
  #o-du-an { width: 100%; margin-bottom: 8px; background: var(--vscode-dropdown-background);
             color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);
             padding: 4px; }
  #hoi-thoai { flex: 1; overflow-y: auto; white-space: pre-wrap; font-size: 13px; }
  .luot { margin-bottom: 10px; }
  .nhan { opacity: .7; font-size: 11px; text-transform: uppercase; }
  #the-duyet { border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
               background: var(--vscode-editorWidget-background); padding: 8px; margin-top: 8px;
               font-size: 12px; }
  #the-duyet #duyet-duong { font-weight: 600; margin: 2px 0; }
  .the-duyet-nut { display: flex; gap: 6px; margin-top: 8px; }
  #hang-nhap { display: flex; gap: 6px; margin-top: 8px; position: relative; }
  #o-nhap { flex: 1; background: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            padding: 6px; font-family: inherit; }
  /* TASK 5 — dropdown gợi ý @-mention. Neo lên TRÊN ô nhập (ô nhập nằm ở đáy khung chat) qua
     #hang-nhap position:relative ở trên — relative không phá layout flex hiện có. */
  #mention-ds { position: absolute; left: 0; right: 88px; bottom: 100%; margin-bottom: 4px;
                max-height: 160px; overflow-y: auto; background: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border); font-size: 12px; z-index: 10; }
  .mention-muc { padding: 4px 8px; cursor: pointer; }
  .mention-muc:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.2)); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 6px 12px; cursor: pointer; }
  /* Nút ghi đang chờ kết quả: phải THẤY ĐƯỢC là đang khoá, nếu không người dùng bấm tiếp vì nghĩ
     cú bấm đầu rơi mất — đúng cái phản xạ sinh ra hàng kiểm toán thừa. */
  button:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<select id="o-du-an" title="Chọn dự án"></select>
<div id="hoi-thoai"></div>
<div id="the-duyet" hidden>
  <div class="nhan">Đề xuất ghi tệp</div>
  <div id="duyet-nguon"></div>
  <div id="duyet-duong"></div>
  <div id="duyet-tom-tat"></div>
  <div id="duyet-han"></div>
  <div class="the-duyet-nut">
    <button id="nut-xem-diff">Xem diff</button>
    <!-- ⚠⚠⚠ KHÔNG đặt chữ mặc định cho nút này. Chữ trên nút nói byte sẽ rơi Ở ĐÂU ("Duyệt & ghi
         trên SERVER" = hộp cát máy chủ · "Ghi vào workspace" = đĩa máy lập trình viên) — một chữ
         mặc định là một câu khai về nơi ghi khi CHƯA AI nói nơi ghi là đâu, và nếu extension quên
         gửi nhanNut thì nó sẽ khai nhầm chế độ. Extension đặt chữ ở mỗi lần hiện thẻ; thiếu chữ
         thì thẻ KHÔNG hiện (xem xử lý the_duyet bên dưới). -->
    <button id="nut-duyet"></button>
    <button id="nut-huy">Huỷ</button>
  </div>
</div>
<div id="hang-nhap">
  <!-- TASK 5 — dropdown gợi ý @-mention. MẶC ĐỊNH ẨN: chỉ hiện khi đang gõ "@..." VÀ extension đã
       trả về ít nhất một gợi ý. Nội dung (danh sách tệp) do EXTENSION dựng — webview chỉ hiển thị
       và chuyển tiếp lựa chọn, đúng nguyên tắc đã áp cho thẻ duyệt. -->
  <div id="mention-ds" hidden></div>
  <textarea id="o-nhap" rows="2" placeholder="Hỏi AI Local… (Ctrl+Enter để gửi, @ để chèn tệp)"></textarea>
  <button id="nut-gui">Gửi</button>
  <!-- TASK 4 — nút DỪNG. MẶC ĐỊNH ẨN: chỉ có ý nghĩa khi một lượt hỏi đang chạy (đang chờ SSE
       hoặc đang giữa vòng lặp tác nhân), không phải lúc rảnh. Hàm gui() hiện nó khi bắn câu hỏi;
       nơi DUY NHẤT ẩn lại là lúc nhận được tín hiệu 'lượt này đã xong' (hoan_tat/loi) — xem dưới. -->
  <button id="nut-dung" hidden>Dừng</button>
</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const hoiThoai = document.getElementById("hoi-thoai");
  const oNhap = document.getElementById("o-nhap");
  let khoiTraLoi = null;

  function themLuot(nhan, chu) {
    const d = document.createElement("div");
    d.className = "luot";
    const t = document.createElement("div");
    t.className = "nhan";
    t.textContent = nhan;
    const c = document.createElement("div");
    c.textContent = chu;
    d.appendChild(t); d.appendChild(c);
    hoiThoai.appendChild(d);
    hoiThoai.scrollTop = hoiThoai.scrollHeight;
    return c;
  }

  // ★★★ TASK 4 — nút Dừng: hiện khi một lượt hỏi ĐANG chạy, ẩn lúc rảnh. Webview không tự quyết
  // "dừng nghĩa là gì" (cắt SSE? đặt cờ vòng lặp?) — nó chỉ báo Ý ĐỊNH của người dùng qua
  // \`postMessage\`, đúng nguyên tắc "webview chỉ hiển thị + chuyển tiếp" đã áp cho thẻ duyệt.
  const nutDung = document.getElementById("nut-dung");
  nutDung.addEventListener("click", () => vscode.postMessage({ loai: "dung_hoi" }));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 5 — @-MENTION. Webview chỉ (1) phát hiện vị trí "@..." đang gõ, (2) hỏi extension
  // gợi ý (nội dung dropdown do EXTENSION dựng — cùng nguyên tắc thẻ duyệt), (3) chèn lựa chọn
  // của người dùng. KHÔNG quyết định tệp nào được phép mention (đó là hàng rào gửi ở phía
  // extension) và KHÔNG bao giờ gửi đi ký tự "@" kèm đường dẫn đã chọn.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const mentionDs = document.getElementById("mention-ds");
  /** Gợi ý ĐANG HIỂN THỊ (rỗng khi dropdown ẩn) — dùng để Tab chọn mục ĐẦU mà không cần chuột. */
  let goiYHienTai = [];
  /** Đường dẫn SẠCH đã chèn cho LƯỢT HỎI CHƯA GỬI hiện tại — đi kèm "hoi" rồi bị xoá sau khi gửi. */
  let mentionsHienTai = [];

  /**
   * Tìm khối "@đang-gõ" NGAY TRƯỚC con trỏ, nếu có. "@" phải đứng ĐẦU DÒNG hoặc ngay sau khoảng
   * trắng (tránh bắt nhầm "@" giữa một địa chỉ email như "ten@mien.com" làm trigger mention).
   * \`selectionStart\` rơi về CUỐI chuỗi khi chưa từng được đặt (gõ xong luôn ở cuối trong đa số
   * lượt gõ thật).
   */
  function viTriMention() {
    const text = oNhap.value;
    const caret = typeof oNhap.selectionStart === "number" ? oNhap.selectionStart : text.length;
    let i = caret - 1;
    while (i >= 0 && !/\\s/.test(text[i]) && text[i] !== "@") i--;
    if (i < 0 || text[i] !== "@") return null;
    if (i > 0 && !/\\s/.test(text[i - 1])) return null;
    return { batDau: i, truy: text.slice(i + 1, caret) };
  }

  function anMenuMention() {
    mentionDs.hidden = true;
    goiYHienTai = [];
  }

  function hienMenuMention(ds) {
    mentionDs.innerHTML = "";
    for (const duong of ds) {
      const dong = document.createElement("div");
      dong.className = "mention-muc";
      dong.textContent = duong;
      dong.addEventListener("click", () => chonGoiY(duong));
      mentionDs.appendChild(dong);
    }
    goiYHienTai = ds;
    mentionDs.hidden = ds.length === 0;
  }

  /**
   * ★★★ CHÈN ĐƯỜNG DẪN SẠCH — KHÔNG kèm "@". Bài học đã trả giá ở \`/ai-coding-workspace\`: chèn
   * "@src/…" khiến model đọc chính ký tự "@" đó theo nghĩa đen và hỏng MỌI lượt hỏi sau. \`duongSach\`
   * tới đây đã là đường TRẦN (không "@") — extension gửi nguyên đường tương đối, webview không tự
   * thêm hay bớt ký tự nào ở đầu.
   */
  function chonGoiY(duongSach) {
    const vt = viTriMention();
    if (!vt) return;
    const truoc = oNhap.value.slice(0, vt.batDau);
    const sau = oNhap.value.slice(vt.batDau + 1 + vt.truy.length);
    const chen = duongSach + " ";
    oNhap.value = truoc + chen + sau;
    const viTriMoi = (truoc + chen).length;
    oNhap.selectionStart = oNhap.selectionEnd = viTriMoi;
    mentionsHienTai.push(duongSach);
    anMenuMention();
  }

  oNhap.addEventListener("input", () => {
    const vt = viTriMention();
    if (!vt) { anMenuMention(); return; }
    vscode.postMessage({ loai: "xin_goi_y_mention", truy: vt.truy });
  });

  function gui() {
    const cauHoi = oNhap.value.trim();
    if (!cauHoi) return;
    themLuot("Bạn", cauHoi);
    oNhap.value = "";
    khoiTraLoi = themLuot("AI Local", "");
    nutDung.hidden = false;
    anMenuMention();
    const tepMention = mentionsHienTai;
    mentionsHienTai = [];
    vscode.postMessage({ loai: "hoi", cauHoi, duAnId: document.getElementById("o-du-an").value, tepMention });
  }

  document.getElementById("nut-gui").addEventListener("click", gui);
  oNhap.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); gui(); }
  });
  // TASK 5 — Tab CHỌN gợi ý ĐẦU TIÊN đang hiện (bàn phím-trước, không bắt buộc dùng chuột); Escape
  // đóng dropdown mà KHÔNG chèn gì. Đặt ở listener RIÊNG, tách khỏi listener Ctrl+Enter phía trên
  // để mỗi khối chỉ lo một việc.
  oNhap.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && goiYHienTai.length > 0) { e.preventDefault(); chonGoiY(goiYHienTai[0]); return; }
    if (e.key === "Escape" && !mentionDs.hidden) { anMenuMention(); }
  });

  // Thẻ duyệt (chế độ SERVER): webview chỉ HIỂN THỊ chữ do extension đã dựng sẵn và CHUYỂN TIẾP
  // cú bấm nút — mọi quyết định (gọi confirmAction/cancelAction, xoá đề xuất khỏi bộ nhớ) nằm ở
  // phía extension. Webview không bao giờ tự quyết ghi hay không.
  const theDuyet = document.getElementById("the-duyet");
  // ĐỔI DỰ ÁN phải báo NGAY, không đợi tới câu hỏi kế tiếp: một đề xuất ghi đang chờ thuộc về dự án
  // nó sinh ra, nên phía extension cần biết lúc ô chọn đổi để vứt thẻ duyệt đi (xem bangChat.ts).
  document.getElementById("o-du-an").addEventListener("change", (e) =>
    vscode.postMessage({ loai: "doi_du_an", duAnId: e.target.value }));
  document.getElementById("nut-xem-diff").addEventListener("click", () => vscode.postMessage({ loai: "xem_diff" }));

  // ★★★ CHỐNG BẤM HAI LẦN (Minor, 2026-08-30) — CHỈ nút GHI, và chỉ nó.
  //
  // Phía extension xoá trạng thái đề xuất SAU \`await\` (đọc secret · gọi mạng · ghi đĩa), nên giữa
  // hai cú bấm liền nhau trạng thái vẫn còn nguyên: cú thứ hai chạy trọn \`apBanVa\` lần nữa và
  // MỞ MỘT HÀNG KIỂM TOÁN THỨ HAI trên máy chủ. Lượt ghi thứ hai gần như chắc chắn bị chặn ở phép
  // so băm (đĩa đã đổi vì lượt đầu) — nhưng nó vẫn để lại một hàng \`ap_client_that_bai\` cho một
  // lượt người dùng KHÔNG hề định làm. Sổ kiểm toán khi ấy kể một câu chuyện sai về hành vi người
  // dùng, và đó là thứ duy nhất máy chủ có để kể lại.
  // ⚠ KHÔNG đụng \`textContent\` của nút: chữ trên nút là HÀNG RÀO (nó nói byte rơi Ở ĐÂU). Chỉ khoá.
  const nutDuyet = document.getElementById("nut-duyet");
  let dangGuiDuyet = false;
  function moKhoaNutDuyet() { dangGuiDuyet = false; nutDuyet.disabled = false; }
  nutDuyet.addEventListener("click", () => {
    if (dangGuiDuyet) return;
    dangGuiDuyet = true;
    nutDuyet.disabled = true;
    vscode.postMessage({ loai: "duyet" });
  });

  document.getElementById("nut-huy").addEventListener("click", () => vscode.postMessage({ loai: "huy" }));

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.loai === "token" && khoiTraLoi) khoiTraLoi.textContent += m.chu;
    else if (m.loai === "loi") { themLuot("Lỗi", m.thongDiep); nutDung.hidden = true; }
    else if (m.loai === "hoan_tat") {
      // vanBanCuoi chỉ có khi server bảo THAY chữ đã stream (degraded) — không phải mọi lượt.
      if (m.vanBanCuoi != null && khoiTraLoi) khoiTraLoi.textContent = m.vanBanCuoi;
      // Cắt ngang hoặc khung hỏng: KHÔNG được im lặng — phải hiện, kể cả khi câu trả lời trông
      // như đã xong.
      if (m.canhBao) themLuot("Lưu ý", m.canhBao);
      // ★★★ TASK 4 — \`hoan_tat\` là tín hiệu DUY NHẤT "cả lượt hỏi (mọi vòng) đã xong", kể cả khi nó
      // xong VÌ bị dừng (extension vẫn gửi \`hoan_tat\` sau khi báo "đã dừng" — xem \`bangChat.ts\`).
      // Ẩn nút Dừng Ở ĐÂY, không đoán qua bất kỳ tín hiệu nào khác (token/thong_bao vẫn có thể bắn
      // giữa các vòng của MỘT lượt hỏi đang chạy — ẩn theo chúng sẽ ẩn nhầm lúc còn đang chạy).
      nutDung.hidden = true;
    } else if (m.loai === "duAn") {
      const o = document.getElementById("o-du-an");
      o.innerHTML = "";
      for (const d of m.ds) {
        const opt = document.createElement("option");
        opt.value = d.id; opt.textContent = d.nhan;
        o.appendChild(opt);
      }
    } else if (m.loai === "the_duyet") {
      // Chữ hiển thị (nhãn nguồn, chữ trên nút ghi, tóm tắt +N/-M hay "Tạo tệp mới") do EXTENSION
      // dựng sẵn — webview chỉ đặt textContent, không tự suy luận gì thêm.
      // ★★★ FAIL-CLOSED: thiếu nhãn nguồn hoặc chữ nút ⇒ KHÔNG hiện thẻ. Hiện một nút ghi mà không
      // nói rõ ghi ở đâu (hoặc còn đeo chữ của lượt trước, có thể là chế độ KIA) đúng là "tai nạn
      // không cứu được" mà spec §7 mô tả.
      // Thẻ MỚI ⇒ một quyết định mới: mở khoá dù lượt trước kết thúc thế nào.
      moKhoaNutDuyet();
      if (!m.nhanNguon || !m.nhanNut) {
        theDuyet.hidden = true;
        themLuot("Lỗi", "Thẻ duyệt thiếu nhãn nguồn hoặc chữ trên nút ghi — đã KHÔNG hiện thẻ.");
      } else {
        document.getElementById("duyet-nguon").textContent = m.nhanNguon;
        document.getElementById("duyet-duong").textContent = m.duong;
        document.getElementById("duyet-tom-tat").textContent = m.tomTat;
        document.getElementById("nut-duyet").textContent = m.nhanNut;
        // Đề xuất CỤC BỘ không có TTL máy chủ ⇒ extension gửi chuỗi rỗng; nói đúng điều đó thay vì
        // in "Hạn duyệt: " cụt đuôi.
        document.getElementById("duyet-han").textContent =
          m.han ? "Hạn duyệt: " + m.han : "Không có hạn — đề xuất sống trong phiên làm việc này.";
        theDuyet.hidden = false;
      }
    } else if (m.loai === "an_the_duyet") {
      theDuyet.hidden = true;
      moKhoaNutDuyet();
    } else if (m.loai === "thong_bao") {
      // ⚠⚠ MỞ KHOÁ Ở ĐÂY LÀ BẮT BUỘC, không phải cho gọn. Đường SERVER có một ca CỐ Ý **giữ thẻ
      // lại**: "KHÔNG RÕ KẾT CỤC" (mất mạng giữa chừng) chỉ gửi \`thong_bao\` và KHÔNG gửi
      // \`an_the_duyet\`, vì bấm Duyệt lần nữa là cách DUY NHẤT để biết lượt trước ra sao
      // (\`confirmAction\` idempotent — xem \`bangChat.duyetDeXuat\`). Khoá vĩnh viễn ở đó là lấy mất
      // đúng đường thoát mà bản vá kia dựng ra.
      moKhoaNutDuyet();
      themLuot("Thông báo", m.thongDiep);
    } else if (m.loai === "dat_cau_hoi_tu_lenh") {
      // ★★★ CMD+K (Task 7) — extension đổ câu hỏi ĐÃ DỰNG SẴN (đường dẫn + dòng + đoạn mã + yêu
      // cầu, xem loi/cauHoiSuaChon.ts) vào Ô NHẬP rồi gọi ĐÚNG hàm gửi mà nút "Gửi" dùng. KHÔNG có
      // đường tắt nào ở đây: gui() vẫn tạo bong bóng "Bạn: …", vẫn postMessage({loai:"hoi"}),
      // vẫn đi qua toàn bộ chuỗi đề-xuất → diff → duyệt → apBanVa y hệt một câu gõ tay.
      oNhap.value = m.cauHoi;
      gui();
    } else if (m.loai === "goi_y_mention") {
      // TASK 5 — nội dung dropdown (danh sách tệp) do EXTENSION lọc/gạn sẵn (hàng rào gửi + vị từ
      // lọc theo chữ đang gõ); webview chỉ hiển thị. Bỏ qua nếu người dùng đã rời khỏi ngữ cảnh
      // "@..." trong lúc chờ trả lời (gõ tiếp qua khoảng trắng, xoá "@", đổi vị trí con trỏ…) —
      // một dropdown xuất hiện SAU KHI ý định gõ mention đã qua là một cú giật giao diện vô nghĩa.
      const vt = viTriMention();
      if (!vt) { anMenuMention(); }
      else hienMenuMention(m.ds || []);
    }
    hoiThoai.scrollTop = hoiThoai.scrollHeight;
  });
  // Bắt tay chống ĐUA: extension có thể gửi danh sách dự án TRƯỚC khi script này kịp đăng ký
  // listener ở trên ⇒ danh sách rơi mất mà không có lỗi nào. Báo "san_sang" NGAY SAU khi đã lắng
  // nghe để extension biết lúc nào an toàn để gửi.
  vscode.postMessage({ loai: "san_sang" });
</script>
</body>
</html>`;
}
