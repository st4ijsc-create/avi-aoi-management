// server/contracts/coSnapshotV2Census.test.ts
//
// ★★★ C-1 (review Khối C lượt 9, §1 Critical) — CỜ `SPEC_GATE_SNAPSHOT_ENABLED`
// KHÔNG ĐƯỢC TẮT IM LẶNG.
//
// Đo được (review lượt 9): `.env` chạy thật — 0 dòng `SPEC_GATE_SNAPSHOT_ENABLED`;
// `.env.example:1411` (trước bản vá này) — dòng đó là MỘT CHÚ THÍCH
// (`# SPEC_GATE_SNAPSHOT_ENABLED=false`), không phải một GIÁ TRỊ. Hệ quả: cờ canh
// duy nhất giữa "bo v2 chấm theo giới hạn LÚC ĐO" và "bo v2 chấm theo giới hạn
// ĐANG SỐNG" (BG-97) không hề xuất hiện, kể cả trong TÀI LIỆU MẪU, dưới dạng một
// giá trị thật ai đó có thể grep ra và thấy "à, có cờ này, đang tắt". Một dòng
// ledger không phải một cổng — census này LÀ cổng: nó KHÔNG kiểm giá trị (brief
// C-1 cấm đổi mặc định), nó chỉ kiểm cờ có VĂN BẢN, PHÁT HIỆN ĐƯỢC hay không.
//
// Hai mệnh đề:
//   §1 — `.env.example` phải có ĐÚNG một dòng `SPEC_GATE_SNAPSHOT_ENABLED=<gt>`
//        là GIÁ TRỊ (không bắt đầu bằng `#` sau khi trim) — KHÔNG kiểm `<gt>` là
//        gì (không ép mặc định).
//   §2 — dòng giá trị đó phải được một KHỐI COMMENT liền kề PHÍA TRÊN nó giải
//        thích hệ quả ở CẢ HAI trạng thái (TẮT/BẬT) — dò bằng từ khoá, không đọc
//        ngữ nghĩa; đủ để chặn "xoá sạch docblock, để trơ một dòng giá trị".
// Đột biến (mô phỏng TRONG BỘ NHỚ, 0 byte chạm đĩa): comment-hoá lại dòng giá
// trị (`# SPEC_GATE_SNAPSHOT_ENABLED=false`) ⇒ §1 phải ĐỎ — đúng hình dạng lỗ mà
// C-1 mô tả.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENV_EXAMPLE = resolve(REPO_ROOT, ".env.example");
const TEN_CO = "SPEC_GATE_SNAPSHOT_ENABLED";

/** Dòng KHỚP `TEN_CO=` mà KHÔNG phải chú thích (không bắt đầu bằng `#` sau khi trim). */
function laDongGiaTri(dong: string): boolean {
  const s = dong.trim();
  return s.startsWith(`${TEN_CO}=`) && !s.startsWith("#");
}

/** Chỉ số dòng (0-based) đầu tiên khớp `laDongGiaTri`, hoặc -1 nếu không có. */
function timDongGiaTri(dongs: readonly string[]): number {
  return dongs.findIndex(laDongGiaTri);
}

/**
 * Gom NGƯỢC LÊN các dòng comment (`#…`) liền kề PHÍA TRÊN `idx` — dừng ở dòng
 * đầu tiên KHÔNG bắt đầu bằng `#` (kể cả dòng trống). Trả về văn bản gộp, dùng
 * để dò từ khoá giải thích hệ quả hai trạng thái.
 */
function gomKhoiCommentPhiaTren(dongs: readonly string[], idx: number): string {
  const doan: string[] = [];
  for (let i = idx - 1; i >= 0; i--) {
    const l = dongs[i]!;
    if (l.trim().startsWith("#")) doan.unshift(l);
    else break;
  }
  return doan.join("\n");
}

describe("C-1 census — SPEC_GATE_SNAPSHOT_ENABLED không được TẮT IM LẶNG (.env.example)", () => {
  it("cầu chì: .env.example phải đọc được và không rỗng", () => {
    const raw = readFileSync(ENV_EXAMPLE, "utf8");
    expect(raw.length, ".env.example rỗng/đọc lỗi — census đang canh một tệp trống").toBeGreaterThan(1000);
  });

  it("★★★ BẤT BIẾN §1: .env.example phải có SPEC_GATE_SNAPSHOT_ENABLED= là GIÁ TRỊ THẬT, không phải chú thích", () => {
    const dongs = readFileSync(ENV_EXAMPLE, "utf8").split("\n");
    const idx = timDongGiaTri(dongs);
    expect(
      idx,
      `${TEN_CO}= phải xuất hiện dưới dạng GIÁ TRỊ (không "#" ở đầu) trong .env.example — ` +
        "nếu đây là -1, cờ TẮT lại trở nên im lặng (đúng lỗ C-1 review lượt 9 mô tả)",
    ).toBeGreaterThanOrEqual(0);
  });

  it("§2: dòng giá trị phải đi kèm KHỐI COMMENT liền kề giải thích hệ quả CẢ HAI trạng thái (TẮT/BẬT/hạ oan)", () => {
    const dongs = readFileSync(ENV_EXAMPLE, "utf8").split("\n");
    const idx = timDongGiaTri(dongs);
    expect(idx, "§1 phải đứng trước — không có dòng giá trị thì không có gì để đối chiếu").toBeGreaterThanOrEqual(0);

    const khoi = gomKhoiCommentPhiaTren(dongs, idx);
    expect(khoi, `thiếu khối comment NGAY PHÍA TRÊN dòng ${TEN_CO}=`).not.toBe("");
    expect(khoi, "khối comment phải nhắc trạng thái TẮT").toMatch(/TẮT/);
    expect(khoi, "khối comment phải nhắc trạng thái BẬT").toMatch(/BẬT/);
    expect(khoi, "khối comment phải nhắc hệ quả HẠ OAN (lý do cờ này quan trọng)").toMatch(/hạ oan|HẠ OAN/i);
  });

  it("★★★ ĐỘT BIẾN THẬT: comment-hoá lại dòng giá trị (mô phỏng TRONG BỘ NHỚ) ⇒ §1 phải ĐỎ", () => {
    const goc = readFileSync(ENV_EXAMPLE, "utf8");
    const dongs = goc.split("\n");
    const idx = timDongGiaTri(dongs);
    expect(idx, "không tìm thấy dòng giá trị THẬT để đột biến — bộ suy đã đổi neo?").toBeGreaterThanOrEqual(0);

    const dotBien = [...dongs];
    dotBien[idx] = `# ${dotBien[idx]}`;
    const idxSauDotBien = timDongGiaTri(dotBien);
    expect(
      idxSauDotBien,
      "đột biến comment-hoá dòng giá trị PHẢI làm census không còn thấy nó — nếu vẫn ≥0 thì census KHÔNG canh được gì",
    ).toBe(-1);

    // Đột biến chỉ sống trong biến `dotBien` — chưa từng ghi đĩa. Đọc lại xác nhận.
    const docLai = readFileSync(ENV_EXAMPLE, "utf8");
    expect(docLai).toBe(goc);
  });

  it("fuse: KHÔNG bắt nhầm một biến TÊN GẦN GIỐNG (vd một hậu tố khác) là dòng giá trị", () => {
    const dongGiaGia = [`${TEN_CO}_LEGACY=true`, `X${TEN_CO}=true`, `# nhắc tới ${TEN_CO} trong lời văn, không phải gán`];
    for (const d of dongGiaGia) {
      expect(laDongGiaTri(d), `dòng "${d}" KHÔNG được tính là dòng giá trị của ${TEN_CO}`).toBe(false);
    }
    expect(laDongGiaTri(`${TEN_CO}=false`)).toBe(true);
    expect(laDongGiaTri(`  ${TEN_CO}=true  `)).toBe(true);
  });
});
