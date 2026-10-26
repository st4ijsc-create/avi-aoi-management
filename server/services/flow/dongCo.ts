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
import { appError } from "../../_core/appError";
import { ganMucDuLieu, taoMucDuLieuLuot } from "../ai/ngoai/phanLoai";
import { THU_TU_HANG, TRAN_DONG_THOI_MAC_DINH, kiemLuong, type FlowDefinition, type HangTacDungPhu } from "../../../shared/flow/model";
import type { ItemLuong } from "../../../shared/flow/bieuThuc";
import { TRAN_TUOI_LUOT_HEN_MS, layNut, type KetQuaChay, type NguCanhChay, type VetModel, type YeuCauCho, type YeuCauHen } from "./dangKyNut";
import { LoiBiMat, bienTheBiMat, cheBiMat, cheSau, giaiMaChoChay } from "./biMat";
import { ghimLuongCon, hangLuongConGhim, thamChieuTho } from "./ghimLuongCon";
import { KIND_MAY_DOC } from "./soLieu/kind";
import { createAuditLog } from "../../db/system";
import { banGhiKiemToan, type BanGhiKiemToan } from "./kiemToan";
import "./nut";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UU_TIEN_SO: Record<string, number> = { interactive: 0, agent: 1, background: 2 };

export class LoiLuong extends Error {
  constructor(
    public readonly code: "LUONG_KHONG_HOP_LE" | "LUONG_KHONG_CO" | "KHONG_CO_DB" | "LOAI_NODE_MAT" | "QUA_TRAN_DONG_THOI" | "QUA_TRAN_LUOT_GIO" | "QUA_TRAN_LUOT_TREO",
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
    // ★ Đợt 10.3 — phiên bản có node model NGOÀI ⇒ đánh dấu (mỗi phiên bản cần duyệt ngoài riêng trước khi bật).
    const { coNodeNgoai } = await import("../ai/ngoai/duyetNgoai");
    await tx.insert(aiFlowVersions).values({ flowId: def.id, version, definition: { ...def, version }, riskClass: kq.hang, createdBy: userId, coNodeNgoai: coNodeNgoai(def) });
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
  /** Lượt khởi bởi sự kiện máy: ghi `idMay` vào nhật ký tập máy NGAY LÚC BẮT ĐẦU (cùng giao dịch) để `tich-hop.thong-bao` kiểm người nhận ⊇ máy đó. */
  mayCuaSuKien?: number;
  /** Trần số lượt cùng `triggerKind` của luồng trong 1 giờ — đếm + chèn NGUYÊN TỬ (cùng khoá cố vấn theo luồng với trần đồng thời). Vượt ⇒ ném `QUA_TRAN_LUOT_GIO`. */
  tranLuotMoiGio?: number;
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

/**
 * ★ M5 — thi hành `settings.maxConcurrentRuns` (mặc định `TRAN_DONG_THOI_MAC_DINH` = 1). CHỌN: TỪ CHỐI lượt vượt trần (ném
 * `LoiLuong QUA_TRAN_DONG_THOI`), KHÔNG xếp hàng — hàng đợi không trần chỉ dời DoS sang bảng (và cần bộ đẩy lượt chờ trong `dongRun`);
 * người gọi tự xử lý: chạy tay ⇒ CONFLICT, webhook ⇒ 429, lịch ⇒ bỏ mốc + ghi log, MCP ⇒ lỗi tool. Chỉ đếm lượt GỐC `dang-chay`
 * (lượt chờ duyệt/chờ con không chiếm tài nguyên; lượt con bị chặn bởi trần cây lượt `TRAN_LUOT_TRONG_CAY`). Lượt ĐANG HẸN GIỜ (`logic.cho`: còn mục hàng nhưng mọi mục đều ở
 * tương lai, không bước nào đang chạy) cũng KHÔNG chiếm chỗ — nó không dùng tài nguyên; nếu không, trần mặc định 1 sẽ từ chối mọi sự kiện đến trong lúc luồng đang chờ. Khoá cố vấn theo luồng
 * để hai lượt gọi cùng lúc không cùng lọt qua phép đếm. Lượt trùng khoá idempotency được miễn (để đường cũ trả đúng lượt đã có).
 */
/** Trần số lượt GỐC đang TREO (cho-duyet, hoặc đang hẹn giờ) của MỘT luồng — mặc định 100, đặt bằng env `FLOW_TRAN_LUOT_TREO` (số nguyên 1…100000; rác ⇒ mặc định). */
export const TRAN_LUOT_TREO_MAC_DINH = 100;
export function tranLuotTreo(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.FLOW_TRAN_LUOT_TREO);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : TRAN_LUOT_TREO_MAC_DINH;
}

/** Mã từ chối "luồng đã đủ lượt" — người gọi xử lý như nhau (bỏ mốc / 429 / CONFLICT / lỗi tool). */
export const laLoiTranLuot = (e: unknown): e is Error =>
  e instanceof Error && e.name === "LoiLuong" && ((e as { code?: string }).code === "QUA_TRAN_DONG_THOI" || (e as { code?: string }).code === "QUA_TRAN_LUOT_TREO");

async function kiemTranDongThoi(tx: Db | Tx, y: YeuCauRun, def: FlowDefinition): Promise<void> {
  if (y.parentRunId) return;
  const tran = def.settings?.maxConcurrentRuns ?? TRAN_DONG_THOI_MAC_DINH;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"ai-flow-run:" + y.flowId}, 0))`);
  if (y.idempotencyKey) {
    const da = (await tx.execute(sql`SELECT 1 FROM ai_flow_runs WHERE "idempotencyKey" = ${y.idempotencyKey} LIMIT 1`)) as unknown as unknown[];
    if (da.length) return;
  }
  const [d] = (await tx.execute(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${y.flowId} AND status = 'dang-chay' AND "parentRunId" IS NULL
      AND NOT (
        EXISTS (SELECT 1 FROM ai_flow_queue q WHERE q."runId" = ai_flow_runs.id)
        AND NOT EXISTS (SELECT 1 FROM ai_flow_queue q WHERE q."runId" = ai_flow_runs.id AND q."availableAt" <= now())
        AND NOT EXISTS (SELECT 1 FROM ai_flow_steps s WHERE s."runId" = ai_flow_runs.id AND s.status = 'dang-chay'))`)) as unknown as { n: number }[];
  // Lượt hẹn giờ / chờ duyệt KHÔNG tính vào trần đồng thời ⇒ có TRẦN RIÊNG, để sự kiện dồn dập không tích hàng nghìn lượt treo.
  const [t] = (await tx.execute(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${y.flowId} AND "parentRunId" IS NULL AND (
      status = 'cho-duyet' OR (status = 'dang-chay'
        AND EXISTS (SELECT 1 FROM ai_flow_queue q WHERE q."runId" = ai_flow_runs.id)
        AND NOT EXISTS (SELECT 1 FROM ai_flow_queue q WHERE q."runId" = ai_flow_runs.id AND q."availableAt" <= now())
        AND NOT EXISTS (SELECT 1 FROM ai_flow_steps s WHERE s."runId" = ai_flow_runs.id AND s.status = 'dang-chay')))`)) as unknown as { n: number }[];
  const tranTreo = tranLuotTreo();
  if (t.n >= tranTreo) {
    throw new LoiLuong("QUA_TRAN_LUOT_TREO", `luồng ${y.flowId} đang có ${t.n} lượt treo (chờ duyệt / đang hẹn giờ; trần ${tranTreo}) — lượt mới bị TỪ CHỐI cho tới khi bớt`);
  }
  if (d.n >= tran) {
    throw new LoiLuong("QUA_TRAN_DONG_THOI", `luồng ${y.flowId} đang có ${d.n} lượt chạy (trần maxConcurrentRuns=${tran}) — lượt mới bị TỪ CHỐI (không xếp hàng)`);
  }
}

/**
 * Trần lượt/giờ theo `triggerKind` — gọi SAU `kiemTranDongThoi` (đã giữ khoá cố vấn theo luồng đến hết giao dịch) ⇒ đếm rồi chèn là NGUYÊN TỬ giữa các tiến trình.
 * Lượt trùng khoá idempotency được miễn (đường cũ trả đúng lượt đã có / báo trùng).
 */
async function kiemTranLuotGio(tx: Db | Tx, y: YeuCauRun): Promise<void> {
  if (y.tranLuotMoiGio === undefined || y.parentRunId) return;
  if (y.idempotencyKey) {
    const da = (await tx.execute(sql`SELECT 1 FROM ai_flow_runs WHERE "idempotencyKey" = ${y.idempotencyKey} LIMIT 1`)) as unknown as unknown[];
    if (da.length) return;
  }
  const [d] = (await tx.execute(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${y.flowId} AND "triggerKind" = ${y.triggerKind ?? "thu-cong"} AND "startedAt" > now() - interval '1 hour'`)) as unknown as { n: number }[];
  if (d.n >= y.tranLuotMoiGio) throw new LoiLuong("QUA_TRAN_LUOT_GIO", `luồng ${y.flowId} đã ${d.n} lượt ${y.triggerKind ?? "thu-cong"} trong 1 giờ (trần ${y.tranLuotMoiGio})`);
}

/** Tạo lượt + mục hàng của node kích hoạt TRONG một giao dịch có sẵn. */
async function taoRunTx(tx: Db | Tx, y: YeuCauRun): Promise<string> {
  const def = await dinhNghia(tx, y.flowId, y.version);
  await kiemTranDongThoi(tx, y, def);
  await kiemTranLuotGio(tx, y);
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
  if (y.mayCuaSuKien !== undefined) await tx.insert(aiFlowEvents).values({ runId, kind: KIND_MAY_DOC, payload: { nodeId: "su-kien", may: [y.mayCuaSuKien] } });
  await tx.insert(aiFlowEvents).values({ runId, kind: "run.bat-dau", payload: { kichHoat: kichHoat.map((n) => n.id), ...(y.parentRunId ? { parentRunId: y.parentRunId } : {}) } });
  // settings.timeoutS: trần tuổi lượt theo luồng (≤ trần 7 ngày) — mục kiểm bền trong hàng đợi, kể cả khi lượt đang chờ duyệt / hẹn giờ.
  const timeoutS = def.settings?.timeoutS;
  if (timeoutS !== undefined) {
    const giay = Math.min(timeoutS, Math.floor(TRAN_TUOI_LUOT_HEN_MS / 1000));
    await tx.execute(sql`INSERT INTO ai_flow_queue ("runId", "nodeId", lan, inputs, "uuTien", "availableAt")
      VALUES (${runId}, '__han-luot', 1, ${JSON.stringify({ [CONG_KIEM_HAN_LUOT]: [] })}::jsonb, ${UU_TIEN_SO[uuTien] ?? 2}, now() + (${giay}::bigint * interval '1 second'))`);
  }
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
  // ★ Đợt 10.3 — mức dữ liệu của lượt: MỌI node đã có bước trong lượt (xong / lỗi / không rõ — node lỗi vẫn có thể đã đưa dữ liệu
  //   vào thông điệp lỗi đi nhánh lỗi) + phân loại tĩnh luồng con; ảnh chụp, gắn không liệt kê / không ghi (node không hạ được).
  const daCoBuoc = await db.selectDistinct({ nodeId: aiFlowSteps.nodeId }).from(aiFlowSteps).where(eq(aiFlowSteps.runId, muc.runId));
  const kiemPhamVi = (await (await import("./boKiemPhamVi")).boKiemChoChuLuong(run.chuLuong)) ?? undefined;
  const [luongNm] = await db.select({ f: aiFlows.factoryId }).from(aiFlows).where(eq(aiFlows.id, run.flowId));
  return {
    tiep: true,
    def,
    lanThu,
    ngu: ganMucDuLieu({
      runId: muc.runId, flowId: run.flowId, nodeId: muc.nodeId, lan: muc.lan, idempotencyKey: key, inputs: muc.inputs, nodes,
      env: {}, run: { id: muc.runId, flowId: run.flowId, batDau: new Date(run.startedAt).toISOString() }, version: run.version,
      // Đợt 9 (IDOR) — phạm vi tính lại LÚC CHẠY từ người dùng hiện tại; không chủ / bị khoá / xoá / mất quyền ⇒ vắng ⇒ node tài nguyên từ chối.
      kiemPhamVi,
      // ★ Đợt 10.3 — nhà máy CHỦ LUỒNG (NULL = luồng toàn hệ thống ⇒ cổng AI ngoài từ chối) + nhà máy dữ liệu vận hành có thể tới (phạm vi chủ lượt).
      nhaMayLuong: luongNm?.f ?? null,
      nhaMayPhamViChu: () => nhaMayTrongPhamVi(kiemPhamVi?.phamVi),
    } as NguCanhChay, taoMucDuLieuLuot(def, daCoBuoc.map((b) => b.nodeId).filter((id) => id !== muc.nodeId), docDinhNghiaCon)),
  };
}

/** Nhà máy trong phạm vi chủ lượt (toàn quyền ⇒ MỌI nhà máy). Không có phạm vi ⇒ ném (cổng AI ngoài từ chối dữ liệu vận hành). */
async function nhaMayTrongPhamVi(phamVi: { userId?: number; userRole?: string } | undefined): Promise<number[]> {
  if (!phamVi?.userId) throw appError("FORBIDDEN", "OPERATION_FAILED", { operation: "nhaMayTrongPhamVi", reason: "khongCoPhamViChu" });
  const { resolveTenantFactoryScope } = await import("../../db/reportAggregators");
  const { factoryIds } = await resolveTenantFactoryScope(phamVi, { strict: true });
  if (factoryIds) return factoryIds;
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "nhaMayTrongPhamVi", reason: "dbUnavailable" });
  const { factories } = await import("../../../drizzle/schema");
  return (await db.select({ id: factories.id }).from(factories)).map((r) => r.id);
}

/** Định nghĩa luồng con ghim phiên bản (cho phân loại tĩnh mức dữ liệu). */
async function docDinhNghiaCon(flowId: string, version: number): Promise<FlowDefinition | null> {
  const db = await getDb();
  if (!db) return null;
  const [v] = await db.select({ d: aiFlowVersions.definition }).from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, flowId), eq(aiFlowVersions.version, version)));
  return v ? (v.d as FlowDefinition) : null;
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
export async function thucThi(def: FlowDefinition, ngu: NguCanhChay): Promise<KetQuaChay | YeuCauCho | YeuCauHen> {
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
  Object.defineProperty(nguBm, "biMat", { value: Object.freeze({ giaTri: bm.giaTri, loai: bm.loai, hostChoPhep: Object.freeze([...bm.hostChoPhep]) }), enumerable: false });
  if (ngu.mucDuLieu) ganMucDuLieu(nguBm, ngu.mucDuLieu); // spread bỏ ô không liệt kê — mang lại mức dữ liệu của lượt
  try {
    return cheSau(await loai.chay(nut.parameters ?? {}, nguBm), bienThe);
  } catch (e) {
    const che = new Error(cheThongDiepLoi(e, bienThe));
    che.name = (e as Error)?.name ?? "Error";
    // Mã ổn định do mã nguồn đặt (không phải bí mật) — giữ lại qua lớp che.
    const ma = (e as { ma?: unknown } | null)?.ma;
    if (typeof ma === "string") Object.defineProperty(che, "ma", { value: ma, enumerable: false });
    throw che;
  }
}

/**
 * Item ra cổng ẨN `loi` (node đặt khiLoi = nhanh-loi): với MỖI item đầu vào của bước lỗi, giữ NGUYÊN item gốc và thêm `loi: { ma?, thongDiep, nodeId }`
 * (đè khoá `loi` cũ nếu item gốc đã có). Không có item đầu vào ⇒ một item chỉ mang `loi` — lỗi không bao giờ mất item.
 */
export function itemLoi(inputs: Record<string, ItemLuong[]> | readonly ItemLuong[] | undefined, nodeId: string, ma: string | undefined, thongDiep: string): ItemLuong[] {
  const goc: readonly ItemLuong[] = Array.isArray(inputs) ? (inputs as readonly ItemLuong[]) : Object.values((inputs ?? {}) as Record<string, ItemLuong[]>).flat();
  const loi = { ...(ma ? { ma } : {}), thongDiep, nodeId };
  return goc.length ? goc.map((it) => ({ json: { ...it.json, loi } })) : [{ json: { loi } }];
}

/**
 * Kiểm toán (audit_logs, WORM) MỘT dòng cho mỗi bước node TÁC DỤNG PHỤ (ngoai-ghi / ot) kết thúc — xong hoặc lỗi cuối (không ghi lần thử lại). CÙNG giao dịch với việc đóng bước:
 * ghi kiểm toán lỗi ⇒ đóng bước lỗi ⇒ (atMostOnce) lượt `khong-ro` — thà dừng còn hơn có tác dụng phụ không dấu vết.
 */
async function kiemToanBuocNgoai(tx: Tx, muc: MucHang, nutLoai: string, ketQua: "xong" | "loi", ma?: string): Promise<void> {
  const loai = layNut(nutLoai);
  if (!loai || (loai.tacDungPhu !== "ngoai-ghi" && loai.tacDungPhu !== "ot")) return;
  const [r] = await tx.select({ chu: aiFlowRuns.chuLuong, flowId: aiFlowRuns.flowId }).from(aiFlowRuns).where(eq(aiFlowRuns.id, muc.runId));
  await createAuditLog(
    banGhiKiemToan({
      nguoi: r?.chu ?? null,
      hanhDong: "FLOW_BUOC_NGOAI_GHI",
      loaiThucThe: "ai_flow_run",
      thucThe: muc.runId,
      chiTiet: { flowId: r?.flowId, nodeId: muc.nodeId, loaiNode: nutLoai, hang: loai.tacDungPhu, lan: muc.lan, ketQua, ...(ma ? { ma } : {}) },
      thatBai: ketQua === "loi",
    }),
    tx,
  );
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
  } else {
    // Xong: các mục KIỂM còn treo (hạn lượt, hết hạn chờ) không còn nghĩa — gỡ để không nằm lại hàng đợi tới giờ hạn.
    await tx.execute(sql`DELETE FROM ai_flow_queue WHERE "runId" = ${runId} AND (${LA_MUC_KIEM_SQL})`);
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
  await thuGonDuLieu(tx, runId, status); // SAU khi cha đã đọc đầu ra của con (cùng giao dịch)
}

/** Lượt gốc được đọc kết quả ĐỒNG BỘ sau khi đóng (tool của ai.agent, MCP) — KHÔNG gỡ dữ liệu bước (xem `thuGonDuLieu`). */
export const KIEU_KICH_HOAT_DOC_SAU_DONG: readonly string[] = ["agent", "mcp"];

/**
 * settings.luuDuLieu — thi hành lúc ĐÓNG lượt (không gỡ giữa chừng: node sau cần `$node()`, lượt con cần đầu ra):
 *   day-du (mặc định) giữ hết · chi-loi giữ input/output các bước CHỈ khi lượt kết thúc `loi` · khong gỡ luôn.
 * "Gỡ" = input/output của bước về NULL; trạng thái, thời gian, lỗi, sự kiện GIỮ NGUYÊN. Lượt do agent / MCP gọi đồng bộ được miễn (kết quả đọc sau khi đóng).
 */
async function thuGonDuLieu(tx: Tx, runId: string, status: "xong" | "loi" | "huy"): Promise<void> {
  await tx.execute(sql`UPDATE ai_flow_steps s SET input = NULL, output = NULL
    FROM ai_flow_runs r JOIN ai_flow_versions v ON v."flowId" = r."flowId" AND v.version = r.version
    WHERE s."runId" = r.id AND r.id = ${runId}
      AND r."triggerKind" NOT IN (${sql.join(KIEU_KICH_HOAT_DOC_SAU_DONG.map((k) => sql`${k}`), sql`, `)})
      AND (v.definition->'settings'->>'luuDuLieu' = 'khong' OR (v.definition->'settings'->>'luuDuLieu' = 'chi-loi' AND ${status} <> 'loi'))
      AND (s.input IS NOT NULL OR s.output IS NOT NULL)`);
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
  kq: { ok: true; ra: KetQuaChay | YeuCauCho | YeuCauHen } | { ok: false; loi: unknown },
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
    let hen = 0;
    if (kq.ok && "__cho" in kq.ra) {
      // Node xin CHỜ: bước giữ `dang-chay` (dấu "đã bắt đầu" + chặn đóng lượt), mục hàng xong việc.
      await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
      await batDauCho(tx, muc.runId, muc.nodeId, (kq.ra as YeuCauCho).__cho, muc.lan, uuTien);
      await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.cho", payload: { nodeId: muc.nodeId, lan: muc.lan } });
      return;
    }
    if (!kq.ok) {
      const thongDiep = cheThongDiepLoi(kq.loi, bienThe);
      // Mã ỔN ĐỊNH (không dịch) để UI chú giải; chỉ nhận chuỗi ngắn do mã nguồn đặt, không lấy từ dữ liệu người dùng.
      const maRaw = (kq.loi as { ma?: unknown } | null)?.ma;
      const ma = typeof maRaw === "string" && /^[A-Z_]{3,40}$/.test(maRaw) ? maRaw : undefined;
      await tx.update(aiFlowSteps).set({ status: "loi", finishedAt: sql`now()`, error: ma ? { thongDiep, ma } : { thongDiep } }).where(buoc);
      const thuToiDa = nut.retry?.max ?? 0;
      if (muc.attempts <= thuToiDa) {
        const lui = (nut.retry?.backoffMs ?? 1000) * 2 ** (muc.attempts - 1);
        await tx.execute(sql`UPDATE ai_flow_queue SET "leaseOwner" = NULL, "leaseUntil" = NULL,
          "availableAt" = now() + (${lui}::int * interval '1 millisecond') WHERE id = ${muc.id}`);
        await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.thu-lai", payload: { nodeId: muc.nodeId, lan: muc.attempts, thongDiep } });
        return;
      }
      await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
      if (!nut.disabled) await kiemToanBuocNgoai(tx, muc, nut.type, "loi", ma);
      if ((nut.khiLoi ?? "dung") === "dung") {
        await dongRun(tx, muc.runId, "loi", ma ? { nodeId: muc.nodeId, thongDiep, ma } : { nodeId: muc.nodeId, thongDiep });
        return;
      }
      ra = { loi: itemLoi(muc.inputs, muc.nodeId, ma, thongDiep) };
    } else {
      let henMs = 0;
      if ("__hen" in kq.ra) {
        henMs = Math.max(0, Math.floor((kq.ra as YeuCauHen).__hen.ms));
        ra = (kq.ra as YeuCauHen).__hen.ra;
        // Trần tuổi lượt: node kế sẽ chạy lúc now()+henMs; vượt startedAt + 7 ngày ⇒ bước LỖI (mã ổn định), không hẹn.
        const [q] = (await tx.execute(sql`SELECT (now() + (${henMs}::bigint * interval '1 millisecond') > "startedAt" + (${TRAN_TUOI_LUOT_HEN_MS}::bigint * interval '1 millisecond')) AS vuot
          FROM ai_flow_runs WHERE id = ${muc.runId}`)) as unknown as { vuot: boolean }[];
        if (q?.vuot) {
          const thongDiep = "hẹn giờ vượt trần tuổi lượt (7 ngày) — luồng không được chờ vô hạn";
          await tx.update(aiFlowSteps).set({ status: "loi", finishedAt: sql`now()`, error: { thongDiep, ma: "QUA_TRAN_CHO" } }).where(buoc);
          await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
          if ((nut.khiLoi ?? "dung") === "dung") {
            await dongRun(tx, muc.runId, "loi", { nodeId: muc.nodeId, thongDiep, ma: "QUA_TRAN_CHO" });
            return;
          }
          await xepNodeKe(tx, def, muc.runId, muc.nodeId, { loi: itemLoi(muc.inputs, muc.nodeId, "QUA_TRAN_CHO", thongDiep) }, uuTien);
          await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.xong", payload: { nodeId: muc.nodeId, lan: muc.lan } });
          await dongNeuHetViec(tx, muc.runId);
          return;
        }
        if (henMs > 0) await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.hen", payload: { nodeId: muc.nodeId, lan: muc.lan, ms: henMs } });
        hen = henMs;
      } else {
        ra = kq.ra as KetQuaChay;
      }
      await tx.update(aiFlowSteps).set({ status: "xong", finishedAt: sql`now()`, output: ra }).where(buoc);
      await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
      if (!nut.disabled) await kiemToanBuocNgoai(tx, muc, nut.type, "xong");
    }
    await xepNodeKe(tx, def, muc.runId, muc.nodeId, ra, uuTien, hen);
    await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "buoc.xong", payload: { nodeId: muc.nodeId, lan: muc.lan } });
    await dongNeuHetViec(tx, muc.runId);
  });
}

/** Xếp node kế cho các cổng có item (node gộp: qua hộp nhận, đủ cổng mới thành mục hàng). */
async function xepNodeKe(tx: Tx, def: FlowDefinition, runId: string, nodeId: string, ra: KetQuaChay, uuTien: number, henMs = 0): Promise<void> {
  const luc = henMs > 0 ? sql`now() + (${henMs}::bigint * interval '1 millisecond')` : sql`now()`;
  // Item tới cổng NÊN-NỐI mà KHÔNG có đường nối ⇒ bị bỏ (đường đi của luồng): ghi sự kiện để lượt nhìn thấy được, không bỏ âm thầm.
  const loaiNguon = layNut(def.nodes.find((n) => n.id === nodeId)?.type ?? "");
  const nutNguon = def.nodes.find((n) => n.id === nodeId);
  // Cổng ẨN `loi` (khiLoi = nhanh-loi) cũng là cổng NÊN NỐI: lỗi không được rơi im lặng.
  for (const cong of [...(loaiNguon?.congNenNoi ?? []), ...(nutNguon?.khiLoi === "nhanh-loi" ? ["loi"] : [])]) {
    const items = ra[cong] ?? [];
    if (items.length && !def.connections.some((x) => x.from.node === nodeId && x.from.port === cong)) {
      await tx.insert(aiFlowEvents).values({ runId, kind: "cong.khong-noi", payload: { nodeId, cong, soItem: items.length } });
    }
  }
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
          await tx.insert(aiFlowQueue).values({ runId, nodeId: dich.id, lan: await lanKe(tx, runId, dich.id), inputs, uuTien, availableAt: luc as never });
          await tx.delete(aiFlowInbox).where(and(eq(aiFlowInbox.runId, runId), eq(aiFlowInbox.nodeId, dich.id)));
        }
      } else {
        await tx.insert(aiFlowQueue).values({ runId, nodeId: dich.id, lan: await lanKe(tx, runId, dich.id), inputs: { [c.to.port]: items }, uuTien, availableAt: luc as never });
      }
    }
  }
}

/** Hết việc (không mục hàng, không bước đang chạy/chờ) ⇒ đóng lượt. Hộp nhận dở = nhánh gộp không đủ ⇒ node gộp không chạy. */
async function dongNeuHetViec(tx: Tx, runId: string): Promise<void> {
  const [con] = (await tx.execute(sql`
    SELECT (SELECT count(*) FROM ai_flow_queue WHERE "runId" = ${runId} AND NOT (${LA_MUC_KIEM_SQL}))::int
         + (SELECT count(*) FROM ai_flow_steps WHERE "runId" = ${runId} AND status = 'dang-chay')::int AS n`)) as unknown as { n: number }[];
  if (con.n === 0) await dongRun(tx, runId, "xong");
}

/** Node xin CHỜ (duyệt người / webhook / thời gian): lượt ⇒ `cho-duyet`, ghi `ai_flow_waits` (giữ item để trả lời sau). */
/** Khoá cổng đầu vào của mục hàng "kiểm hết hạn" (không phải node): mục này chỉ đánh thức hàng chờ có `expiresAt`. */
export const CONG_KIEM_HET_HAN = "__kiem-het-han";
/** Mục "kiểm hạn lượt" (settings.timeoutS): xếp lúc tạo lượt, availableAt = bắt đầu + timeoutS; tới hạn mà lượt còn mở ⇒ lượt `loi` QUA_HAN_LUOT. */
export const CONG_KIEM_HAN_LUOT = "__kiem-han-luot";
/** Các khoá đầu vào đánh dấu mục hàng KIỂM (không phải node): loại khỏi mọi phép đếm "còn việc". */
const KHOA_MUC_KIEM = [CONG_KIEM_HET_HAN, CONG_KIEM_HAN_LUOT];
const LA_MUC_KIEM_SQL = sql`inputs ?| array[${sql.join(KHOA_MUC_KIEM.map((k) => sql`${k}`), sql`, `)}]`;

async function batDauCho(tx: Tx, runId: string, nodeId: string, cho: YeuCauCho["__cho"], lan = 1, uuTien = 2): Promise<void> {
  const hetHan = cho.hetHanMs ? sql`now() + (${cho.hetHanMs}::bigint * interval '1 millisecond')` : sql`NULL`;
  const chen = (await tx.execute(sql`INSERT INTO ai_flow_waits ("runId", "nodeId", kind, "tokenHash", "expiresAt", payload)
    VALUES (${runId}, ${nodeId}, ${cho.kind}, ${cho.tokenHash ?? null}, ${hetHan}, ${JSON.stringify({ ...(cho.payload ?? {}), items: cho.items })}::jsonb)
    ON CONFLICT ("runId", "nodeId") DO NOTHING RETURNING "nodeId"`)) as unknown as unknown[];
  await tx.update(aiFlowRuns).set({ status: "cho-duyet" }).where(and(eq(aiFlowRuns.id, runId), eq(aiFlowRuns.status, "dang-chay")));
  // Chờ có hạn ⇒ xếp MỘT mục "kiểm hết hạn" (availableAt = expiresAt, cùng giao dịch, chỉ khi hàng chờ vừa được chèn): tới hạn mà chờ còn mở ⇒ cổng `het-han`.
  // Không có nó, quá hạn chỉ có hiệu lực khi ai đó bấm ⇒ yêu cầu duyệt bị bỏ quên treo mãi.
  if (cho.hetHanMs && chen.length) {
    await tx.execute(sql`INSERT INTO ai_flow_queue ("runId", "nodeId", lan, inputs, "uuTien", "availableAt")
      VALUES (${runId}, ${nodeId}, ${lan}, ${JSON.stringify({ [CONG_KIEM_HET_HAN]: [] })}::jsonb, ${uuTien}, now() + (${cho.hetHanMs}::bigint * interval '1 millisecond'))`);
  }
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
export async function traLoiCho(y: { runId: string; nodeId: string; cong: string; them?: Record<string, unknown>; kiemToan?: BanGhiKiemToan }): Promise<KetQuaTraLoiCho> {
  const db = await layDb();
  return db.transaction((tx) => traLoiChoTx(tx, y));
}

/**
 * Thân của `traLoiCho` trong một giao dịch có sẵn. Đợt 8.4 thêm: `itemsThay` (đầu ra của luồng con thay cho item đã giữ) và
 * `loi` (luồng con lỗi ⇒ bước của cha `loi`; `khiLoi` mặc định `dung` ⇒ lượt cha `loi`, ngược lại item lỗi ra cổng `loi`).
 */
async function traLoiChoTx(
  tx: Tx,
  y: { runId: string; nodeId: string; cong: string; them?: Record<string, unknown>; itemsThay?: ItemLuong[]; loi?: string; hetHanEp?: boolean; kiemToan?: BanGhiKiemToan },
): Promise<KetQuaTraLoiCho> {
  const rows = (await tx.execute(sql`SELECT payload, ("expiresAt" IS NOT NULL AND "expiresAt" < now()) AS "hetHan"
    FROM ai_flow_waits WHERE "runId" = ${y.runId} AND "nodeId" = ${y.nodeId} FOR UPDATE`)) as unknown as { payload: { items?: ItemLuong[] }; hetHan: boolean }[];
  if (!rows.length) return { ok: false, lyDo: "khong-co-cho" } as const;
  const [run] = await tx.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, y.runId));
  if (!run || (run.status !== "cho-duyet" && run.status !== "dang-chay")) return { ok: false, lyDo: "khong-co-cho" } as const;
  const def = await dinhNghia(tx, run.flowId, run.version);
  await tx.execute(sql`DELETE FROM ai_flow_waits WHERE "runId" = ${y.runId} AND "nodeId" = ${y.nodeId}`);
  // Hàng chờ đã được trả lời ⇒ bỏ mục "kiểm hết hạn" còn treo (nếu không, lượt không đóng được tới tận giờ hết hạn).
  await tx.execute(sql`DELETE FROM ai_flow_queue WHERE "runId" = ${y.runId} AND "nodeId" = ${y.nodeId} AND inputs ? ${CONG_KIEM_HET_HAN}`);
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
    ra = { loi: itemLoi(rows[0].payload.items, y.nodeId, undefined, y.loi) };
  } else {
    cong = rows[0].hetHan || y.hetHanEp ? "het-han" : y.cong;
    const items = (y.itemsThay ?? rows[0].payload.items ?? []).map((it) => ({ json: { ...it.json, ...(y.them ?? {}) } }));
    ra = { [cong]: items };
    await tx.update(aiFlowSteps).set({ status: "xong", finishedAt: sql`now()`, output: ra }).where(buocDangCho);
  }
  await xepNodeKe(tx, def, y.runId, y.nodeId, ra, UU_TIEN_SO[def.settings?.uuTien ?? "background"] ?? 2);
  await tx.insert(aiFlowEvents).values({ runId: y.runId, kind: "cho.tra-loi", payload: { nodeId: y.nodeId, cong } });
  // Bằng chứng duyệt / điền vào audit_logs (WORM) CÙNG giao dịch với việc trả lời: không có hàng kiểm toán ⇒ không có câu trả lời.
  if (y.kiemToan) await createAuditLog({ ...y.kiemToan, details: { ...(y.kiemToan.details ?? {}), cong } }, tx);
  await dongNeuHetViec(tx, y.runId);
  return { ok: true, cong } as const;
}

/** Một vòng worker: nhặt + chạy một mục. `false` nếu hết việc. Không bao giờ ném vì lỗi node. */
export async function chayMotMuc(workerId: string, leaseMs?: number, tienToFlow?: string, chiRun?: string): Promise<boolean> {
  const muc = await nhatMuc(workerId, leaseMs, tienToFlow, chiRun);
  if (!muc) return false;
  if (CONG_KIEM_HET_HAN in muc.inputs) {
    await xuLyKiemHetHan(muc);
    return true;
  }
  if (CONG_KIEM_HAN_LUOT in muc.inputs) {
    await xuLyKiemHanLuot(muc);
    return true;
  }
  const bd = await batDauBuoc(muc);
  if (!bd.tiep) return true;
  let kq: { ok: true; ra: KetQuaChay | YeuCauCho | YeuCauHen } | { ok: false; loi: unknown };
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

/**
 * Mục "kiểm hết hạn" tới hạn: chờ VẪN MỞ và `expiresAt <= now()` ⇒ trả lời cổng `het-han` (MỘT lần: trả lời xong thì hàng chờ mất, người bấm sau nhận khong-co-cho);
 * chờ đã được trả lời / lượt đã đóng ⇒ chỉ bỏ mục. Một giao dịch: worker chết giữa chừng ⇒ khôi phục, mục lại sẵn sàng sau lease ⇒ vẫn đúng một lần.
 */
export async function xuLyKiemHetHan(muc: MucHang): Promise<void> {
  const db = await layDb();
  await db.transaction(async (tx) => {
    await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
    const dangMo = (await tx.execute(sql`SELECT 1 AS x FROM ai_flow_waits WHERE "runId" = ${muc.runId} AND "nodeId" = ${muc.nodeId} AND "expiresAt" IS NOT NULL AND "expiresAt" <= now() FOR UPDATE`)) as unknown as unknown[];
    if (!dangMo.length) return;
    const kq = await traLoiChoTx(tx, {
      runId: muc.runId,
      nodeId: muc.nodeId,
      cong: "het-han",
      hetHanEp: true,
      kiemToan: banGhiKiemToan({ nguoi: null, hanhDong: "FLOW_DUYET", loaiThucThe: "ai_flow_run", thucThe: muc.runId, chiTiet: { nodeId: muc.nodeId, hetHan: true, tuDong: true } }),
    });
    if (kq.ok) await tx.insert(aiFlowEvents).values({ runId: muc.runId, kind: "cho.het-han", payload: { nodeId: muc.nodeId } });
  });
}

/**
 * Mục "kiểm hạn lượt" tới hạn (settings.timeoutS): lượt còn `dang-chay` / `cho-duyet` ⇒ đóng `loi` mã QUA_HAN_LUOT (xoá hàng đợi, hàng chờ, huỷ lượt con — qua `dongRun`); đã đóng ⇒ chỉ bỏ mục.
 * Một giao dịch + khoá hàng lượt ⇒ worker chết giữa chừng vẫn đúng một lần.
 */
export async function xuLyKiemHanLuot(muc: MucHang): Promise<void> {
  const db = await layDb();
  await db.transaction(async (tx) => {
    await tx.delete(aiFlowQueue).where(eq(aiFlowQueue.id, muc.id));
    const [run] = (await tx.execute(sql`SELECT id, "flowId", version, status FROM ai_flow_runs WHERE id = ${muc.runId} FOR UPDATE`)) as unknown as { id: string; flowId: string; version: number; status: string }[];
    if (!run || (run.status !== "dang-chay" && run.status !== "cho-duyet")) return;
    const def = await dinhNghia(tx, run.flowId, run.version);
    await dongRun(tx, muc.runId, "loi", { ma: "QUA_HAN_LUOT", thongDiep: `lượt vượt hạn ${def.settings?.timeoutS ?? "?"} giây của luồng (settings.timeoutS)` });
  });
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
      const [con] = (await db.execute(sql`SELECT (SELECT count(*) FROM ai_flow_queue WHERE "runId" = ${runId} AND NOT (${LA_MUC_KIEM_SQL}))::int AS q,
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
