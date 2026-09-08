// @vitest-environment jsdom
//
/**
 * vienSucKhoe.dom.test.tsx — ★★★ A-4 CÓ THẬT SỰ VẼ KHÔNG (§14.5.1, F-15, mục G-1).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY TỒN TẠI — `wip={[]}` ĐÃ XẢY RA MỘT LẦN RỒI
 * ════════════════════════════════════════════════════════════════════════════
 * `wipTram.ts` docblock ghi nguyên văn chế độ hỏng: `CanhVanHanh.tsx` đã có đủ
 * `OngWip` (InstancedMesh, màu nghẽn, RB-7 dispose) và đã render nó — nhưng chỗ
 * gọi DUY NHẤT truyền một **hằng rỗng viết cứng**, và `OngWip` `return null` khi
 * rỗng. Lớp phủ chạy qua `check`, qua `build`, qua **994 test**, và chưa bao giờ
 * vẽ một pixel nào.
 *
 * `LopVienSucKhoe` có **đúng cùng hình dạng** đó: cùng `return null` khi rỗng,
 * cùng prop tuỳ chọn, cùng vị trí trong cây. Nên nó có đúng cùng rủi ro, và một
 * bộ test chỉ gọi `vienSucKhoe()` (hàm thuần) sẽ xanh trọn vẹn trong khi cảnh
 * không vẽ gì. Đó là G5 nguyên bản: *cổng xanh trên tập rỗng trùng khít cổng
 * xanh của hệ đúng*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HAI TẦNG ĐO — khuôn `noiLoD.dom.test.tsx` của Đợt 8 lô D
 * ════════════════════════════════════════════════════════════════════════════
 *   TẦNG 1 — **VĂN BẢN chỗ nối**: `CanhVanHanh.tsx` có thật sự dựng
 *            `<LopVienSucKhoe>` trong cây cảnh không, và có truyền prop thật
 *            không (chứ không phải một hằng rỗng viết cứng). Đây là phép đo duy
 *            nhất bắt được "gỡ chỗ gọi, mọi cổng vẫn xanh".
 *
 *   TẦNG 2 — **HÀNH VI đường ống**, chạy thật trên `three`: dựng ĐÚNG chuỗi
 *            biến đổi mà cảnh dựng (`vienSucKhoe()` → ma trận + màu instance),
 *            rồi ĐỌC NGƯỢC ra khỏi buffer GPU và ĐO. Không mock `sucKhoeMay`
 *            (G20 — không mock chính module đang giao hàng).
 *
 * ★ jsdom KHÔNG có WebGL, nên KHÔNG dựng `<Canvas>` ở đây. Tầng 2 đo phép biến
 *   đổi *hình học và màu* — đúng thứ chở thông tin — bằng cách chạy lại nguyên
 *   văn phép compose trên `THREE.InstancedMesh` thật. Đó là chỗ `mauThree.dom.
 *   test.tsx` đã chứng minh là nơi thông tin bị mất (12 cột WIP trắng như nhau,
 *   vẽ đủ hình mà chở **0 bit**).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";

import {
  banKinhVien,
  hangSucKhoe,
  vienSucKhoe,
  type ChoDatVien,
  type KhaiSucKhoe,
} from "./sucKhoeMay";

const GOC = resolve(__dirname, "../../../..");
const CANH = readFileSync(resolve(GOC, "src/components/twin3d/van-hanh/CanhVanHanh.tsx"), "utf8");

const BAY_GIO = Date.parse("2026-09-08T09:40:00.000Z");
const GIO = 3_600_000;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 1 — VĂN BẢN CHỖ NỐI                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("TẦNG 1 — chỗ nối trong `CanhVanHanh.tsx` (chống 'gỡ chỗ gọi, cổng vẫn xanh')", () => {
  it("★ tiền đề: đọc được tệp cảnh và nó KHÔNG rỗng — nếu không mọi khẳng định dưới là vô nghĩa", () => {
    expect(CANH.length).toBeGreaterThan(1000);
    expect(CANH).toContain("CanhVanHanhProps");
  });

  it("★★★ cảnh DỰNG `<LopVienSucKhoe>` trong cây — không chỉ định nghĩa rồi bỏ đó", () => {
    expect(CANH).toContain("function LopVienSucKhoe");
    // Chỗ DỰNG, khác chỗ ĐỊNH NGHĨA. Không có dòng này thì lớp là mã chết.
    expect(CANH).toMatch(/<LopVienSucKhoe\s+vien=\{/);
  });

  it("★★★ prop đi vào lớp đến TỪ PROPS, không phải hằng rỗng viết cứng (bẫy `wip={[]}`)", () => {
    // Nguồn phải là `props.vienSucKhoe`, và hằng rỗng chỉ được dùng làm mặc định.
    expect(CANH).toMatch(/props\.vienSucKhoe\s*\?\?\s*EMPTY_VIEN/);
    // KHÔNG được có `vien={[]}` hay `vienSucKhoe={[]}` ở chỗ dựng.
    expect(CANH).not.toMatch(/<LopVienSucKhoe\s+vien=\{\[\]\}/);
  });

  it("`vienSucKhoe` là prop CÔNG KHAI của cảnh — tầng trên có đường truyền vào", () => {
    expect(CANH).toMatch(/vienSucKhoe\?:\s*readonly VienDeMay\[\]/);
  });

  it("★ A-4 vẽ TRƯỚC `LoBatchMay` — vòng dưới chân, thân máy đè lên", () => {
    const iVien = CANH.indexOf("<LopVienSucKhoe");
    const iMay = CANH.indexOf("<LoBatchMay");
    expect(iVien).toBeGreaterThan(-1);
    expect(iMay).toBeGreaterThan(-1);
    expect(iVien).toBeLessThan(iMay);
  });

  it("★★★ RB-7 — geometry và material tự cấp phát đều `dispose()` trong cleanup", () => {
    const than = CANH.slice(CANH.indexOf("function LopVienSucKhoe"), CANH.indexOf("function NoiDung"));
    expect(than).toContain("hinh.dispose()");
    expect(than).toContain("chatLieu.dispose()");
  });

  it("★★★ vòng KHÔNG nuốt cú bấm vào máy — `raycast` bị vô hiệu", () => {
    const than = CANH.slice(CANH.indexOf("function LopVienSucKhoe"), CANH.indexOf("function NoiDung"));
    // Thiếu dòng này thì bấm máy A có thể trúng vòng của máy B.
    expect(than).toMatch(/raycast=\{\(\)\s*=>\s*null\}/);
  });

  it("★ `frameloop=\"demand\"` — lớp phải gọi `invalidate()`, nếu không nó cập nhật rồi đứng im", () => {
    const than = CANH.slice(CANH.indexOf("function LopVienSucKhoe"), CANH.indexOf("function NoiDung"));
    expect(than).toContain("invalidate()");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 2 — HÀNH VI: thông tin có thật sự tới được buffer GPU không             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Chạy lại NGUYÊN VĂN phép biến đổi của `LopVienSucKhoe` trên một
 * `InstancedMesh` thật, rồi trả về mesh để đọc ngược.
 *
 * ★ Vì sao chép phép biến đổi thay vì render component: jsdom không có WebGL,
 *   nên `<Canvas>` không dựng được. Nhưng thứ CHỞ THÔNG TIN không phải WebGL —
 *   nó là ma trận và màu instance, và cả hai tính được ở đây. Đây đúng ranh giới
 *   mà `mauThree.dom.test.tsx` đã đặt cho cùng lý do.
 */
function bomVaoBuffer(vien: ReturnType<typeof vienSucKhoe>) {
  const g = new THREE.RingGeometry(0.82, 1, 48);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(g, m, Math.max(1, vien.length));

  const mt = new THREE.Matrix4();
  const mau = new THREE.Color();
  vien.forEach((v, i) => {
    const r = Math.max(0.05, v.banKinhM);
    mt.compose(
      new THREE.Vector3(v.x, 0.012, v.z),
      new THREE.Quaternion(),
      new THREE.Vector3(r, 1, r),
    );
    inst.setMatrixAt(i, mt);
    mau.set(v.mau);
    if (v.motNhat) mau.lerp(new THREE.Color("#ffffff"), 0.35);
    inst.setColorAt(i, mau);
  });
  inst.count = vien.length;
  return inst;
}

function docMau(inst: THREE.InstancedMesh, i: number): string {
  const c = new THREE.Color();
  inst.getColorAt(i, c);
  return c.getHexString();
}

function docViTri(inst: THREE.InstancedMesh, i: number) {
  const mt = new THREE.Matrix4();
  inst.getMatrixAt(i, mt);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  mt.decompose(p, q, s);
  return { p, s };
}

function khai(p: Partial<KhaiSucKhoe> & { machineId: number }): KhaiSucKhoe {
  return { diem: 95, nguyCo: 0, mucKhan: "LOW", mocMs: BAY_GIO - 60_000, ...p };
}
function cho(machineId: number, x: number, z: number): ChoDatVien {
  return { machineId, viTri: { x, z }, kichThuocMm: { rong: 1200, sau: 800 } };
}

describe("TẦNG 2 — thông tin có tới được buffer không (chống 'vẽ đủ hình, chở 0 bit')", () => {
  const ds: KhaiSucKhoe[] = [
    khai({ machineId: 1, diem: 55 }), // nguy_kich  → đỏ
    khai({ machineId: 2, diem: 70 }), // canh       → hổ phách
    khai({ machineId: 3, diem: 95 }), // khoe       → KHÔNG vẽ
    khai({ machineId: 4, diem: 70, mocMs: BAY_GIO - 25 * GIO }), // het_han → xám nhạt
  ];
  const chos = [cho(1, 10, 20), cho(2, 30, 40), cho(3, 50, 60), cho(4, 70, 80)];

  it("★★★ TIỀN ĐỀ G5 — tập vẽ KHÁC RỖNG. Không có dòng này thì mọi test dưới đo trên rỗng", () => {
    const v = vienSucKhoe(ds, chos, BAY_GIO);
    expect(v.length).toBeGreaterThan(0);
    expect(v).toHaveLength(3); // máy khoẻ vắng mặt
  });

  it("★★★ BA VÒNG, BA MÀU KHÁC NHAU — đây đúng phép đo mà 12 cột WIP trắng đã trượt", () => {
    const v = vienSucKhoe(ds, chos, BAY_GIO);
    const inst = bomVaoBuffer(v);
    expect(inst.count).toBe(3);

    const mau = [0, 1, 2].map((i) => docMau(inst, i));
    // Chở thông tin THẬT: ba màu RỜI NHAU, không phải ba lần cùng một màu.
    expect(new Set(mau).size).toBe(3);
    // Và không màu nào là trắng — trắng là dấu hiệu `THREE.Color` nuốt giá trị lạ.
    expect(mau.every((m) => m !== "ffffff")).toBe(true);
  });

  it("★★★ ABLATION — dí mọi máy về cùng một hạng ⇒ số màu rời nhau TỤT còn 1", () => {
    /*
     * Chỉ báo phải biết KÊU. Nếu phép đo ở trên vẫn ra "3 màu" kể cả khi mọi máy
     * cùng hạng, thì nó không đo màu — nó đo số phần tử. Đây là ca đối chứng bắt
     * buộc theo bài học "sàng mật-độ-assertion".
     */
    const dong = ds.map((k) => khai({ machineId: k.machineId, diem: 55 }));
    const v = vienSucKhoe(dong, chos, BAY_GIO);
    expect(v).toHaveLength(4); // giờ CẢ BỐN đều được vẽ
    const inst = bomVaoBuffer(v);
    const mau = [0, 1, 2, 3].map((i) => docMau(inst, i));
    expect(new Set(mau).size).toBe(1);
  });

  it("★★★ vòng ĐẶT ĐÚNG CHỖ MÁY — không phải gốc toạ độ, không lệch trục (BẪY HOÁN VỊ TRỤC)", () => {
    const v = vienSucKhoe(ds, chos, BAY_GIO);
    const inst = bomVaoBuffer(v);
    // `vienSucKhoe` sắp theo machineId ⇒ [1, 2, 4].
    expect(v.map((x) => x.machineId)).toEqual([1, 2, 4]);

    const a = docViTri(inst, 0);
    expect(a.p.x).toBeCloseTo(10, 6);
    expect(a.p.z).toBeCloseTo(20, 6);
    // ★ x KHÔNG được rơi vào z: máy ở (10,20) mà vòng ở (20,10) là bẫy hoán vị
    //   trục — align không làm gì, không có gì nổ, và mắt khó bắt trên lưới đều.
    expect(a.p.x).not.toBeCloseTo(20, 6);

    const b = docViTri(inst, 1);
    expect(b.p.x).toBeCloseTo(30, 6);
    expect(b.p.z).toBeCloseTo(40, 6);
  });

  it("★ vòng NHÍCH LÊN khỏi sàn — y > 0, nếu không z-fighting nhấp nháy với mặt sàn", () => {
    const inst = bomVaoBuffer(vienSucKhoe(ds, chos, BAY_GIO));
    const { p } = docViTri(inst, 0);
    expect(p.y).toBeGreaterThan(0);
    // Nhưng vẫn phải đọc là "vòng TRÊN sàn", không phải "vòng lơ lửng".
    expect(p.y).toBeLessThan(0.1);
  });

  it("★★★ vòng BAO TRỌN máy — bán kính lớn hơn nửa đường chéo mặt bằng", () => {
    const inst = bomVaoBuffer(vienSucKhoe(ds, chos, BAY_GIO));
    const { s } = docViTri(inst, 0);
    const nuaCheoM = Math.sqrt(1200 ** 2 + 800 ** 2) / 2 / 1000;
    // Scale XZ chính là bán kính (hình học đơn vị bán kính ngoài 1).
    expect(s.x).toBeCloseTo(banKinhVien(1200, 800), 6);
    expect(s.x).toBeGreaterThan(nuaCheoM);
    // Scale ĐỀU trên XZ — méo một trục là bẫy hoán vị trục ở dạng khác.
    expect(s.z).toBeCloseTo(s.x, 6);
  });

  it("★★★ lời khai HẾT HẠN nhạt hơn lời khai SỐNG cùng hạng — hai lớp tín hiệu", () => {
    const song = khai({ machineId: 9, diem: 70 });
    const chet = khai({ machineId: 9, diem: 70, mocMs: BAY_GIO - 25 * GIO });
    // Tiền đề: hai lời khai này CÙNG điểm, chỉ khác tuổi.
    expect(song.diem).toBe(chet.diem);
    expect(hangSucKhoe(song, BAY_GIO)).toBe("canh");
    expect(hangSucKhoe(chet, BAY_GIO)).toBe("het_han");

    const chos9 = [cho(9, 0, 0)];
    const mauSong = docMau(bomVaoBuffer(vienSucKhoe([song], chos9, BAY_GIO)), 0);
    const mauChet = docMau(bomVaoBuffer(vienSucKhoe([chet], chos9, BAY_GIO)), 0);
    expect(mauSong).not.toBe(mauChet);
  });

  it("tập rỗng ⇒ `count` 0 và KHÔNG nổ — nhưng đó là ca biên, không phải phép đo (G5)", () => {
    const inst = bomVaoBuffer(vienSucKhoe([], [], BAY_GIO));
    expect(inst.count).toBe(0);
  });
});
