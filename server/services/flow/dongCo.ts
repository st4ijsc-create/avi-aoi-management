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
import { and, eq, inArray, sql } from "drizzle-orm";
import { aiFlowEvents, aiFlowInbox, aiFlowQueue, aiFlowRuns, aiFlowSteps, aiFlowVersions, aiFlows } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { THU_TU_HANG, kiemLuong, type FlowDefinition, type HangTacDungPhu } from "../../../shared/flow/model";
import type { ItemLuong } from "../../../shared/flow/bieuThuc";
import { layNut, type KetQuaChay, type NguCanhChay, type VetModel, type YeuCauCho } from "./dangKyNut";
import { LoiBiMat, bienTheBiMat, cheBiMat, cheSau, giaiMaChoChay } from "./biMat";
import { ghimLuongCon, hangLuongConGhim, thamChieuTho } from "./ghimLuongCon";
import "./nut";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UU_TIEN_SO: Record<string, number> = { interactive: 0, agent: 1, background: 2 };

export class LoiLuong extends Error {
  constructor(
    public readonly code: "LUONG_KHONG_HOP_LE" | "LUONG_KHONG_CO" | "KHONG_CO_DB" | "LOAI_NODE_MAT",
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

/**
 * Đợt 8.4 — hạng PHIÊN BẢN HOẠT ĐỘNG của các luồng con (`null` = không tồn tại / chưa có phiên bản hoạt động). Dùng cho
 * `kiemLuong(..., { hangLuongCon })` khi lưu và khi tạo bản nháp từ mô tả.
 */
export async function hangLuongConTuDb(ids: readonly string[]): Promise<Map<string, HangTacDungPhu | null>> {
  const ra = new Map<string, HangTacDungPhu | null>(ids.map((id) => [id, null]));
  if (!ids.length) return ra;
  const db = await layDb();
  const rows = (await db.execute(sql`SELECT f.id, v."riskClass" AS hang FROM ai_flows f
      JOIN ai_flow_versions v ON v."flowId" = f.id AND v.version = f."activeVersion"
     WHERE f.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)) as unknown as { id: string; hang: HangTacDungPhu }[];
  for (const r of rows) ra.set(r.id, r.hang);
  return ra;
}

/** `kiemLuong` với hạng luồng con đọc từ CSDL (đường của máy chủ — lưu phiên bản, mô tả → luồng). */
export async function kiemLuongDayDu(raw: unknown): Promise<ReturnType<typeof kiemLuong>> {
  // H1: hạng của luồng con tính trên ĐÚNG phiên bản ghim (xem ghimLuongCon.ts).
  return kiemLuong(raw, layNut, { hangLuongCon: await hangLuongConGhim(thamChieuTho(raw)) });
}

/** Lưu một phiên bản MỚI (bất biến) của luồng sau khi kiểm hợp lệ. Trả số phiên bản. */
export async function luuPhienBan(rawGoc: unknown, userId: number | null, factoryId: number | null = null): Promise<{ flowId: string; version: number; hang: string }> {
  const raw = await ghimLuongCon(rawGoc); // H1: tham chiếu luồng con thiếu `version` được GHIM = phiên bản hoạt động hiện tại
  const kq = await kiemLuongDayDu(raw);
  if (!kq.ok) throw new LoiLuong("LUONG_KHONG_HOP_LE", kq.loi.join("; "));
  const def = raw as FlowDefinition;
  const db = await layDb();
  return db.transaction(async (tx) => {
    await tx.insert(aiFlows).values({ id: def.id, name: def.name, ownerId: userId, riskClass: kq.hang, factoryId }).onConflictDoNothing();
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

interface YeuCauRun {
  flowId: string;
  version: number;
  items?: ItemLuong[];
  nutKichHoat?: string;
  triggerKind?: string;
  idempotencyKey?: string;
  /** Đợt 8.4 — lượt cha (luồng con). */
  parentRunId?: string;
  /**
   * Đợt 9 — CHỦ LƯỢT (phạm vi dữ liệu tính theo người này lúc chạy). Vắng ⇒ suy: chủ của lượt cha (luồng con) → NGƯỜI BẬT phiên bản
   * (`approvedBy`; dữ liệu cũ chưa lưu người bật ⇒ `createdBy`, chỉ là dự phòng) ⇒ không ai ⇒ NULL ⇒ node tài nguyên từ chối.
   * Chạy tay truyền NGƯỜI BẤM.
   */
  chuLuong?: number | null;
}

/** Chủ lượt cho một lượt mới (xem `YeuCauRun.chuLuong`). */
async function suyChuLuong(tx: Db | Tx, y: YeuCauRun): Promise<number | null> {
  if (y.chuLuong !== undefined) return y.chuLuong;
  if (y.parentRunId) {
    const [cha] = await tx.select({ chuLuong: aiFlowRuns.chuLuong }).from(aiFlowRuns).where(eq(aiFlowRuns.id, y.parentRunId));
    return cha?.chuLuong ?? null;
  }
  const [v] = await tx
    .select({ approvedBy: aiFlowVersions.approvedBy, createdBy: aiFlowVersions.createdBy })
    .from(aiFlowVersions)
    .where(and(eq(aiFlowVersions.flowId, y.flowId), eq(aiFlowVersions.version, y.version)));
  return v?.approvedBy ?? v?.createdBy ?? null;
}

/** Tạo lượt + mục hàng của node kích hoạt TRONG một giao dịch có sẵn. */
async function taoRunTx(tx: Db | Tx, y: YeuCauRun): Promise<string> {
  const def = await dinhNghia(tx, y.flowId, y.version);
  const runId = randomUUID();
  const uuTien = def.settings?.uuTien ?? "background";
  const kichHoat = def.nodes.filter((n) => layNut(n.type)?.laKichHoat && (!y.nutKichHoat || n.id === y.nutKichHoat));
  await tx.insert(aiFlowRuns).values({
    id: runId, flowId: y.flowId, version: y.version, triggerKind: y.triggerKind ?? "thu-cong", uuTien, idempotencyKey: y.idempotencyKey ?? null,
    parentRunId: y.parentRunId ?? null, chuLuong: await suyChuLuong(tx, y),
  });
  for (const n of kichHoat) {
    await tx.insert(aiFlowQueue).values({ runId, nodeId: n.id, lan: 1, inputs: { main: y.items ?? [{ json: {} }] }, uuTien: UU_TIEN_SO[uuTien] ?? 2 });
  }
  await tx.insert(aiFlowEvents).values({ runId, kind: "run.bat-dau", payload: { kichHoat: kichHoat.map((n) => n.id), ...(y.parentRunId ? { parentRunId: y.parentRunId } : {}) } });
  return runId;
}

/** Bắt đầu một lượt chạy: một mục hàng cho mỗi node kích hoạt (hoặc đúng `nutKichHoat`). */
export async function batDauRun(y: YeuCauRun): Promise<string> {
  const db = await layDb();
  await dinhNghia(db, y.flowId, y.version);
  return db.transaction((tx) => taoRunTx(tx, y));
}

export interface MucHang {
  id: number;
  runId: string;
  nodeId: string;
  lan: number;
  inputs: Record<string, ItemLuong[]>;
  attempts: number;
}

/**
 * (1) Nhặt một mục hàng sẵn sàng; `null` nếu hết việc. `tienToFlow` (tuỳ chọn): chỉ nhặt mục của luồng có id bắt đầu bằng
 * tiền tố này — nhóm worker riêng cho một họ luồng, và cách lưới song song không giành mục của nhau.
 */
export async function nhatMuc(workerId: string, leaseMs = 60_000, tienToFlow?: string, chiRun?: string): Promise<MucHang | null> {
  const db = await layDb();
  const loc = chiRun
    ? sql`AND "runId" = ${chiRun}`
    : tienToFlow
      ? sql`AND "runId" IN (SELECT id FROM ai_flow_runs WHERE "flowId" LIKE ${tienToFlow.replace(/[\\%_]/g, (c) => "\\" + c) + "%"})`
      : sql``;
  const rows = (await db.execute(sql`
    UPDATE ai_flow_queue q SET "leaseOwner" = ${workerId}, "leaseUntil" = now() + (${leaseMs}::int * interval '1 millisecond'),
      attempts = q.attempts + 1
     WHERE q.id = (
       SELECT id FROM ai_flow_queue
        WHERE "availableAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now()) ${loc}
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
  // Lượt đang CHỜ (duyệt) vẫn chạy tiếp các nhánh khác.
  if (!run || (run.status !== "dang-chay" && run.status !== "cho-duyet")) {
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
      env: {}, run: { id: muc.runId, flowId: run.flowId, batDau: new Date(run.startedAt).toISOString() }, version: run.version,
      // Đợt 9 (IDOR) — phạm vi tính lại LÚC CHẠY từ người dùng hiện tại; không chủ / bị khoá / xoá / mất quyền ⇒ vắng ⇒ node tài nguyên từ chối.
      kiemPhamVi: (await (await import("./boKiemPhamVi")).boKiemChoChuLuong(run.chuLuong)) ?? undefined,
    },
  };
}

/**
 * Đợt 8.2 — biến thể (dạng có thể rò) của bí mật đã giải cho từng bước, theo khoá bước `runId:nodeId:lan`. `thucThi` ghi,
 * `ketThucBuoc` đọc + xoá để CHE lỗi/đầu ra trước khi ghi CSDL. Chỉ trong bộ nhớ; trần kích thước chống phình.
 */
const bienTheTheoBuoc = new Map<string, string[]>();
function ghiBienThe(key: string, ds: string[]): void {
  if (bienTheTheoBuoc.size > 2000) bienTheTheoBuoc.clear();
  bienTheTheoBuoc.set(key, ds);
}

/** Che một thông điệp lỗi theo các biến thể bí mật (rỗng ⇒ nguyên văn). */
export function cheThongDiepLoi(loi: unknown, bienThe: readonly string[]): string {
  return cheBiMat(String((loi as Error)?.message ?? loi), bienThe).slice(0, 2000);
}

/**
 * (3) Chạy node (node tắt ⇒ cho item `main` đi thẳng). Node có `credentialRef` (loại khai `nhanBiMat`) ⇒ giải mã NGAY ĐÂY và
 * gắn vào ô `ngu.biMat` KHÔNG liệt kê được; lỗi/đầu ra của node được che trước khi rời hàm.
 */
export async function thucThi(def: FlowDefinition, ngu: NguCanhChay): Promise<KetQuaChay | YeuCauCho> {
  const nut = def.nodes.find((n) => n.id === ngu.nodeId)!;
  if (nut.disabled) return { main: ngu.inputs.main ?? [] };
  const loai = layNut(nut.type);
  if (!loai) throw new LoiLuong("LOAI_NODE_MAT", `loại node '${nut.type}' không còn đăng ký`);
  if (!nut.credentialRef) return loai.chay(nut.parameters ?? {}, ngu);
  if (!loai.nhanBiMat) throw new LoiLuong("LUONG_KHONG_HOP_LE", `loại node '${nut.type}' không nhận bí mật`);
  // Đợt 9 (IDOR) — bí mật phải thuộc phạm vi CHỦ LƯỢT (NULL = toàn hệ thống ⇒ chỉ admin). Vắng bộ kiểm / ngoài phạm vi ⇒ cùng câu với
  // "không có bí mật" (LoiBiMat KHONG_CO) — không lộ tồn tại, và KHÔNG giải mã.
  if (!ngu.kiemPhamVi || !(await ngu.kiemPhamVi.biMat(nut.credentialRef))) throw new LoiBiMat("KHONG_CO", `không có bí mật '${nut.credentialRef}'`);
  const bm = await giaiMaChoChay(nut.credentialRef);
  const bienThe = bienTheBiMat(bm.giaTri, bm.loai);
  ghiBienThe(ngu.idempotencyKey, bienThe);
  const nguBm: NguCanhChay = { ...ngu };
  Object.defineProperty(nguBm, "biMat", { value: Object.freeze({ giaTri: bm.giaTri, loai: bm.loai }), enumerable: false });
  try {
    return cheSau(await loai.chay(nut.parameters ?? {}, nguBm), bienThe);
  } catch (e) {
    const che = new Error(cheThongDiepLoi(e, bienThe));
    che.name = (e as Error)?.name ?? "Error";
    throw che;
  }
}

async function dongRun(tx: Tx, runId: string, status: "xong" | "loi" | "huy", error: unknown = null): Promise<void> {
  const dong = await tx
    .update(aiFlowRuns)
    .set({ status, finishedAt: sql`now()`, error: error as object | null })
    .where(and(eq(aiFlowRuns.id, runId), inArray(aiFlowRuns.status, ["dang-chay", "cho-duyet"])))
    .returning({ flowId: aiFlowRuns.flowId, version: aiFlowRuns.version, parentRunId: aiFlowRuns.parentRunId });
  if (status !== "xong") {
    await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.runId, runId));
    await tx.delete(aiFlowInbox).where(eq(aiFlowInbox.runId, runId));
    await tx.execute(sql`DELETE FROM ai_flow_waits WHERE "runId" = ${runId}`);
  }
  await tx.insert(aiFlowEvents).values({ runId, kind: `run.${status}`, payload: error as object | null });
  if (!dong.length) return; // đã đóng từ trước — không báo cha / huỷ con lần hai
  // Đợt 8.4 — lượt cha lỗi/huỷ ⇒ huỷ các lượt CON còn chạy (con không mồ côi chạy tiếp vô chủ).
  if (status !== "xong") {
    const con = await tx
      .select({ id: aiFlowRuns.id })
      .from(aiFlowRuns)
      .where(and(eq(aiFlowRuns.parentRunId, runId), inArray(aiFlowRuns.status, ["dang-chay", "cho-duyet"])));
    for (const c of con) await dongRun(tx, c.id, "huy", { lyDo: "lượt cha kết thúc", parentRunId: runId });
  }
  // Đợt 8.4 — lượt CON đóng ⇒ trả lời hàng chờ `luong-con` của cha (nếu cha còn chờ) trong CÙNG giao dịch.
  if (dong[0].parentRunId) await baoChaKhiConDong(tx, dong[0].parentRunId, runId, { flowId: dong[0].flowId, version: dong[0].version }, status, error);
}

/**
 * Đầu ra "node cuối" của một lượt: item `main` của các node KHÔNG có cạnh ra đã chạy xong (theo thứ tự bước); không có ⇒
 * `main` của bước xong cuối cùng. Dùng cho luồng con, tool agent, MCP.
 */
export async function dauRaNodeCuoi(tx: Db | Tx, runId: string, def: FlowDefinition): Promise<ItemLuong[]> {
  const coRa = new Set(def.connections.map((c) => c.from.node));
  const buoc = await tx
    .select({ nodeId: aiFlowSteps.nodeId, output: aiFlowSteps.output })
    .from(aiFlowSteps)
    .where(and(eq(aiFlowSteps.runId, runId), eq(aiFlowSteps.status, "xong")))
    .orderBy(aiFlowSteps.id);
  const main = (o: unknown) => ((o as KetQuaChay | null)?.main ?? []) as ItemLuong[];
  const cuoi = buoc.filter((b) => !coRa.has(b.nodeId)).flatMap((b) => main(b.output));
  if (cuoi.length) return cuoi;
  return buoc.length ? main(buoc[buoc.length - 1].output) : [];
}

/** Con đóng ⇒ cha (đang chờ ở node có hàng chờ `luong-con` trỏ tới con này) đi tiếp / lỗi. */
async function baoChaKhiConDong(
  tx: Tx,
  chaId: string,
  conId: string,
  con: { flowId: string; version: number },
  status: "xong" | "loi" | "huy",
  error: unknown,
): Promise<void> {
  const rows = (await tx.execute(sql`SELECT "nodeId" FROM ai_flow_waits
      WHERE "runId" = ${chaId} AND kind = 'luong-con' AND payload->>'runCon' = ${conId} FOR UPDATE`)) as unknown as { nodeId: string }[];
  if (!rows.length) return;
  const nodeId = rows[0].nodeId;
  if (status === "xong") {
    const defCon = await dinhNghia(tx, con.flowId, con.version);
    const items = await dauRaNodeCuoi(tx, conId, defCon);
    await traLoiChoTx(tx, { runId: chaId, nodeId, cong: "main", itemsThay: items.length ? items : [{ json: {} }] });
    return;
  }
  const e = error as { thongDiep?: unknown; lyDo?: unknown } | null;
  const thongDiep = `luồng con ${con.flowId}@${con.version} ${status === "huy" ? "bị huỷ" : "lỗi"}: ${String(e?.thongDiep ?? e?.lyDo ?? "").slice(0, 500)}`;
  await traLoiChoTx(tx, { runId: chaId, nodeId, cong: "main", loi: thongDiep });
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
  kq: { ok: true; ra: KetQuaChay | YeuCauCho } | { ok: false; loi: unknown },
): Promise<void> {
  const db = await layDb();
  const nut = def.nodes.find((n) => n.id === muc.nodeId)!;
  const uuTien = UU_TIEN_SO[def.settings?.uuTien ?? "background"] ?? 2;
  // Đợt 8.2: biến thể bí mật của bước này (nếu node đã giải mã một bí mật) — che MỌI thứ sắp ghi.
  const keyBuoc = `${muc.runId}:${muc.nodeId}:${muc.lan}`;
  const bienThe = bienTheTheoBuoc.get(keyBuoc) ?? [];
  bienTheTheoBuoc.delete(keyBuoc);
  if (kq.ok && bienThe.length) kq = { ok: true, ra: cheSau(kq.ra, bienThe) };
  await db.transaction(async (tx) => {
    const buoc = and(eq(aiFlowSteps.runId, muc.runId), eq(aiFlowSteps.nodeId, muc.nodeId), eq(aiFlowSteps.lan, muc.lan), eq(aiFlowSteps.lanThu, lanThu));
    let ra: KetQuaChay;
    if (kq.ok && "__cho" in kq.ra) {
      // Node xin CHỜ: bước giữ `dang-chay` (dấu "đã bắt đầu" + chặn đóng lượt), mục hàng xong việc.
      await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
      await batDauCho(tx, muc.runId, muc.nodeId, (kq.ra as YeuCauCho).__cho, muc.lan);
      await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.cho", payload: { nodeId: muc.nodeId, lan: muc.lan } });
      return;
    }
    if (!kq.ok) {
      const thongDiep = cheThongDiepLoi(kq.loi, bienThe);
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
      ra = { loi: [{ json: { thongDiep, nodeId: muc.nodeId } }] };
    } else {
      ra = kq.ra as KetQuaChay;
      await tx.update(aiFlowSteps).set({ status: "xong", finishedAt: sql`now()`, output: ra }).where(buoc);
      await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
    }
    await xepNodeKe(tx, def, muc.runId, muc.nodeId, ra, uuTien);
    await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.xong", payload: { nodeId: muc.nodeId, lan: muc.lan } });
    await dongNeuHetViec(tx, muc.runId);
  });
}

/** Xếp node kế cho các cổng có item (node gộp: qua hộp nhận, đủ cổng mới thành mục hàng). */
async function xepNodeKe(tx: Tx, def: FlowDefinition, runId: string, nodeId: string, ra: KetQuaChay, uuTien: number): Promise<void> {
  for (const [cong, items] of Object.entries(ra)) {
    if (!items.length) continue;
    for (const c of def.connections.filter((x) => x.from.node === nodeId && x.from.port === cong)) {
      const dich = def.nodes.find((n) => n.id === c.to.node);
      const loaiDich = dich ? layNut(dich.type) : undefined;
      if (!dich || !loaiDich) continue;
      if (loaiDich.choDuCong && !dich.disabled) {
        await tx.execute(sql`INSERT INTO ai_flow_inbox ("runId", "nodeId", port, items)
          VALUES (${runId}, ${dich.id}, ${c.to.port}, ${JSON.stringify(items)}::jsonb)
          ON CONFLICT ("runId", "nodeId", port) DO UPDATE SET items = ai_flow_inbox.items || EXCLUDED.items`);
        const congCan = [...new Set(def.connections.filter((x) => x.to.node === dich.id).map((x) => x.to.port))];
        const hop = await tx.select().from(aiFlowInbox).where(and(eq(aiFlowInbox.runId, runId), eq(aiFlowInbox.nodeId, dich.id)));
        if (congCan.every((p) => hop.some((h) => h.port === p))) {
          const inputs = Object.fromEntries(hop.map((h) => [h.port, h.items]));
          await tx.insert(aiFlowQueue).values({ runId, nodeId: dich.id, lan: await lanKe(tx, runId, dich.id), inputs, uuTien });
          await tx.delete(aiFlowInbox).where(and(eq(aiFlowInbox.runId, runId), eq(aiFlowInbox.nodeId, dich.id)));
        }
      } else {
        await tx.insert(aiFlowQueue).values({ runId, nodeId: dich.id, lan: await lanKe(tx, runId, dich.id), inputs: { [c.to.port]: items }, uuTien });
      }
    }
  }
}

/** Hết việc (không mục hàng, không bước đang chạy/chờ) ⇒ đóng lượt. Hộp nhận dở = nhánh gộp không đủ ⇒ node gộp không chạy. */
async function dongNeuHetViec(tx: Tx, runId: string): Promise<void> {
  const [con] = (await tx.execute(sql`
    SELECT (SELECT count(*) FROM ai_flow_queue WHERE "runId" = ${runId})::int
         + (SELECT count(*) FROM ai_flow_steps WHERE "runId" = ${runId} AND status = 'dang-chay')::int AS n`)) as unknown as { n: number }[];
  if (con.n === 0) await dongRun(tx, runId, "xong");
}

/** Node xin CHỜ (duyệt người / webhook / thời gian): lượt ⇒ `cho-duyet`, ghi `ai_flow_waits` (giữ item để trả lời sau). */
async function batDauCho(tx: Tx, runId: string, nodeId: string, cho: YeuCauCho["__cho"], lan = 1): Promise<void> {
  const hetHan = cho.hetHanMs ? sql`now() + (${cho.hetHanMs}::bigint * interval '1 millisecond')` : sql`NULL`;
  const chen = (await tx.execute(sql`INSERT INTO ai_flow_waits ("runId", "nodeId", kind, "tokenHash", "expiresAt", payload)
    VALUES (${runId}, ${nodeId}, ${cho.kind}, ${cho.tokenHash ?? null}, ${hetHan}, ${JSON.stringify({ ...(cho.payload ?? {}), items: cho.items })}::jsonb)
    ON CONFLICT ("runId", "nodeId") DO NOTHING RETURNING "nodeId"`)) as unknown as unknown[];
  await tx.update(aiFlowRuns).set({ status: "cho-duyet" }).where(and(eq(aiFlowRuns.id, runId), eq(aiFlowRuns.status, "dang-chay")));
  // Đợt 8.4 — chờ LUỒNG CON: tạo lượt con trong CÙNG giao dịch (chỉ khi hàng chờ vừa được chèn ⇒ chạy lại không tạo con thứ hai).
  if (cho.kind === "luong-con" && cho.con && chen.length) {
    const runCon = await taoRunTx(tx, {
      flowId: cho.con.flowId,
      version: cho.con.version,
      items: cho.con.items,
      nutKichHoat: cho.con.nutKichHoat,
      triggerKind: "luong-con",
      parentRunId: runId,
      idempotencyKey: `con:${runId}:${nodeId}:${lan}`,
    });
    await tx.execute(sql`UPDATE ai_flow_waits SET payload = payload || ${JSON.stringify({ runCon })}::jsonb WHERE "runId" = ${runId} AND "nodeId" = ${nodeId}`);
  }
}

export type KetQuaTraLoiCho = { ok: true; cong: string } | { ok: false; lyDo: "khong-co-cho" };

/**
 * Trả lời một lượt chờ: bước của node ⇒ `xong` với item ở cổng `cong` (quá hạn ⇒ cổng `het-han` dù người chọn gì),
 * xếp node kế, lượt về `dang-chay` nếu hết chờ, đóng lượt nếu hết việc — MỘT giao dịch, hàng chờ khoá `FOR UPDATE`
 * (hai người bấm cùng lúc ⇒ người sau nhận `khong-co-cho`).
 */
export async function traLoiCho(y: { runId: string; nodeId: string; cong: string; them?: Record<string, unknown> }): Promise<KetQuaTraLoiCho> {
  const db = await layDb();
  return db.transaction((tx) => traLoiChoTx(tx, y));
}

/**
 * Thân của `traLoiCho` trong một giao dịch có sẵn. Đợt 8.4 thêm: `itemsThay` (đầu ra của luồng con thay cho item đã giữ) và
 * `loi` (luồng con lỗi ⇒ bước của cha `loi`; `khiLoi` mặc định `dung` ⇒ lượt cha `loi`, ngược lại item lỗi ra cổng `loi`).
 */
async function traLoiChoTx(
  tx: Tx,
  y: { runId: string; nodeId: string; cong: string; them?: Record<string, unknown>; itemsThay?: ItemLuong[]; loi?: string },
): Promise<KetQuaTraLoiCho> {
  const rows = (await tx.execute(sql`SELECT payload, ("expiresAt" IS NOT NULL AND "expiresAt" < now()) AS "hetHan"
    FROM ai_flow_waits WHERE "runId" = ${y.runId} AND "nodeId" = ${y.nodeId} FOR UPDATE`)) as unknown as { payload: { items?: ItemLuong[] }; hetHan: boolean }[];
  if (!rows.length) return { ok: false, lyDo: "khong-co-cho" } as const;
  const [run] = await tx.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, y.runId));
  if (!run || (run.status !== "cho-duyet" && run.status !== "dang-chay")) return { ok: false, lyDo: "khong-co-cho" } as const;
  const def = await dinhNghia(tx, run.flowId, run.version);
  await tx.execute(sql`DELETE FROM ai_flow_waits WHERE "runId" = ${y.runId} AND "nodeId" = ${y.nodeId}`);
  const buocDangCho = and(eq(aiFlowSteps.runId, y.runId), eq(aiFlowSteps.nodeId, y.nodeId), eq(aiFlowSteps.status, "dang-chay"));
  const [conCho] = (await tx.execute(sql`SELECT count(*)::int AS n FROM ai_flow_waits WHERE "runId" = ${y.runId}`)) as unknown as { n: number }[];
  if (conCho.n === 0) await tx.update(aiFlowRuns).set({ status: "dang-chay" }).where(and(eq(aiFlowRuns.id, y.runId), eq(aiFlowRuns.status, "cho-duyet")));
  let ra: KetQuaChay;
  let cong = y.cong;
  if (y.loi !== undefined) {
    await tx.update(aiFlowSteps).set({ status: "loi", finishedAt: sql`now()`, error: { thongDiep: y.loi } }).where(buocDangCho);
    await tx.insert(aiFlowEvents).values({ runId: y.runId, kind: "cho.loi", payload: { nodeId: y.nodeId, thongDiep: y.loi } });
    const nut = def.nodes.find((n) => n.id === y.nodeId);
    if ((nut?.khiLoi ?? "dung") === "dung") {
      await dongRun(tx, y.runId, "loi", { nodeId: y.nodeId, thongDiep: y.loi });
      return { ok: true, cong: "loi" } as const;
    }
    cong = "loi";
    ra = { loi: [{ json: { thongDiep: y.loi, nodeId: y.nodeId } }] };
  } else {
    cong = rows[0].hetHan ? "het-han" : y.cong;
    const items = (y.itemsThay ?? rows[0].payload.items ?? []).map((it) => ({ json: { ...it.json, ...(y.them ?? {}) } }));
    ra = { [cong]: items };
    await tx.update(aiFlowSteps).set({ status: "xong", finishedAt: sql`now()`, output: ra }).where(buocDangCho);
  }
  await xepNodeKe(tx, def, y.runId, y.nodeId, ra, UU_TIEN_SO[def.settings?.uuTien ?? "background"] ?? 2);
  await tx.insert(aiFlowEvents).values({ runId: y.runId, kind: "cho.tra-loi", payload: { nodeId: y.nodeId, cong } });
  await dongNeuHetViec(tx, y.runId);
  return { ok: true, cong } as const;
}

/** Một vòng worker: nhặt + chạy một mục. `false` nếu hết việc. Không bao giờ ném vì lỗi node. */
export async function chayMotMuc(workerId: string, leaseMs?: number, tienToFlow?: string, chiRun?: string): Promise<boolean> {
  const muc = await nhatMuc(workerId, leaseMs, tienToFlow, chiRun);
  if (!muc) return false;
  const bd = await batDauBuoc(muc);
  if (!bd.tiep) return true;
  let kq: { ok: true; ra: KetQuaChay | YeuCauCho } | { ok: false; loi: unknown };
  const vet: VetModel[] = [];
  bd.ngu.ghiModel = (v) => void vet.push(v);
  try {
    kq = { ok: true, ra: await thucThi(bd.def, bd.ngu) };
  } catch (e) {
    kq = { ok: false, loi: e };
  }
  await ketThucBuoc(muc, bd.def, bd.lanThu, kq);
  if (vet.length) await ghiVetModel(muc.runId, muc.nodeId, muc.lan, vet);
  return true;
}

/** Đợt 9 — ghi sự kiện `buoc.model` (model thực chạy của từng lần gọi AI trong bước). Thông tin phụ: lỗi ghi không làm hỏng lượt. */
async function ghiVetModel(runId: string, nodeId: string, lan: number, vet: VetModel[]): Promise<void> {
  try {
    const db = await layDb();
    await db.insert(aiFlowEvents).values(vet.map((v) => ({ runId, kind: "buoc.model", payload: { nodeId, lan, ...v } })));
  } catch {
    /* lượt có thể đã bị xoá giữa chừng */
  }
}

export interface KetQuaLuotDongBo {
  runId: string;
  status: string;
  /** Đầu ra node cuối (chỉ khi `xong`). */
  items: ItemLuong[];
  thongDiep?: string;
}

/**
 * Đợt 8.4 — chạy MỘT lượt đã tạo tới khi đóng (hoặc dừng chờ / hết trần), NGAY trong lời gọi: chỉ nhặt mục hàng của đúng lượt
 * này (worker nền vẫn có thể giành mục — SKIP LOCKED + lease giữ đúng-một-lần). Dùng cho tool của `ai.agent` và MCP — nơi
 * người gọi CẦN kết quả trong lời gọi; KHÔNG dùng cho `luong.goi-con` (chờ bền qua hàng chờ). Lượt dừng chờ (duyệt) ⇒ trả
 * `cho-duyet` (lượt vẫn sống, người duyệt sau). Hết trần ⇒ `het-gio` (lượt vẫn sống; worker nền chạy tiếp).
 */
export async function chayLuotDongBo(runId: string, tranMs: number, workerId = `dong-bo-${process.pid}`): Promise<KetQuaLuotDongBo> {
  const db = await layDb();
  const han = Date.now() + Math.max(1_000, tranMs);
  for (;;) {
    const coViec = await chayMotMuc(workerId, Math.min(5 * 60_000, Math.max(30_000, tranMs)), undefined, runId);
    const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, runId));
    if (!run) return { runId, status: "khong-co", items: [] };
    if (run.status === "xong") return { runId, status: "xong", items: await dauRaNodeCuoi(db, runId, await dinhNghia(db, run.flowId, run.version)) };
    if (run.status === "loi" || run.status === "huy") {
      const e = run.error as { thongDiep?: unknown; lyDo?: unknown } | null;
      return { runId, status: run.status, items: [], thongDiep: String(e?.thongDiep ?? e?.lyDo ?? "").slice(0, 2000) };
    }
    if (Date.now() > han) return { runId, status: "het-gio", items: [] };
    if (!coViec) {
      const [con] = (await db.execute(sql`SELECT (SELECT count(*) FROM ai_flow_queue WHERE "runId" = ${runId})::int AS q,
          (SELECT count(*) FROM ai_flow_waits WHERE "runId" = ${runId})::int AS w`)) as unknown as { q: number; w: number }[];
      if (con.q === 0 && con.w > 0) return { runId, status: "cho-duyet", items: [] };
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** Đợt 8.4 — chuỗi lượt từ một lượt lên các lượt cha (chặn lồng quá sâu / vòng gọi nhau). Phần tử 0 = chính lượt đó. */
export async function chuoiLuotCha(runId: string): Promise<{ runId: string; flowId: string }[]> {
  const db = await layDb();
  return (await db.execute(sql`WITH RECURSIVE c AS (
      SELECT id, "flowId", "parentRunId", 0 AS d FROM ai_flow_runs WHERE id = ${runId}
      UNION ALL SELECT r.id, r."flowId", r."parentRunId", c.d + 1 FROM ai_flow_runs r JOIN c ON r.id = c."parentRunId" WHERE c.d < 16)
    SELECT id AS "runId", "flowId" FROM c ORDER BY d`)) as unknown as { runId: string; flowId: string }[];
}

/** Đợt 8.4 — hạng của một phiên bản luồng (null nếu không có). */
export async function hangPhienBan(flowId: string, version: number): Promise<HangTacDungPhu | null> {
  const db = await layDb();
  const [v] = await db
    .select({ h: aiFlowVersions.riskClass })
    .from(aiFlowVersions)
    .where(and(eq(aiFlowVersions.flowId, flowId), eq(aiFlowVersions.version, version)));
  return (v?.h as HangTacDungPhu | undefined) ?? null;
}

/** Đợt 8.4 — phiên bản HOẠT ĐỘNG của một luồng + hạng + định nghĩa (null nếu chưa có). */
export async function phienBanHoatDong(flowId: string): Promise<{ version: number; hang: HangTacDungPhu; enabled: boolean; def: FlowDefinition } | null> {
  const db = await layDb();
  const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, flowId));
  if (!f?.activeVersion) return null;
  const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, flowId), eq(aiFlowVersions.version, f.activeVersion)));
  if (!v) return null;
  return { version: v.version, hang: v.riskClass as HangTacDungPhu, enabled: f.enabled, def: v.definition as FlowDefinition };
}

/** Hạng a ≥ hạng b. */
export const hangDu = (a: HangTacDungPhu, b: HangTacDungPhu): boolean => THU_TU_HANG[a] >= THU_TU_HANG[b];
