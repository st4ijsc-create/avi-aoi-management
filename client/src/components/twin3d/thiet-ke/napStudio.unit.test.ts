/**
 * napStudio.unit.test.ts — LƯỚI CHO PH-14 (QA lần 11, ô E3): *"Studio chỉ thiết
 * kế được TẦNG 1 CỦA TOÀ 1 — 88 % máy ngoài tầm với"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖI ĐƯỢC ĐO, KHÔNG PHẢI ĐƯỢC SUY — VÀ ĐÂY LÀ CA DƯƠNG CỦA NÓ
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinStudio.tsx:106` `const toaNhaDau = (toaNhaQ.data ?? [])[0]` và `:125`
 * `const tang = (chiTietQ.data?.tangs ?? [])[0]` — **hai chỉ số `[0]` viết cứng**,
 * và `grep -cE "setToaNha|setTang|chon-toa-nha|chon-tang"` trên tệp đó = **0**.
 *
 * Hậu quả QA đo được trên kịch bản 4 toà × 7 tầng (`.qa-tapdoan/BANG-DE.md` ô 22):
 *   · `dem-toa-nha` in *"Building: **4**"* nhưng màn chỉ có MỘT bộ chọn;
 *   · dải sức khoẻ in *"45 machines placed · **326 awaiting placement**"*;
 *   · 45 = ĐÚNG số máy của `twin_tang` id 81 (toà 1 tầng 1) trong DB
 *     ⇒ con số tự nó chỉ ra màn đang khoá cứng ở phần tử `[0]`.
 *
 * Đây là **cùng một lỗi** mà màn XEM `/twin` đã vá ở Đợt 10 lô F (§11e.6 F1) —
 * xem docblock `van-hanh/boChonNap.ts`. Nên module `napStudio.ts` **TÁI DÙNG**
 * `phanGiaiNap()` của lô F chứ không viết lại luật phân giải: hai bản sao của
 * cùng một luật là hai chỗ để chúng lệch nhau.
 *
 * ★★★ MỖI CA ÂM ĐI KÈM MỘT CA DƯƠNG (bài học `pdca-vong1`: chỉ báo âm tính phải
 *   biết KÊU trên ca dương đã biết). Cụ thể ở đây: mọi ca "chọn được toà/tầng
 *   thứ N" đều kèm phép so với thứ mà bản `[0]` CŨ sẽ trả về, nên một bản vá
 *   giả (vẫn trả `[0]` nhưng đổi tên hàm) không thể làm lưới này xanh.
 *
 * ⚠ Dữ liệu ở đây là GIẢ và cố ý: dữ liệu QATD đã gỡ khỏi DB dev, nên một lưới
 *   dựa vào "DB có nhiều toà" là lưới không chạy lại được. Hình dạng dữ liệu
 *   (`numeric` về từ drizzle là **string**) thì lấy đúng của thật.
 */
import { describe, it, expect } from "vitest";

import {
  giaiNapThietKe,
  mucNhaMayTu,
  mucTangTu,
  mucToaNhaTu,
  type TangTho,
  type ToaNhaTho,
} from "./napStudio";
import { phanGiaiNap } from "../van-hanh/boChonNap";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Dữ liệu giả — hình dạng ĐÚNG như `twinCanh.danhSachToaNha`/`chiTietToaNha`   */
/* trả về: `numeric(14,3)` của drizzle là STRING, không phải number.            */
/* ═══════════════════════════════════════════════════════════════════════════ */

const NHA_MAY = [
  { id: 38, name: "Công ty A", code: "QATD-A" },
  { id: 39, name: "Công ty B", code: "QATD-B" },
];

/** Bốn toà của QATD-A — đúng số toà mà QA đo được ("Building: 4"). */
const TOA_NHA: ToaNhaTho[] = [
  { id: 71, ma: "T1", ten: "Toà 1", rongMm: "60000", sauMm: "40000" },
  { id: 72, ma: "T2", ten: "Toà 2", rongMm: "38400", sauMm: "0" },
  { id: 73, ma: "T3", ten: null, rongMm: 25000, sauMm: 18000 },
  { id: 74, ma: null, ten: null, rongMm: "12000", sauMm: "9000" },
];

/** Bảy tầng của toà đang chọn — đúng chiều sâu kịch bản tập đoàn. */
const TANG: TangTho[] = [
  { id: 81, capSo: 1, ten: "Xưởng 1", anhNenUrl: null, tiLeMmMoiPx: null, daHieuChuan: false },
  { id: 82, capSo: 2, ten: "Xưởng 2", anhNenUrl: "/u/x2.png", tiLeMmMoiPx: "12.5", daHieuChuan: true },
  { id: 83, capSo: 3, ten: null, anhNenUrl: null, tiLeMmMoiPx: null, daHieuChuan: null },
  { id: 84, capSo: 4, ten: "Xưởng 4" },
  { id: 85, capSo: 5, ten: "Xưởng 5" },
  { id: 86, capSo: 6, ten: "Xưởng 6" },
  { id: 87, capSo: 7, ten: "Xưởng 7" },
];

const DU_LIEU = { nhaMay: NHA_MAY, toaNha: TOA_NHA, tang: TANG };
const KHONG_MUON = { nhaMayId: null, toaNhaId: null, tangId: null };

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ① HÀNH VI MẶC ĐỊNH KHÔNG ĐƯỢC ĐỔI — brief đòi "mở ra là toà đầu, tầng đầu"  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("① mặc định — mở màn ra vẫn là toà ĐẦU, tầng ĐẦU (không phá ca đang xanh)", () => {
  it("không yêu cầu gì ⇒ nhà máy đầu / toà đầu / tầng đầu", () => {
    const kq = giaiNapThietKe(KHONG_MUON, DU_LIEU);
    expect(kq.nhaMayId).toBe(38);
    expect(kq.toaNhaId).toBe(71);
    expect(kq.tangId).toBe(81);
  });

  it("hình sàn mặc định lấy của TOÀ ĐẦU, và `tangIdsHoi` đúng một tầng", () => {
    const kq = giaiNapThietKe(KHONG_MUON, DU_LIEU);
    expect(kq.san).toEqual({
      tangId: 81,
      rongMm: 60000,
      sauMm: 40000,
      anhNenUrl: null,
      tiLeMmMoiPx: null,
      daHieuChuan: false,
    });
    // `twinCanh.canhThietKe` nhận `tangIds`. Studio vẽ MỘT tầng ⇒ đúng một id.
    expect(kq.tangIdsHoi).toEqual([81]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ② ★★★ CA DƯƠNG CỦA CHÍNH PH-14 — TOÀ 2..4 VÀ TẦNG 2..7 PHẢI VỚI TỚI ĐƯỢC   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② PH-14 — chọn toà/tầng KHÁC phần tử đầu thì truy vấn cảnh nhận ĐÚNG id đó", () => {
  it("chọn TẦNG THỨ BA (id 83) ⇒ `tangId` = 83 và `tangIdsHoi` = [83], KHÔNG phải [81]", () => {
    const kq = giaiNapThietKe({ nhaMayId: null, toaNhaId: null, tangId: 83 }, DU_LIEU);
    expect(kq.tangId).toBe(83);
    expect(kq.tangIdsHoi).toEqual([83]);
    // ★ Đối chứng với BẢN CŨ: `(tangs ?? [])[0]` cho 81 ở MỌI lượt chọn. Nếu ai
    //   đó "vá" bằng cách đổi tên hàm mà vẫn trả [0], dòng dưới đỏ ngay.
    expect(kq.tangId).not.toBe(TANG[0].id);
  });

  it("chọn TOÀ THỨ HAI (id 72) ⇒ hình sàn lấy của toà 72, KHÔNG của toà 71", () => {
    const kq = giaiNapThietKe({ nhaMayId: null, toaNhaId: 72, tangId: null }, DU_LIEU);
    expect(kq.toaNhaId).toBe(72);
    expect(kq.san?.rongMm).toBe(38400);
    // Toà 71 rộng 60000 — nếu bản vá vẫn đọc `[0]` thì con số này sẽ là 60000.
    expect(kq.san?.rongMm).not.toBe(60000);
  });

  it("★ TOÀ 4 + TẦNG 7 (hai đầu xa nhất của kịch bản QATD) đều với tới được", () => {
    const kq = giaiNapThietKe({ nhaMayId: null, toaNhaId: 74, tangId: 87 }, DU_LIEU);
    expect(kq.toaNhaId).toBe(74);
    expect(kq.tangId).toBe(87);
    expect(kq.tangIdsHoi).toEqual([87]);
    expect(kq.san).toEqual({
      tangId: 87,
      rongMm: 12000,
      sauMm: 9000,
      anhNenUrl: null,
      tiLeMmMoiPx: null,
      daHieuChuan: false,
    });
  });

  it("★★★ MỌI toà × MỌI tầng đều tới được — 4 × 7 = 28 tổ hợp, 0 tổ hợp rơi về [0]", () => {
    // Đây là phép đo BỀ MẶT của PH-14: QA đo 326/371 máy (88 %) ngoài tầm vì
    // 27/28 tổ hợp không có lối vào. Một bản vá chỉ mở được tầng (không mở toà)
    // sẽ xanh ở ca trên mà ĐỎ ở đây.
    const toiDuoc: string[] = [];
    for (const toa of TOA_NHA) {
      for (const tg of TANG) {
        const kq = giaiNapThietKe(
          { nhaMayId: null, toaNhaId: toa.id, tangId: tg.id },
          DU_LIEU,
        );
        if (kq.toaNhaId === toa.id && kq.tangId === tg.id) toiDuoc.push(`${toa.id}/${tg.id}`);
      }
    }
    expect(toiDuoc).toHaveLength(28);
  });

  it("ảnh nền/tỉ lệ đi THEO TẦNG đang chọn, không theo tầng đầu", () => {
    const kq = giaiNapThietKe({ nhaMayId: null, toaNhaId: null, tangId: 82 }, DU_LIEU);
    expect(kq.san?.anhNenUrl).toBe("/u/x2.png");
    // `numeric` về từ drizzle là STRING ⇒ `Number(...)` tường minh là bắt buộc.
    expect(kq.san?.tiLeMmMoiPx).toBe(12.5);
    expect(kq.san?.daHieuChuan).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ③ TÁI DÙNG LUẬT CỦA LÔ F — không viết lại `phanGiaiNap`                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("③ luật phân giải TÁI DÙNG `van-hanh/boChonNap.phanGiaiNap`, không bản sao thứ hai", () => {
  it("id không tồn tại ⇒ rơi về phần tử đầu (KHÔNG im lặng hiện màn trống)", () => {
    const kq = giaiNapThietKe({ nhaMayId: null, toaNhaId: 9999, tangId: 9999 }, DU_LIEU);
    expect(kq.toaNhaId).toBe(71);
    expect(kq.tangId).toBe(81);
  });

  it("★ cùng đầu vào ⇒ cùng kết quả với `phanGiaiNap` gốc (một luật, một chỗ)", () => {
    const muon = { nhaMayId: 39, toaNhaId: 73, tangId: 85 };
    const kq = giaiNapThietKe(muon, DU_LIEU);
    const goc = phanGiaiNap(muon, {
      nhaMay: mucNhaMayTu(NHA_MAY),
      toaNha: mucToaNhaTu(TOA_NHA),
      tang: mucTangTu(TANG),
    });
    expect({ nhaMayId: kq.nhaMayId, toaNhaId: kq.toaNhaId, tangId: kq.tangId }).toEqual(goc);
  });

  it("đổi nhà máy ⇒ toà cũ không còn trong danh sách ⇒ rơi về toà đầu của nhà máy MỚI", () => {
    // Đúng ca người dùng bấm ô "Nhà máy": truy vấn `danhSachToaNha` đổi, id toà
    // đang giữ không thuộc tập mới. Rơi về phần tử đầu là hành vi ĐÚNG, và nó
    // khác `[0]` viết cứng ở chỗ: có một ô chọn để đi chỗ khác.
    const toaNhaMayB: ToaNhaTho[] = [{ id: 90, ma: "B1", ten: "Toà B1", rongMm: "1000", sauMm: "2000" }];
    const kq = giaiNapThietKe(
      { nhaMayId: 39, toaNhaId: 72, tangId: null },
      { nhaMay: NHA_MAY, toaNha: toaNhaMayB, tang: [] },
    );
    expect(kq.nhaMayId).toBe(39);
    expect(kq.toaNhaId).toBe(90);
    expect(kq.tangId).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ④ Ô CHỌN PHẢI CÓ ĐỦ MỤC — nếu danh sách bị cắt thì lỗi `[0]` quay lại bằng  */
/*    một cửa khác                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("④ danh sách cho ba ô chọn — đủ mục, nhãn đọc được", () => {
  it("bốn toà ⇒ ô chọn toà có ĐỦ 4 mục (khớp `dem-toa-nha` = 4 mà QA đo)", () => {
    const kq = giaiNapThietKe(KHONG_MUON, DU_LIEU);
    expect(kq.mucToaNha).toHaveLength(4);
    expect(kq.mucTang).toHaveLength(7);
    expect(kq.mucNhaMay).toHaveLength(2);
  });

  it("nhãn toà: `ten` → `ma` → `#id` (không bao giờ rỗng)", () => {
    expect(mucToaNhaTu(TOA_NHA).map((m) => m.nhan)).toEqual(["Toà 1", "Toà 2", "T3", "#74"]);
  });

  it("nhãn tầng: `ten` → `Tầng <capSo>` → `#id`", () => {
    const nhan = mucTangTu([
      { id: 81, capSo: 1, ten: "Xưởng 1" },
      { id: 83, capSo: 3, ten: null },
      { id: 88, capSo: null, ten: null },
    ]).map((m) => m.nhan);
    expect(nhan).toEqual(["Xưởng 1", "Tầng 3", "#88"]);
  });

  it("nhãn nhà máy: `name` → `code` → `#id`", () => {
    const nhan = mucNhaMayTu([
      { id: 38, name: "Công ty A", code: "QATD-A" },
      { id: 39, name: null, code: "QATD-B" },
      { id: 40 },
    ]).map((m) => m.nhan);
    expect(nhan).toEqual(["Công ty A", "QATD-B", "#40"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ⑤ RỖNG KHÁC 0 — nhà máy chưa có toà nào                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("⑤ chưa có toà/tầng ⇒ `san` là null và KHÔNG hỏi tầng nào", () => {
  it("0 toà ⇒ toaNhaId/tangId null, san null, tangIdsHoi rỗng", () => {
    const kq = giaiNapThietKe(KHONG_MUON, { nhaMay: NHA_MAY, toaNha: [], tang: [] });
    expect(kq.toaNhaId).toBeNull();
    expect(kq.tangId).toBeNull();
    expect(kq.san).toBeNull();
    expect(kq.tangIdsHoi).toEqual([]);
  });

  it("có toà nhưng 0 tầng ⇒ toà chọn được, san vẫn null (không bịa một tầng)", () => {
    const kq = giaiNapThietKe(KHONG_MUON, { nhaMay: NHA_MAY, toaNha: TOA_NHA, tang: [] });
    expect(kq.toaNhaId).toBe(71);
    expect(kq.tangId).toBeNull();
    expect(kq.san).toBeNull();
  });

  it("★ `numeric` STRING không được CỘNG CHUỖI: sauMm '0' ⇒ số 0, không '…0'", () => {
    // Docblock `TwinStudio.tsx:100` cảnh báo đúng ca này: "38400"+"0" = "384000"
    // — không throw, và nhà xưởng to gấp 10 lần.
    const kq = giaiNapThietKe({ nhaMayId: null, toaNhaId: 72, tangId: null }, DU_LIEU);
    expect(kq.san?.sauMm).toBe(0);
    expect(typeof kq.san?.rongMm).toBe("number");
    expect(typeof kq.san?.sauMm).toBe("number");
  });
});
