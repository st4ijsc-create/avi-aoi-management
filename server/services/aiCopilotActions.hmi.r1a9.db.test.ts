/**
 * SCADA R1a Task 9 fix round 1 (minor 5) — hàng `ai_pending_actions` của lệnh HMI (`tool 'hmi.*'`, `scadaCommands`) KHÔNG phải hành động
 * AI: hộp thư AI không liệt kê / không đếm, `listPendingActionsForUser` / `getPendingActionForUser` không trả, `confirmAction` không trả
 * kết quả cache và không đổi trạng thái (kể cả lật 'expired'), `cancelAction` không huỷ được (sẽ đè một hàng 'confirmed' đang dispatch).
 * Đối chứng: một hàng AI thường của CÙNG người vẫn hiện (bộ lọc không nuốt hết). CSDL `_test` THẬT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiPendingActions } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { cancelAction, confirmAction, getPendingActionForUser, laLenhHmi, listPendingActionsForUser } from "./aiCopilotActions";
import { countInbox, listInbox } from "./aiActionInbox";
import { getCommandCenterReadModel } from "./aiAgentCenterService";

const RUN = `r1a9ai${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
let user!: { id: number; role: string; name: string | null };
const ids = { hmi: crypto.randomUUID(), hmiHet: crypto.randomUUID(), hmiCho: crypto.randomUUID(), ai: crypto.randomUUID() };

async function chen(id: string, tool: string, status: "proposed" | "confirmed", expiresAt: Date) {
  await db.insert(aiPendingActions).values({
    id,
    tool,
    argsJson: { adapterId: 1, machineId: null, tagKey: "x", value: 1, commandType: "write_tag" },
    userId: user.id,
    userRole: user.role,
    summary: `${RUN} ${tool}`,
    status,
    idempotencyKey: `${RUN}:${id}`,
    expiresAt,
  });
}
const trangThai = async (id: string) => (await db.select({ s: aiPendingActions.status }).from(aiPendingActions).where(eq(aiPendingActions.id, id)))[0]?.s;

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  const u = await taoNguoiDungTest("ai", "operator", { tienTo: "r1a9ai", ts: RUN });
  user = { id: u.id, role: "operator", name: u.name };
  const sau = new Date(Date.now() + 60_000);
  await chen(ids.hmi, "hmi.write_tag", "proposed", sau);
  await chen(ids.hmiHet, "hmi.write_tag", "proposed", new Date(Date.now() - 60_000));
  await chen(ids.hmiCho, "hmi.write_tag", "confirmed", sau);
  await chen(ids.ai, `${RUN}_ai_tool`, "proposed", sau);
});

afterAll(async () => {
  if (db) await db.delete(aiPendingActions).where(inArray(aiPendingActions.id, Object.values(ids)));
});

describe("lệnh HMI không đi qua các đường AI", () => {
  it("laLenhHmi: chỉ tiền tố 'hmi.'", () => {
    expect(laLenhHmi("hmi.write_tag")).toBe(true);
    expect(laLenhHmi("hmi.")).toBe(true);
    expect(laLenhHmi("set_machine_param")).toBe(false);
    expect(laLenhHmi("xhmi.write_tag")).toBe(false);
    expect(laLenhHmi(null)).toBe(false);
  });

  it("hộp thư AI: listInbox không có đề xuất HMI, có đề xuất AI; countInbox chỉ đếm hàng AI", async () => {
    const { items } = await listInbox(user);
    const proposalIds = items.filter((i) => i.type === "proposal").map((i) => i.id);
    expect(proposalIds).toContain(ids.ai);
    expect(proposalIds).not.toContain(ids.hmi);
    expect((await countInbox(user)).count).toBe(1);
  });

  it("listPendingActionsForUser / getPendingActionForUser bỏ qua hàng HMI", async () => {
    const ds = (await listPendingActionsForUser(user.id)).map((x) => x.actionId);
    expect(ds).toContain(ids.ai);
    expect(ds).not.toContain(ids.hmi);
    expect(await getPendingActionForUser(user.id, ids.hmi)).toBeNull();
    expect(await getPendingActionForUser(user.id, ids.ai)).not.toBeNull();
  });

  it("confirmAction trên hàng HMI ⇒ not_found, không cache-ok, không đổi trạng thái (kể cả hàng quá hạn không bị lật 'expired')", async () => {
    for (const id of [ids.hmi, ids.hmiHet, ids.hmiCho]) {
      const truoc = await trangThai(id);
      const kq = await confirmAction(id, id, user, "vi");
      expect(kq).toMatchObject({ ok: false, status: "not_found" });
      expect(await trangThai(id)).toBe(truoc);
    }
  });

  it("fix round 2 — Agent Center taskFeed không có hàng HMI, có hàng AI", async () => {
    const { taskFeed } = await getCommandCenterReadModel({ limit: 200 });
    const feedIds = taskFeed.map((t) => t.id);
    expect(feedIds).toContain(`action:${ids.ai}`);
    for (const id of [ids.hmi, ids.hmiHet, ids.hmiCho]) expect(feedIds).not.toContain(`action:${id}`);
  });

  it("cancelAction trên hàng HMI (proposed hay confirmed đang gửi) ⇒ not_found, trạng thái giữ nguyên", async () => {
    for (const id of [ids.hmi, ids.hmiCho]) {
      const truoc = await trangThai(id);
      const kq = await cancelAction(id, user);
      expect(kq).toMatchObject({ ok: false, status: "not_found" });
      expect(await trangThai(id)).toBe(truoc);
    }
  });
});
