/**
 * SCADA R0 Task 10 — M10 "Chẩn đoán truyền thông" (`scadaDiag`): đọc trạng thái kết nối + bộ đếm + giá trị hiện tại + mẫu thô của từng
 * adapter OT, và ba hành động của kỹ sư (kết nối lại, tạm tắt, đặt lỗi stub ở chế độ Lab) — đều có audit (`control_audit_log`).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * NGUỒN SỐ LIỆU (chỉ đọc, không mở kết nối mới tới thiết bị):
 *   - trạng thái: RAM (`layTrangThaiAdapter`, otManager báo) TRƯỚC, DB (`device_adapters.status`) SAU; adapter do EDGE sở hữu LUÔN là
 *     `edge_chua_co_so_lieu` (C4 chưa trong R0) — không bao giờ `lost`, bất kể RAM/DB (detach/stopOt có thể đã ghi DB `disabled`).
 *   - bộ đếm 1 h (`layBoDem`, C8) — KHÔNG xoá khi tạm tắt/detach: M10 vẫn hiện giờ cuối của adapter đã tắt.
 *   - giá trị hiện tại (`layGiaTri`, bộ đệm chỉ nuôi từ đường OT trong tiến trình) và mẫu thô (`layMauThoTheoThietBi`).
 *
 * PHẠM VI: MỌI thủ tục nhận `adapterId` từ client ⇒ kiểm lại phạm vi ở máy chủ MỖI lần (kể cả query/mauTho) bằng
 *   `idsTrongPhamVi("machine", phamViCua(ctx))`. Adapter KHÔNG gắn máy (`machineId` null) chỉ hiện với phạm vi toàn quyền (null).
 *   "Ngoài phạm vi" và "không tồn tại" trả CÙNG một lỗi NOT_FOUND (không lộ sự tồn tại).
 *
 * QUYỀN:
 *   danhSach / tagCuaAdapter / mauTho → MOD_OT_CONTROL + `machine_monitoring.canView`
 *   ketNoiLai / tamTat / datLoiStub   → vai admin|engineer + 2FA + MOD_OT_CONTROL + `machine_control.canEdit`
 *   datLoiStub thêm: cờ SCADA_LAB_ENABLED, protocol `stub`.
 *
 * ĐỂ R1 (không làm ở đây): "Thử đọc một địa chỉ (Lab)" và chỉ báo "Truyền thông n/m" trên thanh trên.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { router, moduleProcedure, moduleGate, roleProcedure, require2FA } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import { getDb as getDbRaw } from "../db";
import { deviceAdapters, deviceTags } from "../../drizzle/schema";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../db/hierarchy";
import { layMauThoTheoThietBi } from "../db/otTelemetry";
import { phamViCua } from "./_phamViNguoiXem";
import { recordAuditEvent } from "../services/audit/controlAuditService";
import { isEdgeControlSchemaMissing } from "../services/edge/edgeControlSchema";
import { baoTrangThaiAdapter, layTrangThaiAdapter } from "../services/ot/trangThaiAdapter";
import { layBoDem } from "../services/ot/boDemTruyenThong";
import { layGiaTri, thongTinAdapter } from "../services/scada/boDemHienTai";
import { layStubDangChay, type LoiStub } from "../services/ot/drivers/stubDriver";
import { detachOtAdapter, getOtAdapterStatus, resetAdapterSession } from "../services/ot/otManager";
import type { RuntimeAdapter } from "../services/ot/deviceAdapter";

// Doc 37 P0-3 — mọi thủ tục sau giấy phép MOD_OT_CONTROL (cờ LICENSE_MODULE_GATE_ENABLED, mặc định tắt ⇒ đi qua), khuôn interlockRouter.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
// Hành động M10 (spec Phụ lục A: "Kết nối lại / tắt adapter" = engineer, admin): sàn vai + 2FA + giấy phép.
const kySuProcedure = roleProcedure("admin", "engineer").use(require2FA).use(moduleGate("MOD_OT_CONTROL"));

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return db;
}

export type TrangThaiM10 = "connecting" | "connected" | "lost" | "disabled" | "khong_ro" | "edge_chua_co_so_lieu";
export type SoHuuAdapter = { loai: "trung_tam" } | { loai: "edge"; edgeNodeId: number; edgeCode: string | null };

const cotAdapter = {
  id: deviceAdapters.id,
  code: deviceAdapters.code,
  name: deviceAdapters.name,
  protocol: deviceAdapters.protocol,
  endpoint: deviceAdapters.endpoint,
  machineId: deviceAdapters.machineId,
  pollIntervalMs: deviceAdapters.pollIntervalMs,
  status: deviceAdapters.status,
  isEnabled: deviceAdapters.isEnabled,
  lastConnectedAt: deviceAdapters.lastConnectedAt,
  lastErrorAt: deviceAdapters.lastErrorAt,
  lastError: deviceAdapters.lastError,
};
type HangAdapter = {
  id: number;
  code: string;
  name: string;
  protocol: string;
  endpoint: string;
  machineId: number | null;
  pollIntervalMs: number;
  status: string;
  isEnabled: boolean;
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
};

/** Cùng MỘT lỗi cho "không tồn tại" và "ngoài phạm vi". */
const khongThay = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");

/** Adapter nhìn thấy được với tập máy trong phạm vi: null = toàn quyền; adapter KHÔNG gắn máy chỉ khi toàn quyền. */
function nhinThay(machineId: number | null, idsMay: number[] | null): boolean {
  if (idsMay === null) return true;
  return machineId !== null && idsMay.includes(machineId);
}

/** Đọc MỘT adapter theo id client gửi, kiểm phạm vi ở máy chủ. Không thấy / ngoài phạm vi ⇒ cùng NOT_FOUND. */
async function adapterTrongPhamVi(pv: PhamViNguoiXem, adapterId: number): Promise<HangAdapter> {
  const db = await getDb();
  const idsMay = await idsTrongPhamVi("machine", pv, { strict: true });
  const [row] = await db.select(cotAdapter).from(deviceAdapters).where(eq(deviceAdapters.id, adapterId)).limit(1);
  if (!row || !nhinThay(row.machineId, idsMay)) throw khongThay();
  return row as HangAdapter;
}

/**
 * Sở hữu edge của các adapter (mig 0374: `device_adapters."edgeNodeId"` — không có trong schema drizzle). Thiếu schema edge ⇒ không
 * adapter nào thuộc edge (trung tâm như cũ); lỗi khác ⇒ ném (không đoán "trung tâm" để rồi báo `lost` cho adapter edge).
 */
async function soHuuEdge(ids: number[]): Promise<Map<number, { edgeNodeId: number; edgeCode: string | null }>> {
  const out = new Map<number, { edgeNodeId: number; edgeCode: string | null }>();
  if (ids.length === 0) return out;
  const db = await getDb();
  try {
    const rows = (await db.execute(sql`SELECT a."id" AS id, a."edgeNodeId" AS "edgeNodeId", n."code" AS "edgeCode"
      FROM device_adapters a LEFT JOIN edge_nodes n ON n."id" = a."edgeNodeId"
      WHERE a."edgeNodeId" IS NOT NULL AND a."id" IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`)) as unknown as Array<{ id: number; edgeNodeId: number; edgeCode: string | null }>;
    for (const r of rows) out.set(Number(r.id), { edgeNodeId: Number(r.edgeNodeId), edgeCode: r.edgeCode ?? null });
  } catch (err) {
    if (!isEdgeControlSchemaMissing(err)) throw err;
  }
  return out;
}

async function tuChoiNeuEdge(adapterId: number, operation: string): Promise<void> {
  const edge = (await soHuuEdge([adapterId])).get(adapterId);
  if (edge) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation, reason: "adapterOwnedByEdge" },
      `Adapter do edge ${edge.edgeCode ?? edge.edgeNodeId} sở hữu — trung tâm không điều khiển phiên của nó.`,
    );
  }
}

/** Trạng thái hiển thị: edge ⇒ edge_chua_co_so_lieu; RAM trước; DB sau (isEnabled=false ⇒ disabled; trạng thái lạ ⇒ khong_ro). */
export function trangThaiHienThi(
  row: Pick<HangAdapter, "id" | "status" | "isEnabled" | "lastConnectedAt" | "lastErrorAt" | "lastError">,
  edge: boolean,
  ram: ReturnType<typeof layTrangThaiAdapter>,
): { trangThai: TrangThaiM10; tu: string | null; loi: string | null; soLanMat: number } {
  if (edge) return { trangThai: "edge_chua_co_so_lieu", tu: null, loi: null, soLanMat: 0 };
  if (ram) return { trangThai: ram.tt, tu: ram.tu.toISOString(), loi: ram.loi, soLanMat: ram.soLanMat };
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  if (!row.isEnabled) return { trangThai: "disabled", tu: null, loi: null, soLanMat: 0 };
  switch (row.status) {
    case "connected":
      return { trangThai: "connected", tu: iso(row.lastConnectedAt), loi: null, soLanMat: 0 };
    case "error":
      return { trangThai: "lost", tu: iso(row.lastErrorAt), loi: row.lastError ?? null, soLanMat: 0 };
    case "connecting":
      return { trangThai: "connecting", tu: null, loi: null, soLanMat: 0 };
    case "disabled":
      return { trangThai: "disabled", tu: null, loi: null, soLanMat: 0 };
    default:
      return { trangThai: "khong_ro", tu: null, loi: null, soLanMat: 0 };
  }
}

/** Đếm tag BẬT theo giá trị hiện tại: xấu = q bad; nghi ngờ = q uncertain HOẶC cũ (stale); tốt = good + tươi. Chưa có giá trị ⇒ không đếm. */
function demTag(adapterId: number, tagKeys: string[], now: number): { tot: number; nghiNgo: number; xau: number } {
  const kq = { tot: 0, nghiNgo: 0, xau: 0 };
  for (const k of tagKeys) {
    const g = layGiaTri(adapterId, k, now);
    if (!g) continue;
    if (g.q === "bad") kq.xau += 1;
    else if (g.q === "uncertain" || g.stale) kq.nghiNgo += 1;
    else kq.tot += 1;
  }
  return kq;
}

const adapterIdInput = z.number().int().positive();
const lyDoInput = z.string().trim().min(5).max(300);
const loiStubInput = z
  .object({
    matKetNoi: z.boolean().optional(),
    tagXau: z.array(z.string().min(1).max(128)).max(500).optional(),
    tagNghiNgo: z.array(z.string().min(1).max(128)).max(500).optional(),
    giaTri: z.record(z.string().min(1).max(128), z.union([z.number().finite(), z.boolean(), z.string().max(256)])).optional(),
  })
  .strict();

/** Hình tối thiểu `baoTrangThaiAdapter` cần (tags rỗng: chỉ báo connecting/disabled — không phát mẫu xấu). */
function adapterBao(a: HangAdapter): Pick<RuntimeAdapter, "adapterId" | "code" | "machineId" | "protocol" | "tags"> {
  return { adapterId: a.id, code: a.code, machineId: a.machineId, protocol: a.protocol as RuntimeAdapter["protocol"], tags: [] };
}

export const scadaDiagRouter = router({
  danhSach: protectedProcedure.use(requirePermission("machine_monitoring", "canView")).query(async ({ ctx }) => {
    const db = await getDb();
    const idsMay = await idsTrongPhamVi("machine", phamViCua(ctx), { strict: true });
    // inArray trên machineId tự loại adapter KHÔNG gắn máy (NULL) ⇒ chúng chỉ hiện khi phạm vi toàn quyền (idsMay null).
    const where = idsMay === null ? undefined : inArray(deviceAdapters.machineId, idsMay.length > 0 ? idsMay : [-1]);
    const rows = (await db.select(cotAdapter).from(deviceAdapters).where(where).orderBy(asc(deviceAdapters.code))) as HangAdapter[];
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    // chỉ tag BẬT mới được đếm chất lượng
    const tagBat = await db
      .select({ adapterId: deviceTags.adapterId, tagKey: deviceTags.tagKey, isEnabled: deviceTags.isEnabled })
      .from(deviceTags)
      .where(inArray(deviceTags.adapterId, ids));
    const tagBatTheoAdapter = new Map<number, string[]>();
    for (const t of tagBat) {
      if (!t.isEnabled) continue;
      const ds = tagBatTheoAdapter.get(t.adapterId) ?? [];
      ds.push(t.tagKey);
      tagBatTheoAdapter.set(t.adapterId, ds);
    }
    const edge = await soHuuEdge(ids);
    const now = Date.now();
    // Task 11 — M10 chỉ hiện khối "Lab: đặt lỗi stub" khi API báo có (cùng điều kiện datLoiStub kiểm); không thêm thủ tục.
    const labBat = process.env.SCADA_LAB_ENABLED === "true";
    return rows.map((r) => {
      const e = edge.get(r.id);
      const st = trangThaiHienThi(r, !!e, layTrangThaiAdapter(r.id));
      const bd = layBoDem(r.id, undefined, now);
      const soHuu: SoHuuAdapter = e ? { loai: "edge", edgeNodeId: e.edgeNodeId, edgeCode: e.edgeCode } : { loai: "trung_tam" };
      return {
        adapterId: r.id,
        code: r.code,
        ten: r.name,
        protocol: r.protocol,
        endpoint: r.endpoint,
        machineId: r.machineId,
        labStub: r.protocol === "stub" && labBat,
        soHuu,
        trangThai: st.trangThai,
        tu: st.tu,
        loi: st.loi,
        soLanMat: st.soLanMat,
        pollMs: thongTinAdapter(r.id)?.pollMs ?? r.pollIntervalMs,
        p95Ms: bd.p95Ms,
        boDem1h: { request: bd.request, loi: bd.loi, timeout: bd.timeout, lenh: bd.lenh, lenhLoi: bd.lenhLoi },
        tag: demTag(r.id, tagBatTheoAdapter.get(r.id) ?? [], now),
      };
    });
  }),

  tagCuaAdapter: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ adapterId: adapterIdInput }))
    .query(async ({ ctx, input }) => {
      const a = await adapterTrongPhamVi(phamViCua(ctx), input.adapterId);
      const db = await getDb();
      const tags = await db
        .select({ tagKey: deviceTags.tagKey, address: deviceTags.address, isEnabled: deviceTags.isEnabled })
        .from(deviceTags)
        .where(eq(deviceTags.adapterId, a.id))
        .orderBy(asc(deviceTags.tagKey));
      const now = Date.now();
      const bd = layBoDem(a.id, undefined, now);
      return tags
        .filter((t) => t.isEnabled)
        .map((t) => {
          const g = layGiaTri(a.id, t.tagKey, now);
          const d = bd.theoTag[t.tagKey];
          return {
            tagKey: t.tagKey,
            address: t.address,
            v: g ? g.v : null,
            q: g ? g.q : null,
            statusCode: g ? g.statusCode : null,
            reason: g ? g.reason : null,
            // tuổi như bộ đệm tính (`layGiaTri`); chưa có giá trị ⇒ null + stale (không có gì "tươi" để hiện)
            ageMs: g ? g.ageMs : null,
            stale: g ? g.stale : true,
            boDem: { request: d?.request ?? 0, loi: d?.loi ?? 0, good: d?.good ?? 0, uncertain: d?.uncertain ?? 0, bad: d?.bad ?? 0 },
          };
        });
    }),

  mauTho: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ adapterId: adapterIdInput, tagKey: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const a = await adapterTrongPhamVi(phamViCua(ctx), input.adapterId);
      // fix 1 (CRITICAL) — `ot_telemetry.deviceId` dùng chung với ghi khác (MQTT/CFX/`/api/v1`, thường là machines.code): mã adapter
      // trùng mã thiết bị nhà máy khác ⇒ lọc (deviceId, metric) trả hàng của họ. Buộc hàng vào ĐÚNG adapter: `meta.adapterId` (chỉ đường
      // OT trong tiến trình ghi) + `machineId IS NOT DISTINCT FROM` máy của adapter — trên cả đường TSDB lẫn DB chính.
      const rows = await layMauThoTheoThietBi(a.code, input.tagKey, 100, { adapterId: a.id, machineId: a.machineId });
      return rows.map((r) => {
        const m = (r.meta ?? {}) as Record<string, unknown>;
        return {
          ts: new Date(r.ts).toISOString(),
          giaTri: r.numValue ?? r.textValue ?? r.boolValue ?? null,
          quality: r.quality,
          statusCode: typeof m.statusCode === "string" ? m.statusCode : null,
          // cột không có trong ot_telemetry; chỉ khi một bản ghi tự mang trong meta
          tsSource: m.tsSource === "device" || m.tsSource === "server" ? (m.tsSource as "device" | "server") : null,
        };
      });
    }),

  /**
   * Làm mới phiên driver qua đường nối lại SẴN CÓ (`resetAdapterSession`). Adapter legacy đang `active`: báo `connecting` TRƯỚC (reset
   * không báo gì trong lúc gỡ/nối ⇒ M10 không hiện "connected" cũ); supervisor (HA) tự báo qua callback, adapter không chạy ở trung tâm
   * không có ai báo tiếp ⇒ cả hai KHÔNG được báo thay.
   * fix 1 — reset KHÔNG thành công mà trạng thái vẫn là `connecting` của chính ta (otManager chưa báo gì: vd "OT stopped during the
   * reset", "a reconnect is already in flight") ⇒ TRẢ LẠI trạng thái trước (không báo `lost`: phiên có thể chưa hề bị gỡ, `lost` sẽ
   * đếm một đợt mất giả + phát mẫu xấu giả). Kết cục thật do otManager báo (lost khi hết hạn/nối thất bại, disabled khi stopOt/detach).
   */
  ketNoiLai: kySuProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ adapterId: adapterIdInput, lyDo: lyDoInput }))
    .mutation(async ({ ctx, input }) => {
      const a = await adapterTrongPhamVi(phamViCua(ctx), input.adapterId);
      await tuChoiNeuEdge(a.id, "scadaReconnectAdapter");
      const st = getOtAdapterStatus(a.id);
      const truoc = layTrangThaiAdapter(a.id); // đọc TRƯỚC khi báo connecting / reset (audit + trả lại khi reset không thành)
      const baoConnecting = st?.mode === "legacy" && st.state === "active";
      if (baoConnecting) baoTrangThaiAdapter(adapterBao(a), "connecting", null);
      const kq = await resetAdapterSession(a.id, "scada_diag");
      if (baoConnecting && !kq.reset && truoc && layTrangThaiAdapter(a.id)?.tt === "connecting") {
        baoTrangThaiAdapter(adapterBao(a), truoc.tt, truoc.loi);
      }
      const db = await getDb();
      await recordAuditEvent(db, {
        entityType: "device_adapter",
        entityId: a.id,
        action: "scada_ket_noi_lai",
        actorId: ctx.user.id,
        before: { trangThai: truoc?.tt ?? null, mode: st?.mode ?? null },
        after: kq,
        reason: input.lyDo,
      });
      return kq;
    }),

  /** `isEnabled=false` + audit (một transaction), rồi gỡ khỏi OT (`detachOtAdapter`) và báo `disabled`. Bộ đếm 1 h KHÔNG bị xoá. */
  tamTat: kySuProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ adapterId: adapterIdInput, lyDo: lyDoInput }))
    .mutation(async ({ ctx, input }) => {
      const a = await adapterTrongPhamVi(phamViCua(ctx), input.adapterId);
      await tuChoiNeuEdge(a.id, "scadaDisableAdapter");
      const db = await getDb();
      await db.transaction(async (tx) => {
        await tx.update(deviceAdapters).set({ isEnabled: false, updatedAt: new Date() }).where(eq(deviceAdapters.id, a.id));
        await recordAuditEvent(tx, {
          entityType: "device_adapter",
          entityId: a.id,
          action: "scada_tam_tat",
          actorId: ctx.user.id,
          before: { isEnabled: a.isEnabled, status: a.status },
          after: { isEnabled: false },
          reason: input.lyDo,
        });
      });
      const daGo = await detachOtAdapter(a.id, "scada_diag: tamTat");
      baoTrangThaiAdapter(adapterBao(a), "disabled", null);
      return { daGo };
    }),

  /** Lab (SCADA_LAB_ENABLED): đặt lỗi mô phỏng cho stub ĐANG CHẠY của adapter (`{}` = hết lỗi). Chỉ protocol `stub`. */
  datLoiStub: kySuProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ adapterId: adapterIdInput, loi: loiStubInput }))
    .mutation(async ({ ctx, input }) => {
      if (process.env.SCADA_LAB_ENABLED !== "true") {
        throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "scadaLab" }, "Chế độ Lab tắt (SCADA_LAB_ENABLED).");
      }
      const a = await adapterTrongPhamVi(phamViCua(ctx), input.adapterId);
      if (a.protocol !== "stub") {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "scadaSetStubFault", reason: "adapterNotStub" }, "Chỉ adapter stub.");
      }
      await tuChoiNeuEdge(a.id, "scadaSetStubFault");
      const db = await getDb();
      // `layStubDangChay` tra theo ENDPOINT: hai adapter stub chung endpoint ⇒ không biết instance là của ai ⇒ từ chối (không đụng nhầm
      // stub của adapter khác — có thể ngoài phạm vi người gọi).
      const [{ n }] = (await db.execute(
        sql`SELECT count(*)::int AS n FROM device_adapters WHERE protocol = 'stub' AND endpoint = ${a.endpoint}`,
      )) as unknown as Array<{ n: number }>;
      if (Number(n) > 1) {
        throw appError(
          "CONFLICT",
          "OPERATION_FAILED",
          { operation: "scadaSetStubFault", reason: "stubEndpointShared" },
          "Nhiều adapter stub dùng chung endpoint này.",
        );
      }
      const stub = layStubDangChay(a.endpoint);
      stub?.simDatLoi(input.loi as LoiStub);
      await recordAuditEvent(db, {
        entityType: "device_adapter",
        entityId: a.id,
        action: "scada_dat_loi_stub",
        actorId: ctx.user.id,
        before: null,
        after: { loi: input.loi, apDung: !!stub },
        reason: null,
      });
      return { apDung: !!stub };
    }),
});
