/**
 * HA-6b (phần 2) — LỆNH KIỂM THẬT: "xanh mà sản phẩm chưa đúng" (TC-14R: test và mã cùng lệch khỏi cấu trúc dist thật). Sau khi lệnh kiểm xanh, HOST chạy MỘT lệnh
 * chạy SẢN PHẨM thật trên một CÂY GIẢ do người viết thẻ cung cấp (thư mục fixture NGOÀI worktree); không đạt ⇒ ketCuc `hau-qua-xau`.
 *
 * Khoá thẻ host-only, đi đôi: `LỆNH KIỂM THẬT: <lệnh có {CAY}>` và `CÂY GIẢ: <đường tuyệt đối tới thư mục fixture>`.
 *   · Host CHÉP fixture vào thư mục tạm mới (không đi theo liên kết tượng trưng; có trần số tệp / byte), thay `{CAY}` (viết TRẦN, host tự đặt nháy kép) bằng đường bản chép, rồi
 *     chạy lệnh trong worktree bằng CÙNG hàm/cách ly/env sạch của lệnh kiểm. Xong thì xoá bản chép.
 *   · Model KHÔNG thấy lệnh, đường fixture, nội dung fixture lẫn đầu ra: chỉ JSON kết quả cuối có `{dat, exit, hetGio, giay, lyDo}` — không lệnh, không đường, không đầu ra.
 *   · Sản phẩm CHỈ được ghi vào {CAY} hoặc thư mục tạm: host chụp trạng thái worktree TRƯỚC và SAU lệnh (git status không-ignored đầy đủ + ignored + băm nội dung mọi tệp đang lệch);
 *     khác nhau ở bất kỳ chỗ nào (sửa / tạo / xoá, kể cả tệp .gitignore) ⇒ không đạt, lyDo `lenh-that-ghi-vao-wt`. Không chụp được ⇒ không đạt (fail-closed).
 *   · Bất biến: chỉ chạy mã đã được người duyệt (cùng điều kiện như lệnh kiểm — chạy SAU khi các bước kiểm trước xanh).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChayKiem } from "./kiemChung";

export const DAU_CAY = "{CAY}";
export const TRAN_DO_DAI_LENH_THAT = 400;
export const TRAN_TEP_CAY = 5000;
export const TRAN_BYTE_CAY = 100 * 1024 * 1024;

export interface KiemThat {
  lenh: string;
  cay: string;
}

const CO_KY_TU_DIEU_KHIEN = /[\u0000-\u001f\u007f]/;

/** Phân tích hai khoá thẻ. Cả hai rỗng ⇒ ok không bật. Một trong hai ⇒ lỗi. Thông điệp lỗi KHÔNG chép lệnh / đường. */
export function docKiemThat(lenhTho: string | undefined, cayTho: string | undefined): { ok: true; kiemThat?: KiemThat } | { ok: false; loi: string } {
  const lenh = (lenhTho ?? "").trim();
  const cay = (cayTho ?? "").trim();
  if (lenh === "" && cay === "") return { ok: true };
  if (lenh === "" || cay === "") return { ok: false, loi: "LỆNH KIỂM THẬT và CÂY GIẢ phải đi đôi (thiếu một trong hai)" };
  if (CO_KY_TU_DIEU_KHIEN.test(lenh) || lenh.length > TRAN_DO_DAI_LENH_THAT) return { ok: false, loi: `LỆNH KIỂM THẬT phải một dòng, ≤ ${TRAN_DO_DAI_LENH_THAT} ký tự, không ký tự điều khiển` };
  if (lenh.split(DAU_CAY).length < 2) return { ok: false, loi: `LỆNH KIỂM THẬT phải chứa ${DAU_CAY} (đường cây giả; viết trần, không đặt nháy)` };
  if (/["'`]\{CAY\}|\{CAY\}["'`]/.test(lenh)) return { ok: false, loi: `LỆNH KIỂM THẬT: ${DAU_CAY} phải viết TRẦN (host tự đặt nháy)` };
  if (CO_KY_TU_DIEU_KHIEN.test(cay) || !path.isAbsolute(cay)) return { ok: false, loi: "CÂY GIẢ phải là đường tuyệt đối, một dòng" };
  return { ok: true, kiemThat: { lenh, cay } };
}

export type KetQuaChep = { ok: true; dir: string; don: () => void } | { ok: false; lyDo: string };

function dem(dir: string, so: { tep: number; byte: number }): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) return "cay-gia-co-lien-ket-tuong-trung";
    if (e.isDirectory()) {
      const r = dem(p, so);
      if (r) return r;
    } else if (e.isFile()) {
      so.tep++;
      so.byte += fs.statSync(p).size;
      if (so.tep > TRAN_TEP_CAY || so.byte > TRAN_BYTE_CAY) return "cay-gia-qua-lon";
    } else return "cay-gia-co-tep-dac-biet";
  }
  return null;
}

/** Chép fixture vào thư mục tạm mới. Fixture phải là thư mục NGOÀI worktree (cả hai chiều), không liên kết tượng trưng, không quá trần. */
export function chepCayGia(cay: string, wt: string, thuMucTam: string = os.tmpdir()): KetQuaChep {
  let cayThat: string;
  let wtThat: string;
  try {
    cayThat = fs.realpathSync.native(cay);
    wtThat = fs.realpathSync.native(wt);
    if (!fs.statSync(cayThat).isDirectory()) return { ok: false, lyDo: "cay-gia-khong-phai-thu-muc" };
  } catch {
    return { ok: false, lyDo: "cay-gia-khong-doc-duoc" };
  }
  const trong = (cha: string, con: string) => {
    const r = path.relative(cha, con);
    return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
  };
  if (trong(wtThat, cayThat) || trong(cayThat, wtThat)) return { ok: false, lyDo: "cay-gia-long-voi-worktree" };
  let tong: string | null;
  try {
    tong = dem(cayThat, { tep: 0, byte: 0 });
  } catch {
    return { ok: false, lyDo: "cay-gia-khong-doc-duoc" };
  }
  if (tong) return { ok: false, lyDo: tong };
  let goc: string;
  try {
    goc = fs.mkdtempSync(path.join(thuMucTam, "tcp-cay-"));
    fs.cpSync(cayThat, path.join(goc, "cay"), { recursive: true, dereference: false, verbatimSymlinks: true });
  } catch {
    return { ok: false, lyDo: "khong-chep-duoc-cay-gia" };
  }
  return { ok: true, dir: path.join(goc, "cay"), don: () => fs.rmSync(goc, { recursive: true, force: true }) };
}

/** Hàm chạy `git <args>` trong `wt`, trả stdout; lỗi ⇒ null. Do bộ chạy TIÊM vào (module này không tự sinh tiến trình — giữ bản liệt kê điểm cấp phát nguyên). */
export type ChayGit = (wt: string, args: string[]) => string | null;

/**
 * Ảnh chụp worktree: status đầy đủ (không ignored, -z, mọi tệp chưa theo dõi) + status có ignored + băm nội dung từng tệp đang lệch. null = không chụp được.
 * Băm nội dung để bắt việc lệnh ghi THÊM vào tệp mà model đã sửa (status vẫn là " M" trước lẫn sau).
 */
export function chupWt(wt: string, git: ChayGit): string | null {
  const a = git(wt, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const b = git(wt, ["status", "--porcelain=v1", "-z", "--ignored"]);
  if (a === null || b === null) return null;
  const dong = a.split("\0").filter((x) => x !== "");
  const hash: string[] = [];
  for (const d of dong) {
    const duong = d.slice(3);
    try {
      const st = fs.lstatSync(path.join(wt, duong));
      hash.push(st.isFile() ? `${duong}=${createHash("sha1").update(fs.readFileSync(path.join(wt, duong))).digest("hex")}` : `${duong}=<${st.isDirectory() ? "thu-muc" : "khac"}>`);
    } catch {
      hash.push(`${duong}=<vang>`);
    }
  }
  return [a, b, hash.join("\n")].join("\n--\n");
}

/** Kết quả CHO JSON: không lệnh, không đường, không đầu ra. */
export interface KetQuaKiemThat {
  dat: boolean;
  exit: number | null;
  hetGio: boolean;
  giay: number;
  lyDo: string | null;
}

/** Chạy LỆNH KIỂM THẬT (fail-closed: mọi lỗi ⇒ dat:false). `chay` là hàm chạy lệnh kiểm của bộ chạy (cùng cách ly / env sạch). */
export async function chayKiemThat(kt: KiemThat, wt: string, chay: ChayKiem, hanGiay: number, chup: (wt: string) => string | null, thuMucTam?: string): Promise<KetQuaKiemThat> {
  const chep = chepCayGia(kt.cay, wt, thuMucTam);
  if (!chep.ok) return { dat: false, exit: null, hetGio: false, giay: 0, lyDo: chep.lyDo };
  try {
    const truoc = chup(wt);
    if (truoc === null) return { dat: false, exit: null, hetGio: false, giay: 0, lyDo: "khong-chup-duoc-wt" };
    const lenh = kt.lenh.split(DAU_CAY).join(`"${chep.dir}"`);
    const k = await chay(lenh, wt, hanGiay);
    const sau = chup(wt);
    if (sau === null || sau !== truoc) return { dat: false, exit: k.exit, hetGio: k.hetGio, giay: k.giay, lyDo: sau === null ? "khong-chup-duoc-wt" : "lenh-that-ghi-vao-wt" };
    if (k.hetGio) return { dat: false, exit: k.exit, hetGio: true, giay: k.giay, lyDo: `het-gio-${k.giay}s` };
    if (k.loi) return { dat: false, exit: k.exit, hetGio: false, giay: k.giay, lyDo: "khong-khoi-chay-duoc" };
    if (k.exit !== 0) return { dat: false, exit: k.exit, hetGio: false, giay: k.giay, lyDo: `thoat-ma-${k.exit}` };
    return { dat: true, exit: 0, hetGio: false, giay: k.giay, lyDo: null };
  } catch {
    return { dat: false, exit: null, hetGio: false, giay: 0, lyDo: "loi-bo-chay" };
  } finally {
    chep.don();
  }
}
