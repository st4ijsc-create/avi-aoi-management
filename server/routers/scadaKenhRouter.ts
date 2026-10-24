/**
 * SCADA R1a Task 12 — M12 "Kênh & giới hạn" (`scadaKenh`; ruling R-2: kế hoạch gọi `scada.kenh.*` = `trpc.scadaKenh.*`).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * THỦ TỤC
 *   danhSach({adapterId})                                   — kênh của một adapter: loại kênh (hiệu lực + đã khai), hiển thị, dải/bước,
 *                                                             mức tác động (đã khai + hiệu lực, NULL ⇒ 5), có phải kênh chế độ không.
 *   capNhat({tagId, patch, lyDo})                           — khai / sửa các cột kênh (mig 0431) của MỘT tag.
 *   cheDo.danhSach()                                        — máy trong phạm vi (có adapter hoặc đã khai kênh chế độ) + kênh chế độ +
 *                                                             `cheDoMay` hiện tại + `canhBaoNguon` + (R1b-1 Task 2) `coGhimStop` /
 *                                                             `soAdapterGhimStop` (adapter BẬT mang ≥ 1 ghim DỪNG hợp lệ) + `khaNangDung`
 *                                                             (khảo sát khả năng dừng từng adapter — `services/scada/khaNangDung.ts`).
 *   cheDo.dat({machineId, adapterId, tagKey, giaTriRemote, lyDo}) / cheDo.go({machineId, lyDo}) — khai / gỡ kênh chế độ của máy.
 *
 * QUYỀN: query = MOD_OT_CONTROL + `machine_control.canView`; mutation = vai admin|engineer + 2FA + MOD_OT_CONTROL +
 *   `machine_control.canEdit` (khuôn `kySuProcedure` của scadaDiagRouter).
 * TOTP TƯƠI (kiem-dinh P1-2, 2026-10-24): ba mutation (capNhat, cheDo.dat, cheDo.go) hạ được `actuation_level` và đổi cổng LOCAL/REMOTE
 *   ⇒ MỖI lượt có thay đổi phải mang `totpCode` tươi: `kiemTotpCauHinh` = `kiemXacThucTheoMuc(ctx, 5, totpCode)`.
 *   Vì sao mức 5 trong handler, không phải middleware `requireFreshTotp`: middleware ấy là pass-through khi `ACTUATION_STEPUP_2FA` tắt
 *   (dev hiện tại) và cache 10 phút theo phiên; `kiemXacThucTheoMuc` mức 5 KHÔNG đọc cờ env nào, không đọc cache, mã dùng một lần, dùng
 *   chung khoá sai T16 (`TOTP_TAM_KHOA`). Kiểm ĐẶT CUỐI — ngay trước lượt ghi, sau phạm vi / kiểm hợp lệ / nhất quán — để một lỗi kiểm hợp
 *   lệ không tiêu mã (cùng nguyên tắc R1a final M-3). Lượt không đổi gì (`changed:false`, `daGo:false`) không ghi ⇒ không đòi mã.
 *   Ba thủ tục thuộc nhóm giới hạn "2fa" (trpcGioiHanThuTuc.ts) — việc cấu hình hiếm, bóp tần suất chấp nhận được.
 * PHẠM VI: MỌI thủ tục kiểm lại ở máy chủ (`idsTrongPhamVi("machine", phamViCua(ctx), {strict:true})`); adapter không gắn máy chỉ với
 *   phạm vi toàn quyền; "không tồn tại" và "ngoài phạm vi" trả CÙNG một NOT_FOUND.
 * AUDIT: mỗi mutation có thay đổi ghi `recordAuditEvent` bằng CHÍNH `tx` của thay đổi (before / after / lyDo) — lỗi ⇒ cả hai rollback.
 *   Không đổi gì ⇒ không ghi, không audit.
 *
 * NHẤT QUÁN LÚC CẤU HÌNH (`server/services/scada/nhatQuanKenh.ts`) — khi patch chạm loại kênh / dải / bước:
 *   • giá trị DỪNG đang ghim của tag phải còn ghi được trên khai báo mới ⇒ không thì `STOP_PIN_NGOAI_DAI` (điều phối mục 4: đổi lấy việc
 *     DỪNG ghim được miễn dải trong `dispatch()`); chiều ghim ⇒ `stopPin.datStopPin`.
 *   • `commandValue` của mọi luật interlock ĐANG BẬT nhắm tag này phải còn ghi được ⇒ không thì `INTERLOCK_NGOAI_DAI` (review T3 M-3);
 *     chiều luật ⇒ `interlockRouter` create/update/approve/enable.
 *   Khoá (fix round 1): THỨ TỰ LUẬT → TAG ở mọi bên — capNhat khoá FOR SHARE mọi luật nhắm tag rồi tag FOR UPDATE (datStopPin khoá cùng
 *   hàng tag); interlockRouter khoá luật FOR UPDATE rồi tag FOR SHARE ⇒ không lọt, không vòng chờ (40P01 còn sót ⇒ CONFLICT thử lại).
 *
 * ĐỂ R2 (không làm ở đây): hạ mức tác động (5→3) hay nới dải KHÔNG cần người thứ hai duyệt trong R1a.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { router, moduleProcedure, moduleGate, roleProcedure, require2FA } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import { getDb as getDbRaw } from "../db";
import { deviceAdapters, deviceTags, machines, scadaKenhCheDo, type DeviceTag } from "../../drizzle/schema";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import { recordAuditEvent } from "../services/audit/controlAuditService";
import { isEdgeControlSchemaMissing } from "../services/edge/edgeControlSchema";
import { kiemGiaTriGhi, laKenhGhi, loaiKenh, mucTacDongKenh, type LoaiKenh } from "../services/scada/kenhScada";
import { cheDoMay, type CheDo } from "../services/scada/cheDoMay";
import { khoaLuatNhamTagTx, kiemNhatQuanKenh, soHienThi, viPhamInterlock, type KenhNhatQuan } from "../services/scada/nhatQuanKenh";
import { tagDeadbandEnabled } from "../services/ot/otManager";
import { TAG_DUNG_MAC_DINH } from "../services/ot/tagLenhMacDinh";
import { validateStopValue } from "../services/ot/stopPin";
import { khaoSatKhaNangDungNhieu, type KhaNangDungMay } from "../services/scada/khaNangDung";

/**
 * R1b-1 T2 — số adapter bật có ≥ 1 ghim DỪNG hợp lệ (mọi kết luận ≠ chua_ghim). fix round 3: khảo sát LỖI (`loiKhaoSat`) / vắng ⇒ null
 * (KHÔNG BIẾT — không được đọc thành "chưa ghim" / 0 adapter).
 */
const soCoGhim = (k: KhaNangDungMay | undefined): number | null =>
  !k || k.loiKhaoSat ? null : k.adapters.filter((a) => a.trangThai !== "chua_ghim").length;
const coGhim = (k: KhaNangDungMay | undefined): boolean | null => {
  const n = soCoGhim(k);
  return n === null ? null : n > 0;
};
import { canonicalOtValue } from "../services/ot/otActionBinding";
import type { MucRuiRo } from "../services/ot/aiControlGate";
// kiem-dinh P1-2 — TOTP TƯƠI (mức 5) + ánh xạ lỗi: R1b-1 Task 9 chuyển sang `services/scada/totpCauHinh.ts` để `deviceAdapter.tags.update` và
// `mappingAsCode.applyImport` (trỏ lại kênh đã khai) dùng CHUNG một bộ mã lỗi / khoá i18n.
import { kiemTotpCauHinh, totpCauHinhInput as totpInput } from "../services/scada/totpCauHinh";

const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
const kySuProcedure = roleProcedure("admin", "engineer").use(require2FA).use(moduleGate("MOD_OT_CONTROL"));

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return db;
}

const khongThayAdapter = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
const khongThayTag = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
const khongThayMay = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Máy không tồn tại.");

/** Nhìn thấy được với tập máy trong phạm vi: null = toàn quyền; KHÔNG gắn máy chỉ khi toàn quyền. */
function nhinThay(machineId: number | null, idsMay: number[] | null): boolean {
  if (idsMay === null) return true;
  return machineId !== null && idsMay.includes(machineId);
}

const idsMayCua = (ctx: Parameters<typeof phamViCua>[0]) => idsTrongPhamVi("machine", phamViCua(ctx), { strict: true });

/** Cột kênh (mig 0431) — before/after của audit và kết quả trả về. */
const COT_KENH = ["channelKind", "displayName", "displayFormat", "writeMin", "writeMax", "writeStep", "actuationLevel"] as const;
type CotKenh = (typeof COT_KENH)[number];
type KhaiKenh = Pick<DeviceTag, CotKenh>;
/** Cột mà cổng kênh của `dispatch()` đọc (đổi một trong số này ⇒ kiểm nhất quán với ghim DỪNG + luật interlock). */
const COT_CONG_KENH: ReadonlySet<CotKenh> = new Set(["channelKind", "writeMin", "writeMax", "writeStep"]);

function khaiCua(t: KhaiKenh): KhaiKenh {
  return {
    channelKind: t.channelKind ?? null,
    displayName: t.displayName ?? null,
    displayFormat: t.displayFormat ?? null,
    writeMin: t.writeMin ?? null,
    writeMax: t.writeMax ?? null,
    writeStep: t.writeStep ?? null,
    actuationLevel: t.actuationLevel ?? null,
  };
}

const lyDoInput = z.string().trim().min(5).max(300);
const loaiKenhInput = z.enum(["input", "input_output", "calculated", "calculated_output", "output"]);
const chuoiHienThi = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));
const patchInput = z
  .object({
    channelKind: loaiKenhInput.nullable().optional(),
    displayName: chuoiHienThi(128),
    displayFormat: chuoiHienThi(64),
    writeMin: z.number().finite().nullable().optional(),
    writeMax: z.number().finite().nullable().optional(),
    writeStep: z.number().finite().positive().nullable().optional(),
    actuationLevel: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(5)]).nullable().optional(),
  })
  .strict();

export type CanhBaoNguon = "deadband" | "edge" | "bao_khi_doi" | null;

/**
 * Điều phối 2026-10-24 (fix round 1) — "kênh dừng" CHƯA KHAI: tag mà lệnh stop của tool AI máy nhắm tới (`TAG_DUNG_MAC_DINH` = tag mặc
 * định của `machine_stop` trong `aiLocalTools/writeHandlers/machineControl.ts`, khi máy chưa ghim tag DỪNG — không thêm mẫu tên nào) mà
 * CHƯA khai mức tác động (NULL ⇒ mức 5 ⇒ TOTP mỗi lần trên HMI) VÀ CHƯA ghim giá trị DỪNG (lệnh dừng không được miễn kiểm an toàn).
 */
export function laKenhDungChuaKhai(t: Pick<DeviceTag, "tagKey" | "actuationLevel" | "stopValue">): boolean {
  return t.tagKey === TAG_DUNG_MAC_DINH && t.actuationLevel == null && (t.stopValue === null || t.stopValue === undefined);
}

/** postgres phát hiện vòng chờ khoá (40P01) — drizzle bọc lỗi driver trong `cause`. */
function laDeadlock(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && typeof e === "object" && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "40P01") return true;
  }
  return false;
}

const thuLai = () =>
  appError(
    "CONFLICT",
    "OPERATION_FAILED",
    { operation: "scadaKenhCapNhat", reason: "scadaKenhThuLai" },
    "Kênh vừa bị thay đổi đồng thời — tải lại rồi thử lại.",
  );

/**
 * Adapter do EDGE sở hữu (mig 0374: `device_adapters."edgeNodeId"`, không có trong schema drizzle — khuôn `scadaDiagRouter.soHuuEdge`).
 * Thiếu schema edge ⇒ không adapter nào thuộc edge; lỗi khác ⇒ ném.
 */
async function adapterEdge(ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (ids.length === 0) return out;
  const db = await getDb();
  try {
    const rows = (await db.execute(sql`SELECT a."id" AS id FROM device_adapters a
      WHERE a."edgeNodeId" IS NOT NULL AND a."id" IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`)) as unknown as Array<{ id: number }>;
    for (const r of rows) out.add(Number(r.id));
  } catch (err) {
    if (!isEdgeControlSchemaMissing(err)) throw err;
  }
  return out;
}

/**
 * Giao thức nào BÁO KHI ĐỔI (giá trị chỉ tới khi thay đổi ⇒ kênh chế độ dễ thành `cu` ⇒ LOCAL). Trong `otprotocolenum` (opcua, modbus,
 * s7, mitsubishi-mc, ethernet-ip, stub, slmp) chỉ OPC UA có đường đẩy: monitored items khi `OT_OPCUA_MONITORED_ITEMS` bật (cùng điều
 * kiện `opcuaDriver.monitoredItemsEnabled`, không import driver để khỏi kéo node-opcua). MQTT không phải giao thức của device_adapters.
 */
function baoKhiDoi(protocol: string | null): boolean {
  if (protocol !== "opcua") return false;
  const v = process.env.OT_OPCUA_MONITORED_ITEMS;
  return v === "true" || v === "1";
}

/**
 * Bộ lọc report-by-exception per tag của otManager (`makeDeadbandSink`) có đang làm thưa giá trị kênh chế độ không — fix round 1 (minor 2).
 * Bộ lọc CHỈ chạy khi `OT_TAG_DEADBAND_ENABLED` bật (`tagDeadbandEnabled`; tắt ⇒ chuyển thẳng mọi mẫu ⇒ không cảnh báo). Hai đường của
 * CÙNG bộ lọc, cùng một cảnh báo "deadband" (không thêm giá trị mới: cùng cờ, cùng sink, cùng cách gỡ = sửa cấu hình lọc của tag):
 *   • deadband > 0 (0 không lọc gì);
 *   • samplingMs > 3·pollMs — mẫu thưa hơn ngưỡng `cu` cơ bản của bộ đệm (`max(3·poll, …)`) ⇒ kênh dễ thành `cu` giữa hai lần chuyển.
 */
function locThuaMau(k: { deadband: number | null; samplingMs: number | null; pollMs: number | null }): boolean {
  if (!tagDeadbandEnabled()) return false;
  if (k.deadband != null && k.deadband > 0) return true;
  const poll = k.pollMs != null && k.pollMs > 0 ? k.pollMs : 5000;
  return k.samplingMs != null && k.samplingMs > 3 * poll;
}

/** Một cảnh báo (nặng nhất trước): edge (trung tâm không có số liệu) > báo khi đổi > deadband (bộ lọc report-by-exception đang chạy). */
function canhBaoCua(
  k: { adapterId: number; protocol: string | null; deadband: number | null; samplingMs: number | null; pollMs: number | null },
  edge: Set<number>,
): CanhBaoNguon {
  if (edge.has(k.adapterId)) return "edge";
  if (baoKhiDoi(k.protocol)) return "bao_khi_doi";
  if (locThuaMau(k)) return "deadband";
  return null;
}

const cheDoRouter = router({
  danhSach: protectedProcedure.use(requirePermission("machine_control", "canView")).query(async ({ ctx }) => {
    const db = await getDb();
    const idsMay = await idsMayCua(ctx);
    if (idsMay !== null && idsMay.length === 0) return [];
    const coNoi = or(
      sql`EXISTS (SELECT 1 FROM device_adapters a WHERE a."machineId" = ${machines.id})`,
      sql`EXISTS (SELECT 1 FROM scada_kenh_che_do k WHERE k.machine_id = ${machines.id})`,
    );
    const mays = await db
      .select({ id: machines.id, code: machines.code, name: machines.name })
      .from(machines)
      .where(idsMay === null ? coNoi : and(inArray(machines.id, idsMay), coNoi))
      .orderBy(asc(machines.code));
    if (mays.length === 0) return [];
    const kenhs = await db
      .select({
        machineId: scadaKenhCheDo.machineId,
        adapterId: scadaKenhCheDo.adapterId,
        tagKey: scadaKenhCheDo.tagKey,
        giaTriRemote: scadaKenhCheDo.giaTriRemote,
        updatedBy: scadaKenhCheDo.updatedBy,
        updatedAt: scadaKenhCheDo.updatedAt,
        dataType: deviceTags.dataType,
        deadband: deviceTags.deadband,
        samplingMs: deviceTags.samplingMs,
        protocol: deviceAdapters.protocol,
        pollMs: deviceAdapters.pollIntervalMs,
        adapterMachineId: deviceAdapters.machineId,
      })
      .from(scadaKenhCheDo)
      .leftJoin(deviceAdapters, eq(deviceAdapters.id, scadaKenhCheDo.adapterId))
      .leftJoin(deviceTags, and(eq(deviceTags.adapterId, scadaKenhCheDo.adapterId), eq(deviceTags.tagKey, scadaKenhCheDo.tagKey)))
      .where(
        inArray(
          scadaKenhCheDo.machineId,
          mays.map((m) => m.id),
        ),
      );
    const theoMay = new Map(kenhs.map((k) => [k.machineId, k] as const));
    const edge = await adapterEdge([...new Set(kenhs.map((k) => k.adapterId))]);
    // R1b-1 T2 fix round 1 — khả năng dừng từng adapter (MỘT hàm dùng chung với hộp xác nhận DỪNG MÁY và cảnh báo cấp máy)
    const khaNang = await khaoSatKhaNangDungNhieu(db, mays.map((m) => m.id));
    return Promise.all(
      mays.map(async (m) => {
        const k = theoMay.get(m.id);
        // Không có hàng kênh ⇒ cheDoMay trả đúng LOCAL `chua_khai` (không cần truy vấn thêm).
        const cd: CheDo = k ? await cheDoMay(m.id) : { cheDo: "LOCAL", lyDo: "chua_khai" };
        // fix round 1 (minor 3) — kênh trỏ adapter người xem KHÔNG thấy (máy ngoài phạm vi / không gắn máy, khi không toàn quyền) hoặc kênh
        // sai máy ⇒ CHE chi tiết kênh (adapterId, tagKey, dataType, cảnh báo); chỉ giữ chế độ + lyDo của máy (máy thì người xem thấy).
        const anKenh = !!k && (!nhinThay(k.adapterMachineId ?? null, idsMay) || cd.lyDo === "kenh_sai_may");
        const hien = k && !anKenh ? k : null;
        return {
          machineId: m.id,
          code: m.code,
          ten: m.name,
          kenhAn: anKenh,
          kenh: hien
            ? {
                adapterId: hien.adapterId,
                tagKey: hien.tagKey,
                giaTriRemote: hien.giaTriRemote,
                dataType: hien.dataType ?? null,
                updatedBy: hien.updatedBy,
                updatedAt: new Date(hien.updatedAt).toISOString(),
              }
            : null,
          cheDo: cd.cheDo,
          lyDo: cd.lyDo,
          // R1b-1 Task 2 — nút DỪNG MÁY gửi tới bao nhiêu adapter (adapter có ghim; 0 ⇒ "Máy chưa ghim STOP") + khả năng dừng từng adapter
          soAdapterGhimStop: soCoGhim(khaNang.get(m.id)),
          coGhimStop: coGhim(khaNang.get(m.id)),
          khaNangDung: khaNang.get(m.id) ?? { machineId: m.id, adapters: [], tongHop: "khong" as const },
          canhBaoNguon: hien
            ? canhBaoCua(
                {
                  adapterId: hien.adapterId,
                  protocol: hien.protocol ?? null,
                  deadband: hien.deadband ?? null,
                  samplingMs: hien.samplingMs ?? null,
                  pollMs: hien.pollMs ?? null,
                },
                edge,
              )
            : null,
        };
      }),
    );
  }),

  /**
   * Khai (upsert) kênh chế độ của máy. Kênh phải là tag của adapter gắn ĐÚNG máy này và đang bật; `giaTriRemote` ép kiểu theo `dataType`
   * của tag (`kiemGiaTriGhi`, không dải) và lưu dạng đã ép. Adapter đọc FOR SHARE (không bị chuyển máy giữa lúc kiểm và lúc commit).
   */
  dat: kySuProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(
      z.object({
        machineId: z.number().int().positive(),
        adapterId: z.number().int().positive(),
        tagKey: z.string().min(1).max(128),
        giaTriRemote: z.union([z.number().finite(), z.boolean(), z.string().max(256)]),
        lyDo: lyDoInput,
        totpCode: totpInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const idsMay = await idsMayCua(ctx);
      const db = await getDb();
      return db.transaction(async (tx) => {
        const [may] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.id, input.machineId)).limit(1);
        if (!may || !nhinThay(may.id, idsMay)) throw khongThayMay();
        const [a] = await tx
          .select({ id: deviceAdapters.id, machineId: deviceAdapters.machineId, isEnabled: deviceAdapters.isEnabled })
          .from(deviceAdapters)
          .where(eq(deviceAdapters.id, input.adapterId))
          .limit(1)
          .for("share");
        if (!a || !nhinThay(a.machineId, idsMay)) throw khongThayAdapter();
        if (a.machineId !== may.id) {
          throw appError(
            "BAD_REQUEST",
            "INVALID_VALUE",
            { field: "adapterId", reason: "scadaKenhCheDoSaiMay" },
            "Kênh chế độ phải là tag của adapter gắn đúng máy này.",
          );
        }
        if (a.isEnabled !== true) {
          throw appError(
            "BAD_REQUEST",
            "INVALID_VALUE",
            { field: "adapterId", reason: "scadaKenhCheDoAdapterTat" },
            "Adapter của kênh chế độ đang tắt.",
          );
        }
        const [tag] = await tx
          .select({ dataType: deviceTags.dataType, isEnabled: deviceTags.isEnabled })
          .from(deviceTags)
          .where(and(eq(deviceTags.adapterId, a.id), eq(deviceTags.tagKey, input.tagKey)))
          .limit(1);
        if (!tag) throw khongThayTag();
        // fix round 1 (phán quyết c5) — tag tắt không được poll ⇒ kênh chế độ luôn LOCAL `chua_co_mau`: từ chối như adapter tắt.
        // Adapter do edge sở hữu KHÔNG bị chặn ở đây — chỉ cảnh báo (`canhBaoNguon: "edge"`).
        if (tag.isEnabled !== true) {
          throw appError(
            "BAD_REQUEST",
            "INVALID_VALUE",
            { field: "tagKey", reason: "scadaKenhCheDoTagTat" },
            "Tag của kênh chế độ đang tắt.",
          );
        }
        const ep = kiemGiaTriGhi({ dataType: tag.dataType, writeMin: null, writeMax: null, writeStep: null }, input.giaTriRemote);
        if (!ep.ok) {
          throw appError(
            "BAD_REQUEST",
            "INVALID_VALUE",
            { field: "giaTriRemote", reason: "scadaGiaTriRemoteSaiKieu" },
            `Giá trị REMOTE không đúng kiểu ${tag.dataType} của tag: ${ep.chiTiet}`,
          );
        }
        const [cu] = await tx.select().from(scadaKenhCheDo).where(eq(scadaKenhCheDo.machineId, may.id)).limit(1).for("update");
        const sau = { adapterId: a.id, tagKey: input.tagKey, giaTriRemote: ep.giaTri };
        const truoc = cu ? { adapterId: cu.adapterId, tagKey: cu.tagKey, giaTriRemote: cu.giaTriRemote } : null;
        if (
          truoc &&
          truoc.adapterId === sau.adapterId &&
          truoc.tagKey === sau.tagKey &&
          canonicalOtValue(truoc.giaTriRemote) === canonicalOtValue(sau.giaTriRemote)
        ) {
          return { changed: false, machineId: may.id, ...sau };
        }
        await kiemTotpCauHinh(ctx, input.totpCode); // P1-2: cuối, ngay trước lượt ghi
        const now = new Date();
        await tx
          .insert(scadaKenhCheDo)
          .values({ machineId: may.id, ...sau, updatedBy: ctx.user.id, updatedAt: now })
          .onConflictDoUpdate({ target: scadaKenhCheDo.machineId, set: { ...sau, updatedBy: ctx.user.id, updatedAt: now } });
        await recordAuditEvent(tx, {
          entityType: "scada_kenh_che_do",
          entityId: may.id,
          action: "scada_kenh_che_do_dat",
          actorId: ctx.user.id,
          before: truoc,
          after: sau,
          reason: input.lyDo,
        });
        return { changed: true, machineId: may.id, ...sau };
      });
    }),

  /** Gỡ kênh chế độ của máy (máy thành LOCAL `chua_khai`). Không có kênh ⇒ `daGo: false`, không audit. */
  go: kySuProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ machineId: z.number().int().positive(), lyDo: lyDoInput, totpCode: totpInput }))
    .mutation(async ({ ctx, input }) => {
      const idsMay = await idsMayCua(ctx);
      const db = await getDb();
      return db.transaction(async (tx) => {
        const [may] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.id, input.machineId)).limit(1);
        if (!may || !nhinThay(may.id, idsMay)) throw khongThayMay();
        const [cu] = await tx.select().from(scadaKenhCheDo).where(eq(scadaKenhCheDo.machineId, may.id)).limit(1).for("update");
        if (!cu) return { daGo: false };
        await kiemTotpCauHinh(ctx, input.totpCode); // P1-2: cuối, ngay trước lượt ghi
        await tx.delete(scadaKenhCheDo).where(eq(scadaKenhCheDo.machineId, may.id));
        await recordAuditEvent(tx, {
          entityType: "scada_kenh_che_do",
          entityId: may.id,
          action: "scada_kenh_che_do_go",
          actorId: ctx.user.id,
          before: { adapterId: cu.adapterId, tagKey: cu.tagKey, giaTriRemote: cu.giaTriRemote },
          after: null,
          reason: input.lyDo,
        });
        return { daGo: true };
      });
    }),
});

export const scadaKenhRouter = router({
  /** Kênh của một adapter. Chỉ cột của TAG (không endpoint / lastError / connectionOptions của adapter, không địa chỉ thanh ghi). */
  danhSach: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ adapterId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const idsMay = await idsMayCua(ctx);
      const [a] = await db
        .select({ id: deviceAdapters.id, machineId: deviceAdapters.machineId })
        .from(deviceAdapters)
        .where(eq(deviceAdapters.id, input.adapterId))
        .limit(1);
      if (!a || !nhinThay(a.machineId, idsMay)) throw khongThayAdapter();
      const tags = await db.select().from(deviceTags).where(eq(deviceTags.adapterId, a.id)).orderBy(asc(deviceTags.tagKey));
      const kenhCheDo = new Set(
        (await db.select({ tagKey: scadaKenhCheDo.tagKey }).from(scadaKenhCheDo).where(eq(scadaKenhCheDo.adapterId, a.id))).map((r) => r.tagKey),
      );
      return tags.map((t) => ({
        tagId: t.id,
        tagKey: t.tagKey,
        dataType: t.dataType,
        unit: t.unit ?? null,
        writable: t.writable,
        isEnabled: t.isEnabled,
        loaiKenh: loaiKenh(t) as LoaiKenh,
        channelKindKhai: (t.channelKind ?? null) as LoaiKenh | null,
        displayName: t.displayName ?? null,
        displayFormat: t.displayFormat ?? null,
        writeMin: t.writeMin ?? null,
        writeMax: t.writeMax ?? null,
        writeStep: t.writeStep ?? null,
        actuationLevel: (t.actuationLevel ?? null) as MucRuiRo | null,
        mucHieuLuc: mucTacDongKenh(t),
        // giá trị DỪNG ghim (nếu có) — M12 hiện để kỹ sư biết vì sao một dải bị từ chối (STOP_PIN_NGOAI_DAI)
        stopValue: (t.stopValue ?? null) as boolean | number | string | null,
        laKenhCheDo: kenhCheDo.has(t.tagKey),
        canhBaoKenhDung: laKenhDungChuaKhai(t),
      }));
    }),

  /**
   * Khai / sửa các cột kênh của MỘT tag (patch một phần: trường vắng = giữ nguyên, `null` = bỏ khai). Kiểm trên hàng ĐÃ GỘP: min <= max,
   * bước > 0, mức ∈ {1,3,4,5} | null, dải/bước chỉ cho kênh số (int/float); chạm loại kênh / dải / bước ⇒ nhất quán với ghim DỪNG và
   * luật interlock đang bật (xem đầu tệp). UPDATE + audit cùng `tx`.
   * fix round 1 (minor 1) — THỨ TỰ KHOÁ LUẬT → TAG (như interlockRouter: luật FOR UPDATE rồi tag FOR SHARE): đọc tag KHÔNG khoá (phạm vi,
   * khoá luật theo đích), khoá FOR SHARE mọi luật nhắm (adapterId, tagKey), RỒI mới khoá tag FOR UPDATE và kiểm lại tag vẫn là (adapterId,
   * tagKey) đó (đổi giữa chừng ⇒ CONFLICT thử lại). Lưới cuối: 40P01 (nếu một đường khác vẫn khoá ngược) ⇒ CONFLICT thử lại.
   */
  capNhat: kySuProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ tagId: z.number().int().positive(), patch: patchInput, lyDo: lyDoInput, totpCode: totpInput }))
    .mutation(async ({ ctx, input }) => {
      const patch: Partial<KhaiKenh> = {};
      for (const k of COT_KENH) {
        const v = input.patch[k];
        if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
      }
      const khoa = Object.keys(patch) as CotKenh[];
      if (khoa.length === 0) {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "patch" }, "Patch không có trường nào để đổi.");
      }
      const idsMay = await idsMayCua(ctx);
      const db = await getDb();
      try {
        return await db.transaction(async (tx) => {
          const [tag0] = await tx
            .select({ adapterId: deviceTags.adapterId, tagKey: deviceTags.tagKey })
            .from(deviceTags)
            .where(eq(deviceTags.id, input.tagId))
            .limit(1);
          if (!tag0) throw khongThayTag();
          const [a] = await tx
            .select({ machineId: deviceAdapters.machineId })
            .from(deviceAdapters)
            .where(eq(deviceAdapters.id, tag0.adapterId))
            .limit(1);
          if (!a || !nhinThay(a.machineId, idsMay)) throw khongThayTag(); // ngoài phạm vi = không tồn tại
          // LUẬT trước (FOR SHARE, mọi luật nhắm tag này, bật hay tắt), TAG sau (FOR UPDATE) — xem docstring.
          const luat = await khoaLuatNhamTagTx(tx, { adapterId: tag0.adapterId, tagKey: tag0.tagKey });
          const [tag] = await tx.select().from(deviceTags).where(eq(deviceTags.id, input.tagId)).limit(1).for("update");
          if (!tag) throw khongThayTag();
          if (tag.adapterId !== tag0.adapterId || tag.tagKey !== tag0.tagKey) throw thuLai();

          const truoc = khaiCua(tag);
          const sau: KhaiKenh = { ...truoc, ...patch };
          if (sau.writeMin != null && sau.writeMax != null && sau.writeMin > sau.writeMax) {
            throw appError(
              "BAD_REQUEST",
              "INVALID_VALUE",
              { field: "writeMin", reason: "scadaDaiMinLonHonMax" },
              `Giới hạn dưới ${sau.writeMin} lớn hơn giới hạn trên ${sau.writeMax}.`,
            );
          }
          const coDai = sau.writeMin != null || sau.writeMax != null || sau.writeStep != null;
          if (coDai && tag.dataType !== "int" && tag.dataType !== "float" && khoa.some((k) => k === "writeMin" || k === "writeMax" || k === "writeStep")) {
            throw appError(
              "BAD_REQUEST",
              "INVALID_VALUE",
              { field: "writeMin", reason: "scadaDaiChiChoKenhSo" },
              `Dải / bước chỉ áp cho kênh số (int / float); tag này kiểu ${tag.dataType}.`,
            );
          }
          // fix round 1 (minor 4) — loại kênh GHI (input_output / output / calculated_output) trên tag không ghi được (writable !== true):
          // khai báo nói dối — dispatch() vẫn từ chối mọi lệnh ghi (tag phải writable ở bước 3) mà M12/M4 lại hiện nó như kênh ra.
          if (khoa.includes("channelKind") && sau.channelKind != null && laKenhGhi({ channelKind: sau.channelKind, writable: tag.writable }) && tag.writable !== true) {
            throw appError(
              "BAD_REQUEST",
              "INVALID_VALUE",
              { field: "channelKind", reason: "scadaKenhGhiTrenTagKhongGhi" },
              `Loại kênh ${sau.channelKind} nhận lệnh ghi nhưng tag ${tag.tagKey} không cho phép ghi (writable=false).`,
            );
          }
          if (khoa.every((k) => sau[k] === truoc[k])) {
            return { changed: false, tagId: tag.id, ...sau, mucHieuLuc: mucTacDongKenh(sau) };
          }

          if (khoa.some((k) => COT_CONG_KENH.has(k))) {
            const kenhMoi: KenhNhatQuan = {
              dataType: tag.dataType,
              writable: tag.writable,
              channelKind: sau.channelKind,
              writeMin: sau.writeMin,
              writeMax: sau.writeMax,
              writeStep: sau.writeStep,
              scale: tag.scale, // kiem-dinh P1-3 — lưới thô (int) như dispatch()
              offset: tag.offset,
            };
            // Ghim DỪNG (kể cả khi tag đang tắt — bật lại thì ghim có hiệu lực ngay). Ghim không còn hợp lệ với dataType ⇒ dispatch bỏ qua nó.
            if (tag.stopValue !== null && tag.stopValue !== undefined) {
              const v = validateStopValue(String(tag.dataType), tag.stopValue);
              const nq = v.ok ? kiemNhatQuanKenh(kenhMoi, v.value) : ({ ok: true } as const);
              if (!nq.ok) {
                throw appError(
                  "BAD_REQUEST",
                  "STOP_PIN_NGOAI_DAI",
                  {
                    ma: "STOP_PIN_NGOAI_DAI",
                    lyDo: nq.ma,
                    tagKey: tag.tagKey,
                    stopValue: String(v.ok ? v.value : tag.stopValue),
                    min: soHienThi(sau.writeMin),
                    max: soHienThi(sau.writeMax),
                    step: soHienThi(sau.writeStep),
                  },
                  `Giá trị DỪNG đang ghim của kênh ${tag.tagKey} không ghi được với khai báo mới (${nq.chiTiet}). Gỡ / đổi ghim trước.`,
                );
              }
            }
            const vp = viPhamInterlock(luat, kenhMoi);
            if (vp) {
              throw appError(
                "BAD_REQUEST",
                "INTERLOCK_NGOAI_DAI",
                {
                  ma: "INTERLOCK_NGOAI_DAI",
                  lyDo: vp.ma,
                  tagKey: tag.tagKey,
                  min: soHienThi(sau.writeMin),
                  max: soHienThi(sau.writeMax),
                  step: soHienThi(sau.writeStep),
                  ruleId: vp.ruleId,
                },
                `Luật interlock đang bật #${vp.ruleId} (${vp.ruleName}) ghi một giá trị không ghi được với khai báo mới (${vp.chiTiet}).`,
              );
            }
          }

          await kiemTotpCauHinh(ctx, input.totpCode); // P1-2: cuối, ngay trước lượt ghi (sau kiểm hợp lệ + nhất quán)
          await tx
            .update(deviceTags)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(deviceTags.id, tag.id));
          await recordAuditEvent(tx, {
            entityType: "device_tag",
            entityId: tag.id,
            action: "scada_kenh_cap_nhat",
            actorId: ctx.user.id,
            before: { adapterId: tag.adapterId, tagKey: tag.tagKey, ...truoc },
            after: { adapterId: tag.adapterId, tagKey: tag.tagKey, ...sau },
            reason: input.lyDo,
          });
          return { changed: true, tagId: tag.id, ...sau, mucHieuLuc: mucTacDongKenh(sau) };
        });
      } catch (err) {
        if (laDeadlock(err)) throw thuLai();
        throw err;
      }
    }),

  cheDo: cheDoRouter,
});
