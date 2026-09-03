// server/services/gioiHanLucDoCayV2.ts
//
// ★★★ BG-97 — ĐƯỜNG v2 PHẢI CHẤM THEO GIỚI HẠN **LÚC BO ĐƯỢC ĐO**, KHÔNG PHẢI
// GIỚI HẠN ĐANG SỐNG.
//
// ── Lỗ này là gì (Task 4 tự khai, xem `docs/superpowers/plans/2026-09-03-…` BG-97) ──
// Task 4 (`cd93d494`) nối spec-gate vào cả ba đường ghi v2 (trực tiếp · WAL phát lại
// · ZIP) nhưng chấm theo giới hạn **ĐANG SỐNG** trong `measurement_point_defs`. Đường
// **v1.x** thì có snapshot-gate (`SPEC_GATE_SNAPSHOT_ENABLED`, doc 51 P1/P2). Hệ quả:
// một bo v2 nằm tồn kho / trong WAL (dead-letter **101 mục**, có mục 6 tuần) rồi bị
// kỹ sư **SIẾT** giới hạn sau đó sẽ bị chấm theo giới hạn MỚI ⇒ **HẠ OAN** một bo TỐT.
// Chưa nổ hôm nay vì cổng đang kết luận 0 linh kiện (bản dạy chưa mang giới hạn nào),
// nhưng nổ **đúng ngày** giới hạn được đổ đầy — tức ngày Khối C lên.
//
// ── ⚠ KHÔNG VIẾT BẢN LOGIC THỨ HAI (BG-42) ──────────────────────────────────
// Phép **CHỌN** giới hạn KHÔNG được chép lại ở đây. Nó là `resolveGateLimitsForBoard`
// (`./pointResultEvaluator`) — CHÍNH hàm mà đường v1.x gọi, dùng nguyên văn, cùng
// tham số. File này chỉ làm hai việc mà hàm đó không làm: (1) chạy nó cho TỪNG khoá
// `khoaCapComponent` của một bo cây, (2) quyết định **nhánh "missing"** ánh xạ đi đâu.
//
// ── ⛔ MỘT KHÁC BIỆT CÓ CHỦ Ý VỚI v1.x, VÀ VÌ SAO ───────────────────────────
// v1.x: `missing` (không có snapshot nào chứng minh được giới hạn cũ) ⇒ **BỎ cổng**
// cho điểm đó. Lý do của v1.x đúng cho v1.x: nó chỉ bước vào đường snapshot khi bo
// **ĐÃ BIẾT là STALE** (`declaredConfigVersion < live`) — tức đã có bằng chứng cấu
// hình ĐÃ DỊCH CHUYỂN, nên chấm bằng giới hạn sống là chấm sai chắc chắn.
//
// v2 **KHÔNG CÓ** bằng chứng đó: `machineDataContractV2` không mang `pointsConfigVersion`
// (đo 2026-09-03: 0 lần xuất hiện trong `server/contracts/machineDataContractV2.ts`).
// Với v2, `missing` chỉ có MỘT nghĩa đo được: **không lượt sửa nào xảy ra SAU khi bo
// được đo** ⇒ giới hạn ĐANG SỐNG **CHÍNH LÀ** giới hạn của thời kỳ đó ⇒ chấm bằng
// LIVE. Đây đúng bằng nhánh `basis: "live"` mà v1.x dùng ở đường VERSION-EXACT (P2).
// ⚠ Nếu bê nguyên "missing ⇒ bỏ cổng" sang v2 thì ngày bật cờ, **100%** linh kiện sẽ
// mất cổng (hôm nay `measurement_point_versions` của point-def CÂY = **0/0** hàng ở
// cả hai DB) — một cổng tắt câm, đúng lớp "giấy vô can giả" mà Task 4 tồn tại để chặn.
//
// ── ⚠⚠ BIẾN THỂ (doc 55 Item 3): ĐO ĐƯỢC LÀ **KHÔNG KHOÁ ĐƯỢC** Ở v2 ────────
// Đường v1.x áp `variant_point_overrides` theo `basePointDefId`, nhưng bản đồ override
// chỉ được nạp khi **BO** phân giải ra một biến thể KHÁC base (`pointDefVariantId`
// khác NULL), và phép phân giải đó đọc `input.variantCode`.
// Đo 2026-09-03 (vai `avi_app`):
//   · `machineDataContractV2` — **0** trường `variantCode` (cửa trực tiếp v2.0 VÀ
//     `metaJsonSchema` cửa ZIP, vì ZIP `.extend()` chính hợp đồng đó, chỉ thêm `images[]`).
//   · `server/db/cayDay.ts` — **0** lần ghi `variantId` ⇒ MỌI point-def sinh từ cây dạy
//     là điểm **BASE** (`variantId IS NULL`). Đếm: hàng CÂY có `variantId` khác NULL =
//     **0** ở `current_database()=aoi_management` và **0** ở `aoi_management_test`.
//   · `variant_point_overrides` = **0 hàng** ở CẢ HAI DB.
// ⇒ `resolveIngestVariant(model, undefined)` luôn trả `pointDefVariantId = null` ⇒ bản
// đồ override luôn rỗng ⇒ **một nhánh override ở v2 hôm nay là mã KHÔNG THỂ CHẠY**.
// Vì vậy file này **KHÔNG** cài nhánh đó: viết mã chết rồi khai "đã nối" chính là lớp
// "khai mà KHÔNG đọc kết quả" mà dự án đã trả giá bốn lần. Điều kiện để nó sống lại
// được ghim bằng lưới (`hopDongVsIngest`-style, xem `gioiHanLucDoCayV2.test.ts`):
// **ngày `machineDataContractV2` có trường chọn biến thể, lưới đó ĐỎ** và người sửa
// phải nối override vào đúng chỗ này. Xem báo cáo BG-97 §biến-thể.
import {
  resolveGateLimitsForBoard,
  type PointLimitSnapshot,
  type PointLimitSource,
} from "./pointResultEvaluator";

/** Số mẫu điểm được chấm theo SNAPSHOT giữ lại để chẩn đoán — đủ nhận ra mẫu, không phình log. */
const SO_MAU_SNAPSHOT = 10;

/**
 * `SPEC_GATE_SNAPSHOT_ENABLED` — **CÙNG cờ, CÙNG mặc định (TẮT)** với đường v1.x
 * (`machineApiRouters.ts`). Task này **KHÔNG** đổi mặc định đó (ràng buộc brief).
 * ⚠ Hệ quả khai rõ: cổng snapshot của v2 là **tuỳ chọn**, giống v1.x. Ngày Khối C đổ
 * đầy giới hạn, người vận hành phải BẬT cờ này — nếu không, v2 vẫn chấm theo giới hạn
 * đang sống. Bản vá này làm năng lực đó **TỒN TẠI và ĐO ĐƯỢC**, không tự bật nó.
 */
export function laCongSnapshotBat(): boolean {
  const s = String(process.env.SPEC_GATE_SNAPSHOT_ENABLED ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

/**
 * ★★★ Task 5 (BG-97 → BG-99, spec QĐ-2) — NGUỒN CỦA `lucDo` NAY LÀ MỐC-NHẬN-SERVER,
 * KHÔNG PHẢI ĐỒNG HỒ MÁY.
 *
 * Hàm `mocDoTuChuoi` từng sống ở đây (đọc `completedAt`/`startedAt` MÁY khai làm mốc
 * "bo được đo") đã bị XOÁ: spec QĐ-2 loại hẳn phương án neo bằng đồng hồ máy — máy
 * không tin được (skew 6h có thật, xem `assessClockSkew`), và chiều nguy hiểm là đồng
 * hồ máy CHẬM ⇒ bo mới bị chấm theo limit CŨ ⇒ bo xấu đi lọt. Luật `docGioMay` (chuỗi
 * TRẦN = UTC) mà `mocDoTuChuoi` từng áp NAY chuyển sang chỗ dùng CHUNG toàn đường ingest
 * (`server/utils/factoryTime.ts`), vì nó không còn riêng của spec-gate: BG-99 áp cùng
 * luật cho MỌI điểm đọc chuỗi thời gian máy (cột `inspectionTime`, cấp cây, dedup…).
 *
 * `lucDo` (tham số của {@link giaiGioiHanTaiLucDo} bên dưới) nay được ba cửa tính TỪ
 * MỐC MÁY CHỦ NHẬN ĐƯỢC PAYLOAD, theo từng đường (xem `server/db/inspection.ts` ở
 * `traBanDayChoCay`, và nơi gọi ở `machineApiRouters.ts`/`aoiPackageRouter.ts`):
 *   · Trực tiếp — `serverReceivedAt ?? now()` (đặt một lần, ngay sau xác thực).
 *   · WAL phát lại — `enqueuedAt` của mục WAL (persist trong payload đã buffer, TẤT ĐỊNH
 *     qua phát lại, KHÔNG đọc đồng hồ lúc phát lại).
 *   · Cửa ZIP — `inspection_packages.createdAt` (mốc gói được TẠO, không phải commit).
 * File NÀY (`giaiGioiHanTaiLucDo`) không đổi: nó vẫn nhận `lucDo: Date` đã giải quyết
 * sẵn, không quan tâm nguồn — đúng ranh giới trách nhiệm cũ.
 */

/** Kết quả giải giới hạn cho CẢ BO — cùng bộ khoá `khoaCapComponent` với đầu vào. */
export interface KetQuaGiaiGioiHan {
  /** Bản đồ giới hạn ĐÃ NEO vào lúc bo được đo. Cùng khoá, cùng kích thước với đầu vào. */
  gioiHan: Map<string, PointLimitSource>;
  /** Số điểm chấm bằng giới hạn TÁI DỰNG từ `measurement_point_versions` (bo cũ, limit đã đổi). */
  theoSnapshot: number;
  /** Số điểm chấm bằng giới hạn ĐANG SỐNG (không lượt sửa nào sau lúc bo được đo). */
  theoSong: number;
  /** Tối đa {@link SO_MAU_SNAPSHOT} mẫu khoá được tái dựng — để log nói ra ĐIỂM NÀO. */
  mauSnapshot: string[];
}

/**
 * ★★★ Neo giới hạn của MỘT bo cây vào **lúc bo được đo**.
 *
 * THUẦN: không DB, không đồng hồ, không ngẫu nhiên — cùng đầu vào cho cùng đầu ra.
 * Đó là điều kiện để mệnh đề "WAL phát lại cho CÙNG kết quả" đúng theo **cấu tạo**
 * chứ không theo may mắn: không có `Date.now()` nào ở đây để lượt phát lại đọc khác.
 *
 * ⚠ Bất biến GIỮ NGUYÊN KÍCH THƯỚC: mọi khoá có trong `gioiHanSong` đều có trong kết
 * quả. Bỏ một khoá ra sẽ đẩy linh kiện đó từ rổ `khongGioiHan`/`dat` sang rổ `chuaDay`
 * của `specGateCayV2` — tức làm HỎNG phân hoạch ba trạng thái mà Task 4 dựng. Bản vá
 * này **không thêm trạng thái nào** vào phân hoạch đó; nó chỉ đổi **NGUỒN** của giới
 * hạn, còn mọi phép phân loại vẫn do `specGateCayV2` làm y như trước.
 */
export function giaiGioiHanTaiLucDo(args: {
  /** `khoaCapComponent(...)` → `measurement_point_defs.id` (Task 3). */
  banDo: ReadonlyMap<string, number>;
  /** `khoaCapComponent(...)` → giới hạn ĐANG SỐNG (Task 4). */
  gioiHanSong: ReadonlyMap<string, PointLimitSource>;
  /** `pointDefId` → lịch sử sửa (`measurement_point_versions`), thứ tự bất kỳ. */
  lichSu: ReadonlyMap<number, PointLimitSnapshot[]>;
  /** Mốc "bo được đo" — xem `traBanDayChoCay` về VÌ SAO mốc này chứ không phải mốc khác. */
  lucDo: Date;
}): KetQuaGiaiGioiHan {
  const { banDo, gioiHanSong, lichSu, lucDo } = args;
  const gioiHan = new Map<string, PointLimitSource>();
  const mauSnapshot: string[] = [];
  let theoSnapshot = 0;
  let theoSong = 0;

  for (const [khoa, song] of gioiHanSong) {
    const pointDefId = banDo.get(khoa);
    const snaps = pointDefId === undefined ? [] : lichSu.get(pointDefId) ?? [];
    // ⚠ `declaredVersion: null` — CÓ CHỦ Ý, không phải quên: hợp đồng v2.0 KHÔNG mang
    // `pointsConfigVersion` (đo được), nên đường VERSION-EXACT (doc 51 P2, 0282) không
    // khoá được ở v2 và `resolveGateLimitsForBoard` rơi thẳng về đường INSTANT (P1) —
    // CHÍNH nhánh mà v1.x dùng khi không có tem 0282. Không có bản chép tay nào.
    const r = resolveGateLimitsForBoard({
      snapshots: snaps,
      liveLimits: song,
      declaredVersion: null,
      atInstant: lucDo,
    });
    if (r.basis === "instant" && r.limits) {
      gioiHan.set(khoa, r.limits);
      theoSnapshot += 1;
      // `khoaCapComponent` nối hai mã bằng ký tự NUL — đổi sang "/" để dòng log đọc được.
      if (mauSnapshot.length < SO_MAU_SNAPSHOT) mauSnapshot.push(khoa.replace("\u0000", "/"));
    } else {
      // `missing` ⇒ KHÔNG lượt sửa nào sau lúc bo được đo ⇒ LIVE **là** giới hạn thời
      // kỳ đó. Xem khối chú thích đầu file về vì sao v2 ánh xạ khác v1.x ở đúng nhánh này.
      gioiHan.set(khoa, song);
      theoSong += 1;
    }
  }

  return { gioiHan, theoSnapshot, theoSong, mauSnapshot };
}
