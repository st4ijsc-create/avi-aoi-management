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
  #hang-nhap { display: flex; gap: 6px; margin-top: 8px; }
  #o-nhap { flex: 1; background: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            padding: 6px; font-family: inherit; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 6px 12px; cursor: pointer; }
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
    <button id="nut-duyet">Duyệt &amp; ghi trên SERVER</button>
    <button id="nut-huy">Huỷ</button>
  </div>
</div>
<div id="hang-nhap">
  <textarea id="o-nhap" rows="2" placeholder="Hỏi AI Local… (Ctrl+Enter để gửi)"></textarea>
  <button id="nut-gui">Gửi</button>
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

  function gui() {
    const cauHoi = oNhap.value.trim();
    if (!cauHoi) return;
    themLuot("Bạn", cauHoi);
    oNhap.value = "";
    khoiTraLoi = themLuot("AI Local", "");
    vscode.postMessage({ loai: "hoi", cauHoi, duAnId: document.getElementById("o-du-an").value });
  }

  document.getElementById("nut-gui").addEventListener("click", gui);
  oNhap.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); gui(); }
  });

  // Thẻ duyệt (chế độ SERVER): webview chỉ HIỂN THỊ chữ do extension đã dựng sẵn và CHUYỂN TIẾP
  // cú bấm nút — mọi quyết định (gọi confirmAction/cancelAction, xoá đề xuất khỏi bộ nhớ) nằm ở
  // phía extension. Webview không bao giờ tự quyết ghi hay không.
  const theDuyet = document.getElementById("the-duyet");
  document.getElementById("nut-xem-diff").addEventListener("click", () => vscode.postMessage({ loai: "xem_diff" }));
  document.getElementById("nut-duyet").addEventListener("click", () => vscode.postMessage({ loai: "duyet" }));
  document.getElementById("nut-huy").addEventListener("click", () => vscode.postMessage({ loai: "huy" }));

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.loai === "token" && khoiTraLoi) khoiTraLoi.textContent += m.chu;
    else if (m.loai === "loi") themLuot("Lỗi", m.thongDiep);
    else if (m.loai === "hoan_tat") {
      // vanBanCuoi chỉ có khi server bảo THAY chữ đã stream (degraded) — không phải mọi lượt.
      if (m.vanBanCuoi != null && khoiTraLoi) khoiTraLoi.textContent = m.vanBanCuoi;
      // Cắt ngang hoặc khung hỏng: KHÔNG được im lặng — phải hiện, kể cả khi câu trả lời trông
      // như đã xong.
      if (m.canhBao) themLuot("Lưu ý", m.canhBao);
    } else if (m.loai === "duAn") {
      const o = document.getElementById("o-du-an");
      o.innerHTML = "";
      for (const d of m.ds) {
        const opt = document.createElement("option");
        opt.value = d.id; opt.textContent = d.nhan;
        o.appendChild(opt);
      }
    } else if (m.loai === "the_duyet") {
      // Chữ hiển thị (nhãn nguồn, tóm tắt +N/-M hay "Tạo tệp mới") do EXTENSION dựng sẵn — webview
      // chỉ đặt textContent, không tự suy luận gì thêm.
      document.getElementById("duyet-nguon").textContent = m.nhanNguon;
      document.getElementById("duyet-duong").textContent = m.duong;
      document.getElementById("duyet-tom-tat").textContent = m.tomTat;
      document.getElementById("duyet-han").textContent = "Hạn duyệt: " + m.han;
      theDuyet.hidden = false;
    } else if (m.loai === "an_the_duyet") {
      theDuyet.hidden = true;
    } else if (m.loai === "thong_bao") {
      themLuot("Thông báo", m.thongDiep);
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
