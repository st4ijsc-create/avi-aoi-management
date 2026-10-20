/**
 * ★★ Đợt 8.0 — ĐỘNG CƠ LUỒNG AI: chạy bền qua sập tiến trình, không cần Temporal/Redis. Spec §4.4.
 *
 * Mô hình thực thi ĐẨY THEO DỮ LIỆU (như n8n): node chạy khi có item tới cổng vào; node `choDuCong` (gộp) chờ đủ các cổng
 * có nối (hộp nhận `ai_flow_inbox`). Đầu ra rỗng ở một cổng ⇒ node phía sau cổng đó KHÔNG chạy.
 *
 * Một mục hàng (`ai_flow_queue`) = một lần chạy node. Vòng đời:
 *   1. `nhatMuc`     — `FOR UPDATE SKIP LOCKED` + lease (`leaseUntil`), tăng `attempts`.
 *   2. `batDauBuoc`  — ghi bước `dang-chay` và COMMIT TRƯỚC khi chạy (dấu vết "đã bắt đầu" sống qua sập).
 *   3. `thucThi`     — chạy node (I/O ở đây, ngoài giao dịch).
 *   4. `ketThucBuoc` — MỘT giao dịch: bước `xong`/`loi` + đầu ra · xếp node kế · xoá mục hàng · đóng lượt nếu hết việc.
 * Sập giữa 2 và 4 ⇒ lease hết hạn ⇒ worker khác nhặt lại và thấy bước `dang-chay` của lần trước:
 *   • node `idempotent` ⇒ chạy lại với CÙNG `idempotencyKey` (`runId:nodeId:lan`) — đích ngoài tự khử trùng;
 *   • node `atMostOnce` ⇒ KHÔNG chạy lại: bước ⇒ `khong-ro`, lượt ⇒ `loi` (người quyết) — không bao giờ gửi hai lần.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { aiFlowEvents, aiFlowInbox, aiFlowQueue, aiFlowRuns, aiFlowSteps, aiFlowVersions, aiFlows } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { kiemLuong, type FlowDefinition } from "../../../shared/flow/model";
import type { ItemLuong } from "../../../shared/flow/bieuThuc";
import { layNut, type KetQuaChay, type NguCanhChay } from "./dangKyNut";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UU_TIEN_SO: Record<string, number> = { interactive: 0, agent: 1, background: 2 };

export class LoiLuong extends Error {
  constructor(
    public readonly code: "LUONG_KHONG_HOP_LE" | "LUONG_KHONG_CO" | "KHONG_CO_DB",
    message: string,
  ) {
    super(message);
    this.name = "LoiLuong";
  }
}

async function layDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new LoiLuong("KHONG_CO_DB", "không có kết nối CSDL");
  return db;
}

/** Lưu một phiên bản MỚI (bất biến) của luồng sau khi kiểm hợp lệ. Trả số phiên bản. */
export async function luuPhienBan(raw: unknown, userId: number | null): Promise<{ flowId: string; version: number; hang: string }> {
  const kq = kiemLuong(raw, layNut);
  if (!kq.ok) throw new LoiLuong("LUONG_KHONG_HOP_LE", kq.loi.join("; "));
  const def = raw as FlowDefinition;
  const db = await layDb();
  return db.transaction(async (tx) => {
    await tx.insert(aiFlows).values({ id: def.id, name: def.name, ownerId: userId, riskClass: kq.hang }).onConflictDoNothing();
    const [m] = (await tx.execute(sql`SELECT coalesce(max(version), 0)::int AS v FROM ai_flow_versions WHERE "flowId" = ${def.id}`)) as unknown as { v: number }[];
    const version = m.v + 1;
    await tx.insert(aiFlowVersions).values({ flowId: def.id, version, definition: { ...def, version }, riskClass: kq.hang, createdBy: userId });
    await tx.update(aiFlows).set({ name: def.name, riskClass: kq.hang, updatedAt: sql`now()` }).where(eq(aiFlows.id, def.id));
    return { flowId: def.id, version, hang: kq.hang };
  });
}

const boNhoDinhNghia = new Map<string, FlowDefinition>();
async function dinhNghia(db: Db | Tx, flowId: string, version: number): Promise<FlowDefinition> {
  const k = `${flowId}@${version}`;
  const c = boNhoDinhNghia.get(k);
  if (c) return c;
  const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, flowId), eq(aiFlowVersions.version, version)));
  if (!v) throw new LoiLuong("LUONG_KHONG_CO", `không có luồng ${k}`);
  const def = v.definition as FlowDefinition;
  boNhoDinhNghia.set(k, def);
  return def;
}

/** Bắt đầu một lượt chạy: một mục hàng cho mỗi node kích hoạt (hoặc đúng `nutKichHoat`). */
export async function batDauRun(y: {
  flowId: string;
  version: number;
  items?: ItemLuong[];
  nutKichHoat?: string;
  triggerKind?: string;
  idempotencyKey?: string;
}): Promise<string> {
  const db = await layDb();
  const def = await dinhNghia(db, y.flowId, y.version);
  const runId = randomUUID();
  const uuTien = def.settings?.uuTien ?? "background";
  const kichHoat = def.nodes.filter((n) => layNut(n.type)?.laKichHoat && (!y.nutKichHoat || n.id === y.nutKichHoat));
  await db.transaction(async (tx) => {
    await tx.insert(aiFlowRuns).values({
      id: runId, flowId: y.flowId, version: y.version, triggerKind: y.triggerKind ?? "thu-cong", uuTien, idempotencyKey: y.idempotencyKey ?? null,
    });
    for (const n of kichHoat) {
      await tx.insert(aiFlowQueue).values({ runId, nodeId: n.id, lan: 1, inputs: { main: y.items ?? [{ json: {} }] }, uuTien: UU_TIEN_SO[uuTien] ?? 2 });
    }
    await tx.insert(aiFlowEvents).values({ runId, kind: "run.bat-dau", payload: { kichHoat: kichHoat.map((n) => n.id) } });
  });
  return runId;
}

export interface MucHang {
  id: number;
  runId: string;
  nodeId: string;
  lan: number;
  inputs: Record<string, ItemLuong[]>;
  attempts: number;
}

/** (1) Nhặt một mục hàng sẵn sàng; `null` nếu hết việc. */
export async function nhatMuc(workerId: string, leaseMs = 60_000): Promise<MucHang | null> {
  const db = await layDb();
  const rows = (await db.execute(sql`
    UPDATE ai_flow_queue q SET "leaseOwner" = ${workerId}, "leaseUntil" = now() + (${leaseMs}::int * interval '1 millisecond'),
      attempts = q.attempts + 1
     WHERE q.id = (
       SELECT id FROM ai_flow_queue
        WHERE "availableAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
        ORDER BY "uuTien", "availableAt", id
        FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING q.id, q."runId", q."nodeId", q.lan, q.inputs, q.attempts`)) as unknown as MucHang[];
  return rows[0] ?? null;
}

type KetQuaBatDau =
  | { tiep: true; def: FlowDefinition; ngu: NguCanhChay; lanThu: number }
  | { tiep: false; lyDo: string };

/** (2) Kiểm bước trước đó + ghi bước `dang-chay` (commit) — hoặc quyết KHÔNG chạy. */
export async function batDauBuoc(muc: MucHang): Promise<KetQuaBatDau> {
  const db = await layDb();
  const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, muc.runId));
  if (!run || run.status !== "dang-chay") {
    await db.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
    return { tiep: false, lyDo: `lượt ${run?.status ?? "không còn"}` };
  }
  const def = await dinhNghia(db, run.flowId, run.version);
  const nut = def.nodes.find((n) => n.id === muc.nodeId);
  const loai = nut ? layNut(nut.type) : undefined;
  const key = `${muc.runId}:${muc.nodeId}:${muc.lan}`;
  const truoc = await db
    .select()
    .from(aiFlowSteps)
    .where(and(eq(aiFlowSteps.runId, muc.runId), eq(aiFlowSteps.nodeId, muc.nodeId), eq(aiFlowSteps.lan, muc.lan)));
  if (truoc.some((b) => b.status === "xong")) {
    await db.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
    return { tiep: false, lyDo: "bước đã xong" };
  }
  const dangDo = truoc.find((b) => b.status === "dang-chay");
  if (dangDo && loai?.lapLai === "atMostOnce") {
    await db.transaction(async (tx) => {
      await tx.update(aiFlowSteps).set({ status: "khong-ro", finishedAt: sql`now()`, error: { lyDo: "worker dừng giữa lúc chạy node atMostOnce — không chạy lại" } }).where(eq(aiFlowSteps.id, dangDo.id));
      await dongRun(tx, muc.runId, "loi", { lyDo: "khong-ro", nodeId: muc.nodeId, thongDiep: `node ${muc.nodeId} (atMostOnce) có thể đã chạy một phần — cần người kiểm tra` });
    });
    return { tiep: false, lyDo: "atMostOnce bị gián đoạn ⇒ khong-ro" };
  }
  if (dangDo) await db.update(aiFlowSteps).set({ status: "loi", finishedAt: sql`now()`, error: { lyDo: "gián đoạn — chạy lại (idempotent)" } }).where(eq(aiFlowSteps.id, dangDo.id));
  const lanThu = Math.max(muc.attempts, ...truoc.map((b) => b.lanThu + 1));
  await db.insert(aiFlowSteps).values({ runId: muc.runId, nodeId: muc.nodeId, lan: muc.lan, lanThu, status: "dang-chay", idempotencyKey: key, input: muc.inputs });
  const xong = await db
    .select({ nodeId: aiFlowSteps.nodeId, output: aiFlowSteps.output })
    .from(aiFlowSteps)
    .where(and(eq(aiFlowSteps.runId, muc.runId), eq(aiFlowSteps.status, "xong")));
  const nodes: Record<string, ItemLuong[]> = {};
  for (const b of xong) nodes[b.nodeId] = ((b.output as KetQuaChay | null)?.main ?? []) as ItemLuong[];
  return {
    tiep: true,
    def,
    lanThu,
    ngu: {
      runId: muc.runId, flowId: run.flowId, nodeId: muc.nodeId, lan: muc.lan, idempotencyKey: key, inputs: muc.inputs, nodes,
      env: {}, run: { id: muc.runId, flowId: run.flowId, batDau: new Date(run.startedAt).toISOString() },
    },
  };
}

/** (3) Chạy node (node tắt ⇒ cho item `main` đi thẳng). */
export async function thucThi(def: FlowDefinition, ngu: NguCanhChay): Promise<KetQuaChay> {
  const nut = def.nodes.find((n) => n.id === ngu.nodeId)!;
  if (nut.disabled) return { main: ngu.inputs.main ?? [] };
  const loai = layNut(nut.type);
  if (!loai) throw new Error(`loại node '${nut.type}' không còn đăng ký`);
  return loai.chay(nut.parameters ?? {}, ngu);
}

async function dongRun(tx: Tx, runId: string, status: "xong" | "loi" | "huy", error: unknown = null): Promise<void> {
  await tx.update(aiFlowRuns).set({ status, finishedAt: sql`now()`, error: error as object | null }).where(and(eq(aiFlowRuns.id, runId), eq(aiFlowRuns.status, "dang-chay")));
  if (status !== "xong") {
    await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.runId, runId));
    await tx.delete(aiFlowInbox).where(eq(aiFlowInbox.runId, runId));
  }
  await tx.insert(aiFlowEvents).values({ runId, kind: `run.${status}`, payload: error as object | null });
}

async function lanKe(tx: Tx, runId: string, nodeId: string): Promise<number> {
  const [m] = (await tx.execute(sql`
    SELECT greatest(
      (SELECT coalesce(max(lan), 0) FROM ai_flow_steps WHERE "runId" = ${runId} AND "nodeId" = ${nodeId}),
      (SELECT coalesce(max(lan), 0) FROM ai_flow_queue WHERE "runId" = ${runId} AND "nodeId" = ${nodeId}))::int AS m`)) as unknown as { m: number }[];
  return m.m + 1;
}

/** (4) Kết thúc bước: ghi kết quả, xếp node kế, xoá mục hàng, đóng lượt nếu hết việc — MỘT giao dịch. */
export async function ketThucBuoc(
  muc: MucHang,
  def: FlowDefinition,
  lanThu: number,
  kq: { ok: true; ra: KetQuaChay } | { ok: false; loi: unknown },
): Promise<void> {
  const db = await layDb();
  const nut = def.nodes.find((n) => n.id === muc.nodeId)!;
  const uuTien = UU_TIEN_SO[def.settings?.uuTien ?? "background"] ?? 2;
  await db.transaction(async (tx) => {
    const buoc = and(eq(aiFlowSteps.runId, muc.runId), eq(aiFlowSteps.nodeId, muc.nodeId), eq(aiFlowSteps.lan, muc.lan), eq(aiFlowSteps.lanThu, lanThu));
    if (!kq.ok) {
      const thongDiep = String((kq.loi as Error)?.message ?? kq.loi).slice(0, 2000);
      await tx.update(aiFlowSteps).set({ status: "loi", finishedAt: sql`now()`, error: { thongDiep } }).where(buoc);
      const thuToiDa = nut.retry?.max ?? 0;
      if (muc.attempts <= thuToiDa) {
        const lui = (nut.retry?.backoffMs ?? 1000) * 2 ** (muc.attempts - 1);
        await tx.execute(sql`UPDATE ai_flow_queue SET "leaseOwner" = NULL, "leaseUntil" = NULL,
          "availableAt" = now() + (${lui}::int * interval '1 millisecond') WHERE id = ${muc.id}`);
        await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.thu-lai", payload: { nodeId: muc.nodeId, lan: muc.attempts, thongDiep } });
        return;
      }
      await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
      if ((nut.khiLoi ?? "dung") === "dung") {
        await dongRun(tx, muc.runId, "loi", { nodeId: muc.nodeId, thongDiep });
        return;
      }
      kq = { ok: true, ra: { loi: [{ json: { thongDiep, nodeId: muc.nodeId } }] } };
    } else {
      await tx.update(aiFlowSteps).set({ status: "xong", finishedAt: sql`now()`, output: kq.ra }).where(buoc);
      await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
    }
    // Xếp node kế theo cổng có item.
    for (const [cong, items] of Object.entries(kq.ra)) {
      if (!items.length) continue;
      for (const c of def.connections.filter((x) => x.from.node === muc.nodeId && x.from.port === cong)) {
        const dich = def.nodes.find((n) => n.id === c.to.node);
        const loaiDich = dich ? layNut(dich.type) : undefined;
        if (!dich || !loaiDich) continue;
        if (loaiDich.choDuCong && !dich.disabled) {
          await tx.execute(sql`INSERT INTO ai_flow_inbox ("runId", "nodeId", port, items)
            VALUES (${muc.runId}, ${dich.id}, ${c.to.port}, ${JSON.stringify(items)}::jsonb)
            ON CONFLICT ("runId", "nodeId", port) DO UPDATE SET items = ai_flow_inbox.items || EXCLUDED.items`);
          const congCan = [...new Set(def.connections.filter((x) => x.to.node === dich.id).map((x) => x.to.port))];
          const hop = await tx.select().from(aiFlowInbox).where(and(eq(aiFlowInbox.runId, muc.runId), eq(aiFlowInbox.nodeId, dich.id)));
          if (congCan.every((p) => hop.some((h) => h.port === p))) {
            const inputs = Object.fromEntries(hop.map((h) => [h.port, h.items]));
            await tx.insert(aiFlowQueue).values({ runId: muc.runId, nodeId: dich.id, lan: await lanKe(tx, muc.runId, dich.id), inputs, uuTien });
            await tx.delete(aiFlowInbox).where(and(eq(aiFlowInbox.runId, muc.runId), eq(aiFlowInbox.nodeId, dich.id)));
          }
        } else {
          await tx.insert(aiFlowQueue).values({ runId: muc.runId, nodeId: dich.id, lan: await lanKe(tx, muc.runId, dich.id), inputs: { [c.to.port]: items }, uuTien });
        }
      }
    }
    await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.xong", payload: { nodeId: muc.nodeId, lan: muc.lan } });
    // Hết việc ⇒ đóng lượt. (Hộp nhận còn dở = nhánh gộp không bao giờ đủ — đúng ngữ nghĩa: node gộp không chạy.)
    const [con] = (await tx.execute(sql`
      SELECT (SELECT count(*) FROM ai_flow_queue WHERE "runId" = ${muc.runId})::int
           + (SELECT count(*) FROM ai_flow_steps WHERE "runId" = ${muc.runId} AND status = 'dang-chay')::int AS n`)) as unknown as { n: number }[];
    if (con.n === 0) await dongRun(tx, muc.runId, "xong");
  });
}

/** Một vòng worker: nhặt + chạy một mục. `false` nếu hết việc. Không bao giờ ném vì lỗi node. */
export async function chayMotMuc(workerId: string, leaseMs?: number): Promise<boolean> {
  const muc = await nhatMuc(workerId, leaseMs);
  if (!muc) return false;
  const bd = await batDauBuoc(muc);
  if (!bd.tiep) return true;
  let kq: { ok: true; ra: KetQuaChay } | { ok: false; loi: unknown };
  try {
    kq = { ok: true, ra: await thucThi(bd.def, bd.ngu) };
  } catch (e) {
    kq = { ok: false, loi: e };
  }
  await ketThucBuoc(muc, bd.def, bd.lanThu, kq);
  return true;
}
