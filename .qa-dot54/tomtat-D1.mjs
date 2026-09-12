// ĐỢT 46 · D-1 — BẢNG KẾT CỤC SÁU CỘT 32→37→39→41→44→HEAD 46 (từ tệp thô): Đợt 32 (.qa-dot32/nen*) → Đợt 37 (.qa-dot37/nen-*) → Đợt 39 (.qa-dot39/nen-*) → Đợt 41 (.qa-dot41/nen-*) → HEAD Đợt 44 (.qa-dot44/nen-*, mạng CDN chặn), sinh TỪ TỆP THÔ. 48 luật phán quyết GIỮ NGUYÊN của tomtat-D1 Đợt 37 (tệp này sinh bằng .qa-dot41/tao-tomtat.cjs).
// node .qa-dot44/tomtat-D1.mjs [--md=1]
import { existsSync, readFileSync } from "node:fs";
const j = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const CU = { A: ".qa-dot32/nen", A12: ".qa-dot32/nen-1280", R: ".qa-dot32/raised" };
const D37 = { A: ".qa-dot37/nen-1600x900", A12: ".qa-dot37/nen-1280x720", R: ".qa-dot37/raised-1600x900" };
const D39 = { A: ".qa-dot39/nen-1600x900", A12: ".qa-dot39/nen-1280x720", R: ".qa-dot39/raised-1600x900" };
const D41 = { A: ".qa-dot41/nen-1600x900", A12: ".qa-dot41/nen-1280x720", R: ".qa-dot41/raised-1600x900" };
const D44 = { A: ".qa-dot44/nen-1600x900", A12: ".qa-dot44/nen-1280x720", R: ".qa-dot44/raised-1600x900" };
// ★ Đợt 47 — cột 6 = Đợt 46 (QA lần 6, .qa-dot46/nen-*); cột 7 = HEAD Đợt 47 (.qa-dot47/nen-*). Bản gốc 6 cột: .qa-dot46/tomtat-D1.mjs (QA đã sửa lỗi cột).
const D46 = { A: ".qa-dot46/nen-1600x900", A12: ".qa-dot46/nen-1280x720", R: ".qa-dot46/raised-1600x900" };
// ★ Đợt 49 — cột 8 nay = Đợt 51 (.qa-dot49/nen-*); cột 7 giữ HEAD Đợt 47. Luật 48 ca GIỮ NGUYÊN.
// ★ Đợt 48 — cột 7 = HEAD Đợt 47 (.qa-dot47/nen-*); cột 8 = QA lần 7 Đợt 48 (.qa-dot48/nen-*). Luật 48 ca GIỮ NGUYÊN.
// ★ ĐỢT 51 — cột "MOI" lấy từ ENV `D1_MOI` (mặc định `.qa-dot51`), cột trước lấy từ `D1_TRUOC`
//   (mặc định `.qa-dot50`). Chạy hai lần rồi diff = trả lời "0 đổi phán quyết" bằng SỐ,
//   không phải bằng lời khai. G130: KHÔNG ghi gì — script này chỉ ĐỌC.
const _M = process.env.D1_MOI ?? ".qa-dot51";
const _T = process.env.D1_TRUOC ?? ".qa-dot50";
const MOI = { A: `${_M}/nen-1600x900`, A12: `${_M}/nen-1280x720`, R: `${_M}/raised-1600x900` };
const D47 = { A: `${_T}/nen-1600x900`, A12: `${_T}/nen-1280x720`, R: `${_T}/raised-1600x900` };
const rows = [];
// luat: (json) => [giaTriHienThi, phanQuyet]  — phanQuyet ∈ ĐẠT | SAI | HỎNG | CHẶN-ĐÚNG | N/A
const add = (id, moTa, dir, file, luat, ghi) => {
  const c = j(`${CU[dir]}/${file}`), d = j(`${D37[dir]}/${file}`), e = j(`${D39[dir]}/${file}`), f = j(`${D41[dir]}/${file}`), g = j(`${D44[dir]}/${file}`), h = j(`${D46[dir]}/${file}`), i = j(`${D47[dir]}/${file}`), m = j(`${MOI[dir]}/${file}`);
  const [gc, pc] = c ? luat(c, "cu") : ["(không có tệp)", "HỎNG"];
  const [gd, pd] = d ? luat(d, "moi") : ["(không có tệp)", "HỎNG"];
  const [ge, pe] = e ? luat(e, "moi") : ["(không có tệp)", "HỎNG"];
  const [gf, pf] = f ? luat(f, "moi") : ["(không có tệp)", "HỎNG"];
  const [gg, pg] = g ? luat(g, "moi") : ["(không có tệp)", "HỎNG"];
  const [gh, ph] = h ? luat(h, "moi") : ["(không có tệp)", "HỎNG"];
  const [gi, pi] = i ? luat(i, "moi") : ["(không có tệp)", "HỎNG"];
  const [gm, pm] = m ? luat(m, "moi") : ["(không có tệp)", "HỎNG"];
  rows.push({ id, moTa, file: `${file}`, cu: gc, pcu: pc, d37: gd, pd37: pd, d39: ge, pd39: pe, d41: gf, pd41: pf, d44: gg, pd44: pg, d46: gh, pd46: ph, d47: gi, pd47: pi, moi: gm, pmoi: pm, ghi: ghi ?? "" });
};
const dat = (b) => (b ? "ĐẠT" : "SAI");
// ── vai A · 1600 ──
add(1, "/twin: canvas DOM = __soCanvas = 1", "A", "a1-twin.json", (x) => [`dom ${x.canvasDom} / kit ${x.__soCanvas}`, dat(x.canvasDom === 1 && x.__soCanvas === 1)]);
add(2, "/twin: lớp nhãn trùng canvas, tâm nhãn trong canvas", "A", "a1-twin.json", (x) => [`trùng ${x.nhan.lopTrungCanvas} · ${x.nhan.tamTrong}/${x.nhan.so}`, dat(x.nhan.lopTrungCanvas && x.nhan.tamTrong === x.nhan.so)]);
add(3, "/twin: đường đi tới màn Line/Máy (Đợt 32 đếm <a href>; QĐ-23 đi bằng setLocation ⇒ đo bằng bấm ở a2/K1/K2)", "A", "a1-twin.json", (x, k) => [`href line ${x.lienKet.hrefLine.length} · máy ${x.lienKet.hrefMay.length}`, k === "cu" ? "SAI" : "xem #7 / K1 / K2"], "cũ: 0 href và bấm ở lại /twin ⇒ SAI");
add(4, "/twin: chỉ báo kết nối sau 7 s", "A", "a1-twin.json", (x) => [`"${x.ketNoi}"`, x.ketNoi === "Live" ? "ĐẠT" : "SAI?"], "mới 'Waiting…' — broadcaster 10 s không phát khi subscribe; đo theo thời gian ở D-6");
add(5, "/twin 1600: dải hợp nhất không chồng lên nút", "A", "a1b-dai-hop-nhat.json", (x) => [`chồng ${x.chongLenNut.length}`, dat(x.chongLenNut.length === 0)]);
add(6, "/twin: bấm máy 14 ⇒ URL", "A", "a2-twin-chon-may.json", (x) => [x.urlSauClick, dat(x.urlSauClick === "/twin/may/14")]);
add(7, "/twin: ngăn nhúng (?xem=machine:14) tab 3D ⇒ 2 canvas (G99)", "A", "a2-twin-chon-may.json", (x, k) => [x.coNganNhung ? `ngăn ${x.coNganNhung}, sau tab3D dom ${x.sau?.canvasDom}/kit ${x.sau?.__soCanvas}` : "ngăn nhúng không còn (redirect /twin/may/14)", k === "cu" ? dat(false) : "N/A (mất lối vào)"]);
add(8, "/twin/line/2: 12/12 máy trong khung (kit ngoaiKhung=0, vẽ+giấu=12)", "A", "a3-line-2.json", (x) => { const d = x.__demNhan ?? {}; return [`vẽ ${d.ve} giấu ${d.biGiau} ngoàiKhung ${d.ngoaiKhung} tổng ${d.tong}`, dat(d.ngoaiKhung === 0 && d.ve + d.biGiau === 12)]; });
add(9, "/twin/line/2: lớp nhãn trùng canvas, tâm trong, 0 bị che", "A", "a3-line-2.json", (x) => [`trùng ${x.nhan.lopTrungCanvas} · tâm ${x.nhan.tamTrong}/${x.nhan.so} · che ${x.nhan.soBiChe}`, dat(x.nhan.lopTrungCanvas && x.nhan.tamTrong === x.nhan.so && x.nhan.soBiChe === 0)]);
add(10, "/twin/line/2: bấm ô trạm 14 ⇒ URL", "A", "a3-line-2.json", (x) => [x.sauClick?.url ?? "—", dat(x.sauClick?.url === "/twin/may/14")]);
add(11, "/twin/line/2: dải trạm 1 hàng, đáy ≤ 900", "A", "a3-line-2.json", (x) => [`đáy ${Math.max(...x.oTram.map((o) => o.day))} · ${x.oTram.length} ô`, dat(x.oTram.length === 12 && Math.max(...x.oTram.map((o) => o.day)) <= 900)]);
add(12, "/twin/line/2: ?cam= đổi camera thật", "A", "a3b-line-2-idle-cam.json", (x) => [`camĐổi ${x.camDoiCamera}`, dat(x.camDoiCamera === true)]);
add(13, "/twin/line/2: idle ≤ 2 khung/4 s (×2)", "A", "a3b-line-2-idle-cam.json", (x) => [`${x.idle1.khung}/${x.idle2.khung}`, dat(x.idle1.khung <= 2 && x.idle2.khung <= 2)]);
add(14, "/twin/may/14 1600: cockpit.h > khoiCanh.h, đáy = 900", "A", "a4-may-14.json", (x) => [`canh ${x.bbox.khoiCanh?.h} · cockpit ${x.bbox.cockpit?.h} · đáy ${x.bbox.man?.day}`, dat(x.bbox.cockpit?.h > x.bbox.khoiCanh?.h && x.bbox.man?.day <= 900)]);
add(15, "/twin/may/14: chip twin vs header cockpit (ONLINE/OFFLINE) nói MỘT điều", "A", "a4-may-14.json", (x) => [`chip ${x.chip.trangThai.giaTri} · header ${x.cockpit.online}`, dat((x.chip.trangThai.giaTri === "khong_ro") === (x.cockpit.online === "OFFLINE"))]);
add(16, "/twin/may/14: tuổi ngăn vs Connected/Disconnected", "A", "a4-may-14.json", (x) => [`"${x.ngan.doTuoi}" · ${x.cockpit.ketNoi}`, dat(x.cockpit.ketNoi === "Disconnected" && /54 days|Updated/.test(x.ngan.doTuoi ?? ""))]);
add(17, "/twin/may/14: ô Live state 'Status' = log thô cạnh Connection", "A", "a4-may-14.json", (x) => [`Status "${x.cockpit.status}" · ${x.cockpit.ketNoi}`, dat(!(x.cockpit.status === "online" && x.cockpit.ketNoi === "Disconnected"))], "MachineCockpit.tsx:935 in liveState.status thô");
add(18, "/twin/may/14: tab '3D model' cockpit ⇒ canvas DOM (RB-4, G99)", "A", "a4-may-14.json", (x) => [`dom ${x.tab3d.canvasDom} / kit ${x.tab3d.__soCanvas}`, dat(x.tab3d.canvasDom === 1)], "MachineCockpit.tsx:281 <Canvas> ngoài KhungCanh");
add(19, "/twin/may/14: ‹Line · Back · F5 · ‹Nhà máy · Back (5 bước)", "A", "a4-may-14.json", (x) => { const d = x.dieuHuong; const ok = d.sauVeLine.url === "/twin/line/2" && d.sauBack.url === "/twin/may/14" && d.sauF5.url === "/twin/may/14" && d.sauVeNhaMay.url.startsWith("/twin") && !d.sauVeNhaMay.url.startsWith("/twin/") && d.backTuNhaMay.url === "/twin/may/14"; return [`${ok ? 5 : "<5"}/5`, dat(ok)]; });
add(20, "/twin/may/14: chuỗi thời gian tuổi ở 4 s (không 'Never reported' giả)", "A", "a4b-may-14-thoi-gian.json", (x) => [x.moc.map((m) => m.doTuoi).join(" · ").slice(0, 80), dat(x.moc.every((m) => !/Never/.test(m.doTuoi ?? "")))]);
add(21, "/twin/may/14: idle theo mốc (khung/2 s tại 5 mốc) ≤ 2", "A", "a4b-may-14-thoi-gian.json", (x) => { const v = x.moc.map((m) => m.idle?.khung); return [v.join("/"), dat(v.every((n) => n <= 2))]; }, "bùng nổ theo chu kỳ — đo 40 s ở D-6");
add(22, "/twin-studio 1600: đáy ≤ 900", "A", "a5-studio.json", (x) => { const d = Math.max(...Object.values(x.tabs).map((t) => t.bbox?.man?.day ?? 0)); return [`đáy ${d}`, dat(d <= 900)]; });
add(23, "/twin-studio: tab thiết kế 1 canvas = kit", "A", "a5-studio.json", (x) => { const t = x.tabs["tab-thiet-ke"]; return [`dom ${t?.canvasDom} / kit ${t?.__soCanvas}`, dat(t?.canvasDom === 1 && t?.__soCanvas === 1)]; });
add(24, "deep-link /twin/may/14 (context mới): vỏ app", "A", "a6-deeplink-may-14.json", (x) => [`"${x.vo.tieuDeApp}" · canvas ${x.msToiCanvas} ms`, dat(x.vo.tieuDeApp === "Production (MES)")]);
add(25, "deep-link /twin/line/2 (context mới): vỏ app", "A", "a6b-deeplink-vo-shell.json", (x) => [`"${x.ds["/twin/line/2"].vo.tieuDeApp}"`, dat(x.ds["/twin/line/2"].vo.tieuDeApp === "Production (MES)")]);
add(26, "deep-link /twin-studio (context mới): vỏ app", "A", "a6b-deeplink-vo-shell.json", (x) => [`"${x.ds["/twin-studio"].vo.tieuDeApp}"`, dat(x.ds["/twin-studio"].vo.tieuDeApp === "Production (MES)")]);
add(27, "redirect 14 đường cũ + đối chứng sai TRƯỢT", "A", "a7-redirect.json", (x) => [`${x.dat}/14 · đối chứng trượt ${x.doiChungTruot}`, dat(x.dat === 14 && x.doiChungTruot)]);
add(28, "/twin?pv=line:2&chon=machine:14 ⇒ màn riêng (không phải Line tại chỗ)", "A", "a8-twin-pv-line-2.json", (x) => [x.url, dat(x.url.startsWith("/twin/may/14"))]);
add(29, "API máy 14: overview.status ↔ cockpit.connected ↔ DB (một hợp đồng)", "A", "a9-api-may-14.json", (x) => { const s = x.overview.m14?.status, c = x.cockpit.liveState?.value?.connected; return [`overview ${s} · connected ${c} · ts ${x.overview.m14?.tsTrangThai ?? "—"}`, dat(s === "offline" && c === false)]; });
add(30, "API máy 14: issue offline ageMinutes ≠ 0 (còn mở Đợt 34)", "A", "a9-api-may-14.json", (x) => { const o = (x.overview.iss14 ?? []).find((i) => i.kind === "offline"); return [o ? `offline:${o.ageMinutes}′` : "không có issue offline", o ? dat(o.ageMinutes > 0) : "N/A"]; });
add(31, "/factory-command 3D: 1 canvas, nhãn trùng canvas (kit LopNhan ngoài twin)", "A", "a10-factory-command.json", (x) => [`dom ${x.canvasDom} · trùng ${x.nhan.lopTrungCanvas} · nhãn ${x.nhan.so}`, dat(x.canvasDom === 1 && x.nhan.lopTrungCanvas)], "G102: nhãn chồng đống (position 0,0,0) — quan sát");
// ── vai A · 1280 ──
add(32, "/twin 1280: đáy ≤ 720", "A12", "a1-twin.json", (x) => [`đáy ${x.bbox.man?.day}`, dat(x.bbox.man?.day <= 720)]);
add(33, "/twin 1280: dải hợp nhất không chồng nút", "A12", "a1b-dai-hop-nhat.json", (x) => [`chồng ${x.chongLenNut.length}`, dat(x.chongLenNut.length === 0)]);
add(34, "/twin/line/2 1280: dải trạm đáy ≤ 720, 12 ô MỘT dòng (cao ô ≤ 60)", "A12", "a3-line-2.json", (x) => { const cao = Math.max(...x.oTram.map((o) => o.day - o.y)); return [`đáy ${x.bbox.daiLine?.day} · ${x.oTram.length} ô · cao ô ${cao}`, dat(x.bbox.daiLine?.day <= 720 && x.oTram.length === 12 && cao <= 60)]; }, "tệp thô Đợt 32 ghi đáy 720 (spec §14q.9 nói 721); cái sai thật là ô gãy 2 dòng (E3)");
add(35, "/twin/may/14 1280: cockpit.h > khoiCanh.h (bất biến Đợt 31)", "A12", "a4-may-14.json", (x) => [`canh ${x.bbox.khoiCanh?.h} · cockpit ${x.bbox.cockpit?.h} · đáy ${x.bbox.man?.day}`, dat(x.bbox.cockpit?.h > x.bbox.khoiCanh?.h && x.bbox.man?.day <= 720)]);
add(36, "/twin-studio 1280: đáy ≤ 720", "A12", "a5-studio.json", (x) => { const d = Math.max(...Object.values(x.tabs).map((t) => t.bbox?.man?.day ?? 0)); return [`đáy ${d}`, dat(d <= 720)]; });
add(37, "deep-link /twin/may/14 1280: vỏ app", "A12", "a6-deeplink-may-14.json", (x) => [`"${x.vo.tieuDeApp}"`, dat(x.vo.tieuDeApp === "Production (MES)")]);
// ── vai B operator1 (quyền, 0 gán) ──
add(38, "operator1 /twin: màn mở, 0 canvas, không bị chặn cửa (EmptyState 'chưa gán')", "A", "b1-operator1.json", (x) => { const d = x.ds.find((r) => r.duong === "/twin"); return [`màn ${d.coMan} · canvas ${d.canvasDom} · chặn ${d.biChan}`, dat(d.coMan === 1 && d.canvasDom === 0 && d.biChan === 0)]; }, "câu lý do: harness Đợt 32 chỉ ghi 300 ký tự sidebar — đo câu ở E8/D-5");
add(39, "operator1 /twin/line/2: 0 canvas (không sàn trống '— machines'); câu lý do đo ở E8", "A", "b1-operator1.json", (x) => { const d = x.ds.find((r) => r.duong === "/twin/line/2"); return [`canvas ${d.canvasDom} · rỗng ${d.lineRong} · nhãn ${d.nhan?.so ?? "?"}`, dat(d.canvasDom === 0 && d.lineRong === 0)]; }, "cũ: canvas 1 + '— machines' câm (Pareto #7)");
add(40, "operator1 /twin/may/14: lý do ĐÚNG BẢN CHẤT (chuaGanNhaMay, không thieuQuyen)", "A", "b1-operator1.json", (x) => { const d = x.ds.find((r) => r.duong === "/twin/may/14"); return [`lyDo ${d.lyDoMay} · canvas ${d.canvasDom}`, dat(d.lyDoMay === "chuaGanNhaMay" && d.canvasDom === 0)]; });
add(41, "operator1 /twin-studio: bị chặn (0 quyền sửa)", "A", "b1-operator1.json", (x) => { const d = x.ds.find((r) => r.duong === "/twin-studio"); return [`chặn ${d.biChan} · màn ${d.coMan}`, d.biChan > 0 && d.coMan === 0 ? "CHẶN-ĐÚNG" : "SAI"]; });
// ── vai C user tạm 0 quyền ──
for (const [i, u] of [["/twin", 42], ["/twin/line/2", 43], ["/twin/may/14", 44], ["/twin-studio", 45]].map(([a, b]) => [b, a])) add(i, `user 0 quyền ${u}: bị chặn, 0 canvas`, "A", "c1-khong-quyen.json", (x) => { const d = x.ds.find((r) => r.duong === u); return [`chặn ${d.biChan} · màn ${d.coMan} · canvas ${d.canvasDom}`, d.biChan > 0 && d.coMan === 0 && d.canvasDom === 0 ? "CHẶN-ĐÚNG" : "SAI"]; });
// ── andon raised TẠM máy 14 ──
add(46, "raised: /twin/line/2 máy 14 có dấu hiệu (nhãn/lớp cảnh báo) ở khung mặc định", "R", "a3-line-2.json", (x) => { const n14 = x.nhan.ds.filter((d) => /(^|SIM-L2-)AOI( ·|$)/.test(d.text)); /* Đợt 39: P7 rút tiền tố chung `SIM-L2-` ⇒ nhãn là `AOI · …`; bộ dò /SIM-L2-AOI/ của Đợt 37 MÙ (lỗi thời, không phải hồi quy — tệp thô .qa-dot41/raised-1600x900/a3-line-2.json: 12/12 nhãn, có `AOI · Unknown`) */ return [`nhãn 14: ${n14.map((d) => d.text).join("|") || "—"} · chip ${x.nhan.chipNhanAn ?? "—"}`, dat(n14.length > 0)]; }, "chip 'sự cố ngoài khung' đo ở E6 · Đợt 39: regex nhận cả mã ngắn (P7)");
add(47, "raised: /twin/may/14 ngăn có 1 cảnh báo; nút ack ẩn với vai canView", "R", "a4-may-14.json", (x) => [`cảnh báo ${x.ngan.soCanhBao} · nút ack ${x.ngan.nutAck} · lớp 3D ${x.lopCanhBao}`, dat(x.ngan.soCanhBao >= 1 && x.ngan.nutAck === 0)]);
add(48, "raised: /twin bấm máy 14 ⇒ /twin/may/14, ngăn có cảnh báo", "R", "a2-twin-chon-may.json", (x) => [`${x.urlSauClick} · cảnh báo ${x.ngan.soCanhBao}`, dat(x.urlSauClick === "/twin/may/14" && x.ngan.soCanhBao >= 1)]);

const dem = (k) => rows.reduce((a, r) => { a[r[k]] = (a[r[k]] ?? 0) + 1; return a; }, {});
if (process.argv.includes("--md=1")) {
  console.log("| # | Ca | Đợt 32 | | Đợt 37 | | Đợt 39 | | Đợt 41 | | Đợt 44 | | Đợt 46 | | cột TRƯỚC | | Đợt 51 | | Ghi chú |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.id} | ${r.moTa} \`${r.file}\` | ${r.cu} | **${r.pcu}** | ${r.d37} | **${r.pd37}** | ${r.d39} | **${r.pd39}** | ${r.d41} | **${r.pd41}** | ${r.d44} | **${r.pd44}** | ${r.d46} | **${r.pd46}** | ${r.d47} | **${r.pd47}** | ${r.moi} | **${r.pmoi}** | ${r.ghi} |`);
} else for (const r of rows) console.log(`${String(r.id).padStart(2)} ${r.pcu.padEnd(10)} → ${r.pd37.padEnd(10)} → ${r.pd39.padEnd(10)} → ${r.pd41.padEnd(10)} → ${r.pd44.padEnd(10)} → ${r.pd46.padEnd(10)} → ${r.pd47.padEnd(10)} → ${r.pmoi.padEnd(10)} ${r.moTa} | 32: ${r.cu} | 37: ${r.d37} | 39: ${r.d39} | 41: ${r.d41} | 44: ${r.d44} | 46: ${r.d46} | 47: ${r.d47} | 48: ${r.moi}${r.ghi ? " | " + r.ghi : ""}`);
console.log(`\nN=${rows.length} · ĐỢT 32 ${JSON.stringify(dem("pcu"))} · ĐỢT 37 ${JSON.stringify(dem("pd37"))} · ĐỢT 39 ${JSON.stringify(dem("pd39"))} · ĐỢT 41 ${JSON.stringify(dem("pd41"))} · ĐỢT 44 ${JSON.stringify(dem("pd44"))} · ĐỢT 46 ${JSON.stringify(dem("pd46"))} · ${_T} ${JSON.stringify(dem("pd47"))} · ${_M} ${JSON.stringify(dem("pmoi"))}`);
const doi = rows.filter((r) => r.pd47 !== r.pmoi); console.log(`Đổi phán quyết Đợt 47 → Đợt 51: ${doi.length}: ${doi.map((r) => `#${r.id} ${r.pd47}→${r.pmoi}`).join(", ") || "(không)"}`);
