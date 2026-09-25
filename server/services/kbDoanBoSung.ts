/**
 * ★ PDCA vòng 15 (2026-09-25) — ĐOẠN BỔ SUNG cho tài liệu Markdown nạp vào Training Studio.
 *
 * Kho HỆ THỐNG đã có hai loại đoạn bổ sung cho tài liệu miền (PDCA §8.3, §9.2): nhóm dòng của bảng lớn và đoạn con cỡ đoạn
 * văn theo mục. Kho Studio vẫn cắt cố định 1.800 ký tự ⇒ "cây kim" (một dòng mã lỗi trong bảng dài, một câu trong đoạn dài)
 * bị pha loãng, và một ghi chú chèn thêm làm DỊCH ranh giới mọi đoạn phía sau (T14 hạng 1 → 2, §17).
 *
 * Đây là bản TypeScript của `scripts/ai-kb/_bang-nhom-dong.mjs` + `scripts/ai-kb/_doan-con.mjs` (dựng kho hệ thống chạy bằng
 * node trơn, không nạp được .ts). HAI bản phải cho ra CÙNG kết quả — lưới `kbDoanBoSung.test.ts` so trên mọi tệp
 * `knowledge/domain/*.md`. Hàm THUẦN.
 */

export const MIN_DONG = 5;
export const DONG_MOI_NHOM = 4;
export const MAX_CON = 600;
const MIN_KY_TU = 60;

const laDongBang = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l);
const laDongPhanCach = (l: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

/** Bảng ≥ `minDong` dòng dữ liệu ⇒ nhóm `dongMoiNhom` dòng, mỗi nhóm mang tiêu đề mục gần nhất + dòng tiêu đề bảng. */
export function tachBangThanhNhom(text: string, o: { minDong?: number; dongMoiNhom?: number } = {}): string[] {
  const minDong = o.minDong ?? MIN_DONG;
  const dongMoiNhom = o.dongMoiNhom ?? DONG_MOI_NHOM;
  const lines = String(text ?? "").split(/\r?\n/);
  const ra: string[] = [];
  let tieuDe = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s+/.test(l)) tieuDe = l.trim();
    if (laDongBang(l) && i + 1 < lines.length && laDongPhanCach(lines[i + 1])) {
      const dau = l.trim();
      const pc = lines[i + 1].trim();
      let j = i + 2;
      const du: string[] = [];
      while (j < lines.length && laDongBang(lines[j]) && !laDongPhanCach(lines[j])) du.push(lines[j].trim()), j++;
      if (du.length >= minDong) {
        for (let k = 0; k < du.length; k += dongMoiNhom) {
          ra.push([tieuDe, dau, pc, ...du.slice(k, k + dongMoiNhom)].filter(Boolean).join("\n"));
        }
      }
      i = j - 1;
    }
  }
  return ra;
}

const laBangLon = (p: string): boolean => p.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l)).length >= 7;

/** Đoạn con ≤ `maxCon` ký tự theo mục (bỏ bảng lớn — đã có nhóm dòng); đoạn TRÙNG nguyên văn với `doanGoc` bị bỏ. */
export function tachDoanCon(text: string, o: { maxCon?: number; doanGoc?: readonly string[] } = {}): string[] {
  const maxCon = o.maxCon ?? MAX_CON;
  const goc = new Set((o.doanGoc ?? []).map((d) => String(d).trim()));
  const ra: string[] = [];
  let tieuDe = "";
  let goi: string[] = [];
  const xa = () => {
    if (!goi.length) return;
    const than = goi.join("\n\n");
    const doan = (tieuDe ? `${tieuDe}\n` : "") + than;
    if (than.length >= MIN_KY_TU && !goc.has(doan.trim()) && !goc.has(than.trim())) ra.push(doan);
    goi = [];
  };
  for (const khoi of String(text ?? "").replace(/\r\n/g, "\n").split(/\n\s*\n/g)) {
    const p = khoi.trim();
    if (!p) continue;
    const dauMuc = p.match(/^(#{1,6}\s+.+)$/m);
    if (dauMuc && p.split("\n")[0].startsWith("#")) {
      xa();
      tieuDe = p.split("\n")[0].trim();
      const conLai = p.split("\n").slice(1).join("\n").trim();
      if (!conLai) continue;
      goi.push(conLai);
      continue;
    }
    if (laBangLon(p)) {
      xa();
      continue;
    }
    const thu = [...goi, p].join("\n\n");
    if (thu.length > maxCon && goi.length) xa();
    goi.push(p);
    if (p.length > maxCon) xa();
  }
  xa();
  return ra;
}

/** Nguồn Markdown? (đuôi tên tệp hoặc kiểu nguồn). Chỉ Markdown mới có cấu trúc mục/bảng để tách. */
export function laMarkdown(sourceType: string, sourceRef: string): boolean {
  return /(^|\.)(md|markdown)$/i.test(String(sourceType ?? "").trim()) || /\.(md|markdown)$/i.test(String(sourceRef ?? "").trim());
}

export const doanBoSungBat = (): boolean => process.env.KB_INGEST_DOAN_BO_SUNG !== "0";

/** Đoạn BỔ SUNG (không thay đoạn gốc) cho một tài liệu Markdown: nhóm dòng bảng + đoạn con. */
export function doanBoSung(text: string, doanGoc: readonly string[]): string[] {
  const bang = tachBangThanhNhom(text);
  const con = tachDoanCon(text, { doanGoc: [...doanGoc, ...bang] });
  return [...bang, ...con];
}
