/**
 * SCADA R1a Task 8 (K1, K5) — LỆNH GHI TAG TỪ HMI, BƯỚC 1: `request` (bản xem trước + khoá chọn + bản ghi chờ TTL 60 s).
 *
 * Router `scadaCommands` (server/routers/scadaCommandsRouter.ts) mỏng: nó lấy danh tính + phạm vi từ `ctx`, gọi `yeuCauGhiTag`,
 * và đổi một `TuChoiYeuCau` thành `appError`. Mọi quyết định nằm ở đây; mọi lần thử đều để lại dấu trong `scada_command_attempts`
 * (WORM — chỉ INSERT). `confirm` (Task 9) dùng lại các cổng 3–7 (`kiemCongKenhVaGiaTri`, `kiemCongVaiTro`, `kiemCongEdge`,
 * `kiemCongCheDo`) trên dữ liệu HIỆN TẠI.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * THỨ TỰ CỔNG (brief Task 8, cố định):
 *   1. cờ `SCADA_COMMANDS_ENABLED`                     ⇒ FEATURE_DISABLED   — KHÔNG ghi attempts (xem QĐ-1)
 *   2. phạm vi máy (idsTrongPhamVi strict)            ⇒ NOT_FOUND          — attempts {user_id, adapter/tag NULL} (QĐ-1)
 *      (2b) gửi lại cùng clientRequestId             ⇒ trả yêu cầu cũ | DA_XU_LY (QĐ-5)
 *   3. tag có + bật + kênh ghi (`writable` + `laKenhGhi`) ⇒ NOT_FOUND (deviceTag) | CHANNEL_READ_ONLY
 *   4. `kiemGiaTriGhi`                                 ⇒ TYPE_MISMATCH | OUT_OF_RANGE | OFF_STEP (+ goiY)
 *   5. sàn vai `vaiTroDuocGhi(muc)` → `machine_control.canEdit` → mức ≥ 4 phải đã đăng ký 2FA
 *                                                      ⇒ ROLE_FLOOR | PERMISSION_DENIED | TOTP_CHUA_DANG_KY
 *   6. adapter do edge sở hữu                          ⇒ EDGE_CHUA_HO_TRO (params: mã edge)
 *   7. `cheDoMay(máy của ADAPTER)` = REMOTE            ⇒ MODE_LOCAL (params: lyDo)
 *   8. `giuKhoaChon`                                   ⇒ DANG_DUOC_CHON | KHOA_CHON_LOI (giuKhoaChon ném)
 *   9. tạo `ai_pending_actions` (tool "hmi.write_tag", TTL 60 s) + attempts `proposed` — CÙNG một transaction ngắn với bước 8.
 *   Sau commit: socket `scada:cmd {requestId, status:"proposed", at}` vào `user:{id}` (chỉ khi tạo MỚI).
 *
 * QUYẾT ĐỊNH (ghi trong báo cáo task 8):
 *   QĐ-1 Cổng 1 không ghi attempts: cờ tắt = công tắc tắt hẳn, router không chạm DB (DB chưa có 0431 vẫn an toàn). Cổng 2 ghi MỘT
 *        dòng {user_id, reason NOT_FOUND, adapter_id/tag_key/requested_value NULL} cho CẢ ba ca (không tồn tại / ngoài phạm vi / adapter
 *        không gắn máy) — dấu vết dò, không lộ adapter. Từ cổng 3 trở đi adapter đã nằm trong phạm vi ⇒ dòng mang adapter + tag.
 *   QĐ-2 Tag không có / đã tắt ⇒ NOT_FOUND (entity deviceTag) — HMI chỉ thấy tag bật. `writable=false` ⇒ CHANNEL_READ_ONLY kể cả khi
 *        channel_kind khai là kênh ghi (dispatch bước 3 cũng đòi writable: từ chối sớm cùng một lý do).
 *   QĐ-3 Thiếu `machine_control.canEdit` ⇒ mã riêng `PERMISSION_DENIED` (không gộp vào ROLE_FLOOR: cách gỡ khác — xin quyền, không đổi vai).
 *   QĐ-4 Băm (`__otPayloadHash`) tính trên giá trị ĐÃ ÉP KIỂU, `commandType "write_tag"`, `machineId` = máy của adapter — đúng cái
 *        Task 9 truyền vào `dispatch()` (argsJson). `lyDo` chỉ lưu ở `previewJson.lyDo` (attempts KHÔNG có cột lyDo; không đổi schema).
 *   QĐ-5 Gửi lại: khoá `idempotencyKey = "hmi:" + userId + ":" + clientRequestId`. Dòng còn `proposed` + chưa hết hạn + CÙNG lệnh
 *        (adapter, tag, giá trị thô) ⇒ trả lại requestId/expiresAt/preview cũ, KHÔNG ghi attempts mới (cùng một lần thử). Ngược lại ⇒
 *        DA_XU_LY (có attempts, request_id = dòng cũ). Hai yêu cầu giống hệt cùng lúc: ràng buộc unique của idempotencyKey quyết;
 *        bên thua (23505) rollback cả khoá lẫn attempts của nó rồi đọc lại dòng của bên thắng.
 *   QĐ-6 `needsTotp`: mức 5 luôn true; mức 4 true trừ khi phiên CÓ sessionToken và cache step-up của phiên còn hạn (chỉ ĐỌC cache —
 *        `confirm` vẫn kiểm lại bằng `kiemXacThucTheoMuc`); mức 1|3 false.
 *   QĐ-7 `current`: bộ đệm tắt / chưa có mẫu ⇒ {v:null,q:"bad",ageMs:null} + KHONG_CO_GIA_TRI_HIEN_TAI; mẫu cũ (stale) ⇒
 *        {v:null,q:"bad",ageMs:tuổi} + GIA_TRI_HIEN_TAI_CU (Review Focus 4). Adapter đang tắt (isEnabled=false) ⇒ cảnh báo ADAPTER_TAT
 *        (không chặn: dispatch quyết).
 *   QĐ-8 Cùng người, yêu cầu MỚI trên cùng kênh: khoá chọn chuyển sang requestId mới (giuKhoaChon cho chính người giữ lấy lại) ⇒
 *        `confirm` của yêu cầu cũ sẽ gặp KHOA_MAT (Task 9). Không tự huỷ dòng chờ cũ — nó tự hết hạn sau 60 s.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { aiPendingActions, deviceAdapters, deviceTags, machines, scadaCommandAttempts, users, type DeviceTag } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../../db/hierarchy";
import { checkPermission } from "../../_core/accessControl";
import { khoaPhienStepUp, stepUpPhienConHan, type UserRole } from "../../_core/trpc";
import { vaiTroDuocGhi } from "../../_core/xacThucTheoMuc";
import { logger } from "../../logger";
import type { MucRuiRo } from "../ot/aiControlGate";
import { isOtControlEnabled } from "../ot/commandDispatcher";
import { isCommissioned, isCommissioningRequired } from "../ot/commissioningService";
import { canonicalOtValue, otPayloadHash, withOtPayloadHash } from "../ot/otActionBinding";
import { isEdgeControlSchemaMissing } from "../edge/edgeControlSchema";
import { boDemDangBat, layGiaTri } from "./boDemHienTai";
import { cheDoMay, TOOL_HMI_GHI_TAG, type LyDoCheDo } from "./cheDoMay";
import { kiemGiaTriGhi, laKenhGhi, mucTacDongKenh } from "./kenhScada";
import { giuKhoaChon, LoiKhoaChonTranhChap } from "./khoaChon";
import { appError } from "../../_core/appError";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** TTL của yêu cầu VÀ của khoá chọn (D4: cùng một mốc). */
export const LENH_HMI_TTL_MS = 60_000;
/** commandType mà `confirm` truyền vào `dispatch()` — một phần của băm. */
export const COMMAND_TYPE_HMI = "write_tag";

export function lenhHmiBat(): boolean {
  return process.env.SCADA_COMMANDS_ENABLED === "true";
}

// ─── Kiểm cấu hình lúc khởi động (điều phối 2026-10-24) ────────────────────────────────────────────────────────────────────────
let daCanhBaoCauHinh = false;

/**
 * SCADA_COMMANDS bật mà bộ đệm giá trị hiện tại tắt ⇒ `cheDoMay` luôn LOCAL (`bo_dem_tat`) ⇒ mọi lệnh HMI bị từ chối. Cảnh báo
 * MỘT lần mỗi tiến trình. Gọi lúc khởi động server, cạnh `khoiDongBoDemHienTai` (server/_core/index.ts).
 */
export function kiemCauHinhLenhHmi(): void {
  if (daCanhBaoCauHinh) return;
  if (!lenhHmiBat() || boDemDangBat()) return;
  daCanhBaoCauHinh = true;
  logger.warn(
    "SCADA_COMMANDS bật nhưng SCADA_LIVE_CACHE_ENABLED tắt — mọi máy coi như LOCAL, mọi lệnh HMI sẽ bị từ chối",
  );
}

// ─── Kiểu ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type MaTuChoiYeuCau =
  | "FEATURE_DISABLED"
  | "NOT_FOUND"
  | "CHANNEL_READ_ONLY"
  | "TYPE_MISMATCH"
  | "OUT_OF_RANGE"
  | "OFF_STEP"
  | "ROLE_FLOOR"
  | "PERMISSION_DENIED"
  | "TOTP_CHUA_DANG_KY"
  | "EDGE_CHUA_HO_TRO"
  | "MODE_LOCAL"
  | "DANG_DUOC_CHON"
  | "KHOA_CHON_LOI"
  | "DA_XU_LY";

/** Một lần từ chối. `thongTin` là tham số cho appError (chỉ nguyên thuỷ) — router chọn câu i18n theo `ma`. */
export type TuChoiYeuCau =
  | { ma: "FEATURE_DISABLED" | "PERMISSION_DENIED" | "KHOA_CHON_LOI" | "DA_XU_LY"; chiTiet: string }
  | { ma: "NOT_FOUND"; chiTiet: string; entity: "adapter" | "deviceTag" }
  | { ma: "CHANNEL_READ_ONLY"; chiTiet: string; tagKey: string }
  | { ma: "TYPE_MISMATCH"; chiTiet: string; tagKey: string; dataType: string }
  | { ma: "OUT_OF_RANGE"; chiTiet: string; tagKey: string; min: number | null; max: number | null }
  | { ma: "OFF_STEP"; chiTiet: string; tagKey: string; step: number; goiY?: number }
  | { ma: "ROLE_FLOOR" | "TOTP_CHUA_DANG_KY"; chiTiet: string; level: MucRuiRo }
  | { ma: "EDGE_CHUA_HO_TRO"; chiTiet: string; edgeCode: string; edgeNodeId: number }
  | { ma: "MODE_LOCAL"; chiTiet: string; lyDo: LyDoCheDo }
  | { ma: "DANG_DUOC_CHON"; chiTiet: string; boiUserId: number; boiTen: string; hetHanLuc: string };

export type GiaTriLenh = number | boolean | string;

export interface BanXemTruoc {
  machine: string;
  channel: string;
  unit: string | null;
  current: { v: number | boolean | string | null; q: "good" | "uncertain" | "bad"; ageMs: number | null };
  requested: GiaTriLenh;
  afterFormula: GiaTriLenh;
  range: { min: number | null; max: number | null; step: number | null } | null;
  level: MucRuiRo;
  needsTotp: boolean;
  mode: "real" | "simulated";
  simulatedReasons: string[];
  route: "central";
  warnings: string[];
}

export interface KetQuaYeuCau {
  requestId: string;
  expiresAt: string;
  preview: BanXemTruoc;
}

export interface NguoiGoiLenh {
  user: { id: number; role: string; twoFactorEnabled?: boolean | null };
  sessionToken?: string | null;
}

export interface DauVaoYeuCau {
  adapterId: number;
  tagKey: string;
  value: GiaTriLenh;
  lyDo: string;
  clientRequestId: string;
}

export type HangAdapterLenh = {
  id: number;
  code: string;
  machineId: number | null;
  isEnabled: boolean;
  machineName: string | null;
  machineCode: string | null;
};

type TagLenh = Pick<
  DeviceTag,
  | "tagKey"
  | "dataType"
  | "unit"
  | "writable"
  | "isEnabled"
  | "channelKind"
  | "displayName"
  | "writeMin"
  | "writeMax"
  | "writeStep"
  | "actuationLevel"
>;

// ─── Nhật ký thử lệnh (WORM) ───────────────────────────────────────────────────────────────────────────────────────────────────
type DbHoacTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function ghiThuLenh(
  d: DbHoacTx,
  dong: {
    requestId?: string | null;
    userId: number;
    adapterId?: number | null;
    tagKey?: string | null;
    requestedValue?: unknown;
    afterFormula?: unknown;
    stage: "request" | "confirm" | "dispatch" | "huy";
    outcome: "rejected" | "proposed" | "confirmed" | "dispatched" | "expired" | "cancelled";
    reasonCode?: string | null;
    commandLogIds?: number[] | null;
  },
): Promise<void> {
  await d.insert(scadaCommandAttempts).values({
    requestId: dong.requestId ?? null,
    userId: dong.userId,
    adapterId: dong.adapterId ?? null,
    tagKey: dong.tagKey ?? null,
    // jsonb: undefined ⇒ NULL tường minh (JSON.stringify(undefined) không phải JSON)
    requestedValue: dong.requestedValue === undefined ? null : dong.requestedValue,
    afterFormula: dong.afterFormula === undefined ? null : dong.afterFormula,
    stage: dong.stage,
    outcome: dong.outcome,
    reasonCode: dong.reasonCode ?? null,
    commandLogIds: dong.commandLogIds ?? null,
  });
}

// ─── Cổng 2: adapter trong phạm vi ─────────────────────────────────────────────────────────────────────────────────────────────
/** Adapter theo id client gửi; null khi KHÔNG tồn tại HOẶC ngoài phạm vi (cùng một kết cục). Không gắn máy ⇒ chỉ phạm vi toàn quyền. */
export async function adapterTrongPhamViLenh(db: Db, pv: PhamViNguoiXem, adapterId: number): Promise<HangAdapterLenh | null> {
  const idsMay = await idsTrongPhamVi("machine", pv, { strict: true });
  const [row] = await db
    .select({
      id: deviceAdapters.id,
      code: deviceAdapters.code,
      machineId: deviceAdapters.machineId,
      isEnabled: deviceAdapters.isEnabled,
      machineName: machines.name,
      machineCode: machines.code,
    })
    .from(deviceAdapters)
    .leftJoin(machines, eq(machines.id, deviceAdapters.machineId))
    .where(eq(deviceAdapters.id, adapterId))
    .limit(1);
  if (!row) return null;
  if (idsMay !== null && (row.machineId === null || !idsMay.includes(row.machineId))) return null;
  return row;
}

export async function docTagLenh(db: Db, adapterId: number, tagKey: string): Promise<TagLenh | null> {
  const [t] = await db
    .select({
      tagKey: deviceTags.tagKey,
      dataType: deviceTags.dataType,
      unit: deviceTags.unit,
      writable: deviceTags.writable,
      isEnabled: deviceTags.isEnabled,
      channelKind: deviceTags.channelKind,
      displayName: deviceTags.displayName,
      writeMin: deviceTags.writeMin,
      writeMax: deviceTags.writeMax,
      writeStep: deviceTags.writeStep,
      actuationLevel: deviceTags.actuationLevel,
    })
    .from(deviceTags)
    .where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, tagKey)))
    .limit(1);
  return t ?? null;
}

// ─── Cổng 3–7 (Task 9 gọi lại trên dữ liệu hiện tại) ───────────────────────────────────────────────────────────────────────────
type Cong<T> = { ok: true } & T | { ok: false; tuChoi: TuChoiYeuCau };

/** Cổng 3 + 4. `tag` null = không có. ok ⇒ giá trị ĐÃ ÉP KIỂU (không bao giờ làm tròn). */
export function kiemCongKenhVaGiaTri(tag: TagLenh | null, tagKey: string, value: unknown): Cong<{ giaTri: GiaTriLenh }> {
  if (!tag || !tag.isEnabled) {
    return { ok: false, tuChoi: { ma: "NOT_FOUND", entity: "deviceTag", chiTiet: `Tag "${tagKey}" không tồn tại hoặc đang tắt.` } };
  }
  if (!tag.writable || !laKenhGhi(tag)) {
    return { ok: false, tuChoi: { ma: "CHANNEL_READ_ONLY", tagKey, chiTiet: `Tag "${tagKey}" không phải kênh ghi.` } };
  }
  const kq = kiemGiaTriGhi(tag, value);
  if (kq.ok) return { ok: true, giaTri: kq.giaTri };
  switch (kq.ma) {
    case "TYPE_MISMATCH":
      return { ok: false, tuChoi: { ma: "TYPE_MISMATCH", tagKey, dataType: tag.dataType, chiTiet: kq.chiTiet } };
    case "OUT_OF_RANGE":
      return { ok: false, tuChoi: { ma: "OUT_OF_RANGE", tagKey, min: tag.writeMin, max: tag.writeMax, chiTiet: kq.chiTiet } };
    case "OFF_STEP":
      return {
        ok: false,
        tuChoi: { ma: "OFF_STEP", tagKey, step: tag.writeStep as number, ...(kq.goiY !== undefined ? { goiY: kq.goiY } : {}), chiTiet: kq.chiTiet },
      };
  }
}

/** Cổng 5: sàn vai theo mức → `machine_control.canEdit` → mức ≥ 4 (mọi mức không phải 1|3) phải đã đăng ký 2FA. */
export async function kiemCongVaiTro(nguoi: NguoiGoiLenh, muc: MucRuiRo): Promise<Cong<object>> {
  const u = nguoi.user;
  if (!vaiTroDuocGhi(muc).includes(u.role as UserRole)) {
    return { ok: false, tuChoi: { ma: "ROLE_FLOOR", level: muc, chiTiet: `Vai "${u.role}" không được ra lệnh kênh mức ${muc}.` } };
  }
  if (!(await checkPermission(u.id, u.role, "machine_control", "canEdit"))) {
    return { ok: false, tuChoi: { ma: "PERMISSION_DENIED", chiTiet: "Thiếu quyền machine_control.canEdit." } };
  }
  if (muc !== 1 && muc !== 3 && !u.twoFactorEnabled) {
    return { ok: false, tuChoi: { ma: "TOTP_CHUA_DANG_KY", level: muc, chiTiet: `Kênh mức ${muc} cần 2FA; tài khoản chưa đăng ký 2FA.` } };
  }
  return { ok: true };
}

/**
 * Cổng 6: adapter do edge sở hữu (`device_adapters."edgeNodeId"`, mig 0374 — không có trong schema drizzle). DB chưa có 0374 ⇒ không
 * adapter nào thuộc edge; lỗi khác ⇒ ném (không đoán "trung tâm").
 */
export async function kiemCongEdge(db: Db, adapterId: number): Promise<Cong<object>> {
  let rows: Array<{ edgeNodeId: number | null; edgeCode: string | null }>;
  try {
    rows = (await db.execute(sql`SELECT a."edgeNodeId" AS "edgeNodeId", n."code" AS "edgeCode"
      FROM device_adapters a LEFT JOIN edge_nodes n ON n."id" = a."edgeNodeId" WHERE a."id" = ${adapterId}`)) as unknown as typeof rows;
  } catch (err) {
    if (isEdgeControlSchemaMissing(err)) return { ok: true };
    throw err;
  }
  const r = rows[0];
  if (!r || r.edgeNodeId === null || r.edgeNodeId === undefined) return { ok: true };
  const edgeNodeId = Number(r.edgeNodeId);
  const edgeCode = r.edgeCode ?? String(edgeNodeId);
  return {
    ok: false,
    tuChoi: { ma: "EDGE_CHUA_HO_TRO", edgeCode, edgeNodeId, chiTiet: `Adapter do edge ${edgeCode} sở hữu — HMI trung tâm chưa ra lệnh qua edge (R1c).` },
  };
}

/** Cổng 7: chế độ của máy của ADAPTER (không bao giờ theo machineId client gửi). */
export async function kiemCongCheDo(machineId: number | null, now: number = Date.now()): Promise<Cong<object>> {
  const cd = await cheDoMay(machineId, now);
  if (cd.cheDo === "REMOTE") return { ok: true };
  return { ok: false, tuChoi: { ma: "MODE_LOCAL", lyDo: cd.lyDo, chiTiet: `Máy không ở REMOTE (${cd.lyDo}).` } };
}

// ─── Bản xem trước ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function giaTriHienTai(adapterId: number, tagKey: string, now: number): { current: BanXemTruoc["current"]; canhBao: string | null } {
  if (!boDemDangBat()) return { current: { v: null, q: "bad", ageMs: null }, canhBao: "KHONG_CO_GIA_TRI_HIEN_TAI" };
  const g = layGiaTri(adapterId, tagKey, now);
  if (!g) return { current: { v: null, q: "bad", ageMs: null }, canhBao: "KHONG_CO_GIA_TRI_HIEN_TAI" };
  if (g.stale) return { current: { v: null, q: "bad", ageMs: g.ageMs }, canhBao: "GIA_TRI_HIEN_TAI_CU" };
  return { current: { v: g.v, q: g.q, ageMs: g.ageMs }, canhBao: null };
}

async function lyDoMoPhong(adapterId: number): Promise<string[]> {
  const out: string[] = [];
  if (!isOtControlEnabled()) out.push("OT_CONTROL_TAT");
  if (isCommissioningRequired() && !(await isCommissioned(adapterId))) out.push("CHUA_NGHIEM_THU");
  return out;
}

function canTotp(nguoi: NguoiGoiLenh, muc: MucRuiRo): boolean {
  if (muc === 1 || muc === 3) return false;
  if (muc === 4 && nguoi.sessionToken) return !stepUpPhienConHan(khoaPhienStepUp({ user: nguoi.user, sessionToken: nguoi.sessionToken }));
  return true;
}

async function lapBanXemTruoc(
  nguoi: NguoiGoiLenh,
  a: HangAdapterLenh,
  tag: TagLenh,
  giaTri: GiaTriLenh,
  muc: MucRuiRo,
  now: number,
): Promise<BanXemTruoc> {
  const { current, canhBao } = giaTriHienTai(a.id, tag.tagKey, now);
  const simulatedReasons = await lyDoMoPhong(a.id);
  const warnings = ["SAFETY_KIEM_LUC_GUI"];
  if (canhBao) warnings.push(canhBao);
  if (!a.isEnabled) warnings.push("ADAPTER_TAT");
  const coDai = tag.writeMin != null || tag.writeMax != null || tag.writeStep != null;
  return {
    machine: a.machineName ?? a.machineCode ?? a.code,
    channel: tag.displayName ?? tag.tagKey,
    unit: tag.unit ?? null,
    current,
    requested: giaTri,
    afterFormula: giaTri, // R1 không có công thức ra (C.7): afterFormula === requested
    range: coDai ? { min: tag.writeMin, max: tag.writeMax, step: tag.writeStep } : null,
    level: muc,
    needsTotp: canTotp(nguoi, muc),
    mode: simulatedReasons.length > 0 ? "simulated" : "real",
    simulatedReasons,
    route: "central",
    warnings,
  };
}

// ─── Gửi lại / dòng chờ ────────────────────────────────────────────────────────────────────────────────────────────────────────
type PreviewLuu = { preview: BanXemTruoc; lyDo: string; giaTriGoc: string; [k: string]: unknown };

async function docDongCho(db: DbHoacTx, idempotencyKey: string) {
  const [r] = await db
    .select({
      id: aiPendingActions.id,
      tool: aiPendingActions.tool,
      status: aiPendingActions.status,
      userId: aiPendingActions.userId,
      argsJson: aiPendingActions.argsJson,
      previewJson: aiPendingActions.previewJson,
      expiresAt: aiPendingActions.expiresAt,
    })
    .from(aiPendingActions)
    .where(eq(aiPendingActions.idempotencyKey, idempotencyKey))
    .limit(1);
  return r ?? null;
}
type DongCho = NonNullable<Awaited<ReturnType<typeof docDongCho>>>;

/** Dòng cũ còn dùng lại được cho ĐÚNG lệnh này? ⇒ kết quả cũ; không ⇒ null (DA_XU_LY). */
function dungLai(r: DongCho, userId: number, input: DauVaoYeuCau, now: number): KetQuaYeuCau | null {
  const p = (r.previewJson ?? {}) as Partial<PreviewLuu>;
  const args = (r.argsJson ?? {}) as Record<string, unknown>;
  const cungLenh =
    r.tool === TOOL_HMI_GHI_TAG &&
    r.userId === userId &&
    args.adapterId === input.adapterId &&
    args.tagKey === input.tagKey &&
    p.giaTriGoc === canonicalOtValue(input.value);
  if (!cungLenh || r.status !== "proposed" || r.expiresAt.getTime() <= now || !p.preview) return null;
  return { requestId: r.id, expiresAt: r.expiresAt.toISOString(), preview: p.preview };
}

function laTrungKhoa(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

async function tenNguoi(db: Db, userId: number): Promise<string> {
  try {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.name || `#${userId}`;
  } catch {
    return `#${userId}`;
  }
}

async function phatScadaCmd(userId: number, payload: { requestId: string; status: string; at: string }): Promise<void> {
  try {
    const { getIO } = await import("../../_core/socket");
    getIO()?.to(`user:${userId}`).emit("scada:cmd", payload);
  } catch (err) {
    console.error("[SCADA] phát scada:cmd lỗi:", (err as Error)?.message ?? err);
  }
}

// ─── request ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type KetQuaYeuCauGhi = { ok: true; ketQua: KetQuaYeuCau; moi: boolean } | { ok: false; tuChoi: TuChoiYeuCau };

/**
 * `scadaCommands.request`. `pv` = `phamViCua(ctx)` (danh tính từ ctx, không từ input). `now` = đồng hồ ứng dụng (một nguồn cho
 * TTL của dòng chờ lẫn khoá chọn). Không ném cho các từ chối đã biết; lỗi hạ tầng (DB, phạm vi không quyết được) thì ném.
 */
export async function yeuCauGhiTag(
  nguoi: NguoiGoiLenh,
  pv: PhamViNguoiXem,
  input: DauVaoYeuCau,
  nowDate: Date = new Date(),
): Promise<KetQuaYeuCauGhi> {
  // 1. cờ — không chạm DB
  if (!lenhHmiBat()) return { ok: false, tuChoi: { ma: "FEATURE_DISABLED", chiTiet: "SCADA_COMMANDS_ENABLED tắt." } };

  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const now = nowDate.getTime();
  const userId = nguoi.user.id;

  // 2. phạm vi
  const a = await adapterTrongPhamViLenh(db, pv, input.adapterId);
  if (!a) {
    await ghiThuLenh(db, { userId, stage: "request", outcome: "rejected", reasonCode: "NOT_FOUND" });
    return { ok: false, tuChoi: { ma: "NOT_FOUND", entity: "adapter", chiTiet: "Adapter không tồn tại." } };
  }

  const tuChoi = async (t: TuChoiYeuCau, extra: { requestId?: string | null; requestedValue?: unknown; afterFormula?: unknown } = {}) => {
    await ghiThuLenh(db, {
      requestId: extra.requestId ?? null,
      userId,
      adapterId: a.id,
      tagKey: input.tagKey,
      requestedValue: "requestedValue" in extra ? extra.requestedValue : input.value,
      afterFormula: extra.afterFormula ?? null,
      stage: "request",
      outcome: "rejected",
      reasonCode: t.ma,
    });
    return { ok: false as const, tuChoi: t };
  };

  // 2b. gửi lại
  const idempotencyKey = `hmi:${userId}:${input.clientRequestId}`;
  const cu = await docDongCho(db, idempotencyKey);
  if (cu) {
    const kq = dungLai(cu, userId, input, now);
    if (kq) return { ok: true, ketQua: kq, moi: false };
    return tuChoi({ ma: "DA_XU_LY", chiTiet: "clientRequestId này đã được dùng cho một yêu cầu đã xử lý / khác." }, { requestId: cu.id });
  }

  // 3–4. kênh + giá trị
  const tag = await docTagLenh(db, a.id, input.tagKey);
  const kenh = kiemCongKenhVaGiaTri(tag, input.tagKey, input.value);
  if (!kenh.ok) return tuChoi(kenh.tuChoi);
  const t = tag as TagLenh;
  const giaTri = kenh.giaTri;
  const muc = mucTacDongKenh(t);

  // 5. vai trò + quyền + 2FA
  const vai = await kiemCongVaiTro(nguoi, muc);
  if (!vai.ok) return tuChoi(vai.tuChoi, { requestedValue: giaTri });

  // 6. edge
  const edge = await kiemCongEdge(db, a.id);
  if (!edge.ok) return tuChoi(edge.tuChoi, { requestedValue: giaTri });

  // 7. chế độ máy (của adapter)
  const cheDo = await kiemCongCheDo(a.machineId, now);
  if (!cheDo.ok) return tuChoi(cheDo.tuChoi, { requestedValue: giaTri });

  // bản xem trước (trước transaction: giữ transaction quanh khoá NGẮN)
  const preview = await lapBanXemTruoc(nguoi, a, t, giaTri, muc, now);
  const requestId = randomUUID();
  const hetHan = new Date(now + LENH_HMI_TTL_MS);
  const hash = otPayloadHash({
    tool: TOOL_HMI_GHI_TAG,
    adapterId: a.id,
    machineId: a.machineId,
    commandType: COMMAND_TYPE_HMI,
    writes: [{ tagKey: t.tagKey, value: giaTri }],
  });
  const previewJson = withOtPayloadHash(
    { preview, lyDo: input.lyDo, giaTriGoc: canonicalOtValue(input.value) } satisfies PreviewLuu,
    hash,
  );

  // 8–9. khoá chọn + dòng chờ + attempts proposed — MỘT transaction ngắn
  type KqTx = { ok: true } | { ok: false; boiUserId: number; hetHanLuc: Date };
  let kqTx: KqTx;
  try {
    kqTx = await db.transaction(async (tx) => {
      const khoa = await giuKhoaChon(tx, { adapterId: a.id, tagKey: t.tagKey, userId, requestId, hetHanLuc: hetHan }, nowDate);
      if (!khoa.ok) return { ok: false, boiUserId: khoa.boiUserId, hetHanLuc: khoa.hetHanLuc } as const;
      await tx.insert(aiPendingActions).values({
        id: requestId,
        tool: TOOL_HMI_GHI_TAG,
        argsJson: { adapterId: a.id, machineId: a.machineId, tagKey: t.tagKey, value: giaTri, commandType: COMMAND_TYPE_HMI },
        userId,
        userRole: nguoi.user.role,
        requiredPermissionJson: { module: "machine_control", action: "canEdit" },
        summary: `HMI: ghi ${t.tagKey} = ${canonicalOtValue(giaTri)} (adapter ${a.code})`,
        previewJson,
        status: "proposed",
        idempotencyKey,
        expiresAt: hetHan,
      });
      await ghiThuLenh(tx, {
        requestId,
        userId,
        adapterId: a.id,
        tagKey: t.tagKey,
        requestedValue: giaTri,
        afterFormula: giaTri,
        stage: "request",
        outcome: "proposed",
      });
      return { ok: true } as const;
    });
  } catch (err) {
    if (laTrungKhoa(err)) {
      // Hai yêu cầu giống hệt cùng lúc: bên kia đã tạo dòng — đọc lại (QĐ-5).
      const r = await docDongCho(db, idempotencyKey);
      const kq = r ? dungLai(r, userId, input, Date.now()) : null;
      if (kq) return { ok: true, ketQua: kq, moi: false };
      return tuChoi({ ma: "DA_XU_LY", chiTiet: "clientRequestId này vừa được dùng cho một yêu cầu khác." }, { requestId: r?.id ?? null });
    }
    // giuKhoaChon hết lượt thử (hàng biến đổi liên tục) ⇒ KHOA_CHON_LOI có mã, không 500 thô. Lỗi KHÁC (DB …) ném tiếp.
    if (err instanceof LoiKhoaChonTranhChap) {
      return tuChoi({ ma: "KHOA_CHON_LOI", chiTiet: "Không chốt được khoá chọn kênh (đang tranh chấp) — thử lại." }, { requestedValue: giaTri });
    }
    throw err;
  }
  if (!kqTx.ok) {
    return tuChoi(
      {
        ma: "DANG_DUOC_CHON",
        boiUserId: kqTx.boiUserId,
        boiTen: await tenNguoi(db, kqTx.boiUserId),
        hetHanLuc: kqTx.hetHanLuc.toISOString(),
        chiTiet: "Kênh đang được người khác chọn để ra lệnh.",
      },
      { requestedValue: giaTri },
    );
  }

  await phatScadaCmd(userId, { requestId, status: "proposed", at: new Date().toISOString() });
  return { ok: true, ketQua: { requestId, expiresAt: hetHan.toISOString(), preview }, moi: true };
}
