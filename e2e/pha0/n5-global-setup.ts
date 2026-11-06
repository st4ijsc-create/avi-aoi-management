/** 50-N5 — dựng Vite HARNESS (không máy chủ, không DB) ở cổng riêng; teardown tắt và chứng minh cổng trống. */
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(REPO, "package.json"));
const PORT = Number(process.env.N5_PORT || 5211);

function portBusy(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port: p, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (await portBusy(PORT)) throw new Error(`N5: port ${PORT} busy — refusing`);
  const { createServer } = (await import(pathToFileURL(require.resolve("vite")).href)) as typeof import("vite");
  const vite = await createServer({
    configFile: path.join(REPO, "vite.config.ts"),
    root: HERE,
    cacheDir: path.join(REPO, ".qa-n5", "vite-cache"),
    logLevel: "warn",
    clearScreen: false,
    server: { port: PORT, strictPort: true, host: "127.0.0.1", hmr: false, fs: { strict: false, allow: [REPO] } },
  });
  await vite.listen();
  process.env.N5_BASE_URL = `http://127.0.0.1:${PORT}`;
  return async () => {
    await vite.close();
    await new Promise((r) => setTimeout(r, 500));
    console.log(`[N5] teardown: cổng ${PORT} ${(await portBusy(PORT)) ? "BẬN" : "trống"}`);
  };
}
