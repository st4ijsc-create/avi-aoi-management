/**
 * SCADA R1a Task 4 — the K2 mode gate (MODE_LOCAL) shares 3b's refusal path, so it never blocks a STOP that step 4 would ROUTE.
 *
 * On an EDGE-owned adapter (central holds no driver), `routeEdgeOwnedAdapterCommand` turns any stop-typed command into an adapter-wide
 * STOP of the PINNED values (queued for the owning node, or central's fallback). A stop-typed command refused MODE_LOCAL (the kit's
 * machine declares no mode channel ⇒ LOCAL chua_khai) is routed exactly like a 3b refusal (T3 fix round 1, I-1). A non-STOP write keeps
 * the MODE_LOCAL refusal. Real `_test` DB (central kit, pattern of commandDispatcher.kenh.edge.r1a.db.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupKit, type Kit } from "../edge/__edgeCentralKit.dot10";

const rec = vi.hoisted(() => ({ alerts: [] as Array<{ kind: string; message: string }>, fallback: [] as number[] }));
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { kind: string; message: string }) => {
    rec.alerts.push(a);
  },
}));
vi.mock("../robot/deviceOwnershipService", async importOriginal => {
  const orig = await importOriginal<typeof import("../robot/deviceOwnershipService")>();
  return {
    ...orig,
    sendCentralAdapterStop: async (adapterId: number) => {
      rec.fallback.push(adapterId);
      return { ok: true, sent: "sent" as const, detail: "pinned stop written on a transient session (recorded)" };
    },
  };
});

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;
let seq = 0;
let savedFlag: string | undefined;

describe.skipIf(!onTest)("R1a T4 — MODE_LOCAL never blocks a STOP routed to the owning edge node (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("R1T4E");
    savedFlag = process.env.SCADA_CONG_CHE_DO_ENABLED;
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
  }, 120_000);

  afterAll(async () => {
    if (savedFlag === undefined) delete process.env.SCADA_CONG_CHE_DO_ENABLED;
    else process.env.SCADA_CONG_CHE_DO_ENABLED = savedFlag;
    if (k) await k.sql`DELETE FROM ai_pending_actions WHERE id LIKE ${`${k.DAU}-a2h-%`}`.catch(() => undefined); // A2(h) fixture rows
    await k?.teardown();
  }, 120_000);

  beforeEach(() => {
    rec.alerts.length = 0;
    rec.fallback.length = 0;
  });

  const hitl = () => ({ kind: "hitl" as const, requestedBy: k.u.admin, confirmedBy: k.u.admin });

/**
 * R1b-2b-2a A2(h) — FIXTURE: cổng uỷ quyền (1) nay ràng buộc MỌI lệnh HITL (không actionId ⇒ PRECONDITION_FAILED trừ STOP ghim, TRƯỚC cổng chế độ /
 * chủ edge / kênh). Ca cần tới cổng nó đo gửi kèm MỘT uỷ quyền đúng như nơi tạo của sản phẩm lưu (confirmed, chủ = người xác nhận, băm CHÍNH lệnh ấy).
 * Hàng của fixture mang tiền tố `<DAU>-a2h-` và được dọn ở afterAll (trước teardown của bộ kit).
 */
const A2H_TOOL = "set_machine_param";
async function hitlRangBuoc(inp: { adapterId: number; machineId?: number | null; commandType: string; writes: Array<{ tagKey: string; value: unknown }> }) {
  const { otPayloadHash, withOtPayloadHash } = await import("./otActionBinding");
  const id = `${k.DAU}-a2h-${++seq}`;
  const preview = withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: A2H_TOOL, adapterId: inp.adapterId, machineId: inp.machineId ?? null, commandType: inp.commandType, writes: inp.writes }));
  await k.sql`INSERT INTO ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, "previewJson", status, "idempotencyKey", "expiresAt")
              VALUES (${id}, ${A2H_TOOL}, ${k.sql.json({})}, ${k.u.admin}, 'engineer', 'A2(h) fixture', ${k.sql.json(preview as never)}, 'confirmed', ${`${id}-idem`}, now() + interval '10 minutes')`;
  return { kind: "hitl" as const, actionId: id, tool: A2H_TOOL, requestedBy: k.u.admin, confirmedBy: k.u.admin };
}

  // R1b-2b-2a A2(h) — EXPECTATION CHANGED (coordinator ruling (a)): before, a `stop` with a NON-pin value and NO actionId was routed. Since A2(h),
  // gate (1) binds by default: a non-pinned STOP without an actionId is refused PRECONDITION_FAILED (nothing queued). The case's own subject
  // ("MODE_LOCAL never blocks a STOP routed to the edge") is kept with a correctly BOUND stop: routed, not MODE_LOCAL.
  it("★ edge-owned adapter, machine LOCAL: `stop` with a NON-pin value — NO actionId ⇒ PRECONDITION_FAILED, nothing queued (A2(h)); correctly BOUND ⇒ routed (edgeStopRequest + queued stop row), NOT MODE_LOCAL", async () => {
    const { dispatch } = await import("./commandDispatcher");
    (await import("../edge/edgeNodeCommands")).noteEdgeNodePull(k.ids.nodeA);
    const before = Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${k.ids.adapterA}`)[0].n);
    const u = await dispatch({ adapterId: k.ids.adapterA, commandType: "stop", writes: [{ tagKey: "speed_sp", value: 5 }], triggeredBy: hitl(), idempotencyKey: `r1t4e-stopu-${++seq}-${k.DAU}` });
    expect(u).toMatchObject({ ok: false, status: "rejected", reason: "PRECONDITION_FAILED" });
    expect(u.edgeStopRequest).toBeUndefined();
    expect(Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${k.ids.adapterA}`)[0].n)).toBe(before);
    const lenh = { adapterId: k.ids.adapterA, commandType: "stop", writes: [{ tagKey: "speed_sp", value: 5 }] };
    const r = await dispatch({ ...lenh, triggeredBy: await hitlRangBuoc(lenh), idempotencyKey: `r1t4e-stop-${++seq}-${k.DAU}` });
    expect(r.reason).not.toBe("MODE_LOCAL");
    expect(r).toMatchObject({ reason: "ADAPTER_OWNED_BY_EDGE", edgeStopRequest: { edgeNodeId: k.ids.nodeA } });
    const [row] = await k.sql`SELECT kind, "adapterId", "edgeNodeId" FROM robot_motion_lock_requests WHERE id = ${r.edgeStopRequest!.requestId}`;
    expect(row).toMatchObject({ kind: "stop", adapterId: k.ids.adapterA, edgeNodeId: k.ids.nodeA });
  });

  // R1b-2b-2a A2(h) — the mode gate is measured with a correctly BOUND command (it still blocks); unbound, gate (1) answers first (accepted error order).
  it("edge-owned adapter, machine LOCAL: a NON-stop write (correctly bound) ⇒ MODE_LOCAL: chua_khai, nothing queued; unbound ⇒ PRECONDITION_FAILED first (A2(h))", async () => {
    const { dispatch, perWriteKey } = await import("./commandDispatcher");
    const before = Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${k.ids.adapterA}`)[0].n);
    const u = await dispatch({ adapterId: k.ids.adapterA, commandType: "set_param", writes: [{ tagKey: "speed_sp", value: 5 }], triggeredBy: hitl(), idempotencyKey: `r1t4e-setu-${++seq}-${k.DAU}` });
    expect(u).toMatchObject({ status: "rejected", reason: "PRECONDITION_FAILED" });
    const key = `r1t4e-set-${++seq}-${k.DAU}`;
    const lenh = { adapterId: k.ids.adapterA, commandType: "set_param", writes: [{ tagKey: "speed_sp", value: 5 }] };
    const r = await dispatch({ ...lenh, triggeredBy: await hitlRangBuoc(lenh), idempotencyKey: key });
    expect(r).toMatchObject({ status: "rejected", reason: "MODE_LOCAL" });
    const rows = await k.sql`SELECT "errorText" FROM command_log WHERE "idempotencyKey" = ${perWriteKey(key, "speed_sp", 0)}`; // R1b-2b-2a T6d — khoá v2 không mơ hồ
    expect(rows.map(x => x.errorText)).toEqual(["MODE_LOCAL: chua_khai"]);
    expect(Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${k.ids.adapterA}`)[0].n)).toBe(before);
  });
});
