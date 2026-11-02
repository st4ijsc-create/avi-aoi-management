/**
 * Phạm vi NHÀ MÁY của Command Center — CSDL THẬT, bộ phân giải THẬT (`resolveTenantFactoryScope` strict → `getUserAssignmentCodes`).
 *
 * ⚠ Vì sao cần tệp này: ba tệp đơn vị cùng đề tài (aiAgentPhamVi / aiAgentOrchestrator.phamVi / aiAgentCenterService.phamVi) TIÊM bộ phân giải giả;
 *   không tệp nào chứng minh được rằng người gán nhà máy A thật sự bị `resolveDataScope` + bảng gán + bảng tập đoàn đẩy ra khỏi nhà máy B,
 *   hay rằng truy vấn đọc vai (`users`) chạy được trên postgres.js thật. Lỗi gốc (engineer đọc `goal` của nhà máy khác) chỉ lộ ở tầng này.
 *
 * Luật hiện hành (kiem-dinh N3): test KHÔNG DELETE, KHÔNG owner `aoi`; mọi fixture nằm TRONG MỘT giao dịch bị hoàn tác (`BEGIN` … `ROLLBACK` trên một kết nối riêng) — người dùng,
 * nhà máy, tập đoàn, phiên, hành động đều không bao giờ commit. Dịch vụ đọc qua `getDb`/`getReadDb` được trỏ vào chính giao dịch đó.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const DB_URL = process.env.DATABASE_URL;
const holder: { db: unknown } = { db: null };
vi.mock("../db/connection", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDb: async () => holder.db,
  getReadDb: async () => holder.db,
}));

import { listSessionsForOps } from "./aiAgentOrchestrator";
import { getCommandCenterReadModel } from "./aiAgentCenterService";
import { xoaCachePhamViChu } from "./aiAgentPhamVi";

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`;
const CORP = `PV-C-${RUN}`;
const FAC_A = `PV-FA-${RUN}`;
const FAC_B = `PV-FB-${RUN}`;
const ID: Record<string, number> = {};

/** MỘT kết nối riêng, mở `BEGIN` ở beforeAll và `ROLLBACK` ở afterAll: mọi fixture không bao giờ commit (drizzle không nhận handle `sql.begin` của postgres.js nên không dùng callback). */
let phien: ReturnType<typeof postgres>;

const goal = (k: string) => `GOAL-${k}-${RUN}`;

describe.skipIf(!DB_URL)("Command Center — phạm vi nhà máy trên CSDL thật (giao dịch bị hoàn tác)", () => {
  beforeAll(async () => {
    phien = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    await phien`BEGIN`;
    holder.db = drizzle(phien);
    await phien`INSERT INTO corporates (code, name) VALUES (${CORP}, ${"PV corp " + RUN})`;
    await phien`INSERT INTO factories (code, name, "corporateCode") VALUES (${FAC_A}, 'PV A', ${CORP}), (${FAC_B}, 'PV B', ${CORP})`;
    const mk = async (k: string, role: string) => {
      const [r] = await phien`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`pv-${k}-${RUN}`}, ${`pv-${k}-${RUN}`}, ${k}, ${role}, true) RETURNING id`;
      ID[k] = r.id as number;
    };
    await mk("admin", "admin");
    await mk("engA", "engineer");
    await mk("engB", "engineer");
    await mk("engCorp", "engineer");
    await mk("engNone", "engineer");
    await phien`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ID.engA}, ${FAC_A}), (${ID.engB}, ${FAC_B})`;
    await phien`INSERT INTO user_corporate_assignments ("userId", "corporateCode") VALUES (${ID.engCorp}, ${CORP})`;

    const het = new Date(Date.now() + 3600_000).toISOString();
    for (const k of ["admin", "engA", "engB", "engNone"]) {
      const vai = k === "admin" ? "admin" : "engineer";
      await phien`INSERT INTO ai_agent_sessions (id, "userId", "userRole", goal, status, "expiresAt")
                  VALUES (${`pv-${k}-${RUN}`}, ${ID[k]}, ${vai}, ${goal(k)}, 'running', ${het})`;
      await phien`INSERT INTO ai_specialist_sessions ("userId", objective, status, "requestedAgents") VALUES (${ID[k]}, ${`OBJ-${k}-${RUN}`}, 'running', '["data-analyst"]'::json)`;
      await phien`INSERT INTO ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, status, "idempotencyKey", "expiresAt")
                  VALUES (${`pv-act-${k}-${RUN}`}, 'noop.tool', '{}'::json, ${ID[k]}, ${vai}, ${`SUM-${k}-${RUN}`}, 'proposed', ${`pv-idem-${k}-${RUN}`}, ${het})`;
    }
  }, 120_000);

  afterAll(async () => {
    holder.db = null;
    if (phien) {
      await phien`ROLLBACK`;
      await phien.end({ timeout: 5 });
    }
  }, 60_000);

  beforeEach(() => xoaCachePhamViChu());

  const xem = (k: string, role = "engineer") => ({ id: ID[k], role });
  const mucTieu = async (k: string, role?: string) => (await listSessionsForOps({ limit: 100 }, xem(k, role))).map((s) => s.goal).filter((g) => g.endsWith(RUN)).sort();

  it("★ engineer nhà máy A chỉ thấy goal của chính mình — KHÔNG thấy nhà máy B, admin, chưa gán", async () => {
    expect(await mucTieu("engA")).toEqual([goal("engA")]);
  });
  it("★ engineer nhà máy B chỉ thấy goal của B", async () => {
    expect(await mucTieu("engB")).toEqual([goal("engB")]);
  });
  it("engineer cấp tập đoàn (gán qua user_corporate_assignments) thấy A và B, không thấy admin / chưa gán", async () => {
    expect(await mucTieu("engCorp")).toEqual([goal("engA"), goal("engB")].sort());
  });
  it("★ engineer CHƯA gán nhà máy: 0 goal của người khác", async () => {
    expect(await mucTieu("engNone")).toEqual([goal("engNone")]);
  });
  it("admin thấy tất cả bốn", async () => {
    expect(await mucTieu("admin", "admin")).toEqual(["admin", "engA", "engB", "engNone"].map(goal).sort());
  });

  it("★ read-model đầy đủ: engineer A không thấy chữ nào của B ở sessions · taskFeed (objective · summary)", async () => {
    const m = await getCommandCenterReadModel(xem("engA"));
    const json = JSON.stringify(m);
    for (const k of ["engB", "admin", "engNone"]) {
      expect(json, k).not.toContain(`GOAL-${k}-${RUN}`);
      expect(json, k).not.toContain(`OBJ-${k}-${RUN}`);
      expect(json, k).not.toContain(`SUM-${k}-${RUN}`);
    }
    expect(json).toContain(`OBJ-engA-${RUN}`);
    expect(json).toContain(`SUM-engA-${RUN}`);
  });
  it("read-model: admin thấy chữ của mọi người", async () => {
    const json = JSON.stringify(await getCommandCenterReadModel(xem("admin", "admin"), { limit: 200 }));
    for (const k of ["engA", "engB", "engNone"]) expect(json, k).toContain(`OBJ-${k}-${RUN}`);
  });
});
