/**
 * ★ K1 — quét CHE OAN của bộ mẫu token `shared/mauBiMat.ts` trên kho văn bản của repo (chu-du-an-HST giao 14/11).
 *
 * Luật HST (14/11): mỗi lần đổi `MAU_TOKEN_CO_TIEN_TO` phải chạy lại K1; K1 có khớp MỚI so với nền ⇒ DỪNG, báo chủ dự án trước khi gộp.
 * Tệp này THUẦN (không đĩa / mạng / git) — phần đọc git ở `quet-che-oan.ts`. Không bao giờ trả THÂN khớp: chỉ tệp, dòng, hình dạng
 * `<tiền tố>+<số ký tự còn lại>`.
 *
 * Kho văn bản = tệp mã và tài liệu đã commit, BỎ test và fixture (chúng cố ý chứa khoá giả):
 *   docs/**.md · server/**.ts · client/src/**.ts(x) · shared/**.ts · scripts/**.mjs · vscode-extension/src/**.ts
 */
import { MAU_TOKEN_CO_TIEN_TO, nguonCoBien } from "../../shared/mauBiMat";

const RE_KHO: readonly RegExp[] = [
  /^docs\/(?:.*\/)?[^/]+\.md$/,
  /^server\/(?:.*\/)?[^/]+\.ts$/,
  /^client\/src\/(?:.*\/)?[^/]+\.tsx?$/,
  /^shared\/(?:.*\/)?[^/]+\.ts$/,
  /^scripts\/(?:.*\/)?[^/]+\.mjs$/,
  /^vscode-extension\/src\/(?:.*\/)?[^/]+\.ts$/,
];
const RE_BO = /\.(?:test|unit\.test|dom\.test)\.tsx?$|\.test\.mjs$|\/__tests__\/|\/fixtures?\//;

/** Đường (dạng git, `/`) có thuộc kho văn bản K1 không. */
export function laTepTrongKho(duong: string): boolean {
  return RE_KHO.some((re) => re.test(duong)) && !RE_BO.test(duong);
}

interface MauDo {
  ten: string;
  re: RegExp;
  dau: RegExp;
}
/** Một regex RIÊNG cho từng mẫu (cùng quy tắc biên với bộ che) ⇒ đếm được theo mẫu. */
const MAU_DO: readonly MauDo[] = MAU_TOKEN_CO_TIEN_TO.map((m) => ({
  ten: m.ten,
  re: new RegExp(nguonCoBien(m), "g"),
  dau: new RegExp(`(?:${m.tienTo})`),
}));
export const TEN_MAU: readonly string[] = MAU_DO.map((m) => m.ten);

export interface ViTriKhop {
  tep: string;
  dong: number;
  /** `<tiền tố>+<số ký tự sau tiền tố>` — KHÔNG có thân. */
  dang: string;
}
export interface KetQuaQuet {
  soTep: number;
  soDong: number;
  soKyTu: number;
  khop: Record<string, number>;
  viTri: Record<string, ViTriKhop[]>;
}

export function taoKetQuaRong(): KetQuaQuet {
  const khop: Record<string, number> = {};
  const viTri: Record<string, ViTriKhop[]> = {};
  for (const t of TEN_MAU) {
    khop[t] = 0;
    viTri[t] = [];
  }
  return { soTep: 0, soDong: 0, soKyTu: 0, khop, viTri };
}

/** Cộng kết quả quét MỘT tệp vào `kq` (sửa tại chỗ). */
export function quetNoiDung(kq: KetQuaQuet, tep: string, noiDung: string): void {
  kq.soTep += 1;
  kq.soKyTu += noiDung.length;
  const dong = noiDung.split("\n");
  kq.soDong += dong.length;
  dong.forEach((l, i) => {
    for (const m of MAU_DO) {
      for (const k of l.matchAll(m.re)) {
        const dau = m.dau.exec(k[0])?.[0] ?? "";
        kq.khop[m.ten]! += 1;
        kq.viTri[m.ten]!.push({ tep, dong: i + 1, dang: `${dau}+${k[0].length - dau.length}` });
      }
    }
  });
}

export interface Nen {
  /** Commit đã quét để lập nền (ghi chú, không dùng để so). */
  rev: string;
  khop: Record<string, number>;
}
export interface DongSoSanh {
  ten: string;
  nen: number;
  nay: number;
}
export interface SoSanh {
  /** Số khớp TĂNG so với nền (gồm mẫu chưa có trong nền mà nay > 0) ⇒ thoát 1. */
  moi: DongSoSanh[];
  /** Số khớp GIẢM — chỉ báo, không làm hỏng. */
  giam: DongSoSanh[];
  /** Mẫu có trong mauBiMat nhưng chưa có trong nền — phải lập lại nền CÓ CHỦ Ý. */
  thieuTrongNen: string[];
}

export function soVoiNen(kq: KetQuaQuet, nen: Nen): SoSanh {
  const ss: SoSanh = { moi: [], giam: [], thieuTrongNen: [] };
  for (const ten of TEN_MAU) {
    const coTrongNen = Object.prototype.hasOwnProperty.call(nen.khop, ten);
    if (!coTrongNen) ss.thieuTrongNen.push(ten);
    const truoc = coTrongNen ? nen.khop[ten]! : 0;
    const nay = kq.khop[ten] ?? 0;
    if (nay > truoc) ss.moi.push({ ten, nen: truoc, nay });
    else if (nay < truoc) ss.giam.push({ ten, nen: truoc, nay });
  }
  return ss;
}

/** 0 = không khớp mới; 1 = có khớp mới (DỪNG, báo chủ dự án). */
export function maThoat(ss: SoSanh): 0 | 1 {
  return ss.moi.length > 0 ? 1 : 0;
}

/** Nền từ một lần quét (để in ra; script KHÔNG tự ghi tệp). Khoá theo thứ tự TEN_MAU. */
export function lapNen(kq: KetQuaQuet, rev: string): Nen {
  return { rev, khop: Object.fromEntries(TEN_MAU.map((t) => [t, kq.khop[t] ?? 0])) };
}

/** Kiểm hình nền đọc từ JSON; ném khi sai hình (fail-closed: nền hỏng không được coi là "0 khớp"). */
export function docNen(x: unknown): Nen {
  if (!x || typeof x !== "object") throw new Error("nen-khong-phai-doi-tuong");
  const o = x as { rev?: unknown; khop?: unknown };
  if (typeof o.rev !== "string" || !o.rev) throw new Error("nen-thieu-rev");
  if (!o.khop || typeof o.khop !== "object" || Array.isArray(o.khop)) throw new Error("nen-thieu-khop");
  const khop: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.khop as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`nen-so-khop-sai:${k}`);
    khop[k] = v;
  }
  return { rev: o.rev, khop };
}

export type MucCatFile = { tep: string; noiDung: string } | { tep: string; thieu: true };

/**
 * Tách đầu ra `git cat-file --batch` (đầu vào: một dòng `<rev>:<tep>` cho mỗi tệp, theo đúng thứ tự `tepTheoThuTu`).
 * Mỗi mục: `<sha> blob <cỡ>\n<cỡ byte>\n` hoặc `<tên> missing\n`. Ném khi đầu ra lệch định dạng.
 */
export function tachCatFileBatch(buf: Buffer, tepTheoThuTu: readonly string[]): MucCatFile[] {
  const ra: MucCatFile[] = [];
  let i = 0;
  for (const tep of tepTheoThuTu) {
    const xuong = buf.indexOf(0x0a, i);
    if (xuong < 0) throw new Error(`cat-file-cut-ngang:${tep}`);
    const dau = buf.subarray(i, xuong).toString("utf8");
    i = xuong + 1;
    if (dau.endsWith(" missing")) {
      ra.push({ tep, thieu: true });
      continue;
    }
    const m = /^[0-9a-f]{40,64} (\w+) (\d+)$/.exec(dau);
    if (!m) throw new Error(`cat-file-dau-sai:${tep}`);
    const co = Number(m[2]);
    if (i + co + 1 > buf.length || buf[i + co] !== 0x0a) throw new Error(`cat-file-co-sai:${tep}`);
    ra.push({ tep, noiDung: buf.subarray(i, i + co).toString("utf8") });
    i += co + 1;
  }
  if (i !== buf.length) throw new Error("cat-file-thua-du-lieu");
  return ra;
}
