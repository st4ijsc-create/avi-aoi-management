// Test ẩn bài ts-tach-module: tách thật (không tách giả), API giữ nguyên, test của bài làm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THU_MUC = path.join(DA, "src", "donHang");
const XUAT: Record<string, string[]> = {
  phanTich: ["LoiDinhDang", "phanTichDon", "phanTichDong"],
  gia: ["BANG_MA_GIAM", "tamTinh", "thanhTien", "tienGiam", "timMaGiam"],
  thue: ["THUE_SUAT", "thueDong", "tongThue"],
  dinhDang: ["dinhDangVnd", "inHoaDon", "tongKet"],
};
const nap = (rel: string) => import(pathToFileURL(path.join(DA, rel)).href);
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const DON = "SP01;thuong;2;150000\nsach-a;sach;3;80000\nTP9;thuc-pham;1;45000";

test("mỗi module mới xuất ĐÚNG tập tên quy định (giá trị lúc chạy)", async () => {
  for (const [ten, ds] of Object.entries(XUAT)) assert.deepEqual(Object.keys(await nap(`src/donHang/${ten}.ts`)).sort(), [...ds].sort(), ten);
});

test("index mới, tệp cũ và src/index.ts xuất CÙNG một hàm của module (không chép thân hàm)", async () => {
  const mods = Object.fromEntries(await Promise.all(Object.keys(XUAT).map(async (t) => [t, await nap(`src/donHang/${t}.ts`)])));
  for (const rel of ["src/donHang/index.ts", "src/donHang.ts", "src/index.ts"]) {
    const m = await nap(rel);
    for (const [t, ds] of Object.entries(XUAT)) for (const ten of ds) assert.equal(m[ten], mods[t][ten], `${rel}: ${ten}`);
  }
});

test("hành vi qua từng module", async () => {
  const { phanTichDon, LoiDinhDang } = await nap("src/donHang/phanTich.ts");
  const { tamTinh, tienGiam } = await nap("src/donHang/gia.ts");
  const { tongThue } = await nap("src/donHang/thue.ts");
  const { tongKet, inHoaDon } = await nap("src/donHang/dinhDang.ts");
  const ds = phanTichDon(DON);
  assert.equal(tamTinh(ds), 585000);
  assert.equal(tongThue(ds), 32250);
  assert.equal(tienGiam(585000, "SACH20"), 117000);
  assert.deepEqual(tongKet(ds, "giam50k"), { tamTinh: 585000, giam: 50000, thue: 32250, phaiTra: 567250 });
  assert.match(inHoaDon(ds), /^SP01 x2: 300\.000 ₫\nSACH-A x3: 240\.000 ₫\nTP9 x1: 45\.000 ₫\nTạm tính: 585\.000 ₫\nThuế VAT: 32\.250 ₫\nPhải trả: 617\.250 ₫$/);
  assert.throws(() => phanTichDon("A;thuong;0;1"), (e: unknown) => e instanceof LoiDinhDang && e.soDong === 1);
});

test("tệp cũ src/donHang.ts chỉ còn câu re-export từ src/donHang/", () => {
  const cau = boChuThich(fs.readFileSync(path.join(DA, "src", "donHang.ts"), "utf8")).split(";").map((s) => s.trim()).filter(Boolean);
  assert.ok(cau.length >= 1);
  for (const c of cau) assert.match(c, /^export (\*|type \{[^}]*\}|\{[^}]*\}) from "\.\/donHang\/[A-Za-z]+\.ts"$/, c);
});

test("module mới không import ngược tệp cũ hay src/index.ts, và không có vòng import", () => {
  const tep = fs.readdirSync(THU_MUC).filter((f) => f.endsWith(".ts"));
  const canh = new Map<string, string[]>();
  for (const f of tep) {
    const s = boChuThich(fs.readFileSync(path.join(THU_MUC, f), "utf8"));
    const dich = [...s.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((x) => x.startsWith("."));
    const tuyetDoi = dich.map((x) => path.resolve(THU_MUC, x));
    for (const t of tuyetDoi) {
      assert.notEqual(t, path.join(DA, "src", "donHang.ts"), `${f} import ngược tệp cũ`);
      assert.notEqual(t, path.join(DA, "src", "index.ts"), `${f} import src/index.ts`);
    }
    canh.set(path.join(THU_MUC, f), tuyetDoi.filter((t) => path.dirname(t) === THU_MUC));
  }
  const mau = new Map<string, number>();
  const tham = (u: string, vet: string[]): void => {
    mau.set(u, 1);
    for (const v of canh.get(u) ?? []) {
      if (mau.get(v) === 1) assert.fail(`vòng import: ${[...vet, u, v].map((x) => path.basename(x)).join(" -> ")}`);
      if (!mau.get(v)) tham(v, [...vet, u]);
    }
    mau.set(u, 2);
  };
  for (const u of canh.keys()) if (!mau.get(u)) tham(u, []);
});

test("test của bài làm: mỗi module một tệp, ≥ 2 ca, import thẳng module, và xanh", () => {
  const ds: string[] = [];
  for (const ten of Object.keys(XUAT)) {
    const rel = `test/donHang/${ten}.test.ts`;
    const p = path.join(DA, rel);
    assert.ok(fs.existsSync(p), `thiếu ${rel}`);
    const s = fs.readFileSync(p, "utf8");
    assert.ok((s.match(/\btest\s*\(/g) ?? []).length >= 2, `${rel}: cần ≥ 2 ca`);
    assert.ok(s.includes(`src/donHang/${ten}.ts`), `${rel}: phải import thẳng src/donHang/${ten}.ts`);
    ds.push(rel);
  }
  const r = spawnSync(process.execPath, ["--test", ...ds], { cwd: DA, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  assert.equal(r.status, 0, (r.stdout ?? "").slice(-1500));
});
