/**
 * doc 81 Đợt 1D Task 1 — GHIM tag/giá trị DỪNG theo tag OT (`device_tags.stop_value`, mig 0362).
 *
 * Quyết định chủ dự án 2026-09-28 (doc 81 §8 QĐ1 "Làm ngay"): một lệnh DỪNG phần mềm qua đường OT
 * được đi qua preflight an toàn (kể cả khi PLC an toàn chỉ SIM / không đọc được / báo NOT OK) CHỈ khi
 * nó ghi ĐÚNG các cặp (tagKey, giá trị) đã GHIM cho adapter đích. Nguyên tắc L-7: thứ giữ an toàn là
 * DỮ LIỆU CHƯA ĐIỀN ⇒ không ghim = không miễn (fail-closed); R-1C-g: không bao giờ miễn theo TÊN lệnh.
 *
 *   • `validateStopValue` — giá trị ghim phải đúng kiểu `dataType` của tag (bool/int/float/string);
 *     `json` và kiểu lạ bị từ chối (giá trị dừng phải là vô hướng có kiểu rõ). bool nhận 1/0 và
 *     CHUẨN HOÁ thành boolean ⇒ trong DB, tag bool LUÔN mang boolean, tag số LUÔN mang number.
 *   • `matchPinnedStop` — THUẦN. `ok` chỉ khi writes không rỗng, không trùng tag, mọi tag đều có ghim
 *     và mọi giá trị bằng ghim theo phép so CHUẨN: số 1/0 ≡ true/false CHỈ khi ghim là boolean (tức tag
 *     bool — nhờ chuẩn hoá ở trên); ngoài ra so CHẶT cùng kiểu JS (không ép "0" → 0). Kết quả trả về là
 *     GIÁ TRỊ GHIM (đối tượng mới), không bao giờ là giá trị của người gọi.
 *   • `loadStopPins` — ghim của MỘT adapter: chỉ tag enabled + writable + stop_value khác NULL, và giá
 *     trị đã lưu phải còn hợp lệ với `dataType` HIỆN TẠI của tag (lệch ⇒ bỏ qua, fail-closed).
 *   • `datStopPin` — đặt/gỡ ghim trong MỘT transaction: tag khoá `FOR UPDATE`, audit `control_audit_log`
 *     + `audit_logs` bằng CHÍNH `tx` (audit hỏng ⇒ ghim không đổi).
 *   • `lyDoGoStopPinKhiSuaTag` / `ghiAuditGoStopPinTx` — sửa tag thành không-ghi-được / tắt / đổi định
 *     nghĩa dây (address, dataType, scale, offset, adapter), hoặc xoá tag ⇒ ghim bị GỠ trong cùng
 *     transaction, cùng audit (router deviceAdapter gọi).
 *
 * Tương tác commissioning (Ruling Task 1): đổi ghim trên adapter ĐÃ commissioning vẫn được phép, audit
 * gắn cờ `commissioningRecheckRequired: true`; bản ghi commissioning KHÔNG bị thu hồi tự động.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { DbUnavailableError } from "../../_core/dbErrors";
import { auditLogs, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { catTheoTranCot } from "../../db/catTheoTranCot";
import { recordAuditEvent } from "../audit/controlAuditService";
import { computeCrudContentHash } from "../auditTrailService";
import { secPlatformEnabled } from "../security/policyGate";
import { isCommissioned } from "./commissioningService";
import { adapterTargetCanonical, type AdapterTarget } from "./adapterTarget";
import { lyDoGoStopPinKhiSuaTag } from "@shared/stopPinTagRule";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** db drizzle đã resolve HOẶC một transaction của nó. */
export type StopPinDb = Db | Tx;

export type StopPin = { tagKey: string; value: unknown };

export type MatchPinnedStopResult =
  | { ok: true; writes: StopPin[] }
  | { ok: false; reason: "no_pins" | "empty_writes" | "unpinned_tag" | "value_mismatch" | "duplicate_tag" };

/** Trần độ dài giá trị ghim kiểu string (cùng trần `address` của tag). */
export const STOP_VALUE_STRING_MAX = 255;

/** entityType / action của dòng control_audit_log (varchar 64 / 48). */
export const AUDIT_ENTITY_STOP_PIN = "device_tag_stop_pin";
export const AUDIT_ACTION_STOP_PIN_SET = "stop_pin_set";
export const AUDIT_ACTION_STOP_PIN_CLEAR = "stop_pin_clear";
/** action của dòng audit_logs (màn Nhật ký). */
export const AUDIT_LOG_ACTION_STOP_PIN = "deviceTag.setStopPin";
export const AUDIT_LOG_ENTITY_DEVICE_TAG = "device_tag";

/**
 * Giá trị ghim có đúng kiểu `dataType` của tag không; trả giá trị CHUẨN HOÁ (bool: 1/0 → true/false).
 */
export function validateStopValue(
  dataType: string,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  switch (dataType) {
    case "bool":
      if (typeof value === "boolean") return { ok: true, value };
      if (value === 1) return { ok: true, value: true };
      if (value === 0) return { ok: true, value: false };
      return { ok: false, reason: "bool tag needs true/false (or 1/0)" };
    case "int":
      if (typeof value === "number" && Number.isSafeInteger(value)) return { ok: true, value };
      return { ok: false, reason: "int tag needs a whole number" };
    case "float":
      if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
      return { ok: false, reason: "float tag needs a finite number" };
    case "string":
      if (typeof value === "string" && value.length <= STOP_VALUE_STRING_MAX) return { ok: true, value };
      return { ok: false, reason: `string tag needs a string of at most ${STOP_VALUE_STRING_MAX} characters` };
    default:
      return { ok: false, reason: `dataType "${dataType}" cannot carry a stop value (bool/int/float/string only)` };
  }
}

/** So giá trị người gọi với giá trị GHIM (đã chuẩn hoá bởi validateStopValue). */
function khopGhim(pin: unknown, caller: unknown): boolean {
  if (typeof pin === "boolean") {
    if (typeof caller === "boolean") return caller === pin;
    // 1 ≡ true / 0 ≡ false CHỈ ở đây: ghim boolean ⇔ tag bool (validateStopValue chuẩn hoá).
    if (caller === 1) return pin === true;
    if (caller === 0) return pin === false;
    return false;
  }
  if (typeof pin === "number") return typeof caller === "number" && Number.isFinite(caller) && caller === pin;
  if (typeof pin === "string") return typeof caller === "string" && caller === pin;
  return false; // hình dạng ghim lạ ⇒ không khớp (fail-closed)
}

export function matchPinnedStop(
  pins: StopPin[],
  writes: { tagKey: string; value: unknown }[],
): MatchPinnedStopResult {
  if (!Array.isArray(pins) || pins.length === 0) return { ok: false, reason: "no_pins" };
  if (!Array.isArray(writes) || writes.length === 0) return { ok: false, reason: "empty_writes" };
  const theoTag = new Map<string, unknown>();
  for (const p of pins) {
    if (!theoTag.has(p.tagKey)) theoTag.set(p.tagKey, p.value);
  }
  const daThay = new Set<string>();
  for (const w of writes) {
    if (daThay.has(w.tagKey)) return { ok: false, reason: "duplicate_tag" };
    daThay.add(w.tagKey);
  }
  const ra: StopPin[] = [];
  for (const w of writes) {
    if (!theoTag.has(w.tagKey)) return { ok: false, reason: "unpinned_tag" };
    const ghim = theoTag.get(w.tagKey);
    if (!khopGhim(ghim, w.value)) return { ok: false, reason: "value_mismatch" };
    ra.push({ tagKey: w.tagKey, value: ghim });
  }
  return { ok: true, writes: ra };
}

/** Những cột của một hàng device_tags mà luật "tag này có ghim DỪNG hợp lệ" cần. */
export type StopPinTagRow = { tagKey: string; dataType: string | null; stopValue: unknown; writable: boolean | null; isEnabled: boolean | null };

/**
 * THUẦN — ghim DỪNG hợp lệ trong một tập hàng tag: tag enabled + writable + stop_value khác NULL, giá trị còn hợp lệ
 * với dataType HIỆN TẠI (chuẩn hoá). doc 81 Đợt 1D final wave 3 (M1): MỘT luật, dùng chung bởi `loadStopPins` và
 * dispatcher (bước 5a-stop lấy ghim từ CHÍNH các hàng tag bước 3 — một bản chụp với lệnh ghi).
 */
export function stopPinsFromTagRows(rows: ReadonlyArray<StopPinTagRow>): StopPin[] {
  const out: StopPin[] = [];
  for (const r of rows) {
    // Lớp thứ hai ở JS: điều kiện SQL bị gỡ/giả lập sai vẫn không lọt tag tắt / không ghi được.
    if (r.isEnabled !== true || r.writable !== true || r.stopValue === null || r.stopValue === undefined) continue;
    const v = validateStopValue(String(r.dataType), r.stopValue);
    if (!v.ok) continue;
    out.push({ tagKey: r.tagKey, value: v.value });
  }
  return out;
}

/**
 * Ghim DỪNG của một adapter: tag enabled + writable + stop_value khác NULL, giá trị còn hợp lệ với
 * dataType hiện tại. Lỗi DB ⇒ NÉM (nơi gọi không được coi như "không ghim" rồi đoán cho qua — Task 2
 * đổi lỗi thành "không miễn").
 */
export async function loadStopPins(db: StopPinDb, adapterId: number): Promise<StopPin[]> {
  const rows = await db
    .select({
      tagKey: deviceTags.tagKey,
      dataType: deviceTags.dataType,
      stopValue: deviceTags.stopValue,
      writable: deviceTags.writable,
      isEnabled: deviceTags.isEnabled,
    })
    .from(deviceTags)
    .where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.isEnabled, true), eq(deviceTags.writable, true)))
    .orderBy(deviceTags.tagKey);
  return stopPinsFromTagRows(rows);
}

// ─── Đặt / gỡ ghim (router deviceAdapter.tags.setStopPin) ──────────────────────────────────────────

export interface NguoiSuaStopPin {
  id: number | null;
  name?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Lỗi nghiệp vụ của `datStopPin` — router đổi sang appError có mã. */
export class StopPinLoi extends Error {
  constructor(
    readonly loai: "adapter_not_found" | "tag_not_found" | "tag_not_writable" | "type_mismatch",
    readonly chiTiet: Record<string, unknown> = {},
  ) {
    super(loai);
    this.name = "StopPinLoi";
  }
}

export interface KetQuaStopPin {
  tagId: number;
  adapterId: number;
  tagKey: string;
  stopValue: unknown;
  stopPinnedBy: string | null;
  stopPinnedAt: Date | null;
  changed: boolean;
  /** true ⇔ lượt này ĐỔI ghim trên adapter đang có bản ký commissioning hiệu lực. */
  commissioningRecheckRequired: boolean;
  /** Adapter có bản ký commissioning hiệu lực không (kể cả khi lượt này là no-op). */
  adapterCommissioned: boolean;
}

type DongTag = typeof deviceTags.$inferSelect;
type NguonGo =
  | "manual"
  | "tag_not_writable"
  | "tag_disabled"
  | "tag_redefined"
  | "tag_deleted"
  | "adapter_deleted"
  | "adapter_redefined";

function cungGiaTri(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * Một dòng `control_audit_log` + một dòng `audit_logs` cho MỘT thay đổi ghim, bằng CHÍNH `tx`, KHÔNG
 * nuốt lỗi (audit hỏng ⇒ thay đổi rollback). before/after chỉ mang tagKey/adapterId/dataType/giá trị
 * ghim — không một ô nào của adapter (connectionOptions chứa bí mật) được đưa vào.
 */
async function ghiAuditStopPinTx(
  tx: Tx,
  e: {
    tag: Pick<DongTag, "id" | "tagKey" | "adapterId" | "dataType">;
    truoc: unknown;
    sau: unknown;
    reason: string;
    nguoiSua: NguoiSuaStopPin;
    commissioningRecheckRequired: boolean;
    nguon: NguonGo;
  },
): Promise<void> {
  const before = { tagKey: e.tag.tagKey, adapterId: e.tag.adapterId, dataType: e.tag.dataType, stopValue: e.truoc ?? null };
  const after: Record<string, unknown> = {
    tagKey: e.tag.tagKey,
    adapterId: e.tag.adapterId,
    dataType: e.tag.dataType,
    stopValue: e.sau ?? null,
    commissioningRecheckRequired: e.commissioningRecheckRequired,
  };
  if (e.nguon !== "manual") after.autoClearedBy = e.nguon;

  await recordAuditEvent(tx, {
    entityType: AUDIT_ENTITY_STOP_PIN,
    entityId: e.tag.id,
    action: e.sau == null ? AUDIT_ACTION_STOP_PIN_CLEAR : AUDIT_ACTION_STOP_PIN_SET,
    actorId: e.nguoiSua.id,
    before,
    after,
    reason: e.reason,
  });

  const details: Record<string, unknown> = {
    operation: AUDIT_LOG_ACTION_STOP_PIN,
    before,
    after,
    metadata: { reason: e.reason, adapterId: e.tag.adapterId, commissioningRecheckRequired: e.commissioningRecheckRequired },
    source: "web",
    timestamp: new Date().toISOString(),
  };
  if (secPlatformEnabled()) {
    const hashTs = Date.now();
    details.hashTs = hashTs;
    details.contentHash = computeCrudContentHash(
      { userId: e.nguoiSua.id, action: AUDIT_LOG_ACTION_STOP_PIN, entityType: AUDIT_LOG_ENTITY_DEVICE_TAG, entityId: e.tag.id, entityName: e.tag.tagKey, details },
      hashTs,
    );
  }
  await tx.insert(auditLogs).values(
    catTheoTranCot(auditLogs, {
      userId: e.nguoiSua.id ?? null,
      userName: e.nguoiSua.name ?? null,
      action: AUDIT_LOG_ACTION_STOP_PIN,
      entityType: AUDIT_LOG_ENTITY_DEVICE_TAG,
      entityId: e.tag.id,
      entityName: e.tag.tagKey,
      details: JSON.stringify(details),
      ipAddress: e.nguoiSua.ipAddress ?? null,
      userAgent: e.nguoiSua.userAgent ?? null,
      status: "success" as const,
    }),
  );
}

/**
 * Đặt (`stopValue` ≠ null) hoặc gỡ (`null`) ghim DỪNG của tag (`adapterId`, `tagKey`).
 *   • adapter phải tồn tại và máy của nó trong phạm vi người sửa (`phamViMay`, null = không lọc);
 *     adapter chưa gắn máy chỉ người không bị lọc phạm vi mới sửa được (fail-closed);
 *   • tag phải thuộc ĐÚNG adapter đó (tra theo cặp adapterId + tagKey) — tag của adapter khác ⇒
 *     không tìm thấy;
 *   • ĐẶT: tag writable + enabled, giá trị đúng kiểu; GỠ luôn được (thu hẹp);
 *   • không đổi gì ⇒ không ghi, không audit (`changed: false`).
 */
export async function datStopPin(input: {
  adapterId: number;
  tagKey: string;
  stopValue: unknown;
  reason: string;
  nguoiSua: NguoiSuaStopPin;
  phamViMay: ReadonlyArray<number> | null;
}): Promise<KetQuaStopPin> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const mayOk = (id: number | null) => input.phamViMay === null || (id != null && input.phamViMay.includes(id));

  return db.transaction(async (tx) => {
    const [adapter] = await tx
      .select({ id: deviceAdapters.id, machineId: deviceAdapters.machineId })
      .from(deviceAdapters)
      .where(eq(deviceAdapters.id, input.adapterId))
      .limit(1);
    if (!adapter || !mayOk(adapter.machineId)) throw new StopPinLoi("adapter_not_found", { adapterId: input.adapterId });

    const [tag] = await tx
      .select()
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, adapter.id), eq(deviceTags.tagKey, input.tagKey)))
      .for("update");
    if (!tag) throw new StopPinLoi("tag_not_found", { adapterId: adapter.id, tagKey: input.tagKey });

    let sau: unknown = null;
    if (input.stopValue !== null) {
      if (tag.writable !== true || tag.isEnabled !== true) {
        throw new StopPinLoi("tag_not_writable", { tagKey: tag.tagKey, writable: tag.writable, isEnabled: tag.isEnabled });
      }
      const v = validateStopValue(String(tag.dataType), input.stopValue);
      if (!v.ok) throw new StopPinLoi("type_mismatch", { tagKey: tag.tagKey, dataType: tag.dataType, detail: v.reason });
      sau = v.value;
    }

    const truoc = tag.stopValue ?? null;
    if (cungGiaTri(truoc, sau)) {
      // Fix round 1 (#5) — no-op thật: KHÔNG ghi, KHÔNG audit (không có thay đổi nào để kiểm lại), và
      // `commissioningRecheckRequired` = false CÓ CHỦ Ý: tập ghim không đổi ⇒ bản ký commissioning
      // (nếu có) vẫn khớp đúng thứ đã ký. `adapterCommissioned` báo trạng thái ký thật cho UI.
      return {
        tagId: tag.id, adapterId: tag.adapterId, tagKey: tag.tagKey, stopValue: truoc,
        stopPinnedBy: tag.stopPinnedBy ?? null, stopPinnedAt: tag.stopPinnedAt ?? null,
        changed: false, commissioningRecheckRequired: false,
        adapterCommissioned: await isCommissioned(adapter.id, tx),
      };
    }

    const commissioningRecheckRequired = await isCommissioned(adapter.id, tx);
    const pinnedBy = sau == null ? null : input.nguoiSua.id != null ? String(input.nguoiSua.id) : null;
    const pinnedAt = sau == null ? null : new Date();
    await tx
      .update(deviceTags)
      .set({ stopValue: sau as DongTag["stopValue"], stopPinnedBy: pinnedBy, stopPinnedAt: pinnedAt, updatedAt: new Date() })
      .where(eq(deviceTags.id, tag.id));

    await ghiAuditStopPinTx(tx, {
      tag, truoc, sau, reason: input.reason, nguoiSua: input.nguoiSua, commissioningRecheckRequired, nguon: "manual",
    });

    return {
      tagId: tag.id, adapterId: tag.adapterId, tagKey: tag.tagKey, stopValue: sau,
      stopPinnedBy: pinnedBy, stopPinnedAt: pinnedAt, changed: true, commissioningRecheckRequired,
      adapterCommissioned: commissioningRecheckRequired,
    };
  });
}

// ─── Gỡ ghim tự động khi sửa / xoá tag (router deviceAdapter) ─────────────────────────────────────

/**
 * doc 81 Đợt 4 Task C1 — luật "sửa tag có gỡ ghim không" sống ở `shared/stopPinTagRule.ts` (client hỏi trước
 * bằng CHÍNH hàm đó); ở đây chỉ RE-EXPORT — một bản cài đặt.
 */
export { lyDoGoStopPinKhiSuaTag };

/** Cột ghim đặt về NULL — nhập vào patch UPDATE của tag. */
export const GO_STOP_PIN_PATCH = { stopValue: null, stopPinnedBy: null, stopPinnedAt: null } as const;

/**
 * Audit một lượt GỠ ghim tự động (tag sửa / xoá, adapter xoá) — cùng hai dòng audit như setStopPin.
 * Gọi TRONG transaction của thao tác gây ra việc gỡ.
 */
export async function ghiAuditGoStopPinTx(
  tx: Tx,
  e: { tag: DongTag; nguon: Exclude<NguonGo, "manual">; nguoiSua: NguoiSuaStopPin; thaoTac: string },
): Promise<{ commissioningRecheckRequired: boolean }> {
  const commissioningRecheckRequired = await isCommissioned(e.tag.adapterId, tx);
  await ghiAuditStopPinTx(tx, {
    tag: e.tag,
    truoc: e.tag.stopValue ?? null,
    sau: null,
    reason: `auto-clear: ${e.nguon} (${e.thaoTac})`,
    nguoiSua: e.nguoiSua,
    commissioningRecheckRequired,
    nguon: e.nguon,
  });
  // final wave 3 (M4) — nơi gọi (tags.update) báo lại cho UI: đã gỡ ghim trên adapter ĐÃ commissioning ⇒ nhắc soát lại.
  return { commissioningRecheckRequired };
}

// ─── Gỡ MỌI ghim của adapter khi adapter đổi "thiết bị nào" (Ruling R-1D-a) ─────────────────────────

type DongAdapter = typeof deviceAdapters.$inferSelect;

/**
 * Ruling R-1D-a — sửa adapter có đổi "THANH GHI NÀY Ở THIẾT BỊ NÀY CỦA MÁY NÀY" không:
 * endpoint, protocol, machineId, hoặc connectionOptions (trừ bí mật / tài khoản / chế độ bảo mật — các khoá
 * đó đổi CÁCH nói chuyện, không đổi thiết bị). So theo GIÁ TRỊ (form gửi lại nguyên giá trị cũ ⇒ không gỡ).
 * Mọi khoá khác trong connectionOptions (unitId, rack/slot, ha.secondaryEndpoint, timeouts…) đều bị coi là
 * đổi đích — chiều AN TOÀN; giá: kỹ sư ghim lại.
 */
export function adapterDoiDich(existing: DongAdapter, patch: Record<string, unknown>): boolean {
  // final wave 1 (R-1D-k) — MỘT định nghĩa "đích" (adapterTarget.ts), dùng chung với dấu vân tay kết nối của
  // otManager / commandDispatcher: trường vắng trong patch = giữ giá trị hàng hiện tại.
  const cu: AdapterTarget = {
    protocol: existing.protocol,
    endpoint: existing.endpoint,
    machineId: existing.machineId ?? null,
    connectionOptions: existing.connectionOptions ?? null,
  };
  const moi: AdapterTarget = {
    protocol: patch.protocol !== undefined ? String(patch.protocol) : cu.protocol,
    endpoint: patch.endpoint !== undefined ? String(patch.endpoint) : cu.endpoint,
    machineId: patch.machineId !== undefined ? ((patch.machineId as number | null) ?? null) : cu.machineId,
    connectionOptions: patch.connectionOptions !== undefined ? (patch.connectionOptions ?? null) : cu.connectionOptions,
  };
  return adapterTargetCanonical(cu) !== adapterTargetCanonical(moi);
}

/**
 * Gỡ MỌI ghim của `adapterId` trong `tx` (khoá hàng tag FOR UPDATE), audit từng tag. Trả số ghim đã gỡ.
 */
export async function goMoiStopPinCuaAdapterTx(
  tx: Tx,
  e: { adapterId: number; nguon: Exclude<NguonGo, "manual">; nguoiSua: NguoiSuaStopPin; thaoTac: string },
): Promise<number> {
  const tags = await tx.select().from(deviceTags).where(eq(deviceTags.adapterId, e.adapterId)).for("update");
  let n = 0;
  for (const t of tags) {
    if (t.stopValue === null || t.stopValue === undefined) continue;
    await tx.update(deviceTags).set({ ...GO_STOP_PIN_PATCH, updatedAt: new Date() }).where(eq(deviceTags.id, t.id));
    await ghiAuditGoStopPinTx(tx, { tag: t, nguon: e.nguon, nguoiSua: e.nguoiSua, thaoTac: e.thaoTac });
    n++;
  }
  return n;
}
