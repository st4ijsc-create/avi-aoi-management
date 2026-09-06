/**
 * hinhHocTuMoTa.unit.test.ts — GHIM BẢN DỊCH mô tả dữ liệu → three.js.
 *
 * ★★★ VÌ SAO TỆP NÀY TỒN TẠI (vùng mù được QA CHỨNG MINH, không phải phỏng đoán):
 * `hinhKhoiMay.ts` có 55 test, nhưng cả 55 chỉ đo MÔ TẢ DỮ LIỆU (số trong object).
 * `hinhHocTuMoTa.ts` là cầu nối DUY NHẤT từ mô tả đó sang `THREE.BufferGeometry`,
 * và trước tệp này nó KHÔNG CÓ TEST NÀO. QA chứng minh vùng mù bằng hai lỗi tiêm
 * phá huỷ — cả hai đều để bộ test 378 XANH nguyên:
 *   (1) đảo dấu trục Z trong `g.translate(...)` → mọi máy quay ngược mặt trước;
 *   (2) `new THREE.BoxGeometry(0.001, 0.001, 0.001)` cho MỌI hộp con → mọi máy
 *       teo còn 1mm, cảnh 3D rỗng hoàn toàn.
 * Test dưới đây phải ĐỎ với cả hai. Mỗi khối `describe` ghi rõ nó chặn lỗi nào.
 *
 * ★ ENVIRONMENT: `node`, KHÔNG cần WebGL — và KHÔNG phải tách phần thuần khỏi
 * phần dựng geometry. Đã ĐO trước khi viết: một test probe import `three` +
 * `three/examples/jsm/utils/BufferGeometryUtils.js` chạy XANH ở `environment:
 * "node"` của repo này. `BufferGeometry`/`BoxGeometry`/`Matrix4` là toán CPU
 * thuần; chỉ `WebGLRenderer` mới cần context. Nên tệp này đo THẲNG hàm thật,
 * không đo một bản sao logic (bản sao thì lỗi tiêm vào hàm thật sẽ không bắt được).
 *
 * ★ CÁCH ĐO: đọc NGƯỢC từ buffer đỉnh đã dựng (`position` attribute) ra hộp bao,
 * thay vì đọc lại tham số đã truyền vào. Đo ĐẦU RA THẬT là cách duy nhất bắt
 * được lỗi nằm BÊN TRONG hàm.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  demDinhVaChiSo,
  hinhHocDonViTuMoTa,
  hinhHocHopBaoDonVi,
  maTranDatMay,
} from "./hinhHocTuMoTa";
import { DANH_SACH_KHOI, hinhHocKhoi, type MoTaKhoi, type VaiTroHop } from "../hinhKhoiMay";

/* ═════════════════════════════════════════════════════════════════════════ */
/* Dụng cụ đo — đọc NGƯỢC từ buffer ra số, không đọc lại tham số đầu vào     */
/* ═════════════════════════════════════════════════════════════════════════ */

/** Hộp bao THẬT của một geometry, tính từ chính buffer `position`. */
function hopBaoThat(g: THREE.BufferGeometry): {
  min: THREE.Vector3;
  max: THREE.Vector3;
  tam: THREE.Vector3;
  co: THREE.Vector3;
} {
  const pos = g.getAttribute("position");
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < pos.count; i++) {
    min.x = Math.min(min.x, pos.getX(i));
    min.y = Math.min(min.y, pos.getY(i));
    min.z = Math.min(min.z, pos.getZ(i));
    max.x = Math.max(max.x, pos.getX(i));
    max.y = Math.max(max.y, pos.getY(i));
    max.z = Math.max(max.z, pos.getZ(i));
  }
  return {
    min,
    max,
    tam: new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5),
    co: new THREE.Vector3().subVectors(max, min),
  };
}

/**
 * Tập giá trị vertex-color RIÊNG BIỆT trong geometry (làm tròn 4 chữ số).
 * Mọi kênh r/g/b mang cùng hệ số sáng nên chỉ cần đọc kênh r.
 */
function heSoSangCoTrong(g: THREE.BufferGeometry): number[] {
  const mau = g.getAttribute("color");
  const tap = new Set<number>();
  for (let i = 0; i < mau.count; i++) tap.add(Math.round(mau.getX(i) * 10_000) / 10_000);
  return [...tap].sort((a, b) => a - b);
}

/**
 * Mô tả MỘT-hộp-con dựng tay — cô lập đúng một hộp để hộp bao của geometry
 * CHÍNH LÀ hộp đó (hộp con khác trong khối thật sẽ làm nhiễu phép đo dấu/tỉ lệ).
 */
function moTaMotHop(
  tam: { x: number; y: number; z: number },
  co: { x: number; y: number; z: number },
  vaiTro: VaiTroHop = "than",
): MoTaKhoi {
  return {
    khoi: "tram_chung",
    kichThuocMm: { rongMm: 1000, caoMm: 1000, sauMm: 1000 },
    kichThuocMet: { rong: 1, cao: 1, sau: 1 },
    hopCon: [{ ten: "do", vaiTro, tam, co }],
    soTamGiacUocTinh: 12,
  };
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* 1. DẤU CỦA CẢ BA TRỤC khi dịch `tam`                                      */
/*    ⇒ CHẶN LỖI TIÊM 1 (đảo dấu trục Z), và cả đảo dấu X hoặc Y             */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("dấu của cả ba trục khi dịch tâm hộp con", () => {
  // Ba hộp con lệch tâm theo ĐÚNG MỘT trục mỗi lần. Đảo dấu trục nào thì hộp bao
  // đo được ở trục đó lật sang phía ngược ⇒ ĐỎ.
  const truc = [
    { ten: "x", tam: { x: 0.3, y: 0, z: 0 }, doc: "x" as const },
    { ten: "y", tam: { x: 0, y: 0.3, z: 0 }, doc: "y" as const },
    { ten: "z", tam: { x: 0, y: 0, z: 0.3 }, doc: "z" as const },
  ];

  for (const t of truc) {
    it(`tâm +0.3 trên trục ${t.ten} ⇒ hộp bao ở phía DƯƠNG của trục ${t.ten}`, () => {
      const g = hinhHocDonViTuMoTa(moTaMotHop(t.tam, { x: 0.2, y: 0.2, z: 0.2 }));
      const bb = hopBaoThat(g);
      // Dấu phải DƯƠNG (đảo dấu ⇒ -0.3 ⇒ ĐỎ)…
      expect(bb.tam[t.doc]).toBeGreaterThan(0);
      // …và trị đúng bằng +0.3.
      expect(bb.tam[t.doc]).toBeCloseTo(0.3, 6);
      g.dispose();
    });

    it(`tâm -0.3 trên trục ${t.ten} ⇒ hộp bao ở phía ÂM của trục ${t.ten}`, () => {
      const am = { x: -t.tam.x, y: -t.tam.y, z: -t.tam.z };
      const g = hinhHocDonViTuMoTa(moTaMotHop(am, { x: 0.2, y: 0.2, z: 0.2 }));
      const bb = hopBaoThat(g);
      expect(bb.tam[t.doc]).toBeLessThan(0);
      expect(bb.tam[t.doc]).toBeCloseTo(-0.3, 6);
      g.dispose();
    });
  }

  it("ba trục ĐỘC LẬP — dịch (0.1, 0.2, 0.3) ra đúng (0.1, 0.2, 0.3), không hoán vị", () => {
    // Ba trị KHÁC NHAU: lỗi hoán vị y↔z (hay gặp khi đổi hệ toạ độ) sẽ lọt nếu
    // ba số bằng nhau, nhưng bị bắt khi ba số khác nhau.
    const g = hinhHocDonViTuMoTa(
      moTaMotHop({ x: 0.1, y: 0.2, z: 0.3 }, { x: 0.1, y: 0.1, z: 0.1 }),
    );
    const bb = hopBaoThat(g);
    expect(bb.tam.x).toBeCloseTo(0.1, 6);
    expect(bb.tam.y).toBeCloseTo(0.2, 6);
    expect(bb.tam.z).toBeCloseTo(0.3, 6);
    g.dispose();
  });

  it("★ MẶT TRƯỚC ở z DƯƠNG — vạch chỉ hướng của MỌI khối thật phải ở z > 0", () => {
    // Phép đo bắt lỗi tiêm 1 trên DỮ LIỆU THẬT: hợp đồng của hinhKhoiMay là
    // "z = +0.5 là MẶT TRƯỚC". Đảo dấu z ⇒ vạch hướng của cả 7 khối nhảy ra sau
    // lưng máy ⇒ ĐỎ.
    for (const khoi of DANH_SACH_KHOI) {
      const moTa = hinhHocKhoi(khoi, { rongMm: 1400, caoMm: 1600, sauMm: 1200 });
      const vach = moTa.hopCon.filter((h) => h.vaiTro === "vach_huong");
      expect(vach.length, `${khoi} phải có đúng 1 vạch hướng`).toBe(1);
      // Mô tả khai vạch ở phía trước…
      expect(vach[0].tam.z, `${khoi}: mô tả khai vạch ở z dương`).toBeGreaterThan(0);
      // …và BẢN DỊCH phải giữ nguyên phía đó.
      const g = hinhHocDonViTuMoTa(moTaMotHop(vach[0].tam, vach[0].co, "vach_huong"));
      expect(hopBaoThat(g).tam.z, `${khoi}: geometry giữ vạch ở z dương`).toBeGreaterThan(0);
      g.dispose();
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* 2. KÍCH THƯỚC hộp con tỉ lệ đúng với `co` đầu vào                          */
/*    ⇒ CHẶN LỖI TIÊM 2 (trả hộp 1mm cho mọi máy)                            */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("kích thước hộp con tỉ lệ đúng với mô tả", () => {
  it("co (0.4, 0.6, 0.8) ⇒ hộp bao đo được đúng (0.4, 0.6, 0.8)", () => {
    // Ba trị khác nhau ⇒ lỗi hoán vị trục cũng bị bắt.
    const g = hinhHocDonViTuMoTa(moTaMotHop({ x: 0, y: 0, z: 0 }, { x: 0.4, y: 0.6, z: 0.8 }));
    const bb = hopBaoThat(g);
    expect(bb.co.x).toBeCloseTo(0.4, 6);
    expect(bb.co.y).toBeCloseTo(0.6, 6);
    expect(bb.co.z).toBeCloseTo(0.8, 6);
    g.dispose();
  });

  it("★ hộp con TO GẤP ĐÔI ⇒ hộp bao TO GẤP ĐÔI (tỉ lệ, không phải hằng số)", () => {
    // Lỗi tiêm 2 trả HẰNG SỐ 0.001 bất kể đầu vào. Phép đo TỈ SỐ dưới đây bắt nó
    // chắc chắn nhất: hằng số ⇒ tỉ số = 1, không phải 2.
    const nho = hinhHocDonViTuMoTa(moTaMotHop({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0.2, z: 0.2 }));
    const to = hinhHocDonViTuMoTa(moTaMotHop({ x: 0, y: 0, z: 0 }, { x: 0.4, y: 0.4, z: 0.4 }));
    const bbNho = hopBaoThat(nho);
    const bbTo = hopBaoThat(to);
    expect(bbTo.co.x / bbNho.co.x).toBeCloseTo(2, 5);
    expect(bbTo.co.y / bbNho.co.y).toBeCloseTo(2, 5);
    expect(bbTo.co.z / bbNho.co.z).toBeCloseTo(2, 5);
    nho.dispose();
    to.dispose();
  });

  it("★ hộp bao KHÔNG teo về 1mm — mọi khối THẬT cho hộp bao cỡ ĐƠN VỊ", () => {
    // Ghim hợp đồng "geometry dựng ở KÍCH THƯỚC ĐƠN VỊ" của docblock. Lỗi tiêm 2
    // cho hộp bao 0.001 trên cả 7 khối. Ngưỡng 0.2 rộng rãi có chủ đích: không
    // khối nào thật sự mỏng hơn thế, còn lỗi teo thì nhỏ hơn 200 lần.
    for (const khoi of DANH_SACH_KHOI) {
      const moTa = hinhHocKhoi(khoi, { rongMm: 1400, caoMm: 1600, sauMm: 1200 });
      const g = hinhHocDonViTuMoTa(moTa);
      const bb = hopBaoThat(g);
      expect(bb.co.x, `${khoi} bề rộng`).toBeGreaterThan(0.2);
      expect(bb.co.y, `${khoi} bề cao`).toBeGreaterThan(0.2);
      expect(bb.co.z, `${khoi} bề sâu`).toBeGreaterThan(0.2);
      // …và không phình vô hạn. ⚠ Trần là 1.25 chứ KHÔNG phải 1.0: đo được rằng
      // `buong_kiem_quang` ra bề rộng 1.06 và `ban_test` có `mat-ban` co.x = 1.04
      // — hộp con CỐ Ý nhô ra khỏi hộp bao (cửa băng tải ở tam.x = ±0.5 với
      // co.x = 0.06 thò 0.03 mỗi bên; mặt bàn rộng hơn thân). Đó là thiết kế của
      // `hinhKhoiMay`, không phải lỗi — nên trần phải nới, nhưng vẫn phải CÓ trần
      // để bắt hộp bao chạy loạn. (Phép đo này ban đầu viết trần 1.0 và ĐỎ ngay
      // lần chạy đầu; giữ lại ghi chú để lần sau không ai siết lại thành 1.0.)
      expect(bb.co.x, `${khoi} bề rộng`).toBeLessThan(1.25);
      expect(bb.co.y, `${khoi} bề cao`).toBeLessThan(1.25);
      expect(bb.co.z, `${khoi} bề sâu`).toBeLessThan(1.25);
      g.dispose();
    }
  });

  it("kích thước 0 hoặc âm bị kẹp về 1e-4 chứ không ném / không NaN", () => {
    const g = hinhHocDonViTuMoTa(moTaMotHop({ x: 0, y: 0, z: 0 }, { x: 0, y: -5, z: 0.5 }));
    const bb = hopBaoThat(g);
    expect(Number.isFinite(bb.co.x)).toBe(true);
    expect(bb.co.x).toBeCloseTo(1e-4, 8);
    expect(bb.co.y).toBeCloseTo(1e-4, 8);
    expect(bb.co.z).toBeCloseTo(0.5, 6);
    g.dispose();
  });

  it("mô tả RỖNG ⇒ hộp đơn vị 1×1×1 (không geometry rỗng — BatchedMesh sẽ ném)", () => {
    const goc = moTaMotHop({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    const rong = hinhHocDonViTuMoTa({ ...goc, hopCon: [] });
    const bb = hopBaoThat(rong);
    expect(bb.co.x).toBeCloseTo(1, 6);
    expect(bb.co.y).toBeCloseTo(1, 6);
    expect(bb.co.z).toBeCloseTo(1, 6);
    rong.dispose();
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* 3. HỆ SỐ SÁNG theo vai trò hộp                                            */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("hệ số sáng HE_SO_SANG theo vaiTro", () => {
  // Bảng ĐỘC LẬP viết tay theo §10.1 — cố ý KHÔNG import hằng số của module. Nếu
  // import thì test tự thoả (đổi hằng số là test đổi theo), đo được số 0.
  const mongDoi: Record<VaiTroHop, number> = {
    than: 1,
    phu: 0.82,
    cua: 0.66,
    vach_huong: 1.45,
  };

  for (const [vaiTro, k] of Object.entries(mongDoi) as [VaiTroHop, number][]) {
    it(`vaiTro "${vaiTro}" ⇒ vertex color = ${k} trên cả ba kênh`, () => {
      const g = hinhHocDonViTuMoTa(
        moTaMotHop({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }, vaiTro),
      );
      expect(heSoSangCoTrong(g)).toEqual([k]);
      // Ba kênh BẰNG NHAU — đây là hệ số sáng, không phải màu ám sắc.
      const mau = g.getAttribute("color");
      expect(mau.getY(0)).toBeCloseTo(k, 6);
      expect(mau.getZ(0)).toBeCloseTo(k, 6);
      g.dispose();
    });
  }

  it("★ THỨ TỰ ĐỘ SÁNG: vach_huong > than > phu > cua (đọc được hướng máy từ xa)", () => {
    expect(mongDoi.vach_huong).toBeGreaterThan(mongDoi.than);
    expect(mongDoi.than).toBeGreaterThan(mongDoi.phu);
    expect(mongDoi.phu).toBeGreaterThan(mongDoi.cua);
  });

  it("khối THẬT nhiều vai trò ⇒ geometry gộp mang NHIỀU hệ số phân biệt được", () => {
    // Nếu bản dịch đánh mất vai trò (gán 1 cho tất cả) thì chỉ còn MỘT giá trị ⇒ ĐỎ.
    const moTa = hinhHocKhoi("buong_kiem_quang", { rongMm: 1400, caoMm: 1600, sauMm: 1200 });
    const soVaiTro = new Set(moTa.hopCon.map((h) => h.vaiTro)).size;
    expect(soVaiTro).toBeGreaterThan(1);
    const g = hinhHocDonViTuMoTa(moTa);
    expect(heSoSangCoTrong(g).length).toBe(soVaiTro);
    g.dispose();
  });

  it("hộp bao đơn vị trần có màu = 1 đều (không ám sắc, không thiếu attribute)", () => {
    const g = hinhHocHopBaoDonVi();
    expect(g.getAttribute("color")).toBeTruthy();
    expect(heSoSangCoTrong(g)).toEqual([1]);
    expect(hopBaoThat(g).co.x).toBeCloseTo(1, 6);
    g.dispose();
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* 4. maTranDatMay — NÂNG NỬA CHIỀU CAO (máy đứng TRÊN sàn, không lún)       */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("maTranDatMay", () => {
  /** Tách ma trận ra vị trí / xoay / co giãn để đo từng phần. */
  function tach(m: THREE.Matrix4) {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    return { p, q, s };
  }

  it("★ NÂNG NỬA CHIỀU CAO — y đầu vào là ĐÁY máy, tâm phải ở y + cao/2", () => {
    // Quên bước này ⇒ nửa dưới mọi máy chìm dưới sàn. Cao = 3 nên nửa = 1.5:
    // số lẻ, phân biệt được với "không nâng" (0) và "nâng cả chiều cao" (3).
    const m = maTranDatMay(
      new THREE.Matrix4(),
      { x: 0, y: 0, z: 0 },
      { rong: 2, cao: 3, sau: 4 },
      0,
    );
    expect(tach(m).p.y).toBeCloseTo(1.5, 6);
  });

  it("★ ĐÁY hộp đơn vị sau biến đổi nằm ĐÚNG trên mặt sàn y = viTri.y", () => {
    // Phép đo ĐỘC LẬP với phép trên: biến đổi thật một đỉnh đáy (y = -0.5 trong
    // không gian đơn vị) rồi xem nó rơi ở đâu. Đây là câu hỏi người dùng thật hỏi
    // ("máy có lún sàn không"), không phải câu hỏi về nội dung ma trận.
    for (const cao of [0.5, 1.6, 3, 12]) {
      const m = maTranDatMay(
        new THREE.Matrix4(),
        { x: 7, y: 2, z: -3 },
        { rong: 2, cao, sau: 4 },
        0,
      );
      const day = new THREE.Vector3(0, -0.5, 0).applyMatrix4(m);
      const dinh = new THREE.Vector3(0, 0.5, 0).applyMatrix4(m);
      expect(day.y, `cao=${cao}: đáy chạm sàn`).toBeCloseTo(2, 6);
      expect(dinh.y, `cao=${cao}: đỉnh cách sàn đúng chiều cao`).toBeCloseTo(2 + cao, 6);
    }
  });

  it("x và z KHÔNG bị nâng — chỉ y được cộng nửa chiều cao", () => {
    const m = maTranDatMay(
      new THREE.Matrix4(),
      { x: 5, y: 0, z: -7 },
      { rong: 2, cao: 3, sau: 4 },
      0,
    );
    const { p } = tach(m);
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.z).toBeCloseTo(-7, 6);
  });

  it("co giãn = kích thước THẬT (mét), đúng trục: rong→x, cao→y, sau→z", () => {
    const m = maTranDatMay(
      new THREE.Matrix4(),
      { x: 0, y: 0, z: 0 },
      { rong: 2, cao: 3, sau: 4 },
      0,
    );
    const { s } = tach(m);
    expect(s.x).toBeCloseTo(2, 6);
    expect(s.y).toBeCloseTo(3, 6);
    expect(s.z).toBeCloseTo(4, 6);
  });

  it("xoay quanh trục ĐỨNG (y) — 90° đưa +x sang -z, KHÔNG lật máy nằm ngang", () => {
    const m = maTranDatMay(
      new THREE.Matrix4(),
      { x: 0, y: 0, z: 0 },
      { rong: 1, cao: 1, sau: 1 },
      Math.PI / 2,
    );
    // Vector từ tâm (0, 0.5, 0) tới điểm +x đã biến đổi = trục ngang của máy.
    const huong = new THREE.Vector3(1, 0, 0).applyMatrix4(m).sub(new THREE.Vector3(0, 0.5, 0));
    expect(huong.x).toBeCloseTo(0, 5);
    expect(huong.y).toBeCloseTo(0, 5); // KHÔNG lật: trục ngang giữ y = 0
    expect(huong.z).toBeCloseTo(-1, 5);
  });

  it("kích thước 0 / âm bị kẹp ở SCALE — ma trận không suy biến, không NaN", () => {
    const m = maTranDatMay(
      new THREE.Matrix4(),
      { x: 0, y: 0, z: 0 },
      { rong: 0, cao: -3, sau: 4 },
      0,
    );
    const { s } = tach(m);
    expect(s.x).toBeCloseTo(1e-4, 8);
    // ⚠ GHIM HÀNH VI HIỆN TẠI, không khẳng định nó đúng: `cao` âm bị kẹp ở scale
    // nhưng VỊ TRÍ vẫn dùng `cao` gốc (y + (-3)/2). Dữ liệu âm không tới được đây
    // (hinhKhoiMay đã kẹp ở KICH_THUOC_TOI_THIEU_MM), nên đây là hàng rào cuối.
    // Nếu ai đổi cách kẹp thì test này ĐỎ và người đó phải quyết định có chủ đích.
    expect(tach(m).p.y).toBeCloseTo(-1.5, 6);
    expect(Number.isNaN(s.y)).toBe(false);
    expect(m.elements.every((e) => Number.isFinite(e))).toBe(true);
  });

  it("ghi vào ma trận ĐÍCH truyền vào và trả về CHÍNH nó (không cấp phát mới)", () => {
    // Hợp đồng cấp phát: hàm chạy mỗi khung cho 43 máy — cấp phát mới là rác GC.
    const dich = new THREE.Matrix4();
    const ra = maTranDatMay(dich, { x: 1, y: 2, z: 3 }, { rong: 1, cao: 1, sau: 1 }, 0);
    expect(ra).toBe(dich);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* 5. demDinhVaChiSo — cấp phát BatchedMesh vừa đủ                           */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("demDinhVaChiSo", () => {
  it("đếm ĐÚNG đỉnh và chỉ số của một hộp đơn (24 đỉnh, 36 chỉ số)", () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    expect(demDinhVaChiSo(g)).toEqual({ dinh: 24, chiSo: 36 });
    g.dispose();
  });

  it("geometry gộp n hộp ⇒ đỉnh = n × 24 (đếm hụt ⇒ BatchedMesh cấp phát thiếu)", () => {
    for (const khoi of DANH_SACH_KHOI) {
      const moTa = hinhHocKhoi(khoi, { rongMm: 1400, caoMm: 1600, sauMm: 1200 });
      const g = hinhHocDonViTuMoTa(moTa);
      const d = demDinhVaChiSo(g);
      expect(d.dinh, `${khoi} đỉnh`).toBe(moTa.hopCon.length * 24);
      expect(d.chiSo, `${khoi} chỉ số`).toBe(moTa.hopCon.length * 36);
      g.dispose();
    }
  });

  it("geometry không có index ⇒ chiSo = 0, không ném", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    expect(demDinhVaChiSo(g)).toEqual({ dinh: 3, chiSo: 0 });
    g.dispose();
  });
});
