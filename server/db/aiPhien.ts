/**
 * ★★★ Đợt 11.8 · T7 — PHIÊN HỢP NHẤT coding + agent (web · VS Code · CLI) trên `ai_coding_sessions` (mig 0440/0443), PHẠM VI CHỦ SỞ HỮU.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LUẬT: `userId` là THAM SỐ BẮT BUỘC ĐẦU TIÊN của mọi hàm và MỌI câu truy vấn mang `userId` + `kind IN ('coding','agent')`
 *   (KHÔNG BAO GIỜ đụng phiên `chat` — chat có kho riêng `ai_chat_*`; ở đây chỉ có phép CHIẾU CHỈ-ĐỌC `danhSachChat`).
 *   `userId` đến từ `ctx.user.id`, không từ input. Không có/của người khác/sai kind ⇒ cùng kết quả `NOT_FOUND` (không oracle).
 * ⚠ `turns` chỉ `{role: user|assistant, content}` qua `locLuot()` ở cả cửa ghi lẫn đọc: không thẻ duyệt, không kết quả công cụ (M9).
 *   Vai `assistant` do CLIENT khai ⇒ khi nạp làm ngữ cảnh model, coi như lịch sử client (không nâng tin cậy).
 * ⚠ Khoá lạc quan: ghi nhận `expectedVersion`; lệch ⇒ `CONFLICT` kèm `versionHienTai`, KHÔNG ghi. `version` chỉ tăng ở đây.
 * ⚠ `runIds` kiểm thuộc CHÍNH userId (+ cùng dự án) lúc GHI (`ganLuotChay`) và lúc ĐỌC (`mo` lọc lại) — không rò sổ lượt chéo tài khoản.
 * ⚠ `xoa` KHÔNG xoá `ai_agent_runs` (sổ kiểm toán). `coLuotNgoai` (mig 0417) lan truyền: nhân bản / nộp tóm tắt sao nguyên (true ⇒ true).
 * ⚠ FAIL-SAFE: CSDL vắng/bảng thiếu ⇒ danh sách rỗng / `{ok:false, ma:"LOI"}`, không ném.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { aiCodingSessions } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";
import {
  GIOI_HAN_PHIEN,
  KIND_PHIEN,
  NGUON_PHIEN,
  laIdDuAnHopLe,
  laIdPhienHopLe,
  locLuot,
  nhanTuLuot,
  type KindPhien,
  type LuotPhien,
  type NguonPhien,
} from "@shared/aiCodingSession";

export const TRAN_PHIEN_MOI_NGUOI = 500;
export const TRAN_LUOT_MOI_LAN_GHI = 40;
export const TRAN_KY_TU_TOM_TAT_PHIEN = 4_000;
export const TRAN_LUOT_CHAY_MOI_PHIEN = 50;

export type { KindPhien, NguonPhien };
const KIND: readonly string[] = KIND_PHIEN;
const NGUON: readonly string[] = NGUON_PHIEN;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MaLoiPhien = "NOT_FOUND" | "CONFLICT" | "QUA_TRAN_PHIEN" | "THAM_SO_SAI" | "LOI";
export type KetQuaPhien<T> = ({ ok: true } & T) | { ok: false; ma: MaLoiPhien; versionHienTai?: number };

export interface TomTatPhien {
  id: string;
  kind: string;
  source: string;
  projectId: string | null;
  title: string;
  turnCount: number;
  contextPct: number | null;
  parentSessionId: string | null;
  coLuotNgoai: boolean;
  version: number;
  updatedAt: string;
}
export interface PhienDayDu extends TomTatPhien {
  turns: LuotPhien[];
  runIds: string[];
}

function canhBao(cho: string, err: unknown): void {
  if (!isMissingTable(err)) console.warn(`[aiPhien] ${cho} hỏng (degrade):`, err);
}
const hopLeUser = (u: unknown): u is number => Number.isInteger(u) && (u as number) > 0;
const iso = (d: unknown) => (d instanceof Date ? d : new Date(d as string)).toISOString();

/** Các cột chọn cho một dòng danh sách (kèm `coLuotNgoai` bằng SQL thô — cột của mig 0417, không khai ở schema nhánh này). */
const COT_TOM_TAT = {
  id: aiCodingSessions.id,
  kind: aiCodingSessions.kind,
  source: aiCodingSessions.source,
  projectId: aiCodingSessions.projectId,
  title: aiCodingSessions.title,
  turnCount: aiCodingSessions.turnCount,
  contextPct: aiCodingSessions.contextPct,
  parentSessionId: aiCodingSessions.parentSessionId,
  version: aiCodingSessions.version,
  updatedAt: aiCodingSessions.updatedAt,
  coLuotNgoai: sql<boolean>`"coLuotNgoai"`,
};

function tuHang(r: {
  id: unknown;
  kind: unknown;
  source: unknown;
  projectId: unknown;
  title: unknown;
  turnCount: unknown;
  contextPct: unknown;
  parentSessionId: unknown;
  version: unknown;
  updatedAt: unknown;
  coLuotNgoai: unknown;
}): TomTatPhien {
  return {
    id: String(r.id),
    kind: String(r.kind),
    source: String(r.source),
    projectId: r.projectId == null ? null : String(r.projectId),
    title: String(r.title ?? ""),
    turnCount: Number(r.turnCount ?? 0),
    contextPct: r.contextPct == null ? null : Number(r.contextPct),
    parentSessionId: r.parentSessionId == null ? null : String(r.parentSessionId),
    coLuotNgoai: r.coLuotNgoai === true,
    version: Number(r.version ?? 1),
    updatedAt: iso(r.updatedAt),
  };
}

const chuSoHuu = (userId: number) => and(eq(aiCodingSessions.userId, userId), inArray(aiCodingSessions.kind, [...KIND]));

async function demPhien(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return TRAN_PHIEN_MOI_NGUOI; // fail-closed: không đếm được ⇒ coi như đầy
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(aiCodingSessions).where(chuSoHuu(userId));
  return Number(r?.n ?? 0);
}

// ─── đọc ──────────────────────────────────────────────────────────────────────────────────────

export async function danhSach(
  userId: number,
  y: { projectId: string; kind?: KindPhien | "all"; gioiHan?: number },
): Promise<TomTatPhien[]> {
  if (!hopLeUser(userId) || !laIdDuAnHopLe(y.projectId)) return [];
  const db = await getDb();
  if (!db) return [];
  const kind = y.kind ?? "all";
  if (kind !== "all" && !KIND.includes(kind)) return [];
  const gh = Math.max(1, Math.min(GIOI_HAN_PHIEN.SO_PHIEN_LIET_KE, Math.floor(y.gioiHan ?? GIOI_HAN_PHIEN.SO_PHIEN_LIET_KE)));
  try {
    const rows = await db
      .select(COT_TOM_TAT)
      .from(aiCodingSessions)
      .where(
        and(
          eq(aiCodingSessions.userId, userId),
          kind === "all" ? inArray(aiCodingSessions.kind, [...KIND]) : eq(aiCodingSessions.kind, kind),
          eq(aiCodingSessions.projectId, y.projectId),
        ),
      )
      .orderBy(desc(aiCodingSessions.updatedAt))
      .limit(gh);
    return rows.map(tuHang);
  } catch (err) {
    canhBao("danhSach", err);
    return [];
  }
}

/** Phép CHIẾU CHỈ-ĐỌC các cuộc chat web của chính người này (`ai_chat_conversations`) — id có tiền tố `chat:`; KHÔNG ghi gì. */
export async function danhSachChat(userId: number, gioiHan = GIOI_HAN_PHIEN.SO_PHIEN_LIET_KE): Promise<TomTatPhien[]> {
  if (!hopLeUser(userId)) return [];
  const db = await getDb();
  if (!db) return [];
  const gh = Math.max(1, Math.min(GIOI_HAN_PHIEN.SO_PHIEN_LIET_KE, Math.floor(gioiHan)));
  const chuyen = (r: Record<string, unknown>): TomTatPhien => ({
    id: `chat:${String(r.id)}`,
    kind: "chat",
    source: "web",
    projectId: null,
    title: String(r.title ?? ""),
    turnCount: Number(r.messageCount ?? 0),
    contextPct: null,
    parentSessionId: null,
    coLuotNgoai: r.coLuotNgoai === true,
    version: 0,
    updatedAt: iso(r.updatedAt),
  });
  try {
    const rows = (await db.execute(
      sql`SELECT id, title, "messageCount", "updatedAt", "coLuotNgoai" FROM ai_chat_conversations WHERE "userId" = ${userId} ORDER BY "updatedAt" DESC LIMIT ${gh}`,
    )) as unknown as Array<Record<string, unknown>>;
    return rows.map(chuyen);
  } catch {
    try {
      // CSDL cũ chưa có cột coLuotNgoai (mig 0417) ⇒ chiếu không có cờ
      const rows = (await db.execute(
        sql`SELECT id, title, "messageCount", "updatedAt" FROM ai_chat_conversations WHERE "userId" = ${userId} ORDER BY "updatedAt" DESC LIMIT ${gh}`,
      )) as unknown as Array<Record<string, unknown>>;
      return rows.map(chuyen);
    } catch (err) {
      canhBao("danhSachChat", err);
      return [];
    }
  }
}

export async function mo(userId: number, sessionId: string): Promise<KetQuaPhien<{ phien: PhienDayDu }>> {
  if (!hopLeUser(userId) || !laIdPhienHopLe(sessionId)) return { ok: false, ma: "NOT_FOUND" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "LOI" };
  try {
    const [row] = await db
      .select({ ...COT_TOM_TAT, turns: aiCodingSessions.turns, runIds: aiCodingSessions.runIds })
      .from(aiCodingSessions)
      .where(and(eq(aiCodingSessions.id, sessionId), chuSoHuu(userId)))
      .limit(1);
    if (!row) return { ok: false, ma: "NOT_FOUND" };
    const turns = locLuot(row.turns); // ★ chiếu ở cửa ĐỌC
    // ★ M8b — runIds lọc lại theo CHỦ lúc đọc: chỉ giữ lượt thuộc chính người gọi (ghim chéo tài khoản không rò được gì)
    const ung = Array.isArray(row.runIds) ? (row.runIds as unknown[]).filter((x): x is string => typeof x === "string" && RE_UUID.test(x)) : [];
    let runIds: string[] = [];
    if (ung.length > 0) {
      const r = (await db.execute(
        sql`SELECT id FROM ai_agent_runs WHERE "userId" = ${userId} AND id IN (${sql.join(ung.map((x) => sql`${x}::uuid`), sql`, `)})`,
      )) as unknown as Array<{ id: string }>;
      const cua = new Set(r.map((x) => String(x.id)));
      runIds = ung.filter((x) => cua.has(x));
    }
    return { ok: true, phien: { ...tuHang(row), turnCount: turns.length, turns, runIds } };
  } catch (err) {
    canhBao("mo", err);
    return { ok: false, ma: "LOI" };
  }
}

// ─── ghi ──────────────────────────────────────────────────────────────────────────────────────

const lamSachTen = (t: unknown): string => {
  // bỏ điều khiển C0/C1, định dạng (bidi, zero-width, thẻ), thay thế, dùng riêng, chưa gán; khoảng trắng lạ ⇒ dấu cách
  const sach = String(t ?? "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Zs}]/gu, " ")
    .replace(/[\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return sach.length <= GIOI_HAN_PHIEN.DAI_NHAN ? sach : sach.slice(0, GIOI_HAN_PHIEN.DAI_NHAN - 1) + "…";
};

export async function tao(
  userId: number,
  y: { projectId: string; kind: KindPhien; source: NguonPhien; title?: string },
): Promise<KetQuaPhien<{ id: string; version: number }>> {
  if (!hopLeUser(userId) || !laIdDuAnHopLe(y.projectId) || !KIND.includes(y.kind) || !NGUON.includes(y.source)) return { ok: false, ma: "THAM_SO_SAI" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "LOI" };
  try {
    if ((await demPhien(userId)) >= TRAN_PHIEN_MOI_NGUOI) return { ok: false, ma: "QUA_TRAN_PHIEN" };
    const [h] = await db
      .insert(aiCodingSessions)
      .values({ userId, projectId: y.projectId, kind: y.kind, source: y.source, title: lamSachTen(y.title), turns: [], turnCount: 0 })
      .returning({ id: aiCodingSessions.id, version: aiCodingSessions.version });
    return h ? { ok: true, id: String(h.id), version: Number(h.version) } : { ok: false, ma: "LOI" };
  } catch (err) {
    canhBao("tao", err);
    return { ok: false, ma: "LOI" };
  }
}

async function versionHienTai(userId: number, sessionId: string): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [r] = await db.select({ v: aiCodingSessions.version }).from(aiCodingSessions).where(and(eq(aiCodingSessions.id, sessionId), chuSoHuu(userId))).limit(1);
  return r ? Number(r.v) : undefined;
}

export async function themLuot(
  userId: number,
  y: { sessionId: string; expectedVersion: number; luot: unknown; contextPct?: number },
): Promise<KetQuaPhien<{ version: number; turnCount: number }>> {
  if (!hopLeUser(userId) || !laIdPhienHopLe(y.sessionId) || !Number.isInteger(y.expectedVersion) || y.expectedVersion < 1) return { ok: false, ma: "THAM_SO_SAI" };
  if (!Array.isArray(y.luot) || y.luot.length > TRAN_LUOT_MOI_LAN_GHI) return { ok: false, ma: "THAM_SO_SAI" };
  const them = locLuot(y.luot); // ★ chiếu ở cửa GHI
  if (them.length === 0) return { ok: false, ma: "THAM_SO_SAI" };
  const pct = y.contextPct === undefined ? null : Number.isInteger(y.contextPct) && y.contextPct >= 0 && y.contextPct <= 200 ? y.contextPct : undefined;
  if (pct === undefined) return { ok: false, ma: "THAM_SO_SAI" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "LOI" };
  try {
    const [row] = await db
      .select({ turns: aiCodingSessions.turns, version: aiCodingSessions.version, title: aiCodingSessions.title })
      .from(aiCodingSessions)
      .where(and(eq(aiCodingSessions.id, y.sessionId), chuSoHuu(userId)))
      .limit(1);
    if (!row) return { ok: false, ma: "NOT_FOUND" };
    if (Number(row.version) !== y.expectedVersion) return { ok: false, ma: "CONFLICT", versionHienTai: Number(row.version) };
    const turns = locLuot([...locLuot(row.turns), ...them]);
    const ra = await db
      .update(aiCodingSessions)
      .set({
        turns,
        turnCount: turns.length,
        title: row.title === "" ? nhanTuLuot(turns) : row.title,
        ...(pct !== null ? { contextPct: pct } : {}),
        version: sql`${aiCodingSessions.version} + 1`,
        updatedAt: new Date(),
      })
      // ★ điều kiện version TRONG câu UPDATE ⇒ hai tab ghi song song không mất cập nhật
      .where(and(eq(aiCodingSessions.id, y.sessionId), chuSoHuu(userId), eq(aiCodingSessions.version, y.expectedVersion)))
      .returning({ version: aiCodingSessions.version });
    if (!ra[0]) return { ok: false, ma: "CONFLICT", versionHienTai: await versionHienTai(userId, y.sessionId) };
    return { ok: true, version: Number(ra[0].version), turnCount: turns.length };
  } catch (err) {
    canhBao("themLuot", err);
    return { ok: false, ma: "LOI" };
  }
}

export async function doiTen(userId: number, y: { sessionId: string; title: unknown; expectedVersion?: number }): Promise<KetQuaPhien<{ title: string }>> {
  if (!hopLeUser(userId) || !laIdPhienHopLe(y.sessionId)) return { ok: false, ma: "NOT_FOUND" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "LOI" };
  try {
    let title = lamSachTen(y.title);
    if (title === "") {
      const [row] = await db.select({ turns: aiCodingSessions.turns }).from(aiCodingSessions).where(and(eq(aiCodingSessions.id, y.sessionId), chuSoHuu(userId))).limit(1);
      if (!row) return { ok: false, ma: "NOT_FOUND" };
      title = nhanTuLuot(locLuot(row.turns));
    }
    const ra = await db
      .update(aiCodingSessions)
      .set({ title })
      .where(
        and(
          eq(aiCodingSessions.id, y.sessionId),
          chuSoHuu(userId),
          ...(y.expectedVersion !== undefined ? [eq(aiCodingSessions.version, y.expectedVersion)] : []),
        ),
      )
      .returning({ id: aiCodingSessions.id });
    if (ra.length > 0) return { ok: true, title };
    const v = await versionHienTai(userId, y.sessionId);
    return v === undefined ? { ok: false, ma: "NOT_FOUND" } : { ok: false, ma: "CONFLICT", versionHienTai: v };
  } catch (err) {
    canhBao("doiTen", err);
    return { ok: false, ma: "LOI" };
  }
}

/** Xoá phiên CỦA CHÍNH MÌNH. KHÔNG đụng `ai_agent_runs`. */
export async function xoa(userId: number, sessionId: string): Promise<KetQuaPhien<Record<string, never>>> {
  if (!hopLeUser(userId) || !laIdPhienHopLe(sessionId)) return { ok: false, ma: "NOT_FOUND" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "LOI" };
  try {
    const ra = await db.delete(aiCodingSessions).where(and(eq(aiCodingSessions.id, sessionId), chuSoHuu(userId))).returning({ id: aiCodingSessions.id });
    return ra.length > 0 ? { ok: true } : { ok: false, ma: "NOT_FOUND" };
  } catch (err) {
    canhBao("xoa", err);
    return { ok: false, ma: "LOI" };
  }
}

/** Nhân bản: sao `turns`/kind/project/source/coLuotNgoai; `parentSessionId` = gốc (FK kép cùng chủ). */
export async function nhanBan(userId: number, sessionId: string): Promise<KetQuaPhien<{ id: string }>> {
  if (!hopLeUser(userId) || !laIdPhienHopLe(sessionId)) return { ok: false, ma: "NOT_FOUND" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "LOI" };
  try {
    if ((await demPhien(userId)) >= TRAN_PHIEN_MOI_NGUOI) return { ok: false, ma: "QUA_TRAN_PHIEN" };
    const r = (await db.execute(sql`
      INSERT INTO ai_coding_sessions ("userId", "projectId", title, turns, "turnCount", kind, source, "parentSessionId", "coLuotNgoai", "contextPct")
      SELECT "userId", "projectId", LEFT(title || ' (bản sao)', 200), turns, "turnCount", kind, source, id, "coLuotNgoai", "contextPct"
        FROM ai_coding_sessions
       WHERE id = ${sessionId}::uuid AND "userId" = ${userId} AND kind IN ('coding', 'agent')
      RETURNING id`)) as unknown as Array<{ id: string }>;
    return r[0] ? { ok: true, id: String(r[0].id) } : { ok: false, ma: "NOT_FOUND" };
  } catch (err) {
    canhBao("nhanBan", err);
    return { ok: false, ma: "LOI" };
  }
}

/** UX-C06: mở phiên MỚI mang tóm tắt (cùng kind/dự án/nguồn, `parentSessionId` = phiên cũ, `coLuotNgoai` sao nguyên). Phiên cũ giữ nguyên. */
export async function nopTomTat(userId: number, y: { sessionId: string; expectedVersion: number; tomTat: string }): Promise<KetQuaPhien<{ id: string }>> {
  if (!hopLeUser(userId) || !laIdPhienHopLe(y.sessionId) || !Number.isInteger(y.expectedVersion) || y.expectedVersion < 1) return { ok: false, ma: "THAM_SO_SAI" };
  if (typeof y.tomTat !== "string" || y.tomTat.trim() === "" || y.tomTat.length > TRAN_KY_TU_TOM_TAT_PHIEN) return { ok: false, ma: "THAM_SO_SAI" };
  const turns = locLuot([{ role: "assistant", content: `[tóm tắt phiên trước — nội dung do client nộp, chưa xác minh]\n${y.tomTat.trim()}` }]);
  if (turns.length === 0) return { ok: false, ma: "THAM_SO_SAI" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "LOI" };
  try {
    if ((await demPhien(userId)) >= TRAN_PHIEN_MOI_NGUOI) return { ok: false, ma: "QUA_TRAN_PHIEN" };
    const r = (await db.execute(sql`
      INSERT INTO ai_coding_sessions ("userId", "projectId", title, turns, "turnCount", kind, source, "parentSessionId", "coLuotNgoai")
      SELECT "userId", "projectId", LEFT('Tóm tắt: ' || title, 200), ${JSON.stringify(turns)}::jsonb, ${turns.length}, kind, source, id, "coLuotNgoai"
        FROM ai_coding_sessions
       WHERE id = ${y.sessionId}::uuid AND "userId" = ${userId} AND kind IN ('coding', 'agent') AND version = ${y.expectedVersion}
      RETURNING id`)) as unknown as Array<{ id: string }>;
    if (r[0]) return { ok: true, id: String(r[0].id) };
    const v = await versionHienTai(userId, y.sessionId);
    return v === undefined ? { ok: false, ma: "NOT_FOUND" } : { ok: false, ma: "CONFLICT", versionHienTai: v };
  } catch (err) {
    canhBao("nopTomTat", err);
    return { ok: false, ma: "LOI" };
  }
}

/**
 * Gắn lượt agent vào phiên (HOST gọi khi lượt kết thúc; client không gọi). Kiểm lúc GHI: phiên VÀ lượt thuộc CHÍNH userId, cùng dự án,
 * chưa quá trần, chưa có trong mảng.
 */
export async function ganLuotChay(userId: number, y: { sessionId: string; runId: string }): Promise<boolean> {
  if (!hopLeUser(userId) || !laIdPhienHopLe(y.sessionId) || !RE_UUID.test(y.runId)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const r = (await db.execute(sql`
      UPDATE ai_coding_sessions s
         SET "runIds" = s."runIds" || to_jsonb(${y.runId}::text), "updatedAt" = now()
       WHERE s.id = ${y.sessionId}::uuid AND s."userId" = ${userId} AND s.kind IN ('coding', 'agent')
         AND jsonb_array_length(s."runIds") < ${TRAN_LUOT_CHAY_MOI_PHIEN}
         AND NOT (s."runIds" @> to_jsonb(${y.runId}::text))
         AND EXISTS (SELECT 1 FROM ai_agent_runs r WHERE r.id = ${y.runId}::uuid AND r."userId" = ${userId} AND r."projectId" = s."projectId")
      RETURNING s.id`)) as unknown as unknown[];
    return r.length > 0;
  } catch (err) {
    canhBao("ganLuotChay", err);
    return false;
  }
}
