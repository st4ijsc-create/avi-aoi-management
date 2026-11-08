// Chạy: node --test scripts/ai/tao-khoa-llama.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { lyDoTuChoi, taoKhoa } from "./tao-khoa-llama.mjs";

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
    const lai = spawnSync(process.execPath, [TEP, p], { encoding: "utf8" });
    assert.equal(lai.status, 1);
    assert.equal(fs.readFileSync(p, "utf8").trim(), khoa);
  } finally {
    spawnSync("icacls", [d, "/reset", "/T"], { windowsHide: true });
    fs.rmSync(d, { recursive: true, force: true });
  }
});
