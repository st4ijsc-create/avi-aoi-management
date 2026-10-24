const { chromium } = require("D:/SOURCES/_ai9_qa/node_modules/playwright");
const fs = require("fs");
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 440, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console.error: " + m.text()); });
  await p.goto("http://127.0.0.1:3017/");
  const md = fs.readFileSync(S + "/mau.md", "utf8");
  const cay = JSON.parse(fs.readFileSync(S + "/mau.cay.json", "utf8"));
  await p.evaluate(() => { window.__gui({ loai: "trang_thai_dang_nhap", daDangNhap: true }); });
  await p.evaluate(() => window.__gui({ loai: "ag_bat_dau", runId: "r1", cheDo: "sua" }));
  // stream thô từng mảnh
  const chunks = md.match(/[\s\S]{1,40}/g);
  for (const c of chunks) await p.evaluate((c) => window.__gui({ loai: "ag_chu", chu: c }), c);
  await p.waitForTimeout(200);
  await p.screenshot({ path: S + "/a1-streaming-tho.png", fullPage: true });
  const h1 = await p.evaluate(() => { const d = document.querySelector(".ag-doan"); return d ? { cls: d.className, ws: getComputedStyle(d).whiteSpace, text: d.textContent.slice(0, 80) } : null; });
  // kết thúc đoạn -> markdown dựng
  await p.evaluate((a) => window.__gui({ loai: "ag_md", cay: a.cay, chiSoMaDau: 0 }), { cay });
  await p.waitForTimeout(200);
  await p.screenshot({ path: S + "/a2-sau-ag_md.png", fullPage: true });
  const info = await p.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const m = document.querySelector(".ag-md");
    return { h2: q(".ag-md h2,.ag-md h3"), li: q(".ag-md li"), table: q(".ag-md table"), pre: q(".ag-md pre"), bq: q(".ag-md blockquote"), code: q(".ag-md code"), nutChep: [...document.querySelectorAll("button")].filter((b) => /Chép/.test(b.textContent)).length, htmlLen: m ? m.innerHTML.length : 0 };
  });
  console.log(JSON.stringify({ h1, info, errs }, null, 1));
  await b.close();
})();
