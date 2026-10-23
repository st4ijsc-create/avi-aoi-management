const { chromium } = require("D:/SOURCES/_ai9_qa/node_modules/playwright");
const fs = require("fs");
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 440, height: 900 } });
  await p.goto("http://127.0.0.1:3017/");
  const cay = JSON.parse(fs.readFileSync(S + "/mau.cay.json", "utf8"));
  await p.evaluate(() => window.__gui({ loai: "ag_bat_dau", runId: "r1", cheDo: "sua" }));
  await p.evaluate((a) => window.__gui({ loai: "ag_md", cay: a, chiSoMaDau: 0 }), cay);
  const css = await p.evaluate(() => {
    const cs = (s, props) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return Object.fromEntries(props.map((k) => [k, c[k]])); };
    const hs = [...document.querySelectorAll(".ag-md > *")].map((e) => e.tagName + "." + e.className + ":" + getComputedStyle(e).fontSize + "/" + getComputedStyle(e).fontWeight).slice(0, 14);
    return { hs, pre: cs(".ag-md pre", ["overflowX", "whiteSpace", "maxWidth"]), bq: cs(".ag-md blockquote", ["borderLeft", "paddingLeft", "background"]), table: cs(".ag-md table", ["borderCollapse"]) };
  });
  // paste ảnh vào ô nhập
  const r = await p.evaluate(async () => {
    const o = document.querySelector("#o-nhap");
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const file = new File([png], "anh.png", { type: "image/png" });
    const dt = new DataTransfer(); dt.items.add(file);
    const antes = window.__tin.length;
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    o.dispatchEvent(ev);
    const pasteHuy = ev.defaultPrevented;
    // thả tệp vào vùng nhập + toàn trang
    const dt2 = new DataTransfer(); dt2.items.add(new File(["hello"], "ngoai.txt", { type: "text/plain" }));
    const dev = new DragEvent("drop", { dataTransfer: dt2, bubbles: true, cancelable: true });
    o.dispatchEvent(dev);
    const dropHuy = dev.defaultPrevented;
    const dov = new DragEvent("dragover", { dataTransfer: dt2, bubbles: true, cancelable: true });
    o.dispatchEvent(dov);
    return { pasteDefaultPrevented: pasteHuy, dropDefaultPrevented: dropHuy, dragoverPrevented: dov.defaultPrevented, tinMoi: window.__tin.slice(antes), oNhap: o.value, dinhKem: (document.querySelector("#dinh-kem") || document.body).innerText.slice(-60), hasHandlers: { paste: /paste/.test(document.documentElement.innerHTML), drop: /addEventListener\("drop"|ondrop/.test(document.documentElement.innerHTML) } };
  });
  console.log(JSON.stringify({ css, r }, null, 1));
  await b.close();
})();
