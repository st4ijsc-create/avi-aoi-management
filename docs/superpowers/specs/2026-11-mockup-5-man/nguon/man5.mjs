/* Màn 5 — Tài sản (`/tai-san`, TechDocs 10 §4.2 + 20 §4). Master-detail: HierarchyTree + AssetDetail. Trạng thái: máy thật · máy mô phỏng · ngoài phạm vi · wizard (ngăn phủ). */
import { i, ic, alarmBadge, origin, fresh, header, demo, trang, chipNormal } from "./chung.mjs";

const STATES = ["may-that", "may-sim", "ngoai-pham-vi", "wizard"];
const mini = (n, extra = "") => ic(n).replace("<svg", `<svg width="16" height="16" ${extra} style="stroke:currentColor;fill:none;stroke-width:2;flex:none"`);

/** Một nút của cây: cấp (0..4), mở?, nhãn, loại icon, nguồn gốc, số thiết bị, ưu tiên cảnh báo cao nhất + số, chọn? */
const nut = (lvl, mo, nhan, kind, org, dem, alarm, sel) => {
  const car = mo === null ? '<span class="car"></span>' : `<span class="car">${mo ? "▾" : "▸"}</span>`;
  const bd = alarm ? `<span class="tn-al">${alarmBadge(alarm[0], { chu: false }).replace('<span class="n">' + alarm[0] + "</span>", '<span class="n">' + alarm[1] + "</span>")}</span>` : "";
  return `<li class="tn l${lvl} ${sel ? "sel" : ""}" role="treeitem" aria-selected="${sel ? "true" : "false"}">${car}<span class="ico">${mini({ ent: "folder", site: "factory", area: "folder", line: "link", asset: "box" }[kind])}</span><span class="lb ${kind === "asset" ? "mono" : ""}">${nhan}</span>${org && org !== "real" ? origin(org) : ""}<span class="cnt num">${dem}</span>${bd}</li>`;
};

function cay(s) {
  if (s === "ngoai-pham-vi") {
    return [
      nut(0, true, "Công ty ABC", "ent", "real", "—", null, false),
      nut(1, true, "Nhà máy Bình Dương", "site", "real", 14, null, false),
      nut(2, true, "Xưởng SMT", "area", "real", 14, null, false),
      nut(3, true, "Line SMT-01", "line", "real", 14, [3, 1], false),
      nut(4, null, "SMT01-PRN-01", "asset", "real", "", [3, 1], false),
      nut(4, null, "SMT01-SPI-01", "asset", "real", "", null, false),
      nut(4, null, "SMT01-MNT-01", "asset", "real", "", null, false),
      nut(4, null, "SMT01-AOI-03", "asset", "real", "", null, false),
    ].join("");
  }
  const sim = s === "may-sim";
  return [
    nut(0, true, "Công ty ABC", "ent", "real", "—", null, false),
    nut(1, true, "Nhà máy Bình Dương", "site", "real", 142, [1, 2], false),
    nut(2, true, "Xưởng SMT", "area", "real", 61, [1, 2], false),
    nut(3, true, "Line SMT-03", "line", "real", 18, [1, 2], false),
    nut(4, null, "SMT03-MNT-04", "asset", "real", "", [1, 1], false),
    nut(4, null, "SMT03-REF-01", "asset", "real", "", [1, 1], false),
    nut(4, null, "SMT03-AOI-07", "asset", "real", "", [2, 1], !sim),
    nut(4, null, "SMT03-SPI-02", "asset", "real", "", null, false),
    nut(3, false, "Line SMT-02", "line", "real", 15, [2, 1], false),
    nut(3, false, "Line SMT-01", "line", "real", 14, [3, 1], false),
    nut(2, false, "Xưởng THT", "area", "real", 38, [2, 1], false),
    nut(1, true, "Nhà máy Thử nghiệm", "site", "sim", 26, null, false),
    nut(2, true, "Xưởng mô phỏng", "area", "sim", 26, null, false),
    nut(3, true, "Line SIM-01", "line", "sim", 9, null, false),
    nut(4, null, "SIM-AOI-01", "asset", "sim", "", null, sim),
    nut(4, null, "SIM-SPI-01", "asset", "sim", "", null, false),
    nut(1, false, "Nhà máy QA", "site", "qa", 12, null, false),
  ].join("");
}

const tabs = (act) => `<div class="tabs" role="tablist" aria-label="Chi tiết tài sản">${[
  ["tq", "Tổng quan", "duLieuChu.taiSan.tab.tongQuan"],
  ["kn", "Kết nối & tag", "duLieuChu.taiSan.tab.ketNoiTag"],
  ["ct", "Chứng thực", "duLieuChu.taiSan.tab.chungThuc"],
  ["ch", "Cấu hình", "duLieuChu.taiSan.tab.cauHinh"],
  ["3d", "Mô hình 3D", "duLieuChu.taiSan.tab.mo3d"],
  ["ls", "Lịch sử", "duLieuChu.taiSan.tab.lichSu"],
]
  .map(([k, l, key]) => `<button role="tab" aria-selected="${k === act}">${i(key, l)}</button>`)
  .join("")}</div>`;

const roleIc = (n) => ic(n).replace("<svg", '<svg width="18" height="18" style="stroke:currentColor;fill:none;stroke-width:2;flex:none"');
const tag = (role, ten, key, addr, kieu, dv, w, mucAct, nl, gt, ghi = "") => `<tr>
  <td><span class="row">${roleIc(role)}<span><b>${ten}</b><br><span class="ds-small mono">${key}</span></span></span></td>
  <td class="mono" style="font-size:12px">${addr}<br><span class="ds-small" style="font-family:var(--font-body)">${kieu}${dv ? " · " + dv : ""}</span></td>
  <td><span class="flags">${w ? `<span class="flag" title="Ghi được">✎</span>` : ""}${mucAct ? `<span class="flag act" title="Mức tác động ${mucAct}">L${mucAct}</span>` : ""}${nl ? `<span class="flag" title="Tag năng lượng">⚡</span>` : ""}${!w && !mucAct && !nl ? '<span class="muted">—</span>' : ""}</span></td>
  <td class="num">${gt}${ghi}</td></tr>`;

function chiTietThat() {
  return `
  <div class="d-h">
    <div class="grow">
      <div class="row" style="flex-wrap:wrap"><h2 class="ds-h2" style="margin:0">Máy kiểm tra quang học AOI-07</h2><b class="mono">SMT03-AOI-07</b>${origin("real")}<span class="pill">Đang hoạt động</span><span class="pill fresh stale"><span class="dot"></span>2/3 kết nối · 1 cũ 4 ph</span></div>
      <div class="ds-small" style="margin-top:4px">Công ty ABC ▸ Nhà máy Bình Dương ▸ Xưởng SMT ▸ Line SMT-03</div>
    </div>
    <div class="act"><a class="btn" href="#">${i("duLieuChu.taiSan.moFaceplate", "Mở faceplate ↗")}</a><button class="btn" type="button">${i("duLieuChu.taiSan.doiVongDoi", "Đổi vòng đời ▾")}</button><button class="btn" type="button">${i("duLieuChu.taiSan.luuTru", "Lưu trữ")}</button></div>
  </div>
  ${tabs("kn")}
  <div class="d-b">
    <div class="sec-h">${i("duLieuChu.taiSan.ketNoi", "Kết nối (3) — chọn một kết nối để xem tag")}</div>
    <div class="grid cn-cards">
      <div class="cn sel"><div class="row sp-b"><b>OPC UA</b><span class="ast"><i class="s">●</i>Đã kết nối · <span class="num">1 s</span></span></div><span class="mono ds-small">opc.tcp://10.20.3.17:4840</span><div class="row sp-b"><span class="ds-small">hỏi 1000 ms · edge-bd-01</span><button class="btn sm" type="button">Thử</button></div></div>
      <div class="cn"><div class="row sp-b"><b>MQTT</b><span class="ast"><i class="s">●</i>Đã kết nối · <span class="num">0,4 s</span></span></div><span class="mono ds-small">mqtt://broker-bd:1883 · aoi07/#</span><div class="row sp-b"><span class="ds-small">đẩy · trung tâm</span><button class="btn sm" type="button">Thử</button></div></div>
      <div class="cn stale"><div class="row sp-b"><b>Modbus TCP</b><span class="ast is-stale"><i class="s">◇</i>Mất kết nối · <span class="num">4 ph</span></span></div><span class="mono ds-small">10.20.3.18:502</span><div class="row sp-b"><span class="ds-small">hỏi 5000 ms · edge-bd-01</span><button class="btn sm" type="button">Kết nối lại</button></div></div>
    </div>
    <div class="row sp-b" style="margin-top:var(--gap-2)"><div class="sec-h" style="margin:0">${i("duLieuChu.taiSan.tagCua", "Tag của kết nối OPC UA (6)")}</div><div class="row"><button class="btn sm" type="button">${i("duLieuChu.taiSan.sinhTuMau", "Sinh từ mẫu")}</button><button class="btn sm" type="button">${i("duLieuChu.taiSan.docThu", "Đọc thử")}</button></div></div>
    <div class="note-warn" role="note">⚠ Lớp <b>AOI</b> yêu cầu tag <span class="mono">fault</span> — chưa có tag nào đóng vai này. Hiển thị là <b>“không có tín hiệu”</b>, không phải “bình thường”.</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vai (role)</th><th>Địa chỉ · kiểu</th><th>Cờ</th><th class="num">Giá trị sống</th></tr></thead><tbody>
      ${tag("play", "Trạng thái máy", "machine_state", "ns=2;s=AOI.State", "enum", "", false, 0, false, '<span class="num">EXECUTE</span><br><span class="ds-small">tốt · 1 s</span>')}
      ${tag("clock", "Thời gian chu kỳ", "cycle_time_s", "ns=2;s=AOI.Cycle", "float", "s", false, 0, false, '<span class="num">11,8 s</span><br><span class="ds-small">tốt · 1 s</span>')}
      ${tag("chart", "Tỉ lệ lỗi", "fail_rate_pct", "ns=2;s=AOI.FailRate", "float", "%", false, 0, false, '<span class="num">4,8 %</span><br><span class="ds-small">tốt · 1 s</span>')}
      ${tag("bolt", "Tốc độ băng tải", "conv_speed", "ns=2;s=AOI.Conv.Set", "float", "m/ph", true, 3, false, '<span class="num">0,85 m/ph</span><br><span class="ds-small">tốt · 1 s</span>')}
      ${tag("bolt", "Công suất", "power_kw", "ns=2;s=AOI.Power", "float", "kW", false, 0, true, '<span class="num is-uncertain" style="display:inline-block;padding:0 4px">1,42 kW</span><br><span class="ds-small">không chắc · 9 s</span>')}
      <tr class="vang"><td><span class="row">${roleIc("alert")}<span><b>Lỗi máy</b><br><span class="ds-small mono">fault</span></span></span></td><td class="ds-small">chưa cấu hình</td><td><span class="muted">—</span></td><td class="no-signal">không có tín hiệu</td></tr>
    </tbody></table></div>
  </div>`;
}

function chiTietSim() {
  return `
  <div class="d-h">
    <div class="grow">
      <div class="row" style="flex-wrap:wrap"><h2 class="ds-h2" style="margin:0">AOI mô phỏng SIM-AOI-01</h2><b class="mono">SIM-AOI-01</b>${origin("sim")}<span class="pill">Đang hoạt động</span><span class="pill fresh sim"><span class="dot"></span>Mô phỏng · 1/1 kết nối</span></div>
      <div class="ds-small" style="margin-top:4px">Công ty ABC ▸ Nhà máy Thử nghiệm ▸ Xưởng mô phỏng ▸ Line SIM-01</div>
    </div>
    <div class="act"><a class="btn" href="#">${i("duLieuChu.taiSan.moFaceplate", "Mở faceplate ↗")}</a><button class="btn" type="button">${i("duLieuChu.taiSan.doiVongDoi", "Đổi vòng đời ▾")}</button><button class="btn" type="button">${i("duLieuChu.taiSan.luuTru", "Lưu trữ")}</button></div>
  </div>
  ${tabs("tq")}
  <div class="d-b">
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      <div class="stack"><div class="sec-h">${i("duLieuChu.taiSan.lop", "Lớp thiết bị")}</div><a href="#" style="color:var(--accent);font-weight:600">AOI — Kiểm tra quang học ↗</a><span class="ds-small">Lớp đã xuất bản · v3 · bộ tag mẫu 18</span></div>
      <div class="stack"><div class="sec-h">${i("duLieuChu.taiSan.thongTinGoc", "Thông tin gốc")}</div><span class="ds-body">Hãng: <b>Simulator</b> · Model: <b>AOI-SIM-1</b></span><span class="ds-body">Serial: <span class="mono">SIM-0001</span> · FW: <span class="mono">sim-1.4.2</span></span></div>
    </div>
    <div class="sec-h">${i("duLieuChu.taiSan.thuocTinh", "Thuộc tính theo lược đồ lớp")}</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
      <label class="stack"><span class="ds-small">Độ phân giải camera</span><span class="field num">15 µm/px</span></label>
      <label class="stack"><span class="ds-small">Số camera</span><span class="field num">4</span></label>
      <label class="stack"><span class="ds-small">PCB tối đa (D × R)</span><span class="field num">450 × 350 mm</span></label>
      <label class="stack"><span class="ds-small">Chế độ kiểm</span><span class="field">2D + 3D</span></label>
    </div>
    <div class="row"><span class="pill">✓ class.validate: 12/12 hợp lệ</span><span class="ds-small">Lần kiểm 19:40</span></div>
  </div>`;
}

const ngoaiPhamVi = `
  <div class="d-b" style="padding:var(--gap-5)">
    <div class="empty" role="status">
      ${ic("lock")}
      <h2 class="ds-h3" style="margin:0">${i("chung.phamViRong.tieuDe", "Ngoài phạm vi của bạn")}</h2>
      <p class="ds-body" style="margin:0;max-width:46ch">${i("chung.phamViRong", "Tài khoản của bạn chưa được gán phạm vi cho nút “Line SMT-03” (từ liên kết ?node=SMT-03; nút này không có trong cây của bạn). Không có dữ liệu nào được hiển thị — đây không phải trạng thái “rỗng bình thường”.")}</p>
      <div class="row"><button class="btn primary" type="button">${i("chung.xinCapPhamVi", "Xin cấp phạm vi")}</button><button class="btn" type="button">${i("chung.veNutTrongPhamVi", "Về nút trong phạm vi của tôi")}</button></div>
    </div>
  </div>`;

const wizard = `<aside class="drawer wiz" data-st="wizard" aria-label="Thêm thiết bị">
  <div class="h"><div class="row sp-b"><h2 class="ds-h3" style="margin:0">${i("duLieuChu.taiSan.wizard.tieuDe", "Thêm thiết bị")}</h2><button class="btn sm quiet" type="button" aria-label="Đóng">${mini("x")}</button></div>
    <ol class="steps" aria-label="6 bước">${["Lớp", "Vị trí", "Kết nối", "Tag", "Chứng thực", "Nghiệm thu"].map((t, k) => `<li class="${k < 2 ? "done" : k === 2 ? "cur" : ""}"><span class="no">${k < 2 ? "✓" : k + 1}</span><span class="t">${t}</span></li>`).join("")}</ol></div>
  <div class="b">
    <div class="stack"><div class="sec-h">${i("duLieuChu.taiSan.wizard.b3", "Bước 3 · Kết nối")}</div><span class="ds-small">Lớp <b>AOI</b> gợi ý giao thức OPC UA. Không quét mạng ở v1 — nhập điểm cuối.</span></div>
    <label class="stack"><span class="ds-small">Giao thức</span><span class="field">OPC UA ▾ <span class="ds-small">(gợi ý từ lớp)</span></span></label>
    <label class="stack"><span class="ds-small">Điểm cuối</span><span class="field mono">opc.tcp://10.20.3.21:4840</span></label>
    <div class="grid" style="grid-template-columns:1fr 1fr"><label class="stack"><span class="ds-small">Chu kỳ hỏi</span><span class="field num">5000 ms</span></label><label class="stack"><span class="ds-small">Chủ kết nối</span><span class="field">Edge edge-bd-01 ▾</span></label></div>
    <label class="stack"><span class="ds-small">Chế độ bảo mật</span><span class="field">Sign &amp; Encrypt ▾</span></label>
    <div class="row"><button class="btn" type="button">${i("duLieuChu.taiSan.wizard.thu", "Thử kết nối")}</button><span class="pill">✓ Kết nối được · <span class="num">142 ms</span> · đọc 3/3 node mẫu</span></div>
  </div>
  <div class="f"><button class="btn" type="button">← Quay lại</button><button class="btn" type="button">Lưu nháp</button><button class="btn primary" type="button">Tiếp: Tag →</button></div>
</aside>`;

export function man5() {
  const main = `
    <div class="page-h">
      <div class="t">
        <h1 class="ds-h1">${i("duLieuChu.taiSan.tieuDe", "Tài sản")}</h1>
        <div class="sub">Phạm vi hiện tại: <span data-st="may-that wizard">Nhà máy Bình Dương</span><span data-st="may-sim">Nhà máy Thử nghiệm (mô phỏng)</span><span data-st="ngoai-pham-vi">Line SMT-01 (được gán)</span></div>
      </div>
      <div class="act"><button class="btn" type="button">${i("duLieuChu.taiSan.choDuyet", "Chờ duyệt (3)")}</button><button class="btn" type="button">${i("duLieuChu.taiSan.themNut", "Thêm nút ▾")}</button><button class="btn" type="button">${i("duLieuChu.taiSan.thungRac", "Thùng rác")}</button><button class="btn" type="button">${i("duLieuChu.taiSan.nhapXuat", "Nhập/Xuất")}</button><button class="btn primary" type="button">${i("duLieuChu.taiSan.themThietBi", "Thêm thiết bị")}</button></div>
    </div>
    <div class="md">
      <section class="card cay" aria-label="Cây ISA-95">
        <div class="cay-h"><span class="field grow">${mini("search")} Tìm nút, mã, thiết bị…</span></div>
        ${STATES.map((s) => `<ul class="tree" role="tree" data-st="${s}">${cay(s)}</ul>`).join("")}
        <div class="cay-f ds-small">Cây ảo hoá · tải theo cấp · <span class="num" data-st="may-that may-sim wizard">142</span><span class="num" data-st="ngoai-pham-vi">14</span> thiết bị trong phạm vi</div>
      </section>
      <section class="card det" aria-label="Chi tiết">
        <div class="ctn" data-st="may-that wizard">${chiTietThat()}</div>
        <div class="sim-frame ctn-block" data-st="may-sim">${chiTietSim()}</div>
        <div class="ctn" data-st="ngoai-pham-vi">${ngoaiPhamVi}</div>
      </section>
    </div>`;
  const hdr = header({
    crumbs: '<span class="ctn" data-sc="real"><b>Công ty ABC</b><span class="sep">▸</span><b>Nhà máy Bình Dương</b></span><span class="ctn" data-sc="sim"><b>Công ty ABC</b><span class="sep">▸</span><b>Nhà máy Thử nghiệm</b><span class="sep">▸</span><span>Xưởng mô phỏng</span></span>',
    allStates: STATES,
    chip: { "may-that": chipNormal, "may-sim": chipNormal, "ngoai-pham-vi": chipNormal, wizard: chipNormal },
    freshMap: { "may-that": fresh("live", "Trực tiếp"), "may-sim": fresh("sim", "Mô phỏng"), "ngoai-pham-vi": fresh("live", "Trực tiếp"), wizard: fresh("live", "Trực tiếp") },
  });
  return trang({
    tieuDe: "Màn 5 · Tài sản",
    active: "du-lieu-chu",
    badgeRail: "",
    appAttrs: 'data-density="comfortable" data-state="may-that" data-scope="real" data-rail="closed"',
    hdr,
    main,
    drawer: wizard,
    demoHtml: demo([
      { nhan: "Trạng thái", khoa: "state", muc: [["may-that", "Máy thật"], ["may-sim", "Máy mô phỏng"], ["ngoai-pham-vi", "Ngoài phạm vi"], ["wizard", "Wizard bước 3"]] },
      { nhan: "Phạm vi", khoa: "scope", muc: [["real", "Thật"], ["sim", "Mô phỏng"]] },
      { nhan: "Mật độ", khoa: "density", muc: [["comfortable", "1280×800"], ["default", "1920×1080"]] },
      { nhan: "Rail", khoa: "rail", muc: [["closed", "Thu gọn"], ["open", "Mở"]] },
    ]),
    mauCss: `
.md { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: var(--gap-4); align-items: start; }
.cay { display: flex; flex-direction: column; overflow: hidden; }
.cay-h, .cay-f { padding: var(--gap-3); }
.cay-h { border-bottom: 1px solid var(--isa-line); display: flex; }
.cay-f { border-top: 1px solid var(--isa-line); }
.tree { list-style: none; margin: 0; padding: var(--gap-2) 0; }
.tn { display: flex; align-items: center; gap: var(--gap-2); min-height: var(--touch-min); padding: 0 var(--gap-3); font-size: 13px; position: relative; }
.tn.sel { background: var(--accent-soft); box-shadow: inset 4px 0 0 var(--accent); }
.tn .car { width: 14px; color: var(--text-3); font-size: 11px; flex: none; }
.tn .ico { color: var(--text-2); display: inline-flex; }
.tn .lb { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--text-1); }
.tn .lb.mono { font-size: 12px; }
.tn .cnt { margin-left: auto; color: var(--text-3); font-size: 12px; }
.tn .origin { min-height: 20px; font-size: 11px; }
.tn.l1 { padding-left: calc(var(--gap-3) + 14px); } .tn.l2 { padding-left: calc(var(--gap-3) + 28px); } .tn.l3 { padding-left: calc(var(--gap-3) + 42px); } .tn.l4 { padding-left: calc(var(--gap-3) + 56px); }
.tn-al .alarm-badge { min-height: 22px; padding: 0 6px; font-size: 11px; }
.det { overflow: hidden; }
.d-h { display: flex; gap: var(--gap-4); align-items: flex-start; flex-wrap: wrap; padding: var(--gap-4); border-bottom: 1px solid var(--isa-line); }
.d-h .grow { flex: 1 1 320px; }
.d-h .act { flex: none; display: flex; gap: var(--gap-2); flex-wrap: wrap; }
.cay { max-height: calc(100vh - 190px); }
.cay .tree { overflow: auto; flex: 1 1 auto; }
.cn-cards { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: var(--gap-3); }
.cn { border: 1px solid var(--isa-line); border-radius: var(--radius-2); padding: var(--gap-3); display: flex; flex-direction: column; gap: var(--gap-2); background: var(--isa-surface); }
.cn.sel { border-color: var(--accent); box-shadow: inset 4px 0 0 var(--accent); background: var(--accent-soft); }
.cn.stale { border-style: dashed; border-color: var(--stale); }
.d-b { padding: var(--gap-4); display: flex; flex-direction: column; gap: var(--gap-3); }
.det .tabs { padding: 0 var(--gap-4); }
.ctn-block { display: block; }
.flags { display: inline-flex; gap: 6px; align-items: center; }
.flag { font: 700 12px/1 var(--font-body); padding: 3px 6px; border: 1px solid var(--isa-line-strong); border-radius: var(--radius-1); color: var(--text-1); background: var(--isa-surface-2); }
.flag.act { border-color: var(--actuation-3); color: var(--actuation-3); }
.note-warn { padding: var(--gap-2) var(--gap-3); border: 1px dashed var(--alarm-p3); background: var(--alarm-p3-soft); color: var(--alarm-p3-ink); border-radius: var(--radius-2); font-size: 13px; }
.vang td { background: var(--isa-surface-2); }
.wiz { --drawer-w: 520px; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; gap: var(--gap-2); }
.steps li { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; gap: 4px; position: relative; }
.steps .no { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font: 700 12px/1 var(--font-mono); border: 2px solid var(--isa-line-strong); color: var(--text-2); background: var(--isa-surface); }
.steps li.done .no { background: var(--text-2); border-color: var(--text-2); color: var(--accent-ink); }
.steps li.cur .no { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.steps .t { font-size: 11px; color: var(--text-2); text-align: center; }
.steps li.cur .t { color: var(--accent); font-weight: 700; }
`,
  });
}
