/* Màn 1 — Home theo vai (`/`). 3 vai × 3 trạng thái (bình thường · có P1 chưa ack · dữ liệu cũ). RoleTileGrid từ `home.tiles`. */
import { i, ic, alarmBadge, fresh, header, chipNormal, chipP1, demo, trang, st } from "./chung.mjs";

const STATES = ["binh-thuong", "p1-chua-ack", "du-lieu-cu"];
const ROLES = ["van-hanh", "giam-sat", "ky-su"];
const STALE = (s, html) => (s === "du-lieu-cu" ? `<span class="is-stale">${html}</span>` : html);

/** PackML: ký hiệu + chữ; trung tính trừ held/suspended/stopped/aborted. */
const pm = (k, t) => `<span class="pm ${k}"><i>${{ execute: "▶", idle: "◼", held: "❚❚", stopped: "■", aborted: "✕" }[k]}</i>${t}</span>`;

const tile = ({ cls = "", titleKey, titleVi, badge = "", body, foot = "" }) =>
  `<section class="tile ${cls}"><div class="h"><h2 class="ds-h3">${i(titleKey, titleVi)}</h2>${badge}</div><div class="b">${body}</div>${foot ? `<div class="f">${foot}</div>` : ""}</section>`;

const age = (s, fresh_, old) => (s === "du-lieu-cu" ? `<span class="num is-stale">${old}</span>` : `<span class="num muted">${fresh_}</span>`);

function vanHanh(s) {
  const p1 = s === "p1-chua-ack";
  const may = `<ul class="list">
    <li><span class="grow"><b>SMT03-MNT-04</b><br><span class="ds-small">Máy gắp linh kiện · Line SMT-03</span></span>
      ${p1 ? pm("stopped", "Dừng — kẹt feeder") : pm("execute", "Đang chạy")}
      <span class="metric" style="min-width:104px"><span class="v">${STALE(s, "11,8")}<small>s</small></span><span class="age">chu kỳ · ${s === "du-lieu-cu" ? "cũ 4 ph" : "2 s trước"}</span></span></li>
    <li><span class="grow"><b>SMT03-AOI-07</b><br><span class="ds-small">Kiểm tra quang học · Line SMT-03</span></span>
      ${pm("execute", "Đang chạy")}
      <span class="metric" style="min-width:104px"><span class="v">${STALE(s, "98,6")}<small>%</small></span><span class="age">FPY ca · ${s === "du-lieu-cu" ? "cũ 4 ph" : "3 s trước"}</span></span></li>
  </ul>`;
  const andon = p1
    ? `<div class="row"><span>${alarmBadge(1)}</span><span class="grow"><b>Kẹt feeder #12</b><br><span class="ds-small">SMT03-MNT-04 · mở <span class="num">00:42</span></span></span></div>
       <div class="row"><button class="btn primary" type="button">${i("chung.ack", "Ack")}</button><button class="btn" type="button">${i("chung.giaiQuyet", "Giải quyết")}</button></div>`
    : `<p class="ds-body muted" style="margin:0">${i("home.andon.khongCo", "Không có andon đang mở trên máy của bạn.")}</p>
       <div><button class="btn" type="button">${i("home.andon.keo", "Kéo andon")}</button></div>`;
  const viec = `<ul class="list">
    <li><span class="chk on" role="checkbox" aria-checked="true"></span><span class="grow">Thay stencil lô PCB-2210</span><span class="num muted">09:10</span></li>
    <li><span class="chk on" role="checkbox" aria-checked="true"></span><span class="grow">Kiểm tra áp khí đầu hút</span><span class="num muted">10:00</span></li>
    <li><span class="chk" role="checkbox" aria-checked="false"></span><span class="grow"><b>Vệ sinh camera AOI-07</b></span><span class="num">15:30</span></li>
    <li><span class="chk" role="checkbox" aria-checked="false"></span><span class="grow">Bàn giao ca cho ca 3</span><span class="num">21:45</span></li></ul>`;
  return [
    tile({ cls: p1 ? "has-p1" : "", titleKey: "home.mayDuocGiao", titleVi: "Máy được giao", badge: p1 ? alarmBadge(1) : "", body: may, foot: `<a class="btn quiet sm" href="#">${i("home.moMay", "Mở máy")} ${ic("chev").replace("<svg", '<svg width="14" height="14" style="stroke:currentColor;fill:none;stroke-width:2"')}</a>` }),
    tile({ cls: p1 ? "has-p1" : "", titleKey: "home.andon", titleVi: "Andon", body: andon }),
    tile({ titleKey: "home.viecHomNay", titleVi: "Việc hôm nay", badge: `<span class="num ds-small">2/4</span>`, body: viec }),
  ].join("");
}

function giamSat(s) {
  const p1 = s === "p1-chua-ack";
  const lines = [
    ["SMT-01", "execute", "Chạy", "98,9", "—"],
    ["SMT-02", "execute", "Chạy", "97,6", "—"],
    ["SMT-03", p1 ? "stopped" : "execute", p1 ? "Dừng — lỗi" : "Chạy", p1 ? "92,1" : "98,0", p1 ? "p1" : "—"],
    ["THT-01", "execute", "Chạy", "98,3", "—"],
  ];
  const ds = `<ul class="list">${lines
    .map(([n, k, t, y, f]) => `<li class="${f === "p1" ? "" : ""}"><b class="grow">${n}</b>${STALE(s, pm(k, t))}<span class="num" style="min-width:72px;text-align:right">${STALE(s, y + " %")}</span>${f === "p1" ? alarmBadge(1, { chu: false }) : ""}</li>`)
    .join("")}</ul>`;
  const yieldT = `<div class="row" style="align-items:flex-end"><div class="metric" style="min-width:180px"><span class="v" style="font-size:40px">${STALE(s, p1 ? "96,4" : "97,8")}<small>%</small></span><span class="age">FPY ca · ${s === "du-lieu-cu" ? "cũ 4 ph" : "5 s trước"}</span></div>
    <div class="grow stack"><span class="ds-small">Mục tiêu <span class="num">≥ 98,0 %</span></span><span class="ds-body">${p1 ? "▼ −1,6 điểm so với mục tiêu" : "▼ −0,2 điểm so với mục tiêu"}</span></div></div>
    <div class="yb" aria-label="FPY theo giờ">${[98.4, 98.1, 97.9, 97.6, 97.8, 97.5, 97.8].map((v) => `<i style="height:${Math.round((v - 96) * 18)}px"></i>`).join("")}</div>
    <span class="ds-small muted">14:00 → 21:00 · mỗi cột = 1 giờ</span>`;
  const top5 = p1
    ? [[1, "SMT03-MNT-04", "Kẹt feeder #12", "00:42", "act-unack"], [1, "SMT03-REF-01", "Lò reflow vùng 5 quá nhiệt", "03:10", "act-unack"], [2, "SMT02-SPI-02", "Lệch thể tích kem hàn", "18:05", "act-unack"], [2, "SMT03-AOI-07", "Tỉ lệ lỗi AOI vượt ngưỡng", "12:30", "acked"], [3, "PKG-WH-01", "Áp khí nén thấp", "05:12", "act-unack"]]
    : [[2, "SMT02-SPI-02", "Lệch thể tích kem hàn", "18:05", "act-unack"], [2, "SMT03-AOI-07", "Tỉ lệ lỗi AOI vượt ngưỡng", "12:30", "acked"], [3, "PKG-WH-01", "Áp khí nén thấp", "05:12", "act-unack"], [3, "SMT01-PRN-01", "Dao gạt gần hết tuổi thọ", "1:12:05", "acked"], [4, "SMT03-AOI-07", "Sắp đến hạn hiệu chuẩn", "2:40:11", "acked"]];
  const top = `<ul class="list">${top5
    .map(([p, a, m, t, ss]) => `<li>${alarmBadge(p, { chu: false })}<span class="grow ell"><b>${m}</b><br><span class="ds-small">${a}</span></span><span class="num ${ss === "act-unack" ? "" : "muted"}">${t}</span><span class="ds-small">${ss === "act-unack" ? "chưa ack" : "đã ack"}</span></li>`)
    .join("")}</ul>`;
  return [
    tile({ cls: p1 ? "has-p1" : "", titleKey: "home.dayChuyen", titleVi: "Dây chuyền", body: ds, foot: `<a class="btn quiet sm" href="#">${i("home.moPhongVanHanh", "Mở Phòng vận hành")}</a>` }),
    tile({ titleKey: "home.yieldCa", titleVi: "Yield ca", body: yieldT }),
    tile({ cls: p1 ? "has-p1" : "has-p2", titleKey: "home.nangNhat5", titleVi: "5 cảnh báo nặng nhất", badge: p1 ? alarmBadge(1) : alarmBadge(2), body: top, foot: `<a class="btn quiet sm" href="#">${i("home.moCanhBao", "Mở Cảnh báo")}</a>` }),
  ].join("");
}

function kySu(s) {
  const p1 = s === "p1-chua-ack";
  const loi = `<ul class="list">
    <li>${p1 ? alarmBadge(1, { chu: false }) : alarmBadge(2, { chu: false })}<span class="grow"><b>SMT03-MNT-04</b><br><span class="ds-small">${p1 ? "FEEDER_JAM_12 · kẹt feeder #12" : "NOZZLE_VAC_LOW · áp hút đầu #3 thấp"}</span></span><span class="num ${s === "du-lieu-cu" ? "is-stale" : ""}">${s === "du-lieu-cu" ? "cũ 4 ph" : "00:42"}</span></li>
    <li>${alarmBadge(2, { chu: false })}<span class="grow"><b>SMT02-SPI-02</b><br><span class="ds-small">SPI_VOL_DEV · lệch thể tích kem</span></span><span class="num muted">18:05</span></li>
    <li>${alarmBadge(3, { chu: false })}<span class="grow"><b>PKG-WH-01</b><br><span class="ds-small">AIR_PRESS_LO · áp khí thấp</span></span><span class="num muted">05:12</span></li></ul>`;
  const tc = `<ul class="list">
    <li><span class="grow"><b>Phân tích lệch kem hàn SPI-02</b><br><span class="ds-small">Bắt đầu 19:42 · 6 bước</span></span><span class="pill">Chờ bạn duyệt đề xuất</span></li>
    <li><span class="grow"><b>Soạn công thức R-2210 v5</b><br><span class="ds-small">Bắt đầu 17:05 · 9 bước</span></span><span class="pill">Đang chạy</span></li></ul>`;
  const viec = `<ul class="list">
    <li><span class="grow"><b>Duyệt công thức R-2210 v4</b><br><span class="ds-small">Người đề xuất: Phạm Quang · hạn hôm nay</span></span><button class="btn sm">${i("chung.duyet", "Duyệt")}</button></li>
    <li><span class="grow"><b>Nghiệm thu thiết bị mới SMT03-ICT-01</b><br><span class="ds-small">Bước 6/6 · cần ký (2FA)</span></span><button class="btn sm">${i("chung.moVaKy", "Mở")}</button></li>
    <li><span class="grow"><b>Hiệu chuẩn camera AOI-07</b><br><span class="ds-small">Đến hạn sau 6 ngày</span></span><span class="num muted">T+6</span></li></ul>`;
  return [
    tile({ cls: p1 ? "has-p1" : "has-p2", titleKey: "home.mayCoLoi", titleVi: "Máy có lỗi", badge: `<span class="num ds-small">3</span>`, body: loi }),
    tile({ titleKey: "home.phienThoCa", titleVi: "Phiên Thợ Cả", badge: `<span class="num ds-small">2</span>`, body: tc, foot: `<a class="btn quiet sm" href="#">${i("home.moThoCa", "Mở ngăn Thợ Cả")}</a>` }),
    tile({ titleKey: "home.viecKyThuat", titleVi: "Việc kỹ thuật", badge: `<span class="num ds-small">3</span>`, body: viec }),
  ].join("");
}

/** Dải số liệu đầu trang (ô số có viền + đơn vị + tuổi dữ liệu). */
function dai(r, s) {
  const stale = s === "du-lieu-cu";
  const p1 = s === "p1-chua-ack";
  const agev = stale ? "cũ 4 ph 12 s" : "5 s trước";
  const m = (nhan, v, dv, ghiChu, lop = "") =>
    `<div class="metric ${stale ? "is-stale" : ""} ${lop}"><span class="ds-caption">${nhan}</span><span class="v">${v}${dv ? `<small>${dv}</small>` : ""}</span><span class="age">${ghiChu ?? agev}</span></div>`;
  const ds = {
    "giam-sat": [m("Sản lượng ca", p1 ? "4.512" : "4.812", "PCB", "kế hoạch 6.000 · " + agev), m("FPY ca", p1 ? "96,4" : "97,8", "%"), m("OEE ca", p1 ? "78,1" : "82,4", "%"), m("Thời gian dừng", p1 ? "01:12:40" : "00:47:10", "", "tổng các line · " + agev)],
    "van-hanh": [m("Lô hiện tại", "PCB-2210", "", "kế hoạch 2.000 PCB"), m("Đã làm", "1.204", "PCB", agev), m("Chu kỳ trung bình", "11,8", "s"), m("PCB lỗi (NG)", "17", "", agev)],
    "ky-su": [m("Máy có lỗi", "3", "", agev, p1 ? "p1" : "p2"), m("Đề xuất chờ duyệt", "1", "", "Thợ Cả · 19:42"), m("Phiên Thợ Cả", "2", "", "đang mở"), m("Việc đến hạn hôm nay", "2", "", "kỹ thuật")],
  }[r];
  return `<div class="grid strip">${ds.join("")}</div>`;
}

export function man1() {
  const main = `
    <div class="page-h">
      <div class="t">
        <h1 class="ds-h1">${i("home.tieuDe", "Trang chủ")}</h1>
        <div class="sub">
          <span data-rl="van-hanh">Vận hành viên · Nhà máy Bình Dương · Ca 2 (14:00–22:00)</span>
          <span data-rl="giam-sat">Giám sát · Nhà máy Bình Dương · Ca 2 (14:00–22:00)</span>
          <span data-rl="ky-su">Kỹ sư · Nhà máy Bình Dương · Ca hành chính</span>
        </div>
      </div>
      <div class="act">
        <span class="ds-caption" style="align-self:center">Chỉ mockup · xem thử vai</span>
        <div class="seg" role="group" aria-label="Vai (chỉ mockup)">
          <button type="button" data-set="role:van-hanh">Vận hành viên</button>
          <button type="button" data-set="role:giam-sat">Giám sát</button>
          <button type="button" data-set="role:ky-su">Kỹ sư</button>
        </div>
      </div>
    </div>
    ${STATES.map((s) => ROLES.map((r) => `<div class="stack-lg" data-st="${s}" data-rl="${r}">${dai(r, s)}<div class="grid tiles">${{ "van-hanh": vanHanh, "giam-sat": giamSat, "ky-su": kySu }[r](s)}</div></div>`).join("")).join("")}
  `;
  const crumbs = '<b>Công ty ABC</b><span class="sep">▸</span><b>Nhà máy Bình Dương</b><span class="sep">▸</span><span>Xưởng SMT</span>';
  const hdr = header({
    crumbs,
    allStates: STATES,
    chip: { "binh-thuong": chipNormal, "p1-chua-ack": chipP1(2, 2), "du-lieu-cu": chipNormal },
    freshMap: { "binh-thuong": fresh("live", "Trực tiếp"), "p1-chua-ack": fresh("live", "Trực tiếp"), "du-lieu-cu": fresh("stale", "DỮ LIỆU CŨ · 4 phút") },
  });
  return trang({
    tieuDe: "Màn 1 · Trang chủ theo vai",
    active: "home",
    badgeRail: "4",
    appAttrs: 'data-density="comfortable" data-state="binh-thuong" data-role="giam-sat" data-scope="real" data-rail="closed"',
    hdr,
    main,
    demoHtml: demo([
      { nhan: "Trạng thái", khoa: "state", muc: [["binh-thuong", "Bình thường"], ["p1-chua-ack", "Có P1 chưa ack"], ["du-lieu-cu", "Dữ liệu cũ"]] },
      { nhan: "Mật độ", khoa: "density", muc: [["comfortable", "1280×800"], ["default", "1920×1080"]] },
      { nhan: "Rail", khoa: "rail", muc: [["closed", "Thu gọn"], ["open", "Mở"]] },
    ]),
    mauCss: `
.pm { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; white-space: nowrap; color: var(--packml-execute); }
.pm i { font-style: normal; font-size: 12px; }
.pm.idle { color: var(--packml-idle); } .pm.held { color: var(--packml-held); } .pm.stopped { color: var(--packml-stopped); } .pm.aborted { color: var(--packml-aborted); }
.stack-lg { display: flex; flex-direction: column; gap: var(--gap-4); }
.grid.strip { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.yb { display: flex; align-items: flex-end; gap: 6px; height: 48px; padding-top: var(--gap-2); }
.yb i { flex: 1 1 0; background: var(--isa-graphic-muted); border-radius: var(--radius-1) var(--radius-1) 0 0; min-height: 4px; }
`,
  });
}
