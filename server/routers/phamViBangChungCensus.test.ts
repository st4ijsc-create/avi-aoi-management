/**
 * ★★★ W19 — CENSUS "miễn trừ phải có bằng chứng". Xem `phamViBangChung.ts`.
 *   §1 mọi bằng chứng trỏ tới một miễn trừ CÒN TỒN TẠI (không bằng chứng mồ côi);
 *   §2 bằng chứng kiểm chứng được: tệp tồn tại; `test` ⇒ chuỗi nằm trên dòng `it(`/`describe(`/`test(` (TÊN ca); `ma` ⇒ đoạn mã có trong tệp;
 *   §3 nợ-bằng-chứng (miễn trừ chưa có bằng chứng) ĐÚNG BẰNG số ghim — ghim chỉ được GIẢM (thêm miễn trừ không bằng chứng ⇒ đỏ; viết bằng chứng mà quên hạ ghim ⇒ đỏ).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIEN_TRU_GHI } from "./phamViGhiBaseline";
import { MIEN_TRU_CO_CHU_Y } from "./phamViDocBaseline";
import { MIEN_TRU_TUYEN_CO_CHU_Y } from "./phamViTuyenBaseline";
import { BANG_CHUNG_DOC, BANG_CHUNG_GHI, BANG_CHUNG_TUYEN, type BangChung } from "./phamViBangChung";

const GOC = join(__dirname, "..", "..");

/** Ghim nợ-bằng-chứng (đo 2026-10-25): chỉ được GIẢM. */
const GHIM = { ghi: 22, doc: 31, tuyen: 4 } as const; // 2026-10-25 (W19): còn 22 ghi (AI tính toán / chạy ứng dụng / khoá ảnh ngoài phạm vi: aiGguf ×5, aiEval ×2, aiLocalTraining, aiSpecialist run ×3, aiAgent startPlaybook|phanHoi, aiCopilot confirm|cancel, aiChayUngDung ×3, kbStudio huyEvalMa, defectHeatmap, productModel.create) · 31 đọc (danh mục dùng chung / miễn trừ mới của L7 — luong-ui; 23 → 31 khi gộp main 2026-10-25) · 4 tuyến

const SO = [
  { ten: "ghi", mien: MIEN_TRU_GHI as Readonly<Record<string, string>>, bang: BANG_CHUNG_GHI },
  { ten: "doc", mien: MIEN_TRU_CO_CHU_Y as Readonly<Record<string, string>>, bang: BANG_CHUNG_DOC },
  { ten: "tuyen", mien: MIEN_TRU_TUYEN_CO_CHU_Y as Readonly<Record<string, string>>, bang: BANG_CHUNG_TUYEN },
] as const;

function kiem(bc: BangChung): string | null {
  const d = join(GOC, bc.tep);
  if (!existsSync(d)) return `tệp không tồn tại: ${bc.tep}`;
  const noiDung = readFileSync(d, "utf8");
  if (bc.loai === "ma") return noiDung.includes(bc.dau) ? null : `đoạn mã không có trong ${bc.tep}: ${bc.dau}`;
  const dong = noiDung.split("\n").find((l) => l.includes(bc.ca) && /\b(it|describe|test)(\.\w+)?\(/.test(l));
  return dong ? null : `chuỗi không nằm trên dòng it(/describe( của ${bc.tep}: ${bc.ca}`;
}

describe("§1 bằng chứng không mồ côi", () => {
  for (const s of SO) {
    it(`${s.ten}: mọi khoá bằng chứng là một miễn trừ còn tồn tại`, () => {
      expect(Object.keys(s.bang).filter((k) => !(k in s.mien))).toEqual([]);
    });
  }
});

describe("§2 bằng chứng kiểm chứng được", () => {
  for (const s of SO) {
    it(`${s.ten}: tệp có thật, chuỗi nằm trong TÊN ca / đoạn mã có thật`, () => {
      const loi = Object.entries(s.bang).flatMap(([k, bc]) => {
        const e = kiem(bc);
        return e ? [`${k}: ${e}`] : [];
      });
      expect(loi).toEqual([]);
    });
  }
});

describe("§3 nợ-bằng-chứng có ghim, chỉ giảm", () => {
  it("số miễn trừ chưa có bằng chứng = ghim", () => {
    const no = Object.fromEntries(SO.map((s) => [s.ten, Object.keys(s.mien).filter((k) => !(k in s.bang)).length]));
    // eslint-disable-next-line no-console
    console.info(`[phamViBangChung] nợ-bằng-chứng: ghi ${no.ghi}/${Object.keys(MIEN_TRU_GHI).length} · đọc ${no.doc}/${Object.keys(MIEN_TRU_CO_CHU_Y).length} · tuyến ${no.tuyen}/${Object.keys(MIEN_TRU_TUYEN_CO_CHU_Y).length}`);
    expect(no).toEqual(GHIM);
  });
  it("cầu chì: sổ miễn trừ không rỗng (census không mù)", () => {
    expect(Object.keys(MIEN_TRU_GHI).length).toBeGreaterThan(50);
  });
});
