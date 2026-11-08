/**
 * Pilot "Thợ Cả nhận việc" — L3b: ĐỘT BIẾN do thẻ khai + KHÔNG ĐƯỢC KHẲNG ĐỊNH + nghi ngờ "ghim lỗi".
 *
 * Vì sao (TC-03): test xanh nhưng (a) không bắt được đột biến nào dieu-phoi đặt tay, (b) GHI LẠI một lỗi của mã nguồn làm kỳ vọng.
 * Nay bộ chạy tự làm cả hai, không cần người ngồi đặt đột biến sau lượt:
 *  • thẻ có `ĐỘT BIẾN: <tệp>|<tìm>|<thay>` (nhiều dòng) — bộ chạy áp TỪNG đột biến lên tệp nguồn trong worktree pilot, chạy LỆNH KIỂM, rồi KHÔI PHỤC
 *    nguyên văn (so nội dung + `git status` sau khôi phục). Đột biến mà lệnh kiểm vẫn xanh = SỐNG ⇒ ketCuc `dot-bien-song`.
 *    Model KHÔNG biết nội dung đột biến: nó không nằm trong prompt (ghepLenh không in), không nằm trong worktree lúc model chạy (chỉ áp SAU khi model xong).
 *  • thẻ có `KHÔNG ĐƯỢC KHẲNG ĐỊNH: <chuỗi hoặc /regex/>` (nhiều dòng) — nếu một câu `expect(...)…;` trong tệp test model viết chứa nó ⇒ vi-pham `khang-dinh-cam`.
 *  • quét nhãn "hiện trạng|known bug|ghi lại|tạm thời" trong tệp test model viết ⇒ cảnh báo `ghimNghiNgo` (KHÔNG tự hạ ketCuc; người đọc quyết).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { RE_TEP_TEST, type ChayKiem, type KetQuaKiem } from "./kiemChung";

export { docDotBien, docKhangDinhCam, quetKhangDinhCam, quetGhimNghiNgo, tachCauExpect } from "./dotBienThuan";
export type { DotBienThe, KhangDinhCamTrung, GhimNghiNgo } from "./dotBienThuan";
import type { DotBienThe } from "./dotBienThuan";

// ── Áp đột biến ────────────────────────────────────────────────────────────────────────────────────

export interface KetQuaMotDotBien {
  tep: string;
  tim: string;
  /** do = lệnh kiểm ĐỎ khi có đột biến (test bắt được) · song = vẫn xanh · khong-ap-dung = không áp được (lỗi thẻ / tệp mất) */
  ketQua: "do" | "song" | "khong-ap-dung";
  chiTiet?: string;
  giay: number;
}
export interface KetQuaDotBien {
  tong: number;
  do: number;
  song: number;
  khongApDung: number;
  chiTiet: KetQuaMotDotBien[];
  /** nội dung/`git status` sau khôi phục có KHỚP bản gốc không */
  khoiPhucSach: boolean;
  /** tệp lạ xuất hiện sau khôi phục (không nằm trong tệp model đổi) */
  tepLa: string[];
}

function demLanXuatHien(nguon: string, tim: string): number {
  if (tim === "") return 0;
  return nguon.split(tim).length - 1;
}

/** Kiểm đột biến áp dụng được TRÊN BASE (đúng một chỗ khớp) — chạy TRƯỚC khi gọi model để lỗi thẻ không tốn lượt GPU. */
export function kiemDotBienTrenBase(wt: string, ds: readonly DotBienThe[]): string[] {
  const loi: string[] = [];
  for (const d of ds) {
    let nguon: string;
    try {
      nguon = fs.readFileSync(path.join(wt, d.tep), "utf8");
    } catch {
      loi.push(`ĐỘT BIẾN ${d.tep}: tệp không có trên base`);
      continue;
    }
    const n = demLanXuatHien(nguon, d.tim);
    if (n !== 1) loi.push(`ĐỘT BIẾN ${d.tep}: "${d.tim.slice(0, 50)}" xuất hiện ${n} lần trên base (cần đúng 1)`);
  }
  return loi;
}

export function trangThaiGit(wt: string): string[] {
  const r = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: wt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout ?? "").split("\n").filter((x) => x !== "");
}

/**
 * Áp TỪNG đột biến, chạy lệnh kiểm, KHÔI PHỤC nguyên văn (trong finally). Sau cùng so nội dung các tệp bị đột biến với bản gốc và đối chiếu
 * `git status` với tập tệp model đổi (`tepDoi`): thừa tệp ⇒ `tepLa`.
 */
export async function apDungDotBien(
  wt: string,
  ds: readonly DotBienThe[],
  tepDoi: readonly string[],
  lenhKiem: string,
  chayKiem: ChayKiem,
  hanGiay: number,
  khoiPhuc: (tuyetDoi: string, noiDung: string) => void = (f, s) => fs.writeFileSync(f, s, "utf8"),
): Promise<KetQuaDotBien> {
  const chiTiet: KetQuaMotDotBien[] = [];
  const goc = new Map<string, string>();
  let khoiPhucSach = true;
  const phuongVi = new Set(tepDoi.map((t) => t.replace(/\\/g, "/")));
  for (const d of ds) {
    const f = path.join(wt, d.tep);
    const t0 = Date.now();
    let nguon: string;
    try {
      nguon = fs.readFileSync(f, "utf8");
    } catch {
      chiTiet.push({ tep: d.tep, tim: d.tim, ketQua: "khong-ap-dung", chiTiet: "tệp không đọc được", giay: 0 });
      continue;
    }
    if (!goc.has(f)) goc.set(f, nguon);
    const n = demLanXuatHien(nguon, d.tim);
    if (n !== 1) {
      chiTiet.push({ tep: d.tep, tim: d.tim, ketQua: "khong-ap-dung", chiTiet: `"tìm" xuất hiện ${n} lần (cần đúng 1)`, giay: 0 });
      continue;
    }
    if (phuongVi.has(d.tep)) {
      chiTiet.push({ tep: d.tep, tim: d.tim, ketQua: "khong-ap-dung", chiTiet: "tệp đột biến nằm trong tệp model đổi — không áp (sẽ làm hỏng bài làm)", giay: 0 });
      continue;
    }
    let k: KetQuaKiem;
    try {
      fs.writeFileSync(f, nguon.replace(d.tim, () => d.thay), "utf8");
      k = await chayKiem(lenhKiem, wt, hanGiay);
    } finally {
      khoiPhuc(f, nguon);
    }
    const giay = Math.round(((Date.now() - t0) / 1000) * 10) / 10;
    // "ĐỎ" = lệnh kiểm không còn xanh: exit khác 0, hết hạn, hoặc có ca/tệp hỏng. Hết hạn/lỗi khởi chạy KHÔNG tính là bắt được (không kết luận) ⇒ khong-ap-dung.
    if (k.hetGio || k.loi) {
      chiTiet.push({ tep: d.tep, tim: d.tim, ketQua: "khong-ap-dung", chiTiet: k.hetGio ? `lệnh kiểm hết hạn sau ${k.giay}s với đột biến` : `lệnh kiểm không khởi chạy: ${k.loi}`, giay });
      continue;
    }
    const hong = (k.vitest.ca?.hong ?? 0) > 0 || (k.vitest.tep?.hong ?? 0) > 0;
    const do_ = k.exit !== 0 || hong;
    chiTiet.push({ tep: d.tep, tim: d.tim, ketQua: do_ ? "do" : "song", ...(do_ ? {} : { chiTiet: `lệnh kiểm vẫn xanh (exit ${k.exit})` }), giay });
  }
  for (const [f, nguon] of goc) {
    try {
      if (fs.readFileSync(f, "utf8") !== nguon) {
        khoiPhuc(f, nguon);
        if (fs.readFileSync(f, "utf8") !== nguon) khoiPhucSach = false;
      }
    } catch {
      khoiPhucSach = false;
    }
  }
  const tepLa = trangThaiGit(wt)
    .map((x) => x.slice(3).trim().replace(/^"|"$/g, ""))
    .filter((x) => !phuongVi.has(x) && x !== "AGENTS.md");
  return {
    tong: ds.length,
    do: chiTiet.filter((c) => c.ketQua === "do").length,
    song: chiTiet.filter((c) => c.ketQua === "song").length,
    khongApDung: chiTiet.filter((c) => c.ketQua === "khong-ap-dung").length,
    chiTiet,
    khoiPhucSach,
    tepLa,
  };
}

/** Lọc tệp test trong danh sách tệp đổi (cho quét khẳng định cấm / nghi ngờ). */
export function tepTestDoi(tepDoi: readonly string[]): string[] {
  return tepDoi.filter((t) => RE_TEP_TEST.test(t));
}
