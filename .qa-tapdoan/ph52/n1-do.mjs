/**
 * n1-do.mjs — NHÃN-CỤM, BƯỚC 1: ĐO TRƯỚC, KHÔNG VÁ.
 *
 *   node .qa-tapdoan/n1-do.mjs <nhan>      # nhan mặc định "truoc"
 *
 * Câu hỏi của chủ đợt, đo đúng thứ chúng hỏi, cho CẢ BẢY vai và CẢ HAI chế độ,
 * @1280×720, khung MẶC ĐỊNH, KHÔNG thu panel nào:
 *   ① mỗi vai bao nhiêu cụm?
 *   ② bao nhiêu TÊN CÔNG TY đọc được (không bị lớp phủ DOM che, không bị chính
 *     lớp né ẩn đi)?
 *   ③ nhãn nào bị che bởi CÁI GÌ — nêu đích danh phần tử che.
 *   ④ 3D: `__demSaBan.soNhan()` = {ve, an, tong} và VÌ SAO phần `an` bị ẩn.
 *
 * ★★★ BẪY ĐÃ LÀM HỎNG PHÉP ĐO CỦA HAI AGENT TRƯỚC — chống lại bằng thiết kế:
 *   · KHÔNG bấm gì trước khi đo 3D. Không mở dải hợp nhất, không thu panel.
 *   · Chuyển sang 2D BẮT BUỘC phải bấm `nut-che-2d` (không có URL nào ép được —
 *     `epChe2D` là `useState` nội bộ `TwinVanHanh:2687`). Nên script CHỤP BẢN ĐỒ
 *     LỚP PHỦ trước VÀ sau cú bấm, in cả hai: nếu cú bấm tự bật thêm lớp phủ nào
 *     thì con số 2D là số của một trạng thái KHÁC khung mặc định, và phải nói ra.
 *
 * ★ HAI THƯỚC ĐỘC LẬP cho "đọc được", in cả hai, không gộp:
 *   (a) HÌNH HỌC — giao với bbox THẬT của `[data-che-nhan]` (đúng tập mà
 *       `layVungCam()` của sản phẩm đọc). Đây là thước CHÍNH: nó bắt cả lớp phủ
 *       `pointer-events:none` (bảng `Metrics` là một cái — `BangKpiNoi:151`).
 *   (b) HIT TEST — `elementFromPoint` ở tâm nhãn. Bắt được lớp phủ KHÔNG tự khai
 *       `data-che-nhan` (thứ mà thước (a) mù). Mù với lớp `pointer-events:none`.
 *   Một nhãn "đọc được" phải SẠCH ở CẢ HAI thước.
 *
 * ★ Quan hệ cụm × toà đo bằng DẢI MÃ của `sinh-summary.json` (factoryId), KHÔNG
 *   đo bằng khe hở trên màn.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "truoc";
const GOC = "http://localhost:3077";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/n1-${NHAN}.json`;
const ANH = `.qa-tapdoan/anh/n1-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const VAI = [
  "qatd_giamdoc",
  "qatd_quanly",
  "qatd_kythuat",
  "qatd_congnhan",
  "qatd_admin",
  "qatd_khonggan",
  "qatd_khongquyen",
];

const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));
const TEN_NHA_MAY = new Map(TT.congTys.map((c) => [c.id, `${c.code}/${c.ten}`]));
const TOA_THEO_NM = new Map();
for (const t of TT.toas) TOA_THEO_NM.set(t.factoryId, (TOA_THEO_NM.get(t.factoryId) ?? 0) + 1);
console.log(
  "nguồn độc lập (sinh-summary): " +
    [...TEN_NHA_MAY].map(([id, m]) => `${m}=id${id}(${TOA_THEO_NM.get(id) ?? 0} toà)`).join(" · "),
);

/** Trong trang: bản đồ lớp phủ tự khai + hàm đo che. Chuỗi hoá rồi dựng lại trong `evaluate`. */
const DO_TRONG_TRANG = () => {
  const ten = (e) => {
    if (!e) return null;
    const tid = e.getAttribute && e.getAttribute("data-testid");
    return `${e.tagName}${tid ? "#" + tid : ""}`;
  };
  const hop = (e) => {
    const r = e.getBoundingClientRect();
    return {
      x: Math.round(r.x * 10) / 10,
      y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
    };
  };
  const lopPhu = [...document.querySelectorAll("[data-che-nhan]")]
    .map((e) => ({
      ten: ten(e),
      ...hop(e),
      pe: getComputedStyle(e).pointerEvents,
      z: getComputedStyle(e).zIndex,
    }))
    .filter((o) => o.w > 0 && o.h > 0);
  /** Phần diện tích nhãn bị các lớp phủ chiếm (xấp xỉ: tổng giao, không trừ chồng). */
  const tyLeChe = (r) => {
    if (!(r.w > 0) || !(r.h > 0)) return 0;
    let s = 0;
    for (const p of lopPhu) {
      const gx = Math.max(0, Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x));
      const gy = Math.max(0, Math.min(r.y + r.h, p.y + p.h) - Math.max(r.y, p.y));
      s += gx * gy;
    }
    return Math.round((s / (r.w * r.h)) * 1000) / 10;
  };
  /** Lớp phủ CHỨA TÂM nhãn — đúng luật ẩn của `LopSaBan` (ẩn theo TÂM, không theo "giao chút nào"). */
  const cheTam = (r) => {
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    return lopPhu
      .filter((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h)
      .map((p) => p.ten);
  };
  return { ten, hop, lopPhu, tyLeChe, cheTam };
};

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});

const ketQua = {
  nhan: NHAN,
  luc: new Date().toISOString(),
  khung: "1280x720 mặc định, không thu panel",
  vai: {},
};

for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const loi = [];
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));
  const dn = await page.request.post(`${GOC}/api/auth/login`, {
    data: { username: vai, password: MK },
  });
  if (!dn.ok()) {
    ketQua.vai[vai] = { LOI_DANG_NHAP: dn.status() };
    console.log(`\n══ ${vai} ══ ĐĂNG NHẬP HỎNG ${dn.status()}`);
    await ctx.close();
    continue;
  }

  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  // Ổn định: hai lượt đọc liên tiếp CÙNG khoá (không dùng cửa sổ thời gian cố định).
  await page
    .waitForFunction(
      () => {
        const ds = (window.__demSaBan && window.__demSaBan.bieuTuong()) || [];
        const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;
        const khoa = `${n}|` + ds.map((b) => `${b.toaNhaId}:${Math.round(b.rongPx)}`).join(",");
        const on = window.__n1_khoa === khoa && khoa.length > 2;
        window.__n1_khoa = khoa;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1000 },
    )
    .catch(() => {});

  // ══ 3D — KHÔNG BẤM GÌ ══
  await page.screenshot({ path: `${ANH}/${vai}-3d-toan-man.png` });
  const oCanvas = await page.$("canvas");
  if (oCanvas) await oCanvas.screenshot({ path: `${ANH}/${vai}-3d-canvas.png` }).catch(() => {});

  const d3 = await page.evaluate((src) => {
    const { ten, hop, lopPhu, tyLeChe, cheTam } = new Function(`return (${src})()`)();
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const c = document.querySelector("canvas");
    const bt = (window.__demSaBan && window.__demSaBan.bieuTuong()) || [];
    const nhan = (sel, loai) =>
      [...document.querySelectorAll(`[data-testid='${sel}']`)].map((e) => {
        const cs = getComputedStyle(e);
        const r = hop(e);
        const an = cs.display === "none";
        const tam = an ? null : document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
        return {
          loai,
          chu: e.textContent.trim(),
          factoryId: Number(e.getAttribute("data-factory-id")) || null,
          toaNhaId: Number(e.getAttribute("data-toa-nha-id")) || null,
          an,
          hop: an ? null : r,
          transform: e.style.transform || null,
          cheTam: an ? null : cheTam(r),
          tyLeChe: an ? null : tyLeChe(r),
          hitTest: tam ? ten(tam) : null,
          hitLaNhan: tam ? tam === e || e.contains(tam) : null,
        };
      });
    return {
      hopCanvas: c ? hop(c) : null,
      soNhan: (window.__demSaBan && window.__demSaBan.soNhan()) || null,
      soBieuTuong: bt.length,
      rongPxBieuTuong: bt.map((b) => Math.round(b.rongPx * 10) / 10),
      cumTheoFactory: [...new Set(bt.map((b) => b.factoryId))].sort((a, b) => a - b),
      toaTheoFactory: bt.reduce((m, b) => ((m[b.factoryId] = (m[b.factoryId] ?? 0) + 1), m), {}),
      hopBieuTuong: bt.map((b) => ({
        toaNhaId: b.toaNhaId,
        factoryId: b.factoryId,
        hop: {
          trai: Math.round(b.hop.trai * 10) / 10,
          phai: Math.round(b.hop.phai * 10) / 10,
          tren: Math.round(b.hop.tren * 10) / 10,
          duoi: Math.round(b.hop.duoi * 10) / 10,
        },
      })),
      nhanCum: nhan("nhan-cum-sa-ban", "cum"),
      nhanToa: nhan("nhan-toa-sa-ban", "toa"),
      lopPhu,
      thongKe: window.__thongKeVe || null,
      demMay: (q("dem-may") && q("dem-may").textContent.trim()) || null,
      panelTraiThu: (q("panel-trai") && q("panel-trai").getAttribute("data-thu")) || null,
      panelPhaiThu: (q("panel-phai") && q("panel-phai").getAttribute("data-thu")) || null,
      banner: [...document.querySelectorAll("[data-testid^='banner-']")].map((e) =>
        e.getAttribute("data-testid"),
      ),
      coNutChe2D: !!q("nut-che-2d"),
      nutChe2DTat: q("nut-che-2d") ? q("nut-che-2d").hasAttribute("disabled") : null,
      chuaGan:
        document.body.innerText.includes("not assigned") ||
        document.body.innerText.includes("chưa được gán"),
    };
  }, DO_TRONG_TRANG.toString());

  // ══ 2D — bấm ĐÚNG MỘT nút chuyển chế độ; chụp bản đồ lớp phủ TRƯỚC và SAU ══
  const phuTruoc = d3.lopPhu.map((p) => p.ten).sort();
  let d2 = { BO_QUA: "không có nút chế độ 2D" };
  if (d3.coNutChe2D) {
    await page.getByTestId("nut-che-2d").click({ timeout: 15_000 }).catch(() => {});
    await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 45_000 }).catch(() => {});
    await page
      .waitForFunction(
        () => {
          const n = document.querySelectorAll(
            "[data-testid='nhan-cum-sa-ban-2d'],[data-testid^='may-2d-']",
          ).length;
          const on = window.__n1_2d === n;
          window.__n1_2d = n;
          return on;
        },
        undefined,
        { timeout: 45_000, polling: 800 },
      )
      .catch(() => {});
    await page.screenshot({ path: `${ANH}/${vai}-2d-toan-man.png` });
    const oSvg = await page.$("[data-testid='canh-van-hanh-2d']");
    if (oSvg) await oSvg.screenshot({ path: `${ANH}/${vai}-2d-svg.png` }).catch(() => {});

    d2 = await page.evaluate((src) => {
      const { ten, hop, lopPhu, tyLeChe, cheTam } = new Function(`return (${src})()`)();
      const q = (id) => document.querySelector(`[data-testid='${id}']`);
      const svg = q("canh-van-hanh-2d");
      /*
       * ⚠ Từ bản vá NHÃN-CỤM, bản 2D ẨN nhãn không còn chỗ đọc được (`visibility:
       *   hidden` + `data-an="1"`) và ĐẾM RA trên `lop-sa-ban-2d`. Thiết bị đo phải
       *   thấy cơ chế ấy: một nhãn ẩn vẫn CÓ bao hình, nên nếu chỉ hỏi "có bị lớp
       *   phủ che không" thì nó sẽ được chấm là ĐỌC ĐƯỢC — một xanh giả.
       *   Bản TRƯỚC không có thuộc tính này nên con số của nó KHÔNG đổi (đã đo lại
       *   bằng chính tệp này trên `dist-e2e-b2` để chắc).
       */
      const nhan = (sel, loai) =>
        [...document.querySelectorAll(`[data-testid='${sel}']`)].map((e) => {
          const r = hop(e);
          const an = getComputedStyle(e).visibility === "hidden" || e.getAttribute("data-an") === "1";
          const tam = !an && r.w > 0 ? document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2) : null;
          return {
            loai,
            chu: e.textContent.trim(),
            factoryId: Number(e.getAttribute("data-factory-id")) || null,
            toaNhaId: Number(e.getAttribute("data-toa-nha-id")) || null,
            an,
            hop: r,
            cheTam: an ? null : cheTam(r),
            tyLeChe: an ? null : tyLeChe(r),
            hitTest: tam ? ten(tam) : null,
            hitTrongSvg: tam && svg ? svg.contains(tam) : null,
          };
        });
      const toa = [...document.querySelectorAll("[data-testid='toa-2d-sa-ban']")].map((e) => {
        const r = hop(e);
        return {
          toaNhaId: Number(e.getAttribute("data-toa-nha-id")),
          factoryId: Number(e.getAttribute("data-factory-id")),
          w: r.w,
          h: r.h,
        };
      });
      const lop = q("lop-sa-ban-2d");
      return {
        coSvg: !!svg,
        donViVe: svg ? svg.getAttribute("data-don-vi-ve") : null,
        demNhan: lop
          ? {
              ve: Number(lop.getAttribute("data-nhan-ve")),
              an: Number(lop.getAttribute("data-nhan-an")),
              tong: Number(lop.getAttribute("data-nhan-tong")),
            }
          : null,
        viewBox: svg ? svg.getAttribute("viewBox") : null,
        hopSvg: svg ? hop(svg) : null,
        soToa2D: toa.length,
        rongToa2D: toa.map((t) => t.w).sort((a, b) => a - b),
        toaTheoFactory: toa.reduce((m, t) => ((m[t.factoryId] = (m[t.factoryId] ?? 0) + 1), m), {}),
        soMay2D: document.querySelectorAll("[data-testid^='may-2d-']").length,
        nhanCum: nhan("nhan-cum-sa-ban-2d", "cum"),
        nhanToa: nhan("nhan-toa-sa-ban-2d", "toa"),
        lopPhu,
        soCanvas: document.querySelectorAll("canvas").length,
        demMay: (q("dem-may") && q("dem-may").textContent.trim()) || null,
        panelTraiThu: (q("panel-trai") && q("panel-trai").getAttribute("data-thu")) || null,
        panelPhaiThu: (q("panel-phai") && q("panel-phai").getAttribute("data-thu")) || null,
      };
    }, DO_TRONG_TRANG.toString());
  }
  const phuSau = (d2.lopPhu || []).map((p) => p.ten).sort();

  /*
   * ⚠⚠ HAI THƯỚC, IN CẢ HAI — không đổi thước sau khi thấy đỏ, mà THÊM thước và
   *   nói rõ thước nào kết luận.
   *   (a) SẠCH TÂM  — đúng luật ẩn của sản phẩm (`LopSaBan`: "ẩn theo TÂM"). Đây
   *       là thước đã dùng ở lượt đo TRƯỚC; giữ nguyên để hai lượt so được.
   *   (b) SẠCH TRỌN — hộp chữ không bị lớp phủ ăn một pixel nào.
   *   Vì sao phải có (b): ảnh `anh/n1-sau/qatd_quanly-2d-toan-man.png` của vòng vá
   *   ĐẦU đọc ra "ng ty A" — tâm sạch, nhưng thẻ `Metrics` ăn mất 24,3 % bên trái,
   *   đúng hai chữ đầu. Thước (a) chấm ĐẠT, con mắt chấm KHÔNG. Tiêu chí nghiệp vụ
   *   là ĐỌC ĐƯỢC TÊN ⇒ (b) là thước kết luận, (a) in kèm để thấy chỗ lệch.
   */
  const docDuoc2D = (ds) =>
    ds.filter((n) => !n.an && (n.cheTam ? n.cheTam.length : 0) === 0 && n.hitTrongSvg !== false).length;
  const docDuoc3D = (ds) => ds.filter((n) => !n.an && (n.cheTam ? n.cheTam.length : 0) === 0).length;
  const tronVen = (ds) => ds.filter((n) => !n.an && n.tyLeChe === 0).length;

  const o = {
    ba3D: d3,
    ba2D: d2,
    lopPhuTruocBam: phuTruoc,
    lopPhuSauBam: phuSau,
    bamCoTuBatLopPhu: JSON.stringify(phuTruoc) !== JSON.stringify(phuSau),
    tomTat: {
      soCum3D: d3.nhanCum ? d3.nhanCum.length : 0,
      tenCongTyDocDuoc3D: docDuoc3D(d3.nhanCum || []),
      tenTronVen3D: tronVen(d3.nhanCum || []),
      soNhan3D: d3.soNhan,
      soCum2D: d2.nhanCum ? d2.nhanCum.length : 0,
      tenCongTyDocDuoc2D: docDuoc2D(d2.nhanCum || []),
      tenTronVen2D: tronVen(d2.nhanCum || []),
    },
    loi,
  };
  ketQua.vai[vai] = o;

  console.log(`\n══════ ${vai} ══════`);
  console.log(
    `3D: cụm=${o.tomTat.soCum3D} biểuTượng=${d3.soBieuTuong} toà/nhàMáy=${JSON.stringify(d3.toaTheoFactory)}` +
      ` soNhan=${JSON.stringify(d3.soNhan)} calls=${d3.thongKe && d3.thongKe.calls} tri=${d3.thongKe && d3.thongKe.triangles}` +
      ` demMay="${d3.demMay}" panelThu=${d3.panelTraiThu}/${d3.panelPhaiThu} chuaGan=${d3.chuaGan}`,
  );
  for (const n of d3.nhanCum || [])
    console.log(
      `   3D cụm "${n.chu}" ẩn=${n.an} hộp=${JSON.stringify(n.hop)} cheTâm=${JSON.stringify(n.cheTam)}` +
        ` %che=${n.tyLeChe} hit=${n.hitTest}`,
    );
  const an3 = (d3.nhanToa || []).filter((n) => n.an);
  console.log(
    `   3D toà: ${d3.nhanToa ? d3.nhanToa.length : 0} nhãn, ẩn ${an3.length} → ${an3.map((n) => n.chu).join(",") || "—"}`,
  );
  for (const n of (d3.nhanToa || []).filter((n) => !n.an && (n.cheTam ? n.cheTam.length : 0) > 0))
    console.log(`   3D toà "${n.chu}" HIỆN mà bị che tâm bởi ${JSON.stringify(n.cheTam)}`);

  if (d2.coSvg) {
    console.log(
      `2D: đơnVịVẽ=${d2.donViVe} demNhan=${JSON.stringify(d2.demNhan)} toà2D=${d2.soToa2D} rộng=${d2.rongToa2D[0]}..${d2.rongToa2D[d2.rongToa2D.length - 1]}` +
        ` máy2D=${d2.soMay2D} cụm=${o.tomTat.soCum2D} canvas=${d2.soCanvas} panelThu=${d2.panelTraiThu}/${d2.panelPhaiThu}`,
    );
    for (const n of d2.nhanCum || [])
      console.log(
        `   2D cụm "${n.chu}" ẩn=${n.an} hộp=${JSON.stringify(n.hop)} cheTâm=${JSON.stringify(n.cheTam)}` +
          ` %che=${n.tyLeChe} hit=${n.hitTest} hitTrongSvg=${n.hitTrongSvg}`,
      );
    const che2 = (d2.nhanToa || []).filter(
      (n) => n.an || (n.cheTam ? n.cheTam.length : 0) > 0 || n.hitTrongSvg === false,
    );
    console.log(
      `   2D toà: ${d2.nhanToa ? d2.nhanToa.length : 0} nhãn, bị che tâm ${che2.length} → ${che2.map((n) => n.chu).join(",") || "—"}`,
    );
  } else {
    console.log(`2D: ${JSON.stringify(d2).slice(0, 200)}`);
  }
  console.log(
    `lớp phủ trước bấm = sau bấm? ${!o.bamCoTuBatLopPhu ? "GIỐNG ✓" : "KHÁC ✗ " + JSON.stringify({ phuTruoc, phuSau })}`,
  );
  console.log(
    `⇒ TÊN CÔNG TY — sạchTÂM: 3D ${o.tomTat.tenCongTyDocDuoc3D}/${o.tomTat.soCum3D} · 2D ${o.tomTat.tenCongTyDocDuoc2D}/${o.tomTat.soCum2D}` +
      `  ‖  SẠCH TRỌN (thước kết luận): 3D ${o.tomTat.tenTronVen3D}/${o.tomTat.soCum3D} · 2D ${o.tomTat.tenTronVen2D}/${o.tomTat.soCum2D}`,
  );
  if (loi.length) console.log(`   lỗi trang: ${JSON.stringify(loi)}`);
  await ctx.close();
}

await trinh.close();
fs.writeFileSync(RA, JSON.stringify(ketQua, null, 1));
console.log(`\n→ ${RA}  ·  ảnh: ${ANH}`);
