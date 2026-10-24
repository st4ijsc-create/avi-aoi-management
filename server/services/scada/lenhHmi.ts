/**
 * SCADA R1a Task 8 (K1, K5) — LỆNH GHI TAG TỪ HMI, BƯỚC 1: `request` (bản xem trước + khoá chọn + bản ghi chờ TTL 60 s).
 *
 * Router `scadaCommands` (server/routers/scadaCommandsRouter.ts) mỏng: nó lấy danh tính + phạm vi từ `ctx`, gọi `yeuCauGhiTag`,
 * và đổi một `TuChoiYeuCau` thành `appError`. Mọi quyết định nằm ở đây; mọi lần thử đều để lại dấu trong `scada_command_attempts`
 * (WORM — chỉ INSERT). `confirm` (Task 9) dùng lại các cổng 3–7 (`kiemCongKenhVaGiaTri`, `kiemCongVaiTro`, `kiemCongEdge`,
 * `kiemCongCheDo`) trên dữ liệu HIỆN TẠI.
 * Task 9 (bước 2) ở CUỐI tệp: `xacNhanGhiTag` (confirm), `huyYeuCauGhi` (huy), `trangThaiYeuCauGhi` (trangThai) — thứ tự + QĐ T9-1..6.
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
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags, machines, scadaCommandAttempts, users, type DeviceTag } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../../db/hierarchy";
import { checkPermission } from "../../_core/accessControl";
import { khoaPhienStepUp, stepUpPhienConHan, type UserRole } from "../../_core/trpc";
import { kiemXacThucTheoMuc, vaiTroDuocGhi } from "../../_core/xacThucTheoMuc";
import { logger } from "../../logger";
import type { MucRuiRo } from "../ot/aiControlGate";
import { dispatch, isOtControlEnabled, type DispatchResult, type DispatchStatus } from "../ot/commandDispatcher";
import { isCommissioned, isCommissioningRequired } from "../ot/commissioningService";
import { canonicalOtValue, otPayloadHash, withOtPayloadHash } from "../ot/otActionBinding";
import { isEdgeControlSchemaMissing } from "../edge/edgeControlSchema";
import { boDemDangBat, layGiaTri } from "./boDemHienTai";
import { cheDoMay, TOOL_HMI_GHI_TAG, type LyDoCheDo } from "./cheDoMay";
import { kiemGiaTriGhi, laKenhGhi, mucTacDongKenh } from "./kenhScada";
import { giaHanKhoaChon, giuKhoaChon, LoiKhoaChonTranhChap, nhaKhoaChon } from "./khoaChon";
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
  | "DA_XU_LY"
  // R1a Task 9 (confirm)
  | "HET_HAN"
  | "KHOA_MAT"
  | "TOTP_CAN"
  | "TOTP_SAI"
  | "MAY_DA_DOI";

/** Một lần từ chối. `thongTin` là tham số cho appError (chỉ nguyên thuỷ) — router chọn câu i18n theo `ma`. */
export type TuChoiYeuCau =
  | { ma: "FEATURE_DISABLED" | "PERMISSION_DENIED" | "KHOA_CHON_LOI" | "DA_XU_LY" | "HET_HAN" | "KHOA_MAT" | "MAY_DA_DOI"; chiTiet: string }
  | { ma: "NOT_FOUND"; chiTiet: string; entity: "adapter" | "deviceTag" | "scadaRequest" }
  | { ma: "CHANNEL_READ_ONLY"; chiTiet: string; tagKey: string }
  | { ma: "TYPE_MISMATCH"; chiTiet: string; tagKey: string; dataType: string }
  | { ma: "OUT_OF_RANGE"; chiTiet: string; tagKey: string; min: number | null; max: number | null }
  | { ma: "OFF_STEP"; chiTiet: string; tagKey: string; step: number; goiY?: number }
  | { ma: "ROLE_FLOOR" | "TOTP_CHUA_DANG_KY" | "TOTP_CAN" | "TOTP_SAI"; chiTiet: string; level: MucRuiRo }
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
  /** Dấu lượt gọi TOTP của chuỗi step-up cũ nếu nó đã verify trong CÙNG lượt gọi tRPC (xem `kiemXacThucTheoMuc`). */
  __luotXacMinhTotp?: string;
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

async function phatScadaCmd(
  userId: number,
  payload: { requestId: string; status: string; at: string; reason?: string; readBackValue?: unknown },
): Promise<void> {
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
      const kq = r ? dungLai(r, userId, input, now) : null; // T9: đồng hồ tiêm vào (không Date.now())
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

  await phatScadaCmd(userId, { requestId, status: "proposed", at: nowDate.toISOString() });
  return { ok: true, ketQua: { requestId, expiresAt: hetHan.toISOString(), preview }, moi: true };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R1a Task 9 (K1, K6, K8, K9) — BƯỚC 2: `confirm` / `huy` / `trangThai`.
//
// THỨ TỰ `confirm` (brief Task 9 + ruling 3, cố định):
//   0. cờ                                         ⇒ FEATURE_DISABLED (không chạm DB, như request)
//   1. dòng chờ của CHÍNH người gọi, tool hmi.write_tag ⇒ NOT_FOUND (entity scadaRequest; của người khác = không tồn tại)
//   2. status 'expired' ⇒ HET_HAN · status khác 'proposed' ⇒ DA_XU_LY · expiresAt <= now ⇒ CAS proposed→expired, nhả khoá, HET_HAN
//   (2b) phạm vi: adapter của yêu cầu còn trong phạm vi người gọi ⇒ không thì NOT_FOUND (adapter)
//   (2c) fix round 1 — máy HIỆN TẠI của adapter ≠ argsJson.machineId (gán lại sau request) ⇒ MAY_DA_DOI (kết thúc, dispatch 0 lần)
//   3. `kiemXacThucTheoMuc(mức của tag HIỆN TẠI)`  ⇒ ROLE_FLOOR | TOTP_CHUA_DANG_KY | TOTP_CAN | TOTP_SAI (GIỮ dòng chờ + khoá — QĐ T9-2)
//   4. cổng 3–7 của Task 8 trên dữ liệu HIỆN TẠI (kênh + giá trị + vai/quyền + edge + chế độ máy của ADAPTER hiện tại)
//   5. `giaHanKhoaChon` — kiểm và gia hạn NGUYÊN TỬ (QĐ T9-1)   ⇒ KHOA_MAT
//   6. CAS proposed→confirmed                     ⇒ 0 hàng: DA_XU_LY
//   7. `dispatch()` hitl hmi.write_tag requireBoundAction, docLai bat_buoc, deadlineMs = còn lại tới expiresAt
//   8. nhả khoá (dispatch xong HAY ném)   9. attempts dispatch/dispatched + command_log_ids   10. socket scada:cmd
//
// QUYẾT ĐỊNH (ghi trong báo cáo task 9):
//   QĐ T9-1 CỬA SỔ KHOÁ khi gửi: `denLuc = now + 2·conLai + 30 s` (`hanKhoaKhiGui`), conLai = expiresAt − now (cũng là deadlineMs). Một
//        dispatch chờ hàng đợi tối đa deadlineMs (K9), rồi chờ ack tối đa deadlineMs (effectiveTimeoutMs, có thể bị OT_CONTROL_TIMEOUT_MAX_MS
//        cắt ngắn hơn), rồi đọc lại + ghi sổ (dư 30 s). Khoá không bao giờ bị rút ngắn (GREATEST). Đường thường nhả ngay sau dispatch; cửa
//        sổ chỉ có nghĩa khi tiến trình chết giữa chừng (khoá tự hết sau ≤ 150 s).
//   QĐ T9-2 Từ chối 2FA (TOTP_CAN/TOTP_SAI/TOTP_CHUA_DANG_KY của bước 3) GIỮ dòng chờ 'proposed' VÀ GIỮ khoá: người dùng nhập
//        mã rồi bấm lại trong TTL; nhả khoá ở đây sẽ làm lần thử lại gặp KHOA_MAT. Khoá vẫn hết hạn cùng yêu cầu (60 s).
//        fix round 1 minor 6: ROLE_FLOOR không sửa được bằng thử lại ⇒ đi đường KẾT THÚC (QĐ T9-3).
//   QĐ T9-3 Mọi từ chối KHÁC trước dispatch (phạm vi, MAY_DA_DOI, ROLE_FLOOR, cổng 3–7, KHOA_MAT) KẾT THÚC yêu cầu: CAS proposed→'denied' rồi mới nhả khoá. CAS
//        trượt ⇒ một tab khác đã xử lý (đang dispatch) ⇒ trả DA_XU_LY và KHÔNG nhả khoá — nhả lúc đó sẽ mở khe chiếm khoá giữa lúc tab kia
//        đang ghi. Cũng vì vậy DA_XU_LY không bao giờ nhả khoá.
//   QĐ T9-4 Sau dispatch, dòng chờ còn 'confirmed' (dispatch không tới bước đặt chỗ: simulated / rejected / failed trước đặt chỗ) ⇒ chốt
//        'executed' (simulated) hoặc 'bi_tu_choi_ghi' (không gửi gì) + resultJson — không để lại một uỷ quyền 'confirmed' còn hạn.
//        Đã qua đặt chỗ ⇒ dispatcher đã CAS confirmed→executed; fix round 1 minor 4: kết quả `rejected` (QUEUE_EXPIRED / BUSY /
//        SUPERSEDED — không gửi) ⇒ executed→bi_tu_choi_ghi. Thứ tự: chốt dòng chờ TRƯỚC, nhả khoá SAU (minor 3).
//   QĐ T9-7 (fix round 1 minor 1/2) CAS proposed→confirmed có điều kiện `expiresAt > now`. Trượt ⇒ đọc lại: confirmed/executed ⇒
//        DA_XU_LY, không nhả; còn proposed ⇒ hết hạn đúng lúc ⇒ proposed→expired, HET_HAN; bị dời đi (expired / cancelled …) ⇒ nhả
//        khoá vừa gia hạn, 'expired' ⇒ HET_HAN, khác ⇒ DA_XU_LY.
//   QĐ T9-5 attempts `dispatch/dispatched`: reason_code = `reason` của dispatch, hoặc STATUS viết hoa khi không ok mà không có reason
//        (`timeout` ⇒ "TIMEOUT" — M5 hiện "không rõ"); ok ⇒ NULL (status thật nằm ở command_log).
//   QĐ T9-6 dispatch ném ⇒ nhả khoá, chốt 'bi_tu_choi_ghi' nếu còn 'confirmed', attempts `dispatch/rejected DISPATCH_LOI`, socket, NÉM TIẾP.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** fix round 2 — chốt dòng chờ sau dispatch lỗi: chỉ ghi log (không che kết quả/lỗi gốc của dispatch, không chặn nhả khoá). */
function ghiLoiChot(err: unknown, requestId: string, cho: string): void {
  logger.error(
    { err: (err as Error)?.message ?? String(err), requestId, cho },
    "[SCADA] chốt dòng chờ / ghi sổ sau dispatch lỗi — trạng thái dòng chờ có thể chưa đúng kết cục",
  );
}

/** Dư cho đọc lại + ghi sổ sau hai cửa sổ của dispatch (QĐ T9-1). */
export const DU_PHONG_CUA_SO_GUI_MS = 30_000;

/** Hạn khoá chọn trong lúc gửi (QĐ T9-1). */
export function hanKhoaKhiGui(now: number, conLaiMs: number): Date {
  return new Date(now + 2 * Math.max(0, conLaiMs) + DU_PHONG_CUA_SO_GUI_MS);
}

type TrangThaiCho = (typeof aiPendingActions.$inferSelect)["status"];
type ArgsLenh = { adapterId: number; machineId: number | null; tagKey: string; value: GiaTriLenh };

async function docDongChoTheoId(d: DbHoacTx, requestId: string) {
  const [r] = await d
    .select({
      id: aiPendingActions.id,
      tool: aiPendingActions.tool,
      status: aiPendingActions.status,
      userId: aiPendingActions.userId,
      argsJson: aiPendingActions.argsJson,
      previewJson: aiPendingActions.previewJson,
      expiresAt: aiPendingActions.expiresAt,
      createdAt: aiPendingActions.createdAt,
      executedAt: aiPendingActions.executedAt,
    })
    .from(aiPendingActions)
    .where(eq(aiPendingActions.id, requestId))
    .limit(1);
  return r ?? null;
}
type DongChoDayDu = NonNullable<Awaited<ReturnType<typeof docDongChoTheoId>>>;

/** Dòng chờ hmi.write_tag của CHÍNH người gọi + args hợp lệ; không ⇒ null (không tồn tại = của người khác = hỏng ⇒ cùng NOT_FOUND). */
async function dongChoCuaNguoi(d: DbHoacTx, requestId: string, userId: number): Promise<{ r: DongChoDayDu; args: ArgsLenh } | null> {
  const r = await docDongChoTheoId(d, requestId);
  if (!r || r.userId !== userId || r.tool !== TOOL_HMI_GHI_TAG) return null;
  const a = (r.argsJson ?? {}) as Record<string, unknown>;
  const v = a.value;
  if (typeof a.adapterId !== "number" || typeof a.tagKey !== "string") return null;
  if (typeof v !== "number" && typeof v !== "boolean" && typeof v !== "string") return null;
  const machineId = typeof a.machineId === "number" ? a.machineId : null;
  return { r, args: { adapterId: a.adapterId, machineId, tagKey: a.tagKey, value: v } };
}

/** CAS trạng thái dòng chờ của người gọi: chỉ đổi khi đang ở `tu`. true ⇔ đúng MỘT hàng đổi. */
async function doiTrangThaiCho(
  d: DbHoacTx,
  requestId: string,
  userId: number,
  tu: TrangThaiCho,
  den: TrangThaiCho,
  them: { executedAt?: Date; resultJson?: Record<string, unknown> } = {},
  /** có ⇒ chỉ đổi khi `expiresAt > conHanSau` (fix round 1 minor 2: hết hạn đúng lúc CAS ⇒ HET_HAN sạch) */
  conHanSau?: Date,
): Promise<boolean> {
  const rows = await d
    .update(aiPendingActions)
    .set({ status: den, ...them })
    .where(
      and(
        eq(aiPendingActions.id, requestId),
        eq(aiPendingActions.userId, userId),
        eq(aiPendingActions.status, tu),
        ...(conHanSau ? [gt(aiPendingActions.expiresAt, conHanSau)] : []),
      ),
    )
    .returning({ id: aiPendingActions.id });
  return rows.length === 1;
}

const DA_XU_LY_CONFIRM: TuChoiYeuCau = { ma: "DA_XU_LY", chiTiet: "Yêu cầu này đã được xử lý (hoặc đang được xử lý ở tab khác)." };
const KHONG_THAY_YEU_CAU: TuChoiYeuCau = { ma: "NOT_FOUND", entity: "scadaRequest", chiTiet: "Yêu cầu không tồn tại." };

export interface DauVaoXacNhan {
  requestId: string;
  totpCode?: string;
}

export interface KetQuaXacNhan {
  status: DispatchStatus | "rejected";
  ok: boolean;
  simulated: boolean;
  reason?: string;
  commandLogIds: number[];
  readBackValue?: unknown;
}

export type KetQuaXacNhanGhi = { ok: true; ketQua: KetQuaXacNhan } | { ok: false; tuChoi: TuChoiYeuCau };

/** Đồng hồ của một lượt: gốc = `nowDate` tiêm vào, cộng thời gian đã trôi (đơn điệu) — `at` của socket không trộn hai đồng hồ. */
function dongHoLuot(nowDate: Date): () => Date {
  const t0 = performance.now();
  return () => new Date(nowDate.getTime() + Math.max(0, performance.now() - t0));
}

/**
 * `scadaCommands.confirm`. `pv` = `phamViCua(ctx)`. Không ném cho các từ chối đã biết; lỗi hạ tầng (DB) và lỗi ném từ `dispatch()` thì
 * ném (QĐ T9-6: không nuốt lỗi).
 */
export async function xacNhanGhiTag(
  nguoi: NguoiGoiLenh,
  pv: PhamViNguoiXem,
  input: DauVaoXacNhan,
  nowDate: Date = new Date(),
): Promise<KetQuaXacNhanGhi> {
  // 0. cờ — không chạm DB
  if (!lenhHmiBat()) return { ok: false, tuChoi: { ma: "FEATURE_DISABLED", chiTiet: "SCADA_COMMANDS_ENABLED tắt." } };

  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const now = nowDate.getTime();
  const luc = dongHoLuot(nowDate);
  const userId = nguoi.user.id;
  const requestId = input.requestId;

  // 1. dòng chờ của chính người gọi
  const cho = await dongChoCuaNguoi(db, requestId, userId);
  if (!cho) {
    await ghiThuLenh(db, { userId, stage: "confirm", outcome: "rejected", reasonCode: "NOT_FOUND" });
    return { ok: false, tuChoi: KHONG_THAY_YEU_CAU };
  }
  const { r, args } = cho;
  const khoaKey = { adapterId: args.adapterId, tagKey: args.tagKey, requestId };

  const thu = (
    stage: "confirm" | "dispatch",
    outcome: "rejected" | "confirmed" | "dispatched" | "expired",
    reasonCode: string | null,
    commandLogIds?: number[],
  ) =>
    ghiThuLenh(db, {
      requestId,
      userId,
      adapterId: args.adapterId,
      tagKey: args.tagKey,
      requestedValue: args.value,
      afterFormula: args.value,
      stage,
      outcome,
      reasonCode,
      commandLogIds: commandLogIds ?? null,
    });
  const phat = (p: { status: string; reason?: string; readBackValue?: unknown }) =>
    phatScadaCmd(userId, {
      requestId,
      status: p.status,
      at: luc().toISOString(),
      ...(p.reason ? { reason: p.reason } : {}),
      ...("readBackValue" in p ? { readBackValue: p.readBackValue } : {}),
    });
  /** Nhả khoá sau dispatch — lỗi nhả chỉ ghi log (khoá tự hết hạn theo QĐ T9-1), không che kết quả/lỗi của dispatch. */
  const nhaAnToan = async () => {
    try {
      await nhaKhoaChon(db, khoaKey);
    } catch (err) {
      logger.error({ err: (err as Error)?.message ?? String(err), requestId }, "[SCADA] nhả khoá chọn sau dispatch lỗi — khoá tự hết hạn");
    }
  };

  /** Từ chối GIỮ NGUYÊN dòng chờ + khoá (DA_XU_LY, 2FA — QĐ T9-2/T9-3). */
  const tuChoiGiu = async (t: TuChoiYeuCau): Promise<KetQuaXacNhanGhi> => {
    await thu("confirm", "rejected", t.ma);
    return { ok: false, tuChoi: t };
  };
  /** Từ chối KẾT THÚC yêu cầu (QĐ T9-3): CAS proposed→denied rồi mới nhả khoá; CAS trượt ⇒ DA_XU_LY, không nhả. */
  const tuChoiKetThuc = async (t: TuChoiYeuCau): Promise<KetQuaXacNhanGhi> => {
    if (!(await doiTrangThaiCho(db, requestId, userId, "proposed", "denied", { resultJson: { ma: t.ma } }))) return tuChoiGiu(DA_XU_LY_CONFIRM);
    await nhaKhoaChon(db, khoaKey);
    await thu("confirm", "rejected", t.ma);
    await phat({ status: "rejected", reason: t.ma });
    return { ok: false, tuChoi: t };
  };

  // 2. trạng thái + TTL
  const hetHan: TuChoiYeuCau = { ma: "HET_HAN", chiTiet: "Yêu cầu đã hết hạn (60 s) — hãy tạo yêu cầu mới." };
  if (r.status === "expired") return tuChoiGiu(hetHan);
  if (r.status !== "proposed") return tuChoiGiu(DA_XU_LY_CONFIRM);
  if (r.expiresAt.getTime() <= now) {
    if (!(await doiTrangThaiCho(db, requestId, userId, "proposed", "expired"))) return tuChoiGiu(DA_XU_LY_CONFIRM);
    await nhaKhoaChon(db, khoaKey);
    await thu("confirm", "expired", "HET_HAN");
    await phat({ status: "expired", reason: "HET_HAN" });
    return { ok: false, tuChoi: hetHan };
  }

  // 2b. phạm vi hiện tại của người gọi
  const a = await adapterTrongPhamViLenh(db, pv, args.adapterId);
  if (!a) return tuChoiKetThuc({ ma: "NOT_FOUND", entity: "adapter", chiTiet: "Adapter không tồn tại." });
  // 2c. (fix round 1, security MEDIUM) adapter đã gán sang MÁY KHÁC sau request ⇒ cổng (chế độ…) xét máy MỚI mà dispatch/sổ/interlock
  //     mang `args.machineId` (máy CŨ, một phần của băm) — hai máy cho một lệnh. Kết thúc yêu cầu, không dispatch.
  if (a.machineId !== args.machineId) {
    return tuChoiKetThuc({ ma: "MAY_DA_DOI", chiTiet: "Thiết bị đã được gán sang máy khác sau khi tạo yêu cầu — hãy tạo yêu cầu mới." });
  }

  // 3. 2FA theo mức của tag HIỆN TẠI (đọc lại DB — không tin preview)
  const tag = await docTagLenh(db, a.id, args.tagKey);
  if (!tag || !tag.isEnabled) {
    const k = kiemCongKenhVaGiaTri(tag, args.tagKey, args.value);
    return tuChoiKetThuc(k.ok ? { ma: "NOT_FOUND", entity: "deviceTag", chiTiet: `Tag "${args.tagKey}" không tồn tại hoặc đang tắt.` } : k.tuChoi);
  }
  const muc = mucTacDongKenh(tag);
  const xt = await kiemXacThucTheoMuc(nguoi, muc, input.totpCode);
  if (!xt.ok) {
    const chiTiet: Record<typeof xt.ma, string> = {
      ROLE_FLOOR: `Vai "${nguoi.user.role}" không được ra lệnh kênh mức ${muc}.`,
      TOTP_CHUA_DANG_KY: `Kênh mức ${muc} cần 2FA; tài khoản chưa đăng ký 2FA.`,
      TOTP_CAN: `Kênh mức ${muc} cần mã TOTP.`,
      TOTP_SAI: "Mã TOTP không hợp lệ hoặc đã dùng.",
    };
    const t: TuChoiYeuCau = { ma: xt.ma, level: muc, chiTiet: chiTiet[xt.ma] };
    // fix round 1 minor 6 — ROLE_FLOOR không sửa được bằng thử lại ⇒ KẾT THÚC (nhả khoá); TOTP_* giữ dòng chờ + khoá (QĐ T9-2).
    return xt.ma === "ROLE_FLOOR" ? tuChoiKetThuc(t) : tuChoiGiu(t);
  }

  // 4. cổng 3–7 trên dữ liệu hiện tại
  const kenh = kiemCongKenhVaGiaTri(tag, args.tagKey, args.value);
  if (!kenh.ok) return tuChoiKetThuc(kenh.tuChoi);
  const vai = await kiemCongVaiTro(nguoi, muc);
  if (!vai.ok) return tuChoiKetThuc(vai.tuChoi);
  const edge = await kiemCongEdge(db, a.id);
  if (!edge.ok) return tuChoiKetThuc(edge.tuChoi);
  const cheDo = await kiemCongCheDo(a.machineId, now);
  if (!cheDo.ok) return tuChoiKetThuc(cheDo.tuChoi);

  // 5. khoá: kiểm + gia hạn NGUYÊN TỬ qua cửa sổ gửi (QĐ T9-1)
  const conLai = r.expiresAt.getTime() - now;
  const conKhoa = await giaHanKhoaChon(db, { ...khoaKey, userId, denLuc: hanKhoaKhiGui(now, conLai) }, nowDate);
  if (!conKhoa) {
    return tuChoiKetThuc({ ma: "KHOA_MAT", chiTiet: "Khoá chọn kênh đã mất (hết hạn / yêu cầu mới hơn / người khác) — hãy tạo yêu cầu mới." });
  }

  // 6. CAS proposed→confirmed — đúng MỘT tab thắng (Review Focus 1)
  // fix round 2 (M2) — hạn so với đồng hồ ĐỌC LẠI ngay lúc CAS (`luc()` = gốc tiêm vào + thời gian đơn điệu đã trôi), KHÔNG phải
  // `nowDate` (thời điểm bước 2 đã kiểm): TTL hết giữa bước 2 và CAS ⇒ CAS trượt ⇒ HET_HAN sạch.
  if (!(await doiTrangThaiCho(db, requestId, userId, "proposed", "confirmed", {}, luc()))) {
    // fix round 1 minor 1/2 — CAS trượt: đọc lại. 'confirmed'/'executed' ⇒ tab khác ĐANG/ĐÃ gửi ⇒ DA_XU_LY, KHÔNG nhả khoá. Còn
    // 'proposed' ⇒ hết hạn đúng lúc CAS ⇒ CAS proposed→expired. Bị dời đi chỗ khác (expireStaleActions ⇒ 'expired', AI cancelAction
    // …) ⇒ không ai gửi ⇒ NHẢ khoá vừa gia hạn; 'expired' ⇒ HET_HAN.
    let st = (await docDongChoTheoId(db, requestId))?.status;
    if (st === "proposed") {
      if (await doiTrangThaiCho(db, requestId, userId, "proposed", "expired")) {
        await nhaKhoaChon(db, khoaKey);
        await thu("confirm", "expired", "HET_HAN");
        await phat({ status: "expired", reason: "HET_HAN" });
        return { ok: false, tuChoi: hetHan };
      }
      st = (await docDongChoTheoId(db, requestId))?.status;
    }
    if (st === "confirmed" || st === "executed") return tuChoiGiu(DA_XU_LY_CONFIRM);
    await nhaKhoaChon(db, khoaKey);
    const t = st === "expired" ? hetHan : DA_XU_LY_CONFIRM;
    // fix round 2 — báo M5 trên đường "bị dời đi chỗ khác" (bi_tu_choi_ghi: tab kia đã gửi xong và tự báo kết cục — không báo trùng)
    if (st !== "bi_tu_choi_ghi") await phat({ status: st === "expired" ? "expired" : "rejected", reason: t.ma });
    return tuChoiGiu(t);
  }
  await thu("confirm", "confirmed", null);
  await phat({ status: "confirmed" });

  // 7. dispatch — đường ghi DUY NHẤT; băm khớp request: machineId/commandType/giá trị ĐÚNG như argsJson (ledger ruling T8)
  let kq: DispatchResult;
  try {
    kq = await dispatch({
      adapterId: args.adapterId,
      machineId: args.machineId,
      commandType: COMMAND_TYPE_HMI,
      writes: [{ tagKey: args.tagKey, value: args.value }],
      triggeredBy: {
        kind: "hitl",
        tool: TOOL_HMI_GHI_TAG,
        actionId: requestId,
        confirmedBy: userId,
        requestedBy: userId,
        requireBoundAction: true,
      },
      idempotencyKey: `hmi:${requestId}`,
      docLai: "bat_buoc",
      deadlineMs: Math.max(1, Math.trunc(conLai)),
    });
  } catch (err) {
    // QĐ T9-6 — 8. nhả khoá, chốt dòng chờ, attempts có mã, rồi NÉM TIẾP
    // fix round 1 minor 3 — chốt dòng chờ TRƯỚC, nhả khoá SAU. fix round 2 — chốt/ghi sổ lỗi KHÔNG được bỏ qua việc nhả khoá và
    // KHÔNG được che lỗi GỐC của dispatch: mỗi bước tự bắt + ghi log, rồi ném lại đúng `err`.
    try {
      await doiTrangThaiCho(db, requestId, userId, "confirmed", "bi_tu_choi_ghi", { resultJson: { ma: "DISPATCH_LOI" } });
    } catch (e) {
      ghiLoiChot(e, requestId, "dispatch_nem");
    } finally {
      await nhaAnToan();
    }
    try {
      await thu("dispatch", "rejected", "DISPATCH_LOI");
      await phat({ status: "rejected", reason: "DISPATCH_LOI" });
    } catch (e) {
      ghiLoiChot(e, requestId, "attempts_dispatch_nem");
    }
    throw err;
  }
  // QĐ T9-4 — chưa qua đặt chỗ ⇒ không để lại uỷ quyền 'confirmed'. fix round 1 minor 4 — dispatcher trả `rejected` (KHÔNG gửi:
  // QUEUE_EXPIRED / BUSY / SUPERSEDED_BY_STOP … sau khi đặt chỗ đã CAS confirmed→executed) ⇒ executed→bi_tu_choi_ghi: trangThai không
  // được nói 'executed' cho một lệnh chưa từng tới thiết bị. fix round 1 minor 3 — chốt TRƯỚC, nhả khoá SAU.
  const ketCuc = { resultJson: { status: kq.status, reason: kq.reason ?? null, commandLogIds: kq.commandLogIds } };
  const khongGui = !kq.simulated && kq.status === "rejected";
  // fix round 2 — chốt lỗi (DB) ⇒ ghi log, VẪN nhả khoá (finally) và VẪN ghi attempts + trả kết quả thật của dispatch (lệnh đã tới
  // dispatcher; command_log là sự thật). Dòng chờ có thể còn 'confirmed'/'executed' — log nói rõ.
  try {
    if (!(await doiTrangThaiCho(db, requestId, userId, "confirmed", kq.simulated ? "executed" : "bi_tu_choi_ghi", {
      ...(kq.simulated ? { executedAt: luc() } : {}),
      ...ketCuc,
    })) && khongGui) {
      await doiTrangThaiCho(db, requestId, userId, "executed", "bi_tu_choi_ghi", ketCuc);
    }
  } catch (e) {
    ghiLoiChot(e, requestId, "sau_dispatch");
  } finally {
    // 8. nhả khoá
    await nhaAnToan();
  }

  // giá trị đọc lại (đường HMI luôn đọc lại — Review Focus 5) nằm ở hàng KẾT QUẢ của command_log
  let readBackValue: unknown;
  if ((kq.status === "acked_verified" || kq.status === "acked_unverified") && kq.commandLogIds.length > 0) {
    const [row] = await db.select({ v: commandLog.readBackValue }).from(commandLog).where(eq(commandLog.id, kq.commandLogIds[0])).limit(1);
    readBackValue = row?.v ?? null;
  }

  // 9. attempts (QĐ T9-5)
  await thu("dispatch", "dispatched", kq.reason ?? (kq.ok ? null : String(kq.status).toUpperCase()), kq.commandLogIds);
  // 10. socket
  await phat({ status: kq.status, ...(kq.reason ? { reason: kq.reason } : {}), ...(readBackValue !== undefined ? { readBackValue } : {}) });

  return {
    ok: true,
    ketQua: {
      status: kq.status,
      ok: kq.ok,
      simulated: kq.simulated,
      ...(kq.reason ? { reason: kq.reason } : {}),
      commandLogIds: kq.commandLogIds,
      ...(readBackValue !== undefined ? { readBackValue } : {}),
    },
  };
}

// ─── huy ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type KetQuaHuyGhi = { ok: true; ketQua: { requestId: string; status: "cancelled" } } | { ok: false; tuChoi: TuChoiYeuCau };

/** `scadaCommands.huy` — chỉ chủ yêu cầu (người khác = NOT_FOUND); CAS proposed→cancelled, nhả khoá, attempts `huy/cancelled`. */
export async function huyYeuCauGhi(nguoi: NguoiGoiLenh, input: { requestId: string }, nowDate: Date = new Date()): Promise<KetQuaHuyGhi> {
  if (!lenhHmiBat()) return { ok: false, tuChoi: { ma: "FEATURE_DISABLED", chiTiet: "SCADA_COMMANDS_ENABLED tắt." } };
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const userId = nguoi.user.id;
  const { requestId } = input;

  const cho = await dongChoCuaNguoi(db, requestId, userId);
  if (!cho) {
    await ghiThuLenh(db, { userId, stage: "huy", outcome: "rejected", reasonCode: "NOT_FOUND" });
    return { ok: false, tuChoi: KHONG_THAY_YEU_CAU };
  }
  const { args } = cho;
  const dong = { requestId, userId, adapterId: args.adapterId, tagKey: args.tagKey, requestedValue: args.value, afterFormula: args.value };
  if (!(await doiTrangThaiCho(db, requestId, userId, "proposed", "cancelled"))) {
    await ghiThuLenh(db, { ...dong, stage: "huy", outcome: "rejected", reasonCode: "DA_XU_LY" });
    return { ok: false, tuChoi: { ma: "DA_XU_LY", chiTiet: "Yêu cầu này đã được xử lý — không huỷ được." } };
  }
  await nhaKhoaChon(db, { adapterId: args.adapterId, tagKey: args.tagKey, requestId });
  await ghiThuLenh(db, { ...dong, stage: "huy", outcome: "cancelled" });
  await phatScadaCmd(userId, { requestId, status: "cancelled", at: nowDate.toISOString() });
  return { ok: true, ketQua: { requestId, status: "cancelled" } };
}

// ─── trangThai ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TrangThaiYeuCau {
  request: {
    requestId: string;
    status: TrangThaiCho;
    adapterId: number;
    tagKey: string;
    value: GiaTriLenh;
    preview: BanXemTruoc | null;
    expiresAt: string;
    createdAt: string;
    executedAt: string | null;
  };
  attempts: Array<{
    id: number;
    stage: string;
    outcome: string;
    reasonCode: string | null;
    commandLogIds: number[];
    at: string;
  }>;
  commandLog: Array<{
    id: number;
    tagKey: string | null;
    commandType: string | null;
    requestedValue: unknown;
    status: string;
    readBackValue: unknown;
    /** mã lý do (tiền tố `MA:` của errorText) — KHÔNG trả chi tiết errorText (có thể mang đầu mối thiết bị / lastError) */
    ma: string | null;
    /** "intent" | "result" | null (ackValue.ledger) */
    ledger: string | null;
    createdAt: string;
    sentAt: string | null;
    ackedAt: string | null;
  }>;
}

const isoHoacNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * `scadaCommands.trangThai` — chỉ chủ yêu cầu (người khác = NOT_FOUND, không ghi attempts: chỉ đọc). Trả dòng chờ (KHÔNG băm), các dòng
 * attempts CỦA người gọi theo requestId, và các hàng command_log theo `actionId` (KHÔNG address, KHÔNG errorText — chỉ mã lý do).
 */
export async function trangThaiYeuCauGhi(
  nguoi: NguoiGoiLenh,
  input: { requestId: string },
): Promise<{ ok: true; ketQua: TrangThaiYeuCau } | { ok: false; tuChoi: TuChoiYeuCau }> {
  if (!lenhHmiBat()) return { ok: false, tuChoi: { ma: "FEATURE_DISABLED", chiTiet: "SCADA_COMMANDS_ENABLED tắt." } };
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const userId = nguoi.user.id;
  const cho = await dongChoCuaNguoi(db, input.requestId, userId);
  if (!cho) return { ok: false, tuChoi: KHONG_THAY_YEU_CAU };
  const { r, args } = cho;

  const thuRows = await db
    .select({
      id: scadaCommandAttempts.id,
      stage: scadaCommandAttempts.stage,
      outcome: scadaCommandAttempts.outcome,
      reasonCode: scadaCommandAttempts.reasonCode,
      commandLogIds: scadaCommandAttempts.commandLogIds,
      at: scadaCommandAttempts.at,
    })
    .from(scadaCommandAttempts)
    .where(and(eq(scadaCommandAttempts.requestId, r.id), eq(scadaCommandAttempts.userId, userId)))
    .orderBy(asc(scadaCommandAttempts.id));
  const lenhRows = await db
    .select({
      id: commandLog.id,
      tagKey: commandLog.tagKey,
      commandType: commandLog.commandType,
      requestedValue: commandLog.requestedValue,
      status: commandLog.status,
      readBackValue: commandLog.readBackValue,
      errorText: commandLog.errorText,
      ackValue: commandLog.ackValue,
      createdAt: commandLog.createdAt,
      sentAt: commandLog.sentAt,
      ackedAt: commandLog.ackedAt,
    })
    .from(commandLog)
    .where(eq(commandLog.actionId, r.id))
    .orderBy(asc(commandLog.id));

  const p = (r.previewJson ?? {}) as Partial<PreviewLuu>;
  return {
    ok: true,
    ketQua: {
      request: {
        requestId: r.id,
        status: r.status,
        adapterId: args.adapterId,
        tagKey: args.tagKey,
        value: args.value,
        preview: p.preview ?? null,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        executedAt: isoHoacNull(r.executedAt),
      },
      attempts: thuRows.map((t) => ({
        id: Number(t.id),
        stage: t.stage,
        outcome: t.outcome,
        reasonCode: t.reasonCode ?? null,
        commandLogIds: (t.commandLogIds ?? []).map(Number),
        at: t.at.toISOString(),
      })),
      commandLog: lenhRows.map((c) => {
        const ledger = (c.ackValue as { ledger?: unknown } | null)?.ledger;
        return {
          id: c.id,
          tagKey: c.tagKey ?? null,
          commandType: c.commandType ?? null,
          requestedValue: c.requestedValue ?? null,
          status: c.status,
          readBackValue: c.readBackValue ?? null,
          ma: /^([A-Z][A-Z0-9_]*):/.exec(c.errorText ?? "")?.[1] ?? null,
          ledger: typeof ledger === "string" ? ledger : null,
          createdAt: c.createdAt.toISOString(),
          sentAt: isoHoacNull(c.sentAt),
          ackedAt: isoHoacNull(c.ackedAt),
        };
      }),
    },
  };
}
