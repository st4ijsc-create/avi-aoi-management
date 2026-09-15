/**
 * ════════════════════════════════════════════════════════════════════════════
 * `noiThucTheTwin.unit.test.ts` — PH-12 (QA lần 11): **NƠI** của chuyền/máy
 * đang mở, KHÔNG phải phần tử `[0]` của hai danh sách
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── LỖI ĐƯỢC ĐO, KHÔNG ĐƯỢC SUY (`.qa-tapdoan/BANG-C.md`, 17 ca) ────────────
 * `TwinLine.tsx:355` và `TwinMay.tsx:284` viết `factories[0]?.id ?? null`, còn
 * `TwinLine.tsx:375` / `TwinMay.tsx:299` lấy `(toaNhaQ.data ?? [])[0]`. Thứ tự
 * hai danh sách ấy do SERVER quyết định (`hierarchy.ts:340 orderBy(factories.name)`
 * và `twinCanh.ts:260 orderBy(asc(twinToaNha.ma))`) — tức trang hỏi dữ liệu của
 * **nhà máy đứng đầu theo tên** và **toà đứng đầu theo mã**, bất kể chuyền/máy
 * trên URL nằm ở đâu.
 *
 * Ba con số của đợt đo giữ kết luận khỏi lời khai đẹp:
 *   · API `factoryCommand.machineDetail(4977)` — admin và giám đốc: **CÓ DỮ LIỆU**
 *   · Giao diện cùng máy đó — admin và giám đốc: *"không thuộc phạm vi đang xem"*
 *   · Công nhân (quyền HẸP NHẤT, 1 nhà máy) — **mở được** đúng máy ấy
 *   ⇒ quyền, phạm vi tenant và dữ liệu đều bị loại trừ; chỉ còn vị trí `[0]`.
 * Bán kính: 77,4–93,1 % chuyền không vẽ đủ (`.qa-tapdoan/pham-vi-hong.mjs`).
 *
 * ── HAI HẠNG PHÉP ĐO (cùng khuôn `manLineNoiVaoTrang.unit.test.ts`, G93) ────
 * **HẠNG A — đo bằng GIÁ TRỊ** (mục ① ② ③): ba hàm THUẦN ở `noiThucTheTwin.ts`.
 *   Đột biến "trả về phần tử [0]" phải làm ca ĐỎ — đó là ablation của chính bản
 *   vá này, và nó được viết thành ca ⑤ để lần sau không phải làm lại bằng tay.
 * **HẠNG B — đo bằng VĂN BẢN của trang** (mục ④): hai khớp nối nằm trong thân
 *   một component React có `<Canvas>` WebGL — không dựng nổi trong
 *   `environment: "node"`. Hạng B thấp hơn hạng A nhưng là hạng CAO NHẤT có
 *   được ở đó, và nó bắt ĐÚNG lớp đột biến mà 10 đợt QA trước đã để lọt.
 *
 * ⚠ G92 — TƯỚC CHÚ THÍCH TRƯỚC KHI ĐO: docblock của hai trang nhắc nguyên văn
 *   `factories[0]` (trong câu tự khai giới hạn), nên đo trên văn bản còn chú
 *   thích sẽ cho ĐỎ oan ở ca ④.
 * ⚠ G150 — đọc mã bằng `docMaNguon()` (CRLF của checkout không phải dữ kiện).
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

import { chonNoiTheoDatCho, nhaMayDangXem, toaNhaDangXem } from "./noiThucTheTwin";

import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(__dirname, "../../../..");

/** G92 — mã của trang, ĐÃ TƯỚC mọi chú thích. */
function docSach(duongDan: string): string {
  return docMaNguon(resolve(GOC, duongDan))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const LINE = docSach("src/pages/TwinLine.tsx");
const MAY = docSach("src/pages/TwinMay.tsx");

/*
 * Ba nhà máy của kịch bản tập đoàn, ĐÚNG thứ tự server trả (theo `name`):
 * 38 "Công ty A" · 39 "Công ty B" · 40 "Công ty C".
 */
const NHA_MAY = [
  { id: 38, name: "Công ty A", code: "QATD-A" },
  { id: 39, name: "Công ty B", code: "QATD-B" },
  { id: 40, name: "Công ty C", code: "QATD-C" },
] as const;

/** Bốn toà của QATD-C, ĐÚNG thứ tự server trả (theo `ma`): T1 < T2 < T3 < T4. */
const TOA_NHA = [
  { id: 61, ma: "T1", rongMm: 60000, sauMm: 40000 },
  { id: 62, ma: "T2", rongMm: 50000, sauMm: 30000 },
  { id: 63, ma: "T3", rongMm: 70000, sauMm: 45000 },
  { id: 64, ma: "T4", rongMm: 55000, sauMm: 35000 },
] as const;

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① HẠNG A — `nhaMayDangXem`: nhà máy CỦA THỰC THỂ, không phải `factories[0]`  */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ① `nhaMayDangXem` — id nhà máy đến TỪ chuyền/máy đang mở", () => {
  it("★★★ C1.1 — chuyền 249 thuộc QATD-B (39) ⇒ 39, KHÔNG phải 38 = `factories[0]`", () => {
    /*
     * Ca SAI của bảng C: vai `qatd_kythuat` có A+B; `factory.list[0]` = 38
     * "Công ty A". Chuyền 249 ở nhà máy 39 ⇒ trang cũ hỏi `canhThietKe(38)`
     * ⇒ `Máy 0 · Trạm 0`, 0 canvas. Con số 39 ở đây KHÔNG được bằng `NHA_MAY[0].id`.
     */
    expect(nhaMayDangXem({ factoryId: 39, toaNhaId: 57, tangId: 109 })).toBe(39);
    expect(nhaMayDangXem({ factoryId: 39, toaNhaId: 57, tangId: 109 })).not.toBe(NHA_MAY[0].id);
  });

  it("★ C1.2/C2.3 đối chứng DƯƠNG — thực thể Ở nhà máy đầu vẫn ra đúng nhà máy đầu", () => {
    // Chống "vá quá tay": bản vá không được làm hỏng ca đang ĐẠT (chuyền 217, máy 4197).
    expect(nhaMayDangXem({ factoryId: 38, toaNhaId: 57, tangId: 109 })).toBe(38);
  });

  it("★★★ ĐỐI CHỨNG ÂM — ngoài phạm vi (`null`/`undefined`) ⇒ `null`, KHÔNG rơi về nhà máy nào", () => {
    /*
     * ★★★ ĐÂY LÀ CA QUAN TRỌNG NHẤT CỦA TỆP. Server trả `NOT_FOUND` cho chuyền/máy
     *   ngoài phạm vi được gán (C4a/C4b/C4c: 7/7 lời gọi đều NOT_FOUND/[]/null).
     *   Nếu hàm này "đỡ" cái `null` ấy bằng một nhà máy mặc định thì bản vá đã
     *   PHÁ HÀNG RÀO TENANT — nặng hơn hẳn lỗi đang vá.
     */
    expect(nhaMayDangXem(null)).toBeNull();
    expect(nhaMayDangXem(undefined)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② HẠNG A — `toaNhaDangXem`: toà CHỨA thực thể, không phải `toaNha[0]`        */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② `toaNhaDangXem` — toà CHỨA chuyền/máy, không phải toà mã nhỏ nhất", () => {
  it("★★★ C1.4/C2.4 — thực thể ở toà T3 (63) ⇒ trả T3, KHÔNG phải T1 = `toaNha[0]`", () => {
    /*
     * Chuyền 299 ("Máy 10 · Trạm 10" mà cảnh 0 khối) và máy 5139 ("chưa có chỗ
     * trên bố cục" trong khi DB CÓ đúng 1 hàng `twin_dat_cho`) đều nằm ở toà 3.
     */
    const t = toaNhaDangXem(TOA_NHA, { factoryId: 40, toaNhaId: 63, tangId: 151 });
    expect(t?.id).toBe(63);
    expect(t?.id).not.toBe(TOA_NHA[0].id);
    // Kích thước sàn đi theo ĐÚNG toà ấy — `sanRongM`/`sanSauM` của trang đọc hai ô này.
    expect([t?.rongMm, t?.sauMm]).toEqual([70000, 45000]);
  });

  it("★ C1.3/C2.2 đối chứng DƯƠNG — thực thể Ở toà đầu vẫn ra toà đầu", () => {
    expect(toaNhaDangXem(TOA_NHA, { factoryId: 40, toaNhaId: 61, tangId: 137 })?.id).toBe(61);
  });

  it("★★★ ĐỐI CHỨNG ÂM — ngoài phạm vi (`noi = null`) ⇒ `null`, KHÔNG phải toà đầu", () => {
    expect(toaNhaDangXem(TOA_NHA, null)).toBeNull();
    expect(toaNhaDangXem(TOA_NHA, undefined)).toBeNull();
  });

  it("★★★ CHƯA XẾP CHỖ (`toaNhaId = null`) ⇒ `null` — màn nói 'chưa có chỗ' THẬT", () => {
    /*
     * Một máy có thật, trong phạm vi, nhưng chưa có hàng `twin_dat_cho`: câu
     * "Máy này chưa có chỗ trên bố cục 3D" khi ấy ĐÚNG. Rơi về toà [0] ở đây sẽ
     * vẽ nó giữa hàng xóm của một toà khác — sai còn tệ hơn.
     */
    expect(toaNhaDangXem(TOA_NHA, { factoryId: 40, toaNhaId: null, tangId: null })).toBeNull();
  });

  it("★★★ toà KHÔNG có trong danh sách (đã xoá mềm / ngoài phạm vi) ⇒ `null`, KHÔNG âm thầm đổi toà", () => {
    expect(toaNhaDangXem(TOA_NHA, { factoryId: 40, toaNhaId: 9999, tangId: 1 })).toBeNull();
  });

  it("★ danh sách rỗng / chưa tải ⇒ `null` (không ném)", () => {
    expect(toaNhaDangXem([], { factoryId: 40, toaNhaId: 63, tangId: 151 })).toBeNull();
    expect(toaNhaDangXem(undefined, { factoryId: 40, toaNhaId: 63, tangId: 151 })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ HẠNG A — `chonNoiTheoDatCho`: toà/tầng suy từ HÀNG ĐẶT CHỖ CÓ THẬT        */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ③ `chonNoiTheoDatCho` — server suy toà/tầng từ `twin_dat_cho`, không đoán", () => {
  it("một máy, một hàng đặt chỗ ⇒ đúng toà/tầng của hàng ấy (C2.4, máy 5139)", () => {
    expect(chonNoiTheoDatCho([{ tangId: 151, toaNhaId: 63 }])).toEqual({ toaNhaId: 63, tangId: 151 });
  });

  it("★★★ chuyền trải nhiều hàng ⇒ toà GIỮ ĐA SỐ thắng, không phải hàng đầu tiên", () => {
    /*
     * Một chuyền có thể có vài hàng đặt chỗ lạc (trạm cũ chưa dọn). Lấy hàng đầu
     * tiên là để thứ tự trả về của CSDL quyết định cảnh vẽ ở đâu — đúng lớp lỗi
     * `[0]` mà tệp này đang vá, chỉ đổi chỗ.
     */
    const hang = [
      { tangId: 109, toaNhaId: 57 },
      { tangId: 151, toaNhaId: 63 },
      { tangId: 151, toaNhaId: 63 },
      { tangId: 152, toaNhaId: 63 },
    ];
    expect(chonNoiTheoDatCho(hang)).toEqual({ toaNhaId: 63, tangId: 151 });
  });

  it("★ hoà phiếu ⇒ TẤT ĐỊNH theo id nhỏ nhất (không phụ thuộc thứ tự CSDL trả)", () => {
    const a = [{ tangId: 151, toaNhaId: 63 }, { tangId: 109, toaNhaId: 57 }];
    const b = [{ tangId: 109, toaNhaId: 57 }, { tangId: 151, toaNhaId: 63 }];
    expect(chonNoiTheoDatCho(a)).toEqual(chonNoiTheoDatCho(b));
    expect(chonNoiTheoDatCho(a)).toEqual({ toaNhaId: 57, tangId: 109 });
  });

  it("★★★ 0 hàng đặt chỗ ⇒ `null` — 'chưa xếp chỗ' KHÁC 'xếp ở toà đầu'", () => {
    expect(chonNoiTheoDatCho([])).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ HẠNG B — HAI TRANG THẬT SỰ ĐI ĐƯỜNG MỚI                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ④ `TwinLine.tsx` và `TwinMay.tsx` không còn hỏi `[0]` của hai danh sách", () => {
  it.each([
    ["TwinLine.tsx", () => LINE],
    ["TwinMay.tsx", () => MAY],
  ])("%s — KHÔNG còn `factories[0]`, `factoryId` đi qua `nhaMayDangXem`", (_ten, lay) => {
    const ma = lay();
    /*
     * ★★★ ĐỘT BIẾN GỐC (PH-12): `const factoryId = factories[0]?.id ?? null;`.
     *   Đây là chính tả của lỗi, và nó sống sót 10 đợt QA vì mọi lưới khác đo
     *   cảnh vẽ trên một CSDL chỉ có 1 nhà máy có bố cục.
     */
    expect(ma).not.toMatch(/factories\[0\]/);
    expect(ma).toMatch(/const factoryId = nhaMayDangXem\(noiQ\.data\);/);
  });

  it.each([
    ["TwinLine.tsx", () => LINE],
    ["TwinMay.tsx", () => MAY],
  ])("%s — toà nhà đi qua `toaNhaDangXem`, không phải `[0]` của `toaNhaQ.data`", (_ten, lay) => {
    const ma = lay();
    expect(ma).toMatch(/toaNhaDangXem\(/);
    // ★ Đột biến: `…)[0] ?? null` trên mảng toà nhà — chính tả của triệu chứng 2.
    expect(ma).not.toMatch(/toaNhaQ\.data \?\? \[\]\)[\s\S]{0,200}?\)\[0\]/);
  });

  it.each([
    ["TwinLine.tsx", () => LINE],
    ["TwinMay.tsx", () => MAY],
  ])("%s — hỏi `twinCanh.noiCuaThucThe` với id CỦA MÀN, không với một hằng", (_ten, lay) => {
    const ma = lay();
    expect(ma).toMatch(/trpc\.twinCanh\.noiCuaThucThe\.useQuery\(/);
    // `loai` phải khớp màn, `id` phải là biến của màn (không phải số viết cứng).
    expect(ma).toMatch(/\{ loai: "(line|may)", id: (lineId|machineId) \}/);
  });

  it.each([
    ["TwinLine.tsx", () => LINE],
    ["TwinMay.tsx", () => MAY],
  ])("%s — `dangTai` gồm cả `noiQ` (chuỗi suy nơi đứng TRƯỚC mọi truy vấn khác)", (_ten, lay) => {
    const ma = lay();
    const i = ma.indexOf("const dangTai =");
    expect(i).toBeGreaterThan(-1);
    const than = ma.slice(i, ma.indexOf(";", i));
    /*
     * ★ Thiếu ô này thì trong lúc `noiCuaThucThe` còn chạy, `factoryId` là `null`
     *   ⇒ mọi truy vấn nền TẮT ⇒ `dangTai` false ⇒ màn khai "ngoài phạm vi" một
     *   nhịp về một máy hợp lệ (đúng lớp NT-3.5 mà Đợt 34 đã trả giá).
     */
    expect(than).toContain("noiQ.isLoading");
  });

  it("★★★ ĐỐI CHỨNG ÂM Ở TRANG — `retry: false` để `NOT_FOUND` là kết cục CUỐI, không chờ mãi", () => {
    for (const ma of [LINE, MAY]) {
      const i = ma.indexOf("trpc.twinCanh.noiCuaThucThe.useQuery(");
      expect(i).toBeGreaterThan(-1);
      expect(ma.slice(i, i + 220)).toContain("retry: false");
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑤ ABLATION VIẾT SẴN — đột biến `[0]` phải ĐỎ                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑤ Ablation — hai bản cài ĐẶT SAI (phần tử `[0]`) cho kết quả KHÁC bản vá", () => {
  /*
   * Một bản vá không kèm ablation chỉ là lời khai (G139). Hai hàm dưới đây là
   * NGUYÊN VĂN mã cũ; ca này chứng minh phép đo ở ① và ② THẬT SỰ phân biệt được
   * chúng với bản vá — tức nếu ai đó hoàn nguyên, lưới sẽ KÊU.
   */
  const nhaMayCu = (ds: readonly { id: number }[]) => ds[0]?.id ?? null;
  const toaNhaCu = <T,>(ds: readonly T[]) => ds[0] ?? null;

  it("★★★ `factories[0]` cho 38 trong khi chuyền 249 ở nhà máy 39", () => {
    expect(nhaMayCu(NHA_MAY)).toBe(38);
    expect(nhaMayDangXem({ factoryId: 39, toaNhaId: 57, tangId: 109 })).toBe(39);
    expect(nhaMayCu(NHA_MAY)).not.toBe(nhaMayDangXem({ factoryId: 39, toaNhaId: 57, tangId: 109 }));
  });

  it("★★★ `toaNha[0]` cho T1 (61) trong khi máy 5139 ở T3 (63)", () => {
    expect(toaNhaCu(TOA_NHA)?.id).toBe(61);
    expect(toaNhaDangXem(TOA_NHA, { factoryId: 40, toaNhaId: 63, tangId: 151 })?.id).toBe(63);
  });

  it("★★★ và `[0]` KHÔNG BAO GIỜ trả `null` cho ca ngoài phạm vi — chỗ hàng rào tenant vỡ theo chiều ngược", () => {
    // Bản cũ luôn đưa ra MỘT nhà máy, kể cả khi server đã nói "không thấy".
    expect(nhaMayCu(NHA_MAY)).not.toBeNull();
    expect(nhaMayDangXem(null)).toBeNull();
  });
});
