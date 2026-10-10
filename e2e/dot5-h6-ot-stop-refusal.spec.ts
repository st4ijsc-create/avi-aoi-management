/**
 * doc 81 Đợt 5 H6 (mục 10) — "Không trang nào gửi lệnh DỪNG OT; câu từ chối mới chỉ được chứng minh ở mức unit."
 * Quyết định chủ dự án (khuyến nghị (b)): KHÔNG thêm nút DỪNG mới; chứng minh câu từ chối ĐẦU-CUỐI qua bề mặt CÓ SẴN —
 * một lần chạy Orchestration có bước lệnh `stop` lên máy OT — trên `_test`, cổng RIÊNG.
 *
 * Chỉ chạy bằng `npx playwright test --config=playwright.dot5h6.config.ts` (globalSetup dựng instance + dữ liệu và đặt
 * H6_E2E=1). Mọi cấu hình khác (vd playwright.config.ts gốc trỏ :3000) ⇒ spec TỰ BỎ QUA.
 *
 * Luồng (hai người — QĐ-4a: người duyệt khác người chạy):
 *   1. người chạy: Studio → "Nạp" workflow → "▶️ Chạy" ⇒ run dừng ở gate g1;
 *   2. người duyệt: Studio → Lần chạy → "Duyệt" ⇒ bước s1 (`stop`, tag KHÔNG ghim) tới dispatcher OT THẬT (driver stub trong
 *      tiến trình, adapter đã commissioning, OT_CONTROL_ENABLED) ⇒ preflight an toàn không có PLC an toàn thật ⇒ TỪ CHỐI;
 *   3. dòng bước s1 hiện CÂU ĐÃ DỊCH (`data-testid=step-app-error`) — vi, rồi en sau khi đổi ngôn ngữ.
 * ORACLE độc lập với mã trang: câu kỳ vọng ráp từ tệp từ điển vi/en (khuôn OPERATION_FAILED_WITH_REASON + câu lý do +
 * câu stopPinReason), stopPinReason đọc từ CSDL (kết quả bước do server ghi), không đọc từ DOM.
 * H fix 1: hai người là KỸ SƯ chỉ thuộc nhà máy của fixture (không admin) — trang sẵn sàng sau vài giây; chờ theo tín hiệu
 * sẵn sàng CỦA TRANG (listWorkflows + listRuns đã trả), không chờ cố định.
 * ⚠ Mỗi lượt để lại ĐÚNG MỘT hàng `command_log` 'rejected': lệnh bị từ chối được dispatcher ghi sổ cái TRƯỚC khi trả lời
 *   (đó là hành vi sản phẩm phải giữ), và sổ cái là append-only — vai `avi_app` không có quyền DELETE (mig 0279, đo:
 *   has_table_privilege('command_log','DELETE') = false). Xoá nó cần vai chủ CSDL, tức phá WORM ⇒ không làm; teardown đếm nó.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { H6Fixture } from "./dot5-h6/fixtures";
import { testDatabaseUrl } from "./dot5-h6/fixtures";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const require = createRequire(path.join(REPO, "package.json"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = require("postgres") as typeof import("postgres");
const dict = (lng: string) => JSON.parse(fs.readFileSync(path.join(REPO, "client/src/i18n/locales", `${lng}.json`), "utf8"));

test.skip(process.env.H6_E2E !== "1", "H6 runs only under playwright.dot5h6.config.ts (own instance on _test)");

function expectedSentence(lng: "vi" | "en", stopPinReason: string): string {
  const e = dict(lng).errors;
  const main = String(e.OPERATION_FAILED_WITH_REASON)
    .replace("{{operation}}", e.operation.softwareStop)
    .replace("{{reason}}", e.reason.softwareStopRefusedUseHardwareEstop);
  return `${main} ${e.stopPinReason[stopPinReason]}`;
}

async function loggedIn(browser: Browser, base: string, user: { username: string; password: string }, lng: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: lng === "vi" ? "vi-VN" : "en-US" });
  await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch { /* */ } }, lng);
  const r = await ctx.request.post(`${base}/api/auth/login`, { data: { username: user.username, password: user.password } });
  expect(r.ok(), `login ${user.username}: ${r.status()}`).toBe(true);
  return ctx;
}

/**
 * H fix 1 (review M8) — wait on the page's OWN readiness signal, not a fixed 180 s: the Studio has loaded when its
 * workflow list AND run list queries have answered (200). Bound = READY_MS, only a ceiling for a broken instance.
 */
const READY_MS = 60_000;
async function openStudio(page: Page, url: string): Promise<void> {
  const answered = (proc: string) =>
    page.waitForResponse((r) => r.url().includes("/api/trpc/") && decodeURIComponent(r.url()).includes(proc) && r.ok(), { timeout: READY_MS });
  const ready = Promise.all([answered("orchestration.listWorkflows"), answered("orchestration.listRuns")]);
  await page.goto(url);
  await ready;
}

/** Bottom panel tab via the status bar (existing UI): "runs" = every run, "awaiting" = runs waiting at a gate. */
async function openRunsPanel(page: Page, which: "runs" | "awaiting" = "runs"): Promise<void> {
  await page.getByTestId(`orch-status-${which}`).click();
}

test("H6 — orchestration run with an OT STOP step: the dispatcher's refusal renders as a TRANSLATED sentence (vi, en)", async ({ browser }) => {
  test.setTimeout(300_000);
  const base = process.env.H6_BASE_URL!;
  const fx = JSON.parse(fs.readFileSync(process.env.H6_STATE!, "utf8")) as H6Fixture;
  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    // ── 1. the owner starts the run from the Studio (existing "Run" button) ─────────────────────────────────────────────
    const owner = await loggedIn(browser, base, fx.owner, "vi");
    const p1 = await owner.newPage();
    await openStudio(p1, `${base}/orchestration-studio`);
    const wfRow = p1.locator(`[data-workflow-row="${fx.workflowId}"]`);
    await expect(wfRow).toBeVisible();
    await wfRow.getByRole("button", { name: "Nạp" }).click();
    await p1.getByRole("button", { name: dict("vi").studio.run }).click();
    let runId = 0;
    await expect
      .poll(async () => {
        const r = await sql`SELECT id, status, "currentStepId" FROM orchestration_runs WHERE "workflowId" = ${fx.workflowId} ORDER BY id DESC LIMIT 1`;
        runId = r.length ? Number(r[0].id) : 0;
        return r.length ? `${r[0].status}@${r[0].currentStepId}` : "none";
      }, { timeout: 60_000 })
      .toBe("awaiting_confirm@g1");
    await owner.close();

    // ── 2. ANOTHER user approves gate g1 from the run list (existing "Approve" button) ──────────────────────────────────
    const approver = await loggedIn(browser, base, fx.approver, "vi");
    const p2 = await approver.newPage();
    await openStudio(p2, `${base}/orchestration-studio`);
    await openRunsPanel(p2, "awaiting");
    const row = p2.locator(`[data-run-row="${runId}"]`);
    await expect(row).toBeVisible();
    const approve = row.getByRole("button", { name: "Duyệt", exact: true });
    await expect(approve).toBeEnabled({ timeout: 60_000 });
    await approve.click();

    // server truth: the run ends failed AT s1, the step carries the dispatcher's refusal (appError + stopPinReason)
    await expect
      .poll(async () => (await sql`SELECT status FROM orchestration_runs WHERE id = ${runId}`)[0]?.status, { timeout: 90_000 })
      .toBe("failed");
    const [step] = await sql`SELECT status, "resultJson" FROM orchestration_run_steps WHERE "runId" = ${runId} AND "stepId" = 's1'`;
    const detail = (step?.resultJson as { detail?: { appError?: { appCode?: string; appParams?: Record<string, string> }; simulated?: boolean } } | undefined)?.detail;
    expect(step?.status).toBe("failed");
    expect(detail?.simulated).toBe(false); // the REAL path (commissioned, control on) — not a dry run
    expect(detail?.appError?.appCode).toBe("OPERATION_FAILED");
    expect(detail?.appError?.appParams?.reason).toBe("softwareStopRefusedUseHardwareEstop");
    const stopPinReason = String(detail?.appError?.appParams?.stopPinReason);
    expect(stopPinReason).toBe("no_pins"); // the fixture pins nothing on this adapter
    const ledger = await sql`SELECT status FROM command_log WHERE "machineId" = ${fx.machineId} AND "commandType" = 'stop'`;
    expect(ledger.map((r) => r.status)).toEqual(["rejected"]); // refused before any write — nothing was sent

    // ── 3. the step line shows the TRANSLATED sentence (vi) ─────────────────────────────────────────────────────────────
    {
      const answered = p2.waitForResponse((r) => decodeURIComponent(r.url()).includes("orchestration.listRuns") && r.ok(), { timeout: READY_MS });
      await p2.reload();
      await answered;
    }
    await openRunsPanel(p2);
    const row2 = p2.locator(`[data-run-row="${runId}"]`);
    await expect(row2).toBeVisible();
    await row2.locator("button").first().click(); // expand the run → per-step lines
    const vi = row2.getByTestId("step-app-error");
    await expect(vi).toHaveText(expectedSentence("vi", stopPinReason), { timeout: 30_000 });
    const viText = (await vi.textContent()) ?? "";
    for (const raw of ["softwareStopRefusedUseHardwareEstop", "no_pins", "errors.", "OPERATION_FAILED", "{{"]) expect(viText).not.toContain(raw);
    await approver.close();

    // ── en: same run, same line, English dictionary ──────────────────────────────────────────────────────────────────────
    const en = await loggedIn(browser, base, fx.approver, "en");
    const p3 = await en.newPage();
    await openStudio(p3, `${base}/orchestration-studio?tab=runs`);
    await openRunsPanel(p3);
    const row3 = p3.locator(`[data-run-row="${runId}"]`);
    await expect(row3).toBeVisible();
    await row3.locator("button").first().click();
    await expect(row3.getByTestId("step-app-error")).toHaveText(expectedSentence("en", stopPinReason), { timeout: 30_000 });
    await en.close();
  } finally {
    await sql.end({ timeout: 5 });
  }
});
