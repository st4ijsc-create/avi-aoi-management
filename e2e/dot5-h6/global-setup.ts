/**
 * doc 81 Đợt 5 H6 — globalSetup của playwright.dot5h6.config.ts: dọn hàng sót (tiền tố h6e2e_), gieo dữ liệu, dựng instance
 * RIÊNG (server tsx + Vite, cổng 3046/5206), trả hàm teardown (tắt instance, dọn dữ liệu, ĐẾM về 0, chứng minh cổng trống).
 * Kết quả gieo đi qua env (H6_STATE = tệp JSON trong outputDir) tới worker; H6_E2E=1 là điều kiện để spec chạy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countFixtures, enabledAdapters, setupFixtures, teardownFixtures } from "./fixtures";
import { killTree, portBusy, SERVER_PORT, startInstance, VITE_PORT } from "./instance";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(): Promise<() => Promise<void>> {
  const outDir = path.resolve(process.env.H6_OUT_DIR || path.join(HERE, "..", "..", ".qa-dot5h6"));
  fs.mkdirSync(outDir, { recursive: true });
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), ports: { server: SERVER_PORT, vite: VITE_PORT } };
  report.staleRemoved = await teardownFixtures();
  report.countsBefore = await countFixtures();
  const fx = await setupFixtures();
  report.fixture = { ...fx, owner: { id: fx.owner.id, username: fx.owner.username }, approver: { id: fx.approver.id, username: fx.approver.username } };
  const stateFile = path.join(outDir, "h6-state.json");
  fs.writeFileSync(stateFile, JSON.stringify(fx));
  let inst: Awaited<ReturnType<typeof startInstance>> | null = null;
  try {
    inst = await startInstance(path.join(outDir, "instance"), enabledAdapters); // P-H4: read before AND right after the boot
    report.adapterSafety = inst.adapterSafety;
  } catch (e) {
    report.startError = (e as Error).message;
    await teardownFixtures();
    fs.rmSync(stateFile, { force: true });
    fs.writeFileSync(path.join(outDir, "h6-report.json"), JSON.stringify(report, null, 1));
    throw e;
  }
  process.env.H6_E2E = "1";
  process.env.H6_STATE = stateFile;
  process.env.H6_BASE_URL = `http://127.0.0.1:${VITE_PORT}`;
  return async () => {
    try { await inst?.vite.close(); } catch { /* */ }
    killTree(inst?.child.pid);
    await new Promise((r) => setTimeout(r, 1500));
    report.removed = await teardownFixtures();
    report.countsAfter = await countFixtures();
    report.portsAfter = { [SERVER_PORT]: (await portBusy(SERVER_PORT)) ? "busy" : "free", [VITE_PORT]: (await portBusy(VITE_PORT)) ? "busy" : "free" };
    fs.rmSync(stateFile, { force: true }); // passwords never outlive the run
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outDir, "h6-report.json"), JSON.stringify(report, null, 1));
    console.log("[H6] teardown:", JSON.stringify({ removed: report.removed, countsAfter: report.countsAfter, portsAfter: report.portsAfter }));
  };
}
