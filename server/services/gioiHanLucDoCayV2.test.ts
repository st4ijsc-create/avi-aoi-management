/**
 * server/services/gioiHanLucDoCayV2.test.ts
 *
 * **BG-97** — lưới THUẦN cho phép neo giới hạn vào *lúc bo được đo* (đường v2).
 *
 * File này KHÔNG thay lưới DB (`server/db/specGateCayV2.db.test.ts` mệnh đề 7/7B/8/9
 * mới là nơi đo kết cục ghi xuống đĩa qua CẢ HAI cửa thật). Nó ghim ba thứ mà lưới DB
 * không nói được rõ bằng:
 *   · **nhánh `missing` ánh xạ đi đâu** — khác v1.x có chủ ý, xem docblock file nguồn;
 *   · **tính XÁC ĐỊNH** — không đọc đồng hồ ⇒ "WAL phát lại cho cùng kết quả" là hệ
 *     quả CẤU TẠO, không phải may mắn;
 *   · **BIẾN THỂ chưa khoá được ở v2** — một cầu chì ĐỎ ĐƯỢC ngày hợp đồng v2.0 mọc
 *     trường chọn biến thể (xem mệnh đề cuối).
 */
import { describe, it, expect } from "vitest";
import { giaiGioiHanTaiLucDo, laCongSnapshotBat } from "./gioiHanLucDoCayV2";
import type { PointLimitSnapshot, PointLimitSource } from "./pointResultEvaluator";
import { khoaCapComponent } from "../db/cayDay";
import { machineDataContractV2 } from "../contracts/machineDataContractV2";

const CAP = "cap-1";
const COMP = "comp-1";
const K = khoaCapComponent(CAP, COMP);

/** Giới hạn ĐANG SỐNG: đã bị SIẾT xuống [1;3]. */
const SONG: PointLimitSource = { lowerLimit: "1", upperLimit: "3" };
/** Giới hạn của thời kỳ bo được đo: RỘNG [1;10]. */
const CU: PointLimitSource = { lowerLimit: "1", upperLimit: "10" };
/** Một thời kỳ còn cũ hơn nữa — dùng để chứng minh phép chọn lấy bản SỚM NHẤT >= t. */
const CU_HON: PointLimitSource = { lowerLimit: "1", upperLimit: "99" };

const LUC_DO = new Date("2026-08-01T10:00:00.000Z");
function snap(changedAt: string, limits: PointLimitSource): PointLimitSnapshot {
  return { changedAt: new Date(changedAt), limits, productPointsConfigVersion: null };
}
function chay(lichSu: PointLimitSnapshot[], lucDo = LUC_DO) {
  return giaiGioiHanTaiLucDo({
    banDo: new Map([[K, 42]]),
    gioiHanSong: new Map([[K, SONG]]),
    lichSu: new Map([[42, lichSu]]),
    lucDo,
  });
}

describe("BG-97 — giaiGioiHanTaiLucDo (THUẦN)", () => {
  it("KHÔNG lượt sửa nào SAU lúc bo được đo ⇒ chấm theo giới hạn ĐANG SỐNG", () => {
    // Đây là nhánh `missing` của `resolveGateLimitsForBoard`. v1.x ánh xạ nó thành "BỎ
    // cổng" vì nó chỉ vào đường snapshot khi bo ĐÃ BIẾT là stale; v2 không có bằng
    // chứng đó, nên `missing` chỉ có nghĩa "chưa ai sửa" ⇒ LIVE **là** giới hạn thời kỳ.
    // ⚠ Nếu ánh xạ sai thành "bỏ cổng", ngày bật cờ 100% linh kiện sẽ mất cổng.
    const r = chay([]);
    expect(r.gioiHan.get(K)).toBe(SONG);
    expect({ snap: r.theoSnapshot, song: r.theoSong }).toEqual({ snap: 0, song: 1 });
  });

  it("chỉ có lượt sửa TRƯỚC lúc bo được đo ⇒ vẫn LIVE (bo đo SAU lượt sửa đó)", () => {
    const r = chay([snap("2026-07-01T00:00:00.000Z", CU_HON)]);
    expect(r.gioiHan.get(K)).toBe(SONG);
    expect(r.theoSong).toBe(1);
  });

  it("★ giới hạn bị SIẾT SAU khi bo được đo ⇒ chấm theo giới hạn LÚC ĐO, KHÔNG hạ oan", () => {
    const r = chay([snap("2026-08-15T00:00:00.000Z", CU)]);
    expect(r.gioiHan.get(K), "phải là giới hạn RỘNG của thời kỳ bo được đo").toEqual(CU);
    expect({ snap: r.theoSnapshot, song: r.theoSong }).toEqual({ snap: 1, song: 0 });
    expect(r.mauSnapshot[0], "log phải nói ra ĐIỂM NÀO được tái dựng").toBe(`${CAP}/${COMP}`);
  });

  it("nhiều lượt sửa sau lúc đo ⇒ lấy bản SỚM NHẤT >= mốc (thời kỳ liền kề bo)", () => {
    const r = chay([
      snap("2026-09-01T00:00:00.000Z", CU_HON),
      snap("2026-08-15T00:00:00.000Z", CU),
    ]);
    expect(r.gioiHan.get(K)).toEqual(CU);
  });

  it("bất biến GIỮ NGUYÊN KÍCH THƯỚC — không khoá nào bị rơi (rơi = đẩy sang rổ `chuaDay`)", () => {
    const k2 = khoaCapComponent("cap-2", "comp-2");
    const r = giaiGioiHanTaiLucDo({
      banDo: new Map([[K, 42], [k2, 43]]),
      gioiHanSong: new Map([[K, SONG], [k2, SONG]]),
      lichSu: new Map([[42, [snap("2026-08-15T00:00:00.000Z", CU)]]]),
      lucDo: LUC_DO,
    });
    expect([...r.gioiHan.keys()].sort()).toEqual([K, k2].sort());
    expect(r.theoSnapshot + r.theoSong).toBe(2);
  });

  it("XÁC ĐỊNH — không đọc đồng hồ: hai lượt gọi cách nhau cho kết quả BẰNG NHAU", async () => {
    // Đây là nền của mệnh đề "WAL phát lại cho CÙNG kết quả": lượt phát lại chạy ở một
    // thời điểm KHÁC, và nếu hàm này đọc `Date.now()` thì nó sẽ chấm theo giới hạn của
    // LÚC PHÁT LẠI — chính lỗ BG-97, chỉ đổi cửa.
    const a = chay([snap("2026-08-15T00:00:00.000Z", CU)]);
    await new Promise((r) => setTimeout(r, 25));
    const b = chay([snap("2026-08-15T00:00:00.000Z", CU)]);
    expect(b.gioiHan.get(K)).toEqual(a.gioiHan.get(K));
    expect(b.theoSnapshot).toBe(a.theoSnapshot);
  });

  it("cờ SPEC_GATE_SNAPSHOT_ENABLED mặc định TẮT — bản vá KHÔNG đổi mặc định nào", () => {
    const truoc = process.env.SPEC_GATE_SNAPSHOT_ENABLED;
    delete process.env.SPEC_GATE_SNAPSHOT_ENABLED;
    try {
      expect(laCongSnapshotBat(), "mặc định phải TẮT, y hệt đường v1.x").toBe(false);
      process.env.SPEC_GATE_SNAPSHOT_ENABLED = "true";
      expect(laCongSnapshotBat()).toBe(true);
    } finally {
      if (truoc === undefined) delete process.env.SPEC_GATE_SNAPSHOT_ENABLED;
      else process.env.SPEC_GATE_SNAPSHOT_ENABLED = truoc;
    }
  });
});

// ⚠ Task 5 (BG-99) — mô tả cũ "BG-97 — mocDoTuChuoi: cùng HỆ QUY CHIẾU với `changedAt`
// (bẫy BG-96)" đã XOÁ khỏi đây: `mocDoTuChuoi` hết caller sản xuất (Task 5 đổi neo sang
// mốc-nhận-server) nên hàm đã bị xoá khỏi `gioiHanLucDoCayV2.ts`. Luật "chuỗi TRẦN = UTC"
// mà nó áp KHÔNG mất đi — di trú nguyên văn thành `docGioMay`
// (`server/utils/factoryTime.ts`), lưới thuần của nó là `server/utils/docGioMay.test.ts`.

describe("BG-97 — CẦU CHÌ: biến thể (doc 55 Item 3) chưa KHOÁ ĐƯỢC ở đường v2", () => {
  /**
   * ⛔ ĐỌC TRƯỚC KHI SỬA CHO XANH LẠI.
   *
   * Brief BG-97 đòi nối **cả** snapshot-gate **lẫn** variant override sang v2. Phép đo
   * BÁC BỎ nửa sau: `variant_point_overrides` chỉ được áp khi **BO** phân giải ra một
   * biến thể KHÁC base, và phép phân giải đó (`resolveIngestVariant`) đọc
   * `input.variantCode` — trường mà hợp đồng v2.0 **KHÔNG CÓ** (cửa ZIP `metaJsonSchema`
   * cũng vậy, vì nó `.extend()` chính hợp đồng này). Cộng thêm: `server/db/cayDay.ts`
   * không ghi `variantId` bao giờ ⇒ point-def cây luôn là điểm BASE. Đo 2026-09-03,
   * vai `avi_app`: hàng CÂY có `variantId` khác NULL = 0/0, `variant_point_overrides`
   * = 0 hàng ở CẢ HAI DB (`aoi_management`, `aoi_management_test`).
   * ⇒ Một nhánh override ở v2 hôm nay là mã **KHÔNG THỂ CHẠY**. Task này CỐ Ý không
   * viết nó (mã chết + lời khai "đã nối" là lớp lỗi dự án đã trả giá bốn lần).
   *
   * Mệnh đề này ĐỎ đúng ngày ai đó thêm trường chọn biến thể vào hợp đồng v2.0. Khi nó
   * đỏ: **đừng xoá nó** — hãy nối override vào `giaiGioiHanTaiLucDo` theo ĐÚNG thứ tự
   * v1.x dùng (`machineApiRouters.ts`: base/snapshot TRƯỚC, patch biến thể SAU CÙNG;
   * `action='exclude'` ⇒ bỏ cổng cho điểm đó), rồi đổi mệnh đề này thành phép đo hành vi.
   */
  it("hợp đồng v2.0 KHÔNG mang trường chọn biến thể ⇒ override không khoá được (nợ, KHÔNG phải mã chết)", () => {
    const truong = Object.keys(machineDataContractV2.shape);
    const nghiNgo = truong.filter((t) => /variant/i.test(t));
    expect(
      nghiNgo,
      "hợp đồng v2.0 vừa mọc trường biến thể — ĐỌC docblock của mệnh đề này rồi NỐI override, đừng xoá lưới",
    ).toEqual([]);
    // Cùng lý lẽ cho `pointsConfigVersion`: thiếu nó thì đường VERSION-EXACT (doc 51 P2,
    // 0282) không khoá được ở v2, nên `giaiGioiHanTaiLucDo` luôn truyền `declaredVersion:
    // null` và chỉ đường INSTANT (P1) chạy. Ngày trường này xuất hiện, phép chọn phải
    // được nâng cấp — đây là chỗ nhắc.
    expect(
      truong.filter((t) => /pointsConfigVersion/i.test(t)),
      "hợp đồng v2.0 vừa mọc pointsConfigVersion — bật đường VERSION-EXACT trong giaiGioiHanTaiLucDo",
    ).toEqual([]);
  });
});
