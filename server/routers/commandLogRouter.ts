/**
 * Sprint G2.2a — Command Audit Log router (READ-ONLY).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This router is QUERY-ONLY over the append-only command_log table. It has NO
 *     mutations, does NOT import commandDispatcher, and has NO driver write path.
 *     It surfaces the audit trail of every command the dispatcher handled
 *     (rejected/failed/simulated/sent/acked/...), across hitl + interlock triggers.
 * RBAC via module 'machine_control': all endpoints → canView.
 *
 * SCADA R1b-2b-2b A — C1 (KD-2bA 1.1, điều phối 2026-10-27 — THAY ĐỔI HÀNH VI NHÌN THẤY ĐƯỢC): `list` / `get` / `nhatKy` che CHI TIẾT
 * KỸ THUẬT (`ackValue`, `errorText`) cho người không phải admin / engineer có `machine_control.canEdit` (`duocXemChiTietKyThuat`,
 * `_chiTietKyThuat.ts`). Thay vào: `ledger` / `intentId` (vai của hàng trong sổ ghi trước — không phải chi tiết kỹ thuật), `maLoi` (MÃ lý
 * do, tiền tố `MA:` của errorText) và `loiBiChe` (true ⇔ có errorText bị che) để giao diện hiện MÃ, không trống im lặng.
 * `nhatKy` (hợp đồng Phần B B-T8): nhật ký gộp lệnh (`command_log`, không hàng intent) + lần thử (`scada_command_attempts`, kể cả bị từ
 * chối), sau `MOD_OT_CONTROL` (Q3), phân trang con trỏ tuyến tính (at µs, nguồn, id SỐ — KD-2bA 1.2).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { appError } from "../_core/appError";
import { and, eq, gte, lte, desc, sql, isNotNull, isNull, inArray, or, type SQL } from "drizzle-orm";
import { router, protectedProcedure, moduleGate } from "../_core/trpc";
import { requirePermission, getUserAssignmentCodes } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { commandLog, deviceAdapters, scadaCommandAttempts, userFactoryAssignments, users, type CommandLog } from "../../drizzle/schema";
import { adapterTrongPhamVi, dieuKienLenhTrongPhamVi, idsMayTrongPhamVi, mayTrongPhamVi } from "./_adapterPhamVi";
import { chiTietKyThuatCua, maLoiCua } from "./_chiTietKyThuat";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return db;
}

const triggerKindEnum = z.enum(["hitl", "interlock"]);
const statusEnum = z.enum([
  "simulated", "sent", "acked", "failed", "timeout", "rejected", "acked_verified", "acked_unverified",
]);

// ─── C1 — che chi tiết kỹ thuật của một hàng command_log (list / get) ─────────────────────────────────────────────────────────────
/** Hình một hàng `commandLog.list|get` sau khi che: cột cũ giữ nguyên tên (ackValue / errorText = null khi bị che) + 4 trường suy ra. */
export type HangLenhDaChe = CommandLog & {
  /** `ackValue.ledger` ("intent" | "result" | "late_result" …) — vai của hàng trong sổ ghi trước; null = không đánh dấu */
  ledger: string | null;
  /** `ackValue.intentId` (số) — kết quả của intent nào; null = không có */
  intentId: number | null;
  /** MÃ lý do (tiền tố `MA:` của errorText) — có cả khi errorText bị che */
  maLoi: string | null;
  /** true ⇔ errorText CÓ nhưng bị che (người xem không phải admin / engineer có canEdit) — giao diện hiện mã + "chi tiết bị ẩn" */
  loiBiChe: boolean;
};

/** Che MỘT hàng theo luật `duocXemChiTietKyThuat` (đã tính sẵn: `duocXem`). */
export function cheHangLenh(row: CommandLog, duocXem: boolean): HangLenhDaChe {
  const ack = (row.ackValue && typeof row.ackValue === "object" && !Array.isArray(row.ackValue) ? row.ackValue : null) as { ledger?: unknown; intentId?: unknown } | null;
  const ledger = typeof ack?.ledger === "string" ? ack.ledger : null;
  const iid = ack?.intentId;
  const intentId = typeof iid === "number" && Number.isSafeInteger(iid) ? iid : typeof iid === "string" && /^[0-9]{1,15}$/.test(iid) ? Number(iid) : null;
  return {
    ...row,
    ackValue: duocXem ? row.ackValue : null,
    errorText: duocXem ? row.errorText : null,
    ledger,
    intentId,
    maLoi: maLoiCua(row.errorText),
    loiBiChe: !duocXem && row.errorText != null,
  };
}

// ─── C1 — commandLog.nhatKy ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Tên hiển thị của người ngoài phạm vi người xem (KD-2bA 1.4) — kèm `nguoi.ngoaiPhamVi: true` để giao diện dịch. */
export const TEN_NGUOI_NGOAI_PHAM_VI = "quản trị";

/** Hạng nguồn trong thứ tự phụ (KD-2bA 1.2): cùng `at` ⇒ NGUỒN trước (giảm dần: thu rồi lenh), rồi id SỐ giảm dần. */
const HANG_NGUON = { lenh: 0, thu: 1 } as const;
type Nguon = keyof typeof HANG_NGUON;

/**
 * Mốc thời gian µs dạng chữ số CỐ ĐỊNH 20 ký tự `YYYYMMDDHHMMSSuuuuuu` (UTC): so chuỗi = so thời gian, đủ µs (không qua Date — ms).
 * `command_log.createdAt` là cột KHÔNG múi giờ — coi là UTC, cùng cách drizzle typed đọc nó (`list` trả Date UTC).
 */
const AT_LENH = sql<string>`to_char(${commandLog.createdAt}, 'YYYYMMDDHH24MISSUS')`;
const AT_THU = sql<string>`to_char(${scadaCommandAttempts.at} AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS')`;

interface ConTro {
  /** 20 chữ số */
  at: string;
  nguon: Nguon;
  id: number;
}

const conTroHong = () => appError("BAD_REQUEST", "INVALID_VALUE", { field: "conTro" }, "Con trỏ phân trang không hợp lệ.");

/** base64url của `${at20}.${l|t}.${id}` (≤ 56 ký tự). */
export function maHoaConTro(c: ConTro): string {
  return Buffer.from(`${c.at}.${c.nguon === "lenh" ? "l" : "t"}.${c.id}`, "utf8").toString("base64url");
}

/** Giải con trỏ; hỏng (bảng chữ, hình, ngày giờ không có thật) ⇒ BAD_REQUEST INVALID_VALUE {field: "conTro"}. */
export function giaiConTro(s: string): ConTro {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw conTroHong();
  const t = Buffer.from(s, "base64url").toString("utf8");
  const m = /^(\d{20})\.([lt])\.([1-9]\d{0,14})$/.exec(t);
  if (!m) throw conTroHong();
  const a = m[1];
  const [y, mo, d, h, mi, se] = [a.slice(0, 4), a.slice(4, 6), a.slice(6, 8), a.slice(8, 10), a.slice(10, 12), a.slice(12, 14)].map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (
    y < 1970 ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d ||
    dt.getUTCHours() !== h ||
    dt.getUTCMinutes() !== mi ||
    dt.getUTCSeconds() !== se
  ) {
    throw conTroHong();
  }
  return { at: a, nguon: m[2] === "l" ? "lenh" : "thu", id: Number(m[3]) };
}

/** `YYYYMMDDHHMMSSuuuuuu` → `YYYY-MM-DD HH:MM:SS.uuuuuu` (cast `::timestamp` CHÍNH XÁC tới µs). */
const atSangTs = (a: string) => `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)} ${a.slice(8, 10)}:${a.slice(10, 12)}:${a.slice(12, 14)}.${a.slice(14)}`;
/** `YYYYMMDDHHMMSSuuuuuu` → ISO 8601 có µs, `Z`. */
const atSangIso = (a: string) => `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}T${a.slice(8, 10)}:${a.slice(10, 12)}:${a.slice(12, 14)}.${a.slice(14)}Z`;

/**
 * Vị từ "SAU con trỏ" theo thứ tự GIẢM DẦN (at, hạng nguồn, id) cho MỘT nguồn có hạng cố định `hang`:
 *   hang < hạng con trỏ ⇒ at ≤ c.at · hang = ⇒ at < c.at HOẶC (at = c.at VÀ id < c.id) · hang > ⇒ at < c.at.
 * So id là so SỐ (cột số), không bao giờ so chuỗi ("lenh:12" < "lenh:9"). `ts` = hằng thời gian của con trỏ đúng KIỂU của cột.
 */
function sauConTro(c: ConTro | null, hang: number, cotAt: SQL | typeof commandLog.createdAt | typeof scadaCommandAttempts.at, cotId: typeof commandLog.id | typeof scadaCommandAttempts.id, ts: (c: ConTro) => SQL): SQL | undefined {
  if (!c) return undefined;
  const hc = HANG_NGUON[c.nguon];
  if (hang < hc) return sql`${cotAt} <= ${ts(c)}`;
  if (hang > hc) return sql`${cotAt} < ${ts(c)}`;
  return sql`(${cotAt} < ${ts(c)} OR (${cotAt} = ${ts(c)} AND ${cotId} < ${c.id}))`;
}
const tsNaive = (c: ConTro): SQL => sql`${atSangTs(c.at)}::timestamp`;
const tsUtc = (c: ConTro): SQL => sql`(${atSangTs(c.at)}::timestamp AT TIME ZONE 'UTC')`;

/** So hai hàng theo thứ tự GIẢM DẦN (at, hạng nguồn, id số): âm ⇒ a đứng trước. */
export function soThuTu(a: { at: string; nguon: Nguon; idSo: number }, b: { at: string; nguon: Nguon; idSo: number }): number {
  if (a.at !== b.at) return a.at > b.at ? -1 : 1;
  if (a.nguon !== b.nguon) return HANG_NGUON[b.nguon] - HANG_NGUON[a.nguon];
  return b.idSo - a.idSo;
}

/** Một hàng của `commandLog.nhatKy` (HỢP ĐỒNG — Phần B B-T8). */
export interface HangNhatKy {
  nguon: Nguon;
  /** "lenh:<command_log.id>" | "thu:<scada_command_attempts.id>" */
  id: string;
  /** ISO 8601 có µs, UTC — lenh = createdAt, thu = at */
  at: string;
  machineId: number | null;
  adapterId: number | null;
  adapterCode: string | null;
  /** adapter protocol === "stub" (mục 10) */
  laStub: boolean;
  tagKey: string | null;
  /** chỉ lenh */
  commandType: string | null;
  /** lenh: status · thu: `${stage}:${outcome}` */
  trangThai: string;
  /** lenh: MÃ (tiền tố `MA:` của errorText, có cả khi bị che) · thu: reason_code */
  reasonCode: string | null;
  /** thu: ly_do · lenh: null */
  lyDo: string | null;
  /** KHÔNG email. Người ngoài phạm vi người xem ⇒ ten "quản trị", ngoaiPhamVi true (KD-2bA 1.4) */
  nguoi: { id: number; ten: string | null; ngoaiPhamVi: boolean } | null;
  triggerKind: "hitl" | "interlock" | null;
  /** lenh: requestedValue · thu: requested_value */
  giaTri: unknown | null;
  /** thu → lenh liên kết; lenh: [] */
  commandLogIds: number[];
  /** lenh: actionId · thu: request_id */
  requestId: string | null;
  /** errorText — CHỈ khi duocXemChiTietKyThuat, ngược lại null */
  loi: string | null;
  /** true ⇔ hàng lenh CÓ errorText nhưng bị che (giao diện hiện reasonCode + "chi tiết bị ẩn") */
  loiBiChe: boolean;
}

export interface KetQuaNhatKy {
  hang: HangNhatKy[];
  /** trang sau; null = hết */
  conTro: string | null;
}

/** machineId đã xác minh (máy chủ ghi) của một lần thử `adapter_id` NULL — chuỗi số ≤ 9 chữ số, khác ⇒ NULL (khuôn oversight posture). */
const MAY_CUA_THU = sql`CASE WHEN (${scadaCommandAttempts.requestedValue}->>'machineId') ~ '^[0-9]{1,9}$' THEN (${scadaCommandAttempts.requestedValue}->>'machineId')::int END`;
const DA_XAC_MINH_THU = sql`(${scadaCommandAttempts.requestedValue}->>'daXacMinhPhamVi') = 'true'`;
const adapterCuaMay = (ids: number[]) => sql`(select ${deviceAdapters.id} from ${deviceAdapters} where ${inArray(deviceAdapters.machineId, ids.length > 0 ? ids : [-1])})`;

/**
 * Phạm vi trên `scada_command_attempts` (Q4, cùng luật `oversight.posture` STOP quá hạn): `adapter_id` có ⇒ adapter gắn máy trong phạm vi;
 * `adapter_id` NULL ⇒ CHỈ khi `requested_value.daXacMinhPhamVi = true` (máy chủ ghi sau khi máy qua kiểm phạm vi — lenhHmi `tuChoiQuaHan`)
 * VÀ `requested_value.machineId` trong phạm vi. Còn lại (NULL máy, chưa xác minh, dòng tổng kết DIEU_TIET …) chỉ toàn quyền thấy.
 * `undefined` khi toàn quyền.
 */
export function dieuKienThuTrongPhamVi(idsMay: number[] | null): SQL | undefined {
  if (idsMay === null) return undefined;
  const ids = idsMay.length > 0 ? idsMay : [-1];
  return or(
    and(isNotNull(scadaCommandAttempts.adapterId), inArray(scadaCommandAttempts.adapterId, adapterCuaMay(ids))),
    and(isNull(scadaCommandAttempts.adapterId), DA_XAC_MINH_THU, inArray(MAY_CUA_THU, ids)),
  );
}

const soHoacNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : typeof v === "string" && /^[0-9]{1,9}$/.test(v) ? Number(v) : null;

const nhatKyInput = z
  .object({
    machineId: z.number().int().positive().optional(),
    adapterId: z.number().int().positive().optional(),
    nguon: z.enum(["tat_ca", "lenh", "thu"]).default("tat_ca"),
    trangThai: z.array(statusEnum).max(8).optional(),
    tu: z.coerce.date().optional(),
    den: z.coerce.date().optional(),
    conTro: z.string().max(64).optional(),
    gioiHan: z.number().int().min(1).max(200).default(50),
  })
  .strict();

interface HangTam {
  nguon: Nguon;
  at: string;
  idSo: number;
  userId: number | null;
  adapterId: number | null;
  /** lenh: command_log.machineId · thu (adapter NULL, đã xác minh): requested_value.machineId */
  machineIdCot: number | null;
  ra: Omit<HangNhatKy, "adapterCode" | "laStub" | "nguoi" | "machineId" | "adapterId">;
}

export const commandLogRouter = router({
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      adapterId: z.number().int().positive().optional(),
      triggerKind: triggerKindEnum.optional(),
      status: statusEnum.optional(),
      since: z.coerce.date().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const conds = [];
      // phạm vi nhà máy (rà bảo mật 2026-10-24): chỉ lệnh của máy/adapter trong phạm vi; lọc id ngoài phạm vi ≡ NOT_FOUND
      if (input?.machineId != null) await mayTrongPhamVi(ctx, input.machineId);
      if (input?.adapterId != null) await adapterTrongPhamVi(ctx, input.adapterId);
      const cong = dieuKienLenhTrongPhamVi(await idsMayTrongPhamVi(ctx));
      if (cong) conds.push(cong);
      if (input?.machineId != null) conds.push(eq(commandLog.machineId, input.machineId));
      if (input?.adapterId != null) conds.push(eq(commandLog.adapterId, input.adapterId));
      if (input?.triggerKind != null) conds.push(eq(commandLog.triggerKind, input.triggerKind));
      if (input?.status != null) conds.push(eq(commandLog.status, input.status));
      if (input?.since != null) conds.push(gte(commandLog.createdAt, input.since));
      const rows = await db
        .select()
        .from(commandLog)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(commandLog.createdAt))
        .limit(input?.limit ?? 100);
      // C1 (KD-2bA 1.1) — chi tiết kỹ thuật chỉ cho admin / engineer có canEdit
      const duocXem = await chiTietKyThuatCua(ctx);
      return rows.map((r) => cheHangLenh(r, duocXem));
    }),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const cong = dieuKienLenhTrongPhamVi(await idsMayTrongPhamVi(ctx)); // phạm vi nhà máy (rà bảo mật 2026-10-24)
      const [row] = await db.select().from(commandLog).where(and(eq(commandLog.id, input.id), cong)).limit(1);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "commandLog" }, "Command log không tồn tại.");
      return cheHangLenh(row, await chiTietKyThuatCua(ctx)); // C1 (KD-2bA 1.1)
    }),

  /**
   * SCADA R1b-2b-2b A — C1 (M9 + mục 10; HỢP ĐỒNG Phần B B-T8): nhật ký lệnh `/scada/journal`.
   *   • Cổng: `MOD_OT_CONTROL` (Q3) + `machine_control.canView`. Đọc, không ghi, không audit; giới hạn chung `apiLimiter`.
   *   • Phạm vi: `machineId` / `adapterId` client gửi kiểm TRƯỚC (`mayTrongPhamVi` / `adapterTrongPhamVi`) — ngoài phạm vi ≡ không tồn tại
   *     (NOT_FOUND `machine` / `adapter`). Hàng lenh: `dieuKienLenhTrongPhamVi`; hàng thu: `dieuKienThuTrongPhamVi` (Q4).
   *   • Không hàng intent (`ackValue.ledger = 'intent'`, cùng vị từ `stats`). Lần thử bị từ chối CÓ (nguồn `thu`).
   *   • Gộp hai nguồn theo (at DESC, nguồn, id DESC — id SỐ); mỗi nguồn `gioiHan + 1` hàng sau con trỏ, gộp, cắt.
   *   • `trangThai` lọc status của lenh; với thu chỉ "rejected" có nghĩa (outcome = rejected) — không có "rejected" ⇒ không hàng thu.
   *   • `loi` (errorText) chỉ khi `duocXemChiTietKyThuat`; ackValue KHÔNG BAO GIỜ ra.
   */
  nhatKy: protectedProcedure
    .use(moduleGate("MOD_OT_CONTROL"))
    .use(requirePermission("machine_control", "canView"))
    .input(nhatKyInput)
    .query(async ({ input, ctx }): Promise<KetQuaNhatKy> => {
      const conTro = input.conTro != null ? giaiConTro(input.conTro) : null;
      // phạm vi — id client gửi kiểm trước (ngoài phạm vi ≡ không tồn tại)
      if (input.machineId != null) await mayTrongPhamVi(ctx, input.machineId);
      if (input.adapterId != null) await adapterTrongPhamVi(ctx, input.adapterId);
      const idsMay = await idsMayTrongPhamVi(ctx);
      const db = await getDb();
      const gioiHan = input.gioiHan;
      const duocXem = await chiTietKyThuatCua(ctx);
      // lọc trạng thái RỖNG (không chọn trạng thái nào) ⇒ không hàng nào (không phải "không lọc")
      if (input.trangThai != null && input.trangThai.length === 0) return { hang: [], conTro: null };

      const tam: HangTam[] = [];

      // ── nguồn lenh ──
      if (input.nguon !== "thu") {
        const notIntent = sql`coalesce(${commandLog.ackValue} ->> 'ledger', '') <> 'intent'`;
        const rows = await db
          .select({
            id: commandLog.id,
            at: AT_LENH,
            machineId: commandLog.machineId,
            adapterId: commandLog.adapterId,
            tagKey: commandLog.tagKey,
            commandType: commandLog.commandType,
            status: commandLog.status,
            triggerKind: commandLog.triggerKind,
            requestedValue: commandLog.requestedValue,
            requestedBy: commandLog.requestedBy,
            actionId: commandLog.actionId,
            errorText: commandLog.errorText,
          })
          .from(commandLog)
          .where(
            and(
              dieuKienLenhTrongPhamVi(idsMay),
              notIntent,
              input.machineId != null ? or(eq(commandLog.machineId, input.machineId), inArray(commandLog.adapterId, adapterCuaMay([input.machineId]))) : undefined,
              input.adapterId != null ? eq(commandLog.adapterId, input.adapterId) : undefined,
              input.trangThai != null ? inArray(commandLog.status, input.trangThai) : undefined,
              input.tu != null ? gte(commandLog.createdAt, input.tu) : undefined,
              input.den != null ? lte(commandLog.createdAt, input.den) : undefined,
              sauConTro(conTro, HANG_NGUON.lenh, commandLog.createdAt, commandLog.id, tsNaive),
            ),
          )
          .orderBy(desc(commandLog.createdAt), desc(commandLog.id))
          .limit(gioiHan + 1);
        for (const r of rows) {
          tam.push({
            nguon: "lenh",
            at: r.at,
            idSo: r.id,
            userId: r.requestedBy > 0 ? r.requestedBy : null,
            adapterId: r.adapterId,
            machineIdCot: r.machineId ?? null,
            ra: {
              nguon: "lenh",
              id: `lenh:${r.id}`,
              at: atSangIso(r.at),
              tagKey: r.tagKey ?? null,
              commandType: r.commandType ?? null,
              trangThai: r.status,
              reasonCode: maLoiCua(r.errorText),
              lyDo: null,
              triggerKind: r.triggerKind ?? null,
              giaTri: r.requestedValue ?? null,
              commandLogIds: [],
              requestId: r.actionId ?? null,
              loi: duocXem ? (r.errorText ?? null) : null,
              loiBiChe: !duocXem && r.errorText != null,
            },
          });
        }
      }

      // ── nguồn thu ──
      const thuCoNghia = input.trangThai == null || input.trangThai.includes("rejected");
      if (input.nguon !== "lenh" && thuCoNghia) {
        const a = scadaCommandAttempts;
        const rows = await db
          .select({
            id: a.id,
            at: AT_THU,
            requestId: a.requestId,
            userId: a.userId,
            adapterId: a.adapterId,
            tagKey: a.tagKey,
            requestedValue: a.requestedValue,
            stage: a.stage,
            outcome: a.outcome,
            reasonCode: a.reasonCode,
            lyDo: a.lyDo,
            commandLogIds: a.commandLogIds,
            mayXacMinh: sql<number | null>`CASE WHEN ${a.adapterId} IS NULL AND ${DA_XAC_MINH_THU} THEN ${MAY_CUA_THU} END`,
          })
          .from(a)
          .where(
            and(
              dieuKienThuTrongPhamVi(idsMay),
              input.machineId != null
                ? or(inArray(a.adapterId, adapterCuaMay([input.machineId])), and(isNull(a.adapterId), sql`${MAY_CUA_THU} = ${input.machineId}`))
                : undefined,
              input.adapterId != null ? eq(a.adapterId, input.adapterId) : undefined,
              input.trangThai != null ? eq(a.outcome, "rejected") : undefined,
              input.tu != null ? gte(a.at, input.tu) : undefined,
              input.den != null ? lte(a.at, input.den) : undefined,
              sauConTro(conTro, HANG_NGUON.thu, a.at, a.id, tsUtc),
            ),
          )
          .orderBy(desc(a.at), desc(a.id))
          .limit(gioiHan + 1);
        for (const r of rows) {
          const idSo = Number(r.id);
          tam.push({
            nguon: "thu",
            at: r.at,
            idSo,
            userId: r.userId > 0 ? r.userId : null,
            adapterId: r.adapterId ?? null,
            machineIdCot: soHoacNull(r.mayXacMinh),
            ra: {
              nguon: "thu",
              id: `thu:${idSo}`,
              at: atSangIso(r.at),
              tagKey: r.tagKey ?? null,
              commandType: null,
              trangThai: `${r.stage}:${r.outcome}`,
              reasonCode: r.reasonCode ?? null,
              lyDo: r.lyDo ?? null,
              triggerKind: null,
              giaTri: r.requestedValue ?? null,
              commandLogIds: (r.commandLogIds ?? []).map(Number),
              requestId: r.requestId ?? null,
              loi: null,
              loiBiChe: false,
            },
          });
        }
      }

      tam.sort(soThuTu);
      const trang = tam.slice(0, gioiHan);
      const conTroSau = tam.length > gioiHan && trang.length > 0 ? maHoaConTro({ at: trang[trang.length - 1].at, nguon: trang[trang.length - 1].nguon, id: trang[trang.length - 1].idSo }) : null;

      // adapter của trang (mã + stub + máy) — một truy vấn
      const idsAdapter = [...new Set(trang.map((t) => t.adapterId).filter((x): x is number => x != null))];
      const adapter = new Map<number, { code: string; protocol: string; machineId: number | null }>();
      if (idsAdapter.length > 0) {
        for (const r of await db
          .select({ id: deviceAdapters.id, code: deviceAdapters.code, protocol: deviceAdapters.protocol, machineId: deviceAdapters.machineId })
          .from(deviceAdapters)
          .where(inArray(deviceAdapters.id, idsAdapter))) {
          adapter.set(r.id, { code: r.code, protocol: String(r.protocol), machineId: r.machineId ?? null });
        }
      }

      // người của trang — tên (KHÔNG email) + ai nằm trong phạm vi người xem (KD-2bA 1.4; luật `nguoiTrongPhamViTool`: chính mình + người gán
      // CÙNG mã nhà máy; toàn quyền ⇒ mọi người)
      const idsNguoi = [...new Set(trang.map((t) => t.userId).filter((x): x is number => x != null))];
      const ten = new Map<number, string | null>();
      let thayDuoc: Set<number> | null = null;
      if (idsNguoi.length > 0) {
        for (const r of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, idsNguoi))) ten.set(r.id, r.name ?? null);
        if (idsMay !== null) {
          thayDuoc = new Set([ctx.user.id]);
          const g = await getUserAssignmentCodes(ctx.user.id, ctx.user.role);
          if (!g.isAdmin && g.factoryCodes.length > 0) {
            for (const r of await db
              .select({ userId: userFactoryAssignments.userId })
              .from(userFactoryAssignments)
              .where(and(inArray(userFactoryAssignments.userId, idsNguoi), inArray(userFactoryAssignments.factoryCode, g.factoryCodes)))) {
              thayDuoc.add(r.userId);
            }
          } else if (g.isAdmin) thayDuoc = null;
        }
      }

      const hang: HangNhatKy[] = trang.map((t) => {
        const ad = t.adapterId != null ? adapter.get(t.adapterId) : undefined;
        const nguoi =
          t.userId == null
            ? null
            : thayDuoc === null || thayDuoc.has(t.userId)
              ? { id: t.userId, ten: ten.get(t.userId) ?? null, ngoaiPhamVi: false }
              : { id: t.userId, ten: TEN_NGUOI_NGOAI_PHAM_VI, ngoaiPhamVi: true };
        return {
          ...t.ra,
          machineId: t.machineIdCot ?? ad?.machineId ?? null,
          adapterId: t.adapterId,
          adapterCode: ad?.code ?? null,
          laStub: ad?.protocol === "stub",
          nguoi,
        };
      });
      return { hang, conTro: conTroSau };
    }),

  /**
   * doc 81 Đợt 1B Task 6 fix round 1 — since the write-ahead ledger every REAL write is TWO rows
   * (an INTENT `status='sent', ackValue.ledger='intent'` inserted before the device write, then
   * its RESULT row). byStatus/byTrigger therefore count COMMANDS only (intent rows excluded —
   * otherwise each real write counted twice); intents get their own category:
   *   intents.total — write-ahead intents in the window;
   *   intents.open  — intents with NO linked result row (in flight, or the process died between
   *                   the device write and the result: outcome UNKNOWN — worth an operator look).
   * `adapterId` (optional) narrows every count to one adapter.
   */
  stats: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({
      sinceHours: z.number().int().min(1).max(24 * 90).default(24),
      adapterId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const since = new Date(Date.now() - (input?.sinceHours ?? 24) * 3600 * 1000);
      // phạm vi nhà máy (rà bảo mật 2026-10-24): adapter chỉ định ngoài phạm vi ⇒ trả rỗng (không phải NOT_FOUND: thống kê, không lộ tồn tại); không chỉ định ⇒ chỉ lệnh trong phạm vi
      const idsMay = await idsMayTrongPhamVi(ctx);
      if (input?.adapterId != null) {
        try { await adapterTrongPhamVi(ctx, input.adapterId); } catch {
          return { byStatus: [], byTrigger: [], intents: { total: 0, open: 0 } };
        }
      }
      const inWindow = and(
        dieuKienLenhTrongPhamVi(idsMay),
        gte(commandLog.createdAt, since),
        input?.adapterId != null ? eq(commandLog.adapterId, input.adapterId) : undefined,
      );
      const isIntent = sql`coalesce(${commandLog.ackValue} ->> 'ledger', '') = 'intent'`;
      const notIntent = sql`coalesce(${commandLog.ackValue} ->> 'ledger', '') <> 'intent'`;
      const byStatus = await db
        .select({ status: commandLog.status, count: sql<number>`count(*)::int` })
        .from(commandLog)
        .where(and(inWindow, notIntent))
        .groupBy(commandLog.status);
      const byTrigger = await db
        .select({ triggerKind: commandLog.triggerKind, count: sql<number>`count(*)::int` })
        .from(commandLog)
        .where(and(inWindow, notIntent))
        .groupBy(commandLog.triggerKind);
      const [intentRow] = await db
        .select({
          total: sql<number>`count(*)::int`,
          open: sql<number>`(count(*) filter (where not exists (
            select 1 from command_log r where r."ackValue" ->> 'intentId' = "command_log"."id"::text
          )))::int`,
        })
        .from(commandLog)
        .where(and(inWindow, isIntent));
      return { byStatus, byTrigger, intents: { total: intentRow?.total ?? 0, open: intentRow?.open ?? 0 } };
    }),

  /**
   * Thời lượng lệnh TRUNG BÌNH thật, suy ra từ lịch sử (ackedAt − sentAt), gộp theo
   * commandType. Dùng cho cell-twin truyền `commandDurations` vào orchestration.simulate
   * để KPI nhịp chu kỳ dựa trên số liệu thật thay vì mặc định. Read-only; nếu chưa có
   * lịch sử → durations rỗng (twin tự dùng mặc định).
   */
  avgDurations: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ sinceHours: z.number().int().min(1).max(24 * 90).default(24 * 30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const cong = dieuKienLenhTrongPhamVi(await idsMayTrongPhamVi(ctx)); // phạm vi nhà máy (rà bảo mật 2026-10-24)
      const sinceHours = input?.sinceHours ?? 24 * 30;
      const since = new Date(Date.now() - sinceHours * 3600 * 1000);
      const rows = await db
        .select({
          commandType: commandLog.commandType,
          avgMs: sql<number>`avg(extract(epoch from (${commandLog.ackedAt} - ${commandLog.sentAt})) * 1000)::float`,
          n: sql<number>`count(*)::int`,
        })
        .from(commandLog)
        .where(
          and(
            cong,
            gte(commandLog.createdAt, since),
            isNotNull(commandLog.sentAt),
            isNotNull(commandLog.ackedAt),
            isNotNull(commandLog.commandType),
            sql`${commandLog.ackedAt} > ${commandLog.sentAt}`,
          ),
        )
        .groupBy(commandLog.commandType);
      const durations: Record<string, number> = {};
      let samples = 0;
      for (const r of rows) {
        if (r.commandType && Number.isFinite(r.avgMs) && r.avgMs > 0) {
          durations[r.commandType] = Math.round(r.avgMs);
          samples += r.n;
        }
      }
      return { durations, samples, sinceHours };
    }),
});
