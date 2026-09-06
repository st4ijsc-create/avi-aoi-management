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
import { HE_SO_SANG_MM, DANH_SACH_DON_VI, type DonViNguon } from "./hieuChinhNhapModel";

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
 * ═════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐƠN VỊ ĐỀ NGHỊ — và vì sao bản Đợt 3 SAI TRÊN CẢ DẢI MÁY CÔNG NGHIỆP
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Bản trước quét mm→cm→m→inch và trả về CÁI ĐẦU TIÊN đưa cạnh dài nhất vào dải
 * 10–500 m, rồi khai `chacChan = true` cho mọi kết quả tìm được. QA đo toàn dải
 * và bắt được hai lớp sai KHÁC NHAU cùng nằm dưới một lời khai "chắc chắn":
 *
 *   cạnh thô     10 -> 'm'  chacChan=TRUE   (khối 10 mm hoá 10 m — sai 1000 lần)
 *   cạnh thô  2 000 -> 'cm' chacChan=TRUE   (máy 2 m hoá 20 m)
 *   dải sai:  10 → 10 425 — tức TRỌN dải kích thước máy công nghiệp (0,3–5 m).
 *
 * ─── Sai lầm 1: NHIỀU đơn vị cùng hợp lý, nhưng chỉ cái đầu được nói ra ──────
 * Với cạnh thô 2 000 thì CẢ 'cm' (20 m) LẪN 'inch' (50,8 m) đều rơi vào dải nhà
 * xưởng. Với 10 000 thì có tới BA ('mm' 10 m, 'cm' 100 m, 'inch' 254 m). Bản cũ
 * lấy cái đầu theo thứ tự liệt kê — một thứ tự TUỲ TIỆN, không mang thông tin —
 * rồi khai chắc chắn. Đó không phải phỏng đoán tốt nhất, đó là **bốc thăm rồi
 * ký tên**. Đúng NT-4: một phỏng đoán phải TỰ KHAI là phỏng đoán, và "có hai câu
 * trả lời hợp lý" là thông tin PHẢI nói ra chứ không phải thứ để giấu đi.
 *
 * ─── Sai lầm 2: dải 10–500 m là dải NHÀ XƯỞNG, nhưng hộp thoại còn nhập MÁY ──
 * §10A.1 dùng chung hộp thoại hiệu chỉnh cho cả vỏ nhà xưởng lẫn model máy. Một
 * cái máy 0,3–5 m KHÔNG có cách đọc nào cho ra 10–500 m, nên mọi đề nghị cho nó
 * đều là ép một câu trả lời sai vào một câu hỏi sai. Vì thế `donViDeNghi` nay
 * nhận NGỮ CẢNH loại vật thể, và dải hợp lý đi theo ngữ cảnh đó.
 *
 * ⚠⚠ Và đây là lý do hình người 1,7 m ở §10A.1 KHÔNG cứu được ca này: thước đo
 *    thị giác ấy chỉ hữu ích khi vật thể LỚN HƠN người. Với một cái máy 0,3 m
 *    hay một khối 10 mm, hình người biến thành một vệt và người dùng không đọc
 *    được gì từ nó. Cảnh báo `chacChan = false` là lớp bảo vệ DUY NHẤT còn lại.
 *
 * ⚠⚠ HỆ SỐ QUY ĐỔI NAY IMPORT TỪ `hieuChinhNhapModel.HE_SO_SANG_MM` (G6). Trước
 *    đó file này giữ BẢN SAO THỨ HAI của bảng hệ số (`{mm:.001, cm:.01, m:1,
 *    inch:.0254}`) viết trong CHÍNH hai hàm dưới. QA tiêm sai hệ số inch 10× vào
 *    cả hai bản và **378/378 lưới vẫn XANH** — vì không assertion nào từng đi
 *    qua nhánh 'inch'. Hai bản sao + không lưới nào canh = một hằng số vật lý
 *    trôi tự do. Nay: MỘT bảng, và có lưới đi qua nhánh inch (xem
 *    `docBanVe.unit.test.ts`, ca "cạnh thô 600 ⇒ inch").
 */

/** Loại vật thể đang nhập — quyết định dải kích thước nào là "hợp lý". */
export type LoaiVatTheNhap = "nhaXuong" | "may";

/**
 * Dải kích thước hợp lý (MÉT) theo loại vật thể.
 *
 * `nhaXuong` 10–500 m giữ nguyên §10A.1. `may` 0,3–5 m là dải máy AOI/AVI công
 * nghiệp — chính dải mà bản cũ trả lời sai-mà-tự-tin trên toàn bộ.
 */
export const DAI_HOP_LY_MET: Readonly<Record<LoaiVatTheNhap, { min: number; max: number }>> =
  Object.freeze({
    nhaXuong: { min: 10, max: 500 },
    may: { min: 0.3, max: 5 },
  });

/** Cạnh DÀI NHẤT của một bbox. `null` khi bbox suy biến/không hữu hạn. */
function canhDaiNhat(bbox: BBox): number | null {
  const canh = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY, bbox.maxZ - bbox.minZ);
  return Number.isFinite(canh) && canh > 0 ? canh : null;
}

/** Kết quả suy đoán đơn vị — mang theo CẢ sự nhập nhằng, không giấu đi. */
export interface SuyDoanDonVi {
  /** Đơn vị đặt vào dropdown. Luôn có giá trị (mặc định 'mm' khi không suy được). */
  donVi: DonViNguon;
  /**
   * Chỉ `true` khi có ĐÚNG MỘT đơn vị cho ra kích thước hợp lý. Hai ứng viên trở
   * lên ⇒ `false` + `ungVien` liệt kê ra, để UI nói "có thể là cm hoặc inch"
   * thay vì im lặng chọn một cái.
   */
  chacChan: boolean;
  /** MỌI đơn vị cho ra kích thước hợp lý. Rỗng = không cái nào hợp lý. */
  ungVien: DonViNguon[];
  /** Vì sao không chắc — để UI hiện đúng câu, không phải để người dùng đoán. */
  lyDo: "duyNhat" | "nhapNhang" | "khongCoUngVien" | "bboxSuyBien";
}

/**
 * Suy đoán đơn vị ĐẦY ĐỦ, kèm nhập nhằng. Đây là hàm CHÍNH; `donViDeNghi` và
 * `donViDeNghiChacChan` là hai lối tắt đọc lại kết quả của nó (một nguồn).
 *
 * ★★★ VẪN CHỈ LÀ ĐỀ NGHỊ (NT-4). Hàm này KHÔNG được dùng để tự động áp đơn vị —
 *   nó chỉ đặt giá trị KHỞI ĐẦU của dropdown; hộp thoại vẫn BẮT BUỘC người dùng
 *   xác nhận bằng mắt. Bỏ bước xác nhận đó để "tiện hơn" là bỏ đúng thứ §10A.1
 *   dựng cả một hộp thoại để có.
 */
export function suyDoanDonVi(
  bbox: BBox,
  loai: LoaiVatTheNhap = "nhaXuong",
  daiTuyChon?: { min: number; max: number },
): SuyDoanDonVi {
  const canh = canhDaiNhat(bbox);
  if (canh === null) {
    return { donVi: "mm", chacChan: false, ungVien: [], lyDo: "bboxSuyBien" };
  }

  const dai = daiTuyChon ?? DAI_HOP_LY_MET[loai];
  // ★ MỘT bảng hệ số (HE_SO_SANG_MM), không bản sao. /1000 vì bảng đó ra MILIMÉT.
  const ungVien = DANH_SACH_DON_VI.filter((dv) => {
    const met = (canh * HE_SO_SANG_MM[dv]) / 1000;
    return met >= dai.min && met <= dai.max;
  });

  if (ungVien.length === 1) {
    return { donVi: ungVien[0], chacChan: true, ungVien: [...ungVien], lyDo: "duyNhat" };
  }
  if (ungVien.length === 0) {
    // Không đơn vị nào hợp lý ⇒ giữ 'mm' (mặc định CAD của `CAU_HINH_MAC_DINH`) và
    // để người dùng quyết. KHÔNG đoán bừa: một phỏng đoán sai mà trông tự tin còn
    // tệ hơn một mặc định trung tính.
    return { donVi: "mm", chacChan: false, ungVien: [], lyDo: "khongCoUngVien" };
  }
  // ★ NHIỀU ứng viên: vẫn đặt một giá trị vào dropdown (UI cần một giá trị khởi
  //   đầu), nhưng chacChan=FALSE và liệt kê hết để UI khai nhập nhằng ra.
  return { donVi: ungVien[0], chacChan: false, ungVien: [...ungVien], lyDo: "nhapNhang" };
}

/**
 * Đơn vị ĐỀ NGHỊ cho dropdown. Lối tắt của `suyDoanDonVi`.
 *
 * ⚠ Chữ ký giữ hai tham số dải để không phá call site cũ, nhưng nay chúng là
 *   `daiTuyChon` TƯỜNG MINH — truyền vào là ghi đè dải của `loai`.
 */
export function donViDeNghi(
  bbox: BBox,
  canhNhaXuongMin?: number,
  canhNhaXuongMax?: number,
  loai: LoaiVatTheNhap = "nhaXuong",
): DonViNguon {
  const dai =
    canhNhaXuongMin !== undefined && canhNhaXuongMax !== undefined
      ? { min: canhNhaXuongMin, max: canhNhaXuongMax }
      : undefined;
  return suyDoanDonVi(bbox, loai, dai).donVi;
}

/**
 * Đơn vị đề nghị có phải ĐOÁN CHẮC không?
 *
 * ★★★ ĐỔI NGHĨA so với Đợt 3: "chắc chắn" nay nghĩa **CHỈ MỘT** đơn vị cho ra
 *   kích thước hợp lý. Trước đây nó chỉ hỏi "cái đã chọn có hợp lý không" — câu
 *   đó luôn đúng theo dựng, nên nó là một phép kiểm KHÔNG BAO GIỜ nói không với
 *   ca nhập nhằng, tức một chỉ báo không biết kêu.
 */
export function donViDeNghiChacChan(
  bbox: BBox,
  canhMin?: number,
  canhMax?: number,
  loai: LoaiVatTheNhap = "nhaXuong",
): boolean {
  const dai =
    canhMin !== undefined && canhMax !== undefined ? { min: canhMin, max: canhMax } : undefined;
  return suyDoanDonVi(bbox, loai, dai).chacChan;
}
