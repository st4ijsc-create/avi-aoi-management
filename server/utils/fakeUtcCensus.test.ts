/**
 * BG-96 (Khối C, chốt) — census cấm công thức "fake-UTC" TÁI SINH trong mã sản xuất.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * BỐI CẢNH
 * ══════════════════════════════════════════════════════════════════════════════════
 * `d.getTime() - d.getTimezoneOffset() * 60000` từng là cách dự án "dịch" một mốc giờ
 * sang UTC — SAI, vì `getTimezoneOffset()` đọc TZ của PROCESS chạy Node, không phải TZ
 * nhà máy. Task 1 (BG-96 Task 1, `aedd3096`) đã bỏ phép dịch này khỏi MỌI đường ghi; Task
 * 2 (`86b0e889`/`118d5322`/`db10d08f`) đã chuyển 3 ổ đọc + bucketing sang UTC thật/
 * factory-TZ (`docGioTuongNhaMay`, `server/utils/factoryTime.ts`). Sau hai Task đó,
 * `server/**` KHÔNG còn công thức này ở bất kỳ dòng MÃ nào — cổng dưới đây KHOÁ trạng
 * thái đó VĨNH VIỄN: thêm lại công thức ở bất cứ đâu trong `server/**` (trừ *.test.ts)
 * là ĐỎ, không có ngân sách để lách.
 *
 * ── BẪY ĐÃ BIẾT: doc-comment TRÍCH NGUYÊN VĂN công thức đang bị khai tử ──────────────
 * Ba chú thích cutover của Task 1/2 (`factoryTime.ts`, `_core/index.ts`,
 * `externalInspectionApi.ts`) giải thích "trước đây dự án dùng
 * `d.getTime() - d.getTimezoneOffset()*60000`" LÀM VÍ DỤ cho thứ đã bị bỏ — chuỗi đó vẫn
 * NẰM NGUYÊN VĂN trong ba file. Quét thô (regex trên toàn văn bản) sẽ ĐỎ GIẢ trên chính
 * lời giải thích rằng công thức đã bị bỏ — một cổng như vậy chỉ dạy người ta xoá đúng câu
 * cảnh báo hữu ích. Census này BỎ QUA dòng comment (`//…`, khối `/* … *‍/` nhiều dòng)
 * trước khi so khớp — bắt chước cách `demChuoiTran()` ở
 * `client/src/lib/viStringCoverage.unit.test.ts` strip comment theo DÒNG, KHÔNG phải một
 * bộ phân tích cú pháp đầy đủ (đủ dùng: comment của dự án luôn ở đầu dòng sau khi trim).
 *
 * Fuse chống-vacuity dùng chuỗi mồi là DÒNG MÃ (không phải comment) — nếu chỉ bơm mồi vào
 * một dòng comment, một thước ĐANG BỊ HỎNG theo hướng "không strip comment nào cả" vẫn có
 * thể trông như đúng (bắt được mồi lẫn trong đống đỏ giả). Mồi phải là mã THẬT để phép thử
 * chỉ có một cách duy nhất đi qua: strip đúng comment CŨ và vẫn thấy mã MỚI.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Công thức fake-UTC bị khai tử. Đọc kỹ: đây LÀ đích canh, không phải chuỗi mồi. */
const RE_FAKE_UTC = /getTimezoneOffset\(\)\s*\*\s*60000/;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTs(full));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Trả lại các dòng của file với dòng COMMENT bị xoá trắng (giữ nguyên SỐ DÒNG để báo lỗi
 * trỏ đúng chỗ) — cùng thuật toán `demChuoiTran()`: comment DÒNG (`//`, `*` — kể cả dòng
 * tiếp theo trong khối `/** … *‍/`) và comment KHỐI (`/* … *‍/`, có thể trải NHIỀU DÒNG)
 * đều bị loại trước khi so khớp mẫu.
 */
function dongMaKhongComment(filePath: string): string[] {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const ln of lines) {
    const tr = ln.trim();
    if (inBlock) {
      if (tr.includes("*/")) inBlock = false;
      out.push("");
      continue;
    }
    if (tr.startsWith("/*")) {
      if (!tr.includes("*/")) inBlock = true;
      out.push("");
      continue;
    }
    if (tr.startsWith("//") || tr.startsWith("*")) {
      out.push("");
      continue;
    }
    out.push(ln);
  }
  return out;
}

interface FakeUtcHit { file: string; line: number; text: string }

/** Quét `server/**\/*.ts` (trừ `*.test.ts`), bỏ qua comment, tìm công thức fake-UTC. */
function quetFakeUtc(goc: string = SERVER_ROOT): FakeUtcHit[] {
  const ket: FakeUtcHit[] = [];
  for (const file of walkTs(goc)) {
    const lines = dongMaKhongComment(file);
    lines.forEach((ln, i) => {
      if (RE_FAKE_UTC.test(ln)) {
        ket.push({
          file: relative(SERVER_ROOT, file).split("\\").join("/"),
          line: i + 1,
          text: ln.trim(),
        });
      }
    });
  }
  return ket;
}

/** Ba file mang chú thích cutover trích NGUYÊN VĂN công thức cũ (xem docblock trên). */
const FILE_CO_COMMENT_BAY = [
  "utils/factoryTime.ts",
  "_core/index.ts",
  "routes/externalInspectionApi.ts",
];

describe("BG-96 — census cấm fake-UTC tái sinh (server/**, comment không tính)", () => {
  it("cầu chì 1: phép quét phải THẤY file thật — không thì đang canh tập rỗng", () => {
    expect(walkTs(SERVER_ROOT).length).toBeGreaterThan(500);
  });

  it("cầu chì 2 — bẫy đã biết PHẢI còn tồn tại (nếu không, ca dưới đây canh một bẫy ma)", () => {
    for (const rel of FILE_CO_COMMENT_BAY) {
      const raw = readFileSync(join(SERVER_ROOT, rel), "utf8");
      expect(
        RE_FAKE_UTC.test(raw),
        `${rel}: không còn chứa mẫu trong văn bản thô — bẫy đã biến mất, gỡ file này khỏi FILE_CO_COMMENT_BAY`,
      ).toBe(true);
    }
  });

  it("★★★ fuse chống-vacuity: mồi ở DÒNG MÃ (không phải comment) phải bị bắt", () => {
    const P = join(SERVER_ROOT, "utils", "__fakeUtcCensusProbe.tmp.ts");
    try {
      // Mồi PHẢI là mã thật, không phải comment — xem lý do ở docblock đầu file.
      writeFileSync(
        P,
        `export const moiFakeUtc = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000);\n`,
      );
      const bat = quetFakeUtc().filter((h) => h.file.endsWith("__fakeUtcCensusProbe.tmp.ts"));
      expect(bat.length, "thước KHÔNG bắt được mồi vừa bơm ⇒ nó đang mù, không phải sạch thật").toBe(1);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("ba file mang bẫy đã biết KHÔNG được tính là nợ (comment loại trừ đúng)", () => {
    const ket = quetFakeUtc();
    const trongBaFile = ket.filter((h) => FILE_CO_COMMENT_BAY.includes(h.file));
    if (trongBaFile.length) console.error("[BG-96] strip comment hỏng ở:", trongBaFile);
    expect(trongBaFile).toEqual([]);
  });

  it("★★★ BẤT BIẾN: 0 dòng MÃ chứa công thức fake-UTC trong toàn bộ server/**", () => {
    const ket = quetFakeUtc();
    if (ket.length) console.error("[BG-96] fake-UTC tái sinh ở:", ket);
    expect(ket).toEqual([]);
  });
});
