// ĐỢT 48 · D-4 — SOCKET `twin:trangThai` theo vai: join `twin:1` + `twin:18`, đếm gói theo factoryId trong N s (phát-ngay-khi-join + nhịp 10 s).
//   node .qa-dot48/socket-vai.mjs --vai=A|B|C|D|M|ADM [--base=http://localhost:3048] [--giay=12]
import { request } from "@playwright/test";
import { io } from "socket.io-client";
import { mkdirSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const VAI = arg("vai", "A"); const BASE = arg("base", "http://localhost:3048"); const GIAY = Number(arg("giay", "12"));
const OUT = ".qa-dot48/api-vai"; mkdirSync(OUT, { recursive: true });
const TK = { A: { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" }, B: { username: "operator1", password: "User@123" }, C: { username: "e2e_dot32_khongquyen", password: "KhongQuyen!2026" }, D: { username: "e2e_dot36_oee", password: "Oee!2026Dot36" }, M: { username: "e2e_dot41_mon", password: "Mon!2026Dot41" }, ADM: { username: "e2e_dot41_adm", password: "Adm!2026Dot41" } }[VAI];
const ctx = await request.newContext({ baseURL: BASE });
const login = await ctx.post("/api/auth/login", { data: TK });
const cookie = (await ctx.storageState()).cookies.find((c) => c.name === "app_session_id");
const kq = { vai: VAI, user: TK.username, login: login.status(), coCookie: !!cookie, luc: new Date().toISOString(), goi: [], loi: null };
await ctx.dispose();
await new Promise((res) => {
  const sk = io(BASE, { path: "/api/socket.io", transports: ["websocket"], extraHeaders: cookie ? { Cookie: `app_session_id=${cookie.value}` } : {}, reconnection: false });
  const t0 = Date.now();
  sk.on("connect", () => { kq.ketNoi = Date.now() - t0; sk.emit("subscribe", { twinFactoryId: 1 }); sk.emit("subscribe", { twinFactoryId: 18 }); });
  sk.on("twin:trangThai", (g) => kq.goi.push({ t: Date.now() - t0, factoryId: g?.factoryId, tong: g?.tong, may: (g?.may ?? []).slice(0, 3).map((m) => m.machineId) }));
  sk.on("connect_error", (e) => { kq.loi = String(e?.message ?? e).slice(0, 120); });
  setTimeout(() => { sk.close(); res(); }, GIAY * 1000);
});
kq.f1 = kq.goi.filter((g) => g.factoryId === 1).length; kq.f18 = kq.goi.filter((g) => g.factoryId === 18).length;
writeFileSync(`${OUT}/socket-${VAI}.json`, JSON.stringify(kq, null, 2));
console.log(`   [socket ${VAI}] login=${kq.login} cookie=${kq.coCookie} ketNoi=${kq.ketNoi ?? "-"}ms goi twin:1=${kq.f1} twin:18=${kq.f18} (${GIAY}s) ${kq.loi ? "LOI " + kq.loi : ""} ${kq.goi.slice(0, 3).map((g) => `[${g.t}ms f${g.factoryId} tong ${g.tong}]`).join(" ")}`);
