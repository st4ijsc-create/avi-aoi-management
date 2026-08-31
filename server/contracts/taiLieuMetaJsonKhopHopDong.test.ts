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
// Ranh giới phạm vi §5.2 phải ĐO được: hợp đồng PHẲNG v1.x còn sống thì `measurements`/
// `result:"NTF"` vẫn ĐÚNG ở tài liệu mô tả nó — xem mệnh đề "RANH GIỚI PHẠM VI".
import { machineDataContractV1 } from "./machineDataContract";

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
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("meta.json schema — BG-85")),
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
    // BG-85 — heading đổi tên (hợp nhất "UNIFIED" + "Legacy" thành MỘT mục
    // duy nhất, xem docs/API_REFERENCE.md §11.2) — anchor cập nhật theo.
    ten: 'API_REFERENCE.md — "meta.json Structure (BG-85...)" (đối chứng dương, ĐÃ SỬA sang hợp đồng cây)',
    file: DUONG_API_REFERENCE,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("**meta.json Structure (BG-85, 2026-09-02")),
  },
  {
    // BG-85 — heading + nội dung §4.2 viết lại: JSON đầu tiên sau heading là ví
    // dụ hình dạng PHẲNG CŨ (cố ý minh hoạ cái KHÔNG còn được nhận — không phải
    // "ví dụ dùng được", nên KHÔNG neo vào đó); neo vào cây tương đương ĐÚNG SAU nó.
    ten: "UNIFIED_API_STRUCTURE.md:112 khu vực — §4.2 Cấu trúc legacy (ĐÃ SỬA thành cây tương đương)",
    file: DUONG_UNIFIED,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("Cấu trúc CÂY tối thiểu tương đương")),
  },
  {
    // Cùng lý do §4.2 — JSON đầu tiên sau heading là ví dụ hình dạng cũ cố ý
    // minh hoạ cái bị TỪ CHỐI; neo vào "Hình dạng CÂY tương đương" theo SAU nó.
    ten: "UNIFIED_API_STRUCTURE.md:337 khu vực — §9 Legacy meta.json (ĐÃ SỬA thành cây tương đương)",
    file: DUONG_UNIFIED,
    trich: (nd) => trichJsonCanBang(nd, nd.indexOf("**Hình dạng CÂY tương đương (hình dạng THẬT SỰ được chấp nhận hôm nay):**")),
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

describe("§3 — TỰ KIỂM: pipeline này THẬT SỰ bắt được hình dạng PHẲNG cũ (không chỉ tình cờ xanh) — BG-85 thay hình dạng points[]-only mà Task 7 từng canh", () => {
  it("payload PHẲNG cũ (serialNumber/productModel/measurements[], KHÔNG có surfaces) ⇒ metaJsonSchema TỪ CHỐI — đúng lỗi BG-85 mà lưới này canh", () => {
    const hinhDangHongTruocBanVa = {
      serialNumber: "SN-TU-KIEM",
      productModel: "PM-TU-KIEM",
      measurements: [{ fileName: "p1.jpg", result: "OK" }],
      // KHÔNG có "surfaces"/"ntf"/"summary"/"identity" — hình dạng phẳng cũ mà
      // TOÀN BỘ tài liệu từng dạy TRƯỚC BG-85 (kể cả sau khi Task 7 sửa xong).
    };
    const r = metaJsonSchema.safeParse(hinhDangHongTruocBanVa);
    expect(
      r.success,
      "nếu dòng này ĐỎ nghĩa là metaJsonSchema đã đổi hành vi (KHÔNG thuộc phạm vi việc cập nhật tài liệu — " +
        "báo cáo lại, ĐỪNG tự sửa production).",
    ).toBe(false);
  });

  it("cùng serial/model, GẮN THÊM cây surfaces[] + identity/ntf/summary tối thiểu ⇒ parse được — chứng minh CHÍNH XÁC field còn thiếu là cây, không phải một trường lẻ", () => {
    const hinhDangDaSua = {
      identity: { station: "TK-ST", machine: "TK-MC", line: "TK-LN", plant: "TK-PL", country: "VN", solutionName: "TK-SOL", appVersion: "1.0.0" },
      productId: "TK-PID",
      serialNumber: "SN-TU-KIEM",
      productModel: "PM-TU-KIEM",
      overallResult: "OK",
      ntf: false,
      summary: { surfaces: { total: 0, pass: 0, ng: 0, ntf: 0 }, positions: { total: 0, pass: 0, ng: 0, ntf: 0 }, captures: { total: 0, pass: 0, ng: 0, ntf: 0 }, components: { total: 0, pass: 0, ng: 0, ntf: 0 } },
      surfaces: [],
    };
    const r = metaJsonSchema.safeParse(hinhDangDaSua);
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §5 (I-2, review lượt 8) — LỜI VĂN, không chỉ khối JSON
//
// ⚠ VÌ SAO §1–§4 XANH TRONG KHI TÀI LIỆU SAI — đúng lớp lỗi L-1:
// §1 trích các khối JSON CÂN BẰNG NGOẶC rồi `safeParse`. Khối JSON của
// `AoiPackageSection.tsx` ĐÃ được cập nhật đúng hình dạng cây; **lời văn xung
// quanh thì không**, và lời văn không phải JSON nên bộ trích không thấy nó.
// Lưới cưỡng chế một DANH SÁCH (những khối trích được) thay vì một BẤT BIẾN
// (mọi khẳng định hành vi trong tài liệu phải đúng). Hệ quả đo được: trang API
// docs CHẠY TRONG SẢN PHẨM vẫn dạy `measurements[]`, `pointCode` làm tên tệp,
// "link theo serialNumber trùng", `result: "OK"|"NG"|"NTF"`, và — nặng nhất —
// "đếm OK/NG từ `summary`", đúng thứ bất biến 3 (§4 chuẩn gói ảnh) CẤM.
//
// ⚠ CÁI §5 KHÔNG LÀM ĐƯỢC, khai thẳng: "mọi khẳng định hành vi trong tài liệu
// phải đúng" KHÔNG máy kiểm được. §5 chỉ cưỡng chế được phần ĐO ĐƯỢC của bất
// biến đó: (a) tên trường suy TỪ HỢP ĐỒNG SỐNG, (b) một danh sách khẳng định
// ĐÃ BỊ MÃ BÁC BỎ phải biến mất, (c) khẳng định về nguồn cuộn verdict phải CÓ
// MẶT. Một câu SAI MỚI, chưa ai gặp, vẫn lọt — đó là nợ **BG-94**, ghi trong
// backlog toàn cảnh §3, KHÔNG giấu dưới một lưới xanh.
// ════════════════════════════════════════════════════════════════════════════

/** Các bề mặt tài liệu MÔ TẢ hợp đồng `meta.json` (khác với nơi chỉ có ví dụ). */
const BE_MAT_MO_TA_HOP_DONG: readonly string[] = [DUONG_AOI_PACKAGE_SECTION, DUONG_API_REFERENCE];

/** Mọi bề mặt §5 canh — hợp của `VI_DU` và danh sách trên, không trùng lặp. */
const MOI_BE_MAT: readonly string[] = Array.from(
  new Set<string>([...VI_DU.map((v) => v.file), ...BE_MAT_MO_TA_HOP_DONG]),
);

function doc(duong: string): string {
  return readFileSync(resolve(GOC, duong), "utf8");
}

/**
 * Khoá TOP-LEVEL **BẮT BUỘC** suy TỪ `metaJsonSchema` SỐNG (không phải danh sách
 * chép tay): đổi tên/bỏ một trường trong hợp đồng ⇒ mệnh đề §5.1 ĐỎ ngay, vì nó
 * đi hỏi chính hợp đồng chứ không hỏi một bản sao.
 */
function truongBatBuocCuaHopDong(): string[] {
  const shape = (metaJsonSchema as unknown as { shape: Record<string, { isOptional(): boolean }> }).shape;
  return Object.entries(shape)
    .filter(([, v]) => !v.isOptional())
    .map(([k]) => k)
    .sort();
}

/**
 * Bề mặt chỉ mô tả `meta.json` (gói ZIP). ⚠ `docs/API_REFERENCE.md` và
 * `docs/UNIFIED_API_STRUCTURE.md` mô tả CẢ HAI hợp đồng (ZIP cây v2.0 **và**
 * `submitInspection` tRPC phẳng v1.x, nơi `measurements`/`result:"NTF"` VẪN ĐÚNG)
 * nên chúng KHÔNG nằm ở đây — cấm một chuỗi trên toàn tệp đó sẽ bắt oan hợp đồng
 * còn sống. Đây là ranh giới CÓ CHỦ Ý, không phải sót.
 */
const BE_MAT_CHI_META_JSON: readonly string[] = [
  DUONG_AOI_PACKAGE_SECTION,
  DUONG_META_EXAMPLE,
  DUONG_META_LEGACY_EXAMPLE,
];

/**
 * Khẳng định ĐÃ BỊ MÃ BÁC BỎ — mỗi mục là một câu tài liệu TỪNG dạy và hôm nay
 * SAI. Xuất hiện lại trong `phamVi` của nó ⇒ ĐỎ, kèm đúng lý do nó sai.
 */
const KHANG_DINH_DA_BI_BAC_BO: ReadonlyArray<{
  ten: string;
  mau: RegExp;
  viSao: string;
  phamVi: readonly string[];
}> = [
  {
    ten: 'đếm OK/NG "từ summary"',
    mau: /(đếm|count)[^\n]{0,40}từ\s*[`"'<]*(<code>)?\s*summary/i,
    viSao:
      "bất biến 3 (§4 chuẩn gói ảnh): `overallResult` và mọi số đếm CUỘN TỪ CÂY. `summary` máy khai " +
      "chỉ được lưu nguyên văn + gắn cờ lệch, KHÔNG BAO GIỜ là nguồn.",
    phamVi: MOI_BE_MAT, // `summary` chỉ tồn tại ở hợp đồng cây ⇒ cấm được trên MỌI bề mặt
  },
  {
    ten: "link/gộp inspection theo serialNumber trùng",
    mau: /(link|liên kết|gộp)[^\n]{0,80}(trùng\s*(<\/?code>)?\s*serialNumber|serialNumber\s*(<\/?code>)?\s*\+\s*machineId)/i,
    viSao:
      "BG-85 + C-1: hội tụ theo `packageId` (khoá idempotency `aoi-pkg:<packageId>`); KHÔNG bao giờ " +
      "gộp theo serial — và một gói serial RỖNG vẫn PHẢI ghi `product_inspections`.",
    phamVi: MOI_BE_MAT,
  },
  {
    ten: 'result là enum BA giá trị "OK"|"NG"|"NTF" trong meta.json',
    mau: /result[^\n]{0,20}["'`]OK["'`]\s*\|\s*["'`]NG["'`]\s*\|\s*["'`]NTF["'`]/,
    viSao:
      "`machineDataContractV2` khai `result: z.enum([\"OK\",\"NG\"])` ở MỌI cấp; NTF là trường `ntf` " +
      "(boolean) RIÊNG. Gộp thành enum ba giá trị làm MẤT tổ hợp (NG đã được xác nhận là NTF). " +
      "⚠ Hợp đồng PHẲNG v1.x (`submitInspection` tRPC) THẬT SỰ khai `z.enum([\"OK\",\"NG\",\"NTF\"])` " +
      "— vì thế phạm vi chỉ gồm bề mặt CHỈ nói về `meta.json`.",
    phamVi: BE_MAT_CHI_META_JSON,
  },
  {
    ten: "`measurements` là trường BẮT BUỘC của meta.json",
    mau: /measurements[^\n]{0,40}(BẮT BUỘC|bắt buộc|required)/,
    viSao:
      "hợp đồng hợp nhất BG-85 KHÔNG có `measurements`. Câu này từng nằm trong CHÍNH mẫu C# của trang " +
      "API docs — bên tích hợp làm đúng nó sinh 100% gói `'failed'`. (Trên đường tRPC phẳng v1.x thì " +
      "`measurements` VẪN bắt buộc ⇒ phạm vi chỉ gồm bề mặt CHỈ nói về `meta.json`.)",
    phamVi: BE_MAT_CHI_META_JSON,
  },
  {
    ten: "`fileName` nằm trong `measurements`",
    // "trong" là bắt buộc: nó phân biệt một LỜI DẠY ("fileName trong measurements phải khớp…")
    // với một câu PHỦ ĐỊNH/đối chiếu ("images[].fileName — KHÔNG còn measurements[].fileName").
    mau: /fileName[^\n]{0,25}trong[^\n]{0,15}(<code>)?measurements/i,
    viSao: "ảnh nay tham chiếu qua `images[].fileName`, nối cây bằng `images[].captureId`.",
    phamVi: MOI_BE_MAT,
  },
  {
    ten: "dùng `pointCode` làm tên tệp ảnh",
    mau: /(<code>)?pointCode(<\/code>)?[^\n]{0,40}(làm tên file|làm tên tệp)/i,
    viSao:
      "`pointCode` không còn là trường của `meta.json`. Khoá nối ảnh ↔ cây là `images[].captureId`; " +
      "tên tệp chỉ cần khớp nguyên văn tệp trong `images/`.",
    phamVi: MOI_BE_MAT,
  },
];

describe("§5.1 — TÊN TRƯỜNG suy TỪ HỢP ĐỒNG SỐNG: mọi trường BẮT BUỘC của `metaJsonSchema` phải được NÊU TÊN trong lời văn của bề mặt mô tả hợp đồng", () => {
  const batBuoc = truongBatBuocCuaHopDong();

  it("★ chống tự thoả — hợp đồng phải trả về ≥5 trường bắt buộc (nếu bộ suy hỏng và trả rỗng thì mọi khẳng định dưới đây tự thoả)", () => {
    expect(batBuoc.length, `trường bắt buộc suy được: ${JSON.stringify(batBuoc)}`).toBeGreaterThanOrEqual(5);
    // Neo NGỮ NGHĨA: hai trường mà cả bốn khẳng định sai của I-2 đều xoay quanh.
    expect(batBuoc).toContain("surfaces");
    expect(batBuoc).toContain("summary");
  });

  for (const duong of BE_MAT_MO_TA_HOP_DONG) {
    it(`${duong} — nêu đủ MỌI trường bắt buộc của hợp đồng`, () => {
      const nd = doc(duong);
      const thieu = batBuoc.filter((t) => !nd.includes(t));
      expect(
        thieu,
        `${duong} KHÔNG nhắc tới ${thieu.length} trường BẮT BUỘC của \`metaJsonSchema\`: ${JSON.stringify(thieu)}. ` +
          "Một bề mặt mô tả hợp đồng mà không nêu đủ trường bắt buộc là một tài liệu dạy hình dạng KHÔNG commit được.",
      ).toEqual([]);
    });
  }
});

describe("§5.2 — LỜI VĂN: 0 khẳng định ĐÃ BỊ MÃ BÁC BỎ, trên MỌI bề mặt tài liệu", () => {
  for (const kd of KHANG_DINH_DA_BI_BAC_BO) {
    it(`0 nơi còn dạy: ${kd.ten}  [phạm vi ${kd.phamVi.length} tệp]`, () => {
      expect(kd.phamVi.length, `phạm vi RỖNG ⇒ mệnh đề tự thoả: ${kd.ten}`).toBeGreaterThan(0);
      const dinh: string[] = [];
      for (const duong of kd.phamVi) {
        const dong = doc(duong).split(/\r?\n/);
        dong.forEach((d, i) => {
          if (kd.mau.test(d)) dinh.push(`${duong}:${i + 1} → ${d.trim().slice(0, 160)}`);
        });
      }
      expect(dinh, `Khẳng định SAI còn sống.\nVÌ SAO SAI: ${kd.viSao}\n${dinh.join("\n")}`).toEqual([]);
    });
  }

  it("★★★ CHỐNG BỘ-DÒ-KHÔNG-KHỚP-GÌ — mọi mẫu phải bắt được ĐÚNG câu tài liệu từng dạy (một regex gõ sai sẽ luôn cho 0 kết quả và trông y hệt 'đã sạch')", () => {
    const cauCu: Record<string, string> = {
      'đếm OK/NG "từ summary"': "<li>Đếm OK/NG từ <code>summary</code> hoặc danh sách measurements</li>",
      "link/gộp inspection theo serialNumber trùng":
        "<li>Link tới <code>product_inspections</code> nếu trùng serialNumber + machineId</li>",
      'result là enum BA giá trị "OK"|"NG"|"NTF" trong meta.json':
        '<li><code>result</code>: "OK" | "NG" | "NTF" (Not True Failure)</li>',
      "`measurements` là trường BẮT BUỘC của meta.json":
        '// "measurements" — server BẮT BUỘC trường này (dù rỗng).',
      "`fileName` nằm trong `measurements`":
        "<li><code>fileName</code> trong <code>measurements</code> phải khớp với tên file thực tế trong ZIP</li>",
      "dùng `pointCode` làm tên tệp ảnh": "<li>Nên dùng tên <code>pointCode</code> làm tên file (vd: P01.jpg)</li>",
    };
    for (const kd of KHANG_DINH_DA_BI_BAC_BO) {
      const mau = cauCu[kd.ten];
      expect(mau, `thiếu câu-cũ đối chứng cho "${kd.ten}"`).toBeTruthy();
      expect(kd.mau.test(mau), `mẫu của "${kd.ten}" KHÔNG bắt được chính câu nó được dựng ra để bắt`).toBe(true);
    }
  });

  it("★ ĐỐI CHỨNG ÂM — bộ lọc `listPackages.overallResult` (enum BA giá trị HỢP LỆ) KHÔNG bị mẫu `result` bắt nhầm", () => {
    const mauResult = KHANG_DINH_DA_BI_BAC_BO.find((k) => k.ten.includes("BA giá trị"))!.mau;
    expect(mauResult.test('  overallResult: "NG",         // "OK" | "NG" | "NTF"')).toBe(false);
  });

  it("★★ RANH GIỚI PHẠM VI được ĐO, không phải được KHAI — hợp đồng PHẲNG v1.x THẬT SỰ còn nhận `result:\"NTF\"`, nên hai tệp mô tả CẢ HAI hợp đồng phải nằm NGOÀI hai mẫu chỉ-dành-cho-meta.json", () => {
    // Hỏi CHÍNH hợp đồng v1.x đang chạy: nếu Khối B cắt nó đi, mệnh đề này ĐỎ và người
    // sau phải mở rộng phạm vi hai mẫu ra toàn bộ tài liệu — đúng lúc điều đó thành đúng.
    const v1 = machineDataContractV1.safeParse({
      machineCode: "MC-RANH-GIOI", // `.refine`: phải có apiKey HOẶC machineCode
      serialNumber: "SN-RANH-GIOI",
      productModel: "PM-RANH-GIOI",
      overallResult: "NG",
      measurements: [{ pointCode: "P01", result: "NTF" }],
    });
    expect(
      v1.success,
      "hợp đồng PHẲNG v1.x KHÔNG còn nhận `result:\"NTF\"` ⇒ ranh giới phạm vi bên dưới đã hết hiệu lực",
    ).toBe(true);
    for (const ten of ['result là enum BA giá trị', "`measurements` là trường BẮT BUỘC"]) {
      const kd = KHANG_DINH_DA_BI_BAC_BO.find((k) => k.ten.includes(ten))!;
      expect(kd.phamVi).not.toContain(DUONG_API_REFERENCE);
      expect(kd.phamVi).not.toContain(DUONG_UNIFIED);
    }
  });
});

describe("§5.3 — LỜI VĂN: khẳng định về NGUỒN cuộn verdict phải CÓ MẶT trên trang API docs chạy trong sản phẩm", () => {
  it("★★★ nói rõ verdict/đếm CUỘN TỪ CÂY, và `summary` KHÔNG BAO GIỜ là nguồn", () => {
    const nd = doc(DUONG_AOI_PACKAGE_SECTION);
    expect(/cu[ộo]n\s+từ\s+C[ÂA]Y/i.test(nd), "thiếu câu 'cuộn từ CÂY' — bất biến 3 không được công bố").toBe(true);
    expect(
      /summary[^\n]{0,120}KHÔNG BAO GIỜ/.test(nd),
      "thiếu câu 'summary … KHÔNG BAO GIỜ là nguồn' — bên tích hợp sẽ tin summary quyết định phán quyết",
    ).toBe(true);
  });

  it("★ nói rõ HAI bất biến TỪ CHỐI CẢ GÓI (captureId lạ / thiếu tệp ảnh) — thứ quyết định gói commit được hay không", () => {
    const nd = doc(DUONG_AOI_PACKAGE_SECTION);
    expect(/captureId[^\n]{0,120}(TỪ CHỐI|từ chối)/i.test(nd)).toBe(true);
    expect(/fileName[^\n]{0,160}(TỪ CHỐI|từ chối)/i.test(nd)).toBe(true);
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
