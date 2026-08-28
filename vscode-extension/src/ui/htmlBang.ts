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
  #hoi-thoai { flex: 1; overflow-y: auto; white-space: pre-wrap; font-size: 13px; }
  .luot { margin-bottom: 10px; }
  .nhan { opacity: .7; font-size: 11px; text-transform: uppercase; }
  #hang-nhap { display: flex; gap: 6px; margin-top: 8px; }
  #o-nhap { flex: 1; background: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            padding: 6px; font-family: inherit; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 6px 12px; cursor: pointer; }
</style>
</head>
<body>
<div id="hoi-thoai"></div>
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
    vscode.postMessage({ loai: "hoi", cauHoi });
  }

  document.getElementById("nut-gui").addEventListener("click", gui);
  oNhap.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); gui(); }
  });

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.loai === "token" && khoiTraLoi) khoiTraLoi.textContent += m.chu;
    else if (m.loai === "loi") themLuot("Lỗi", m.thongDiep);
    hoiThoai.scrollTop = hoiThoai.scrollHeight;
  });
</script>
</body>
</html>`;
}
