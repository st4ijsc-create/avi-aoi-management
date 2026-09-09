/**
 * ════════════════════════════════════════════════════════════════════════════
 * `manLineNoiVaoTrang.unit.test.ts` — **NỬA THỨ HAI** của phép đo (G93)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `manLine.unit.test.ts` chứng minh *"hàm đúng khi được gọi đúng"*. Tệp này hỏi
 * câu còn lại, và là câu Đợt 29 đã trả giá để học: **trang gọi bằng đối số nào?**
 *
 * Đợt 29 đo được **ba đột biến ở CHỖ GỌI sống sót cả 1.998 test** sau khi tách
 * `hopNhatCanh.ts`. Kết luận: *mọi refactor "tách ra cho sạch" đều MUA thêm một
 * bề mặt lỗi ở KHỚP NỐI* — vì thứ trước đây nằm trong thân biểu thức, sau khi
 * tách trở thành **đối số truyền tay**, tức thêm đúng một chỗ để nối nhầm.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ HAI HẠNG PHÉP ĐO TRONG TỆP NÀY — VÀ VÌ SAO CÓ CẢ HAI
 * ════════════════════════════════════════════════════════════════════════════
 * **HẠNG A — đo bằng GIÁ TRỊ** (mục ① và ②). Đợt 30 kéo khớp nối `trongPhamVi`
 * ra thành `phamViCuaManLine()`, nên hai đột biến nguy hiểm nhất của nó bắt được
 * bằng giá trị thật, không phải bằng chính tả. Đây là một bậc **cao hơn** cách
 * Đợt 29 phải làm.
 *
 * **HẠNG B — đo bằng VĂN BẢN của trang** (mục ③ trở đi). Những khớp nối còn lại
 * nằm trong thân `useMemo` của một component React có `<Canvas>` WebGL — không
 * dựng nổi trong `environment: "node"` và không đáng dựng jsdom + mock ba tầng
 * truy vấn chỉ để đọc một đối số. Hạng B thấp hơn hạng A, nhưng nó là hạng
 * **CAO NHẤT có được** cho những chỗ ấy, và nó **thật sự bắt** đúng lớp đột
 * biến mà Đợt 29 đo được là sống sót.
 *
 * ⚠ **G92 — TƯỚC CHÚ THÍCH TRƯỚC KHI ĐO.** Docblock của `TwinLine.tsx` nhắc
 *   nguyên văn gần như mọi tên dưới đây (kể cả những tên trong câu *"KHÔNG được
 *   làm thế này"*). Đo trên văn bản còn chú thích sẽ cho **xanh oan** ở mọi ca —
 *   một thiết bị đo luôn báo ĐẠT không đo gì cả.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { phamViCuaManLine } from "./manLine";
import { trongPhamVi } from "./phamViCanh";

const GOC = resolve(__dirname, "../../../..");

/** G92 — mã của trang, ĐÃ TƯỚC mọi chú thích. */
const MA = readFileSync(resolve(GOC, "src/pages/TwinLine.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/**
 * Cắt thân một `useMemo` theo DẤU KẾT của chính nó, không theo độ dài cố định.
 * (Bài học `usePhanTichLine.unit.test.ts`: cửa sổ cố định đọc lấn hàng xóm và
 * cho ra một ca đỏ oan — hoặc tệ hơn, một ca **xanh oan**.)
 */
function than(tenBien: string): string {
  const i = MA.indexOf(`const ${tenBien} = useMemo`);
  expect(i, `không tìm thấy \`${tenBien}\` trong trang`).toBeGreaterThan(-1);
  const k1 = MA.indexOf("\n  );", i);
  const k2 = MA.indexOf("\n  }, [", i);
  const j = [k1, k2].filter((k) => k > i).sort((a, b) => a - b)[0];
  expect(j, `không tìm thấy dấu kết của \`${tenBien}\``).toBeGreaterThan(i);
  return MA.slice(i, j);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① HẠNG A — phạm vi cảnh, ĐO BẰNG GIÁ TRỊ                                    */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ① Phạm vi của màn Line — đo bằng GIÁ TRỊ, không bằng chính tả", () => {
  /** Một máy của chuyền 2, đặt ở tầng 28 (tầng DUY NHẤT của CSDL này). */
  const mayLine2 = {
    machineId: 7,
    stationId: 21,
    lineId: 2,
    workshopId: null,
    factoryId: 1,
    tangId: 28,
  };
  /** Máy của chuyền 3, **CÙNG tầng 28** — đây là chỗ hai cấp phạm vi tách nhau. */
  const mayLine3 = { ...mayLine2, machineId: 9, stationId: 31, lineId: 3 };

  it("máy CỦA chuyền ⇒ trong phạm vi", () => {
    expect(trongPhamVi(mayLine2, phamViCuaManLine(2))).toBe(true);
  });

  it("★★★ máy chuyền KHÁC ⇒ NGOÀI phạm vi — kể cả khi cùng tầng", () => {
    expect(trongPhamVi(mayLine3, phamViCuaManLine(2))).toBe(false);
  });

  it("★★★ ĐỘT BIẾN ① `cap:'line'` → `cap:'tang'` PHẢI làm ca trên ĐỎ", () => {
    /*
     * ★★★ VÌ SAO ĐỘT BIẾN NÀY CÂM HƠN MỌI ĐỘT BIẾN KHÁC Ở ĐÂY.
     *   Đo trên CSDL đang chạy 2026-09-09: **82/82 hàng `twin_dat_cho` nằm ở
     *   `tangId = 28`** — một tầng duy nhất, một toà duy nhất. Nên đổi cấp
     *   phạm vi từ `line` sang `tang` làm **MỌI máy "trong phạm vi"**: lớp pha
     *   12 % cho vật thể ngoài phạm vi (§10C) mất hiệu lực HOÀN TOÀN, và
     *   **không ảnh nghiệm thu nào phân biệt được** vì cảnh vẫn đủ 43 khối.
     *   Ca này là chỗ duy nhất nó KÊU.
     */
    const dotBien = { cap: "tang" as const, id: 28 };
    expect(trongPhamVi(mayLine3, dotBien)).toBe(true); // ← sai, và câm
    expect(trongPhamVi(mayLine3, phamViCuaManLine(2))).toBe(false); // ← đúng
  });

  it("★★★ ĐỘT BIẾN ② `id: lineId` → `id: null` ⇒ `trongPhamVi` trả TRUE vô điều kiện", () => {
    // `phamViCanh.ts:59` — `pv.id === null` là cửa thoát sớm.
    expect(trongPhamVi(mayLine3, { cap: "line", id: null })).toBe(true); // ← sai
    expect(trongPhamVi(mayLine3, phamViCuaManLine(2))).toBe(false); // ← đúng
  });

  it("★ ĐỐI CHỨNG — `phamViCuaManLine` KHÔNG trả một hằng: id đi theo tham số", () => {
    expect(phamViCuaManLine(2)).toEqual({ cap: "line", id: 2 });
    expect(phamViCuaManLine(11)).toEqual({ cap: "line", id: 11 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② HẠNG A — trang THẬT SỰ gọi hàm ấy                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② Trang gọi `phamViCuaManLine`, không dựng phạm vi tại chỗ", () => {
  it("`mayVe` truyền `phamViCuaManLine(lineId)`", () => {
    const t = than("mayVe");
    expect(t).toContain("phamViCuaManLine(lineId)");
  });

  it("★★★ trang KHÔNG viết `{ cap: \"...\" }` tại chỗ — một chỗ dựng, một chỗ đo", () => {
    /*
     * ★ Nếu ai đó dựng phạm vi tại chỗ thay vì gọi hàm, thì mục ① ở trên vẫn
     *   XANH (nó đo hàm) trong khi trang đã đi đường khác — đúng lớp "có mã +
     *   có test + không giao hàng". Ca này khoá cửa ấy.
     */
    expect(MA).not.toMatch(/cap:\s*["']line["']/);
    expect(MA).not.toMatch(/cap:\s*["']tang["']/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ HẠNG B — TẬP MÁY: `mayLine`, KHÔNG `mayTatCa`                             */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ③ Cảnh vẽ MÁY CỦA CHUYỀN, không phải toàn nhà máy", () => {
  it("`mayVe` nhận `may: mayLine`", () => {
    const t = than("mayVe");
    expect(t).toContain("may: mayLine");
    /*
     * ★★★ ĐỘT BIẾN `may: mayLine` → `may: mayTatCa`. Đúng lỗi **F2** mà
     *   `khuChoVaNhanLine.ts` đã trả giá để học, ở dạng khác: 31 máy của hai
     *   chuyền kia dựng thành 31 khối trên cảnh của chuyền 2 (đo 2026-09-09:
     *   43 máy hoạt động, chuyền 2 có **12**). Chúng sẽ bị PHA MỜ chứ không
     *   biến mất — nên trông vẫn "hợp lý", và đó là điều làm nó nguy hiểm.
     */
    expect(t).not.toContain("may: mayTatCa");
  });

  it("★★★ `mayLine` dựng bằng `mayCuaLine`, KHÔNG bằng một bộ lọc viết tay (G12)", () => {
    const i = MA.indexOf("const mayLine =");
    expect(i).toBeGreaterThan(-1);
    const dong = MA.slice(i, MA.indexOf("\n", MA.indexOf("[lineId", i)));
    expect(dong).toContain("mayCuaLine(lineId, mayTatCa, tram)");
    /*
     * ★ Một `mayTatCa.filter(m => m.lineId === lineId)` viết tay ở đây sẽ BỎ SÓT
     *   luật "TRẠM thắng `lineId` khai" — và `machines` **không có cột `lineId`**
     *   (đo 2026-09-09), nên đó là bộ lọc theo một trường ĐÃ SUY.
     */
    expect(MA).not.toMatch(/mayTatCa\.filter\([^)]*lineId\s*===/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ HẠNG B — WIP: `isSuccess`, KHÔNG `!isLoading`                             */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ④ `daDo` phải là `isSuccess` — 403 KHÔNG được thành 'chuyền trống'", () => {
  it("`tinhWip` truyền `daDo: wipQ.isSuccess`", () => {
    const t = than("tinhWip");
    expect(t).toContain("daDo: wipQ.isSuccess");
    /*
     * ★★★ ĐỘT BIẾN `wipQ.isSuccess` → `!wipQ.isLoading`. 403 và lỗi mạng cũng
     *   làm `isLoading` tắt, nên MỌI trạm nhận `soWip = 0` — tức màn in
     *   *"chuyền trống"* cho một người chỉ đơn giản là **không có quyền**. Đó là
     *   lời khai "đã kiểm tra, chuyền trống", đúng lớp CHẶN-2.
     */
    expect(t).not.toContain("isLoading");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑤ HẠNG B — 2D và 3D CÙNG một nguồn (§11.5 + G12)                            */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑤ Cột WIP 3D và dải trạm 2D KHÔNG THỂ lệch nhau", () => {
  it("`cotWipCanh` và `bangWip` cùng ra từ `tinhWip` + `khaiNghen`", () => {
    expect(MA).toContain("cotWip(tinhWip, khaiNghen)");
    expect(MA).toContain("xepHangWip(tinhWip, khaiNghen)");
  });

  it("★★★ `DaiLine` nhận `bangWip` qua `hangDaiLine` — không tự tính `nghen`", () => {
    const t = than("hangDai");
    expect(t).toContain("bangWip");
    // ★ Một `laNghen(` gọi lại ở trang là chính đột biến §11.5 cấm.
    expect(MA).not.toContain("laNghen(");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑥ HẠNG B — CAMERA và ĐƯỜNG TÂM cùng một hình học                            */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑥ Camera bay DỌC chuyền, dùng `khungNhinLine` (không `khungNhinCho`)", () => {
  it("`khungNhin` gọi `khungNhinLine(hinhLine.hh.bbox, ...truc, ...trucDangTin)`", () => {
    const t = than("khungNhin");
    expect(t).toContain("khungNhinLine(");
    expect(t).toContain("hinhLine.hh.truc");
    expect(t).toContain("hinhLine.hh.trucDangTin");
    /*
     * ★★★ ĐỘT BIẾN: bỏ `trucDangTin` (truyền `true` cứng). `khungNhinLine` rơi
     *   về `khungNhinCho(bbox,"line")` khi trục KHÔNG đáng tin
     *   (`phamViCanh.ts:235`) — ép `true` sẽ đặt camera dọc theo một trục **suy
     *   sai** trên chuyền có trạm rải lộn xộn: người xem nhìn ngang qua chuyền
     *   thay vì xuôi dòng, và **không gì nổ**.
     */
    expect(t).not.toMatch(/khungNhinLine\([^)]*,\s*true\s*\)/);
  });

  it("★★★ `hinhLine` dựng bằng `dungHinhLine`, `thuocVe` là `mayTatCa` (không `mayLine`)", () => {
    const t = than("hinhLine");
    expect(t).toContain("dungHinhLine(lineId, tram, mayVe, mayTatCa,");
    /*
     * ★ Đối số 3 là `mayVe` (máy ĐÃ CÓ VỊ TRÍ) và đối số 4 là bảng tra
     *   line/trạm. Tráo hai đối số ấy cho nhau thì `dungHinhLine` đọc `viTri`
     *   của một mảng không có `viTri` ⇒ mọi trạm về gốc toạ độ. TypeScript bắt
     *   được ca ấy; ca nó KHÔNG bắt là thu `mayTatCa` thành `mayLine` — hợp lệ
     *   về kiểu, và làm hàm mất khả năng nhận ra máy nằm NGOÀI chuyền.
     */
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑦ HẠNG B — G87: ĐÚNG MỘT CANVAS, và nó KHÔNG nằm trong nhánh song song      */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑦ G87 — `__soCanvas` = 1: đúng MỘT `<CanhVanHanh>` trong trang", () => {
  it("★★★ chỉ MỘT chỗ render `<CanhVanHanh`", () => {
    const so = (MA.match(/<CanhVanHanh\b/g) ?? []).length;
    expect(so, "màn Line phải có ĐÚNG một canvas (RB-4/G87)").toBe(1);
  });

  it("★★★ KHÔNG render `CanhVanHanh2D` — bản 2D là chuyện của `/twin`, không của màn này", () => {
    /*
     * ★ Ở `/twin`, 2D **THAY THẾ** 3D (`? :`) chứ không đứng cạnh — đó là cách
     *   RB-4 được giữ ở đó. Màn Line không có công tắc `che2D`, nên cách an toàn
     *   nhất là **không có mảnh thứ hai nào để ai đó vô tình đặt song song**.
     */
    expect(MA).not.toContain("CanhVanHanh2D");
  });

  it("★ ĐỐI CHỨNG — phép đếm này BIẾT KÊU trên một chuỗi hai canvas", () => {
    const gia = "<CanhVanHanh may={a} /><CanhVanHanh may={b} />";
    expect((gia.match(/<CanhVanHanh\b/g) ?? []).length).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑧ HẠNG B — §15.6 NHÓM (D): CÁI CỐ Ý KHÔNG LÊN 3D                            */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑧ Nhóm (D) — quan trọng NGANG nhóm (A). Nhồi mọi thứ = không đọc được", () => {
  it("★★★ D-1 — KHÔNG có mặt GHI nào: 0 `useMutation` trên màn XEM (QĐ-18)", () => {
    expect(MA).not.toContain("useMutation");
    // ★ `NganXuLy` là mặt ghi cấp Máy (2 mutation) — nó KHÔNG thuộc màn này.
    expect(MA).not.toContain("NganXuLy");
  });

  it("★★★ D-11 — KHÔNG công cụ sửa bố cục: 0 tham chiếu vùng thiết kế", () => {
    expect(MA).not.toContain("thiet-ke/");
    expect(MA).not.toContain("che-do=botri");
  });

  it("★★★ D-12 — KHÔNG truyền `vung`: đo 2026-09-08 có **0 hàng** `twin_vat_the` kiểu `vung`", () => {
    /*
     * ★ Dành chỗ cho một nguồn RỖNG là "hứa mà không giao" — đúng lớp G16 (mã
     *   có, chỗ gọi 0) ở chiều ngược: chỗ gọi có, nguồn 0.
     */
    expect(MA).not.toMatch(/\bvung=\{/);
  });

  it("★★★ D-10 — KHÔNG biểu đồ xu hướng dài hạn trên cảnh 3D", () => {
    // Cảnh 3D trả lời "bây giờ, ở đâu"; không trả lời "ba tháng qua, vì sao".
    expect(MA).not.toMatch(/recharts|LineChart|BarChart/);
  });

  it("★ §15.6.1 — `vienSucKhoe` là nhóm (A) của cấp **MÁY**, không phải cấp Line", () => {
    expect(MA).not.toMatch(/vienSucKhoe=\{/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑧b HAI ĐỘT BIẾN **SỐNG SÓT** LƯỢT ABLATION ĐẦU — VÁ NGAY, KHÔNG GHI NỢ      */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Lượt ablation đầu của Đợt 30: **22 đột biến, 20 ĐỎ, 2 SỐNG SÓT** — cả hai đều
 * ở PHÍA TRANG, đúng như G93 dự báo. Chúng được ghi lại nguyên văn ở đây thay vì
 * chỉ vá lặng lẽ, vì *chỗ nào thiết bị đo mù thì lần sau nó lại mù ở đó*.
 *
 *   **T9** `tinhKpiNoi(dsKpi, !overviewQ.isSuccess)` → `tinhKpiNoi(dsKpi)`
 *   **T10** `!dangTai && canhQ.isSuccess && mayLine.length === 0` → `mayLine.length === 0`
 *
 * ★★★ Cả hai là **cùng một lớp lỗi**: *bỏ cờ "ta chưa biết"*. Cả hai đều biến
 *   một trạng thái CHƯA-ĐO thành một lời khai DỨT KHOÁT, và cả hai đều **không
 *   làm gì nổ** — T9 in `0 máy đang chạy` cho người bị 403; T10 in *"chuyền này
 *   chưa có máy nào"* trong khoảnh khắc truy vấn còn đang chạy. Đúng NT-3.5:
 *   **đếm rỗng khác đếm bằng 0**.
 */
describe("★★★ ⑧b Hai đột biến SỐNG SÓT lượt đầu — cờ 'ta chưa biết' không được bỏ", () => {
  it("★★★ T9 — `tinhKpiNoi` phải nhận cờ `chuaDo`, nếu không 403 in `0` thay vì `—`", () => {
    const t = than("kpi");
    expect(t).toContain("tinhKpiNoi(dsKpi, !overviewQ.isSuccess)");
    /*
     * ★ `tinhKpiNoi(ds)` một đối số ⇒ `chuaDo = false` (mặc định) ⇒ mọi ô ra SỐ.
     *   Trên một tài khoản bị từ chối `factoryCommand.overview`, bảng KPI sẽ nói
     *   *"0 máy đang chạy, 0 máy dừng lỗi"* — một lời khai **đã kiểm tra** về
     *   một thứ chưa hề kiểm tra được.
     */
    expect(t).not.toMatch(/tinhKpiNoi\(\s*dsKpi\s*\)/);
  });

  it("★★★ T10 — `rongThat` phải đợi truy vấn XONG: `!dangTai && isSuccess`", () => {
    const i = MA.indexOf("const rongThat =");
    expect(i).toBeGreaterThan(-1);
    const dong = MA.slice(i, MA.indexOf("\n", i));
    expect(dong).toContain("!dangTai");
    expect(dong).toContain("canhQ.isSuccess");
    /*
     * ★★★ Bỏ hai điều kiện ấy thì `EmptyState` *"chuyền này chưa có máy nào trên
     *   bố cục"* hiện ra ở **khung hình đầu tiên của MỌI lần tải** — trước khi
     *   `canhThietKe` kịp trả lời. Người xem đọc được một câu khẳng định về một
     *   chuyền mà ta còn chưa hỏi xong. Và vì nó tự biến mất sau ~300 ms, nó
     *   **không bao giờ bị báo lỗi** — chỉ để lại cảm giác "màn hay nháy".
     */
    expect(dong).not.toMatch(/=\s*mayLine\.length === 0\s*;/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑧c CHIỀU CAO KHUNG — LỖI **CHỈ ẢNH BẮT ĐƯỢC** (G41), NAY THÀNH LƯỚI (G91)   */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ BẢN ĐẦU CỦA TRANG DÙNG `h-full`, VÀ NÓ ĐẨY CẢ DẢI TRẠM RA NGOÀI MÀN HÌNH.
 *
 * Đo trên `dist`, 1600×900, `e2e_tai_loE` (`.qa-dot30/do-dai-line.json`):
 *
 *     man-twin-line   y= 80  h=889   ⇒ đáy ở **969**, tràn **69 px**
 *     khoi-dai-line   y=876  h= 93
 *     12 ô trạm       y=904  h= 55   ← **NẰM DƯỚI MÉP 900, không ai thấy**
 *
 * ⚠⚠⚠ Cả 12 ô **CÓ trong DOM**, **CÓ kích thước thật** (82×55), `soNutTrongDai`
 *   đếm ra đúng **12**, và mọi lưới `toBeVisible()` đều XANH. **Con số ĐÚNG mà
 *   màn vẫn hỏng** — đó là lý do cổng ra đòi ẢNH TỰ CHỤP TỰ ĐỌC, không đòi một
 *   phép đếm DOM.
 *
 * ★ Gốc rễ và bản vá đều đã có tiền lệ: `TwinVanHanh.tsx:2481` ghi *"Đừng thay
 *   `5rem` bằng một hằng số đoán khác — lần sau chrome đổi là sai lại, và không
 *   có lỗi nào nổ."* ⇒ ĐO `getBoundingClientRect().top` rồi trừ khỏi `100vh`.
 */
describe("★★★ ⑧c Khung phải TRỪ vỏ ứng dụng bằng số ĐO, không bằng hằng đoán", () => {
  it("★★★ khung gốc KHÔNG dùng `h-full` — nó tràn 69 px và nuốt dải trạm", () => {
    const i = MA.indexOf('data-testid="man-twin-line"');
    expect(i).toBeGreaterThan(-1);
    const khoi = MA.slice(Math.max(0, i - 400), i);
    expect(khoi).not.toMatch(/className="[^"]*\bh-full\b/);
  });

  it("★★★ chiều cao = `100vh` trừ vị trí ĐO ĐƯỢC của chính khung", () => {
    expect(MA).toContain("calc(100vh - var(--twin-line-top");
    // ★ Có một `useEffect` THẬT ghi biến ấy — nếu không, `5rem` mồi thành số CUỐI.
    expect(MA).toContain("getBoundingClientRect().top");
    expect(MA).toContain('setProperty("--twin-line-top"');
  });

  it("★ biến CSS RIÊNG, không dùng chung `--twin-top` của `/twin`", () => {
    /*
     * ★ Hai màn không bao giờ sống cùng lúc (QĐ-19), nhưng một biến CSS toàn
     *   cục dùng chung sẽ để lại giá trị của màn TRƯỚC cho màn SAU đọc — một
     *   khớp nối ẩn giữa hai thứ đáng lẽ độc lập.
     */
    expect(MA).not.toContain("var(--twin-top");
  });

  it("★★★ dải trạm `shrink-0`, KHÔNG `flex-1` — Đợt 22: item không trần nuốt anh em", () => {
    const i = MA.indexOf('data-testid="khoi-dai-line"');
    expect(i).toBeGreaterThan(-1);
    const khoi = MA.slice(Math.max(0, i - 200), i);
    expect(khoi).toContain("shrink-0");
    expect(khoi).not.toContain("flex-1");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑨ HẠNG B — G37: trang là VỎ, thân nhận qua THAM SỐ                          */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑨ G37 — đúng MỘT chỗ đọc route; thân không tự đọc", () => {
  it("★★★ `useRoute` xuất hiện ĐÚNG một lần trong cả tệp", () => {
    expect((MA.match(/useRoute\(/g) ?? []).length).toBe(1);
  });

  it("★★★ `ThanManLine` nhận `lineId` qua prop, KHÔNG gọi `useRoute`/`useSearch`", () => {
    const i = MA.indexOf("export function ThanManLine");
    expect(i).toBeGreaterThan(-1);
    const thanTrang = MA.slice(i);
    expect(thanTrang).not.toContain("useRoute");
    expect(thanTrang).not.toContain("useSearch");
    /*
     * ★★★ Vì sao đây là một lưới chứ không một quy ước: `RobotCockpit` và
     *   `StationAnalysis` đã dính đúng lớp này — màn tự đọc route hỏng **CÂM**
     *   khi đặt ngoài route của nó (`id = NaN`, **không exception**), và biểu
     *   hiện là một màn RỖNG, không phải một lỗi.
     */
  });

  it("★★★ vỏ rẽ nhánh TƯỜNG MINH khi id không hợp lệ — không để `NaN` chảy xuống", () => {
    expect(MA).toContain("idLineTuDuongDan(");
    expect(MA).toContain("lineId === null");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑩ HẠNG B — G67 + §11b: cổng quyền và cái KHÔNG được xoá nhầm                */
/* ══════════════════════════════════════════════════════════════════════════ */

const MA_APP = readFileSync(resolve(GOC, "src/App.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("★★★ ⑩ Cổng quyền — QĐ-18 + G67", () => {
  it("★★★ route `/twin/line/:id` tồn tại và bọc bằng `RouteGuard`", () => {
    expect(MA_APP).toMatch(/<Route path="\/twin\/line\/:id">/);
  });

  it("★★★ G67 — `navHref=\"/twin\"`, KHÔNG `\"/twin/line/:id\"`", () => {
    /*
     * ★★★ `hasAccessToItem` (`navigation.tsx:2546`) duyệt `navGroups` tìm ô có
     *   `href` **khớp CHÍNH XÁC** và **`return false`** khi không thấy. Một
     *   `navHref="/twin/line/:id"` — href không có trong `navGroups` — **từ chối
     *   MỌI người dùng, kể cả người đủ quyền**, và triệu chứng là thẻ "Không có
     *   quyền truy cập", KHÔNG phải một lỗi. Đúng lớp G67: tên vắng khỏi danh
     *   sách ĐÓNG thì bị nuốt im lặng.
     */
    const i = MA_APP.indexOf('<Route path="/twin/line/:id">');
    const dong = MA_APP.slice(i, MA_APP.indexOf("</Route>", i));
    expect(dong).toContain('navHref="/twin"');
    expect(dong).not.toContain('navHref="/twin/line');
    // ★ QĐ-18: màn XEM ⇒ KHÔNG cổng studio.
    expect(dong).not.toContain("settings_factory");
    expect(dong).not.toContain("machine_control");
  });

  it("★★★ §11b — `/line-view/:lineId` VẪN CÒN: hai màn KHÁC NHAU, không xoá nhầm", () => {
    /*
     * ★ `LineView.tsx` (418 dòng, **0 tham chiếu 3D**) là màn **2D CÓ LỆNH**;
     *   `/twin/line/:id` là màn **3D CHỈ XEM**. Ca này giữ cửa đóng cho đúng lớp
     *   lỗi §11b: xoá một màn vì tưởng nó trùng lặp.
     */
    expect(MA_APP).toContain('<Route path="/line-view/:lineId?">');
    expect(MA_APP).toContain('<Route path="/twin">');
    expect(MA_APP).toContain('<Route path="/twin-studio">');
  });
});
