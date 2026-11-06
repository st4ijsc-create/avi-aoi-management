/* Màn 4 — Cảnh báo (`/canh-bao`, TechDocs 40 §4). Trạng thái: 12 cảnh báo hỗn hợp · lũ (ALARM_FLOOD) · hàng tag stale · chi tiết (AlarmDrawer). */
import { i, ic, alarmBadge, fresh, header, chipP1, demo, trang, GLYPH } from "./chung.mjs";

const STATES = ["hon-hop", "lu", "du-lieu-cu", "p1-tuoi-line-cu", "chi-tiet"];

const AST = {
  "act-unack": ["●", "Đang kích hoạt · chưa ack"],
  acked: ["◐", "Đã ack"],
  "cleared-unack": ["○", "Đã hết · chưa ack"],
  shelved: ["⏸", "Tạm ẩn đến 17:30"],
  oos: ["⊘", "Ngoài dịch vụ (bảo trì)"],
};
const ast = (k) => `<span class="ast ${k}"><i class="s">${AST[k][0]}</i>${AST[k][1]}</span>`;

// id, ưu tiên, tài sản (line ▸ máy), mã, thông điệp, giá trị, giới hạn, tuổi, trạng thái, bậc leo thang
const ROWS = [
  [1, 1, "SMT-03 ▸ SMT03-MNT-04", "FEEDER_JAM_12", "Kẹt feeder #12 — máy dừng gắp", "kẹt = 1", "—", "00:42", "act-unack", "Bậc 1/3 · còn 04:18"],
  [2, 1, "SMT-03 ▸ SMT03-REF-01", "OVEN_ZONE5_HH", "Lò reflow vùng 5 quá nhiệt (HH)", "268,4 °C", "HH 265 °C", "03:10", "act-unack", "Bậc 2/3 · còn 01:50"],
  [3, 2, "SMT-03 ▸ SMT03-AOI-07", "AOI_FAILRATE_HI", "Tỉ lệ lỗi AOI vượt ngưỡng", "4,8 %", "H 3,0 %", "12:30", "acked", "—"],
  [4, 2, "SMT-02 ▸ SMT02-SPI-02", "SPI_VOL_DEV", "Lệch thể tích kem hàn dưới mức", "78 %", "L 85 %", "18:05", "act-unack", "Bậc 1/3 · còn 06:55"],
  [5, 2, "THT-01 ▸ THT-WAVE-01", "WAVE_PRE_LO", "Nhiệt sấy sóng thấp", "86,1 °C", "L 90 °C", "21:40", "act-unack", "Bậc 1/3 · còn 03:20"],
  [6, 3, "SMT-01 ▸ SMT01-PRN-01", "SQUEEGEE_WEAR", "Dao gạt gần hết tuổi thọ", "92 %", "H 90 %", "1:12:05", "acked", "—"],
  [7, 3, "SMT-03 ▸ SMT03-CNV-02", "CNV_SPEED_DEV", "Lệch tốc độ băng tải", "0,82 m/ph", "L 0,85 m/ph", "22:40", "cleared-unack", "Bậc 1/3 · còn 02:10"],
  [8, 3, "PKG ▸ PKG-WH-01", "AIR_PRESS_LO", "Áp khí nén thấp", "0,52 MPa", "L 0,55 MPa", "05:12", "act-unack", "Bậc 1/3 · còn 04:50"],
  [9, 3, "SMT-01 ▸ SMT01-AOI-03", "COMM_SLOW", "Giao tiếp chậm — trễ vòng hỏi 2,4 s", "2,4 s", "H 2,0 s", "3:05:00", "oos", "—"],
  [10, 4, "SMT-03 ▸ SMT03-AOI-07", "CAL_DUE", "Sắp đến hạn hiệu chuẩn camera", "còn 6 ngày", "≤ 7 ngày", "2:40:11", "acked", "—"],
  [11, 4, "SMT-02 ▸ SMT02-MNT-01", "NOZZLE_CLEAN", "Nhắc vệ sinh đầu hút", "—", "—", "4:02:30", "shelved", "—"],
  [12, 4, "SMT-03", "LOG_DISK", "Ổ nhật ký gần đầy", "91 %", "H 90 %", "5:30:12", "acked", "—"],
];

function bang(s) {
  const stale = s === "du-lieu-cu" || s === "p1-tuoi-line-cu"; // id 5 = hàng có tag cũ
  // du-lieu-cu = ca "P1 NGUỒN CŨ": P1 chưa ack DUY NHẤT là hàng tag cũ (WAVE_PRE_LO nâng P1); hai P1 kia về "đã ack" ⇒ chip đứng yên + dấu cũ.
  // p1-tuoi-line-cu = ca "P1 nguồn TƯƠI + line khác cũ": chỉ một hàng P2 có tag cũ ⇒ chip VẪN nhấp nháy (không fail-open).
  const ROWS_S = ROWS.map((r) => {
    if (s !== "du-lieu-cu") return r;
    if (r[0] === 1 || r[0] === 2) return [...r.slice(0, 8), "acked", "—"];
    if (r[0] === 5) return [r[0], 1, r[2], r[3], "Nhiệt sấy sóng thấp nghiêm trọng", r[5], r[6], r[7], r[8], r[9]];
    return r;
  }).sort((a, b) => a[1] - b[1]); // sắp theo ưu tiên (ổn định) — P1 mới nâng lên đầu bảng
  const chon = s === "hon-hop" ? [4, 5, 8] : []; // P1 phải ack từng hàng (chủ dự án 2026-11-03): chỉ chọn P2–P4
  const sel = s === "chi-tiet" ? 2 : -1;
  const hang = (r) => {
    const [id, p, ts, ma, tn, gt, gh, tuoi, tt, bac] = r;
    const isStaleRow = stale && id === 5;
    const giaTri = isStaleRow
      ? `<span class="num is-stale" title="Giá trị cũ — chưa xác nhận được vượt ngưỡng">82,4 °C</span> <span class="ds-small" style="color:var(--stale-ink)">cũ 3 ph</span>`
      : `<span class="num ${tt === "act-unack" && p <= 2 ? "gt-cao" : ""}">${gt}</span>`;
    return `<tr class="p${p} ${id === sel ? "sel" : ""}"${p === 1 && tt === "act-unack" ? " data-p1-unack" : ""}>
      <td><span class="chk ${chon.includes(id) ? "on" : ""}" role="checkbox" aria-checked="${chon.includes(id)}"></span></td>
      <td>${alarmBadge(p)}</td>
      <td class="ds-small" style="max-width:150px">${ts}</td>
      <td><b class="mono" style="font-size:12px">${ma}</b><br><span class="ds-body">${tn}</span></td>
      <td class="num">${giaTri}<br><span class="ds-small">${gh}</span></td>
      <td class="num">${tuoi}</td>
      <td>${ast(tt)}${bac !== "—" ? `<br><span class="ds-small">${bac}</span>` : ""}</td>
      <td style="white-space:nowrap">${tt === "act-unack" || tt === "cleared-unack" ? `<button class="btn sm primary" type="button">Ack</button> ` : ""}<button class="btn sm quiet" type="button">Chi tiết</button></td>
    </tr>`;
  };
  const head = `<thead><tr><th style="width:36px"></th><th>${i("giamSat.canhBao.cot.uuTien", "Ưu tiên")}</th><th>${i("giamSat.canhBao.cot.taiSan", "Tài sản")}</th><th>${i("giamSat.canhBao.cot.maThongDiep", "Mã · thông điệp")}</th><th class="num">${i("giamSat.canhBao.cot.giaTri", "Giá trị / giới hạn")}</th><th class="num">${i("giamSat.canhBao.cot.tuoi", "Tuổi")}</th><th>${i("giamSat.canhBao.cot.trangThai", "Trạng thái ISA-18.2 · leo thang")}</th><th></th></tr></thead>`;
  if (s === "lu") {
    const con = (p, ts, ma, tn, t) => `<tr class="p${p}"><td></td><td>${alarmBadge(p, { chu: false })}</td><td class="ds-small">${ts}</td><td><b class="mono" style="font-size:12px">${ma}</b> <span class="ds-small">${tn}</span></td><td class="num muted">—</td><td class="num">${t}</td><td>${ast("act-unack")}</td><td></td></tr>`;
    const nhom = (p, tieuDe, n) => `<tr class="grp p${p}"><td>${ic("chevd").replace("<svg", '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:2"')}</td><td>${alarmBadge(p)}</td><td colspan="4">Nguyên nhân gốc: ${tieuDe} <span class="ds-small">— gom ${n} cảnh báo thứ cấp</span></td><td class="ds-small">Bậc 2/3 · còn 01:20</td><td><button class="btn sm primary" type="button">Ack nhóm</button></td></tr>`;
    return `<table class="tbl">${head}<tbody>
      ${nhom(1, "PLC SMT03 mất kết nối (<span class='mono'>COMM_LOST</span>)", 24)}
      ${con(2, "SMT-03 ▸ SMT03-REF-01", "OVEN_ZONE5_HH", "vùng 5 quá nhiệt", "02:11")}
      ${con(2, "SMT-03 ▸ SMT03-MNT-04", "FEEDER_STARVE", "thiếu linh kiện, máy chờ", "02:11")}
      ${con(3, "SMT-03 ▸ SMT03-CNV-02", "CNV_SPEED_DEV", "lệch tốc độ băng tải", "02:10")}
      <tr><td></td><td colspan="7" class="ds-small" style="height:36px">… và 21 cảnh báo quy trình khác của các máy sau PLC (đang gom) <button class="btn sm quiet" type="button">mở rộng</button></td></tr>
      ${nhom(2, "Nhiệt độ lò reflow dao động (<span class='mono'>OVEN_TEMP_OSC</span>)", 8)}
      ${con(3, "SMT-03 ▸ SMT03-REF-01", "OVEN_ZONE3_H", "vùng 3 cao", "04:02")}
      <tr><td></td><td colspan="7" class="ds-small" style="height:36px">… và 7 cảnh báo thứ cấp khác</td></tr>
      ${hang(ROWS_S[0])}${hang(ROWS_S[1])}${hang(ROWS_S[3])}
    </tbody></table>`;
  }
  return `<table class="tbl">${head}<tbody>${ROWS_S.map(hang).join("")}</tbody></table>`;
}

const spark = `<svg viewBox="0 0 360 104" width="100%" height="104" role="img" aria-label="Nhiệt độ vùng 5 trong 15 phút, có khoảng hở mất tín hiệu">
  <line x1="0" y1="24" x2="360" y2="24" stroke="var(--alarm-p1)" stroke-width="1.5" stroke-dasharray="6 4"/>
  <text x="4" y="18" font-size="11" fill="var(--alarm-p1-ink)" font-family="var(--font-body)">HH 265 °C</text>
  <polyline fill="none" stroke="var(--text-1)" stroke-width="2" points="0,74 30,72 60,70 90,66 120,60 150,52 180,44"/>
  <polyline fill="none" stroke="var(--text-1)" stroke-width="2" points="222,34 250,30 280,27 310,22 340,20 360,18"/>
  <defs><pattern id="soc" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="var(--stale-soft)"/><rect width="3" height="8" fill="var(--stale)"/></pattern></defs>
  <rect x="182" y="10" width="38" height="76" fill="url(#soc)"/>
  <text x="184" y="98" font-size="11" fill="var(--stale-ink)" font-family="var(--font-body)">mất tín hiệu 5 s</text>
  <text x="0" y="98" font-size="11" fill="var(--text-3)" font-family="var(--font-body)">−15 ph</text><text x="330" y="98" font-size="11" fill="var(--text-3)" font-family="var(--font-body)">nay</text>
</svg>`;

const drawer = `<aside class="drawer" data-st="chi-tiet" aria-label="Chi tiết cảnh báo">
  <div class="h">
    <div class="row sp-b"><span class="row">${alarmBadge(1)}<b class="mono" style="font-size:13px">OVEN_ZONE5_HH</b></span><button class="btn sm quiet" type="button" aria-label="Đóng">${ic("x").replace("<svg", '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:2"')}</button></div>
    <h2 class="ds-h3" style="margin:0">Lò reflow vùng 5 quá nhiệt (HH)</h2>
    <div class="ds-small">SMT-03 ▸ SMT03-REF-01 · ${ast("act-unack")} · mở <span class="num">03:10</span></div>
  </div>
  <div class="b">
    <div class="row" style="align-items:stretch">
      <div class="metric p1" style="flex:1"><span class="ds-caption">Giá trị</span><span class="v">268,4<small>°C</small></span><span class="age">chất lượng tốt · 1 s trước</span></div>
      <div class="metric" style="flex:1"><span class="ds-caption">Giới hạn HH</span><span class="v">265,0<small>°C</small></span><span class="age">deadband 2 °C · trễ 5 s</span></div>
    </div>
    <div><div class="sec-h">${i("giamSat.canhBao.nguyenNhan", "Nguyên nhân có thể (từ định nghĩa)")}</div>
      <ul style="margin:0;padding-left:18px" class="ds-body"><li>Nhiệt kế vùng 5 lệch hiệu chuẩn</li><li>Quạt đối lưu vùng 5 giảm tốc</li><li>Băng tải dừng khi lò đang nóng</li></ul></div>
    <div><div class="sec-h">${i("giamSat.canhBao.hanhDong", "Hành động khuyến nghị")}</div>
      <ol style="margin:0;padding-left:18px" class="ds-body"><li>Kiểm tra băng tải có đang chạy không</li><li>Nếu &gt; 270 °C: dừng cấp bo, mở nắp tản nhiệt</li><li>Gọi bảo trì nếu không giảm sau 3 phút</li></ol></div>
    <div><div class="sec-h">${i("giamSat.canhBao.xuHuong15", "Xu hướng 15 phút (tag nhiệt vùng 5)")}</div>${spark}</div>
    <div><div class="sec-h">${i("giamSat.canhBao.nhatKy", "Nhật ký sự kiện")}</div>
      <ul class="tl"><li><span class="ts">19:58:02</span>Kích hoạt · giá trị 265,3 °C</li><li><span class="ts">19:58:07</span>Gửi thông báo bậc 1 (3 người)</li><li><span class="ts">20:01:10</span>Leo thang bậc 2 — chưa ack sau 3 phút</li><li><span class="ts">20:01:12</span>Gửi thông báo bậc 2 (2 người)</li></ul></div>
    <div><div class="sec-h">${i("giamSat.canhBao.giaoNhan", "Gửi thông báo")}</div>
      <div class="tbl-wrap"><table class="tbl"><tbody>
        <tr><td>SMS</td><td>Trưởng ca</td><td>✓ Đã gửi</td><td class="num">19:58:09</td></tr>
        <tr><td>Email</td><td>Quản lý SX</td><td>✓ Đã gửi</td><td class="num">20:01:12</td></tr>
        <tr><td>Zalo</td><td>Kỹ sư bảo trì</td><td style="color:var(--alarm-p2-ink);font-weight:600">✕ Lỗi — thử lại 1/3</td><td class="num">20:01:13</td></tr>
      </tbody></table></div></div>
  </div>
  <div class="f">
    <button class="btn primary" type="button">${i("chung.ack", "Ack")}</button><button class="btn" type="button">${i("giamSat.canhBao.shelve", "Tạm ẩn ▾")}</button><button class="btn" type="button">${i("giamSat.canhBao.ghiChu", "Ghi chú")}</button><button class="btn" type="button">${i("giamSat.canhBao.oos", "Ngoài dịch vụ")}</button><a class="btn quiet" href="#">${i("giamSat.canhBao.moMay", "Mở máy L3 ↗")}</a>
  </div>
</aside>`;

export function man4() {
  const prio = (p, n) => `<button class="btn sm" type="button" aria-pressed="true">${alarmBadge(p, { chu: false })}<span class="num">${n}</span></button>`;
  const main = `
    <div class="page-h">
      <div class="t">
        <h1 class="ds-h1">${i("giamSat.canhBao.tieuDe", "Cảnh báo")}</h1>
        <div class="sub">Phạm vi: Nhà máy Bình Dương · cập nhật theo thời gian thực</div>
      </div>
      <div class="act"><button class="btn" type="button">${i("giamSat.canhBao.amThanh", "Âm P1: bật")}</button><button class="btn" type="button">${i("chung.xuatCsv", "Xuất CSV")}</button></div>
    </div>
    <div class="tabs" role="tablist" aria-label="Cảnh báo">
      <button role="tab" aria-selected="true">${i("giamSat.canhBao.tab.dangMo", "Đang mở")}<span class="cnt">12</span></button>
      <button role="tab" aria-selected="false">${i("giamSat.canhBao.tab.andon", "Andon")}<span class="cnt">1</span></button>
      <button role="tab" aria-selected="false">${i("giamSat.canhBao.tab.lichSu", "Lịch sử")}</button>
      <button role="tab" aria-selected="false">${i("giamSat.canhBao.tab.kpi", "KPI")}</button>
      <button role="tab" aria-selected="false">${i("giamSat.canhBao.tab.dinhNghia", "Định nghĩa")}</button>
      <button role="tab" aria-selected="false">${i("giamSat.canhBao.tab.thongBao", "Thông báo")}</button>
    </div>
    <div class="flood" data-st="lu" role="alert">
      <span class="flood-ic">▲</span>
      <div class="grow"><b>LŨ CẢNH BÁO (ALARM_FLOOD)</b> — <span class="num">38</span> cảnh báo trong 10 phút (ngưỡng ISA-18.2: <span class="num">10</span>).<br><span class="ds-small" style="color:inherit">Đã gom theo nguyên nhân gốc; cảnh báo P1/P2 độc lập vẫn hiện đầy đủ bên dưới.</span></div>
      <div class="bars" aria-label="Số cảnh báo mỗi phút, 10 phút gần nhất">${[1, 1, 2, 1, 3, 6, 9, 8, 4, 3].map((v) => `<i class="${v >= 6 ? "hi" : ""}" style="height:${v * 4}px"></i>`).join("")}</div>
    </div>
    <div class="note-stale" data-st="du-lieu-cu"><span class="pill fresh stale"><span class="dot"></span>1 hàng có tag dữ liệu cũ</span> <span class="ds-small">P1 chưa ack DUY NHẤT nằm trên tag cũ — chưa thể xác nhận vượt ngưỡng; chip ở vỏ đứng yên + dấu cũ (nguồn cũ). Ưu tiên của cảnh báo vẫn giữ nguyên.</span></div>
    <div class="note-stale" data-st="p1-tuoi-line-cu"><span class="pill fresh stale"><span class="dot"></span>1 hàng P2 có tag dữ liệu cũ</span> <span class="ds-small">Các P1 chưa ack nằm trên nguồn TƯƠI nên chip vẫn nhấp nháy — một cảm biến hỏng không được tắt báo P1 toàn nhà máy.</span></div>
    <div class="filters">
      <span class="field">${ic("folder").replace("<svg", '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:2"')} Phạm vi: Nhà máy Bình Dương ▾</span>
      <span class="field">Loại: Cảnh báo ▾</span>
      ${[1, 2, 3, 4].map((p, k) => prio(p, [2, 3, 4, 3][k])).join("")}
      <span class="field"><span class="chk" role="checkbox" aria-checked="false"></span> Hiện tạm ẩn</span>
      <span class="field grow">${ic("search").replace("<svg", '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:2"')} Tìm mã, thông điệp, tài sản…</span>
    </div>
    <div class="bulk" data-st="hon-hop"><b class="num">3</b> hàng đã chọn · <button class="btn sm primary" type="button">Ack hàng loạt (chỉ P2–P4)</button><button class="btn sm" type="button">Tạm ẩn hàng loạt ▾</button><button class="btn sm quiet" type="button">Bỏ chọn</button></div>
    ${STATES.map((s) => `<div class="tbl-wrap" data-st="${s}">${bang(s)}</div>`).join("")}
  `;
  const hdr = header({
    crumbs: '<b>Công ty ABC</b><span class="sep">▸</span><b>Nhà máy Bình Dương</b>',
    allStates: STATES,
    chip: { "hon-hop": chipP1(2, 3), lu: chipP1(3, 5), "du-lieu-cu": chipP1(1, 3), "p1-tuoi-line-cu": chipP1(2, 3), "chi-tiet": chipP1(2, 3) },
    freshMap: { default: fresh("live", "Trực tiếp") },
  });
  return trang({
    tieuDe: "Màn 4 · Cảnh báo",
    active: "giam-sat",
    badgeRail: "5",
    appAttrs: 'data-density="comfortable" data-state="hon-hop" data-scope="real" data-rail="closed"',
    hdr,
    main,
    drawer,
    demoHtml: demo([
      { nhan: "Trạng thái", khoa: "state", muc: [["hon-hop", "12 hỗn hợp"], ["lu", "Lũ"], ["du-lieu-cu", "P1 nguồn cũ"], ["p1-tuoi-line-cu", "P1 tươi + tag cũ"], ["chi-tiet", "Chi tiết"]] },
      { nhan: "Mật độ", khoa: "density", muc: [["comfortable", "1280×800"], ["default", "1920×1080"]] },
      { nhan: "Rail", khoa: "rail", muc: [["closed", "Thu gọn"], ["open", "Mở"]] },
    ]),
    mauCss: `
.flood { display: flex; align-items: center; gap: var(--gap-4); padding: var(--gap-3) var(--gap-4); background: var(--alarm-p2-soft); color: var(--alarm-p2-ink); border: 2px solid var(--alarm-p2); border-radius: var(--radius-2); }
.flood-ic { font-size: 22px; color: var(--alarm-p2-ink); }
.bars { display: flex; align-items: flex-end; gap: 4px; height: 40px; }
.bars i { width: 10px; background: var(--isa-graphic-muted); border-radius: 2px 2px 0 0; min-height: 4px; }
.bars i.hi { background: var(--alarm-p2); }
.bulk { display: flex; align-items: center; gap: var(--gap-3); padding: var(--gap-2) var(--gap-4); background: var(--accent-soft); border: 1px solid var(--accent); border-radius: var(--radius-2); color: var(--text-1); }
.note-stale { display: flex; align-items: center; gap: var(--gap-3); flex-wrap: wrap; }
.gt-cao { font-weight: 700; color: var(--alarm-p1-ink); }
.tbl .num { white-space: nowrap; }
`,
  });
}
