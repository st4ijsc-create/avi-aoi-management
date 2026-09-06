/**
 * docBanVe.ts — Phần THUẦN của con đường A: đọc kết quả nhập bản vẽ (§10A.1).
 *
 * Tách khỏi `NhapBanVe.tsx` vì phần khó nhất của con đường A là TOÁN chứ không
 * phải giao diện: quyết định định dạng, đo bbox từng node, đếm tam giác, và ra
 * phán quyết CHẶN theo ngưỡng. Trong .tsx thì cả bốn thứ đó không test được
 * (vitest environment "node", RB-8.1).
 *
 * ★ Module THUẦN: không import three.js, không import react, không đụng `Worker`.
 * ★ Tất định: không Math.random(), không Date.now().
 */

import { bboxRong, bboxTuDiem, gopBBox, type BBox } from "./heToaDo";
import type { NodeHinhHoc } from "./tachTangTuHinhHoc";
import type { DonViNguon } from "./hieuChinhNhapModel";

// ---------------------------------------------------------------------------
// Ngưỡng CHẶN (§10A.1) — vỏ nhà là hình học TĨNH nên chịu được nhiều tam giác
// hơn máy móc, nhưng vẫn phải có trần
// ---------------------------------------------------------------------------

/** Trần số tam giác của một file bản vẽ (§10A.1). */
export const TRAN_TAM_GIAC = 2_000_000;

/** Trần dung lượng file, byte (§10A.1: 60 MB). */
export const TRAN_BYTE = 60 * 1024 * 1024;

/** Định dạng nhận ở v1 (§10A.1). `.dxf`/`.dwg` KHÔNG nhận — cần thư viện riêng. */
export type DinhDangBanVe = "step" | "iges" | "brep" | "gltf";

/** Đuôi tệp → định dạng. `null` = KHÔNG NHẬN (khác với "chưa biết"). */
export function dinhDangTuTenTep(tenTep: string): DinhDangBanVe | null {
  const duoi = tenTep.toLowerCase().split(".").pop() ?? "";
  switch (duoi) {
    case "step":
    case "stp":
      return "step";
    case "iges":
    case "igs":
      return "iges";
    case "brep":
      return "brep";
    case "glb":
    case "gltf":
      return "gltf";
    default:
      // .dxf/.dwg rơi vào đây có CHỦ Ý: §10A.1 hoãn chúng sang §16. Trả null để
      // UI nói "chưa nhận định dạng này", không im lặng thử rồi hỏng khó hiểu.
      return null;
  }
}

/** Định dạng nào phải đi qua worker occt-import-js (CAD đặc)? */
export function canOcct(dinhDang: DinhDangBanVe): boolean {
  return dinhDang !== "gltf";
}

/**
 * ⚠ `linearUnit` truyền cho occt-import-js LUÔN là `millimeter`.
 *
 * Không phải vì file CAD chắc chắn là mm — mà vì NGƯỢC LẠI: file CAD không tự
 * khai đơn vị một cách đáng tin (§10A.1), nên để occt "tự quy đổi" là giao quyết
 * định cho một lời khai không kiểm được. Ta nhận số THÔ, rồi để NGƯỜI chọn đơn
 * vị trong hộp thoại hiệu chỉnh — nơi có thước tỉ lệ và hình người 1,7 m để họ
 * nhìn ra sai lệch bằng mắt. Đó là cả điểm của §10A.1.
 */
export const DON_VI_OCCT = "millimeter" as const;

// ---------------------------------------------------------------------------
// Hình dạng dữ liệu mà occt-import-js trả về (README v0.0.23)
// ---------------------------------------------------------------------------

export interface OcctMesh {
  name?: string;
  attributes?: { position?: { array?: ArrayLike<number> } };
  index?: { array?: ArrayLike<number> };
}

export interface OcctNode {
  name?: string;
  meshes?: number[];
  children?: OcctNode[];
}

export interface KetQuaOcct {
  success?: boolean;
  root?: OcctNode;
  meshes?: OcctMesh[];
}

/** Số tam giác của một mesh: index/3, hoặc position/9 khi không có index. */
export function soTamGiacCuaMesh(mesh: OcctMesh): number {
  const idx = mesh.index?.array;
  if (idx && idx.length > 0) return Math.floor(idx.length / 3);
  const pos = mesh.attributes?.position?.array;
  if (pos && pos.length > 0) return Math.floor(pos.length / 9);
  return 0;
}

/**
 * BBox của một mesh trong hệ TRỤC NGUỒN của file, đơn vị NGUỒN.
 *
 * ⚠ Chưa hiệu chỉnh gì cả — đây là số THÔ. Quy đổi đơn vị và đổi trục xảy ra ở
 * `hieuChinhNhapModel.apDungHieuChinh`, SAU khi người dùng chọn trong hộp thoại.
 */
export function bboxCuaMesh(mesh: OcctMesh): BBox {
  const pos = mesh.attributes?.position?.array;
  if (!pos || pos.length < 3) return bboxRong();
  const diem: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i + 2 < pos.length; i += 3) {
    diem.push({ x: Number(pos[i]), y: Number(pos[i + 1]), z: Number(pos[i + 2]) });
  }
  return bboxTuDiem(diem);
}

/** Tóm tắt một lượt nhập, trước hiệu chỉnh. */
export interface TomTatBanVe {
  /** Node cấp một của cây file, để `tachTangTuHinhHoc` chiếu lên trục cao. */
  nodes: NodeHinhHoc[];
  soNode: number;
  soTamGiac: number;
  /** BBox tổng, ĐƠN VỊ NGUỒN, hệ trục NGUỒN. */
  bbox: BBox;
  /** occt báo đọc thành công không. `false` ⇒ mọi số dưới đây vô nghĩa. */
  thanhCong: boolean;
}

/**
 * Gộp kết quả occt thành tóm tắt + danh sách node cho bước tách tầng.
 *
 * Cây node của file được GIỮ (không flatten) đúng theo §10A.1 — người dùng cần
 * ẩn/hiện/xoá từng bộ phận (mái, tường, cột) độc lập sau khi nhập. Ở đây ta chỉ
 * làm PHẲNG một cấp để đo bbox; cây gốc vẫn nằm trong `KetQuaOcct.root`.
 */
export function tomTatKetQuaOcct(kq: KetQuaOcct): TomTatBanVe {
  const meshes = kq.meshes ?? [];
  const nodes: NodeHinhHoc[] = [];
  let soTamGiac = 0;
  let bbox = bboxRong();

  // Đi cây để lấy TÊN thật của node (mesh chỉ mang tên hình học, node mang tên
  // bộ phận — "Mái", "Tường trục A"). Mesh không được node nào tham chiếu vẫn
  // được tính: bỏ nó đi làm số tam giác báo cáo THẤP hơn thực tế, và trần chặn
  // sẽ hụt đúng lượng đó.
  const daDung = new Set<number>();
  function di(node: OcctNode | undefined, tenCha: string) {
    if (!node) return;
    const ten = node.name && node.name.trim() !== "" ? node.name : tenCha;
    for (const i of node.meshes ?? []) {
      const m = meshes[i];
      if (!m || daDung.has(i)) continue;
      daDung.add(i);
      const b = bboxCuaMesh(m);
      const tg = soTamGiacCuaMesh(m);
      nodes.push({ ten: m.name && m.name.trim() !== "" ? m.name : `${ten}#${i}`, bbox: b, soTamGiac: tg });
      soTamGiac += tg;
      bbox = gopBBox(bbox, b);
    }
    for (const con of node.children ?? []) di(con, ten);
  }
  di(kq.root, "root");

  for (let i = 0; i < meshes.length; i += 1) {
    if (daDung.has(i)) continue;
    const m = meshes[i];
    const b = bboxCuaMesh(m);
    const tg = soTamGiacCuaMesh(m);
    nodes.push({ ten: m.name && m.name.trim() !== "" ? m.name : `mesh#${i}`, bbox: b, soTamGiac: tg });
    soTamGiac += tg;
    bbox = gopBBox(bbox, b);
  }

  return {
    nodes,
    soNode: nodes.length,
    soTamGiac,
    bbox,
    // `success` vắng mặt được coi là THẤT BẠI, không phải thành công: một kết
    // quả không tự khai thành công thì ta không có căn cứ nào để tin nó (NT-3).
    thanhCong: kq.success === true,
  };
}

// ---------------------------------------------------------------------------
// Phán quyết CHẶN (§10A.1)
// ---------------------------------------------------------------------------

/** Lý do chặn — `null` ở `ly_do` nghĩa là KHÔNG chặn. */
export interface PhanQuyetChan {
  chan: boolean;
  /** Hậu tố khoá i18n. */
  lyDo:
    | "dinhDangKhongNhan"
    | "quaNhieuTamGiac"
    | "fileQuaLon"
    | "docThatBai"
    | "khongCoHinhHoc"
    | null;
  soTamGiac: number;
  kichThuocByte: number;
}

/**
 * Có chặn lượt nhập này không (§10A.1)?
 *
 * ⚠ Thứ tự kiểm CÓ CHỦ Ý: định dạng → dung lượng → đọc-được → có-hình-học →
 * số-tam-giác. Kiểm dung lượng TRƯỚC khi đọc vì đọc một file 500 MB trong worker
 * là cách chắc chắn để treo tab; nói "quá lớn" ngay là rẻ hơn mọi cách khác.
 *
 * ⚠ "0 tam giác" là CHẶN, không phải "nhập được một toà nhà rỗng": file đọc
 * xong mà không có hình học nghĩa là ta không có gì để dựng, và im lặng cho qua
 * sẽ tạo ra một toà nhà vô hình mà người dùng không hiểu vì sao (NT-3).
 */
export function phanQuyetChan(
  tomTat: TomTatBanVe | null,
  kichThuocByte: number,
  dinhDang: DinhDangBanVe | null,
  tranTamGiac: number = TRAN_TAM_GIAC,
  tranByte: number = TRAN_BYTE,
): PhanQuyetChan {
  const soTamGiac = tomTat?.soTamGiac ?? 0;
  const co = { soTamGiac, kichThuocByte };

  if (dinhDang === null) return { chan: true, lyDo: "dinhDangKhongNhan", ...co };
  if (kichThuocByte > tranByte) return { chan: true, lyDo: "fileQuaLon", ...co };
  if (tomTat === null || !tomTat.thanhCong) return { chan: true, lyDo: "docThatBai", ...co };
  if (soTamGiac <= 0) return { chan: true, lyDo: "khongCoHinhHoc", ...co };
  if (soTamGiac > tranTamGiac) return { chan: true, lyDo: "quaNhieuTamGiac", ...co };
  return { chan: false, lyDo: null, ...co };
}

// ---------------------------------------------------------------------------
// Đơn vị đoán ban đầu của hộp thoại
// ---------------------------------------------------------------------------

/**
 * Đơn vị ĐỀ NGHỊ cho hộp thoại, suy từ độ lớn bbox thô.
 *
 * ★★★ ĐÂY LÀ MỘT PHỎNG ĐOÁN, VÀ NÓ PHẢI TỰ KHAI LÀ PHỎNG ĐOÁN (NT-4). Hàm này
 *   KHÔNG được dùng để tự động áp đơn vị — nó chỉ đặt giá trị KHỞI ĐẦU của
 *   dropdown, và hộp thoại vẫn BẮT BUỘC người dùng xác nhận bằng mắt qua thước
 *   tỉ lệ + hình người 1,7 m. Bỏ bước xác nhận đó để "tiện hơn" là bỏ đúng thứ
 *   §10A.1 dựng cả một hộp thoại để có.
 *
 * Suy luận: một nhà xưởng có cạnh dài nhất trong khoảng 10–500 m. Chiếu ngược
 * lại, số thô trong file phải rơi vào dải nào để ra khoảng đó.
 */
export function donViDeNghi(bbox: BBox, canhNhaXuongMin = 10, canhNhaXuongMax = 500): DonViNguon {
  const canh = Math.max(
    bbox.maxX - bbox.minX,
    bbox.maxY - bbox.minY,
    bbox.maxZ - bbox.minZ,
  );
  if (!Number.isFinite(canh) || canh <= 0) return "mm";

  // Thử từng đơn vị, chọn cái đưa cạnh dài nhất vào dải nhà xưởng hợp lý.
  const ungVien: { donVi: DonViNguon; heSoSangMet: number }[] = [
    { donVi: "mm", heSoSangMet: 0.001 },
    { donVi: "cm", heSoSangMet: 0.01 },
    { donVi: "m", heSoSangMet: 1 },
    { donVi: "inch", heSoSangMet: 0.0254 },
  ];
  for (const uv of ungVien) {
    const met = canh * uv.heSoSangMet;
    if (met >= canhNhaXuongMin && met <= canhNhaXuongMax) return uv.donVi;
  }
  // Không đơn vị nào cho ra một nhà xưởng hợp lý ⇒ giữ 'mm' (mặc định CAD của
  // `CAU_HINH_MAC_DINH`) và để người dùng quyết. KHÔNG đoán bừa một cái khác:
  // một phỏng đoán sai mà trông tự tin còn tệ hơn mặc định trung tính.
  return "mm";
}

/** Đơn vị đề nghị có phải là ĐOÁN CHẮC không (có rơi vào dải hợp lý)? */
export function donViDeNghiChacChan(bbox: BBox, canhMin = 10, canhMax = 500): boolean {
  const dn = donViDeNghi(bbox, canhMin, canhMax);
  const heSo: Record<DonViNguon, number> = { mm: 0.001, cm: 0.01, m: 1, inch: 0.0254 };
  const canh = Math.max(
    bbox.maxX - bbox.minX,
    bbox.maxY - bbox.minY,
    bbox.maxZ - bbox.minZ,
  );
  if (!Number.isFinite(canh) || canh <= 0) return false;
  const met = canh * heSo[dn];
  return met >= canhMin && met <= canhMax;
}
