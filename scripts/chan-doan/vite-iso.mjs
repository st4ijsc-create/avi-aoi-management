// Cô lập: chỉ dựng Vite dev server (middlewareMode) rồi thoát. Không DB, không app, không GPU.
// usage: node .vite-iso.tmp.mjs [cauHinh=full|khongTailwind|khongReact|toiThieu] [giuMs=3000] [thamChieuTrang=0]
import http from "node:http";
import { createServer } from "vite";

const cau = process.argv[2] ?? "full";
const giu = Number(process.argv[3] ?? 3000);
const chamTrang = process.argv[4] === "1";
const server = http.createServer();

const opts = { server: { middlewareMode: true, hmr: { server }, allowedHosts: true }, appType: "custom", logLevel: "error" };
if (cau !== "full") {
  const plugins = [];
  const { default: react } = await import("@vitejs/plugin-react");
  const { default: tailwindcss } = await import("@tailwindcss/vite");
  if (cau === "khongTailwind") plugins.push(react());
  else if (cau === "khongReact") plugins.push(tailwindcss());
  else if (cau === "chiTailwind") plugins.push(tailwindcss());
  opts.configFile = false;
  opts.root = process.cwd() + "/client";
  opts.plugins = plugins;
}
const vite = await createServer(opts);
if (chamTrang) {
  // ép biên dịch một mô-đun client thật (đi qua esbuild/oxide/lightningcss)
  await vite.transformRequest("/src/main.tsx").catch(() => {});
  await vite.transformRequest("/src/index.css").catch(() => {});
}
await new Promise((r) => setTimeout(r, giu));
await vite.close();
server.close();
process.exit(0);
