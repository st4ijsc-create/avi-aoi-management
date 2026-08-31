// server/contracts/taiLieuMetaJsonKhopHopDong.test.ts
//
// Pha 1F Task 7 (review lượt 7, đo bằng truy hồi THẬT) — TÀI LIỆU CÔNG BỐ dạy
// MỘT HÌNH DẠNG KHÔNG BAO GIỜ commit được.
//
// ── Vì sao file này tồn tại ────────────────────────────────────────────────
// Trước bản vá Task 7, NĂM nơi công bố (`AoiPackageSection.tsx` — trang API
// docs CHẠY TRONG SẢN PHẨM, `docs/examples/meta-legacy.json.example` — phát
// hành cho khách, `docs/API_REFERENCE.md`, `docs/UNIFIED_API_STRUCTURE.md` ×2)
// nêu `points[]` là hình dạng `meta.json` HỢP LỆ, không hề nhắc `measurements`.
// Nhưng `metaJsonSchema.measurements` là trường BẮT BUỘC (không `.optional()`)
// — một máy làm ĐÚNG tài liệu sinh gói KHÔNG BAO GIỜ parse nổi (BG-85 nguồn
// gốc, xem `task-7-report.md`). Task 7 sửa NĂM nơi đó để dạy hình dạng THẬT
// SỰ commit được — file này là LƯỚI CANH để tài liệu không trôi khỏi mã lần
// nữa: nó ĐỌC LIVE nội dung các file tài liệu (không hard-code JSON trùng lặp
// trong test), trích ví dụ `meta.json` THẬT, và bắt `metaJsonSchema` sản xuất
// PHẢI parse thành công — cùng ethos "đo THẬT, không suy đoán" của toàn nhánh
// (`docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md` §L-1/§L-4).
//
// ── Vì sao KHÔNG quét "MỌI khối ```json trong MỌI file docs/" ──────────────
// Đã thử và bác bỏ: nhiều khối JSON trong các file này KHÔNG PHẢI ví dụ
// `meta.json` — response của `presign`/`commit`/`reportQueueMetrics`, payload
// `submitInspection` (tRPC, hợp đồng KHÁC — measurements[].fileName KHÔNG bắt
// buộc ở đó), và response API thống kê external (`points[]` = điểm đo lường
// theo NGHĨA KHÁC, không phải mảng đo lường của một gói). Validate các khối đó
// bằng `metaJsonSchema` sẽ tạo dương tính giả KHÔNG liên quan gì tới BG-85 —
// làm nhiễu lưới, không phải làm chắc lưới. Mục 4.1 của
// `UNIFIED_API_STRUCTURE.md` (hình dạng ĐÚNG, dùng `measurements`) cũng bị
// loại vì nó là FRAGMENT cố ý (chỉ minh hoạ họ trường đo lường, không có
// `serialNumber`/`productModel`) — validate một fragment cố ý bằng schema đòi
// payload đầy đủ sẽ luôn đỏ vì lý do KHÔNG liên quan gì tới lỗi đang canh.
//
// ⇒ Danh sách `VI_DU` dưới đây là NEO THỦ CÔNG (đọc LIVE, không hard-code nội
// dung) vào ĐÚNG các khối được trình bày là ví dụ `meta.json` HOÀN CHỈNH (có
// `serialNumber` + `productModel` + mảng đo lường) — xem "mối lo" trong
// task-7-report.md: một ví dụ meta.json MỚI thêm vào một vị trí CHƯA có neo
// sẽ KHÔNG tự động được lưới này bắt.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { metaJsonSchema } from "../routers/aoiPackageRouter";

// server/contracts/taiLieuMetaJsonKhopHopDong.test.ts → GOC = repo root
const GOC = resolve(__dirname, "..", "..");

const DUONG_AOI_PACKAGE_SECTION = "client/src/components/apiDocs/AoiPackageSection.tsx";
const DUONG_META_EXAMPLE = "docs/examples/meta.json.example";
const DUONG_META_LEGACY_EXAMPLE = "docs/examples/meta-legacy.json.example";
const DUONG_API_REFERENCE = "docs/API_REFERENCE.md";
const DUONG_UNIFIED = "docs/UNIFIED_API_STRUCTURE.md";

/**
 * Trích PHẦN THÂN `{...}` CÂN BẰNG dấu ngoặc, bắt đầu từ dấu `{` ĐẦU TIÊN kể
 * từ `tuViTri` trở đi trong `text`. Có xử lý chuỗi (bỏ qua `{`/`}` bên trong
 * `"..."`, kể cả dấu ngoặc-kép escape `\"`) để không đếm lệch nếu một giá trị
 * chuỗi chứa ký tự `{`/`}`. Ném lỗi rõ ràng nếu không cân bằng hoặc không tìm
 * thấy `{` — KHÔNG bao giờ trả về một chuỗi cụt/đoán mò (cùng kỷ luật
 * `duyetTruongOptional`/`duyetTimTruongChuoi`: không đọc được ⇒ THROW, không
 * `return` im lặng).
 */
export function trichJsonCanBang(text: string, tuViTri: number): string {
  const batDau = text.indexOf("{", tuViTri);
  if (batDau === -1) {
    throw new Error(`trichJsonCanBang: không tìm thấy "{" từ vị trí ${tuViTri}`);
  }
  let doSau = 0;
  let trongChuoi = false;
  let dangThoat = false;
  for (let i = batDau; i < text.length; i++) {
    const c = text[i];
    if (trongChuoi) {
      if (dangThoat) {
        dangThoat = false;
      } else if (c === "\\") {
        dangThoat = true;
      } else if (c === '"') {
        trongChuoi = false;
      }
      continue;
    }
    if (c === '"') {
      trongChuoi = true;
      continue;
    }
    if (c === "{") {
      doSau++;
    } else if (c === "}") {
      doSau--;
      if (doSau === 0) return text.slice(batDau, i + 1);
    }
  }
  throw new Error(`trichJsonCanBang: dấu ngoặc KHÔNG cân bằng, bắt đầu tại vị trí ${batDau}`);
}

interface ViDuMetaJson {
  /** Tên hiển thị — dùng làm tên `it()`, PHẢI duy nhất trong danh sách. */
  ten: string;
  /** Đường dẫn file NGUỒN, tương đối từ repo root — dùng trong thông điệp lỗi + mệnh đề 2. */
  file: string;
  /** Trích JSON THẬT từ nội dung file (đọc LIVE mỗi lần chạy test). */
  trich: (noiDung: string) => string;
}

const VI_DU: readonly ViDuMetaJson[] = [
  {
    ten: 'AoiPackageSection.tsx — "meta.json schema" (trang API docs CHẠY TRONG SẢN PHẨM)',
    file: DUONG_AOI_PACKAGE_SECTION,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf('meta.json schema — "measurements" BẮT BUỘC')),
  },
  {
    ten: "docs/examples/meta.json.example (mẫu ĐÚNG — đối chứng dương, không thuộc năm nơi bị sửa)",
    file: DUONG_META_EXAMPLE,
    trich: (nd) => nd,
  },
  {
    ten: "docs/examples/meta-legacy.json.example (phát hành cho khách — ĐÃ SỬA sang measurements)",
    file: DUONG_META_LEGACY_EXAMPLE,
    trich: (nd) => nd,
  },
  {
    ten: 'API_REFERENCE.md — "meta.json Structure (UNIFIED...)" (đối chứng dương, đã đúng từ trước)',
    file: DUONG_API_REFERENCE,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("**meta.json Structure (UNIFIED - đồng bộ với submitInspection):**")),
  },
  {
    ten: 'API_REFERENCE.md:781 khu vực — "Legacy meta.json" (tên trường cũ, ĐÃ SỬA khoá mảng)',
    file: DUONG_API_REFERENCE,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("**Legacy meta.json (tên trường cũ vẫn hỗ trợ")),
  },
  {
    ten: "UNIFIED_API_STRUCTURE.md:112 khu vực — §4.2 Cấu trúc legacy (ĐÃ SỬA thành ví dụ đầy đủ)",
    file: DUONG_UNIFIED,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("### 4.2. Cấu trúc legacy (Old - Vẫn hỗ trợ)")),
  },
  {
    ten: "UNIFIED_API_STRUCTURE.md:337 khu vực — §9 Legacy meta.json (ĐÃ SỬA khoá mảng)",
    file: DUONG_UNIFIED,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("### Legacy meta.json (tên trường cũ vẫn hoạt động)")),
  },
  {
    ten: "UNIFIED_API_STRUCTURE.md — §6.1 AOI Package - meta.json (đối chứng dương, đã đúng từ trước)",
    file: DUONG_UNIFIED,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("### 6.1. AOI Package - meta.json")),
  },
];

/** Đọc + trích + `JSON.parse` MỘT `ViDuMetaJson` — dùng chung cho mọi mô tả bên dưới. */
function layDuLieu(vd: ViDuMetaJson): unknown {
  const noiDungDayDu = readFileSync(resolve(GOC, vd.file), "utf8");
  const jsonText = vd.trich(noiDungDayDu);
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `${vd.file} — "${vd.ten}": văn bản trích được KHÔNG PHẢI JSON hợp lệ (${(err as Error).message}).\n` +
        `--- văn bản trích được ---\n${jsonText}`,
    );
  }
}

describe("§1 — MỆNH ĐỀ 1: mọi ví dụ meta.json trong tài liệu/apiDocs ⇒ metaJsonSchema.safeParse().success === true", () => {
  for (const vd of VI_DU) {
    it(`${vd.ten}  [${vd.file}]`, () => {
      const data = layDuLieu(vd);
      const r = metaJsonSchema.safeParse(data);
      expect(
        r.success,
        r.success
          ? ""
          : `${vd.file} — "${vd.ten}": metaJsonSchema.safeParse() THẤT BẠI:\n` +
              `${JSON.stringify((r as { error?: unknown }).error, null, 2)}\n` +
              `--- payload trích được ---\n${JSON.stringify(data, null, 2)}`,
      ).toBe(true);
    });
  }
});

describe("§2 — MỆNH ĐỀ 2: CHỐNG TỰ THOẢ — bộ trích phải tìm được ≥N ví dụ THẬT", () => {
  const N = 6;

  it(`tìm được ≥${N} ví dụ (bộ trích hỏng trả 0 ⇒ mọi khẳng định ở §1 tự thoả — thấy hiện có ${VI_DU.length})`, () => {
    expect(VI_DU.length).toBeGreaterThanOrEqual(N);
  });

  it("mỗi ví dụ có `ten` DUY NHẤT (chống hai hàng cùng tên che lấp nhau trong output)", () => {
    const ten = VI_DU.map((v) => v.ten);
    expect(new Set(ten).size).toBe(ten.length);
  });

  it("★★★ ÍT NHẤT MỘT ví dụ đến từ AoiPackageSection.tsx (trang API docs CHẠY TRONG SẢN PHẨM)", () => {
    const tuAoiSection = VI_DU.filter((v) => v.file === DUONG_AOI_PACKAGE_SECTION);
    expect(tuAoiSection.length).toBeGreaterThanOrEqual(1);
  });

  it("mỗi ví dụ TRÍCH ĐƯỢC văn bản khác rỗng (chống trich() trả chuỗi rỗng lặng lẽ)", () => {
    for (const vd of VI_DU) {
      const noiDungDayDu = readFileSync(resolve(GOC, vd.file), "utf8");
      const jsonText = vd.trich(noiDungDayDu);
      expect(jsonText.trim().length, `${vd.file} — "${vd.ten}" trích ra chuỗi RỖNG`).toBeGreaterThan(0);
    }
  });
});

describe("§3 — TỰ KIỂM: pipeline này THẬT SỰ bắt được hình dạng points[]-only (không chỉ tình cờ xanh)", () => {
  it("payload chỉ có points[] (KHÔNG có measurements) ⇒ metaJsonSchema TỪ CHỐI — đúng lỗi BG-85 mà lưới này canh", () => {
    const hinhDangHongTruocBanVa = {
      serialNumber: "SN-TU-KIEM",
      productModel: "PM-TU-KIEM",
      points: [{ code: "P1", fileName: "p1.jpg", result: "OK" }],
      // KHÔNG có "measurements" — ĐÚNG hình dạng cả năm nơi từng dạy TRƯỚC Task 7.
    };
    const r = metaJsonSchema.safeParse(hinhDangHongTruocBanVa);
    expect(
      r.success,
      "nếu dòng này ĐỎ nghĩa là metaJsonSchema đã đổi hành vi (KHÔNG thuộc phạm vi Task 7 — " +
        "chỉ sửa tài liệu, không sửa metaJsonSchema) — báo cáo lại, ĐỪNG tự sửa production.",
    ).toBe(false);
  });

  it("cùng payload, GẮN THÊM measurements:[] rỗng ⇒ parse được — chứng minh CHÍNH XÁC field còn thiếu là measurements", () => {
    const hinhDangDaSua = {
      serialNumber: "SN-TU-KIEM",
      productModel: "PM-TU-KIEM",
      points: [{ code: "P1", fileName: "p1.jpg", result: "OK" }],
      measurements: [],
    };
    const r = metaJsonSchema.safeParse(hinhDangDaSua);
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

describe("§4 — đơn vị cho trichJsonCanBang (bộ trích tự viết cho lưới này — không tự thoả về CHÍNH bộ trích)", () => {
  it("trích đúng một object phẳng, dừng đúng dấu } đóng, KHÔNG nuốt văn bản phía sau", () => {
    const text = 'mở đầu {"a":1,"b":2} kết thúc';
    expect(trichJsonCanBang(text, 0)).toBe('{"a":1,"b":2}');
  });

  it("trích đúng object LỒNG NHAU nhiều cấp — không dừng ở dấu } đầu tiên gặp được", () => {
    const text = '{"a":{"b":{"c":1}},"d":2}';
    expect(trichJsonCanBang(text, 0)).toBe(text);
  });

  it('bỏ qua "{" / "}" NẰM TRONG một chuỗi giá trị — không đếm lệch độ sâu', () => {
    const text = '{"note":"dùng dấu { và } trong ghi chú","n":1}';
    expect(trichJsonCanBang(text, 0)).toBe(text);
  });

  it('không dừng sớm ở dấu " đã ESCAPE ngay trước "}"', () => {
    const text = '{"note":"kết thúc bằng dấu ngoặc-kép \\""}';
    expect(trichJsonCanBang(text, 0)).toBe(text);
  });

  it("KHÔNG bao gồm văn bản/comment ĐI SAU dấu } đóng cân bằng", () => {
    const text = '{"a":1}\n// ⚠ ghi chú KHÔNG phải JSON đi sau';
    expect(trichJsonCanBang(text, 0)).toBe('{"a":1}');
  });

  it('ném lỗi rõ ràng khi KHÔNG tìm thấy "{" (không trả về chuỗi rỗng im lặng)', () => {
    expect(() => trichJsonCanBang("không có dấu ngoặc nào ở đây", 0)).toThrow(/không tìm thấy/);
  });

  it("ném lỗi rõ ràng khi dấu ngoặc KHÔNG cân bằng (không trả về chuỗi cụt)", () => {
    expect(() => trichJsonCanBang('{"a": {"b": 1}', 0)).toThrow(/KHÔNG cân bằng/);
  });
});
