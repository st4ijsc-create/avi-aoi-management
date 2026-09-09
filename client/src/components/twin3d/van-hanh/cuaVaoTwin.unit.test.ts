/**
 * cuaVaoTwin.unit.test.ts — ĐỢT 33: QĐ-23 **NỐI VÀO TRANG** (G16: có hàm chưa đủ,
 * phải có CHỖ GỌI theo TÊN HÀM).
 *
 * Đợt 32 đo kết cục gốc *"chọn Line → Line 3D, chọn máy → Machine 3D"* KHÔNG ĐẠT:
 * `/twin` 0 href tới hai màn mới · `chonMay = ghiUrl({chon})` · màn Line
 * `onChonMay={datMachineIdChon}` (state cục bộ) · deep-link ⇒ app "Overview"
 * · `?cam=` nuốt im lặng. Lưới này đọc MÃ THẬT của ba trang và ghim từng mối
 * nối — mỗi ca đỏ khi gỡ đúng một mảnh vá (ablation ở `.qa-dot33/`).
 *
 * ⚠ Đây là lưới HÌNH DẠNG (đọc nguồn). Kết cục người dùng đo SỐNG trên dist
 *   bằng `.qa-dot33/do.mjs` (K1–K9) — hai thiết bị đo độc lập, không thay nhau.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");
function docSach(duongDan: string): string {
  return readFileSync(resolve(GOC, duongDan), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const NHA_MAY = docSach("src/pages/TwinVanHanh.tsx");
const LINE = docSach("src/pages/TwinLine.tsx");
const MAY = docSach("src/pages/TwinMay.tsx");
const APP = docSach("src/App.tsx");

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① `/twin` LÀ CỬA VÀO — vỏ redirect, thân không mount cho URL sắp rời          */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ ① /twin là CỬA VÀO (QĐ-23): vỏ gọi `dichManRieng` rồi `<Redirect replace>`", () => {
  it("vỏ default export gọi `dichManRieng(search)` và trả `<Redirect to={…} replace />`", () => {
    const i = NHA_MAY.indexOf("export default function TwinVanHanh()");
    expect(i).toBeGreaterThan(-1);
    const vo = NHA_MAY.slice(i, NHA_MAY.indexOf("export function ThanTwinVanHanh", i));
    expect(vo).toContain("dichManRieng(search)");
    expect(vo).toMatch(/<Redirect to=\{dichRieng\} replace \/>/);
    expect(vo).toContain("<ThanTwinVanHanh />");
  });
  it("★ `dichManRieng` import từ `bo-cuc/dinhTuyenTwinCu` — bảng redirect MỘT chỗ, không viết bộ đọc thứ hai", () => {
    expect(NHA_MAY).toContain('from "@/components/twin3d/bo-cuc/dinhTuyenTwinCu"');
    expect((NHA_MAY.match(/dichManRieng\(/g) ?? []).length).toBe(1);
  });
  it("★ `App.tsx` KHÔNG đổi: `/twin` vẫn `<RouteGuard navHref=\"/twin\"><TwinVanHanh />`", () => {
    expect(APP).toContain('<Route path="/twin"><RouteGuard navHref="/twin"><TwinVanHanh /></RouteGuard></Route>');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② BẤM MÁY / BẤM LINE trong /twin = RỜI TRANG, đi qua ĐÚNG hai hàm URL       */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ ② /twin: bấm máy ⇒ `duongDanManMay`, bấm Line ⇒ `duongDanManLine` — không ghi `?chon=machine`", () => {
  it("★★★ `chonMay` KHÔNG còn `ghiUrl({ chon: { loai: \"machine\"` (hành vi Đợt 32 a2: ở lại /twin)", () => {
    expect(NHA_MAY).not.toMatch(/ghiUrl\(\{\s*chon:\s*id === null \? null : \{ loai: "machine"/);
    expect(NHA_MAY).not.toMatch(/chon:\s*\{\s*loai:\s*"machine"/);
  });
  it("`chonMay` ⇒ `dieuHuongToiMan(duongDanManMay(id))`; `chonLine` ⇒ `duongDanManLine(id)`", () => {
    expect(NHA_MAY).toContain("dieuHuongToiMan(duongDanManMay(id))");
    expect(NHA_MAY).toContain("dieuHuongToiMan(duongDanManLine(id))");
  });
  it("★ `chonMay(null)` vẫn là bỏ chọn tại chỗ (`ghiUrl({ chon: null })`) — bấm nền không 'đi' đâu", () => {
    const i = NHA_MAY.indexOf("const chonMay = useCallback");
    expect(i).toBeGreaterThan(-1);
    expect(NHA_MAY.slice(i, i + 400)).toContain("ghiUrl({ chon: null })");
  });
  it("★★★ cây phân cấp: node MÁY ⇒ `chonMay`, node LINE ⇒ `chonLine` (không còn `phamVi: { cap: \"line\"` tại chỗ)", () => {
    const i = NHA_MAY.indexOf("const chamNodeCay = useCallback");
    expect(i).toBeGreaterThan(-1);
    const than = NHA_MAY.slice(i, NHA_MAY.indexOf("\n  );", i));
    expect(than).toContain("chonMay(dh.chon.id)");
    expect(than).toContain("chonLine(dh.chon.id)");
    expect(than).not.toMatch(/phamVi:\s*\{\s*cap:\s*"line"/);
  });
  it("★ breadcrumb đi qua `chonPhamVi` (line/may ⇒ màn riêng; ba cấp trên ⇒ `doiPhamVi`)", () => {
    expect(NHA_MAY).toContain("onClick={() => chonPhamVi({ cap: m.cap, id: m.id })}");
    const i = NHA_MAY.indexOf("const chonPhamVi = useCallback");
    expect(i).toBeGreaterThan(-1);
    const than = NHA_MAY.slice(i, NHA_MAY.indexOf("\n  );", i));
    expect(than).toContain('pv.cap === "line"');
    expect(than).toContain('pv.cap === "may"');
    expect(than).toContain("doiPhamVi(pv)");
  });
  it("★★★ mọi bề mặt bấm máy trong /twin vẫn nối `chonMay` (danh sách, 2D, 3D, dải cảnh báo, dải Line)", () => {
    expect((NHA_MAY.match(/onChonMay=\{chonMay\}/g) ?? []).length).toBe(3);
    expect(NHA_MAY).toContain("onChonCanhBao={(c) => c.machineId != null && chonMay(c.machineId)}");
    expect(NHA_MAY).toContain("if (mayDau) chonMay(mayDau.id);");
  });
  it("★★★ QĐ-23 #5: rời /twin mang `state: trangThaiVe(<pathname+search hiện tại>)`", () => {
    const i = NHA_MAY.indexOf("const dieuHuongToiMan = useCallback");
    expect(i).toBeGreaterThan(-1);
    const than = NHA_MAY.slice(i, NHA_MAY.indexOf("\n  );", i));
    expect(than).toContain("state: trangThaiVe(`${window.location.pathname}${window.location.search}`)");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ NGĂN NHÚNG mất đường vào từ /twin — tệp KHÔNG xoá                          */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ ③ QĐ-23 #4 — `NganNhung` mất đường vào từ /twin, KHÔNG xoá tệp", () => {
  it("/twin KHÔNG truyền `onMoTaiCho=` / `nganNhung=` / `onDongNhung=` / `lyDoNgan=` xuống `NganXuLy`", () => {
    for (const p of ["onMoTaiCho=", "nganNhung=", "onDongNhung=", "lyDoNgan="]) expect(NHA_MAY, p).not.toContain(p);
    expect(NHA_MAY).not.toContain("ghiXem");
    expect(NHA_MAY).not.toContain("lyDoNganNhung");
  });
  it("★ tệp `NganNhung.tsx` và chỗ dựng trong `NganXuLy.tsx` VẪN CÒN (QĐ-23 #4: không xoá mã)", () => {
    const ngan = docSach("src/components/twin3d/van-hanh/NganNhung.tsx");
    expect(ngan).toContain("export function NganNhung(");
    expect(docSach("src/components/twin3d/van-hanh/NganXuLy.tsx")).toContain("<NganNhung");
  });
  it("★ /twin vẫn dựng `<NganXuLy` đúng MỘT lần (ngăn phải tóm tắt khi chọn Line/tầng)", () => {
    expect((NHA_MAY.match(/<NganXuLy\b/g) ?? []).length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ MÀN LINE: bấm máy = ĐI; link "Nhà máy" về đúng `?pv=`; `?cam=` đọc thật   */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ ④ TwinLine — QĐ-23 #2 + #5 + Pareto #9", () => {
  it("★★★ KHÔNG còn `datMachineIdChon` (Đợt 32 a3: bấm ô trạm ⇒ URL không đổi)", () => {
    expect(LINE).not.toContain("datMachineIdChon");
    expect(LINE).not.toContain("useState<number | null>");
  });
  it("cảnh 3D và dải trạm cùng gọi `dieuHuongToiMay` ⇒ `setLocation(duongDanManMay(id), { state: trangThaiVe(duongVe) })`", () => {
    expect(LINE).toContain("onChonMay={dieuHuongToiMay}");
    expect(LINE).toContain("if (mayDau) dieuHuongToiMay(mayDau.id);");
    expect(LINE).toContain("setLocation(duongDanManMay(id), { state: trangThaiVe(duongVe) })");
  });
  it("★ link \"Nhà máy\" là `href={duongVe ?? \"/twin\"}` — về đúng `?pv=` (QĐ-23 #5)", () => {
    expect(LINE).toContain('href={duongVe ?? "/twin"}');
    expect(LINE).not.toMatch(/href="\/twin"\s*\n?\s*className/);
  });
  it("★★★ vỏ đọc `?cam=` bằng `docTrangThaiUrl(search).cam` + `history.state` bằng `docDuongVeTwin(useHistoryState())`, TRUYỀN xuống thân", () => {
    const i = LINE.indexOf("export default function TwinLine()");
    const vo = LINE.slice(i, LINE.indexOf("export interface ThanManLineProps", i));
    expect(vo).toContain("docTrangThaiUrl(search).cam");
    expect(vo).toContain("docDuongVeTwin(useHistoryState())");
    // ★ Đợt 34 (QĐ-24): vỏ đọc thêm `?thu=moPhongMo` và TRUYỀN xuống (`moPhongMoBanDau`) — cùng luật G37.
    expect(vo).toContain('docTrangThaiUrl(search).thu.includes("moPhongMo")');
    expect(vo).toContain(
      "<ThanManLine lineId={lineId} camUrl={camUrl} duongVe={duongVe} moPhongMoBanDau={moPhongMoBanDau} />",
    );
  });
  it("★★★ `khungNhinTho` = `camUrl ? khungNhinTuCamera(camUrl) : khungNhinLine(…)` — `?cam=` THẮNG khung theo cấp (Đợt 35: + bộ ổn định theo giá trị)", () => {
    // Đợt 35 (#5/#6): biểu thức sống ở `khungNhinTho`; `khungNhin` chỉ là bản ổn định theo GIÁ TRỊ
    // (`DieuKhien` tween theo tham chiếu). `?cam=` vẫn phải THẮNG khung theo cấp.
    const i = LINE.indexOf("const khungNhinTho = useMemo");
    expect(i).toBeGreaterThan(-1);
    const than = LINE.slice(i, LINE.indexOf("\n  );", i));
    expect(than).toContain("khungNhinTuCamera(camUrl)");
    expect(than).toContain("khungNhinLine(");
    expect(than.indexOf("khungNhinTuCamera")).toBeLessThan(than.indexOf("khungNhinLine("));
    expect(LINE).toContain("const khungNhin = useMemo(() => khungNhinTho, [khoaKhungNhin])");
  });
  it("★ G37 giữ: thân KHÔNG `useRoute`/`useSearch`/`useHistoryState`", () => {
    const than = LINE.slice(LINE.indexOf("export function ThanManLine"));
    for (const h of ["useRoute(", "useSearch(", "useHistoryState("]) expect(than, h).not.toContain(h);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 36 — `/twin` cũng ổn định `khungNhin` THEO GIÁ TRỊ (idle 137 khung/40 s trước vá)          */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ Đợt 36 — TwinVanHanh: `khungNhin` là bản ổn định theo GIÁ TRỊ của `khungNhinTho` (cùng cơ chế Line Đợt 35)", () => {
  it("biểu thức theo cấp sống ở `khungNhinTho` (deps phamVi/hinhLine/mayVe); `khungNhin` chỉ đổi khi `khoaKhungNhin` đổi", () => {
    const i = NHA_MAY.indexOf("const khungNhinTho = useMemo<KhungNhin | null>(() => {");
    expect(i).toBeGreaterThan(-1);
    const than = NHA_MAY.slice(i, NHA_MAY.indexOf("}, [phamVi, hinhLine, mayVe]);", i));
    expect(than).toContain("khungNhinLine(");
    expect(than).toContain("khungNhinCho(");
    expect(NHA_MAY).toContain("const khungNhin = useMemo(() => khungNhinTho, [khoaKhungNhin])");
    // Khoá làm tròn mm ở CẢ viTri lẫn muc — thiếu một nửa là tween lại khi nửa kia đổi.
    expect(NHA_MAY).toMatch(/const khoaKhungNhin = khungNhinTho\s*\?\s*`\$\{khungNhinTho\.viTri\.map\(\(v\) => v\.toFixed\(3\)\)\.join\(","\)\}\|\$\{khungNhinTho\.muc\.map\(\(v\) => v\.toFixed\(3\)\)\.join\(","\)\}`/);
    // `<CanhVanHanh khungNhin={khungNhin}>` nhận bản ỔN ĐỊNH, không nhận bản thô.
    expect(NHA_MAY).toContain("khungNhin={khungNhin}");
    expect(NHA_MAY).not.toContain("khungNhin={khungNhinTho}");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑤ MÀN MÁY: link về đúng `?pv=`; `?cam=` đọc thật; đường sang Line mang state */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★★★ ⑤ TwinMay — QĐ-23 #5 + Pareto #9", () => {
  it("★★★ vỏ đọc `?cam=` + `history.state` và TRUYỀN xuống thân", () => {
    const i = MAY.indexOf("export default function TwinMay()");
    const vo = MAY.slice(i, MAY.indexOf("export interface ThanManMayProps", i));
    expect(vo).toContain("docTrangThaiUrl(search).cam");
    expect(vo).toContain("docDuongVeTwin(useHistoryState())");
    expect(vo).toContain("<ThanManMay machineId={machineId} camUrl={camUrl} duongVe={duongVe} />");
  });
  it("★★★ `khungNhin` = `camUrl ? khungNhinTuCamera(camUrl) : khungNhinMay(mucTieu)`", () => {
    expect(MAY).toContain("useMemo(() => (camUrl ? khungNhinTuCamera(camUrl) : khungNhinMay(mucTieu)), [camUrl, mucTieu])");
  });
  it("★ link \"Nhà máy\" + nút thoát L-5 về `duongVe ?? \"/twin\"`; link Line mang `state={trangThaiVe(duongVe)}`", () => {
    expect((MAY.match(/duongVe \?\? "\/twin"/g) ?? []).length).toBe(2);
    expect(MAY).toContain("href={duongDanManLine(lineId)}");
    expect(MAY).toContain("state={trangThaiVe(duongVe)}");
  });
  it("★ bấm hàng xóm ⇒ `setLocation(duongDanManMay(id), { state: trangThaiVe(duongVe) })` — đổi máy tại chỗ, giữ đường về", () => {
    expect(MAY).toContain("setLocation(duongDanManMay(id), { state: trangThaiVe(duongVe) })");
    expect(MAY).not.toContain("setLocation(`/twin/may/${id}`)");
  });
  it("★ G37 giữ: thân KHÔNG `useRoute`/`useSearch`/`useHistoryState`", () => {
    const than = MAY.slice(MAY.indexOf("export function ThanManMay"));
    for (const h of ["useRoute(", "useSearch(", "useHistoryState("]) expect(than, h).not.toContain(h);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑥ ĐỐI CHỨNG cho chính thiết bị đo                                            */
/* ══════════════════════════════════════════════════════════════════════════ */
describe("★ ⑥ ĐỐI CHỨNG — `docSach` không nuốt mã, và các phép `not.toContain` BIẾT KÊU", () => {
  it("bỏ chú thích nhưng GIỮ mã: chuỗi mồi có `onMoTaiCho=` trong mã bị bắt, trong chú thích khối/dòng thì không", () => {
    const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(boChuThich("const a = 1; /* onMoTaiCho= */\n  // onMoTaiCho=\n")).not.toContain("onMoTaiCho=");
    expect(boChuThich("<X onMoTaiCho={f} />")).toContain("onMoTaiCho=");
    // ⚠ Giới hạn ĐÃ BIẾT của bộ lọc (cùng bộ lọc với các lưới Đợt 30/31): chú thích
    //   `//` ở CUỐI một dòng mã KHÔNG bị bỏ. Ghi ra để người sau không tưởng nó sạch.
    expect(boChuThich("const b = 2; // onMoTaiCho=")).toContain("onMoTaiCho=");
  });
  it("ba trang đọc được và không rỗng", () => {
    expect(NHA_MAY.length).toBeGreaterThan(10_000);
    expect(LINE.length).toBeGreaterThan(5_000);
    expect(MAY.length).toBeGreaterThan(5_000);
  });
});
