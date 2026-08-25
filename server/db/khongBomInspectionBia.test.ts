/**
 * ★★★ 2026-08-25 — CỔNG CHẶN TÁI PHÁT: không hàm nào ngoài đường ingest CHUẨN được
 * `insert(productInspections)` / `insert(measurementResults)`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯỚI NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * `product_inspections` và `measurement_results` là hai bảng **WORM** — vai ứng dụng `avi_app`
 * KHÔNG có quyền DELETE (đã kiểm bằng thực nghiệm: xoá phải dùng vai owner `aoi`). Trước lượt
 * này, giao diện có nút "Tạo 100 bản ghi kiểm tra"/"Tạo dữ liệu phân tích trạm" gọi
 * `seedInspectionData`/`seedWorkstationAnalyticsData` (`server/db/statistics.ts`), sinh dữ liệu
 * bằng `Math.random()` rồi INSERT thẳng vào hai bảng này. Một cú bấm nhầm trên môi trường thật
 * để lại hàng trăm/nghìn bo bịa VĨNH VIỄN, lẫn vào dữ liệu sản xuất, không gỡ ra được. Hai hàm
 * đó (và hai mutation `seedDataRouter.seedInspections`/`seedWorkstationAnalytics` gọi chúng) đã
 * bị XOÁ khỏi mã nguồn ở lượt này — file này là lưới giữ cho chúng không quay lại dưới tên khác.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY PHÁT BIỂU GÌ
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * ∀ file `.ts` sản xuất (không phải `*.test.ts`/`*.spec.ts`) dưới `server/`: nếu nó gọi
 * `.insert(productInspections)` hoặc `.insert(measurementResults)`, nó PHẢI nằm trong tập
 * MIỄN TRỪ khai TÊN FILE kèm LÝ DO ngay dưới đây. Thêm một đường ghi mới ở bất kỳ đâu khác mà
 * quên khai ⇒ **ĐỎ**, không cần ai nhớ.
 *
 * *.test.ts bị loại khỏi phép quét: nhiều test hiện có (`analyzeWithAI.suggestions.test.ts`,
 * `inspectionBulkAcknowledge.test.ts`, `defectDispositionService.test.ts`, …) tự INSERT fixture
 * thẳng vào hai bảng này để dựng dữ liệu kiểm — chạy trên `<db>_test` cô lập, có dọn (`afterAll`
 * xoá), không chạm được bởi bất kỳ ai ngoài người chạy `npm test`. Đây là lớp nguy hiểm KHÁC hẳn
 * (không phải một nút bấm ai cũng bấm được trên môi trường thật) nên không thuộc phạm vi lưới này.
 *
 * ⚠ Danh sách MIỄN TRỪ này KHÔNG được nới ra để làm lưới xanh. Nới nó = tự cấp giấy miễn trừ cho
 *   đúng lớp lỗi mà lưới được dựng ra để chặn.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// server/db/khongBomInspectionBia.test.ts → GOC = repo root
const GOC = resolve(__dirname, "..", "..");
const SERVER_DIR = resolve(GOC, "server");

const duong = (f: string): string => relative(GOC, f).split(sep).join("/");

/**
 * Mọi file `.ts` SẢN XUẤT (không `*.test.ts`/`*.spec.ts`/`*.d.ts`) dưới `server/` — suy từ đĩa,
 * không liệt kê tay (một danh sách viết tay sẽ có phần tử thứ N+1 không được canh).
 */
function moiFileNguon(dir: string): string[] {
  const ra: string[] = [];
  const di = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") di(p);
      } else if (
        e.name.endsWith(".ts") &&
        !e.name.endsWith(".d.ts") &&
        !/\.(test|spec)\.ts$/.test(e.name)
      ) {
        ra.push(p);
      }
    }
  };
  di(dir);
  return ra;
}

/** Mẫu dò — KHÔNG global (tránh bẫy `lastIndex` khi tái dùng qua nhiều dòng/nhiều file). */
const NEEDLE = /\.insert\(\s*(?:productInspections|measurementResults)\s*\)/;

interface Khop {
  file: string;
  line: number;
  text: string;
}

function timKhopTrongFile(absPath: string, relPath: string): Khop[] {
  const src = readFileSync(absPath, "utf8");
  const ra: Khop[] = [];
  src.split("\n").forEach((line, idx) => {
    if (NEEDLE.test(line)) {
      ra.push({ file: relPath, line: idx + 1, text: line.trim() });
    }
  });
  return ra;
}

/**
 * MIỄN TRỪ — khai TÊN FILE kèm LÝ DO. Cả hai được kiểm chứng bằng lưới RIÊNG của chính nó
 * (không phải "tin lời commit message"):
 *   · `server/db/inspection.ts` — đường ingest CHUẨN duy nhất
 *     (`insertInspectionHeader`/`persistInspectionAtomic`).
 *   · `server/routers/aoiPackageRouter.ts` — đường commit gói AOI THẬT. Header đã đi qua
 *     `db.persistInspectionAtomic` (canh bởi chính `aoiPackageIngestHopNhat.test.ts` §1: "KHÔNG
 *     còn `.insert(productInspections)` trực tiếp trong nguồn" — file đó sẽ ĐỎ nếu ai thêm lại).
 *     `measurementResults` chỉ được ghi trực tiếp ở NHÁNH TÁI DÙNG (gắn ảnh AOI vào một inspection
 *     đã tồn tại) và dữ liệu là THẬT — lấy từ gói ZIP máy gửi lên qua `buildRecord`, không có
 *     `Math.random()` nào trong file này (đã kiểm bằng grep khi dựng lưới, 2026-08-25).
 *
 * ⚠ File này KHÔNG có trong đặc tả gốc của phạm vi xoá (chỉ nêu `server/db/inspection.ts`) —
 *   được thêm vào sau khi quét thực tế cho thấy nó cũng gọi `.insert(measurementResults)` hợp
 *   pháp; nếu bỏ nó khỏi miễn trừ, chính lưới này sẽ ĐỎ trên mã KHÔNG liên quan tới việc xoá seed.
 */
const MIEN_TRU: Record<string, string> = {
  "server/db/inspection.ts":
    "Đường ingest CHUẨN duy nhất — `insertInspectionHeader`/`persistInspectionAtomic`. Mọi nơi " +
    "khác muốn ghi header/measurement gốc phải gọi qua đây, không tự `.insert()`.",
  "server/routers/aoiPackageRouter.ts":
    "Đường commit gói AOI thật (Task 9, 2026-08-24): header board-mới đã qua " +
    "`db.persistInspectionAtomic` (canh bởi `aoiPackageIngestHopNhat.test.ts` §1). " +
    "`measurementResults` chỉ ghi trực tiếp ở nhánh TÁI DÙNG (gắn ảnh vào inspection đã có), " +
    "dữ liệu THẬT từ gói ZIP máy gửi lên (`buildRecord`), không `Math.random()`.",
};

const TAT_CA_FILE = moiFileNguon(SERVER_DIR).map((abs) => ({ abs, rel: duong(abs) }));

describe("★★★ Cổng chặn tái phát — không bơm inspection BỊA ngoài đường ingest chuẩn", () => {
  it("★ cầu chì chống glob rỗng: phải quét được > 300 file nguồn (không-test) dưới server/", () => {
    // Đo thật lúc dựng lưới: 1055 file. Ngưỡng đặt thấp hơn hẳn để canh "bộ suy còn sống",
    // không canh "kho mã có đúng bấy nhiêu file" (số đó đổi mỗi tuần).
    expect(
      TAT_CA_FILE.length,
      "quét được quá ít file — glob/đường dẫn có thể đã hỏng, mọi khẳng định dưới đây sẽ xanh giả",
    ).toBeGreaterThan(300);
  });

  it("★ danh sách miễn trừ: mỗi file phải CÓ THẬT, có LÝ DO, và THẬT SỰ khớp mẫu dò", () => {
    for (const [rel, reason] of Object.entries(MIEN_TRU)) {
      const abs = resolve(GOC, rel);
      expect(existsSync(abs), `miễn trừ trỏ tới file không tồn tại: ${rel}`).toBe(true);
      expect(reason.length, `miễn trừ ${rel} thiếu lý do (< 40 ký tự)`).toBeGreaterThan(40);
    }

    // ⚠⚠ Nếu tập miễn trừ khớp RỖNG với mẫu dò thì phép ∀ bên dưới xanh vô nghĩa — nó không
    //    chứng minh "không có vi phạm", nó chứng minh "thước không còn khớp được gì cả".
    const khopTrongMienTru = TAT_CA_FILE
      .filter((f) => f.rel in MIEN_TRU)
      .flatMap((f) => timKhopTrongFile(f.abs, f.rel));
    expect(
      khopTrongMienTru.length,
      "tập miễn trừ hiện KHÔNG có khớp thật nào với mẫu dò — mẫu dò (hoặc đường dẫn miễn trừ) đã hỏng",
    ).toBeGreaterThan(0);
  });

  it("★★★★ ∀ file NGOÀI miễn trừ: KHÔNG được insert(productInspections) / insert(measurementResults)", () => {
    const ngoaiMienTru = TAT_CA_FILE.filter((f) => !(f.rel in MIEN_TRU));
    const viPham = ngoaiMienTru.flatMap((f) => timKhopTrongFile(f.abs, f.rel));

    expect(
      viPham.map((v) => `${v.file}:${v.line}  ${v.text}`).join("\n"),
      "\nPHÁT HIỆN insert(productInspections)/insert(measurementResults) NGOÀI đường ingest chuẩn.\n" +
        "Đây là hình dạng CHÍNH XÁC của lỗi vừa bị xoá (seedInspectionData/seedWorkstationAnalyticsData,\n" +
        "2026-08-25): bơm bản ghi inspection vào bảng WORM mà avi_app KHÔNG có quyền DELETE — một cú\n" +
        "bấm nhầm trên môi trường thật để lại dữ liệu bịa VĨNH VIỄN.\n" +
        "Nếu đây là đường ghi hợp lệ MỚI (không phải seed/demo), thêm file vào MIEN_TRU kèm LÝ DO rõ,\n" +
        "và giải thích được vì sao một cú bấm/nhánh gọi nhầm không thể xảy ra ở đó.",
    ).toBe("");
  });

  it("★★ đối chứng dương — mẫu dò THẬT SỰ bắt được câu gọi khi nó xuất hiện (không phải thước chết)", () => {
    // Không đụng đĩa: chỉ chạy chính mẫu dò trên một chuỗi giả có hình dạng đúng thứ cần bắt.
    const gia = [
      "  const [row] = await db.insert(productInspections).values({}).returning();",
      "await tx.insert(measurementResults).values(rows);",
    ];
    for (const line of gia) {
      expect(NEEDLE.test(line), `mẫu dò không khớp câu giả: ${line}`).toBe(true);
    }
    // …và KHÔNG bắt nhầm những dòng lân cận vô hại.
    const vaiTro = [
      "const x = productInspections.id;",
      "await db.select().from(productInspections);",
      "// nhắc tên productInspections trong bình luận, .insert(productInspections) cũng ở đây",
    ];
    expect(NEEDLE.test(vaiTro[0])).toBe(false);
    expect(NEEDLE.test(vaiTro[1])).toBe(false);
    // Dòng bình luận VẪN khớp theo thiết kế (lưới này là phép quét văn bản, không phải AST) —
    // đây là VÙNG MÙ đã khai, không phải lỗi: một .insert(...) thật trong mã không nằm trong
    // bình luận, và false positive hiếm trong bình luận chỉ khiến người viết phải khai miễn trừ
    // thừa một dòng, chưa từng khiến lưới bỏ lọt một vi phạm thật.
    expect(NEEDLE.test(vaiTro[2])).toBe(true);
  });
});
