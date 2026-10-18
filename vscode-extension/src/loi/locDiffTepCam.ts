/**
 * ★★★ RÀ BẢO MẬT 9d26ad568 — LOẠI KHỐI CỦA TỆP CẤM KHỎI ĐẦU RA `git diff` (THUẦN, không `vscode`, không `node:*`).
 *
 * `git diff` / `git diff --staged` in NGUYÊN VĂN nội dung mọi tệp đã theo dõi / đã stage — kể cả `.env`, `id_rsa_*`,
 * `*.key` lỡ `git add -f`. Ba đường đưa đầu ra đó RỜI MÁY: `/commit` (`lenhGach.ts`), thẻ `@git` (`nguCanhAgent.ts`),
 * và `run_command` của model (`ui/boThucThiVscode.ts`). Trước bản vá cả ba chỉ qua `cheBiMat` — tầng CHE chỉ bắt chuỗi
 * có HÌNH DẠNG bí mật (`sk-…`, `password=…`); `GITHUB_PAT=ghp_…`, `PRIVATE_KEY_B64=…`, `SMTP_PASS2=…` lọt nguyên văn.
 * Cùng nguyên tắc `camRoiMay` (`nguCanh.ts`): tệp không được MỞ thì chặn ở tầng TỆP, không phó thác cho tầng CHE.
 *
 * Cách làm — FAIL-CLOSED theo TỪNG KHỐI `diff --git`: gom MỌI đường ứng viên của khối (tiêu đề `diff --git`, `--- a/…`,
 * `+++ b/…`, `rename/copy from/to`, và — phòng khi tách tiêu đề sai vì dấu cách — từng TOKEN của tiêu đề) rồi hỏi
 * `duocPhepRoiMay` (vị từ DUY NHẤT của "nội dung tệp này có được rời máy không"). MỘT ứng viên bị cấm ⇒ bỏ CẢ khối,
 * thay bằng MỘT dòng khai (không bắt đầu bằng `diff --git`, nên lọc lại lần hai không đẻ khối mới).
 * Chỉ đọc đường ở PHẦN ĐẦU khối (trước hunk `@@` đầu tiên): một dòng XOÁ có nội dung `-- a/x` hiện thành `--- a/x`
 * BÊN TRONG hunk và không được coi là tiêu đề.
 */
import { duocPhepRoiMay } from "./nguCanh";

export interface KetQuaLocDiff {
  diff: string;
  /** Đường (tương đối repo) của các tệp đã bị loại — để CẢNH BÁO người dùng; tên tệp không phải bí mật. */
  tepBiLoai: string[];
}

/** Giải đường trích dẫn kiểu C của git (`core.quotePath`): `"a/t\303\240i/.env"` ⇒ `a/tài/.env`. */
function boTrichDan(s: string): string {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s;
  const bytes: number[] = [];
  const than = s.slice(1, -1);
  const ESC: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < than.length; i++) {
    const c = than[i];
    if (c === "\\" && i + 1 < than.length) {
      const sau = than.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(sau)) {
        bytes.push(parseInt(sau, 8));
        i += 3;
        continue;
      }
      const ma = ESC[than[i + 1]];
      if (ma !== undefined) {
        bytes.push(ma);
        i += 1;
        continue;
      }
    }
    bytes.push(...Buffer.from(c, "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

const boTienTo = (p: string): string => p.replace(/^[ab]\//, "");

/** Mọi đường ứng viên của MỘT khối (chỉ phần đầu khối, trước hunk đầu tiên). */
function duongUngVien(dauKhoi: string[]): string[] {
  const ra: string[] = [];
  const tieuDe = dauKhoi[0].slice("diff --git ".length);
  // (1) Tiêu đề đối xứng `a/P b/P` (ca thường, kể cả P có dấu cách).
  const n = (tieuDe.length - 5) / 2;
  if (Number.isInteger(n) && n > 0 && tieuDe.startsWith("a/") && tieuDe.slice(2 + n) === ` b/${tieuDe.slice(2, 2 + n)}`) {
    ra.push(tieuDe.slice(2, 2 + n));
  }
  // (2) Tiêu đề trích dẫn: `"a/…" "b/…"`.
  for (const m of tieuDe.matchAll(/"(?:[^"\\]|\\.)*"/g)) ra.push(boTienTo(boTrichDan(m[0])));
  // (3) Từng token của tiêu đề — phòng thủ khi (1)/(2) không tách được (đổi tên + dấu cách).
  for (const t of tieuDe.split(/\s+/)) if (t) ra.push(boTienTo(boTrichDan(t)));
  for (const dong of dauKhoi.slice(1)) {
    const m = /^(?:---|\+\+\+) (.+?)\t?$/.exec(dong);
    if (m && m[1] !== "/dev/null") ra.push(boTienTo(boTrichDan(m[1])));
    const r = /^(?:rename|copy) (?:from|to) (.+)$/.exec(dong);
    if (r) ra.push(boTrichDan(r[1]));
    const b = /^Binary files (.+) and (.+) differ$/.exec(dong);
    if (b) for (const x of [b[1], b[2]]) if (x !== "/dev/null") ra.push(boTienTo(boTrichDan(x)));
  }
  return ra;
}

export function locDiffTepCam(diff: string): KetQuaLocDiff {
  const dong = diff.split("\n");
  const ra: string[] = [];
  const tepBiLoai: string[] = [];
  let i = 0;
  while (i < dong.length) {
    if (!dong[i].startsWith("diff --git ")) {
      ra.push(dong[i]);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < dong.length && !dong[j].startsWith("diff --git ")) j++;
    const khoi = dong.slice(i, j);
    const hunkDau = khoi.findIndex((d) => d.startsWith("@@"));
    const dauKhoi = hunkDau === -1 ? khoi : khoi.slice(0, hunkDau);
    const cam = duongUngVien(dauKhoi).find((p) => !duocPhepRoiMay(p));
    if (cam === undefined) {
      ra.push(...khoi);
    } else {
      tepBiLoai.push(cam);
      ra.push(`[sensitive file "${cam}" (.env / private key / certificate…): its diff was removed by the editor — content not sent]`);
    }
    i = j;
  }
  return { diff: tepBiLoai.length ? ra.join("\n") : diff, tepBiLoai };
}
