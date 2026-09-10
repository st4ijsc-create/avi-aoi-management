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

import { SAN_KHOI_CANH_MAY_PX, chieuCaoKhoiCanhMay, phamViCuaManMay } from "./manMay";
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

  it("★★★ viền đế: `vienSucKhoe(khai, neoMucTieu.map(…), bayGio)` và `viTri.x/.z` (KHÔNG `.y`) — Đợt 38: bản thô `vienSucKhoeTho`, bản ổn định theo giá trị truyền xuống cảnh", () => {
    const t = than("vienSucKhoeTho");
    expect(t).toContain("neoMucTieu.map(");
    expect(t).toContain("viTri: { x: m.viTri.x, z: m.viTri.z }");
    expect(t).not.toContain("m.viTri.y");
    // `bayGio` đổi mỗi render ⇒ bản thô dựng lại mỗi render; `CanhVanHanh` có `useEffect([vien]) → invalidate()`.
    expect(MA).toContain("const vienSucKhoeCanh = useOnDinhTheoGiaTri(vienSucKhoeTho, JSON.stringify(vienSucKhoeTho));");
    expect(MA).toContain("vienSucKhoe={vienSucKhoeCanh}");
  });

  it("★★★ camera: `khungNhinMay(mucTieu)` — KHÔNG `khungNhinLine`/`khungNhinCho` tự gọi (Đợt 38: biểu thức ở `khungNhinTho`, `khungNhin` là bản ổn định theo giá trị)", () => {
    expect(dong("khungNhinTho")).toContain("khungNhinMay(mucTieu)");
    // Pareto #1 QA Đợt 37: `mucTieu` đổi tham chiếu mỗi gói socket ⇒ tween về cùng chỗ (143–230 khung/40 s) —
    // `khungNhin` truyền xuống cảnh phải là bản khoá theo GIÁ TRỊ, cùng khuôn Line/`/twin`.
    expect(dong("khungNhin")).toBe("const khungNhin = useMemo(() => khungNhinTho, [khoaKhungNhin]);");
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

  it("★★★ khối canvas `shrink-0` + chiều cao TÍNH theo phần còn lại (Đợt 35 #4); KHÔNG `flex-1` — đừng phóng to 3D cho đẹp", () => {
    const khoi = theMo("khoi-canh-may");
    expect(khoi).toContain("shrink-0");
    // Đợt 35: `clamp(320px, 36vh, 360px)` ⇒ `chieuCaoKhoiCanhMay(cònLại, vh)` — ở 720 cảnh 320 > cockpit 275 là lỗi QA Đợt 32.
    expect(khoi).toMatch(/height:\s*caoKhoiCanhPx/);
    expect(MA).toMatch(/const caoKhoiCanhPx = chieuCaoKhoiCanhMay\(/);
    expect(khoi).not.toMatch(/clamp\(/);
    expect(khoi).not.toContain("flex-1");
  });

  it("★★★ sàn khung = sàn canvas — MỘT hằng `SAN_KHOI_CANH_MAY_PX` hai chỗ đọc, và `overflow-hidden` — canvas không được tràn", () => {
    /*
     * Nghiệm thu ảnh Đợt 31: khung 306 < sàn canvas 320 ⇒ canvas tràn 14 px xuống
     * header cockpit. bbox DOM của khung "đúng", chỉ bbox CANVAS + ảnh bắt được.
     * Đợt 35: sàn khung là `SAN_KHOI_CANH_MAY_PX` (240, thấp hơn sàn kit 320 để giữ
     * cockpit > cảnh ở 720) và canvas nhận CÙNG sàn ấy qua `sanCaoPx` — kit đọc
     * `minHeight: sanCaoPx`, không còn số 320 cứng. Kiểm bằng GIÁ TRỊ: hàm không
     * bao giờ trả dưới sàn.
     */
    const khoi = theMo("khoi-canh-may");
    expect(MA).toMatch(/sanCaoPx=\{SAN_KHOI_CANH_MAY_PX\}/);
    const kit = docSach("src/components/twin3d/loi/KhungCanh.tsx");
    expect(kit).toMatch(/minHeight:\s*sanCaoPx/);
    expect(kit).not.toMatch(/minHeight:\s*\d+/);
    for (const [conLai, vh] of [[595, 720], [775, 900], [100, 300], [null, 480]] as const) {
      expect(chieuCaoKhoiCanhMay(conLai, vh)).toBeGreaterThanOrEqual(SAN_KHOI_CANH_MAY_PX);
    }
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

  it("chiều cao = `100vh` trừ vị trí ĐO ĐƯỢC; hook `useTruDinhKhung` có `useEffect` THẬT ghi biến (Đợt 35, G12)", () => {
    expect(MA).toContain('chieuCaoTruDinh("--twin-may-top")');
    expect(MA).toContain('useTruDinhKhung(khungRef, "--twin-may-top")');
    const hook = docSach("src/components/twin3d/van-hanh/useTruDinhKhung.ts");
    expect(hook).toContain("getBoundingClientRect().top");
    expect(hook).toMatch(/setProperty\(tenBien,/);
    expect(MA).not.toContain('setProperty("--twin-may-top"');
  });

  it("★ KHÔNG dùng chung `--twin-line-top`/`--twin-top` (khớp nối ẩn giữa hai màn)", () => {
    expect(MA).not.toContain("var(--twin-line-top");
    expect(MA).not.toContain("var(--twin-top");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑥ HẠNG B — L-5 + NT-3/NT-3.5: cờ "ta chưa biết" không được bỏ               */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑥ Lý do mở màn qua `lyDoMoManMay` với `dangTai`; câu từ `cauChoLyDoManMay`", () => {
  it("`lyDo = lyDoMoManMay(machineId, { idTrongTam, phamViRong, dangTai, thieuQuyen })` — Đợt 34 (D) thêm `thieuQuyen` THẬT", () => {
    const d = dong("lyDo");
    expect(d).toContain("lyDoMoManMay(machineId, { idTrongTam, phamViRong, dangTai, thieuQuyen })");
    // `thieuQuyen` THẬT = server FORBIDDEN (cùng cách bắt với `thieuQuyenBoCuc` của `/twin`), không phải phạm vi rỗng.
    const i = MA.indexOf("const thieuQuyen =");
    expect(i).toBeGreaterThan(-1);
    expect(MA.slice(i, MA.indexOf(";", i))).toContain('code === "FORBIDDEN"');
    /*
     * ★★★ ĐỘT BIẾN bỏ `dangTai`: lượt tải đầu `mayTatCa` rỗng ⇒ MỌI máy hợp lệ
     *   nháy "ngoài phạm vi" một nhịp rồi tự biến mất — không bao giờ bị báo lỗi.
     */
    expect(d).not.toMatch(/\{\s*idTrongTam,\s*phamViRong\s*\}/);
  });

  it("★★★ câu nói ra lấy từ `cauChoLyDoManMay(lyDo)` (Đợt 34 D) — không tự viết câu ở trang", () => {
    expect(MA).toContain("cauChoLyDoManMay(lyDo)");
    expect(MA).not.toContain("cauChoLyDoNgan(lyDo)");
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

  it("★★★ Đợt 34 (Pareto #1) — tuổi dữ liệu qua MỘT hàm `tsTrangThaiTheoMay`: server `tsTrangThai` thắng, issue `offline` chỉ là đường lùi", () => {
    // Trước Đợt 34 ca này ghim vòng lặp `if (iss.kind !== "offline") continue;` — chép ở CẢ BA trang.
    // Đo 2026-09-10: 43/43 máy có log mới nhất `online` ⇒ 0 issue `offline` ⇒ vòng lặp ấy cho bản đồ
    // RỖNG ⇒ 42 máy đã từng báo cáo hiện "Never reported" (bịa theo chiều ngược NT-3). Nay ba trang gọi
    // CÙNG một hàm (G12); luật "chỉ `offline` mang mốc" sống trong `tsTrangThaiTuIssues` (đường lùi cho
    // server cũ) và có test riêng ở `trungThucDuLieu.unit.test.ts`.
    // Đợt 38: mốc = `Date.now()` lúc NHẬN dữ liệu (deps `[overviewQ.data]`), không phải `bayGioThat` mỗi render —
    // một dep đổi mỗi render kéo `mayNen → mayTatCa → mayVe` dựng lại ⇒ một khung vẽ mỗi re-render (xem `onDinhTheoGiaTri.ts`).
    expect(than("tsTheoMay")).toContain(
      "tsTrangThaiTheoMay(overviewQ.data?.machines ?? [], overviewQ.data?.issues ?? [], Date.now())",
    );
    expect(than("tsTheoMay")).not.toContain("bayGioThat");
    expect(than("tsTheoMay")).not.toContain('iss.kind !== "offline"');
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

  it("★ bấm hàng xóm ⇒ ĐỔI MÁY tại chỗ (`duongDanManMay(id)`), không chồng lớp", () => {
    // ★ Đợt 33 (QĐ-23): hình dạng URL lấy từ `duongDanManMay` (một nguồn, G12) và
    //   mang `state` đường về `/twin?pv=…` (QĐ-23 #5). Trước Đợt 33 ca này ghim
    //   chuỗi `setLocation(\`/twin/may/${id}\`)` — cùng hành vi, khác nguồn chuỗi.
    expect(MA).toContain("setLocation(duongDanManMay(id), { state: trangThaiVe(duongVe) })");
    expect(MA).not.toContain("setLocation(`/twin/may/${id}`)");
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

  it("★★★ Đợt 38 — `__soCanvas` KHÔNG còn mù (RB-4/G99): cockpit `embedded` KHÔNG dựng `<Canvas`; bản độc lập đăng ký qua `useDemCanvasSong`", () => {
    /*
     * Đợt 31 ghim nợ: `MachineCockpitBody` tab "3D" dựng `<Canvas>` drei KHÔNG qua `KhungCanh` ⇒ `/twin/may/14`
     * bấm tab ⇒ DOM 2 canvas mà `window.__soCanvas` = 1 (QA Đợt 32 a4, Đợt 37 RB-4). Đợt 38 trả nợ hai chiều:
     *   · `Model3DPane` nhận `embedded` (TwinMay + NganNhung truyền) ⇒ ghi chú thay vì `<Canvas>` (một context/trang);
     *   · bản độc lập (`/machines/:id`) bọc `<Canvas>` trong `Model3DCanvas` gọi `useDemCanvasSong()` — bộ đếm
     *     RB-4 của kit — nên DOM canvas = `__soCanvas` ở MỌI trạng thái tab (đo sống `.qa-dot38/sau/p4-*`).
     */
    const cockpit = docSach("src/pages/MachineCockpit.tsx");
    expect(cockpit).toContain('import { useDemCanvasSong } from "@/components/twin3d/loi/KhungCanh"');
    // Đúng MỘT `<Canvas` trong tệp, và nó nằm trong `Model3DCanvas` — nơi đã đăng ký bộ đếm.
    expect((cockpit.match(/<Canvas\b/g) ?? []).length).toBe(1);
    const i = cockpit.indexOf("function Model3DCanvas(");
    expect(i).toBeGreaterThan(-1);
    const thanCanvas = cockpit.slice(i, cockpit.indexOf("\nfunction Model3DPane(", i));
    expect(thanCanvas).toContain("useDemCanvasSong()");
    expect(thanCanvas).toContain("<Canvas");
    // `Model3DPane` chỉ dựng nó khi KHÔNG nhúng; nhúng ⇒ ghi chú `model3d-da-nhung`.
    expect(cockpit).toMatch(/embedded \? \([\s\S]*?model3d-da-nhung[\s\S]*?\) : \(\s*<Model3DCanvas uri=\{uri\} \/>/);
    expect(cockpit).toContain("embedded={embedded}");
    // Hai chỗ nhúng cockpit đều truyền `embedded` — màn Máy và ngăn nhúng ở `/twin`.
    expect(MA).toContain("<MachineCockpitBody machineId={machineId} embedded />");
    const ngan = docSach("src/components/twin3d/van-hanh/NganNhung.tsx");
    expect(ngan).toContain("MachineCockpitBody");
    expect(ngan).toContain("<ThanMay machineId={ngan.id} embedded />");
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
    // Đợt 38: hằng MODULE `KHONG_WIP` thay cho `[]` tại chỗ gọi — `CanhVanHanh` có `useEffect([wip]) → invalidate()`,
    // một mảng rỗng MỚI mỗi render là một khung vẽ cho mỗi re-render (đo 13 khung/40 s đứng yên còn lại ở màn Máy).
    expect(MA).toContain("wip={KHONG_WIP}");
    expect(MA).toContain("const KHONG_WIP: never[] = [];");
    expect(MA).not.toContain("wip={[]}");
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
