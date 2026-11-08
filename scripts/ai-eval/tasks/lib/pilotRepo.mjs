/**
 * Bài `pilot-repo`: việc thật trong repo (thẻ TC-xx). Model viết MỘT tệp test; không tin lời khai, chạy lại ở đây:
 *   ĐẠT ⇔ nguồn đúng bản lúc giao (`bai.nguonGhim`) · chỉ sửa `bai.tepDuocSua` · lệnh kiểm xanh, có ≥ 1 test · số đột biến bị bắt ≥ `nguongDotBien`.
 *
 *   node check.mjs --thu-muc <cây repo có node_modules>       chấm cây đó, đột biến áp tại chỗ rồi khôi phục và so băm
 *   node check.mjs --kiem-thuoc mau|goc|gian-lan              trên cây chứa script: mau phải ĐẠT; goc (không tệp test), gian-lan (test rỗng nghĩa) phải TRƯỢT
 *
 * Đột biến nằm trong check.mjs, KHÔNG nằm trong prompt.md. Không chạm CSDL: tiến trình test nhận DATABASE_URL trỏ cổng chết.
 * ⚠ Mỗi lúc chỉ MỘT check.mjs trên một cây: đột biến sửa tệp tại chỗ.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ketThuc, LoiThuoc, ROOT, thamSo } from "./chung.mjs";

const CONG_CHET = "postgres://khong:khong@127.0.0.1:9";
const ANSI = /\x1b\[[0-9;]*m/g;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function git(cay, ...a) {
  const r = spawnSync("git", ["-C", cay, ...a], { encoding: "utf8", maxBuffer: 64 << 20, windowsHide: true });
  if (r.status !== 0) throw new LoiThuoc(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** Đọc dòng tổng kết vitest. null = không có dòng "Tests" (lỗi nạp, không phải kết quả test). */
export function docTongKet(raw) {
  const out = raw.replace(ANSI, "");
  const tests = out.split(/\r?\n/).filter((l) => /^\s*Tests\s/.test(l)).pop();
  if (!tests) return null;
  const so = (re) => {
    const m = tests.match(re);
    return m ? Number(m[1]) : 0;
  };
  return { pass: so(/(\d+) passed/), fail: so(/(\d+) failed/), dong: tests.trim() };
}

function chayKiem(cay, tepTest) {
  // KHÔNG shell + đúng một đường tệp: shell:true từng làm vitest quét cả tệp .db (xem memory vitest-chay-tu-script-bay-chon-tep).
  const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", tepTest], {
    cwd: cay,
    encoding: "utf8",
    maxBuffer: 64 << 20,
    timeout: 180_000,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", DATABASE_URL: `${CONG_CHET}/aoi_management`, TEST_DATABASE_URL: `${CONG_CHET}/aoi_management_test` },
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  return { ma: r.status, tk: docTongKet(out), duoi: out.replace(ANSI, "").slice(-500) };
}

/** Áp một đột biến lên nội dung tệp. `tim` phải khớp ĐÚNG MỘT chỗ; `json` xoá hoặc đặt khoá theo đường chấm. */
export function apDotBien(noiDung, d) {
  if (d.json) {
    const o = JSON.parse(noiDung);
    const k = d.json.duong.split(".");
    const cha = k.slice(0, -1).reduce((x, p) => x?.[p], o);
    const cuoi = k[k.length - 1];
    if (!cha || !(cuoi in cha)) throw new LoiThuoc(`đột biến ${d.ma}: không có khoá ${d.json.duong}`);
    if ("dat" in d.json) cha[cuoi] = d.json.dat;
    else delete cha[cuoi];
    return JSON.stringify(o, null, 2);
  }
  const n = noiDung.split(d.tim).length - 1;
  if (n !== 1) throw new LoiThuoc(`đột biến ${d.ma}: "${d.tim}" khớp ${n} chỗ trong ${d.tep}, cần đúng 1`);
  return noiDung.replace(d.tim, () => d.thay);
}

/** Chạy đột biến, dừng sớm khi không còn đạt được ngưỡng. Luôn khôi phục và so băm. */
function chayDotBien(cay, tepTest, dotBien, nguong) {
  const ket = [];
  let song = 0;
  for (const d of dotBien) {
    if (dotBien.length - song < nguong) break;
    const p = `${cay}/${d.tep}`;
    const goc = fs.readFileSync(p);
    const bam = sha(goc);
    try {
      fs.writeFileSync(p, apDotBien(goc.toString("utf8"), d));
      const r = chayKiem(cay, tepTest);
      // Đỏ nhưng không có dòng Tests là lỗi nạp: đột biến hỏng cú pháp không được tính là "bắt được".
      if (r.ma !== 0 && (!r.tk || r.tk.fail === 0)) throw new LoiThuoc(`đột biến ${d.ma} làm test không chạy được: ${r.duoi}`);
      const bat = r.ma !== 0;
      if (!bat) song++;
      ket.push({ ma: d.ma, bat, ...(r.tk ? { dong: r.tk.dong } : {}) });
    } finally {
      fs.writeFileSync(p, goc);
      if (sha(fs.readFileSync(p)) !== bam) throw new LoiThuoc(`không khôi phục được ${d.tep}`);
    }
  }
  return { ket, soBat: ket.filter((k) => k.bat).length, song };
}

/** Đường bị đổi trong cây (git status), trừ tệp được phép. */
export function tepNgoaiThe(cay, duocPhep) {
  return git(cay, "status", "--porcelain", "--untracked-files=all")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""))
    .filter((f) => !duocPhep.includes(f));
}

/** Bản đúng lúc giao: so blob theo git (`hash-object` áp eol của repo, nên bản sao CRLF vẫn khớp). */
function kiemNguonGhim(cay, nguonGhim) {
  for (const [tep, blob] of Object.entries(nguonGhim)) {
    const that = git(cay, "hash-object", "--", tep).trim();
    if (that !== blob) throw new LoiThuoc(`cây sai: ${tep} là blob ${that}, thẻ giao trên ${blob}`);
  }
}

const TEST_GIAN_LAN = 'import { expect, it } from "vitest";\nit("xanh", () => expect(1).toBe(1));\n';

function docBlob(cay, blob) {
  const r = spawnSync("git", ["-C", cay, "cat-file", "blob", blob], { maxBuffer: 64 << 20, windowsHide: true });
  if (r.status !== 0) throw new LoiThuoc(`không đọc được blob ${blob}: ${r.stderr}`);
  return r.stdout;
}

/**
 * Dựng cây kiểm thước, trả hàm khôi phục. Nguồn đặt về đúng blob lúc giao và tệp test đặt theo chế độ, vì main đi tiếp (tệp test TC đã gộp,
 * TC-11 sẽ sửa `withParams`) mà thước vẫn phải đo được. Lời giải mẫu lấy từ `bai.mauBlob`, không để bản chép trong thư mục bài.
 */
function datCayKiemThuoc(cay, bai, kt) {
  const tepTest = bai.tepDuocSua[0];
  const cu = new Map();
  const ghi = (tep, noiDung) => {
    const p = `${cay}/${tep}`;
    if (!cu.has(tep)) cu.set(tep, fs.existsSync(p) ? fs.readFileSync(p) : null);
    if (noiDung === null) fs.rmSync(p, { force: true });
    else fs.writeFileSync(p, noiDung);
  };
  const khoiPhuc = () => {
    for (const [tep, b] of cu) {
      if (b === null) fs.rmSync(`${cay}/${tep}`, { force: true });
      else fs.writeFileSync(`${cay}/${tep}`, b);
    }
  };
  try {
    for (const [tep, blob] of Object.entries(bai.nguonGhim)) {
      if (git(cay, "hash-object", "--", tep).trim() !== blob) ghi(tep, docBlob(cay, blob));
    }
    ghi(tepTest, kt === "mau" ? docBlob(cay, bai.mauBlob) : kt === "gian-lan" ? TEST_GIAN_LAN : null);
  } catch (e) {
    khoiPhuc();
    throw e;
  }
  return khoiPhuc;
}

export async function cham({ bai }, { dotBien = [], nguongDotBien } = {}) {
  const { lay } = thamSo();
  const kt = lay("--kiem-thuoc");
  if (kt && !["mau", "goc", "gian-lan"].includes(kt)) throw new LoiThuoc(`--kiem-thuoc mau|goc|gian-lan, nhận: ${kt}`);
  if (!kt && !lay("--thu-muc")) throw new LoiThuoc("thiếu --thu-muc <cây repo> | --kiem-thuoc mau|goc|gian-lan");
  const cay = kt ? ROOT : path.resolve(lay("--thu-muc")).split(path.sep).join("/");
  if (!fs.existsSync(`${cay}/node_modules/vitest/vitest.mjs`)) throw new LoiThuoc(`cây không có node_modules: ${cay}`);
  const nguong = nguongDotBien ?? dotBien.length;
  const tepTest = bai.tepDuocSua[0];
  const t0 = Date.now();
  if (!kt) kiemNguonGhim(cay, bai.nguonGhim);
  const go = kt ? datCayKiemThuoc(cay, bai, kt) : () => undefined;
  try {
    const lyDo = [];
    // Kiểm thước chạy trên cây đang có chính bộ bài chưa commit nên bỏ qua bước này; `pilotRepo.test.mjs` đo nó trên repo git tạm.
    const ngoai = kt ? [] : tepNgoaiThe(cay, bai.tepDuocSua);
    if (ngoai.length) lyDo.push("VI_PHAM_NGOAI_THE");
    const r = chayKiem(cay, tepTest);
    if (!r.tk) lyDo.push(r.ma === 0 ? "KHONG_THAY_TONG_KET" : "TEST_KHONG_CHAY");
    else if (r.tk.fail > 0 || r.ma !== 0) lyDo.push("KIEM_DO");
    else if (r.tk.pass < 1) lyDo.push("TEST_RONG");
    let db = { ket: [], soBat: 0, song: 0 };
    if (!lyDo.length) {
      db = chayDotBien(cay, tepTest, dotBien, nguong);
      if (db.soBat < nguong) lyDo.push("DOT_BIEN_SONG");
    }
    return ketThuc({
      id: bai.id,
      dat: lyDo.length === 0,
      lyDo,
      ...(kt ? { kiemThuoc: kt } : {}),
      tests: r.tk?.dong ?? null,
      dotBien: { bat: db.soBat, tong: dotBien.length, nguong, song: db.ket.filter((k) => !k.bat).map((k) => k.ma) },
      ...(ngoai.length ? { ngoaiThe: ngoai } : {}),
      ms: Date.now() - t0,
    });
  } finally {
    go();
  }
}
