// Chạy: node --test scripts/ai/tao-khoa-llama.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gocDuAn, lyDoTuChoi, taoKhoa, taoTepKhoa } from "./tao-khoa-llama.mjs";

const TEP = fileURLToPath(new URL("./tao-khoa-llama.mjs", import.meta.url));
const GOC = path.resolve(path.dirname(TEP), "../..");
const moi = () => fs.mkdtempSync(path.join(os.tmpdir(), "tao-khoa-"));

test("từ chối đường trống, trong repo, tệp đã có; nhận đường ngoài repo", () => {
  const d = moi();
  try {
    assert.match(lyDoTuChoi(""), /thiếu/);
    assert.match(lyDoTuChoi(path.join(GOC, "khoa.txt")), /trong repo/);
    fs.writeFileSync(path.join(d, "co"), "x");
    assert.match(lyDoTuChoi(path.join(d, "co")), /đã có/);
    assert.equal(lyDoTuChoi(path.join(d, "moi")), null);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("từ chối thư mục anh em của repo và mọi gốc dự án agent đọc được", () => {
  assert.match(lyDoTuChoi(path.join(path.dirname(GOC), "_tho_ca_wt", "k")), /worktree/);
  const d = moi();
  try {
    const goc = gocDuAn(`a=A|${path.join(d, "du-an")};b=B|C:/khac`);
    assert.deepEqual(goc, [path.join(d, "du-an"), "C:/khac"]);
    assert.match(lyDoTuChoi(path.join(d, "du-an", "con", "k"), GOC, goc), /gốc dự án/);
    assert.equal(lyDoTuChoi(path.join(d, "ngoai", "k"), GOC, goc), null);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/** Tạo junction `lien` → `dich`. Dọn bằng `donAnToan`, KHÔNG bao giờ rmSync đệ quy khi còn junction (đích có thể là repo). */
function lien(lienP, dich) {
  fs.symlinkSync(dich, lienP, "junction");
  return lienP;
}
/** Dọn thư mục tạm có junction: gỡ từng junction (không đệ quy vào đích); chỉ xoá thư mục khi không còn liên kết nào. */
function donAnToan(d) {
  for (const e of fs.readdirSync(d)) {
    const p = path.join(d, e);
    if (!fs.lstatSync(p).isSymbolicLink()) continue;
    try {
      fs.unlinkSync(p);
    } catch {
      fs.rmdirSync(p);
    }
  }
  if (fs.readdirSync(d).some((e) => fs.lstatSync(path.join(d, e)).isSymbolicLink())) throw new Error(`còn junction trong ${d}, không xoá`);
  fs.rmSync(d, { recursive: true, force: true });
}

test("junction trỏ vào repo, thư mục worktree, gốc dự án ⇒ từ chối (so đường thật); gốc khai bằng junction cũng bắt", () => {
  const d = moi();
  try {
    fs.mkdirSync(path.join(d, "du-an"));
    lien(path.join(d, "vao-repo"), GOC);
    lien(path.join(d, "vao-cha"), path.dirname(GOC));
    lien(path.join(d, "vao-du-an"), path.join(d, "du-an"));
    assert.match(lyDoTuChoi(path.join(d, "vao-repo", "khoa.txt")), /trong repo/);
    assert.match(lyDoTuChoi(path.join(d, "vao-repo", "chua-co", "sau", "k")), /trong repo/);
    assert.match(lyDoTuChoi(path.join(d, "vao-cha", "_tho_ca_wt", "k")), /worktree/);
    assert.match(lyDoTuChoi(path.join(d, "vao-du-an", "k"), GOC, [path.join(d, "du-an")]), /gốc dự án/);
    assert.match(lyDoTuChoi(path.join(d, "du-an", "k"), GOC, [path.join(d, "vao-du-an")]), /gốc dự án/, "gốc khai qua junction, tệp gõ đường thật");
    assert.equal(lyDoTuChoi(path.join(d, "ngoai", "k"), GOC, [path.join(d, "vao-du-an")]), null);
  } finally {
    donAnToan(d);
  }
});

test("liên kết treo (đích đã mất) tính là đã có: không ghi theo nó", () => {
  const d = moi();
  const treo = path.join(d, "treo");
  try {
    fs.mkdirSync(path.join(d, "dich"));
    lien(treo, path.join(d, "dich"));
    fs.rmdirSync(path.join(d, "dich"));
    assert.match(lyDoTuChoi(treo), /đã có/);
  } finally {
    donAnToan(d);
  }
});

test("taoTepKhoa: đặt quyền lúc tệp còn RỖNG, rồi mới ghi khoá; đặt quyền hỏng ⇒ xoá tệp, ném", () => {
  const d = moi();
  try {
    const p = path.join(d, "k", "llama.key");
    const luc = [];
    const khoa = taoTepKhoa(p, (q) => luc.push(fs.readFileSync(q, "utf8")));
    assert.deepEqual(luc, [""], "lúc đặt quyền tệp phải rỗng");
    assert.equal(fs.readFileSync(p, "utf8"), `${khoa}\n`);
    const p2 = path.join(d, "k", "hong.key");
    assert.throws(() => taoTepKhoa(p2, () => { throw new Error("icacls hỏng"); }), /icacls hỏng/);
    assert.equal(fs.existsSync(p2), false);
    assert.throws(() => taoTepKhoa(p, () => {}), /EEXIST/, "không ghi đè");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("khoá 32 byte base64url, mỗi lần khác", () => {
  assert.match(taoKhoa(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(taoKhoa(), taoKhoa());
});

test("chạy thật: ghi tệp, chỉ in 4 ký tự cuối, lần hai không ghi đè", () => {
  const d = moi();
  const p = path.join(d, "k", "llama.key");
  try {
    const r = spawnSync(process.execPath, [TEP, p], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const khoa = fs.readFileSync(p, "utf8").trim();
    assert.match(khoa, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!r.stdout.includes(khoa), "không được in cả khoá");
    assert.ok(r.stdout.includes(khoa.slice(-4)));
    if (process.platform === "win32") {
      // Quyền thật trên tệp: không mục kế thừa "(I)", chỉ tài khoản đang chạy.
      const acl = spawnSync("icacls", [p], { encoding: "utf8", windowsHide: true }).stdout;
      assert.doesNotMatch(acl, /\(I\)/, acl);
      assert.ok(acl.toLowerCase().includes(os.userInfo().username.toLowerCase()), acl);
      assert.equal(acl.split(/\r?\n/).filter((l) => /:\(/.test(l)).length, 1, acl);
    }
    const lai = spawnSync(process.execPath, [TEP, p], { encoding: "utf8" });
    assert.equal(lai.status, 1);
    assert.equal(fs.readFileSync(p, "utf8").trim(), khoa);
  } finally {
    spawnSync("icacls", [d, "/reset", "/T"], { windowsHide: true });
    fs.rmSync(d, { recursive: true, force: true });
  }
});
