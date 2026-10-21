/**
 * Đợt 9 — globalSetup của playwright.flowstudio.config.ts: dọn hàng sót (tiền tố fse2e), gieo, dựng instance RIÊNG
 * (3047/5207), trả hàm teardown (tắt instance, dọn dữ liệu, ĐẾM về 0, chứng minh cổng trống). Kết quả gieo đi qua tệp JSON
 * (FS_STATE) tới worker; FS_E2E=1 là điều kiện để spec chạy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countFixtures, setupFixtures, teardownFixtures } from "./fixtures";
import { killTree, portBusy, SERVER_PORT, startInstance, VITE_PORT } from "./instance";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(): Promise<() => Promise<void>> {
  const outDir = path.resolve(process.env.FS_OUT_DIR || path.join(HERE, "..", "..", ".qa-flowstudio"));
  fs.mkdirSync(outDir, { recursive: true });
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), ports: { server: SERVER_PORT, vite: VITE_PORT } };
  report.staleRemoved = await teardownFixtures();
  report.countsBefore = await countFixtures();
  const fx = await setupFixtures();
  const stateFile = path.join(outDir, "fs-state.json");
  fs.writeFileSync(stateFile, JSON.stringify(fx));
  let inst: Awaited<ReturnType<typeof startInstance>> | null = null;
  try {
    inst = await startInstance(path.join(outDir, "instance"));
  } catch (e) {
    report.startError = (e as Error).message;
    await teardownFixtures();
    fs.rmSync(stateFile, { force: true });
    fs.writeFileSync(path.join(outDir, "fs-report.json"), JSON.stringify(report, null, 1));
    throw e;
  }
  process.env.FS_E2E = "1";
  process.env.FS_STATE = stateFile;
  process.env.FS_BASE_URL = `http://127.0.0.1:${VITE_PORT}`;
  return async () => {
    try { await inst?.vite.close(); } catch { /* */ }
    killTree(inst?.child.pid);
    await new Promise((r) => setTimeout(r, 1500));
    report.removed = await teardownFixtures();
    report.countsAfter = await countFixtures();
    report.portsAfter = { [SERVER_PORT]: (await portBusy(SERVER_PORT)) ? "busy" : "free", [VITE_PORT]: (await portBusy(VITE_PORT)) ? "busy" : "free" };
    fs.rmSync(stateFile, { force: true }); // mật khẩu không sống quá lượt chạy
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outDir, "fs-report.json"), JSON.stringify(report, null, 1));
    console.log("[FS] teardown:", JSON.stringify({ removed: report.removed, countsAfter: report.countsAfter, portsAfter: report.portsAfter }));
  };
}
