/**
 * SCADA R1b-2b-2a Task 5 (mục 63) — CENSUS AST "an toàn đường STOP": THỨ TỰ KHOÁ ADAPTER → LUẬT interlock + CẤM gọi POOL trong giao dịch giữ
 * khoá hàng. Khuôn: `thuTuKhoaTag.census.test.ts` (TypeScript compiler API, không regex dòng) + `moiFileDuoi` của `deployProcedureScan`.
 *
 * (A) ***∀ lượt khoá `interlock_rules` trong `server/**` (không test): trong CÙNG hàm, TRƯỚC nó (thứ tự nguồn) có một lượt khoá ADAPTER chắc chắn
 *     chạy (không nằm trong nhánh điều kiện), HOẶC hàm đó nằm trong `HAM_KHOA_LUAT_CO_HOP_DONG` (hợp đồng ghi rõ + được census KIỂM).***
 *     Vì sao: `congAdapterTx` (deviceAdapter.update / delete, scadaDiag.tamTat) khoá adapter FOR UPDATE rồi luật FOR SHARE; một đường khoá luật
 *     trước adapter là vòng chờ 40P01 với chúng (thứ tự khoá dự án: troLaiKenh.ts ADAPTER → LUẬT → TAG → KÊNH CHẾ ĐỘ).
 *     • lượt khoá luật = `.for(<chế độ>, …)` (chế độ là chuỗi "update" / "share" / "no key update" / "key share" HOẶC biểu thức — `.for(khoaLuat)`
 *       của `khoaDichLuatTx`) trên chuỗi có `.from(interlockRules)` / `.*Join(interlockRules)` (chuỗi dựng qua biến `q = …; q.for(…)` được lần
 *       theo khai báo / phép gán trong phạm vi khối), trừ khi `{ of: X }` chỉ khoá bảng khác; cộng SQL thô (chuỗi / template) có `interlock_rules`
 *       và `FOR UPDATE` / `FOR SHARE`;
 *     • lượt khoá ADAPTER = lời gọi `khoaAdapterTx(` / `congAdapterTx(`, chuỗi `.from(deviceAdapters)…for(…)`, SQL thô `device_adapters … FOR …`;
 *     • KD-C2 (kiem-dinh) — khoá adapter CÓ ĐIỀU KIỆN KHÔNG tính là "đã khoá trước": đi từ lượt khoá adapter lên tổ tiên chung với lượt khoá
 *       luật, gặp nhánh `if` / `?:` / vế phải `&&` `||` `??` / thân vòng lặp / `case` / `try` có `catch` / `catch` / ranh giới hàm / `?.` ⇒ không tính;
 *     • "cùng hàm" = hàm gần nhất, xuyên qua closure tổ hợp mảng / promise (`map`, `forEach`, `then`, `all`, …); callback `.transaction(` và thủ tục
 *       tRPC là ranh giới;
 *     • HỢP ĐỒNG được KIỂM, không chỉ tin: mỗi lời gọi một hàm hợp đồng loại `nguoi_goi_khoa_adapter` là một vị trí khoá luật "qua" (proxy) ở bên
 *       gọi — bên gọi phải tự khoá adapter trước (hoặc chính nó có hợp đồng); hàm hợp đồng loại `khong_khoa_adapter_sau` (giao dịch khoá luật mà
 *       không bao giờ khoá adapter) — chính nó và MỌI bên gọi (theo tên) không có lượt khoá adapter SAU lời gọi;
 *     • ∀ vị trí (trực tiếp + qua): KHÔNG có lượt khoá adapter SAU lượt khoá luật trong cùng hàm (đảo thứ tự thật).
 *
 * (B) ***Callback `.transaction(` giữ khoá hàng trong `server/routers/**`, `server/services/{scada,ot,interlock,engineeringAssignment}/**` KHÔNG gọi
 *     pool. Đo được = đúng tập nợ `NO_POOL_TRONG_TX` (ratchet: chỗ mới ⇒ đỏ; gỡ chỗ cũ ⇒ phải sửa tập).***
 *     Vì sao: lời gọi pool trong giao dịch giữ khoá = một kết nối THỨ HAI trong khi kết nối thứ nhất giữ khoá hàng ⇒ pool cạn là treo (mọi giao
 *     dịch giữ khoá chờ kết nối, kết nối chờ khoá), và lượt đọc qua pool KHÔNG thấy hàng ta đang khoá (TOCTOU — mục 62 của T4).
 *     • giữ khoá = thân (kể cả closure lồng) có `.for(`, lời gọi `khoa*Tx` / `congAdapterTx`, SQL thô `FOR UPDATE` / `FOR SHARE`, `.update(` /
 *       `.delete(`, hoặc gọi một hàm (điểm bất động như dưới) có các dấu hiệu ấy;
 *     • gọi pool (KD-C2 — ĐIỂM BẤT ĐỘNG xuyên tệp trên toàn `server/**` không test): hàm gọi một tên trong hạt `HAM_GOI_POOL` (theo TÊN, mọi gốc
 *       trừ tham số giao dịch), hoặc gọi một hàm đã trong tập — lặp tới bất động. Lời gọi được PHÂN GIẢI theo phạm vi tệp + `import` (kể cả
 *       `import()` động phá cấu trúc, `import * as`, `export … from` / `export *` của barrel); KHÔNG phân giải được (tệp đích không có hàm khai báo
 *       tên ấy — vd `export const f = boc(...)`) ⇒ BẢO THỦ: mọi hàm cấp tệp cùng tên trong `server/**`. Phương thức `x.ten(…)` khớp MỌI phương
 *       thức tên ấy (trùng tên ⇒ bảo thủ), trừ tên phương thức CHUNG (`TEN_CHUNG`). Cộng: tay cầm pool BẮT từ ngoài (`const db = await getDb()`
 *       ngoài callback, rồi `db.select(…)` trong callback).
 *
 * GIỚI HẠN đã biết (ghi rõ, không giả vờ đủ):
 *   • (A) vế "khoá adapter TRƯỚC" chỉ tính dấu hiệu trực tiếp trong cùng hàm (helper có thể khoá có điều kiện); vế "khoá adapter SAU" tính cả
 *     lời gọi tới hàm có thân khoá adapter (điểm bất động — fix round 1, review m5). Giao dịch trải nhiều hàm chỉ được nối qua hợp đồng có tên.
 *   • (A) "chắc chắn chạy" là xấp xỉ cú pháp: `if (!x) return; khoa…` vẫn tính là chắc chắn (đúng); `if (a) { khoa…; s } else { return }` tính là
 *     KHÔNG (bảo thủ, đỏ oan thì sửa mã hoặc ghi hợp đồng).
 *   • (B) lời gọi qua tham số / biến hàm / `bind` / phần tử mảng / `export default` / thành viên rút gọn `{ fnA }` không được phân giải (không coi
 *     là gọi pool); import không tương đối và `default` ⇒ `[]` (review m4 — đo: không có chỗ nào trong phạm vi hôm nay). `x.<tên chung>(…)`
 *     (`get`, `run`, `select`, …) không khớp theo tên — không loại thì điểm bất động nuốt cả cây (đo 2026-11-01: 8 817 tên). Chỗ mù này CÓ GIỚI
 *     HẠN (fix round 1, review I2): mọi phương thức first-party tên chung tới pool được GHIM (`TEN_CHUNG_GOI_POOL`, ratchet), và `x.<tên đã ghim>()`
 *     với `x` là đối tượng NHẬP được coi là gọi pool.
 *   • Tên hợp đồng chung chung (`lam`) khớp theo tên ở mọi tệp ⇒ chỉ có thể đỏ oan (review m6). Ca "đo (in bảng)" xanh trống khi không có
 *     `CENSUS_IN=1` (review m7 — để lại có chủ ý: công cụ đo, không phải khẳng định).
 *   • (B) tham số hàm bao ngoài làm tay cầm pool (`function f(db) { db.transaction(async (tx) => db.select…) }`) và tay cầm pool nhập từ module
 *     (`import { db }`) không bị bắt — chỉ biến khởi tạo từ một lời gọi pool.
 *   • (B) hạt chỉ là `HAM_GOI_POOL` (brief): `getReadDb` / `getJobsDb` (pool khác) không là hạt.
 *   • (B) bảo thủ ⇒ hàm `f(d?: DbHoacTx)` tự lấy pool khi thiếu `d` bị coi là gọi pool dù bên gọi truyền `tx` (nợ có thể là "nợ trên giấy" — ghi
 *     rõ trong lý do từng mục).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, gocChuoi } from "../../routers/deployProcedureScan";

const GOC_REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface ViTriKhoaLuat {
  /** `<đường tương đối>#<hàm bao ngoài gần nhất>`. */
  viTri: string;
  dong: number;
  coKhoaAdapterTruoc: boolean;
  /** Có lượt khoá adapter SAU vị trí này trong cùng hàm (đảo thứ tự thật — phải luôn `false`). */
  coKhoaAdapterSau: boolean;
  /** Vị trí "qua" (proxy): tên hàm hợp đồng được gọi; `null` = khoá trực tiếp. */
  qua: string | null;
}

export interface ViTriPoolTrongTx {
  viTri: string;
  dong: number;
  /** Tên (các) hàm / tay cầm gọi pool ở vị trí này (gộp theo `viTri`, ngăn bằng ","). */
  ham: string;
}

export interface TepNguon {
  duong: string;
  ma: string;
}

type LoaiHopDong = "nguoi_goi_khoa_adapter" | "khong_khoa_adapter_sau";
interface HopDong {
  viTri: string;
  loai: LoaiHopDong;
  ngay: string;
  lyDo: string;
}

/**
 * HỢP ĐỒNG — hàm khoá luật mà KHÔNG tự khoá adapter trước (đo bằng AST trên c2d07d00b, 2026-11-01). Census KIỂM hợp đồng ở mọi bên gọi (ca ★ (A)
 * và ★ hợp đồng): loại `nguoi_goi_khoa_adapter` ⇒ mỗi lời gọi là vị trí "qua" phải có khoá adapter trước; loại `khong_khoa_adapter_sau` ⇒ mỗi
 * lời gọi không có khoá adapter sau.
 */
const HOP_DONG: ReadonlyArray<HopDong> = [
  {
    viTri: "server/services/scada/troLaiKenh.ts#khoaLuatNhamCapTx",
    loai: "nguoi_goi_khoa_adapter",
    ngay: "2026-11-01",
    lyDo: "bên gọi deviceAdapterRouter tags.create / tags.update / tags.delete — `khoaAdapterTx` ngay trước (đo: mọi lời gọi coKhoaAdapterTruoc)",
  },
  {
    viTri: "server/services/scada/troLaiKenh.ts#khoaLuatNhamAdapterTx",
    loai: "nguoi_goi_khoa_adapter",
    ngay: "2026-11-01",
    lyDo: "bên gọi scadaKenhRouter khaiHangLoat + mappingAsCode importMapping (`khoaAdapterTx` trước); congAdapterTx (hợp đồng dưới)",
  },
  {
    viTri: "server/services/scada/troLaiKenh.ts#khoaLuatNguonTx",
    loai: "nguoi_goi_khoa_adapter",
    ngay: "2026-11-01",
    lyDo: "bên gọi deviceAdapterRouter tags.* + mappingAsCode importMapping (`khoaAdapterTx` trước); congAdapterTx (hợp đồng dưới)",
  },
  {
    viTri: "server/services/scada/troLaiKenh.ts#congAdapterTx",
    loai: "nguoi_goi_khoa_adapter",
    ngay: "2026-11-01",
    lyDo: "cổng adapter: bên gọi deviceAdapter.update / deviceAdapter.delete / scadaDiag.tamTat khoá hàng adapter `.for(\"update\")` NGAY đầu giao dịch",
  },
  {
    viTri: "server/services/scada/nhatQuanKenh.ts#khoaLuatNhamTagTx",
    loai: "nguoi_goi_khoa_adapter",
    ngay: "2026-11-01",
    lyDo: "bên gọi duy nhất scadaKenh.capNhat — `khoaAdapterTx` ngay trước (R1b-1 T10)",
  },
  {
    viTri: "server/services/engineeringAssignment/assignmentService.ts#loadTarget",
    loai: "khong_khoa_adapter_sau",
    ngay: "2026-11-01",
    lyDo:
      "`loadTarget(…, lock=true)` khoá mục (kể cả interlock_rule) FOR SHARE trong giao dịch engineeringAssignment.assign / unassign — giao dịch chỉ chạm engineering_assignments + audit + thông báo, KHÔNG khoá adapter ⇒ không có vòng ADAPTER ↔ LUẬT",
  },
  {
    viTri: "server/services/interlock/backfillDinhNghiaDuyet.ts#lam",
    loai: "khong_khoa_adapter_sau",
    ngay: "2026-11-01",
    lyDo:
      "CLI backfill một lần: luật FOR UPDATE, tag / adapter đọc KHÔNG khoá (ghi ở đầu tệp + dinhNghiaDuyet.ts: khoá adapter sau luật là đảo thứ tự) ⇒ không có vòng",
  },
];

export const HAM_KHOA_LUAT_CO_HOP_DONG: ReadonlySet<string> = new Set(HOP_DONG.map((h) => h.viTri));

/** HẠT của điểm bất động gọi-pool (brief T5, nguyên văn). Tập đầy đủ = `tinhHamGoiPool(...)` (KD-C2). */
export const HAM_GOI_POOL: ReadonlySet<string> = new Set([
  "getDb",
  "getDbRaw",
  "idsTrongPhamVi",
  "idsMayTrongPhamVi",
  "adapterTrongPhamVi",
  "luatTrongPhamVi",
  "layTapPhamViLuat",
  "layPhamViGhiLuat",
]);

/**
 * GHIM (review T5 I2) — phương thức first-party TÊN CHUNG (`TEN_CHUNG`) có thân tới pool, đo bằng AST trên 1e9bbd23a (2026-11-01). Lời gọi
 * `x.<tên chung>()` KHÔNG khớp theo tên (không thì điểm bất động nuốt cả cây) ⇒ đây là chỗ mù; ghim nó để chỗ mù CÓ GIỚI HẠN: thêm phương thức
 * như vậy ⇒ đỏ (đổi tên cho riêng biệt, hoặc thêm vào đây kèm lý do). Tên trong tập này: `x.<tên>()` với `x` là đối tượng NHẬP ⇒ coi là gọi pool.
 */
const TEN_CHUNG_GOI_POOL: ReadonlyArray<{ viTri: string; lyDo: string }> = [
  { viTri: "server/license/license-guard.ts#start", lyDo: "`this.checkLicense()` — phương thức cùng lớp; khoá `.checkLicense` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/license/license-service.ts#sync", lyDo: "`db.getLicenseByKey()` tới pool (điểm bất động)" },
  { viTri: "server/license/license-service.ts#validate", lyDo: "`db.getLicenseByKey()` tới pool (điểm bất động)" },
  { viTri: "server/services/ai/microBatcher.ts#flush", lyDo: "`this.flush()` — phương thức cùng lớp; khoá `.flush` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/aiJobQueue.ts#run", lyDo: "`generateNarrative()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/index.ts#execute", lyDo: "`executeDecision()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/index.ts#first", lyDo: "`chonToolVong1()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/index.ts#next", lyDo: "`decideNextToolLLM()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers.ts#execute", lyDo: "`getMeasurementPointDefById()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/alerts.ts#execute", lyDo: "`acknowledgeAlert()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/applyDiff.ts#execute", lyDo: "`phanQuyet()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/applyDiffBatch.ts#execute", lyDo: "`phanQuyetLo()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/engineering.ts#execute", lyDo: "gọi trực tiếp hạt `getDb()`" },
  { viTri: "server/services/aiLocalTools/writeHandlers/interlock.ts#execute", lyDo: "gọi trực tiếp hạt `getDb()`" },
  { viTri: "server/services/aiLocalTools/writeHandlers/machineControl.ts#execute", lyDo: "`plan()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/maintenance.ts#execute", lyDo: "gọi trực tiếp hạt `getDb()`" },
  { viTri: "server/services/aiLocalTools/writeHandlers/measurementPoint.ts#execute", lyDo: "`createMeasurementPointDef()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/qualityAdvisory.ts#execute", lyDo: "`runRca()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/repoCommand.ts#execute", lyDo: "`checkPermission()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/visionControl.ts#execute", lyDo: "`runDispatch()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/xoaDoiTenTep.ts#execute", lyDo: "`phanQuyetXoa()` tới pool (điểm bất động)" },
  { viTri: "server/services/aiLocalTools/writeHandlers/yield.ts#execute", lyDo: "`resolveThreshold()` tới pool (điểm bất động)" },
  { viTri: "server/services/cacheWarmingService.ts#initialize", lyDo: "`this.warmCache()` — phương thức cùng lớp; khoá `.warmCache` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/cfx/cfxClient.ts#start", lyDo: "`this.connectEndpoint()` — phương thức cùng lớp; khoá `.connectEndpoint` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeConfigSource.ts#refresh", lyDo: "`writeFileAtomic()` tới pool (điểm bất động)" },
  { viTri: "server/services/edge/edgeExecutionAgent.ts#ack", lyDo: "`this.deps.sink//R-10-z—stop-class:neverdroppedwhenthejournalisfull,boundedwait.event()` — phương thức cùng lớp; khoá `.event` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeExecutionAgent.ts#start", lyDo: "`this.tick()` — phương thức cùng lớp; khoá `.tick` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeExecutionAgent.ts#tick", lyDo: "`this.pullPhase()` — phương thức cùng lớp; khoá `.pullPhase` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeExecutionAgent.ts#watch", lyDo: "`this.handleCommands()` — phương thức cùng lớp; khoá `.handleCommands` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeJournal.ts#ack", lyDo: "`this.maybeCompact()` — phương thức cùng lớp; khoá `.maybeCompact` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeJournal.ts#close", lyDo: "`this.writeSnapshot()` — phương thức cùng lớp; khoá `.writeSnapshot` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeJournal.ts#init", lyDo: "`this.startFresh()` — phương thức cùng lớp; khoá `.startFresh` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeJournal.ts#reset", lyDo: "`this.startFresh()` — phương thức cùng lớp; khoá `.startFresh` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeStreams.ts#flush", lyDo: "`this.flushOnce()` — phương thức cùng lớp; khoá `.flushOnce` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/edge/edgeStreams.ts#run", lyDo: "`journal.appendRun()` tới pool (điểm bất động)" },
  { viTri: "server/services/edge/edgeStreams.ts#start", lyDo: "`this.flushAll()` — phương thức cùng lớp; khoá `.flushAll` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/instruments/scpiAdapter.ts#query", lyDo: "`this.enqueue()` — phương thức cùng lớp; khoá `.enqueue` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/instruments/scpiAdapter.ts#reset", lyDo: "`this.write()` — phương thức cùng lớp; khoá `.write` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/instruments/scpiAdapter.ts#write", lyDo: "`this.enqueue()` — phương thức cùng lớp; khoá `.enqueue` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/instruments/zplPrinterAdapter.ts#ping", lyDo: "`this.open()` — phương thức cùng lớp; khoá `.open` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/orchestration/templates/qtStepHandlers.ts#run", lyDo: "`allocateOrder()` tới pool (điểm bất động)" },
  { viTri: "server/services/ot/drivers/mitsubishiMcDriver.ts#close", lyDo: "`hardening.guard()` tới pool (điểm bất động)" },
  { viTri: "server/services/ot/drivers/mitsubishiMcDriver.ts#connect", lyDo: "`dropMcBounded()` tới pool (điểm bất động)" },
  { viTri: "server/services/ot/drivers/mitsubishiMcDriver.ts#disconnect", lyDo: "`dropMcBounded()` tới pool (điểm bất động)" },
  { viTri: "server/services/ot/drivers/s7BlockChecksum.ts#open", lyDo: "`net.connect()` tới pool (điểm bất động)" },
  { viTri: "server/services/ot/otStopEpochKeyEpisode.ts#write", lyDo: "`sendNotification()` tới pool (điểm bất động)" },
  { viTri: "server/services/plugins/pluginDriverBridge.ts#connect", lyDo: "`this.disconnect()` — phương thức cùng lớp; khoá `.disconnect` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/plugins/sidecar/pluginSupervisor.ts#start", lyDo: "`this.spawnOnce()` — phương thức cùng lớp; khoá `.spawnOnce` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/programming/iec61131/iec61131Adapter.ts#validate", lyDo: "`checkStructuredText()` tới pool (điểm bất động)" },
  { viTri: "server/services/robot/drivers/deltaRobotDriver.ts#abort", lyDo: "`this.runJob()` — phương thức cùng lớp; khoá `.runJob` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/robot/drivers/fanucDriver.ts#abort", lyDo: "`this.runJob()` — phương thức cùng lớp; khoá `.runJob` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/robot/drivers/mitsubishiRobotDriver.ts#abort", lyDo: "`this.runJob()` — phương thức cùng lớp; khoá `.runJob` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/robot/drivers/simRobotDriver.ts#abort", lyDo: "`this.motionLock.clearByStop()` — phương thức cùng lớp; khoá `.clearByStop` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/robot/drivers/tcpLineClient.ts#send", lyDo: "`this.write()` — phương thức cùng lớp; khoá `.write` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/robot/drivers/tcpLineClient.ts#write", lyDo: "`this.reconnect()` — phương thức cùng lớp; khoá `.reconnect` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/robot/drivers/techmanDriver.ts#abort", lyDo: "`this.runJob()` — phương thức cùng lớp; khoá `.runJob` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/robot/robotDriver.ts#lock", lyDo: "`this.notify()` — phương thức cùng lớp; khoá `.notify` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/robot/ursimBridge.ts#abort", lyDo: "`this.runJob()` — phương thức cùng lớp; khoá `.runJob` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/ros2/ros2Bridge.ts#start", lyDo: "`this.onTelemetry()` — phương thức cùng lớp; khoá `.onTelemetry` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/ros2/rosbridgeClient.ts#connect", lyDo: "`this.onMessage()` — phương thức cùng lớp; khoá `.onMessage` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/ros2/rosbridgeClient.ts#publish", lyDo: "`this.advertise()` — phương thức cùng lớp; khoá `.advertise` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/ros2/rosbridgeClient.ts#subscribe", lyDo: "`this.send()` — phương thức cùng lớp; khoá `.send` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/ros2/rosbridgeClient.ts#unsubscribe", lyDo: "`this.send()` — phương thức cùng lớp; khoá `.send` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/safety/plc/safetyPlcPoller.ts#start", lyDo: "`this.refreshLoop()` — phương thức cùng lớp; khoá `.refreshLoop` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/safety/plc/safetyPlcPoller.ts#tick", lyDo: "`this.pollNow()` — phương thức cùng lớp; khoá `.pollNow` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/safety/plc/safetyPlcPollerHealth.ts#list", lyDo: "`listAt()` tới pool (điểm bất động)" },
  { viTri: "server/services/safety/plc/safetyPlcPollerHealth.ts#load", lyDo: "`db()` tới pool (điểm bất động)" },
  { viTri: "server/services/safety/plc/safetyPlcPollerHealth.ts#save", lyDo: "`db()` tới pool (điểm bất động)" },
  { viTri: "server/services/safety/trustedSafetyOrigin.ts#consume", lyDo: "gọi trực tiếp hạt `getDb()`" },
  { viTri: "server/services/secsgem/hsmsClient.ts#connect", lyDo: "`net.connect()` tới pool (điểm bất động)" },
  { viTri: "server/services/secsgem/hsmsClient.ts#select", lyDo: "`this.send()` — phương thức cùng lớp; khoá `.send` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/streaming/inProcessAdapter.ts#publish", lyDo: "`deliver()` tới pool (điểm bất động)" },
  { viTri: "server/services/streaming/lakeSink.ts#start", lyDo: "`getStreamBridge()` tới pool (điểm bất động)" },
  { viTri: "server/services/streaming/streamProcessor.ts#start", lyDo: "`this.onMessage()` — phương thức cùng lớp; khoá `.onMessage` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/uns/sparkplugCommand.ts#start", lyDo: "`this.handleMessage()` — phương thức cùng lớp; khoá `.handleMessage` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/vda5050/vda5050Adapter.ts#start", lyDo: "`this.onMessage()` — phương thức cùng lớp; khoá `.onMessage` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/vda5050/vda5050Driver.ts#abort", lyDo: "`this.runJob()` — phương thức cùng lớp; khoá `.runJob` gộp mọi lớp (bảo thủ theo tên) tới pool" },
  { viTri: "server/services/vda5050/vda5050Driver.ts#connect", lyDo: "`this.onMessage()` — phương thức cùng lớp; khoá `.onMessage` gộp mọi lớp (bảo thủ theo tên) tới pool" },
];

interface NoPool {
  viTri: string;
  /** Hàm / tay cầm gọi pool tại chỗ gọi (review T5 I1: ghim theo CHỖ GỌI `viTri:ham`, mỗi phần tử một lời gọi). */
  ham: string;
  ngay: string;
  backlog: string;
  lyDo: string;
}
/** Chuỗi gọi pool của TOTP cấu hình (đo bằng `CENSUS_VET=1`): kiemTotpCauHinh → kiemXacThucTheoMuc → verifyFreshTotp → db/auth.get2FAStatus → getDb(). */
const TOTP = "TOTP mức 5 `kiemTotpCauHinh` gọi TRONG giao dịch giữ khoá (chủ ý: kiểm CUỐI, ngay trước lượt ghi) — chuỗi tới `get2FAStatus` đọc users QUA POOL";
const BL_TOTP = "R1b-2b-2b · nợ pool-trong-tx #1 (TOTP): đọc trạng thái 2FA trước giao dịch / qua `tx`, giữ thứ tự kiểm CUỐI";
/**
 * NỢ (B) — lời gọi pool trong callback giao dịch giữ khoá hàng, ĐO bằng AST trên c2d07d00b (2026-11-01). KHÔNG sửa ở T5; mỗi phần tử là một
 * mục backlog R1b-2b-2b. Thêm chỗ mới ⇒ đỏ (sửa mã, đừng thêm vào đây); gỡ được một chỗ ⇒ xoá khỏi đây.
 * 14/15 mục cùng MỘT gốc (TOTP qua pool); 1 mục ngoài SCADA / OT / interlock (equipmentStandards — phạm vi tenant qua pool).
 */
const NO_POOL: ReadonlyArray<NoPool> = [
  { viTri: "server/routers/deviceAdapterRouter.ts#update", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/deviceAdapterRouter.ts#delete", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/deviceAdapterRouter.ts#tags.create", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/deviceAdapterRouter.ts#tags.update", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/deviceAdapterRouter.ts#tags.delete", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/interlockRouter.ts#update", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: `${TOTP} — giữ adapter FOR SHARE + luật FOR UPDATE` },
  { viTri: "server/routers/interlockRouter.ts#delete", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: `${TOTP} — giữ adapter FOR SHARE + luật FOR UPDATE` },
  { viTri: "server/routers/scadaDiagRouter.ts#tamTat", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/scadaKenhRouter.ts#capNhat", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/scadaKenhRouter.ts#dat", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/scadaKenhRouter.ts#go", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  { viTri: "server/routers/scadaKenhRouter.ts#khaiHangLoat", ham: "kiemTotpCauHinh", ngay: "2026-11-01", backlog: BL_TOTP, lyDo: TOTP },
  {
    viTri: "server/services/ot/mappingAsCode.ts#importMapping",
    ham: "xacThucKenhDaKhai",
    ngay: "2026-11-01",
    backlog: BL_TOTP,
    lyDo: `callback \`opts.xacThucKenhDaKhai\` (mappingAsCodeRouter: ${TOTP})`,
  },
  {
    viTri: "server/services/ot/stopPin.ts#datStopPinTx",
    ham: "kiemCuoi",
    ngay: "2026-11-01",
    backlog: BL_TOTP,
    lyDo: `callback \`input.kiemCuoi\` (deviceAdapterRouter: ${TOTP})`,
  },
  {
    viTri: "server/routers/equipmentStandardsRouter.ts#publishChangeRequest",
    ham: "hangTheGhi",
    ngay: "2026-11-01",
    backlog: "R1b-2b-2b · nợ pool-trong-tx #2 (NGOÀI SCADA / OT / interlock): tính phạm vi tenant trước giao dịch",
    lyDo: "`hangTheGhi` → `_theTenantPhamVi.theTenantHopLe` → `idsTrongPhamVi` (pool) trong giao dịch có `.update(`",
  },
];
export const NO_POOL_TRONG_TX: ReadonlySet<string> = new Set(NO_POOL.map((n) => n.viTri));
/** Review T5 I1 — nợ theo CHỖ GỌI (`viTri:ham`, có lặp nếu một thủ tục gọi nhiều lần): thêm một lời gọi pool vào thủ tục ĐÃ nợ cũng đỏ. */
export const NO_POOL_THEO_CHO_GOI: ReadonlyArray<string> = NO_POOL.map((n) => `${n.viTri}:${n.ham}`);

// ─── Tiện ích AST ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const laHam = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isArrowFunction(n) ||
  ts.isFunctionExpression(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);

const tenGoi = (c: ts.CallExpression): string | null => {
  const e = c.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
};

const laBang = (n: ts.Node | undefined, ten: string): boolean =>
  !!n && ((ts.isIdentifier(n) && n.text === ten) || (ts.isPropertyAccessExpression(n) && n.name.text === ten));

const TU_FROM_JOIN = new Set(["from", "innerJoin", "leftJoin", "rightJoin", "fullJoin", "crossJoin"]);
const CHE_DO_KHOA = new Set(["update", "share", "no key update", "key share"]);
/** Closure tổ hợp mảng / promise: KHÔNG là ranh giới "cùng hàm" (callback chạy trong luồng của hàm bao). */
const TO_HOP_TRONG_SUOT = new Set(["map", "forEach", "flatMap", "filter", "some", "every", "find", "reduce", "then", "catch", "finally", "all", "allSettled"]);
const RE_FOR_SQL = /\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b/i;
const TEN_SQL: Record<string, string> = { interlockRules: "interlock_rules", deviceAdapters: "device_adapters" };

/** Văn bản SQL của một chuỗi / template (biểu thức `${interlockRules}` thành tên bảng). `null` nếu không phải chuỗi. */
function vanBanChuoi(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) {
    let s = n.head.text;
    for (const sp of n.templateSpans) {
      const e = sp.expression;
      const ten = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";
      s += (TEN_SQL[ten] ?? " ? ") + sp.literal.text;
    }
    return s;
  }
  return null;
}
const sqlKhoaBang = (n: ts.Node, bangSql: string): boolean => {
  const s = vanBanChuoi(n);
  return s !== null && s.includes(bangSql) && RE_FOR_SQL.test(s);
};

/** Tên hàm bao ngoài (y hệt `thuTuKhoaTag.census.test.ts#hamBaoNgoai`) — `viTri` ổn định khi số dòng xê dịch. */
function hamBaoNgoai(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
      const cha = p.parent;
      if (ts.isVariableDeclaration(cha) && ts.isIdentifier(cha.name)) return cha.name.text;
      if (ts.isPropertyAssignment(cha) && (ts.isIdentifier(cha.name) || ts.isStringLiteral(cha.name))) return cha.name.text;
      if (ts.isCallExpression(cha)) {
        for (let q: ts.Node | undefined = cha.parent; q; q = q.parent) {
          if (ts.isPropertyAssignment(q) && (ts.isIdentifier(q.name) || ts.isStringLiteral(q.name))) {
            let ten = q.name.text;
            for (let r: ts.Node | undefined = q.parent; r; r = r.parent) {
              if (ts.isPropertyAssignment(r) && (ts.isIdentifier(r.name) || ts.isStringLiteral(r.name))) ten = `${r.name.text}.${ten}`;
            }
            return ten;
          }
          if (ts.isFunctionDeclaration(q) && q.name) return q.name.text;
        }
      }
    }
  }
  return "(cấp tệp)";
}

/** "Cùng hàm" của (A): hàm gần nhất, xuyên qua closure tổ hợp mảng / promise. Tệp nếu ở cấp tệp. */
function phamViHam(n: ts.Node): ts.Node {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (!laHam(p)) continue;
    const cha = p.parent;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && cha && ts.isCallExpression(cha) && cha.arguments.some((a) => a === p)) {
      const t = tenGoi(cha);
      if (t && TO_HOP_TRONG_SUOT.has(t)) continue;
    }
    return p;
  }
  return n.getSourceFile();
}

const chua = (cha: ts.Node, con: ts.Node): boolean => cha.pos <= con.pos && con.end <= cha.end;

/** Cạnh cha → con có điều kiện (con có thể KHÔNG chạy khi cha chạy)? */
function canhDieuKien(p: ts.Node, x: ts.Node): boolean {
  if (laHam(p)) return true;
  if (ts.isIfStatement(p)) return x !== p.expression;
  if (ts.isConditionalExpression(p)) return x !== p.condition;
  if (ts.isBinaryExpression(p)) {
    const k = p.operatorToken.kind;
    const ngan =
      k === ts.SyntaxKind.AmpersandAmpersandToken ||
      k === ts.SyntaxKind.BarBarToken ||
      k === ts.SyntaxKind.QuestionQuestionToken ||
      k === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
      k === ts.SyntaxKind.BarBarEqualsToken ||
      k === ts.SyntaxKind.QuestionQuestionEqualsToken;
    return ngan && x === p.right;
  }
  if (ts.isForStatement(p)) return x === p.statement || x === p.incrementor;
  if (ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p)) return x === p.statement;
  if (ts.isCaseBlock(p)) return true;
  if (ts.isCatchClause(p)) return true;
  if (ts.isTryStatement(p)) return x === p.catchClause || (x === p.tryBlock && !!p.catchClause);
  if ((ts.isCallExpression(p) || ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.questionDotToken) return x !== p.expression;
  return false;
}

/** `m` chắc chắn đã chạy khi tới `s`: m đứng trước s, đường từ m lên tổ tiên chung không qua cạnh điều kiện. */
function troiTruoc(m: ts.Node, s: ts.Node): boolean {
  if (m.getStart() >= s.getStart() || chua(m, s)) return false;
  for (let x: ts.Node = m; x.parent; x = x.parent) {
    const p = x.parent;
    if (canhDieuKien(p, x)) return false;
    if (chua(p, s)) return true;
  }
  return false;
}

/** Khai báo `ten` đứng TRỰC TIẾP trong vùng `p` (lệnh của khối / tham số hàm / khởi tạo vòng for / biến catch)? */
function khaiTrucTiep(p: ts.Node, ten: string): ts.VariableDeclaration | ts.ParameterDeclaration | null {
  const tuDanhSach = (dl: ts.VariableDeclarationList): ts.VariableDeclaration | null =>
    dl.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === ten) ?? null;
  if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isModuleBlock(p)) {
    for (const st of p.statements) {
      if (ts.isVariableStatement(st)) {
        const d = tuDanhSach(st.declarationList);
        if (d) return d;
      }
    }
    return null;
  }
  if (laHam(p)) return p.parameters.find((q) => ts.isIdentifier(q.name) && q.name.text === ten) ?? null;
  if ((ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer && ts.isVariableDeclarationList(p.initializer))
    return tuDanhSach(p.initializer);
  if (ts.isCatchClause(p) && p.variableDeclaration && ts.isIdentifier(p.variableDeclaration.name) && p.variableDeclaration.name.text === ten) return p.variableDeclaration;
  return null;
}

/**
 * Giá trị của định danh `ten` nhìn thấy từ `tu`: tìm vùng khai báo gần nhất (khối / hàm / tệp), trả khởi tạo + mọi phép gán `ten = …` trong vùng ấy.
 * `vung` = nút vùng khai báo (để biết khai báo nằm trong / ngoài một callback); `null` nếu không thấy khai báo.
 */
function giaTriCuaBien(tu: ts.Node, ten: string): { giaTri: ts.Expression[]; vung: ts.Node | null; khai: ts.Node | null } {
  for (let p: ts.Node | undefined = tu.parent; p; p = p.parent) {
    const k = khaiTrucTiep(p, ten);
    if (!k) continue;
    const giaTri: ts.Expression[] = [];
    if (ts.isVariableDeclaration(k) && k.initializer) giaTri.push(k.initializer);
    const di = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && n.left.text === ten) giaTri.push(n.right);
      n.forEachChild(di);
    };
    di(p);
    return { giaTri, vung: p, khai: k };
  }
  return { giaTri: [], vung: null, khai: null };
}

/** Chuỗi drizzle tới `cur` có `.from(bang)` / `.*Join(bang)` (lần qua biến trong phạm vi khối). */
function chuoiCoBang(cur0: ts.Expression, bang: string, tham: Set<ts.Node> = new Set()): boolean {
  for (let cur: ts.Expression = cur0; ; ) {
    if (tham.has(cur)) return false;
    tham.add(cur);
    if (ts.isCallExpression(cur)) {
      const t = tenGoi(cur);
      if (t && TU_FROM_JOIN.has(t) && laBang(cur.arguments[0], bang)) return true;
      cur = cur.expression;
    } else if (ts.isPropertyAccessExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAwaitExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isConditionalExpression(cur)) {
      return chuoiCoBang(cur.whenTrue, bang, tham) || chuoiCoBang(cur.whenFalse, bang, tham);
    } else if (ts.isIdentifier(cur)) {
      return giaTriCuaBien(cur, cur.text).giaTri.some((e) => chuoiCoBang(e, bang, tham));
    } else return false;
  }
}

/** `{ of: X }` của `.for(...)` chỉ khoá bảng KHÁC `bang`? */
function ofBangKhac(opt: ts.Expression | undefined, bang: string): boolean {
  if (!opt || !ts.isObjectLiteralExpression(opt)) return false;
  for (const p of opt.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "of") {
      const v = p.initializer;
      if (ts.isArrayLiteralExpression(v)) return !v.elements.some((x) => laBang(x, bang));
      return !laBang(v, bang);
    }
  }
  return false;
}

/** Lời gọi `.for(chếĐộ, …)` là khoá hàng (không phải `Symbol.for("…")`). */
function laGoiFor(n: ts.Node): n is ts.CallExpression & { expression: ts.PropertyAccessExpression } {
  if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "for") return false;
  if (ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Symbol") return false;
  const a0 = n.arguments[0];
  if (!a0) return false;
  if (ts.isStringLiteralLike(a0)) return CHE_DO_KHOA.has(a0.text);
  return true; // biểu thức (`.for(khoaLuat)`) ⇒ bảo thủ: là khoá
}

const khoaFor = (n: ts.Node, bang: string): boolean =>
  laGoiFor(n) && !ofBangKhac(n.arguments[1], bang) && chuoiCoBang(n.expression.expression, bang);

const dongCua = (src: ts.SourceFile, n: ts.Node): number => {
  const vt = laGoiFor(n) ? n.expression.name.getStart(src) : n.getStart(src);
  return src.getLineAndCharacterOfPosition(vt).line + 1;
};

// ─── Chỉ mục tệp + phân giải lời gọi (cho (B) và hợp đồng của (A)) ──────────────────────────────────────────────────────────────────

/**
 * Tên phương thức CHUNG (JS chuẩn: Array / Map / Set / Promise / String / Object / console / EventEmitter; drizzle query builder). Lời gọi
 * `x.<tên chung>(…)` KHÔNG khớp theo tên với tập điểm bất động — nếu khớp, MỘT phương thức `get()` gọi pool ở đâu đó làm mọi `map.get()` /
 * `tx.select()` thành "gọi pool" (đo 2026-11-01: không loại + khớp tên toàn cục ⇒ 8 817 tên = toàn bộ cây, vị từ vô nghĩa).
 */
const TEN_CHUNG = new Set(
  (
    "get set has add delete clear keys values entries forEach map flatMap filter find findIndex some every reduce includes indexOf push pop shift " +
    "unshift slice splice concat sort reverse join split replace replaceAll match matchAll test exec trim startsWith endsWith padStart padEnd " +
    "toString toJSON toISOString valueOf then catch finally resolve reject all allSettled race any call apply bind emit on once off " +
    "addListener removeListener send write end read close open start stop run next return throw log info warn error debug trace " +
    "parse stringify assign freeze from of select selectDistinct insert update where innerJoin leftJoin rightJoin fullJoin " +
    "orderBy groupBy having limit offset returning onConflictDoNothing onConflictDoUpdate execute query transaction for as with prepare " +
    "length size format max min abs floor ceil round now getTime " +
    // Node / DOM / thư viện (AbortController, PoolClient, socket, stream, EventSource, redis, nats…): tên phương thức của đối tượng chuẩn
    "abort release connect disconnect destroy pipe kill unref ref ack acquire consume first flush init initialize list load lock unlock " +
    "refresh reset save subscribe unsubscribe publish sync tick validate verify watch ping"
  ).split(" "),
);

interface ChiMuc {
  /** Hàm tự do (khai báo / `const f = () => …`) theo tên, MỌI độ lồng (gộp cùng tên trong tệp — bảo thủ). */
  hamTheoTen: Map<string, ts.Node[]>;
  /** Hàm tự do cấp tệp (đích của `import`). */
  hamCapTep: Set<string>;
  /** `export { a as b }` không `from`: b → a. */
  xuatTen: Map<string, string>;
  /** Phương thức / hàm thuộc tính đối tượng / thuộc tính lớp là hàm. */
  phuongThuc: Array<{ ten: string; node: ts.Node }>;
  /** `import { a as b } from "x"` / `const { a: b } = await import("x")`: b → { spec, goc: a }. */
  nhap: Map<string, { spec: string; goc: string }>;
  /** `import * as m from "x"`: m → spec. */
  nhapNs: Map<string, string>;
  /** `export … from "x"`: `ten` null = `export *`. */
  xuatLai: Array<{ spec: string; ten: Map<string, string> | null }>;
}

interface TepDaParse {
  duong: string;
  src: ts.SourceFile;
  cm: ChiMuc;
}

const laHamBieuThuc = (e: ts.Node | undefined): e is ts.ArrowFunction | ts.FunctionExpression => !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));

function lapChiMuc(src: ts.SourceFile): ChiMuc {
  const cm: ChiMuc = { hamTheoTen: new Map(), hamCapTep: new Set(), xuatTen: new Map(), phuongThuc: [], nhap: new Map(), nhapNs: new Map(), xuatLai: [] };
  const themHam = (ten: string, node: ts.Node, capTep: boolean): void => {
    const ds = cm.hamTheoTen.get(ten) ?? [];
    ds.push(node);
    cm.hamTheoTen.set(ten, ds);
    if (capTep) cm.hamCapTep.add(ten);
  };
  const di = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) themHam(n.name.text, n, n.parent === src);
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && laHamBieuThuc(n.initializer))
      themHam(n.name.text, n.initializer, !!n.parent?.parent && ts.isVariableStatement(n.parent.parent) && n.parent.parent.parent === src);
    else if (ts.isMethodDeclaration(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) cm.phuongThuc.push({ ten: n.name.text, node: n });
    else if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && laHamBieuThuc(n.initializer))
      cm.phuongThuc.push({ ten: n.name.text, node: n.initializer });
    else if (ts.isPropertyDeclaration(n) && ts.isIdentifier(n.name) && laHamBieuThuc(n.initializer)) cm.phuongThuc.push({ ten: n.name.text, node: n.initializer });
    else if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      const ic = n.importClause;
      if (ic?.name) cm.nhap.set(ic.name.text, { spec, goc: "default" });
      const nb = ic?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) cm.nhapNs.set(nb.name.text, spec);
      else if (nb) for (const el of nb.elements) cm.nhap.set(el.name.text, { spec, goc: (el.propertyName ?? el.name).text });
    } else if (ts.isExportDeclaration(n)) {
      if (n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        const ec = n.exportClause;
        if (!ec) cm.xuatLai.push({ spec: n.moduleSpecifier.text, ten: null });
        else if (ts.isNamedExports(ec)) cm.xuatLai.push({ spec: n.moduleSpecifier.text, ten: new Map(ec.elements.map((el) => [el.name.text, (el.propertyName ?? el.name).text])) });
      } else if (n.exportClause && ts.isNamedExports(n.exportClause)) {
        for (const el of n.exportClause.elements) cm.xuatTen.set(el.name.text, (el.propertyName ?? el.name).text);
      }
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isObjectBindingPattern(n.name) &&
      n.initializer &&
      ts.isAwaitExpression(n.initializer) &&
      ts.isCallExpression(n.initializer.expression) &&
      n.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.initializer.expression.arguments[0] &&
      ts.isStringLiteral(n.initializer.expression.arguments[0])
    ) {
      // `const { a, b: c } = await import("x")`
      const spec = n.initializer.expression.arguments[0].text;
      for (const el of n.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const goc = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
        cm.nhap.set(el.name.text, { spec, goc });
      }
    }
    n.forEachChild(di);
  };
  di(src);
  return cm;
}

const parse = (t: TepNguon): TepDaParse => {
  const src = ts.createSourceFile(t.duong, t.ma, ts.ScriptTarget.Latest, true);
  return { duong: t.duong, src, cm: lapChiMuc(src) };
};

/** Bộ phân giải lời gọi trên MỘT cây (khoá hàm: `<đường>#<tên>` cho hàm tự do, `.<tên>` cho phương thức — gộp mọi lớp, bảo thủ). */
class PhanGiai {
  readonly theoDuong: Map<string, TepDaParse>;
  /** tên hàm cấp tệp → các tệp khai báo (cho đường lùi bảo thủ). */
  private readonly capTepTheoTen = new Map<string, string[]>();
  private readonly nho = new Map<string, string[]>();
  /**
   * @param tenChungGhim tên phương thức CHUNG đã ghim là "có phương thức first-party tên ấy gọi pool" (`TEN_CHUNG_GOI_POOL`): lời gọi `x.<tên>()` với
   *   `x` là đối tượng NHẬP (import) được coi là tới phương thức ấy (bảo thủ — review T5 I2).
   */
  constructor(
    readonly cay: TepDaParse[],
    private readonly tenChungGhim: ReadonlySet<string> = new Set(),
  ) {
    this.theoDuong = new Map(cay.map((t) => [t.duong, t]));
    for (const t of cay) for (const ten of t.cm.hamCapTep) this.capTepTheoTen.set(ten, [...(this.capTepTheoTen.get(ten) ?? []), t.duong]);
  }

  giaiSpec(tu: string, spec: string): string | null {
    if (!spec.startsWith(".")) return null;
    const p = posix.normalize(posix.join(posix.dirname(tu), spec)).replace(/\.(js|ts)$/, "");
    for (const c of [`${p}.ts`, `${p}/index.ts`]) if (this.theoDuong.has(c)) return c;
    return null;
  }

  /** Hàm `ten` mà module `duong` xuất ra (lần qua `export … from` / `export *`). Không thấy trong tệp có thật ⇒ BẢO THỦ: mọi hàm cấp tệp tên ấy. */
  giaiXuat(duong: string | null, ten: string): string[] {
    if (!duong || !this.theoDuong.has(duong)) return [];
    // review T5 m3 — nhớ CHỈ kết quả cấp ngoài (đã có đường lùi), tính đủ mỗi lần bằng `giaiTrong` không nhớ ⇒ không phụ thuộc thứ tự phân giải
    // (trước: (X, f) đi qua barrel ở độ sâu ≥ 1 được nhớ là `[]` không đường lùi, rồi `import { f } from "./X"` trực tiếp nhận lại `[]`).
    const khoaNho = `${duong}\u0001${ten}`;
    const daCo = this.nho.get(khoaNho);
    if (daCo) return daCo;
    let ra = this.giaiTrong(duong, ten, new Set());
    if (ra.length === 0 && ten !== "default") ra = (this.capTepTheoTen.get(ten) ?? []).map((d) => `${d}#${ten}`);
    this.nho.set(khoaNho, ra);
    return ra;
  }

  /** Lần `export … from` / `export *` (không nhớ, không đường lùi); `tham` chặn vòng barrel. */
  private giaiTrong(duong: string | null, ten: string, tham: Set<string>): string[] {
    if (!duong) return [];
    const khoa = `${duong}\u0001${ten}`;
    if (tham.has(khoa)) return [];
    tham.add(khoa);
    const t = this.theoDuong.get(duong);
    if (!t) return [];
    const goc = t.cm.xuatTen.get(ten) ?? ten;
    if (t.cm.hamCapTep.has(goc)) return [`${duong}#${goc}`];
    const ra: string[] = [];
    for (const x of t.cm.xuatLai) {
      if (x.ten === null) ra.push(...this.giaiTrong(this.giaiSpec(duong, x.spec), ten, tham));
      else if (x.ten.has(ten)) ra.push(...this.giaiTrong(this.giaiSpec(duong, x.spec), x.ten.get(ten)!, tham));
    }
    return ra;
  }

  /** Khoá các hàm mà một lời gọi có thể tới. */
  dich(t: TepDaParse, c: ts.CallExpression): string[] {
    const e = c.expression;
    if (ts.isIdentifier(e)) {
      if (t.cm.hamTheoTen.has(e.text)) return [`${t.duong}#${e.text}`];
      const nh = t.cm.nhap.get(e.text);
      if (nh) return this.giaiXuat(this.giaiSpec(t.duong, nh.spec), nh.goc);
      return [];
    }
    if (!ts.isPropertyAccessExpression(e)) return [];
    const ten = e.name.text;
    const r = e.expression;
    if (ts.isIdentifier(r) && t.cm.nhapNs.has(r.text)) return this.giaiXuat(this.giaiSpec(t.duong, t.cm.nhapNs.get(r.text)!), ten);
    if (r.kind === ts.SyntaxKind.ThisKeyword) return [`.${ten}`];
    if (!TEN_CHUNG.has(ten)) return [`.${ten}`];
    // tên chung: chỉ khớp khi tên đã ghim là có phương thức first-party gọi pool VÀ gốc là đối tượng NHẬP (review T5 I2 — bảo thủ có giới hạn)
    return this.tenChungGhim.has(ten) && ts.isIdentifier(r) && t.cm.nhap.has(r.text) ? [`.${ten}`] : [];
  }
}

/**
 * Điểm bất động trên mọi hàm của cây: khoá vào tập khi thân có dấu hiệu trực tiếp `laDau(n, tep)`, hoặc có lời gọi tới một khoá đã trong tập.
 * `vet` (tuỳ chọn) ghi vì sao một khoá vào tập (để in / báo cáo).
 */
function diemBatDong(pg: PhanGiai, laDau: (n: ts.Node, t: TepDaParse) => boolean, vet?: Map<string, string>): Set<string> {
  const defs = new Map<string, { dich: Set<string>; dau: boolean }>();
  const lay = (k: string) => {
    let d = defs.get(k);
    if (!d) defs.set(k, (d = { dich: new Set(), dau: false }));
    return d;
  };
  for (const t of pg.cay) {
    const quet = (k: string, node: ts.Node): void => {
      const d = lay(k);
      const than = (node as ts.FunctionLikeDeclaration).body;
      if (!than) return;
      const di = (n: ts.Node): void => {
        if (!d.dau && laDau(n, t)) {
          d.dau = true;
          vet?.set(k, `${t.duong}: trực tiếp (${n.getText().slice(0, 40)})`);
        }
        if (ts.isCallExpression(n)) for (const x of pg.dich(t, n)) d.dich.add(x);
        n.forEachChild(di);
      };
      di(than);
    };
    for (const [ten, nodes] of t.cm.hamTheoTen) for (const node of nodes) quet(`${t.duong}#${ten}`, node);
    for (const p of t.cm.phuongThuc) quet(`.${p.ten}`, p.node);
  }
  const tap = new Set<string>();
  for (const [k, d] of defs) if (d.dau) tap.add(k);
  for (let doi = true; doi; ) {
    doi = false;
    for (const [k, d] of defs) {
      if (tap.has(k)) continue;
      for (const x of d.dich) {
        if (tap.has(x)) {
          tap.add(k);
          vet?.set(k, `gọi ${x}`);
          doi = true;
          break;
        }
      }
    }
  }
  return tap;
}

/** Lời gọi theo TÊN tới một hạt pool (mọi gốc trừ tham số giao dịch `tx`). */
function goiHatPool(n: ts.Node, tx: string | null = null): string | null {
  if (!ts.isCallExpression(n)) return null;
  const t = tenGoi(n);
  if (!t || !HAM_GOI_POOL.has(t)) return null;
  if (tx && ts.isPropertyAccessExpression(n.expression) && gocChuoi(n.expression.expression) === tx) return null;
  return t;
}

/**
 * Trạng thái gọi-pool của một hàm: `u` = gọi pool VÔ ĐIỀU KIỆN; `thamSo` = chỉ gọi pool khi THIẾU đối số ở các chỉ số ấy (khuôn
 * `const db = dbOrTx ?? (await getDb())` — `currentSignatureId(adapterId, dbOrTx?)`, `createAuditLog(data, executor?)`: bên gọi truyền `tx` thì
 * KHÔNG gọi pool; bỏ qua khuôn này làm mọi `ghiAudit…(tx)` thành "nợ trên giấy").
 */
interface TrangThaiPool {
  u: boolean;
  thamSo: Set<number>;
}
export type BangPool = Map<string, TrangThaiPool>;

/** Lời gọi `c` có được che bởi `<tham số i của hàm f> ?? …` / `|| …` (c nằm ở vế phải) không? Trả `i`, hoặc `null`. */
function thamSoChe(c: ts.Node, f: ts.Node): number | null {
  if (!laHam(f)) return null;
  for (let x: ts.Node = c; x.parent && x !== f; x = x.parent) {
    const p: ts.Node = x.parent;
    if (laHam(p) && p !== f) return null;
    if (ts.isBinaryExpression(p) && x === p.right && (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      let l: ts.Expression = p.left;
      while (ts.isParenthesizedExpression(l) || ts.isAwaitExpression(l) || ts.isNonNullExpression(l)) l = l.expression;
      if (ts.isIdentifier(l)) {
        const i = f.parameters.findIndex((q) => ts.isIdentifier(q.name) && q.name.text === (l as ts.Identifier).text);
        if (i >= 0) return i;
      }
    }
  }
  return null;
}

/** Đối số chỉ số `i` của lời gọi vắng (hoặc `undefined` / `null` / `void 0`)? */
function doiSoVang(c: ts.CallExpression, i: number): boolean {
  if (c.arguments.some((a) => ts.isSpreadElement(a))) return false;
  const a = c.arguments[i];
  if (!a) return true;
  return (ts.isIdentifier(a) && a.text === "undefined") || a.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(a);
}

/** Lời gọi `c` tới các khoá `dich` có gọi pool không (theo bảng trạng thái + đối số tại chỗ gọi)? */
function goiToiPool(bang: BangPool, dich: ReadonlyArray<string>, c: ts.CallExpression): boolean {
  return dich.some((k) => {
    const s = bang.get(k);
    return !!s && (s.u || [...s.thamSo].some((i) => doiSoVang(c, i)));
  });
}

/** KD-C2 — điểm bất động gọi-pool xuyên tệp (khoá `<đường>#<tên>` / `.<phương thức>`; hạt theo TÊN). */
function tinhBangPool(pg: PhanGiai, vet?: Map<string, string>): BangPool {
  type Goi = { c: ts.CallExpression; dich: string[]; hat: boolean; che: number | null; tep: string };
  const defs = new Map<string, Goi[]>();
  for (const t of pg.cay) {
    const quet = (k: string, node: ts.Node): void => {
      const ds = defs.get(k) ?? [];
      defs.set(k, ds);
      const than = (node as ts.FunctionLikeDeclaration).body;
      if (!than) return;
      const di = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) ds.push({ c: n, dich: pg.dich(t, n), hat: goiHatPool(n) !== null, che: thamSoChe(n, node), tep: t.duong });
        n.forEachChild(di);
      };
      di(than);
    };
    for (const [ten, nodes] of t.cm.hamTheoTen) for (const node of nodes) quet(`${t.duong}#${ten}`, node);
    for (const p of t.cm.phuongThuc) quet(`.${p.ten}`, p.node);
  }
  const bang: BangPool = new Map();
  const lay = (k: string): TrangThaiPool => {
    let s = bang.get(k);
    if (!s) bang.set(k, (s = { u: false, thamSo: new Set() }));
    return s;
  };
  for (const k of defs.keys()) if (HAM_GOI_POOL.has(k.slice(k.lastIndexOf(k.includes("#") ? "#" : ".") + 1))) lay(k).u = true;
  for (let doi = true; doi; ) {
    doi = false;
    for (const [k, ds] of defs) {
      const s0 = bang.get(k);
      if (s0?.u) continue;
      for (const g of ds) {
        if (!g.hat && !goiToiPool(bang, g.dich, g.c)) continue;
        const s = lay(k);
        if (g.che === null) {
          s.u = true;
          vet?.set(k, `${g.tep}: ${g.c.getText().slice(0, 50).replace(/\s+/g, " ")}`);
          doi = true;
          break;
        }
        if (!s.thamSo.has(g.che)) {
          s.thamSo.add(g.che);
          vet?.set(k, `${g.tep}: (chỉ khi thiếu đối số ${g.che}) ${g.c.getText().slice(0, 50).replace(/\s+/g, " ")}`);
          doi = true;
        }
      }
    }
  }
  for (const [k, s] of bang) if (!s.u && s.thamSo.size === 0) bang.delete(k);
  return bang;
}
/** KD-C2 — bảng gọi-pool trên nguồn trong bộ nhớ (thiết bị đo). */
export function tinhHamGoiPool(tep: ReadonlyArray<TepNguon>): BangPool {
  return tinhBangPool(new PhanGiai(tep.map(parse)));
}

// ─── Bộ nhớ đệm cây ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const locServer = (goc: string) => moiFileDuoi(goc, "server", [".ts"]).filter((f) => !/\.test\.ts$/.test(f.duong) && !f.duong.includes("/__"));
const MOI_FILE = locServer(GOC_REPO);
const nhoPg = new Map<string, PhanGiai>();
/** Parse MỘT lần mọi file `server/**` (không test) — dùng chung cho (A) và (B). */
function pgCuaRepo(goc: string): PhanGiai {
  let pg = nhoPg.get(goc);
  if (!pg) {
    const ds = goc === GOC_REPO ? MOI_FILE : locServer(goc);
    pg = new PhanGiai(
      ds.map((f) => parse({ duong: f.duong, ma: readFileSync(f.that, "utf8") })),
      new Set(TEN_CHUNG_GOI_POOL.map((x) => x.viTri.slice(x.viTri.indexOf("#") + 1))),
    );
    nhoPg.set(goc, pg);
  }
  return pg;
}

// ─── (A) khoá luật ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface ViTriKhoaLuatDayDu extends ViTriKhoaLuat {
  loaiQua: LoaiHopDong | null;
}

/** Lõi (A) — mọi vị trí trực tiếp + qua MỌI loại hợp đồng. */
function quetKhoaLuatPg(pg: PhanGiai, hopDong: ReadonlyArray<HopDong>): ViTriKhoaLuatDayDu[] {
  // khoá hàm hợp đồng (chỉ hàm tự do khai báo trong tệp — thủ tục tRPC không gọi được theo tên)
  const quaKhoa = new Map<string, { ten: string; loai: LoaiHopDong }>();
  for (const h of hopDong) {
    const [duong, ten] = h.viTri.split("#");
    if (pg.theoDuong.get(duong)?.cm.hamTheoTen.has(ten)) quaKhoa.set(h.viTri, { ten, loai: h.loai });
  }
  const tenQua = new Set([...quaKhoa.values()].map((q) => q.ten));
  // review T5 m5 — hàm có thân khoá adapter (trực tiếp hoặc qua hàm khác, điểm bất động): lời gọi tới chúng là lượt khoá adapter cho vế "SAU"
  // (không cho vế "TRƯỚC" — helper có thể khoá có điều kiện; vế trước giữ bảo thủ: chỉ dấu hiệu trực tiếp trong cùng hàm).
  const khoaAdapterQuaHam = diemBatDong(pg, (n) => laKhoaAdapterTrucTiep(n));
  const ra: ViTriKhoaLuatDayDu[] = [];
  for (const t of pg.cay) {
    const ma = t.src.text;
    if (!ma.includes("interlockRules") && !ma.includes("interlock_rules") && ![...tenQua].some((k) => ma.includes(k))) continue;
    const khoaAdapter: ts.Node[] = [];
    const khoaAdapterHelper: ts.Node[] = [];
    const viTri: Array<{ node: ts.Node; qua: { ten: string; loai: LoaiHopDong } | null }> = [];
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const ten = tenGoi(n);
        if (laKhoaAdapterTrucTiep(n)) khoaAdapter.push(n);
        else if (pg.dich(t, n).some((k) => khoaAdapterQuaHam.has(k))) khoaAdapterHelper.push(n);
        if (khoaFor(n, "interlockRules")) viTri.push({ node: n, qua: null });
        if (ten && tenQua.has(ten)) {
          // theo TÊN (bảo thủ: trùng tên ở tệp khác cũng là vị trí "qua"); ưu tiên hợp đồng mà lời gọi phân giải tới
          const dich = pg.dich(t, n);
          const ung = [...quaKhoa.entries()].filter(([, v]) => v.ten === ten);
          const q = ung.find(([k]) => dich.includes(k)) ?? ung[0];
          viTri.push({ node: n, qua: q[1] });
        }
      } else {
        if (laKhoaAdapterTrucTiep(n)) khoaAdapter.push(n);
        if (sqlKhoaBang(n, "interlock_rules")) viTri.push({ node: n, qua: null });
      }
      n.forEachChild(di);
    };
    di(t.src);
    for (const v of viTri) {
      const pv = phamViHam(v.node);
      const trong = khoaAdapter.filter((m) => m !== v.node && chua(pv, m));
      ra.push({
        viTri: `${t.duong}#${hamBaoNgoai(v.node)}`,
        dong: dongCua(t.src, v.node),
        coKhoaAdapterTruoc: trong.some((m) => troiTruoc(m, v.node)),
        coKhoaAdapterSau:
          trong.some((m) => m.getStart() >= v.node.getEnd() && !khoaLaiHangDaGiu(m, v.node, trong)) ||
          khoaAdapterHelper.some((m) => m !== v.node && chua(pv, m) && m.getStart() >= v.node.getEnd()),
        qua: v.qua?.ten ?? null,
        loaiQua: v.qua?.loai ?? null,
      });
    }
  }
  return ra;
}

/** Dấu hiệu khoá adapter TRỰC TIẾP: `khoaAdapterTx(` / `congAdapterTx(`, chuỗi `.from(deviceAdapters)…for(…)`, SQL thô `device_adapters … FOR …`. */
function laKhoaAdapterTrucTiep(n: ts.Node): boolean {
  if (ts.isCallExpression(n)) {
    const ten = tenGoi(n);
    return ten === "khoaAdapterTx" || ten === "congAdapterTx" || khoaFor(n, "deviceAdapters");
  }
  return sqlKhoaBang(n, "device_adapters");
}

/** Chữ ký của một lượt khoá adapter (để nhận ra KHOÁ LẠI cùng hàng): `.where(…)` + chế độ của chuỗi `.for(`, hoặc đối số `khoaAdapterTx(`. */
function chuKyKhoaAdapter(m: ts.Node): { ky: string; manh: boolean } | null {
  if (!ts.isCallExpression(m)) return null;
  if (tenGoi(m) === "khoaAdapterTx") return { ky: `khoaAdapterTx:${m.arguments.slice(1).map((a) => a.getText()).join(",")}`, manh: false };
  if (!laGoiFor(m)) return null;
  const a0 = m.arguments[0];
  if (!ts.isStringLiteralLike(a0)) return null;
  for (let cur: ts.Expression = m.expression.expression; ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur); cur = cur.expression) {
    if (ts.isCallExpression(cur) && tenGoi(cur) === "where" && cur.arguments[0]) return { ky: `for:${cur.arguments[0].getText()}`, manh: a0.text === "update" };
  }
  return null;
}

/**
 * Lượt khoá adapter `m` SAU vị trí khoá luật `s` chỉ là KHOÁ LẠI một hàng ta đã giữ (cùng chữ ký, đã chắc chắn khoá TRƯỚC `s`, chế độ không mạnh
 * hơn) ⇒ không chờ ai, không đảo thứ tự. Vd deviceAdapter.update: hàng adapter `id` FOR UPDATE đầu giao dịch, rồi đọc lại `id` FOR UPDATE sau cổng.
 * Nâng cấp share → update KHÔNG được tha (nâng cấp có thể chờ).
 */
function khoaLaiHangDaGiu(m: ts.Node, s: ts.Node, moi: ReadonlyArray<ts.Node>): boolean {
  const k = chuKyKhoaAdapter(m);
  if (!k) return false;
  return moi.some((m0) => {
    const k0 = m0 !== m ? chuKyKhoaAdapter(m0) : null;
    return !!k0 && k0.ky === k.ky && (k0.manh || !k.manh) && troiTruoc(m0, s);
  });
}

/** (A) trên nguồn trong bộ nhớ (thiết bị đo) — đủ mọi vị trí (cả qua hợp đồng `khong_khoa_adapter_sau`). */
export function quetKhoaLuatNguon(tep: ReadonlyArray<TepNguon>, hopDong: ReadonlyArray<HopDong> = HOP_DONG): ViTriKhoaLuatDayDu[] {
  return quetKhoaLuatPg(new PhanGiai(tep.map(parse)), hopDong);
}

const nhoA = new Map<string, ViTriKhoaLuatDayDu[]>();
function quetKhoaLuatDayDu(goc: string): ViTriKhoaLuatDayDu[] {
  let r = nhoA.get(goc);
  if (!r) nhoA.set(goc, (r = quetKhoaLuatPg(pgCuaRepo(goc), HOP_DONG)));
  return r;
}

/**
 * (A) — mọi vị trí khoá `interlock_rules` TRỰC TIẾP + mọi lời gọi hàm hợp đồng loại `nguoi_goi_khoa_adapter` (vị trí "qua"). Lời gọi hàm hợp đồng
 * loại `khong_khoa_adapter_sau` không thuộc danh sách này (nghĩa vụ của chúng là `coKhoaAdapterSau === false`, kiểm ở ca ★ hợp đồng).
 */
export function quetKhoaLuat(goc: string): ViTriKhoaLuat[] {
  return quetKhoaLuatDayDu(goc)
    .filter((v) => v.loaiQua !== "khong_khoa_adapter_sau")
    .map(({ loaiQua: _bo, ...v }) => v);
}

// ─── (B) pool trong giao dịch ────────────────────────────────────────────────────────────────────────────────────────────────────

const PHAM_VI_B = ["server/routers/", "server/services/scada/", "server/services/ot/", "server/services/interlock/", "server/services/engineeringAssignment/"];
const laPhamViB = (duong: string): boolean => PHAM_VI_B.some((p) => duong.startsWith(p));
/** Phương thức của tay cầm drizzle — `db.<m>(…)` trên tay cầm pool bắt từ ngoài là gọi pool. */
const PHUONG_THUC_DB = new Set(["select", "selectDistinct", "selectDistinctOn", "insert", "update", "delete", "execute", "transaction", "query", "with", "$count"]);

/** Dấu hiệu khoá hàng TRỰC TIẾP tại một nút. */
function dauKhoaTrucTiep(n: ts.Node): boolean {
  if (ts.isCallExpression(n)) {
    if (laGoiFor(n)) return true;
    const t = tenGoi(n);
    if (t && (/^khoa.*Tx$/.test(t) || t === "congAdapterTx")) return true;
    return ts.isPropertyAccessExpression(n.expression) && (t === "update" || t === "delete");
  }
  const s = vanBanChuoi(n);
  return s !== null && RE_FOR_SQL.test(s);
}

/** Tham số thứ nhất (định danh) của callback giao dịch. */
const thamSoGd = (f: ts.FunctionLikeDeclaration): string | null => {
  const p0 = f.parameters[0];
  return p0 && ts.isIdentifier(p0.name) ? p0.name.text : null;
};

interface KetQuaB {
  viTri: ViTriPoolTrongTx[];
  soCallbackCoKhoa: number;
  /** |tập hàm gọi pool| (điểm bất động). */
  coDiemBatDong: number;
  /** Phương thức first-party TÊN CHUNG có thân tới pool (`<đường>#<tên>`, đo) — review T5 I2. */
  tenChungGoiPool: Array<{ viTri: string; qua: string }>;
}

/**
 * Review T5 I2 — đo phương thức first-party (phương thức lớp / hàm thuộc tính đối tượng) có tên trong `TEN_CHUNG` mà thân có lời gọi tới pool
 * (hạt theo tên, hoặc tới một khoá trong bảng điểm bất động — kể cả khi bị che bởi tham số: bảo thủ). Đây là chỗ mù của việc loại tên chung; nó
 * được GHIM (`TEN_CHUNG_GOI_POOL`) để chỗ mù có giới hạn: thêm một phương thức như vậy ⇒ đỏ, phải xem xét.
 */
function tenChungGoiPool(pg: PhanGiai, bang: BangPool): Array<{ viTri: string; qua: string }> {
  const ra = new Map<string, string>();
  for (const t of pg.cay) {
    for (const m of t.cm.phuongThuc) {
      if (!TEN_CHUNG.has(m.ten)) continue;
      const than = (m.node as ts.FunctionLikeDeclaration).body;
      const c = than ? loiGoiDau(than, (x) => goiHatPool(x) !== null || goiToiPool(bang, pg.dich(t, x), x)) : null;
      if (c && !ra.has(`${t.duong}#${m.ten}`)) ra.set(`${t.duong}#${m.ten}`, c.expression.getText().replace(/\s+/g, ""));
    }
  }
  return [...ra.entries()].map(([viTri, qua]) => ({ viTri, qua })).sort((a, b) => (a.viTri < b.viTri ? -1 : a.viTri > b.viTri ? 1 : 0));
}

/** Lời gọi ĐẦU TIÊN thoả `p` trong `e`, ĐI VÀO cả hàm lồng (thân phương thức gọi pool trong closure vẫn là gọi pool). */
function loiGoiDau(e: ts.Node, p: (c: ts.CallExpression) => boolean): ts.CallExpression | null {
  let ra: ts.CallExpression | null = null;
  const di = (n: ts.Node): void => {
    if (ra) return;
    if (ts.isCallExpression(n) && p(n)) ra = n;
    else n.forEachChild(di);
  };
  di(e);
  return ra;
}

function quetPoolTrongTxPg(pg: PhanGiai, laPhamVi: (duong: string) => boolean): KetQuaB {
  const bang = tinhBangPool(pg);
  const coKhoa = diemBatDong(pg, (n) => dauKhoaTrucTiep(n));
  /** Tên hàm / tay cầm pool nếu lời gọi `n` (trong callback có tham số giao dịch `tx`) là gọi pool. */
  const laGoiPool = (t: TepDaParse, n: ts.CallExpression, tx: string | null): string | null => {
    const hat = goiHatPool(n, tx);
    if (hat) return hat;
    if (tx && ts.isPropertyAccessExpression(n.expression) && gocChuoi(n.expression.expression) === tx) return null;
    return goiToiPool(bang, pg.dich(t, n), n) ? tenGoi(n) : null;
  };
  const choGoi: ViTriPoolTrongTx[] = [];
  let soCallbackCoKhoa = 0;
  for (const t of pg.cay) {
    if (!laPhamVi(t.duong) || !t.src.text.includes(".transaction(")) continue;
    const daBao = new Set<ts.Node>();
    const ghi = (n: ts.Node, ham: string): void => {
      if (daBao.has(n)) return;
      daBao.add(n);
      choGoi.push({ viTri: `${t.duong}#${hamBaoNgoai(n)}`, dong: dongCua(t.src, n), ham });
    };
    const xetCallback = (cb: ts.FunctionLikeDeclaration): void => {
      const than = cb.body!;
      let khoa = false;
      const timKhoa = (n: ts.Node): void => {
        if (khoa) return;
        if (dauKhoaTrucTiep(n) || (ts.isCallExpression(n) && pg.dich(t, n).some((k) => coKhoa.has(k)))) khoa = true;
        else n.forEachChild(timKhoa);
      };
      timKhoa(than);
      if (!khoa) return;
      soCallbackCoKhoa++;
      const tx = thamSoGd(cb);
      const timPool = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const ham = laGoiPool(t, n, tx);
          if (ham) ghi(n, ham);
          else if (ts.isPropertyAccessExpression(n.expression) && PHUONG_THUC_DB.has(n.expression.name.text)) {
            // tay cầm pool bắt từ NGOÀI callback: `const db = await getDb()` ở hàm bao, `db.select(…)` ở đây
            const goc = gocChuoi(n.expression.expression);
            if (goc && goc !== tx) {
              const b = giaTriCuaBien(n.expression, goc);
              const ngoai = b.vung !== null && !chua(than, b.khai!);
              if (ngoai && b.giaTri.some((e) => coLoiGoi(e, (c) => laGoiPool(t, c, null) !== null))) ghi(n, `${goc}.${n.expression.name.text}`);
            }
          }
        }
        n.forEachChild(timPool);
      };
      timPool(than);
    };
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "transaction" && n.arguments[0]) {
        let cb: ts.Node | undefined = n.arguments[0];
        if (ts.isIdentifier(cb)) cb = t.cm.hamTheoTen.get(cb.text)?.[0];
        if (cb && laHam(cb) && cb.body) xetCallback(cb);
      }
      n.forEachChild(di);
    };
    di(t.src);
  }
  return { viTri: choGoi, soCallbackCoKhoa, coDiemBatDong: bang.size, tenChungGoiPool: tenChungGoiPool(pg, bang) };
}

/** Biểu thức `e` (không đi vào hàm lồng) có lời gọi thoả `p`? */
function coLoiGoi(e: ts.Node, p: (c: ts.CallExpression) => boolean): boolean {
  let co = false;
  const di = (n: ts.Node): void => {
    if (co) return;
    if (ts.isCallExpression(n) && p(n)) co = true;
    else if (!laHam(n)) n.forEachChild(di);
  };
  di(e);
  return co;
}

/** (B) trên nguồn trong bộ nhớ (thiết bị đo). Phạm vi: mọi tệp truyền vào. */
export function quetPoolTrongTxNguon(tep: ReadonlyArray<TepNguon>, tenChungGhim: ReadonlySet<string> = new Set()): KetQuaB {
  return quetPoolTrongTxPg(new PhanGiai(tep.map(parse), tenChungGhim), () => true);
}

const nhoB = new Map<string, KetQuaB>();
function quetBRepo(goc: string): KetQuaB {
  let r = nhoB.get(goc);
  if (!r) nhoB.set(goc, (r = quetPoolTrongTxPg(pgCuaRepo(goc), laPhamViB)));
  return r;
}

/** (B) — mọi CHỖ GỌI pool (một phần tử mỗi lời gọi; review T5 I1) trong callback giao dịch giữ khoá hàng, phạm vi `PHAM_VI_B`. */
export function quetPoolTrongTx(goc: string): ViTriPoolTrongTx[] {
  return quetBRepo(goc).viTri;
}

// ─── Test ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LAU = 180_000;

describe("★★★ census — thứ tự khoá ADAPTER → LUẬT interlock + cấm pool trong giao dịch giữ khoá (R1b-2b-2a T5, mục 63)", () => {
  it(
    "đo (in bảng khi CENSUS_IN=1)",
    () => {
      if (process.env.CENSUS_IN !== "1") return;
      const a = quetKhoaLuatDayDu(GOC_REPO);
      console.log("(A)\n" + a.map((v) => `${v.viTri}:${v.dong} truoc=${v.coKhoaAdapterTruoc} sau=${v.coKhoaAdapterSau} qua=${v.qua ?? "-"}`).join("\n"));
      const b = quetBRepo(GOC_REPO);
      console.log(`(B) callback có khoá: ${b.soCallbackCoKhoa}; điểm bất động: ${b.coDiemBatDong}\n` + b.viTri.map((v) => `${v.viTri}:${v.ham} @${v.dong}`).sort().join("\n"));
      console.log(`TEN_CHUNG gọi pool: ${b.tenChungGoiPool.length}\n` + b.tenChungGoiPool.map((x) => `${x.viTri} <= ${x.qua}`).join("\n"));
      if (process.env.CENSUS_VET === "1") {
        const vet = new Map<string, string>();
        const fp = tinhBangPool(pgCuaRepo(GOC_REPO), vet);
        console.log(`fixpoint: ${fp.size}\n` + [...fp.keys()].sort().map((x) => `${x} <= ${vet.get(x)}`).join("\n"));
      }
    },
    LAU,
  );

  // Đột biến đã chạy (fix round 1, review m8): thu phạm vi quét về `server/routers` ⇒ ca này đỏ (cùng ★ (A), ★ hợp đồng, ★ (B), ★ I2).
  it(
    "cầu chì — phạm vi quét không mù (đủ file, tệp neo đọc được > 500 ký tự, đủ thư mục (B))",
    () => {
      expect(MOI_FILE.length).toBeGreaterThan(1000);
      const pg = pgCuaRepo(GOC_REPO);
      const NEO = [
        "server/services/scada/troLaiKenh.ts",
        "server/services/scada/nhatQuanKenh.ts",
        "server/routers/interlockRouter.ts",
        "server/routers/deviceAdapterRouter.ts",
        "server/routers/scadaKenhRouter.ts",
        "server/routers/scadaDiagRouter.ts",
        "server/services/engineeringAssignment/assignmentService.ts",
        "server/services/interlock/backfillDinhNghiaDuyet.ts",
        "server/services/ot/commandDispatcher.ts",
        "server/services/ot/mappingAsCode.ts",
      ];
      for (const d of NEO) expect(pg.theoDuong.get(d)?.src.text.length ?? 0, d).toBeGreaterThan(500);
      for (const v of quetKhoaLuatDayDu(GOC_REPO)) expect(pg.theoDuong.get(v.viTri.split("#")[0])!.src.text.length, v.viTri).toBeGreaterThan(500);
      for (const p of PHAM_VI_B) expect(pg.cay.filter((t) => t.duong.startsWith(p)).length, p).toBeGreaterThan(0);
    },
    LAU,
  );

  it(
    "★ (A) mọi khoá interlock_rules có khoá ADAPTER trước trong cùng hàm, hoặc là hàm có hợp đồng ghi rõ",
    () => {
      const vt = quetKhoaLuat(GOC_REPO);
      expect(vt.length, "cầu chì: ≥ 6 chỗ khoá luật").toBeGreaterThanOrEqual(6);
      expect(vt.filter((v) => v.qua === null).length, "cầu chì: ≥ 6 chỗ khoá luật TRỰC TIẾP").toBeGreaterThanOrEqual(6);
      expect(vt.filter((v) => !v.coKhoaAdapterTruoc && !HAM_KHOA_LUAT_CO_HOP_DONG.has(v.viTri)).map((v) => `${v.viTri}:${v.dong}`)).toEqual([]);
      // neo đột biến: đường ghi luật của interlockRouter khoá adapter TRƯỚC luật (R1b-2b-1 T10 / R1b-2b-2a T4)
      expect(vt.find((v) => v.viTri === "server/routers/interlockRouter.ts#khoaDichLuatTx")).toMatchObject({ qua: null, coKhoaAdapterTruoc: true });
    },
    LAU,
  );

  it(
    "★ (A) không lượt khoá adapter nào SAU lượt khoá luật trong cùng hàm (trực tiếp + qua mọi hợp đồng; khoá lại hàng đã giữ được tha)",
    () => {
      expect(quetKhoaLuatDayDu(GOC_REPO).filter((v) => v.coKhoaAdapterSau).map((v) => `${v.viTri}:${v.dong}`)).toEqual([]);
    },
    LAU,
  );

  // Đột biến đã chạy (fix round 1, review m8): thêm mục hợp đồng không có thật ⇒ ca này đỏ; xoá mục `khoaLuatNhamTagTx` ⇒ ★ (A) đỏ.
  it(
    "★ hợp đồng — mỗi mục là vị trí ĐO được (không mục thừa), có ngày + lý do, và có ít nhất một bên gọi được kiểm",
    () => {
      const tat = quetKhoaLuatDayDu(GOC_REPO);
      const daDo = new Set(tat.map((v) => v.viTri));
      expect(HOP_DONG.filter((h) => !daDo.has(h.viTri)).map((h) => h.viTri), "mục hợp đồng không còn khoá luật ⇒ xoá khỏi HOP_DONG").toEqual([]);
      for (const h of HOP_DONG) {
        expect(h.ngay, h.viTri).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(h.lyDo.length, h.viTri).toBeGreaterThan(30);
        const ten = h.viTri.split("#")[1];
        expect(tat.some((v) => v.qua === ten && v.loaiQua === h.loai), `${h.viTri}: không có bên gọi đo được — hợp đồng không được kiểm`).toBe(true);
      }
    },
    LAU,
  );

  it(
    "★ (B) lời gọi pool trong giao dịch giữ khoá hàng = đúng tập nợ đã ghim (ratchet)",
    () => {
      expect(quetBRepo(GOC_REPO).soCallbackCoKhoa, "cầu chì: ≥ 20 callback giao dịch có khoá").toBeGreaterThanOrEqual(20);
      const do_ = quetPoolTrongTx(GOC_REPO);
      // review T5 I1 — ghim theo CHỖ GỌI: thêm một lời gọi pool vào thủ tục ĐÃ nợ (vd interlockRouter#update) cũng đỏ
      expect(do_.map((v) => `${v.viTri}:${v.ham}`).sort(), "chỗ gọi pool trong tx giữ khoá ≠ tập nợ đã ghim").toEqual([...NO_POOL_THEO_CHO_GOI].sort());
      expect([...new Set(do_.map((v) => v.viTri))].sort()).toEqual([...NO_POOL_TRONG_TX].sort());
      expect(NO_POOL_TRONG_TX.has("server/routers/interlockRouter.ts#resolveEvent")).toBe(false);
      for (const n of NO_POOL) {
        expect(n.ngay, n.viTri).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(n.backlog, n.viTri).toMatch(/^R1b-2b-2b · /);
      }
    },
    LAU,
  );

  it(
    "★ (B) review I2 — phương thức first-party TÊN CHUNG có thân tới pool = đúng tập đã ghim (chỗ mù của TEN_CHUNG có giới hạn, ratchet)",
    () => {
      const do_ = quetBRepo(GOC_REPO).tenChungGoiPool.map((x) => x.viTri);
      expect(do_, "phương thức tên chung MỚI gọi pool ⇒ đổi tên cho riêng biệt, hoặc thêm vào TEN_CHUNG_GOI_POOL kèm lý do").toEqual(
        TEN_CHUNG_GOI_POOL.map((x) => x.viTri).sort(),
      );
      for (const x of TEN_CHUNG_GOI_POOL) expect(x.lyDo.length, x.viTri).toBeGreaterThan(10);
      // neo: chỗ mù review nêu (store.consume của trustedSafetyOrigin) nay có tên
      expect(do_).toContain("server/services/safety/trustedSafetyOrigin.ts#consume");
    },
    LAU,
  );

  // ─── Thiết bị đo (nguồn tổng hợp trong bộ nhớ) ───

  const LUAT = `  await tx.select().from(interlockRules).where(eq(interlockRules.id, 1)).for("update");`;
  const AD = `  await khoaAdapterTx(tx, [1]);`;
  const mot = (than: string) => quetKhoaLuatNguon([{ duong: "x.ts", ma: `export async function f(tx, x, id, khac) {\n${than}\n}\n` }], []);
  const truoc = (than: string) => mot(than)[0].coKhoaAdapterTruoc;

  it("thiết bị đo (A): nguồn tổng hợp khoá luật TRƯỚC adapter ⇒ bị bắt; adapter trước ⇒ tha; nhận đủ dạng khoá luật / adapter", () => {
    expect(mot(`${LUAT}\n${AD}`)).toMatchObject([{ viTri: "x.ts#f", coKhoaAdapterTruoc: false, coKhoaAdapterSau: true, qua: null, dong: 2 }]);
    expect(mot(`${AD}\n${LUAT}`)).toMatchObject([{ coKhoaAdapterTruoc: true, coKhoaAdapterSau: false }]);
    expect(truoc(`  await tx.select().from(deviceAdapters).where(eq(deviceAdapters.id, 1)).for("share");\n${LUAT}`)).toBe(true);
    expect(truoc("  await tx.execute(sql`SELECT id FROM device_adapters WHERE id = 1 FOR SHARE`);\n" + LUAT)).toBe(true);
    // SQL thô khoá luật (tên bảng trần hoặc `${interlockRules}`); không FOR ⇒ không khoá
    expect(mot("  await tx.execute(sql`SELECT * FROM interlock_rules WHERE id = ${id} FOR UPDATE`);")).toHaveLength(1);
    expect(mot("  await tx.execute(sql`SELECT * FROM ${interlockRules} WHERE id = 1 FOR SHARE`);")).toHaveLength(1);
    expect(mot("  await tx.execute(sql`SELECT * FROM interlock_rules WHERE id = 1`);")).toEqual([]);
    // chế độ là biểu thức (`.for(khoaLuat)` của khoaDichLuatTx) ⇒ vẫn là khoá
    expect(mot(`  await tx.select().from(interlockRules).limit(1).for(x);`)).toHaveLength(1);
    // chuỗi dựng qua biến, kể cả `q = q.for(…)` (backfillDinhNghiaDuyet) và `lock ? q.for(…) : q` (loadTarget)
    expect(mot(`  let q = tx.select().from(interlockRules).orderBy(interlockRules.id);\n  if (x) q = q.for("update");\n  await q;`)).toHaveLength(1);
    expect(mot(`  const q = tx.select().from(interlockRules).limit(1);\n  const [r] = x ? await q.for("share") : await q;`)).toHaveLength(1);
    // biến cùng tên ở khối `case` khác KHÔNG lẫn (đo 2026-11-01: lần đầu lẫn ⇒ loadTarget có 5 "khoá luật" thay vì 1)
    expect(
      mot(`  switch (x) {\n    case 1: { const q = tx.select().from(machines); return q.for("share"); }\n    case 2: { const q = tx.select().from(interlockRules); return q.for("share"); }\n  }`),
    ).toHaveLength(1);
    // join khoá cả luật ⇒ bắt; `of` chỉ bảng khác ⇒ không; `Symbol.for` ⇒ không
    expect(mot(`  await tx.select().from(deviceTags).innerJoin(interlockRules, eq(a, b)).for("share");`)).toHaveLength(1);
    expect(mot(`  await tx.select().from(deviceTags).innerJoin(interlockRules, eq(a, b)).for("share", { of: deviceTags });`)).toEqual([]);
    expect(mot(`  const s = Symbol.for("interlockRules");`)).toEqual([]);
  });

  it("thiết bị đo (A) KD-C2: khoá adapter CÓ ĐIỀU KIỆN không tính là 'đã khoá trước'; chắc chắn chạy thì tính", () => {
    expect(truoc(`  if (x) await khoaAdapterTx(tx, [1]);\n${LUAT}`)).toBe(false);
    expect(truoc(`  if (x) { await khoaAdapterTx(tx, [1]); } else { await khoaAdapterTx(tx, [2]); }\n${LUAT}`), "bảo thủ: hai nhánh").toBe(false);
    expect(truoc(`  const a = x ? await khoaAdapterTx(tx, [1]) : null;\n${LUAT}`)).toBe(false);
    expect(truoc(`  x && (await khoaAdapterTx(tx, [1]));\n${LUAT}`)).toBe(false);
    expect(truoc(`  const a = x ?? (await khoaAdapterTx(tx, [1]));\n${LUAT}`)).toBe(false);
    expect(truoc(`  for (const i of x) await khoaAdapterTx(tx, [i]);\n${LUAT}`)).toBe(false);
    expect(truoc(`  x.forEach(() => khoaAdapterTx(tx, [1]));\n${LUAT}`), "closure").toBe(false);
    expect(truoc(`  try { await khoaAdapterTx(tx, [1]); } catch {}\n${LUAT}`)).toBe(false);
    expect(truoc(`  switch (x) { case 1: await khoaAdapterTx(tx, [1]); }\n${LUAT}`)).toBe(false);
    // chắc chắn chạy
    expect(truoc(`  if (!x) return;\n${AD}\n${LUAT}`)).toBe(true);
    expect(truoc(`  if (x) {\n  ${AD}\n  ${LUAT}\n  }`), "cùng nhánh").toBe(true);
    expect(truoc(`  const m = (await khoaAdapterTx(tx, [1])).get(1);\n${LUAT}`)).toBe(true);
    expect(truoc(`  try { ${AD} } finally {}\n${LUAT}`)).toBe(true);
    expect(truoc(`  do { ${AD} } while (x);\n${LUAT}`)).toBe(true);
  });

  it("thiết bị đo (A): khoá lại CÙNG hàng adapter đã giữ ⇒ không là 'sau'; hàng khác / nâng cấp share→update ⇒ là 'sau'", () => {
    const ADU = `  await tx.select().from(deviceAdapters).where(eq(deviceAdapters.id, id)).for("update");`;
    expect(mot(`${ADU}\n${LUAT}\n${ADU}`)[0].coKhoaAdapterSau).toBe(false);
    expect(mot(`${ADU.replace('"update"', '"share"')}\n${LUAT}\n${ADU}`)[0].coKhoaAdapterSau).toBe(true);
    expect(mot(`${ADU}\n${LUAT}\n${ADU.replace("id, id))", "id, khac))")}`)[0].coKhoaAdapterSau).toBe(true);
  });

  it("thiết bị đo (A): hợp đồng được KIỂM ở bên gọi (qua import), không chỉ tin", () => {
    const HD: HopDong[] = [
      { viTri: "lib.ts#khoaLuatCuaToiTx", loai: "nguoi_goi_khoa_adapter", ngay: "2026-11-01", lyDo: "x" },
      { viTri: "lib.ts#khoaLa", loai: "khong_khoa_adapter_sau", ngay: "2026-11-01", lyDo: "x" },
    ];
    const lib = `export async function khoaLuatCuaToiTx(tx) { return tx.select().from(interlockRules).for("share"); }\nexport async function khoaLa(tx) { return tx.select().from(interlockRules).for("share"); }\n`;
    const goi =
      `import { khoaLuatCuaToiTx, khoaLa } from "./lib";\n` +
      `export async function tot(tx) { await khoaAdapterTx(tx, [1]); await khoaLuatCuaToiTx(tx); }\n` +
      `export async function xau(tx, x) { if (x) await khoaAdapterTx(tx, [1]); await khoaLuatCuaToiTx(tx); }\n` +
      `export async function laTot(tx) { await khoaLa(tx); }\n` +
      `export async function laXau(tx) { await khoaLa(tx); await khoaAdapterTx(tx, [1]); }\n`;
    const vt = quetKhoaLuatNguon([{ duong: "lib.ts", ma: lib }, { duong: "goi.ts", ma: goi }], HD);
    expect(vt.find((v) => v.viTri === "goi.ts#tot")).toMatchObject({ qua: "khoaLuatCuaToiTx", coKhoaAdapterTruoc: true });
    expect(vt.find((v) => v.viTri === "goi.ts#xau"), "bên gọi khoá adapter có điều kiện ⇒ vị trí 'qua' không có khoá trước").toMatchObject({
      qua: "khoaLuatCuaToiTx",
      coKhoaAdapterTruoc: false,
    });
    expect(vt.find((v) => v.viTri === "goi.ts#laTot")).toMatchObject({ loaiQua: "khong_khoa_adapter_sau", coKhoaAdapterSau: false });
    expect(vt.find((v) => v.viTri === "goi.ts#laXau")).toMatchObject({ loaiQua: "khong_khoa_adapter_sau", coKhoaAdapterSau: true });
  });

  const B = (ma: string) => quetPoolTrongTxNguon([{ duong: "r.ts", ma }]).viTri;
  const voTx = (trong: string, ngoai = "") =>
    `export async function f(db, ctx) {\n${ngoai}\n  await db.transaction(async (tx) => {\n    await tx.select().from(interlockRules).where(eq(interlockRules.id, 1)).for("update");\n${trong}\n  });\n}\n`;

  it("thiết bị đo (B): nguồn tổng hợp gọi luatTrongPhamVi trong tx có .for('update') ⇒ bị bắt; gọi ngoài tx ⇒ không", () => {
    expect(B(voTx(`    await luatTrongPhamVi(ctx, {});`))).toMatchObject([{ viTri: "r.ts#f", ham: "luatTrongPhamVi", dong: 5 }]);
    expect(B(voTx("", `  await luatTrongPhamVi(ctx, {});`))).toEqual([]);
    // giao dịch KHÔNG giữ khoá hàng ⇒ ngoài vị từ
    expect(B(`export async function f(db, ctx) { await db.transaction(async (tx) => { await tx.select().from(a); await luatTrongPhamVi(ctx, {}); }); }`)).toEqual([]);
    // `.update(` / `.delete(` / `khoa*Tx` / SQL thô FOR UPDATE / gọi hàm có khoá đều là "giữ khoá"
    expect(B(`export async function f(db, ctx) { await db.transaction(async (tx) => { await tx.update(a).set({}); await getDb(); }); }`)).toHaveLength(1);
    expect(B(`export async function f(db, ctx) { await db.transaction(async (tx) => { await khoaGiTx(tx); await getDb(); }); }`)).toHaveLength(1);
    expect(B("export async function f(db, ctx) { await db.transaction(async (tx) => { await tx.execute(sql`SELECT 1 FROM a FOR UPDATE`); await getDb(); }); }")).toHaveLength(1);
    expect(
      B(`async function khoaNgam(tx) { await tx.select().from(a).for("share"); }\nexport async function f(db) { await db.transaction(async (tx) => { await khoaNgam(tx); await getDb(); }); }`),
    ).toHaveLength(1);
    // tay cầm pool bắt từ ngoài callback
    expect(B(voTx(`    await db2.select().from(u);`, `  const db2 = await getDb();`))).toMatchObject([{ ham: "db2.select" }]);
    // tham số giao dịch không phải pool
    expect(B(voTx(`    await tx.select().from(u);`))).toEqual([]);
  });

  it("thiết bị đo (B) KD-C2: điểm bất động XUYÊN TỆP (import, bí danh, barrel `export *`) + bảo thủ khi mơ hồ tên", () => {
    const nen: TepNguon[] = [
      { duong: "server/db/connection.ts", ma: `export async function getDb() { return pool; }\n` },
      { duong: "server/db/index.ts", ma: `export * from "./connection";\n` },
      { duong: "server/services/a.ts", ma: `import { getDb as g } from "../db";\nexport async function docQuaPool(id) { const db = await g(); return db.select().from(t); }\n` },
      { duong: "server/services/b.ts", ma: `import { docQuaPool } from "./a";\nexport const boc = async (id) => docQuaPool(id);\n` },
      { duong: "server/services/khongPhaiHam.ts", ma: `export const docQuaPool = taoHam();\n` },
      { duong: "server/services/kho.ts", ma: `export class Kho { async docBangPool() { return (await getDb()).select(); } async get() { return getDb(); } }\n` },
      {
        duong: "server/services/audit.ts",
        ma: `import { getDb } from "../db";\nexport async function ghiAudit(row, ex) { const db = ex ?? (await getDb()); await db.insert(t).values(row); }\n`,
      },
    ];
    const thuTuc = (nhap: string, goi: string): TepNguon => ({
      duong: "server/routers/c.ts",
      ma: `${nhap}\nexport async function thuTuc(db, kho, m) {\n  await db.transaction(async (tx) => {\n    await tx.update(t).set({ a: 1 });\n    ${goi}\n  });\n}\n`,
    });
    const bang = tinhHamGoiPool(nen);
    expect([...bang.keys()]).toEqual(expect.arrayContaining(["server/services/a.ts#docQuaPool", "server/services/b.ts#boc", ".docBangPool"]));
    expect(bang.get("server/services/audit.ts#ghiAudit")).toMatchObject({ u: false, thamSo: new Set([1]) });
    const q = (nhap: string, goi: string) => quetPoolTrongTxNguon([...nen, thuTuc(nhap, goi)]).viTri;
    // hai bước, hai tệp: c → b.boc → a.docQuaPool → (bí danh g → barrel) getDb
    expect(q(`import { boc } from "../services/b";`, `await boc(1);`)).toMatchObject([{ viTri: "server/routers/c.ts#thuTuc", ham: "boc" }]);
    // tệp đích không có hàm tên ấy (`export const docQuaPool = taoHam()`) ⇒ BẢO THỦ: mọi hàm cấp tệp cùng tên
    expect(q(`import { docQuaPool } from "../services/khongPhaiHam";`, `await docQuaPool(1);`)).toHaveLength(1);
    // phương thức: trùng tên ⇒ bảo thủ; tên chung (`get`) không khớp (giới hạn ghi rõ)
    expect(q(``, `await kho.docBangPool();`)).toMatchObject([{ ham: "docBangPool" }]);
    expect(q(``, `await m.get(1);`)).toEqual([]);
    // che bởi tham số: truyền tx ⇒ không gọi pool; thiếu ⇒ gọi pool
    expect(q(`import { ghiAudit } from "../services/audit";`, `await ghiAudit({}, tx);`)).toEqual([]);
    expect(q(`import { ghiAudit } from "../services/audit";`, `await ghiAudit({});`)).toMatchObject([{ ham: "ghiAudit" }]);
    // import() động phá cấu trúc
    expect(q(``, `const { boc } = await import("../services/b"); await boc(1);`)).toHaveLength(1);
    // hàm không gọi pool ⇒ không
    expect(q(`import { khac } from "../services/b";`, `await khac(1);`)).toEqual([]);
  });

  // ─── Fix round 1 (review T5 I1 / I2 / m3 / m5) ───

  it("thiết bị đo (B) review I1: mỗi CHỖ GỌI pool là một phần tử `viTri:ham` (thêm lời gọi vào thủ tục đã nợ ⇒ khác tập)", () => {
    const mot = B(voTx(`    await kiemTotp(ctx);`, `  async function kiemTotp(c) { return getDb(); }`)).map((v) => `${v.viTri}:${v.ham}`);
    expect(mot).toEqual(["r.ts#f:kiemTotp"]);
    const hai = B(voTx(`    await kiemTotp(ctx);\n    await luatTrongPhamVi(ctx, {});\n    await kiemTotp(ctx);`, `  async function kiemTotp(c) { return getDb(); }`)).map(
      (v) => `${v.viTri}:${v.ham}`,
    );
    expect(hai.sort()).toEqual(["r.ts#f:kiemTotp", "r.ts#f:kiemTotp", "r.ts#f:luatTrongPhamVi"]);
  });

  it("thiết bị đo (B) review I2: phương thức first-party TÊN CHUNG gọi pool bị ĐO (⇒ ratchet đỏ); tên đã ghim + gốc NHẬP ⇒ là gọi pool", () => {
    const tep: TepNguon[] = [
      { duong: "server/services/svc.ts", ma: `export const svc = { async execute(id) { return getDb(); } };\nexport class K { async run() { return 1; } }\n` },
      {
        duong: "server/routers/r.ts",
        ma: `import { svc } from "../services/svc";\nexport async function f(db, local) {\n  await db.transaction(async (tx) => {\n    await tx.update(t).set({});\n    await svc.execute(1);\n    await local.execute(2);\n  });\n}\n`,
      },
    ];
    const chuaGhim = quetPoolTrongTxNguon(tep);
    expect(chuaGhim.tenChungGoiPool, "`execute()` mới gọi getDb được đo ⇒ khác TEN_CHUNG_GOI_POOL ⇒ ca ★ I2 đỏ").toMatchObject([
      { viTri: "server/services/svc.ts#execute", qua: "getDb" },
    ]);
    expect(chuaGhim.viTri, "chưa ghim: tên chung không khớp (chỗ mù — vì vậy phải ghim)").toEqual([]);
    const daGhim = quetPoolTrongTxNguon(tep, new Set(["execute"]));
    expect(daGhim.viTri, "đã ghim: `svc.execute()` (svc NHẬP) là gọi pool; `local.execute()` (tham số) không").toMatchObject([
      { viTri: "server/routers/r.ts#f", ham: "execute", dong: 5 },
    ]);
  });

  it("thiết bị đo review m3: phân giải `export *` không phụ thuộc thứ tự (barrel trước / trực tiếp trước cho cùng kết quả)", () => {
    const tep: TepNguon[] = [
      { duong: "server/x.ts", ma: `export const f = wrap();\n` },
      { duong: "server/barrel.ts", ma: `export * from "./x";\n` },
      { duong: "server/y.ts", ma: `export async function f() { return getDb(); }\n` },
    ];
    const a = new PhanGiai(tep.map(parse));
    const aBarrel = a.giaiXuat("server/barrel.ts", "f");
    const aTrucTiep = a.giaiXuat("server/x.ts", "f");
    const b = new PhanGiai(tep.map(parse));
    const bTrucTiep = b.giaiXuat("server/x.ts", "f");
    const bBarrel = b.giaiXuat("server/barrel.ts", "f");
    expect(aTrucTiep).toEqual(bTrucTiep);
    expect(aBarrel).toEqual(bBarrel);
    expect(aTrucTiep, "x.ts không có hàm f ⇒ bảo thủ: hàm cấp tệp cùng tên").toEqual(["server/y.ts#f"]);
  });

  it("thiết bị đo (A) review m5: helper khoá adapter BÊN TRONG (điểm bất động) là lượt khoá 'sau'; không tính cho vế 'trước'", () => {
    const HD: HopDong[] = [{ viTri: "lib.ts#khoaLa", loai: "khong_khoa_adapter_sau", ngay: "2026-11-01", lyDo: "x" }];
    const lib =
      `export async function khoaLa(tx) { return tx.select().from(interlockRules).for("share"); }\n` +
      `export async function khoaAdapterNgam(tx, id) { await tx.select().from(deviceAdapters).where(eq(deviceAdapters.id, id)).for("update"); }\n` +
      `export async function boc2(tx) { await khoaAdapterNgam(tx, 1); }\n`;
    const goi =
      `import { khoaLa, boc2 } from "./lib";\n` +
      `export async function laXauQuaHelper(tx) { await khoaLa(tx); await boc2(tx); }\n` +
      `export async function luatRoiHelper(tx) { await khoaAdapterTx(tx, [1]); await tx.select().from(interlockRules).for("update"); await boc2(tx); }\n` +
      `export async function helperTruoc(tx) { await boc2(tx); await tx.select().from(interlockRules).for("update"); }\n`;
    const vt = quetKhoaLuatNguon([{ duong: "lib.ts", ma: lib }, { duong: "goi.ts", ma: goi }], HD);
    expect(vt.find((v) => v.viTri === "goi.ts#laXauQuaHelper"), "gọi hàm hợp đồng `khong_khoa_adapter_sau` rồi helper khoá adapter ⇒ đỏ").toMatchObject({
      loaiQua: "khong_khoa_adapter_sau",
      coKhoaAdapterSau: true,
    });
    expect(vt.find((v) => v.viTri === "goi.ts#luatRoiHelper")).toMatchObject({ qua: null, coKhoaAdapterTruoc: true, coKhoaAdapterSau: true });
    expect(vt.find((v) => v.viTri === "goi.ts#helperTruoc"), "helper có thể khoá có điều kiện ⇒ vế trước giữ bảo thủ").toMatchObject({ coKhoaAdapterTruoc: false });
  });
});
