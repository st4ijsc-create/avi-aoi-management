// Chạy: node --test scripts/ai-eval/tasks/run-eval.test.mjs. Dùng llama-server GIẢ trên 127.0.0.1, không GPU, không CSDL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { bangMarkdown, nhanTienTrinhNang, tenBaoCao, tinhBang, tongHopTai } from "./run-eval.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE = JSON.parse(fs.readFileSync(path.join(DIR, "../codegen-chay-duoc/fake-hard.json"), "utf8"));
const tam = fs.mkdtempSync(path.join(os.tmpdir(), "run-eval-test-"));
after(() => fs.rmSync(tam, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));

/** Giả llama-server: phát lần lượt các câu trả lời trong `kich`; `chetSau` lượt thì /health trả 503. */
function gia(kich, { chetSau = Infinity, slotBan = false } = {}) {
  let n = 0;
  const yeuCau = [];
  const sv = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.statusCode = n >= chetSau ? 503 : 200;
      return res.end("{}");
    }
    if (req.url === "/slots") return res.end(JSON.stringify([{ id: 0, is_processing: slotBan }]));
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      yeuCau.push(JSON.parse(b));
      const k = kich[Math.min(n++, kich.length - 1)];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: k.text }, finish_reason: k.finish ?? "stop" }], usage: { completion_tokens: k.tok ?? 100 } }));
    });
  });
  return new Promise((r) => sv.listen(0, "127.0.0.1", () => r({ sv, url: `http://127.0.0.1:${sv.address().port}`, yeuCau })));
}

function chay(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(DIR, "run-eval.mjs"), "--tho", path.join(tam, "tho"), ...(args.includes("--mau-tai-giay") ? [] : ["--mau-tai-giay", "0"]), ...args], { windowsHide: true });
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (ma) => resolve({ ma, out, err }));
  });
}

const khoi = (s) => `\`\`\`\n${s}\n\`\`\``;
const OK = { text: khoi(FAKE["fake-ok"]["H-ts1"]) };
const BAD = { text: khoi(FAKE["fake-bad"]["H-ts1"]) };

test("hai mẫu một đạt một trượt và cụt: đúng pass@1, pass@N, số cụt, ghi json + md đúng chỗ", async () => {
  const { sv, url, yeuCau } = await gia([OK, { ...BAD, finish: "length", tok: 16000 }]);
  const ra = path.join(tam, "ra1");
  const r = await chay(["--url", url, "--samples", "2", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--ngay", "2026-11-08"]);
  sv.close();
  assert.equal(r.ma, 0, r.err);
  const bc = JSON.parse(fs.readFileSync(path.join(ra, "2026-11-08.json"), "utf8"));
  assert.equal(bc.soMau, 2);
  assert.equal(bc.tong.luot, 2);
  assert.equal(bc.tong.dat, 1);
  assert.equal(bc.tong.passAt1, 0.5);
  assert.equal(bc.tong.passAtN, 1);
  assert.equal(bc.tong.cut, 1);
  assert.deepEqual(bc.stacks.map((s) => s.stack), ["ts"]);
  assert.deepEqual(bc.tong.moiMau, [1, 0]);
  assert.match(fs.readFileSync(path.join(ra, "2026-11-08.md"), "utf8"), /Cụt 1\/2: số dưới đây là chặn dưới/);
  assert.equal(yeuCau.length, 2);
  assert.equal(yeuCau[0].messages[0].role, "system");
  assert.equal(yeuCau[0].max_tokens, 16000);
  assert.equal(yeuCau[0].temperature, 0.2);
  assert.match(yeuCau[0].messages[1].content, /BoNhoLRU/);
  assert.ok(fs.existsSync(path.join(tam, "tho", "2026-11-08", "H-ts1-1.txt")), "câu trả lời thô ở ngoài thư mục báo cáo");
});

test("--ghi-chu và tải máy vào báo cáo: slot bận được đếm, mẫu tải đọc thật trên máy", async () => {
  const { sv, url } = await gia([OK], { slotBan: true });
  const ra = path.join(tam, "ra6");
  const r = await chay(["--mau-tai-giay", "600", "--url", url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--ngay", "2026-11-08", "--ghi-chu", "lan dau goi model that"]);
  sv.close();
  assert.equal(r.ma, 0, r.err);
  const bc = JSON.parse(fs.readFileSync(path.join(ra, "2026-11-08.json"), "utf8"));
  assert.equal(bc.ghiChu, "lan dau goi model that");
  assert.equal(bc.taiMay.soLuotSlotBan, 1);
  assert.equal(bc.taiMay.sach, false);
  assert.ok(bc.taiMay.soMauTai >= 1);
  assert.equal(typeof bc.taiMay.cpuTb, "number", "mẫu tải phải đọc được CPU thật");
  const md = fs.readFileSync(path.join(ra, "2026-11-08.md"), "utf8");
  assert.match(md, /Ghi chú: lan dau goi model that/);
  assert.match(md, /có tiến trình khác trong lúc đo/);
});

test("nhanTienTrinhNang: trừ chính lượt đo và con cháu, không ghi dòng lệnh", () => {
  const ds = [
    { pid: 10, cha: 1, lenh: "node run-eval.mjs" },
    { pid: 11, cha: 10, lenh: "node check.mjs" },
    { pid: 12, cha: 11, lenh: "dotnet run --project p.csproj" },
    { pid: 20, cha: 1, lenh: "node node_modules/vitest/vitest.mjs run --db=postgres://u:bimat@h/d" },
    { pid: 21, cha: 1, lenh: "node dot-bien.cjs" },
    { pid: 22, cha: 1, lenh: null },
    { pid: 23, cha: 1, lenh: "notepad.exe" },
  ];
  const r = nhanTienTrinhNang(ds, 10);
  assert.deepEqual(r, ["dot-bien", "vitest"]);
  assert.ok(!JSON.stringify(r).includes("bimat"));
  assert.deepEqual(nhanTienTrinhNang([{ pid: 12, cha: 11, lenh: "dotnet build" }], 10), ["dotnet"], "dotnet của người khác vẫn tính");
});

test("nhanTienTrinhNang: tiến trình thường trực của VS Code và MCP không làm bẩn số đo; tsc và playwright test thật thì có", () => {
  const nhan = (lenh) => nhanTienTrinhNang([{ pid: 2, cha: 1, lenh }], 9);
  assert.deepEqual(nhan("Code.exe --max-old-space-size=3072 d:/x/node_modules/typescript/lib/tsserver.js"), []);
  assert.deepEqual(nhan('"node" C:/npm-cache/_npx/1/node_modules/.bin/../@playwright/mcp/cli.js'), []);
  assert.deepEqual(nhan('cmd /c npx "@playwright/mcp@latest"'), []);
  assert.deepEqual(nhan("node node_modules/@playwright/test/cli.js test-server -c playwright.config.ts"), []);
  assert.deepEqual(nhan("node node_modules/typescript/lib/tsc.js -p tsconfig.tests.json"), ["tsc"]);
  assert.deepEqual(nhan("npx tsc --noEmit"), ["tsc"]);
  assert.deepEqual(nhan("node node_modules/@playwright/test/cli.js test e2e/a.spec.ts"), ["playwright"]);
});

test("tongHopTai: gộp mẫu; sạch chỉ khi không tiến trình nặng và slot không bận", () => {
  const t = tongHopTai([{ cpu: 10, nhan: [] }, { cpu: 30, nhan: ["vitest"] }, { cpu: null, nhan: ["vitest", "tsc"] }], 0);
  assert.deepEqual(t, { soMauTai: 3, cpuTb: 20, cpuMax: 30, tienTrinhNang: { vitest: 2, tsc: 1 }, soLuotSlotBan: 0, sach: false });
  assert.equal(tongHopTai([{ cpu: 5, nhan: [] }], 0).sach, true);
  assert.equal(tongHopTai([{ cpu: 5, nhan: [] }], 1).sach, false);
});

test("llama-server chết giữa lượt: thoát 2 và KHÔNG ghi báo cáo", async () => {
  const { sv, url } = await gia([OK], { chetSau: 1 });
  const ra = path.join(tam, "ra2");
  const r = await chay(["--url", url, "--samples", "2", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra]);
  sv.close();
  assert.equal(r.ma, 2);
  assert.match(r.err, /llama-server chết/);
  assert.ok(!fs.existsSync(ra) || fs.readdirSync(ra).length === 0);
});

test("/health chết từ đầu: thoát 2, không gọi model", async () => {
  const { sv, url, yeuCau } = await gia([OK], { chetSau: 0 });
  const r = await chay(["--url", url, "--bo", "tasks-hard", "--only", "H-ts1", "--ra", path.join(tam, "ra3")]);
  sv.close();
  assert.equal(r.ma, 2);
  assert.equal(yeuCau.length, 0);
});

test("trần thời gian 0: thoát 3, báo cáo nêu dừng sớm", async () => {
  const { sv, url } = await gia([OK]);
  const ra = path.join(tam, "ra4");
  const r = await chay(["--url", url, "--tran-phut", "-1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--ngay", "2026-11-08"]);
  sv.close();
  assert.equal(r.ma, 3, r.err);
  assert.match(JSON.parse(fs.readFileSync(path.join(ra, "2026-11-08.json"), "utf8")).dungSom, /chạm trần/);
});

test("--bo và --only không khớp bài nào: thoát 2", async () => {
  const r = await chay(["--bo", "khong-co", "--ra", path.join(tam, "ra5")]);
  assert.equal(r.ma, 2);
});

test("tinhBang: gom theo stack, pass@N tính theo bài, moiMau theo mẫu", () => {
  const h = (stack, id, mau, dat) => ({ stack, id, mau, dat, cut: false, tokRa: 10, ms: 1000 });
  const b = tinhBang([h("ts", "a", 1, true), h("ts", "a", 2, false), h("ts", "b", 1, false), h("ts", "b", 2, false), h("py", "c", 1, true), h("py", "c", 2, true)], 2);
  const ts = b.stacks.find((s) => s.stack === "ts");
  assert.equal(ts.passAt1, 0.25);
  assert.equal(ts.passAtN, 0.5);
  assert.deepEqual(ts.moiMau, [1, 0]);
  assert.equal(b.tong.dat, 3);
  assert.equal(b.tong.bai, 3);
  assert.equal(b.tong.passAt1, 0.5);
  assert.deepEqual(b.stacks.map((s) => s.stack), ["py", "ts"]);
});

test("cùng tên id ở hai stack không bị gộp ở dòng tổng", () => {
  const h = (stack) => ({ stack, id: "x", mau: 1, dat: true, cut: false });
  assert.equal(tinhBang([h("ts"), h("py")], 1).tong.bai, 2);
});

test("tenBaoCao không đè lượt cùng ngày", () => {
  const d = path.join(tam, "ten");
  fs.mkdirSync(d);
  assert.equal(tenBaoCao(d, "2026-11-08", ""), "2026-11-08");
  fs.writeFileSync(path.join(d, "2026-11-08.json"), "{}");
  assert.equal(tenBaoCao(d, "2026-11-08", ""), "2026-11-08-2");
  assert.equal(tenBaoCao(d, "2026-11-08", "nen-moc"), "2026-11-08-nen-moc");
});

test("bangMarkdown ghi model, cờ, dừng sớm và bài chưa đo", () => {
  const s = { stack: "ts", bai: 1, luot: 1, dat: 1, passAt1: 1, passAtN: 1, moiMau: [1], cut: 0, tokRaTb: 5, msTb: 2000 };
  const md = bangMarkdown({ ngay: "2026-11-08", nhan: "x", commit: "abc", cayBan: true, soMau: 1, maxTokens: 16000, model: { tep: "m.gguf", sha: "ff", ctx: 65536, reasoningBudget: 12000 }, co: { AI_AGENT_NEN_MOC: "0.5" }, dungSom: "het gio", chuaDo: ["pilot"], stacks: [s], tong: s });
  for (const c of ["m.gguf", "`ff`", "`AI_AGENT_NEN_MOC=0.5`", "Dừng sớm: het gio", "- pilot", "100.0 %", "chưa commit"]) assert.ok(md.includes(c), c);
});
