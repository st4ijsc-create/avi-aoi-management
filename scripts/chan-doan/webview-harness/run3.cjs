const { chromium } = require("D:/SOURCES/_ai9_qa/node_modules/playwright");
const fs = require("fs");
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 440, height: 900 } });
  await p.goto("http://127.0.0.1:3017/");
  const cay = JSON.parse(fs.readFileSync(S + "/mau.cay.json", "utf8"));
  const g = (m) => p.evaluate((m) => window.__gui(m), m);
  await g({ loai: "ag_bat_dau", runId: "r1", cheDo: "sua" });
  await g({ loai: "ag_thong_bao", thongDiep: "Đang xếp hàng chờ model (2 lượt phía trước)…" });
  await g({ loai: "ag_nghi", chu: "Cần đọc otManager.ts trước, rồi vongPoll.ts…" });
  for (const [i, t] of [["t1", "Đọc server/services/ot/otManager.ts"], ["t2", "Đọc server/services/ot/vongPoll.ts"], ["t3", "Tìm \"dangChay\" trong server/"]]) {
    await g({ loai: "ag_goi_tool", id: i, ten: "doc_tep", moTa: t });
    await g({ loai: "ag_ket_qua_tool", id: i, ok: true, tomTat: "Đọc 412 dòng (14.2 KB)" });
  }
  await g({ loai: "ag_ke_hoach", viec: [{ noiDung: "Đọc mã liên quan", trangThai: "xong" }, { noiDung: "Sửa vongPoll.ts", trangThai: "dang-lam" }, { noiDung: "Chạy test", trangThai: "cho" }] });
  await g({ loai: "ag_md", cay, chiSoMaDau: 0 });
  for (const [i, f] of [["d1", "server/services/ot/vongPoll.ts"], ["d2", "server/services/ot/otManager.ts"], ["d3", "server/services/ot/reconnectNhanh.ts"], ["d4", "server/services/ot/chatLuong.ts"]]) {
    await g({ loai: "ag_the_duyet", id: i, loaiDuyet: "tep", tomTat: f + " (+12 / −3)", coDiff: true });
  }
  await g({ loai: "ag_the_duyet", id: "l1", loaiDuyet: "lenh", tomTat: "Chạy lệnh trong workspace", lenh: "npx vitest run server/services/ot", coDiff: false });
  await g({ loai: "ag_loi", thongDiep: "Không kết nối được máy chủ AI Local (http://localhost:3000): ECONNREFUSED", ma: "KET_NOI" });
  await g({ loai: "ag_usage", vao: 21400, ra: 640, ctxPhanTram: 33, uocLuong: false });
  await p.waitForTimeout(150);
  await p.screenshot({ path: S + "/b1-agent-nhieu-tep.png", fullPage: true });
  const st = await p.evaluate(() => ({ nutDungHien: !document.querySelector("#nut-dung").hidden, soThe: document.querySelectorAll(".ag-the").length, thoiDiemCuon: document.querySelector("#hoi-thoai") ? document.querySelector("#hoi-thoai").scrollTop : null }));
  // Hội thoại dài: cuộn lên đọc rồi stream thêm → có giật về đáy?
  await p.evaluate(() => { for (let i = 0; i < 60; i++) window.__gui({ loai: "ag_chu", chu: "Đoạn văn dài số " + i + " ".repeat(1) + "lorem ipsum dolor sit amet consectetur. " }); });
  await p.evaluate(() => { const h = document.querySelector("#hoi-thoai") || document.scrollingElement; h.scrollTop = 0; });
  const truoc = await p.evaluate(() => (document.querySelector("#hoi-thoai") || document.scrollingElement).scrollTop);
  await p.evaluate(() => window.__gui({ loai: "ag_chu", chu: "thêm chữ khi người dùng đang cuộn lên đọc " }));
  const sau = await p.evaluate(() => { const h = document.querySelector("#hoi-thoai") || document.scrollingElement; return { top: h.scrollTop, max: h.scrollHeight - h.clientHeight }; });
  console.log(JSON.stringify({ st, cuon: { truocKhiStream: truoc, sauKhiStream: sau } }, null, 1));
  await b.close();
})();
