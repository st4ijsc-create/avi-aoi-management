/**
 * doc 80 Đợt 1 Task 9 (§12 "Còn mở") — interlock VERSION TOKEN khi duyệt / bật.
 *
 * Lỗ: `approve`/`enable` chỉ nhận `{ id }`. Người duyệt nhìn rule ở nội dung C, trong lúc đó
 * người khác sửa thành D (hoặc sửa → bị reset duyệt → người thứ ba duyệt lại D) — cú bấm "Duyệt"
 * /"Bật" của người thứ nhất đi vào D, nội dung họ CHƯA từng xem. Khoá hàng `FOR UPDATE` (Đợt 0)
 * chỉ tuần tự hoá, không nói người bấm đã xem bản nào.
 *
 * Vá: `list`/`get` (và mọi thủ tục trả rule) mang `versionToken` = sha256 của MỌI cột định nghĩa
 * + trạng thái duyệt (trừ `lastFiredAt` — cột do engine ghi, không phải nội dung); `approve`/
 * `enable` BẮT BUỘC `expectedVersion` và so với bản đọc DƯỚI `FOR UPDATE` — lệch ⇒ CONFLICT
 * (OPERATION_FAILED, reason `interlockRuleChanged`), không ghi gì.
 *
 * CSDL THẬT (`_test`) — race cưỡng bức: một giao dịch NGOÀI giữ khoá hàng rule, sửa ngưỡng rồi
 * commit trong lúc lượt approve (mang token của bản cũ) đang xếp hàng sau khoá.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { interlockRouter } from "./interlockRouter";
import { waitForLockWaiters, backendPid } from "../db/lockWait.testkit";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILKTOK-${Date.now()}`;
const A = 990_510_001; // tác giả
const B = 990_510_002; // người duyệt
const C = 990_510_003; // người sửa chen

function caller(userId: number) {
  return interlockRouter.createCaller({
    user: { id: userId, role: "admin", name: `probe-${userId}`, twoFactorEnabled: true },
  } as any);
}

function appCodeOf(e: unknown): string | undefined {
  const err = e as { cause?: { appCode?: string; appParams?: Record<string, unknown> }; appCode?: string } | null;
  return err?.cause?.appCode ?? err?.appCode;
}
function reasonOf(e: unknown): unknown {
  return (e as { cause?: { appParams?: Record<string, unknown> } } | null)?.cause?.appParams?.reason;
}
function trpcCodeOf(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

function baseInput(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    scope: "machine" as const,
    sourceType: "ng_rate" as const,
    comparisonOperator: "gt" as const,
    threshold: 5,
    action: "stop_line" as const,
    targetMachineId: 1,
    commandTag: "line_stop",
    commandValue: { stop: true, mode: "safe" },
    ...over,
  };
}

let sql: ReturnType<typeof postgres>;
const ruleIds: number[] = [];

async function ruleRow(id: number) {
  const r = await sql`SELECT name, threshold, "approvedBy", enabled, "commandTag", "commandValue", action FROM interlock_rules WHERE id = ${id}`;
  return r[0] as any;
}

/** Token mà màn hình đang hiển thị = token của hàng trong `list` (đúng thứ client gửi). */
async function tokenInList(userId: number, id: number): Promise<string> {
  const rows = await caller(userId).list();
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`rule ${id} không có trong list`);
  return row.versionToken;
}

describe.skipIf(!DB_URL)("interlock — version token khi approve/enable (Đợt 1 Task 9, CSDL THẬT)", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  }, 60_000);

  afterAll(async () => {
    // control_audit_log là WORM — các dòng audit của rule test ở lại vô hại.
    if (ruleIds.length) await sql`DELETE FROM interlock_rules WHERE id = ANY(${ruleIds})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("list/get mang versionToken; token ĐỔI khi nội dung đổi, KHÔNG đổi khi chỉ đọc lại", async () => {
    const created = await caller(A).create(baseInput(`${DAU}-tok`));
    ruleIds.push(created.id);
    const t1 = await tokenInList(B, created.id);
    expect(typeof t1).toBe("string");
    expect(t1.length).toBeGreaterThan(16);
    expect(await tokenInList(B, created.id)).toBe(t1); // đọc lại ⇒ ổn định
    expect((await caller(B).get({ id: created.id })).versionToken).toBe(t1);
    expect(created.versionToken).toBe(t1); // create trả đúng token của hàng vừa ghi

    await caller(C).update({ id: created.id, threshold: 6 });
    const t2 = await tokenInList(B, created.id);
    expect(t2).not.toBe(t1);
  });

  it("★★★ approve với token CŨ (rule đã bị sửa sau khi người duyệt xem) ⇒ CONFLICT, KHÔNG duyệt", async () => {
    const created = await caller(A).create(baseInput(`${DAU}-stale-approve`));
    ruleIds.push(created.id);
    const seen = await tokenInList(B, created.id); // B mở trang, thấy ngưỡng 5
    await caller(C).update({ id: created.id, threshold: 50 }); // C đổi ngưỡng thành 50

    const err = await caller(B).approve({ id: created.id, expectedVersion: seen }).catch((e) => e);
    expect(trpcCodeOf(err)).toBe("CONFLICT");
    expect(appCodeOf(err)).toBe("OPERATION_FAILED");
    expect(reasonOf(err)).toBe("interlockRuleChanged");
    const row = await ruleRow(created.id);
    expect(row.approvedBy).toBeNull();
    expect(Number(row.threshold)).toBe(50);
  });

  it("approve với token ĐANG hiển thị (tải lại) ⇒ duyệt; nội dung lệnh giữ nguyên (dispatcher vẫn khớp đúng rule)", async () => {
    const created = await caller(A).create(baseInput(`${DAU}-fresh-approve`));
    ruleIds.push(created.id);
    await caller(C).update({ id: created.id, threshold: 50 });
    const fresh = await tokenInList(B, created.id);
    const row = await caller(B).approve({ id: created.id, expectedVersion: fresh });
    expect(row.approvedBy).toBe(B);
    // approve không chạm các trường mà verifyInterlockAuthorization so khớp
    const db = await ruleRow(created.id);
    expect(db.commandTag).toBe("line_stop");
    expect(db.commandValue).toEqual({ stop: true, mode: "safe" });
    expect(db.action).toBe("stop_line");
    // token của bản vừa duyệt khác bản trước duyệt (trạng thái duyệt là một phần phiên bản)
    expect(row.versionToken).not.toBe(fresh);
    // bật bằng token của bản ĐÃ duyệt
    const enabled = await caller(A).enable({ id: created.id, expectedVersion: row.versionToken });
    expect(enabled.enabled).toBe(true);
  });

  it("★★★ enable với token của bản trước khi bị sửa + duyệt lại ⇒ CONFLICT, KHÔNG bật", async () => {
    const created = await caller(A).create(baseInput(`${DAU}-stale-enable`));
    ruleIds.push(created.id);
    const approved = await caller(B).approve({ id: created.id, expectedVersion: created.versionToken });
    const seenByEnabler = await tokenInList(A, created.id); // A thấy bản ngưỡng 5 đã duyệt
    expect(seenByEnabler).toBe(approved.versionToken);
    // C sửa (⇒ reset duyệt), B duyệt lại bản ngưỡng 99 — A chưa từng xem bản này.
    const edited = await caller(C).update({ id: created.id, threshold: 99 });
    await caller(B).approve({ id: created.id, expectedVersion: edited.versionToken });

    const err = await caller(A).enable({ id: created.id, expectedVersion: seenByEnabler }).catch((e) => e);
    expect(trpcCodeOf(err)).toBe("CONFLICT");
    expect(reasonOf(err)).toBe("interlockRuleChanged");
    expect((await ruleRow(created.id)).enabled).toBe(false);
  });

  it("★★★ race CƯỠNG BỨC: giao dịch ngoài giữ khoá hàng + đổi ngưỡng; approve (token cũ) xếp hàng sau khoá ⇒ CONFLICT, không duyệt nội dung chưa xem", async () => {
    const created = await caller(A).create(baseInput(`${DAU}-race`));
    ruleIds.push(created.id);
    const seen = await tokenInList(B, created.id);

    const ext = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      let holderPid = 0;
      const holder = ext.begin(async (tx) => {
        holderPid = await backendPid(tx);
        await tx`SELECT id FROM interlock_rules WHERE id = ${created.id} FOR UPDATE`;
        await tx`UPDATE interlock_rules SET threshold = 77, "updatedAt" = now(), "updatedBy" = ${C} WHERE id = ${created.id}`;
        locked();
        await gate;
      });
      await lockedP;
      const pApprove = caller(B).approve({ id: created.id, expectedVersion: seen }).catch((e) => e);
      // fix round 1 — chờ tới khi approve THẬT SỰ bị giao dịch ngoài chặn ở SELECT … FOR UPDATE.
      expect(await waitForLockWaiters(sql, { holderPid })).toBeGreaterThanOrEqual(1);
      release();
      await holder;
      const res = await pApprove;
      expect(trpcCodeOf(res), `approve lọt: ${JSON.stringify(res?.approvedBy ?? res)}`).toBe("CONFLICT");
      const row = await ruleRow(created.id);
      expect(Number(row.threshold)).toBe(77);
      expect(row.approvedBy).toBeNull();
    } finally {
      await ext.end();
    }
  }, 60_000);

  // ── fix round 1 (item 5) — race cưỡng bức cho ENABLE ─────────────────────────────────────────
  it("★★★ race CƯỠNG BỨC enable: giao dịch ngoài giữ khoá hàng + đổi commandValue của rule ĐÃ duyệt; enable (token bản đã xem) xếp hàng sau khoá ⇒ CONFLICT, KHÔNG bật", async () => {
    const created = await caller(A).create(baseInput(`${DAU}-race-enable`));
    ruleIds.push(created.id);
    const approved = await caller(B).approve({ id: created.id, expectedVersion: created.versionToken });
    const seenByEnabler = await tokenInList(A, created.id);
    expect(seenByEnabler).toBe(approved.versionToken);

    const ext = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      let holderPid = 0;
      const holder = ext.begin(async (tx) => {
        holderPid = await backendPid(tx);
        await tx`SELECT id FROM interlock_rules WHERE id = ${created.id} FOR UPDATE`;
        await tx`UPDATE interlock_rules SET "commandValue" = ${tx.json({ stop: false, mode: "run" })} WHERE id = ${created.id}`;
        locked();
        await gate;
      });
      await lockedP;
      const pEnable = caller(A).enable({ id: created.id, expectedVersion: seenByEnabler }).catch((e) => e);
      expect(await waitForLockWaiters(sql, { holderPid })).toBeGreaterThanOrEqual(1);
      release();
      await holder;
      const res = await pEnable;
      expect(trpcCodeOf(res), `enable lọt: enabled=${res?.enabled}`).toBe("CONFLICT");
      expect(reasonOf(res)).toBe("interlockRuleChanged");
      expect((await ruleRow(created.id)).enabled).toBe(false);
    } finally {
      await ext.end();
    }
  }, 60_000);

  // ── fix round 1 (item 6) — token là HASH NỘI DUNG, không phải updatedAt ─────────────────────
  it("★★★ sửa một cột định nghĩa bằng SQL thô KHÔNG đụng updatedAt ⇒ token ĐỔI và approve bằng token cũ ⇒ CONFLICT", async () => {
    const created = await caller(A).create(baseInput(`${DAU}-raw`));
    ruleIds.push(created.id);
    const seen = await tokenInList(B, created.id);
    const [before] = await sql`SELECT "updatedAt" FROM interlock_rules WHERE id = ${created.id}`;
    await sql`UPDATE interlock_rules SET "commandTag" = 'line_run' WHERE id = ${created.id}`;
    const [after] = await sql`SELECT "updatedAt" FROM interlock_rules WHERE id = ${created.id}`;
    expect((after as any).updatedAt.getTime()).toBe((before as any).updatedAt.getTime()); // updatedAt KHÔNG đổi
    expect(await tokenInList(B, created.id)).not.toBe(seen);
    const err = await caller(B).approve({ id: created.id, expectedVersion: seen }).catch((e) => e);
    expect(trpcCodeOf(err)).toBe("CONFLICT");
    expect(reasonOf(err)).toBe("interlockRuleChanged");
    expect((await ruleRow(created.id)).approvedBy).toBeNull();
  });

  it("thiếu expectedVersion ⇒ BAD_REQUEST (zod) — không còn đường duyệt 'mù'", async () => {
    const created = await caller(A).create(baseInput(`${DAU}-blind`));
    ruleIds.push(created.id);
    const err = await (caller(B).approve as any)({ id: created.id }).catch((e: unknown) => e);
    expect(trpcCodeOf(err)).toBe("BAD_REQUEST");
    expect((await ruleRow(created.id)).approvedBy).toBeNull();
  });
});
