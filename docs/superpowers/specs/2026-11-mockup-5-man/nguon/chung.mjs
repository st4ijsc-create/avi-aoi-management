/* Thành phần dùng chung của bộ sinh mockup: biểu tượng, vỏ AppFrame, badge, pill. Đầu ra là HTML TĨNH (không chạy trong app). */
export const KHOA = new Map(); // khoá i18n dự kiến → chuỗi vi (ghi ra khoa-i18n.md)

/** i("giamSat.canhBao.tieuDe", "Cảnh báo") → <span data-i18n>…</span>, đồng thời ghi vào bảng khoá. */
export function i(key, vi) {
  KHOA.set(key, vi);
  return `<span data-i18n="${key}">${vi}</span>`;
}

const IC = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  factory: '<path d="M3 21V9l6 4V9l6 4V5h6v16z"/><path d="M7 17h2M12 17h2M17 17h2"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-2.6-.6-.6-2.6z"/>',
  spark: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 17l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevd: '<path d="M6 9l6 6 6-6"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
};
export const ic = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[n] ?? ""}</svg>`;

export const GLYPH = { 1: "■", 2: "▲", 3: "▼", 4: "●" };
export const PRIO = { 1: "Nghiêm trọng", 2: "Cao", 3: "Trung bình", 4: "Thông tin" };
/** AlarmBadge: hình + số + chữ (component DUY NHẤT vẽ ưu tiên). */
export const alarmBadge = (p, { chu = true } = {}) =>
  `<span class="alarm-badge p${p}"><i class="g">${GLYPH[p]}</i><span class="n">${p}</span>${chu ? `<span class="t">${PRIO[p]}</span>` : ""}</span>`;

export const origin = (k) => (k === "sim" ? '<span class="origin sim">MÔ PHỎNG</span>' : k === "qa" ? '<span class="origin qa">QA</span>' : '<span class="origin">THẬT</span>');
export const fresh = (k, t) => `<span class="pill fresh ${k}"><span class="dot"></span>${t}</span>`;

/** Bao nội dung chỉ hiện ở một số trạng thái (shell.js bật data-vis). */
export const st = (list, html) => `<span class="ctn" data-st="${list}">${html}</span>`;

const RAIL = [
  ["home", "home", "Trang chủ", "chung.vung.trangChu"],
  ["giam-sat", "monitor", "Giám sát", "chung.vung.giamSat"],
  ["san-xuat", "factory", "Sản xuất & Chất lượng", "chung.vung.sanXuat"],
  ["du-lieu-chu", "db", "Dữ liệu chủ", "chung.vung.duLieuChu"],
  ["ky-thuat", "wrench", "Kỹ thuật", "chung.vung.kyThuat"],
  ["tho-ca", "spark", "Thợ Cả", "chung.vung.thoCa"],
  ["phan-tich", "chart", "Phân tích & Quản trị", "chung.vung.phanTich"],
];

export function rail(active, canhBaoBadge) {
  const mucs = RAIL.map(([k, icon, lbl, key]) => {
    const badge = k === "giam-sat" && canhBaoBadge ? `<span class="badge">${canhBaoBadge}</span>` : "";
    return `<a href="#" ${k === active ? 'aria-current="page"' : ""} title="${lbl}">${ic(icon)}<span class="lbl">${i(key, lbl)}</span>${badge}</a>`;
  }).join("");
  return `<nav class="rail" aria-label="Điều hướng 7 vùng">
    <div class="brand"><span class="logo">AV</span><span class="name">AVI·AOI</span></div>
    ${mucs}
    <div class="grow"></div>
    <div class="bottom">
      <a href="#" title="Cài đặt">${ic("gear")}<span class="lbl">${i("chung.caiDat", "Cài đặt")}</span></a>
      <a href="#" title="Giao diện">${ic("theme")}<span class="lbl">${i("chung.giaoDien", "Giao diện sáng")}</span></a>
    </div>
  </nav>`;
}

/**
 * Thanh đầu: 5 bất biến — phạm vi ISA-95 (NodeBreadcrumb + đổi), AlarmChip, FreshnessPill, nhãn THẬT/MÔ PHỎNG, ⌘K — + người dùng.
 * `bien`: { chip: {stateName: html}, fresh: {stateName: html}, crumbs: html } (theo trạng thái trang).
 */
export function header({ crumbs, chip, freshMap, allStates }) {
  const per = (m) => allStates.map((s) => st(s, m[s] ?? m.default)).join("");
  return `<header class="hdr">
    <div class="crumbs" aria-label="Phạm vi">${crumbs}<button class="btn sm scope-btn" type="button">${i("chung.doiPhamVi", "Đổi phạm vi")}</button></div>
    <div class="sp"></div>
    ${per(chip)}
    ${per(freshMap)}
    <span class="ctn" data-sc="real">${origin("real")}</span><span class="ctn" data-sc="sim">${origin("sim")}</span>
    <span class="cmdk">${ic("search").replace("<svg", '<svg width="16" height="16"')} ${i("chung.timNhanh", "Tìm nhanh")} <span class="kbd">⌘K</span></span>
    <span class="user"><span class="av">LT</span>Lê Thanh Tâm</span>
  </header>`;
}

export const chipNormal = '<a class="alarm-chip" href="#" title="Cảnh báo P1/P2 chưa ack trong phạm vi"><span class="p p1">■ 0</span><span class="p p2">▲ 2</span><span>' + "Cảnh báo" + "</span></a>";
export const chipP1 = (n1, n2) => `<a class="alarm-chip unacked-p1" href="#" title="Có cảnh báo P1 chưa ack"><span class="p p1">■ ${n1}</span><span class="p p2">▲ ${n2}</span><span>Chưa ack</span></a>`;

/** Điều khiển chỉ-của-mockup ở đáy trang (ẩn khi chụp: ?shot=1). groups: [{nhan, khoa, muc:[[giaTri, nhan]]}] */
export function demo(groups) {
  const g = groups
    .map((x) => `<b>${x.nhan}</b>${x.muc.map(([v, l]) => `<button type="button" data-set="${x.khoa}:${v}">${l}</button>`).join("")}`)
    .join('<span aria-hidden="true">·</span>');
  return `<div class="demo" role="toolbar" aria-label="Chỉ có trong mockup">${g}</div>`;
}

export function trang({ tieuDe, active, badgeRail, appAttrs, hdr, main, drawer = "", demoHtml, mauCss = "" }) {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tieuDe} — mockup</title>
<link rel="stylesheet" href="token.css">
<link rel="stylesheet" href="shell.css">
${mauCss ? `<style>\n${mauCss}\n</style>` : ""}
</head>
<body>
<div class="app" ${appAttrs}>
  ${hdr}
  ${rail(active, badgeRail)}
  <main class="main" id="main">
    <div class="sim-banner" role="status">${i("chung.moPhong.banner", "ĐANG XEM DỮ LIỆU MÔ PHỎNG — không phải máy thật; lệnh gửi đi KHÔNG tác động thiết bị")}</div>
    ${main}
  </main>
  ${drawer}
</div>
${demoHtml}
<script src="shell.js"></script>
</body>
</html>
`;
}
