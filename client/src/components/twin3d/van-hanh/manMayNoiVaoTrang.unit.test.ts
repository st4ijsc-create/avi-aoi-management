/**
 * ════════════════════════════════════════════════════════════════════════════
 * `manMayNoiVaoTrang.unit.test.ts` — **NỬA THỨ HAI** của phép đo (G93)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `manMay.unit.test.ts` chứng minh *"hàm đúng khi được gọi đúng"*. Tệp này hỏi
 * câu Đợt 29 đã trả giá để học: **trang gọi bằng đối số nào?** — ba đột biến ở
 * CHỖ GỌI từng sống sót cả 1.998 test.
 *
 * HẠNG A — đo bằng GIÁ TRỊ (①): khớp nối `trongPhamVi` đã kéo ra thành
 * `phamViCuaManMay()` nên đo được bằng giá trị thật.
 * HẠNG B — đo bằng VĂN BẢN của trang (② trở đi): những khớp nối còn lại nằm
 * trong thân `useMemo` của một component có `<Canvas>` WebGL — không dựng nổi
 * trong `environment: "node"`. Hạng B thấp hơn A, nhưng là hạng CAO NHẤT có
 * được ở đó, và nó THẬT SỰ bắt đúng lớp đột biến Đợt 29 đo được là sống sót.
 *
 * ⚠ G92 — TƯỚC CHÚ THÍCH TRƯỚC KHI ĐO. Docblock của `TwinMay.tsx` nhắc gần như
 *   mọi tên dưới đây, kể cả trong câu *"KHÔNG được làm thế này"*.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { phamViCuaManMay } from "./manMay";
import { trongPhamVi } from "./phamViCanh";

const GOC = resolve(__dirname, "../../../..");

/** G92 — mã đã TƯỚC mọi chú thích (khối lẫn dòng). */
function docSach(duongDan: string): string {
  return readFileSync(resolve(GOC, duongDan), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const MA = docSach("src/pages/TwinMay.tsx");
const MA_APP = docSach("src/App.tsx");

/** Thân một `useMemo` NHIỀU DÒNG, cắt theo dấu kết của chính nó. */
function than(tenBien: string): string {
  const i = MA.indexOf(`const ${tenBien} = useMemo`);
  expect(i, `không tìm thấy \`${tenBien}\` trong trang`).toBeGreaterThan(-1);
  const k1 = MA.indexOf("\n  );", i);
  const k2 = MA.indexOf("\n  }, [", i);
  const j = [k1, k2].filter((k) => k > i).sort((a, b) => a - b)[0];
  expect(j, `không tìm thấy dấu kết của \`${tenBien}\``).toBeGreaterThan(i);
  return MA.slice(i, j);
}

/** MỘT DÒNG khai báo `const <tên> = …` (cho memo/biến một dòng). */
function dong(tenBien: string): string {
  const i = MA.indexOf(`const ${tenBien} =`);
  expect(i, `không tìm thấy \`const ${tenBien} =\``).toBeGreaterThan(-1);
  return MA.slice(i, MA.indexOf("\n", i));
}

/**
 * Thẻ MỞ của chính phần tử mang `data-testid` — từ `<div` gần nhất phía trước
 * tới `data-testid`. ★ Không dùng cửa sổ cố định: lượt đầu của tệp này dùng
 * `slice(i - 220, i)` và đọc lấn sang thẻ CHA (`flex-1` của cột trái) ⇒ đỏ oan
 * (đúng G92 bài 2: *cửa sổ cố định tràn sang hàng xóm*).
 */
function theMo(testId: string): string {
  const i = MA.indexOf(`data-testid="${testId}"`);
  expect(i, `không tìm thấy data-testid="${testId}"`).toBeGreaterThan(-1);
  const j = MA.lastIndexOf("<div", i);
  expect(j).toBeGreaterThan(-1);
  return MA.slice(j, i);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① HẠNG A — phạm vi cảnh, ĐO BẰNG GIÁ TRỊ                                    */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ① Phạm vi của màn Máy — máy đích TRONG, hàng xóm NGOÀI (pha 72 %)", () => {
  const dich = { machineId: 7, stationId: 21, lineId: 2, workshopId: null, factoryId: 1, tangId: 28 };
  const hangXom = { ...dich, machineId: 8, stationId: 22 };

  it("máy đích ⇒ trong; hàng xóm cùng chuyền + cùng tầng ⇒ NGOÀI", () => {
    expect(trongPhamVi(dich, phamViCuaManMay(7))).toBe(true);
    expect(trongPhamVi(hangXom, phamViCuaManMay(7))).toBe(false);
  });

  it("★★★ ĐỘT BIẾN `cap:'may'`→`'line'` hoặc `id`→`null` đều làm hàng xóm thành TRONG — câm", () => {
    expect(trongPhamVi(hangXom, { cap: "line", id: 2 })).toBe(true);
    expect(trongPhamVi(hangXom, { cap: "may", id: null })).toBe(true);
    expect(trongPhamVi(hangXom, phamViCuaManMay(7))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② HẠNG A/B — trang THẬT SỰ gọi hàm ấy, và với ĐÚNG tập máy                  */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② `mayVe` — `phamViCuaManMay(machineId)` và `may: hangXom`", () => {
  it("`mayVe` truyền `phamViCuaManMay(machineId)`; trang KHÔNG dựng `{ cap: … }` tại chỗ", () => {
    expect(than("mayVe")).toContain("phamViCuaManMay(machineId)");
    expect(MA).not.toMatch(/cap:\s*["'](may|line|tang)["']/);
  });

  it("★★★ `may: hangXom` — KHÔNG `mayTatCa` (F2: 31 máy lạ), KHÔNG `[mayNay]` (mất định vị §14.8)", () => {
    const t = than("mayVe");
    expect(t).toContain("may: hangXom");
    expect(t).not.toContain("may: mayTatCa");
    expect(t).not.toMatch(/may:\s*\[\s*mayNay\s*\]/);
  });

  it("★★★ `hangXom` dựng bằng `mayHangXom(machineId, mayTatCa, tram)`, không bộ lọc viết tay", () => {
    expect(dong("hangXom")).toContain("mayHangXom(machineId, mayTatCa, tram)");
    expect(MA).not.toMatch(/mayTatCa\.filter\([^)]*lineId\s*===/);
  });

  it("`lineId` cho breadcrumb qua `lineCuaMayTheoTram` (trạm thắng), không `mayNay.lineId`", () => {
    expect(dong("lineId")).toContain("lineCuaMayTheoTram(machineId, mayTatCa, tram)");
    expect(MA).not.toMatch(/const lineId = [^;]*mayNay\?\.lineId/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ HẠNG B — NHÓM (A) NEO VÀO MỘT MÁY: nhãn · badge · viền · camera            */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ③ §15.6.2 cấp Máy ≤ 3 thứ neo — tất cả từ `neoMucTieu`, KHÔNG từ `mayVe`", () => {
  it("`mucTieu` = `mucTieuTrongCanh(mayVe, machineId)`; `neoMucTieu` = 0/1 phần tử", () => {
    expect(dong("mucTieu")).toContain("mucTieuTrongCanh(mayVe, machineId)");
    expect(dong("neoMucTieu")).toMatch(/mucTieu \? \[mucTieu\] : \[\]/);
  });

  it("★★★ nhãn: `dungNhanMay({ mayVe: neoMucTieu` — ĐỘT BIẾN `mayVe: mayVe` = 12 nhãn hàng xóm", () => {
    const t = than("nhan");
    expect(t).toContain("mayVe: neoMucTieu");
    expect(t).not.toMatch(/mayVe:\s*mayVe\b/);
  });

  it("★★★ badge: `dungCanhBao3D(andonRows, neoMucTieu, maTheoMay)`", () => {
    const t = than("canhBao3D");
    expect(t).toContain("dungCanhBao3D(andonRows, neoMucTieu, maTheoMay)");
  });

  it("★★★ viền đế: `vienSucKhoe(khai, neoMucTieu.map(…), bayGio)` và `viTri.x/.z` (KHÔNG `.y`)", () => {
    const t = than("vienSucKhoeCanh");
    expect(t).toContain("neoMucTieu.map(");
    expect(t).toContain("viTri: { x: m.viTri.x, z: m.viTri.z }");
    expect(t).not.toContain("m.viTri.y");
  });

  it("★★★ camera: `khungNhinMay(mucTieu)` — KHÔNG `khungNhinLine`/`khungNhinCho` tự gọi", () => {
    expect(dong("khungNhin")).toContain("khungNhinMay(mucTieu)");
    expect(MA).not.toContain("khungNhinLine(");
    expect(MA).not.toContain("khungNhinCho(");
  });

  it("★ `vienSucKhoe={vienSucKhoeCanh}` ĐƯỢC truyền — đây là cấp Máy, khác màn Line", () => {
    expect(MA).toMatch(/vienSucKhoe=\{vienSucKhoeCanh\}/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ HẠNG B — G87: ĐÚNG MỘT `<CanhVanHanh>`, và cảnh NHỎ theo §15.7.1           */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ④ G87 + §15.7.1 — một canvas, và canvas KHÔNG được `flex-1`", () => {
  it("★★★ chỉ MỘT chỗ render `<CanhVanHanh`, KHÔNG `CanhVanHanh2D`", () => {
    expect((MA.match(/<CanhVanHanh\b/g) ?? []).length).toBe(1);
    expect(MA).not.toContain("CanhVanHanh2D");
  });

  it("★★★ khối canvas `shrink-0` + trần `vh`; KHÔNG `flex-1` — đừng phóng to 3D cho đẹp", () => {
    const khoi = theMo("khoi-canh-may");
    expect(khoi).toContain("shrink-0");
    expect(khoi).toMatch(/clamp\([^)]*vh[^)]*\)/);
    expect(khoi).not.toContain("flex-1");
  });

  it("★★★ sàn khung ≥ 320 px (= `minHeight` của KhungCanh) và `overflow-hidden` — canvas không được tràn", () => {
    /*
     * Nghiệm thu ảnh lần đầu: `clamp(220px, …)` = 306 ở 900 px, canvas 320 tràn
     * 14 px xuống header cockpit. bbox DOM của khung "đúng", chỉ bbox CANVAS +
     * ảnh bắt được. Đọc `minHeight: 320` từ chính `KhungCanh.tsx`, không kế thừa.
     */
    const khoi = theMo("khoi-canh-may");
    const san = Number((khoi.match(/clamp\((\d+)px/) ?? [])[1]);
    const kit = docSach("src/components/twin3d/loi/KhungCanh.tsx");
    const sanKit = Number((kit.match(/minHeight:\s*(\d+)/) ?? [])[1]);
    expect(sanKit).toBeGreaterThan(0);
    expect(san).toBeGreaterThanOrEqual(sanKit);
    expect(khoi).toContain("overflow-hidden");
  });

  it("★★★ CHƯA biết máy mở được thì CHƯA mount cảnh/cockpit/ngăn — nhánh `dangTai` đứng TRƯỚC bố cục", () => {
    /*
     * Ảnh lần đầu: cockpit + NganXuLy mount trong lúc `dangTai` ⇒ hỏi server về
     * máy người dùng không được xem ⇒ toast "Could not find machine." cạnh câu L-5.
     */
    const i = MA.indexOf(") : dangTai ? (");
    const j = MA.indexOf('data-testid="may-dang-tai"');
    const k = MA.indexOf("<CanhVanHanh");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(k, "canvas phải nằm SAU nhánh dangTai").toBeGreaterThan(j);
  });

  it("★★★ cockpit 2D là phần `flex-1` + `overflow-y-auto` — nó chiếm phần lớn màn", () => {
    const khoi = theMo("cockpit-2d");
    expect(khoi).toContain("flex-1");
    expect(khoi).toContain("overflow-y-auto");
  });

  it("★ ĐỐI CHỨNG — phép đếm canvas BIẾT KÊU trên chuỗi hai canvas", () => {
    const gia = "<CanhVanHanh may={a} /><CanhVanHanh may={b} />";
    expect((gia.match(/<CanhVanHanh\b/g) ?? []).length).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑤ HẠNG B — CHIỀU CAO KHUNG (G23/G41), biến RIÊNG                             */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑤ Khung trừ vỏ ứng dụng bằng số ĐO, biến `--twin-may-top` RIÊNG", () => {
  it("khung gốc KHÔNG `h-full` (Đợt 30 tràn 69 px)", () => {
    const khoi = theMo("man-twin-may");
    expect(khoi).toContain("className=");
    expect(khoi).not.toMatch(/className="[^"]*\bh-full\b/);
  });

  it("chiều cao = `100vh` trừ vị trí ĐO ĐƯỢC; có `useEffect` THẬT ghi biến", () => {
    expect(MA).toContain("calc(100vh - var(--twin-may-top");
    expect(MA).toContain("getBoundingClientRect().top");
    expect(MA).toContain('setProperty("--twin-may-top"');
  });

  it("★ KHÔNG dùng chung `--twin-line-top`/`--twin-top` (khớp nối ẩn giữa hai màn)", () => {
    expect(MA).not.toContain("var(--twin-line-top");
    expect(MA).not.toContain("var(--twin-top");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑥ HẠNG B — L-5 + NT-3/NT-3.5: cờ "ta chưa biết" không được bỏ               */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑥ Lý do mở màn qua `lyDoMoManMay` với `dangTai`; câu từ `cauChoLyDoNgan`", () => {
  it("`lyDo = lyDoMoManMay(machineId, { idTrongTam, phamViRong, dangTai })`", () => {
    const d = dong("lyDo");
    expect(d).toContain("lyDoMoManMay(machineId, { idTrongTam, phamViRong, dangTai })");
    /*
     * ★★★ ĐỘT BIẾN bỏ `dangTai`: lượt tải đầu `mayTatCa` rỗng ⇒ MỌI máy hợp lệ
     *   nháy "ngoài phạm vi" một nhịp rồi tự biến mất — không bao giờ bị báo lỗi.
     */
    expect(d).not.toMatch(/\{\s*idTrongTam,\s*phamViRong\s*\}/);
  });

  it("★★★ câu nói ra lấy từ `cauChoLyDoNgan(lyDo)` — không tự viết câu thứ tư", () => {
    expect(MA).toContain("cauChoLyDoNgan(lyDo)");
    expect(MA).toContain('data-testid="may-khong-mo-duoc"');
  });

  it("★★★ `chuaDatCho` đợi `!dangTai && canhQ.isSuccess && !canhQ.isFetching` — không khai 'chưa đặt chỗ' khi chưa hỏi xong", () => {
    const i = MA.indexOf("const chuaDatCho =");
    expect(i).toBeGreaterThan(-1);
    const d = MA.slice(i, MA.indexOf(";", i));
    expect(d).toContain("!dangTai");
    expect(d).toContain("canhQ.isSuccess");
    // ★ `canhThietKe` hỏi hai lượt (tangIds [] rồi thật); giữa hai lượt datCho rỗng.
    expect(d).toContain("!canhQ.isFetching");
    expect(d).toContain("mucTieu === null");
  });

  it("★ `dangTai` gồm đủ chuỗi xếp tầng: factories → toaNha → chiTiet → canh, + overview", () => {
    const i = MA.indexOf("const dangTai =");
    expect(i).toBeGreaterThan(-1);
    const d = MA.slice(i, MA.indexOf(";", i));
    for (const q of ["factoriesQ", "toaNhaQ", "chiTietQ", "canhQ", "overviewQ"]) expect(d).toContain(`${q}.isLoading`);
  });

  it("★★★ NT-3 — tuổi dữ liệu CHỈ từ `kind === \"offline\"`", () => {
    expect(than("tsTheoMay")).toContain('if (iss.kind !== "offline") continue;');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑦ HẠNG B — MẶT GHI: `NganXuLy` là DUY NHẤT; trang 0 `useMutation`; G24       */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑦ Mặt ghi — `NganXuLy` một lần, `MachineCockpitBody embedded`, tên quyền grep được", () => {
  it("trang KHÔNG có `useMutation` của riêng nó (QĐ-18 ở cổng route)", () => {
    expect(MA).not.toContain("useMutation");
  });

  it("★★★ đúng MỘT `<NganXuLy` — §15.3.3 'mặt ghi duy nhất'", () => {
    expect((MA.match(/<NganXuLy\b/g) ?? []).length).toBe(1);
  });

  it("★★★ `<MachineCockpitBody machineId={machineId} embedded />` — dùng lại, không viết bản thứ hai (G12)", () => {
    expect(MA).toMatch(/<MachineCockpitBody\s+machineId=\{machineId\}\s+embedded\s*\/>/);
  });

  it("★★★ G24 — bốn quyền lấy đúng tên module THẬT (`andon`/`machine_control`/`machine_monitoring`)", () => {
    const i = MA.indexOf("const quyen: QuyenXuLy = {");
    expect(i).toBeGreaterThan(-1);
    const khoi = MA.slice(i, MA.indexOf("};", i));
    expect(khoi).toContain('ackAlarm: hasPermission("andon", "canEdit")');
    expect(khoi).toContain('anTamAlarm: hasPermission("machine_control", "canCreate")');
    expect(khoi).toContain('taoPhieu: hasPermission("machine_monitoring", "canCreate")');
    expect(khoi).toContain('suaPhieu: hasPermission("machine_monitoring", "canEdit")');
    // ★ `maintenance_*` là tên từ FIXTURE TEST, không tồn tại trong mã sản phẩm.
    expect(MA).not.toContain("maintenance_");
  });

  it("★ KHÔNG `onMoTaiCho` — cockpit đã nhúng; mở thêm `NganNhung` là hai bản của một thứ", () => {
    expect(MA).not.toMatch(/onMoTaiCho=/);
  });

  it("★ bấm hàng xóm ⇒ ĐỔI MÁY tại chỗ (`/twin/may/${id}`), không chồng lớp", () => {
    expect(MA).toContain("setLocation(`/twin/may/${id}`)");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑧ ★★★ G91 — HAI ĐIỀU KHÔNG LÀM ĐƯỢC, VIẾT THÀNH TEST                         */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑧ G91 — nợ có chỗ sống trong mã, không chỉ trong báo cáo", () => {
  it("★★★ KHÔNG dải E-STOP theo máy: `anToanQ` trả ROBOT, `robot.id` ≠ `machines.id`", () => {
    /*
     * Hình C §15.3.3 vẽ "⚠ Máy đang E-STOP". Nguồn duy nhất là
     * `twinCanh.anToanRobot` → `robots`; `twin_dat_cho` không có `robot`
     * (`canhBaoAnToan.ts`). Khớp `r.id === machineId` là trùng id ngẫu nhiên.
     * ⇒ Trang KHÔNG đọc `anToanQ`. Ai nối nó vào đây phải sửa ca này CÓ Ý THỨC.
     */
    expect(MA).not.toContain("anToanQ");
    expect(MA).not.toMatch(/estop|E-STOP/i);
  });

  it("★★★ `__soCanvas` MÙ với tab 3D của cockpit — nợ CÓ SẴN ở `/twin` qua `NganNhung`", () => {
    /*
     * `MachineCockpitBody` có tab "3D" dựng `<Canvas>` của drei, KHÔNG qua
     * `KhungCanh` ⇒ `window.__soCanvas` không đếm. Bấm tab ⇒ 2 WebGL context
     * mà phép đo `__soCanvas = 1` vẫn XANH. Không vá ở đợt này (tệp ngoài phạm
     * vi, có consumer ngoài Twin — §11b). Ca này ghim SỰ THẬT đo được: nếu
     * một ngày cockpit đi qua `KhungCanh` (hoặc bỏ `<Canvas`), ca này ĐỎ để
     * người sửa biết nợ đã trả và cập nhật docblock `TwinMay.tsx`.
     */
    const cockpit = docSach("src/pages/MachineCockpit.tsx");
    expect(cockpit).toContain("<Canvas");
    expect(cockpit).not.toContain("KhungCanh");
    expect(cockpit).not.toContain("__soCanvas");
    // Và `/twin` mở CÙNG cockpit ấy trong ngăn nhúng — nợ không phải của riêng màn này.
    const ngan = docSach("src/components/twin3d/van-hanh/NganNhung.tsx");
    expect(ngan).toContain("MachineCockpitBody");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑨ HẠNG B — G37 + §15.6 nhóm (D)                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑨ G37 — một chỗ đọc route; nhóm (D) cố ý KHÔNG lên 3D", () => {
  it("`useRoute(` xuất hiện ĐÚNG một lần; `ThanManMay` không tự đọc route", () => {
    expect((MA.match(/useRoute\(/g) ?? []).length).toBe(1);
    const i = MA.indexOf("export function ThanManMay");
    expect(i).toBeGreaterThan(-1);
    expect(MA.slice(i)).not.toContain("useRoute");
    expect(MA.slice(i)).not.toContain("useSearch");
  });

  it("vỏ rẽ nhánh TƯỜNG MINH: `idMayTuDuongDan(` + `machineId === null`, KHÔNG `Number(`", () => {
    expect(MA).toContain("idMayTuDuongDan(");
    expect(MA).toContain("machineId === null");
    expect(MA).not.toMatch(/Number\(\s*khop/);
  });

  it("D-11 / D-12 / D-10 — không công cụ sửa bố cục, không `vung`, không biểu đồ trên cảnh", () => {
    expect(MA).not.toContain("thiet-ke/");
    expect(MA).not.toMatch(/\bvung=\{/);
    expect(MA).not.toMatch(/recharts|LineChart|BarChart/);
  });

  it("★ `dongChay={null}` và `wip={[]}` — CÓ CHỦ Ý ở cấp Máy (không phải G5 quên nối)", () => {
    expect(MA).toContain("dongChay={null}");
    expect(MA).toContain("wip={[]}");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑩ HẠNG B — App.tsx: cổng quyền (G67/QĐ-18) và cái KHÔNG được xoá (§11b)     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑩ App.tsx — route `/twin/may/:id`, `navHref=\"/twin\"`, `/machine/:id` VẪN CÒN", () => {
  it("route tồn tại, bọc `RouteGuard navHref=\"/twin\"`, KHÔNG cổng studio", () => {
    const i = MA_APP.indexOf('<Route path="/twin/may/:id">');
    expect(i, "route /twin/may/:id chưa có trong App.tsx").toBeGreaterThan(-1);
    const dongRoute = MA_APP.slice(i, MA_APP.indexOf("</Route>", i));
    expect(dongRoute).toContain('navHref="/twin"');
    expect(dongRoute).not.toContain('navHref="/twin/may');
    expect(dongRoute).not.toContain("settings_factory");
    expect(dongRoute).not.toContain("machine_control");
    expect(dongRoute).toContain("<TwinMay />");
  });

  it("★ lazy import `TwinMay` từ `./pages/TwinMay`", () => {
    expect(MA_APP).toContain('const TwinMay = React.lazy(() => import("./pages/TwinMay"));');
  });

  it("★★★ §11b — `/machine/:id` và `/twin/line/:id` VẪN CÒN: ba màn KHÁC NHAU, không xoá nhầm", () => {
    expect(MA_APP).toContain('<Route path="/machine/:id">');
    expect(MA_APP).toContain('<Route path="/twin/line/:id">');
    expect(MA_APP).toContain('<Route path="/twin">');
  });
});
