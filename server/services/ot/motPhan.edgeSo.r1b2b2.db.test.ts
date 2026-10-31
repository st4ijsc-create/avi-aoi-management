/**
 * SCADA R1b-2b-2a T3E fix 1 (review I-1) — DB THẬT (`_test`): lô do EDGE phục vụ mà thiết bị áp MỘT PHẦN ⇒ hàng command_log trung tâm ghi từ bản ghi
 * sổ edge (`applyLedger`, đường thật reportForNode → applyStream → applyLedger) mang tiền tố mã `MOT_PHAN:` như đường trung tâm ⇒ sổ lệnh
 * (`commandLog.list/get` = `cheHangLenh`, `nhatKy.reasonCode` = `maLoiCua`) nói "một phần" cho MỌI người xem; danh sách item vẫn che (C1).
 * Đối chứng: edge cũ (không `result.motPhan`) ⇒ như trước (errorText null ⇒ không mã MOT_PHAN).
 *
 * Mọi ghi DB (nút edge, credential, workflow / run, adapter, uỷ quyền, command_log) nằm trong giao dịch ROLLBACK của chính test; getDb ngoài giao
 * dịch là BẪY (đếm, phải 0). Không id tường minh.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const H = vi.hoisted(() => ({ tx: null as unknown, bay: 0 }));
vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...real,
    getDb: (async () => {
      if (H.tx) return H.tx;
      H.bay++;
      return null;
    }) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});

import * as conn from "../../db/connection";
import { commandLog } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { applyLedger } from "../edge/edgeReportsCentral";
import { cheHangLenh } from "../../routers/commandLogRouter";
import { maLoiCua } from "../../routers/_chiTietKyThuat";
import { MA_MOT_PHAN } from "./motPhan";

const DB_URL = process.env.DATABASE_URL ?? "";
const DAU = `T3EF1-${Date.now()}`;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;
const hex64 = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}
const one = async (tx: Tx, q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as unknown as Array<{ id: number }>)[0]!.id);

/** Nút edge + credential + run + adapter do nút sở hữu + uỷ quyền (jti) cho bước o1 — đúng các hàng applyLedger kiểm. */
async function dung(tx: Tx) {
  const nodeId = await one(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`N-${DAU}-${randomUUID().slice(0, 6)}`}, 't3e node', 'online') RETURNING id`);
  const credId = await one(tx, sql`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${nodeId}, ${`edn_${hex64().slice(0, 12)}`}, ${hex64()}) RETURNING id`);
  const ref = `${DAU}-wf-${randomUUID().slice(0, 6)}`;
  const wfId = await one(tx, sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey", version) VALUES (${ref}, ${ref}, ${JSON.stringify({ ref, name: ref, steps: [] })}::jsonb, 'active', 'global', 1) RETURNING id`);
  const runId = await one(tx, sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "paramsJson", "contextJson", "startedBy") VALUES (${wfId}, ${ref}, 'queued', '{}'::jsonb, '{}'::jsonb, 990904001) RETURNING id`);
  const adapterId = await one(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "edgeNodeId") VALUES (${`A-${DAU}-${randomUUID().slice(0, 6)}`}, 't3e adapter', 'stub', 'stub://t3e', true, ${nodeId}) RETURNING id`);
  // a CURRENT claim 1 of the node (trigger of 0372): assignment inserted unclaimed (identity write-once), then claimed
  await tx.execute(sql`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${runId}, ${nodeId}, ${wfId}, 1, ${hex64()}, 990904001)`);
  await tx.execute(sql`UPDATE orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${hex64()}, "claimedByCredentialId" = ${credId}, "claimedAt" = now() WHERE "runId" = ${runId}`);
  const jti = randomUUID();
  await tx.execute(sql`INSERT INTO edge_step_authorizations (jti, "edgeNodeId", "credentialId", "runId", "claimSeq", "stepId", attempt, "idempotencyKey", kind, "payloadHash", "approvalJson", "verdictJson", kid, "reqNonceHash", "expiresAt")
    VALUES (${jti}, ${nodeId}, ${credId}, ${runId}, 1, 'o1', 1, ${`run${runId}-o1-a1`}, 'ot', ${`sha256:${hex64()}`}, ${JSON.stringify({ approvedBy: 990904002 })}::jsonb, ${JSON.stringify({ target: { adapterId } })}::jsonb, ${"edk_" + "A".repeat(22)}, ${hex64()}, now() + interval '30 seconds')`);
  const node = { credentialId: credId, nodeId, nodeCode: `N-${DAU}`, factoryCode: null };
  return { node, runId, adapterId, jti };
}

const ledger = (f: Awaited<ReturnType<typeof dung>>, result: Record<string, unknown>) => ({
  kind: "ledger" as const,
  seq: 1,
  stepId: "o1",
  attempt: 1,
  idempotencyKey: `run${f.runId}-o1-a1`,
  jti: f.jti,
  stop: false,
  target: { adapterId: f.adapterId, commandType: "set_speed" },
  status: "failed",
  result,
  at: Date.now(),
});
const KET_QUA = [
  { tagKey: "speed", ok: true, status: "acked" },
  { tagKey: "speed2", ok: false, status: "failed", error: "bad status: BadNotWritable" },
];

beforeEach(() => {
  H.bay = 0;
});

describe.skipIf(!/_test\b/.test(DB_URL))("T3E fix 1 — lô edge áp một phần: hàng command_log trung tâm mang MOT_PHAN (DB thật, giao dịch ROLLBACK)", () => {
  it("★ bản ghi sổ edge có result.motPhan ⇒ errorText `MOT_PHAN: …`; sổ lệnh (list/get + nhatKy) hiện mã MOT_PHAN cho người bị che, danh sách chỉ trong ackValue (che)", async () => {
    await trongGiaoDich(async (tx) => {
      const f = await dung(tx);
      const audits: unknown[] = [];
      await applyLedger(tx as never, f.node, f.runId, 1, 990904001, ledger(f, { reason: MA_MOT_PHAN, pinnedStop: false, results: KET_QUA, motPhan: { daAp: ["speed"], khongAp: ["speed2"] } }) as never, audits as never, (jti) => ({ jti }), new Map());
      const [row] = await tx.select().from(commandLog).where(eq(commandLog.idempotencyKey, `edge:${f.jti}`));
      expect(row).toBeDefined();
      expect(row!.status).toBe("failed");
      expect(row!.errorText).toMatch(/^MOT_PHAN: the edge reported the batch was applied only partly \(applied: speed; not applied: speed2\)/);
      expect((row!.ackValue as { motPhan?: unknown }).motPhan).toEqual({ daAp: ["speed"], khongAp: ["speed2"] });
      // commandLog.list / get (cheHangLenh) — người KHÔNG được xem chi tiết: mã có, văn bản + ackValue che
      const che = cheHangLenh(row!, false);
      expect(che).toMatchObject({ maLoi: "MOT_PHAN", errorText: null, ackValue: null, loiBiChe: true });
      expect(cheHangLenh(row!, true)).toMatchObject({ maLoi: "MOT_PHAN", errorText: row!.errorText });
      // commandLog.nhatKy — reasonCode của hàng lệnh = maLoiCua(errorText, status)
      expect(maLoiCua(row!.errorText, row!.status)).toBe("MOT_PHAN");
      expect(audits).toEqual([]);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("đối chứng: edge cũ (không result.motPhan, chỉ results theo item) ⇒ như trước: errorText null, không mã MOT_PHAN", async () => {
    await trongGiaoDich(async (tx) => {
      const f = await dung(tx);
      await applyLedger(tx as never, f.node, f.runId, 1, 990904001, ledger(f, { reason: null, pinnedStop: false, results: KET_QUA }) as never, [] as never, (jti) => ({ jti }), new Map());
      const [row] = await tx.select().from(commandLog).where(eq(commandLog.idempotencyKey, `edge:${f.jti}`));
      expect(row!.status).toBe("failed");
      expect(row!.errorText).toBeNull();
      expect(cheHangLenh(row!, false).maLoi).toBeNull();
    });
    expect(H.bay).toBe(0);
  }, 30_000);
});
