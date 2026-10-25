/**
 * Cổng 8.3 — globalSetup của playwright.flowhanhtrinh.config.ts: dọn hàng sót (tiền tố fse2e), gieo (dùng lại fixtures Flow Studio), dựng instance PRODUCTION riêng,
 * trả hàm teardown (tắt instance, dọn dữ liệu, ĐẾM về 0, chứng minh cổng trống).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countFixtures, setupFixtures, teardownFixtures, withTestDb } from "../flow-studio/fixtures";
import { killTree, portBusy, PORT, startInstance } from "./instance";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Thông báo của người dùng e2e chặn FK khi xoá người dùng ⇒ xoá trước. */
async function donThongBao(): Promise<number> {
  return withTestDb(async (sql) => (await sql`DELETE FROM notifications WHERE "userId" IN (SELECT id FROM users WHERE "openId" LIKE 'fse2e%')`).count);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const outDir = path.resolve(process.env.FHT_OUT_DIR || path.join(HERE, "..", "..", ".qa-flowhanhtrinh"));
  fs.mkdirSync(outDir, { recursive: true });
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), port: PORT, build: "production (dist/index.js)" };
  await donThongBao();
  report.staleRemoved = await teardownFixtures();
  report.countsBefore = await countFixtures();
  const fx = await setupFixtures();
  const stateFile = path.join(outDir, "fht-state.json");
  fs.writeFileSync(stateFile, JSON.stringify(fx));
  let inst: Awaited<ReturnType<typeof startInstance>> | null = null;
  try {
    inst = await startInstance(path.join(outDir, "instance"));
  } catch (e) {
    report.startError = (e as Error).message;
    await teardownFixtures();
    fs.rmSync(stateFile, { force: true });
    fs.writeFileSync(path.join(outDir, "fht-report.json"), JSON.stringify(report, null, 1));
    throw e;
  }
  process.env.FHT_E2E = "1";
  process.env.FHT_STATE = stateFile;
  process.env.FHT_BASE_URL = `http://127.0.0.1:${PORT}`;
  return async () => {
    killTree(inst?.child.pid);
    await new Promise((r) => setTimeout(r, 1500));
    report.thongBaoDon = await donThongBao();
    report.removed = await teardownFixtures();
    report.countsAfter = await countFixtures();
    report.portAfter = (await portBusy(PORT)) ? "busy" : "free";
    fs.rmSync(stateFile, { force: true });
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outDir, "fht-report.json"), JSON.stringify(report, null, 1));
    console.log("[FHT] teardown:", JSON.stringify({ removed: report.removed, countsAfter: report.countsAfter, portAfter: report.portAfter }));
  };
}
