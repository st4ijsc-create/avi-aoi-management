/**
 * daiCanhBaoDanhTinh.unit.test.ts — Task 8 / PH-30: DÒNG CẢNH BÁO PHẢI MANG
 * DANH TÍNH MÁY VÀ CÔNG TY.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐO ĐƯỢC Ở QA LẦN 11 — KHÔNG PHẢI SUY LUẬN
 * ════════════════════════════════════════════════════════════════════════════
 * `DaiCanhBao.tsx:137` in ĐÚNG MỘT thứ cho mỗi dòng: `{c.tieuDe}`. Hệ quả đo
 * được trên ảnh `.qa-tapdoan/anh/DE-D1-quanly-twin.png`:
 *
 *   · `qatd_quanly`   → "Alarms (15)" và **cả 15 dòng đọc y hệt nhau**;
 *   · `qatd_giamdoc`  → "Alarms (55)" của **ba công ty** trộn làm một, không
 *     phân rã được theo công ty.
 *
 * ⇒ Câu hỏi nghiệp vụ trung tâm của vai giám đốc — *"công ty nào tệ nhất hôm
 *   nay"* — **không có đường nào trả lời** từ dải này; và quản đốc phải bấm
 *   từng dòng mới biết dòng đó nói về máy nào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PHÉP ĐO: ĐẾM SỐ CHUỖI ĐỌC-ĐƯỢC PHÂN BIỆT, KHÔNG ĐẾM SỐ Ô DỮ LIỆU
 * ════════════════════════════════════════════════════════════════════════════
 * Một lưới kiểu `expect(c.maMay).toBeDefined()` sẽ XANH ngay cả khi mọi dòng
 * mang **cùng một** mã máy — tức vẫn đúng y nguyên khuyết tật QA đo được. Nên
 * đại lượng ở đây là {@link dongDocDuoc}: chuỗi mà MẮT NGƯỜI đọc được trên một
 * dòng, rồi đếm `new Set(...).size`. Nó trả lời đúng câu người dùng hỏi —
 * *"mười lăm dòng này có phân biệt được không?"* — nên nó **có thể bác bỏ** bản
 * vá, khác hẳn một phép đếm dẫn xuất từ chính bản vá.
 *
 * ★ Ba bẫy đã đo được ở các task trước, lưới này đóng cả ba:
 *   1. **Tập rỗng tự thoả.** Mọi ca dựng trên dữ kiện nền `dai15()` có ràng
 *      buộc số lượng TƯỜNG MINH (`toHaveLength(15)`) trước khi đo gì khác, và
 *      có ca đối chứng ÂM (`⑤`) chứng minh phép đo BIẾT KÊU.
 *   2. **`null` phải là `null`.** Cảnh báo không gắn máy là tình huống HỢP LỆ
 *      (đo được trên DB dev: `stationId` NULL 7/7 hàng; `machineId` cũng có thể
 *      NULL theo schema `andon.ts:22`). Lưới ghim `toBeNull()` **và** ghim
 *      `not.toBe("")` — hai câu khác nhau, và chuỗi rỗng là cách một bản vá
 *      "điền cho đủ ô" giết chết chính thông tin "chưa biết".
 *   3. **RB-8.3.** `tieuDe` đến từ DB, component KHÔNG `t()` lên nó. Hai ô mới
 *      cũng là DỮ LIỆU (mã máy từ `machines.ma`, tên nhà máy từ `factories.name`)
 *      nên cùng luật: `⑥` đọc `DaiCanhBao.tsx` từ đĩa và ghim rằng không có
 *      `t(` nào bọc hai ô này.
 */
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { docMaNguon } from "@shared/testing/docMaNguon";

import {
  chuanHoaHang,
  gopCanhBao,
  type CanhBaoDai,
  type HangCanhBaoTho,
  type TraDanhTinh,
} from "./daiCanhBaoLogic";

const BAY_GIO = 1_757_000_000_000;
const GIO = 3_600_000;

/**
 * Chuỗi mà MẮT NGƯỜI đọc được trên một dòng của dải.
 *
 * ★ Ba ô nối bằng " · " CHÍNH LÀ thứ `DaiCanhBao.tsx` vẽ (tiêu đề ở dòng trên,
 *   mã máy + tên nhà máy ở dòng phụ). Ô nào `null` thì KHÔNG góp gì — đúng
 *   nghĩa "không biết", chứ không phải một dấu chấm giữa hai khoảng trắng.
 */
function dongDocDuoc(c: CanhBaoDai): string {
  return [c.tieuDe, c.maMay, c.tenNhaMay]
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .join(" · ");
}

/** Một hàng `andon_events` thô như `andon.active` trả về. */
function mauAndon(sua: Partial<HangCanhBaoTho> & { id: number }): HangCanhBaoTho {
  return {
    state: "red",
    status: "raised",
    // ★★★ MỘT tiêu đề cho MỌI hàng — đúng thứ QA lần 11 đo được. Nếu fixture
    //   cho mỗi hàng một tiêu đề khác nhau thì lưới sẽ XANH trước cả khi vá,
    //   và chứng nhận một khuyết tật vẫn còn nguyên.
    title: "Máy dừng ngoài kế hoạch",
    raisedAt: new Date(BAY_GIO - GIO),
    machineId: null,
    lineId: null,
    stationId: null,
    ...sua,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* DỮ KIỆN NỀN — BA CÔNG TY, MƯỜI LĂM MÁY, MỘT TIÊU ĐỀ                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 15 cảnh báo trên 15 máy KHÁC NHAU thuộc BA công ty, phân bố LỆCH (A=8, B=4,
 * C=3) để câu hỏi "công ty nào tệ nhất" có **đúng một** đáp án — phân bố đều
 * sẽ làm ca `④` xanh vì hoà, không vì phép đo đúng.
 */
const PHAN_BO: ReadonlyArray<{ cty: string; ma: string; so: number }> = [
  { cty: "Công ty A", ma: "QATD-A", so: 8 },
  { cty: "Công ty B", ma: "QATD-B", so: 4 },
  { cty: "Công ty C", ma: "QATD-C", so: 3 },
];

interface NenDanhTinh {
  tho: HangCanhBaoTho[];
  tra: TraDanhTinh;
}

function nen(): NenDanhTinh {
  const tho: HangCanhBaoTho[] = [];
  const maTheoMay = new Map<number, string>();
  const tenNhaMayTheoMay = new Map<number, string>();
  let machineId = 4900;
  for (const p of PHAN_BO) {
    for (let i = 1; i <= p.so; i += 1) {
      machineId += 1;
      const ma = `${p.ma}-T1-X1-L1-M${String(i).padStart(2, "0")}`;
      maTheoMay.set(machineId, ma);
      tenNhaMayTheoMay.set(machineId, p.cty);
      tho.push(mauAndon({ id: machineId, machineId }));
    }
  }
  return { tho, tra: { maTheoMay, tenNhaMayTheoMay } };
}

/** Dải 15 dòng ĐÃ chuẩn hoá, có tra cứu danh tính. */
function dai15(): CanhBaoDai[] {
  const { tho, tra } = nen();
  return tho.map((h) => chuanHoaHang(h, BAY_GIO, null, tra));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ① DỮ KIỆN NỀN CÓ THẬT — G5: không ca nào được chạy trên tập rỗng             */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("① dữ kiện nền", () => {
  it("nền có ĐÚNG 15 hàng thô trên 15 máy phân biệt, thuộc 3 công ty", () => {
    const { tho, tra } = nen();
    expect(tho).toHaveLength(15);
    expect(new Set(tho.map((h) => h.machineId)).size).toBe(15);
    expect(tra.maTheoMay?.size).toBe(15);
    expect(new Set([...(tra.tenNhaMayTheoMay?.values() ?? [])]).size).toBe(3);
  });

  it("★★★ MỌI hàng nền mang CÙNG tiêu đề — tái hiện đúng ca QA lần 11 đo được", () => {
    const { tho } = nen();
    expect(tho.length).toBeGreaterThanOrEqual(15);
    expect(new Set(tho.map((h) => h.title)).size).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ② HAI Ô MỚI — CA DƯƠNG                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("② `chuanHoaHang` điền mã máy và tên nhà máy", () => {
  it("★ mỗi dòng cảnh báo mang mã máy để phân biệt được", () => {
    const hang = chuanHoaHang(mauAndon({ id: 1, machineId: 4977 }), BAY_GIO, null, {
      maTheoMay: new Map([[4977, "QATD-C-T1-X1-L1-M05"]]),
      tenNhaMayTheoMay: new Map([[4977, "Công ty C"]]),
    });
    expect(hang.maMay).toBe("QATD-C-T1-X1-L1-M05");
    expect(hang.tenNhaMay).toBe("Công ty C");
  });

  it("★ hai cảnh báo khác máy ⇒ hai dòng phân biệt được BẰNG CHỮ", () => {
    const tra: TraDanhTinh = {
      maTheoMay: new Map([
        [1, "QATD-A-T1-X1-L1-M01"],
        [2, "QATD-A-T1-X1-L1-M02"],
      ]),
      tenNhaMayTheoMay: new Map([
        [1, "Công ty A"],
        [2, "Công ty A"],
      ]),
    };
    const a = chuanHoaHang(mauAndon({ id: 1, machineId: 1 }), BAY_GIO, null, tra);
    const b = chuanHoaHang(mauAndon({ id: 2, machineId: 2 }), BAY_GIO, null, tra);
    // Cùng tiêu đề (dữ kiện nền), nên nếu hai dòng phân biệt được thì CHỈ có
    // thể nhờ hai ô mới — không có đường nào khác.
    expect(a.tieuDe).toBe(b.tieuDe);
    expect(a.maMay).not.toBe(b.maMay);
    expect(dongDocDuoc(a)).not.toBe(dongDocDuoc(b));
  });

  it("★ hai ô mới KHÔNG động vào các ô cũ (`machineId`/`lineId`/`workshopId` giữ nguyên)", () => {
    const hang = chuanHoaHang(
      mauAndon({ id: 41, machineId: 12, lineId: 3, state: "yellow", status: "acknowledged" }),
      BAY_GIO,
      2,
      { maTheoMay: new Map([[12, "QATD-A-T1-X1-L1-M12"]]), tenNhaMayTheoMay: new Map([[12, "Công ty A"]]) },
    );
    expect(hang).toMatchObject({
      idNguon: 41,
      machineId: 12,
      lineId: 3,
      stationId: null,
      workshopId: 2,
      muc: "yellow",
      pha: "acknowledged",
      maMay: "QATD-A-T1-X1-L1-M12",
      tenNhaMay: "Công ty A",
    });
  });

  it("★ `gopCanhBao` giữ nguyên danh tính của bản THẮNG (dedupe không nuốt hai ô mới)", () => {
    const tra: TraDanhTinh = {
      maTheoMay: new Map([[7, "QATD-B-T1-X1-L2-M07"]]),
      tenNhaMayTheoMay: new Map([[7, "Công ty B"]]),
    };
    const tho = mauAndon({ id: 77, machineId: 7 });
    const seed = chuanHoaHang(tho, BAY_GIO, null, tra);
    const song = chuanHoaHang(
      { ...tho, raisedAt: new Date(BAY_GIO - GIO).toISOString(), acknowledgedAt: new Date(BAY_GIO) },
      BAY_GIO,
      null,
      tra,
    );
    const ra = gopCanhBao([seed], [song]);
    expect(ra).toHaveLength(1);
    expect(ra[0].maMay).toBe("QATD-B-T1-X1-L2-M07");
    expect(ra[0].tenNhaMay).toBe("Công ty B");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ③ `null` PHẢI LÀ `null` — BẪY 2                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("③ chưa biết thì nói chưa biết", () => {
  it("★ cảnh báo KHÔNG gắn máy ⇒ hai ô `null`, KHÔNG bịa chuỗi rỗng", () => {
    const hang = chuanHoaHang(mauAndon({ id: 2, machineId: null }), BAY_GIO, null, {
      maTheoMay: new Map(),
      tenNhaMayTheoMay: new Map(),
    });
    expect(hang.maMay).toBeNull();
    expect(hang.tenNhaMay).toBeNull();
    // Hai câu KHÁC NHAU: `""` là một giá trị đã biết và rỗng; `null` là chưa
    // biết. Trộn hai thứ làm dòng phụ hiện ra một dấu " · " trơ trọi.
    expect(hang.maMay).not.toBe("");
    expect(hang.tenNhaMay).not.toBe("");
  });

  it("★★★ máy CÓ id nhưng NGOÀI bản đồ tra cứu ⇒ vẫn `null`, KHÔNG suy mã từ id", () => {
    // Đây là ca thật: `andon.active` trả cảnh báo của MỌI nhà máy trong phạm vi
    // tài khoản (`andonRouter.ts:348-358` — không có `factoryId` trong input),
    // trong khi trang chỉ tải cảnh của MỘT nhà máy. Bịa `"#4977"` hay `"Máy
    // 4977"` ở đây là biến một id nội bộ thành thứ trông như mã máy dán trên vỏ
    // thiết bị — người vận hành sẽ đi tìm một cái máy không tồn tại.
    const hang = chuanHoaHang(mauAndon({ id: 3, machineId: 4977 }), BAY_GIO, null, {
      maTheoMay: new Map([[1, "QATD-A-T1-X1-L1-M01"]]),
      tenNhaMayTheoMay: new Map([[1, "Công ty A"]]),
    });
    expect(hang.machineId).toBe(4977);
    expect(hang.maMay).toBeNull();
    expect(hang.tenNhaMay).toBeNull();
  });

  it("★ KHÔNG truyền bản đồ nào ⇒ hai ô `null` (hợp đồng cũ không vỡ)", () => {
    const hang = chuanHoaHang(mauAndon({ id: 4, machineId: 9 }), BAY_GIO);
    expect(hang.maMay).toBeNull();
    expect(hang.tenNhaMay).toBeNull();
  });

  it("★ giá trị tra cứu TOÀN KHOẢNG TRẮNG ⇒ `null`, không phải `\"   \"`", () => {
    const hang = chuanHoaHang(mauAndon({ id: 5, machineId: 9 }), BAY_GIO, null, {
      maTheoMay: new Map([[9, "   "]]),
      tenNhaMayTheoMay: new Map([[9, ""]]),
    });
    expect(hang.maMay).toBeNull();
    expect(hang.tenNhaMay).toBeNull();
  });

  it("★ giá trị tra cứu có khoảng trắng thừa ⇒ CẮT, giữ nguyên phần chữ", () => {
    const hang = chuanHoaHang(mauAndon({ id: 6, machineId: 9 }), BAY_GIO, null, {
      maTheoMay: new Map([[9, "  QATD-A-T1-X1-L1-M09  "]]),
      tenNhaMayTheoMay: new Map([[9, " Công ty A "]]),
    });
    expect(hang.maMay).toBe("QATD-A-T1-X1-L1-M09");
    expect(hang.tenNhaMay).toBe("Công ty A");
  });

  it("★ chỉ có mã máy, KHÔNG có tên nhà máy ⇒ một ô có, một ô `null` (độc lập)", () => {
    const hang = chuanHoaHang(mauAndon({ id: 7, machineId: 9 }), BAY_GIO, null, {
      maTheoMay: new Map([[9, "QATD-A-T1-X1-L1-M09"]]),
    });
    expect(hang.maMay).toBe("QATD-A-T1-X1-L1-M09");
    expect(hang.tenNhaMay).toBeNull();
    expect(dongDocDuoc(hang)).toBe("Máy dừng ngoài kế hoạch · QATD-A-T1-X1-L1-M09");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ④ KẾT CỤC NGHIỆP VỤ — 15 DÒNG PHÂN BIỆT ĐƯỢC, 3 CÔNG TY PHÂN RÃ ĐƯỢC       */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("④ kết cục người dùng (PH-30)", () => {
  it("★★★ 15 dòng cùng tiêu đề ⇒ SAU VÁ đọc ra 15 chuỗi PHÂN BIỆT", () => {
    const dai = dai15();
    expect(dai).toHaveLength(15);
    // Trước vá: chỉ có `tieuDe` ⇒ đúng 1 chuỗi cho cả 15 dòng (đó là khuyết tật).
    expect(new Set(dai.map((c) => c.tieuDe)).size).toBe(1);
    // Sau vá: 15 chuỗi khác nhau.
    expect(new Set(dai.map(dongDocDuoc)).size).toBe(15);
  });

  it("★★★ giám đốc PHÂN RÃ được theo công ty — 'công ty nào tệ nhất' có ĐÚNG một đáp án", () => {
    const dai = dai15();
    expect(dai).toHaveLength(15);
    const theoCty = new Map<string, number>();
    for (const c of dai) {
      if (c.tenNhaMay === null) continue;
      theoCty.set(c.tenNhaMay, (theoCty.get(c.tenNhaMay) ?? 0) + 1);
    }
    expect(theoCty.size).toBe(3);
    expect([...theoCty.values()].reduce((a, b) => a + b, 0)).toBe(15);
    const xep = [...theoCty.entries()].sort((x, y) => y[1] - x[1]);
    expect(xep[0][0]).toBe("Công ty A");
    // Đáp án phải DUY NHẤT: hoà thì câu hỏi vẫn không trả lời được.
    expect(xep[0][1]).toBeGreaterThan(xep[1][1]);
  });

  it("★ mã máy trên dòng KHỚP đúng máy của dòng đó (không lệch hàng)", () => {
    const { tho, tra } = nen();
    const dai = tho.map((h) => chuanHoaHang(h, BAY_GIO, null, tra));
    expect(dai).toHaveLength(15);
    let khop = 0;
    for (const c of dai) {
      if (c.machineId === null) continue;
      expect(c.maMay).toBe(tra.maTheoMay?.get(c.machineId));
      expect(c.tenNhaMay).toBe(tra.tenNhaMayTheoMay?.get(c.machineId));
      khop += 1;
    }
    // G146 — `for` trên mảng rỗng không khẳng định gì; ghim số vòng đã chạy.
    expect(khop).toBe(15);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ⑤ ĐỐI CHỨNG ÂM — THIẾT BỊ ĐO PHẢI BIẾT KÊU                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("⑤ đối chứng — phép đo biết kêu", () => {
  it("★★★ gỡ hai ô mới ra khỏi cùng dải ⇒ phép đo TỤT VỀ 1 chuỗi (ablation trong lưới)", () => {
    const goc = dai15();
    expect(goc).toHaveLength(15);
    expect(new Set(goc.map(dongDocDuoc)).size).toBe(15);

    // Bản "trước vá" dựng lại bằng tay: cùng dải, chỉ gỡ hai ô danh tính.
    const goPhan = goc.map((c) => ({ ...c, maMay: null, tenNhaMay: null }));
    expect(goPhan).toHaveLength(15);
    expect(new Set(goPhan.map(dongDocDuoc)).size).toBe(1);
  });

  it("★★★ bịa chuỗi rỗng KHÔNG mua được gì — phép đo vẫn kêu", () => {
    // Nếu bản vá "điền cho đủ ô" bằng `""` thay vì `null`, số chuỗi phân biệt
    // vẫn là 1. Lưới này chặn đúng cách vá đó.
    const bia = dai15().map((c) => ({ ...c, maMay: "", tenNhaMay: "" }));
    expect(bia).toHaveLength(15);
    expect(new Set(bia.map(dongDocDuoc)).size).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ⑥ CHỖ HIỂN THỊ — HAI Ô MỚI PHẢI ĐI RA TỚI MÀN, VÀ KHÔNG BỊ DỊCH             */
/* ═══════════════════════════════════════════════════════════════════════════ */

const GOC = resolve(__dirname, "../../../../..");
const DAI = docMaNguon(resolve(GOC, "client/src/components/twin3d/van-hanh/DaiCanhBao.tsx"));
const TRANG = docMaNguon(resolve(GOC, "client/src/pages/TwinVanHanh.tsx"));

describe("⑥ `DaiCanhBao.tsx` in hai ô mới", () => {
  it("★★★ component ĐỌC `c.maMay` và `c.tenNhaMay` — hai ô có mà không vẽ là G16", () => {
    expect(DAI).toContain("c.maMay");
    expect(DAI).toContain("c.tenNhaMay");
  });

  it("★★★ RB-8.3 — KHÔNG `t()` lên hai ô dữ liệu", () => {
    // Mã máy đến từ `machines.ma`, tên nhà máy từ `factories.name`. Chúng là
    // CÂU CỦA DỮ LIỆU, không phải nhãn giao diện; `t()` lên chúng sẽ trả về
    // chính chuỗi đó kèm một cảnh báo i18n, và mở đường cho ai đó "thêm khoá"
    // cho một mã máy.
    expect(DAI).not.toMatch(/t\(\s*c\.maMay/);
    expect(DAI).not.toMatch(/t\(\s*c\.tenNhaMay/);
  });

  it("★ hai ô mới nằm TRONG thân dòng `DongCanhBao`, không ở chỗ khác của tệp", () => {
    // Vẽ chúng ở tiêu đề dải hay ở chip lọc thì vẫn "có mặt trong tệp" mà mỗi
    // dòng vẫn đọc giống nhau y nguyên — đúng lớp lỗi G9 (grep theo tên báo
    // "đã nối" khi mới chỉ có một dòng import).
    const i = DAI.indexOf("function DongCanhBao");
    expect(i).toBeGreaterThan(0);
    const j = DAI.indexOf("export function DaiCanhBao");
    expect(j).toBeGreaterThan(i);
    const than = DAI.slice(i, j);
    expect(than).toContain("c.maMay");
    expect(than).toContain("c.tenNhaMay");
  });
});

/** Cửa sổ văn bản sau mỗi chỗ gọi `chuanHoaHang(` — đủ dài để thấy hết đối số. */
function cuaSoGoiChuanHoa(nguon: string): string[] {
  const ra: string[] = [];
  for (const m of nguon.matchAll(/chuanHoaHang\(/g)) {
    ra.push(nguon.slice(m.index ?? 0, (m.index ?? 0) + 200));
  }
  return ra;
}

describe("⑥b `TwinVanHanh.tsx` TRUYỀN bản đồ tra cứu xuống", () => {
  it("★★★ CẢ HAI đường (seed + socket) đi qua `chuanHoaHang` — vẫn đúng 2 chỗ gọi", () => {
    // Giữ nguyên bất biến của `noiLoD.dom.test.tsx`: một bản chuẩn hoá thứ hai
    // là đường để hai nguồn nói hai thứ tiếng (Date vs chuỗi ISO).
    expect((TRANG.match(/chuanHoaHang\(/g) ?? []).length).toBe(2);
  });

  it("★★★ trang dựng bản đồ `traDanhTinhCanhBao` và đưa vào CẢ HAI chỗ gọi", () => {
    expect(TRANG).toContain("traDanhTinhCanhBao");
    const choGoi = cuaSoGoiChuanHoa(TRANG);
    expect(choGoi).toHaveLength(2);
    for (const c of choGoi) {
      expect(c, `chỗ gọi thiếu bản đồ tra cứu: ${c.slice(0, 80)}`).toContain("traDanhTinhCanhBao");
    }
  });

  it("★ bản đồ mã máy tái dùng `maTheoMay` sẵn có — không dựng nguồn mã thứ hai", () => {
    // `maTheoMay` đã là nguồn mã cho badge 3D (`dungCanhBao3D`). Một bản đồ mã
    // thứ hai là đường để dải 2D và badge 3D gọi cùng một máy bằng hai tên.
    const i = TRANG.indexOf("const traDanhTinhCanhBao");
    expect(i).toBeGreaterThan(0);
    expect(TRANG.slice(i, i + 900)).toContain("maTheoMay");
  });
});
