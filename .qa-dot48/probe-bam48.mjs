// ĐỢT 47 · A — PROBE BẤM MÁY TRÊN CẢNH, đọc CƠ CHẾ từ store R3F THẬT (không cần vá mã, chạy được trên dist mọi commit).
//   Móc __REACT_DEVTOOLS_GLOBAL_HOOK__ trước khi trang tải ⇒ React prod vẫn gọi onCommitFiberRoot ⇒ lấy FiberRoot của
//   reconciler R3F (containerInfo = Instance của scene, .root = store zustand). Từ store: internal.interaction (object có handler),
//   events.connected (phần tử DOM nhận sự kiện), camera, raycaster, size. Với BatchedMesh máy: chiếu TÂM từng instance ra pixel,
//   raycast trong trang tại pixel đó (hit batchId?), elementFromPoint (DOM nào nhận chuột?), rồi page.mouse.move/click THẬT ⇒
//   màu instance đổi (hover lerp)? cursor? URL đổi ≤ 1500 ms?
//   node .qa-dot48/probe-bam47.mjs --tag=HEAD [--base=http://localhost:3048] [--man=/twin,/twin/line/2] [--vp=1600x900] [--soMay=6]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3048"); const TAG = arg("tag", "HEAD"); const LANG = arg("lang", "vi");
const MAN = arg("man", "/twin,/twin/line/2").split(","); const VPS = arg("vp", "1600x900").split(","); const SO_MAY = Number(arg("soMay", "6"));
const OUT = ".qa-dot48/probe"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) { const f = `.qa-dot48/state-${TK.username}.json`; const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); } const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }

// Móc devtools tối thiểu — React prod gọi inject/onCommitFiberRoot khi hook tồn tại TRƯỚC khi React nạp.
const HOOK = () => {
  const roots = new Set();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false, _n: 0,
    inject(r) { this._n += 1; this.renderers.set(this._n, r); return this._n; },
    onCommitFiberRoot(_id, root) { roots.add(root); },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {}, setStrictMode() {},
  };
  window.__fiberRoots = roots;
};
// Chạy TRONG trang: tìm store R3F + đo cơ chế.
const DO_CO_CHE = ({ selCanvas, soMay }) => {
  const roots = [...(window.__fiberRoots ?? [])];
  let store = null;
  // R3F 9.5: `reconciler.createContainer(store, …)` — containerInfo CHÍNH LÀ store zustand (hàm có getState).
  for (const r of roots) { const ci = r.containerInfo; if (ci && typeof ci.getState === "function") { store = ci; break; } if (ci && ci.root && typeof ci.root.getState === "function") { store = ci.root; break; } }
  if (!store) return { loi: "khong tim thay store R3F", soRoot: roots.length, kieuContainer: roots.map((r) => (r.containerInfo && r.containerInfo.constructor ? r.containerInfo.constructor.name : typeof r.containerInfo)) };
  const st = store.getState();
  const canvasEl = document.querySelector(selCanvas) ?? st.gl.domElement;
  const cv = canvasEl.getBoundingClientRect();
  const inter = st.internal.interaction;
  const moTa = inter.map((o) => ({ name: o.name, type: o.type, eventCount: o.__r3f?.eventCount, handlers: Object.keys(o.__r3f?.handlers ?? {}), raycastNull: o.raycast === null, visible: o.visible, parentType: o.parent?.type ?? null, trongScene: (() => { let p = o; while (p.parent) p = p.parent; return p === st.scene; })() }));
  const connected = st.events.connected; const conMoTa = connected ? { tag: connected.tagName, cls: String(connected.className).slice(0, 60), rect: (() => { const b = connected.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })(), laCha1Canvas: connected === canvasEl.parentElement, laCha2Canvas: connected === canvasEl.parentElement?.parentElement, laCanvas: connected === canvasEl } : null;
  // BatchedMesh máy
  const lo = inter.find((o) => o.isBatchedMesh || o.type === "BatchedMesh" || o.name === "twin3d-lo-may") ?? st.scene.getObjectByName("twin3d-lo-may");
  const may = [];
  if (lo) {
    const M = lo.matrixWorld.clone(); const mt = lo.matrix.constructor; const m4 = new mt(); const v = lo.position.clone();
    const n = lo._instanceInfo ? lo._instanceInfo.length : (lo._drawInfo ? lo._drawInfo.length : lo.instanceCount ?? lo.maxInstanceCount);
    for (let i = 0; i < n && may.length < soMay * 4; i++) {
      const info = lo._instanceInfo ? lo._instanceInfo[i] : (lo._drawInfo ? lo._drawInfo[i] : null);
      if (info && (!info.active || !info.visible)) continue;
      lo.getMatrixAt(i, m4); m4.premultiply(M);
      // tâm hộp hình học của instance: bbox local
      const gid = info ? info.geometryIndex : 0; const box = lo.getBoundingBoxAt(gid, new (lo.boundingBox?.constructor ?? Object)()) ;
      const c = box && box.min ? box.min.clone().add(box.max).multiplyScalar(0.5) : v.set(0, 0, 0);
      c.applyMatrix4(m4);
      const p = c.clone().project(st.camera);
      const px = ((p.x + 1) / 2) * st.size.width, py = ((1 - p.y) / 2) * st.size.height;
      const trong = p.z < 1 && px >= 0 && py >= 0 && px <= st.size.width && py <= st.size.height;
      if (!trong) continue;
      // raycast trong trang tại pixel này
      st.raycaster.setFromCamera({ x: p.x, y: p.y }, st.camera);
      const hits = st.raycaster.intersectObject(lo, true);
      const hit0 = hits[0];
      const el = document.elementFromPoint(cv.x + px, cv.y + py);
      may.push({ i, px: Math.round(px), py: Math.round(py), ndc: [+p.x.toFixed(4), +p.y.toFixed(4)], hitBatchId: hit0 ? (hit0.batchId ?? hit0.instanceId ?? null) : null, soHit: hits.length, domTai: el ? `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}${el === canvasEl ? "=CANVAS" : ""}` : null });
    }
  }
  return { soRoot: roots.length, soInteraction: inter.length, interaction: moTa, connected: conMoTa, size: { w: st.size.width, h: st.size.height }, canvas: { x: cv.x, y: cv.y, w: cv.width, h: cv.height }, eventsEnabled: st.events.enabled, frameloop: st.frameloop, coLo: !!lo, loTrongInteraction: lo ? inter.includes(lo) : null, soInstance: lo ? (lo._instanceInfo ? lo._instanceInfo.length : null) : null, may: may.slice(0, soMay * 3) };
};
const MAU_INSTANCE = ({ i }) => {
  const roots = [...(window.__fiberRoots ?? [])]; let store = null;
  for (const r of roots) { const ci = r.containerInfo; if (ci && typeof ci.getState === "function") { store = ci; break; } if (ci && ci.root && typeof ci.root.getState === "function") { store = ci.root; break; } }
  if (!store) return null;
  const st = store.getState(); const lo = st.scene.getObjectByName("twin3d-lo-may"); if (!lo) return null;
  const c = new (st.scene.background?.constructor ?? Object)(); try { lo.getColorAt(i, c); return [+c.r.toFixed(4), +c.g.toFixed(4), +c.b.toFixed(4)]; } catch (e) { return String(e); }
};
const browser = await chromium.launch();
const kq = { tag: TAG, base: BASE, luc: new Date().toISOString(), man: {} };
try {
  for (const vp of VPS) {
    const [VW, VH] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
    await ctx.addInitScript(HOOK);
    await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); localStorage.removeItem("twin3d.nhan.macDinh"); } catch {} }, LANG);
    await dangNhap(ctx);
    for (const duong of MAN) {
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(`${BASE}${duong}`, { waitUntil: "domcontentloaded" });
      const selMan = duong.startsWith("/twin/line") ? '[data-testid="man-twin-line"]' : '[data-testid="man-twin-van-hanh"]';
      await page.waitForSelector(`${selMan} canvas`, { timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(6000);
      const selCanvas = `${selMan} canvas`;
      const coChe = await page.evaluate(DO_CO_CHE, { selCanvas, soMay: SO_MAY });
      const r = { vp, duong, msToiCanvas: Date.now() - t0, urlDau: page.url().replace(BASE, ""), coChe, thu: [] };
      console.log(`   [${TAG} ${vp} ${duong}] interaction=${coChe.soInteraction} ${JSON.stringify(coChe.interaction?.map((o) => `${o.name || o.type}:${o.handlers?.join("/")}${o.raycastNull ? ":raycast=null" : ""}`))} · connected=${coChe.connected ? `${coChe.connected.tag}${coChe.connected.laCha2Canvas ? "(cha2 canvas)" : coChe.connected.laCha1Canvas ? "(cha1 canvas)" : coChe.connected.laCanvas ? "(canvas)" : "(?)"} ${coChe.connected.rect.w}x${coChe.connected.rect.h}` : "null"} · lo=${coChe.coLo} trongInter=${coChe.loTrongInteraction} · instance=${coChe.soInstance} · ứng viên ${coChe.may?.length ?? 0}${coChe.loi ? " · LOI " + coChe.loi + " " + JSON.stringify(coChe.kieuContainer) : ""}`);
      const cv = coChe.canvas ?? { x: 0, y: 0, w: 0, h: 0 };
      // Bấm THẬT vào tâm từng máy (tối đa SO_MAY máy có raycast hit trong trang; nếu không máy nào hit thì thử cả máy không hit).
      const ungVien = (coChe.may ?? []).filter((m) => m.hitBatchId !== null).slice(0, SO_MAY).concat((coChe.may ?? []).filter((m) => m.hitBatchId === null).slice(0, 2));
      for (const m of ungVien) {
        if (r.thu.some((t) => t.urlSau && t.urlSau !== r.urlDau)) break;   // đã trúng ⇒ đủ
        const X = cv.x + m.px, Y = cv.y + m.py;
        const mauTruoc = await page.evaluate(MAU_INSTANCE, { i: m.i });
        await page.mouse.move(X - 30, Y - 30); await page.waitForTimeout(120);
        await page.mouse.move(X, Y, { steps: 4 }); await page.waitForTimeout(300);
        const cursor = await page.evaluate((s) => { const c = document.querySelector(s); return c ? (c.style.cursor || getComputedStyle(c).cursor) : null; }, selCanvas);
        const mauHover = await page.evaluate(MAU_INSTANCE, { i: m.i });
        const nhanHover = await page.locator('[data-testid="nhan-may-twin3d"]').count();
        const urlTruoc = page.url();
        await page.mouse.click(X, Y);
        const tBam = Date.now(); let urlSau = urlTruoc;
        try { await page.waitForURL((u) => u.toString() !== urlTruoc, { timeout: 1500 }); } catch {}
        urlSau = page.url(); const msDoi = urlSau !== urlTruoc ? Date.now() - tBam : null;
        const t = { i: m.i, px: m.px, py: m.py, hitTrongTrang: m.hitBatchId, domTai: m.domTai, cursor, mauTruoc, mauHover, mauDoi: JSON.stringify(mauTruoc) !== JSON.stringify(mauHover), nhanHover, urlSau: urlSau.replace(BASE, ""), msDoi };
        r.thu.push(t);
        console.log(`      bấm tâm instance ${m.i} @${m.px},${m.py} (hitTrongTrang=${m.hitBatchId}, dom=${m.domTai}) ⇒ cursor=${cursor} màuĐổi=${t.mauDoi} nhãn=${nhanHover} URL ${t.urlSau}${msDoi !== null ? ` (${msDoi} ms)` : " (KHÔNG đổi)"}`);
        if (urlSau !== urlTruoc) { await page.screenshot({ path: `${OUT}/bam47-${TAG}-${vp}-${duong.replace(/\//g, "_")}-trung.png` }); await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForSelector(selCanvas, { timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(3000); }
      }
      // Đối chứng: bấm sàn trống (góc dưới-phải của canvas cách mép 12%, nếu không có máy ở đó) ⇒ URL không đổi.
      const sanX = cv.x + cv.w * 0.5, sanY = cv.y + cv.h * 0.12;
      const urlTruocSan = page.url(); await page.mouse.click(sanX, sanY); await page.waitForTimeout(800);
      r.doiChungSan = { x: Math.round(sanX), y: Math.round(sanY), urlSau: page.url().replace(BASE, ""), doi: page.url() !== urlTruocSan };
      console.log(`      đối chứng sàn @${r.doiChungSan.x},${r.doiChungSan.y} ⇒ URL ${r.doiChungSan.doi ? "ĐỔI (!)" : "không đổi"}`);
      kq.man[`${vp}${duong}`] = r;
      await page.close();
    }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/bam47-${TAG}.json`, JSON.stringify(kq, null, 2));
console.log(`=== probe-bam47 ${TAG} xong ===`);
