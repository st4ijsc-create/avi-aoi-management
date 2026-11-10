// Chạy: node --test scripts/ai-eval/tasks/lib/pilotRepo.test.mjs (không CSDL, không GPU)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { danhSachBai } from "./chung.mjs";
import { apDotBien, docTongKet, tepNgoaiThe } from "./pilotRepo.mjs";

test("prompt.md của bài pilot không có khoá ĐỘT BIẾN của thẻ (bộ chạy đọc khoá đó, model không được thấy)", () => {
  const bai = danhSachBai().filter((b) => b.kieu === "pilot-repo");
  assert.ok(bai.length >= 4);
  for (const b of bai) {
    const de = fs.readFileSync(`${b.dir}/prompt.md`, "utf8");
    assert.doesNotMatch(de, /^\s*(ĐỘT BIẾN|DOT BIEN)\s*:/imu, b.id);
    assert.ok(!de.includes(b.mauBlob), b.id);
  }
});

test("docTongKet đọc đúng dòng Tests, bỏ mã màu, không lấy dòng Test Files", () => {
  assert.deepEqual(docTongKet(" Test Files  1 passed (1)\n      Tests  34 passed (34)\n"), { pass: 34, fail: 0, dong: "Tests  34 passed (34)" });
  const r = docTongKet("\x1b[2m      Tests \x1b[22m \x1b[31m2 failed\x1b[39m | \x1b[32m32 passed\x1b[39m (34)\n");
  assert.equal(r.fail, 2);
  assert.equal(r.pass, 32);
});

test("docTongKet: không có dòng Tests ⇒ null (lỗi nạp, không phải kết quả)", () => {
  assert.equal(docTongKet(" Test Files  1 failed (1)\n Error: Transform failed\n"), null);
  assert.equal(docTongKet("No test files found, exiting with code 1\n"), null);
});

test("apDotBien thay đúng một chỗ, giữ nguyên ký tự $ trong chuỗi thay", () => {
  assert.equal(apDotBien("a X b", { ma: "m", tep: "t", tim: "X", thay: "$&${y}" }), "a $&${y} b");
});

test("apDotBien: tìm thấy 0 hoặc nhiều chỗ ⇒ ném (thước hỏng, không âm thầm bỏ qua)", () => {
  assert.throws(() => apDotBien("abc", { ma: "m", tep: "t", tim: "X", thay: "Y" }), /khớp 0 chỗ/);
  assert.throws(() => apDotBien("X X", { ma: "m", tep: "t", tim: "X", thay: "Y" }), /khớp 2 chỗ/);
});

test("apDotBien json: xoá khoá, đặt khoá, khoá vắng ⇒ ném", () => {
  const goc = JSON.stringify({ a: { b: "1", c: "2" } });
  assert.deepEqual(JSON.parse(apDotBien(goc, { ma: "m", tep: "t", json: { duong: "a.b" } })), { a: { c: "2" } });
  assert.deepEqual(JSON.parse(apDotBien(goc, { ma: "m", tep: "t", json: { duong: "a.b", dat: "" } })), { a: { b: "", c: "2" } });
  assert.throws(() => apDotBien(goc, { ma: "m", tep: "t", json: { duong: "a.z" } }), /không có khoá/);
});

// ── cham() chế độ --thu-muc: đường của bộ chạy pilot. Chạy đúng như check.mjs thật (tiến trình con, chayCheck), trên repo git tạm
// có vitest GIẢ (đọc tệp test, in dòng "Tests" kiểu vitest). Không node_modules thật, không CSDL.
const VITEST_GIA = `import path from "node:path";
import { pathToFileURL } from "node:url";
const ds = [];
globalThis.it = (ten, fn) => ds.push({ ten, fn });
globalThis.it.skip = (ten) => ds.push({ ten, bo: true });
try {
  await import(pathToFileURL(path.resolve(process.argv[3])).href);
} catch (e) {
  console.error("Error: Transform failed " + e.message);
  process.exit(1);
}
let qua = 0, truot = 0, bo = 0;
for (const t of ds) {
  if (t.bo) { bo++; continue; }
  try { await t.fn(); qua++; } catch { truot++; }
}
const phan = [truot && truot + " failed", qua && qua + " passed", bo && bo + " skipped"].filter(Boolean).join(" | ");
console.log("      Tests  " + (phan || "0 passed") + " (" + ds.length + ")");
process.exit(truot ? 1 : 0);
`;
const NGUON = "export function cong(a, b) {\n  return a + b;\n}\nexport function nhan(a, b) {\n  return a * b;\n}\nexport function am(a) {\n  return a < 0;\n}\n";
const kiem = (dk) => `import { cong, nhan, am } from "./nguon.mjs";\nconst bang = (a, b) => { if (a !== b) throw new Error(a + " != " + b); };\n${dk}\n`;
const TEST_DU = kiem('it("cong", () => bang(cong(2, 3), 5));\nit("nhan", () => bang(nhan(2, 3), 6));\nit("am", () => bang(am(0), false));');
const TEST_THIEU_AM = kiem('it("cong", () => bang(cong(2, 3), 5));\nit("nhan", () => bang(nhan(2, 3), 6));');
const TEST_BO_QUA = kiem('it.skip("cong", () => bang(cong(2, 3), 5));');
const M1 = { ma: "M1 cong tru", tep: "nguon.mjs", tim: "return a + b;", thay: "return a - b;" };
const M2 = { ma: "M2 nhan cong", tep: "nguon.mjs", tim: "return a * b;", thay: "return a + b;" };
const M3 = { ma: "M3 am <=", tep: "nguon.mjs", tim: "return a < 0;", thay: "return a <= 0;" };
const M_HONG = { ma: "MH cu phap hong", tep: "nguon.mjs", tim: "export function am(a) {", thay: "export function am(a) {{" };
const CHAY_MJS = path.join(path.dirname(fileURLToPath(import.meta.url)), "chay.mjs");

/** Dựng repo git tạm (nguon.mjs đã commit, vitest giả bị .gitignore) + thư mục bài có check.mjs gọi chayCheck thật. */
function dungCay() {
  const goc = fs.mkdtempSync(path.join(os.tmpdir(), "ai-eval-pilot-cham-")).split(path.sep).join("/");
  const cay = `${goc}/cay`;
  const bai = `${goc}/bai`;
  fs.mkdirSync(`${cay}/node_modules/vitest`, { recursive: true });
  fs.mkdirSync(bai);
  const git = (...a) => {
    const r = spawnSync("git", ["-C", cay, ...a], { encoding: "utf8" });
    assert.equal(r.status, 0, `${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  fs.writeFileSync(`${cay}/.gitignore`, "node_modules/\n");
  fs.writeFileSync(`${cay}/nguon.mjs`, NGUON);
  fs.writeFileSync(`${cay}/node_modules/vitest/vitest.mjs`, VITEST_GIA);
  git("add", "-A");
  git("commit", "-q", "-m", "x");
  const blob = git("rev-parse", "HEAD:nguon.mjs");
  fs.writeFileSync(`${bai}/prompt.md`, "Viết test cho nguon.mjs.\n");
  /** Chấm cây với test `noiDungTest` (null = không tệp test), đột biến + ngưỡng, `nguonGhim` mặc định đúng blob. */
  const cham = ({ noiDungTest, dotBien, nguongDotBien, nguonGhim = { "nguon.mjs": blob } }) => {
    fs.rmSync(`${cay}/nguon.test.mjs`, { force: true });
    if (noiDungTest !== null) fs.writeFileSync(`${cay}/nguon.test.mjs`, noiDungTest);
    fs.writeFileSync(`${bai}/bai.json`, JSON.stringify({ id: "TC-GIA", kieu: "pilot-repo", tepDuocSua: ["nguon.test.mjs"], nguonGhim }));
    fs.writeFileSync(`${bai}/check.mjs`, `import { chayCheck } from ${JSON.stringify(pathToFileURL(CHAY_MJS).href)};\nprocess.exit(await chayCheck(import.meta.url, ${JSON.stringify({ dotBien, ...(nguongDotBien === undefined ? {} : { nguongDotBien }) })}));\n`);
    const r = spawnSync(process.execPath, [`${bai}/check.mjs`, "--thu-muc", cay], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
    const dong = r.stdout.trim().split(/\r?\n/).pop();
    assert.equal(fs.readFileSync(`${cay}/nguon.mjs`, "utf8"), NGUON, "đột biến phải được khôi phục");
    return { ma: r.status, kq: JSON.parse(dong), err: r.stderr };
  };
  return { cay, cham, don: () => fs.rmSync(goc, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) };
}

test("cham --thu-muc: test bắt đủ đột biến ⇒ ĐẠT thoát 0; đột biến khôi phục sau mỗi lần", () => {
  const c = dungCay();
  try {
    const { ma, kq, err } = c.cham({ noiDungTest: TEST_DU, dotBien: [M1, M2, M3], nguongDotBien: 3 });
    assert.equal(ma, 0, `${JSON.stringify(kq)} ${err}`);
    assert.equal(kq.dat, true);
    assert.deepEqual(kq.lyDo, []);
    assert.deepEqual(kq.dotBien, { bat: 3, tong: 3, nguong: 3, song: [] });
    assert.match(kq.tests, /Tests\s+3 passed/);
  } finally {
    c.don();
  }
});

test("cham --thu-muc: cây không đúng blob lúc giao ⇒ THUOC_HONG thoát 2, không chấm", () => {
  const c = dungCay();
  try {
    const { ma, kq } = c.cham({ noiDungTest: TEST_DU, dotBien: [M1, M2, M3], nguonGhim: { "nguon.mjs": "0".repeat(40) } });
    assert.equal(ma, 2);
    assert.deepEqual(kq.lyDo, ["THUOC_HONG"]);
    assert.match(kq.loi, /cây sai: nguon\.mjs/);
  } finally {
    c.don();
  }
});

test("cham --thu-muc: tệp sửa/tạo ngoài thẻ ⇒ VI_PHAM_NGOAI_THE, nêu tên tệp, TRƯỢT dù test bắt đủ", () => {
  const c = dungCay();
  try {
    fs.writeFileSync(`${c.cay}/lai.mjs`, "export const x = 1;\n");
    const { ma, kq } = c.cham({ noiDungTest: TEST_DU, dotBien: [M1, M2, M3], nguongDotBien: 3 });
    assert.equal(ma, 1);
    assert.equal(kq.dat, false);
    assert.deepEqual(kq.lyDo, ["VI_PHAM_NGOAI_THE"]);
    assert.deepEqual(kq.ngoaiThe, ["lai.mjs"]);
  } finally {
    c.don();
  }
});

test("cham --thu-muc: ngưỡng đột biến giữ nguyên — bắt 2/3 dưới ngưỡng 3 (và ngưỡng mặc định) ⇒ DOT_BIEN_SONG; ngưỡng 2 ⇒ ĐẠT", () => {
  const c = dungCay();
  try {
    for (const nguongDotBien of [3, undefined]) {
      const { ma, kq } = c.cham({ noiDungTest: TEST_THIEU_AM, dotBien: [M1, M2, M3], nguongDotBien });
      assert.equal(ma, 1, String(nguongDotBien));
      assert.deepEqual(kq.lyDo, ["DOT_BIEN_SONG"]);
      assert.deepEqual(kq.dotBien, { bat: 2, tong: 3, nguong: 3, song: ["M3 am <="] });
    }
    const { ma, kq } = c.cham({ noiDungTest: TEST_THIEU_AM, dotBien: [M1, M2, M3], nguongDotBien: 2 });
    assert.equal(ma, 0);
    assert.deepEqual(kq.dotBien, { bat: 2, tong: 3, nguong: 2, song: ["M3 am <="] });
  } finally {
    c.don();
  }
});

test("cham --thu-muc: test toàn bỏ qua (0 passed, thoát 0) ⇒ TEST_RONG, kể cả khi không khai đột biến", () => {
  const c = dungCay();
  try {
    for (const [dotBien, nguongDotBien] of [[[M1], 1], [[], 0]]) {
      const { ma, kq } = c.cham({ noiDungTest: TEST_BO_QUA, dotBien, nguongDotBien });
      assert.equal(ma, 1);
      assert.deepEqual(kq.lyDo, ["TEST_RONG"]);
    }
    const { kq } = c.cham({ noiDungTest: null, dotBien: [M1], nguongDotBien: 1 });
    assert.equal(kq.dat, false, "không có tệp test thì không ĐẠT");
  } finally {
    c.don();
  }
});

test("cham --thu-muc: đột biến làm hỏng cú pháp KHÔNG được tính là bắt ⇒ THUOC_HONG thoát 2, nguồn khôi phục", () => {
  const c = dungCay();
  try {
    const { ma, kq } = c.cham({ noiDungTest: TEST_DU, dotBien: [M1, M_HONG], nguongDotBien: 2 });
    assert.equal(ma, 2);
    assert.deepEqual(kq.lyDo, ["THUOC_HONG"]);
    assert.match(kq.loi, /MH cu phap hong làm test không chạy được/);
  } finally {
    c.don();
  }
});

test("tepNgoaiThe: tệp sửa hoặc tạo ngoài thẻ bị nêu tên, tệp được phép thì không", () => {
  const cay = fs.mkdtempSync(path.join(os.tmpdir(), "ai-eval-tasks-git-")).split(path.sep).join("/");
  try {
    const git = (...a) => assert.equal(spawnSync("git", ["-C", cay, ...a]).status, 0, a.join(" "));
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    fs.writeFileSync(`${cay}/nguon.ts`, "1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "x");
    assert.deepEqual(tepNgoaiThe(cay, ["a.test.ts"]), []);
    fs.mkdirSync(`${cay}/thu`);
    fs.writeFileSync(`${cay}/thu/a.test.ts`, "x");
    assert.deepEqual(tepNgoaiThe(cay, ["thu/a.test.ts"]), [], "tệp mới trong thư mục con phải hiện đúng đường");
    fs.writeFileSync(`${cay}/nguon.ts`, "2\n");
    fs.writeFileSync(`${cay}/lai.ts`, "x");
    assert.deepEqual(tepNgoaiThe(cay, ["thu/a.test.ts"]).sort(), ["lai.ts", "nguon.ts"]);
  } finally {
    fs.rmSync(cay, { recursive: true, force: true });
  }
});
