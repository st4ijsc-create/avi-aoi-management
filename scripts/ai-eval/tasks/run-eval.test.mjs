// Chạy: node --test scripts/ai-eval/tasks/run-eval.test.mjs. Dùng llama-server GIẢ trên 127.0.0.1, không GPU, không CSDL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { bangMarkdown, bangTuKiem, CHE_DO_TU_KIEM, coBaoCao, docTai, hangAgentF, locCo, loiThamSo, LUAT_GIA_TRI, nhanTienTrinhNang, tachTenCongCu, tachTuKiemMa, tenBaoCao, tenCongCuBiet, tieuDeKhoa, tinhBang, tongHopTai, tuKiemMaChoLuot } from "./run-eval.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE = JSON.parse(fs.readFileSync(path.join(DIR, "../codegen-chay-duoc/fake-hard.json"), "utf8"));
const tam = fs.mkdtempSync(path.join(os.tmpdir(), "run-eval-test-"));
after(() => fs.rmSync(tam, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));

/** Giả llama-server: phát lần lượt các câu trả lời trong `kich`; `chetSau` lượt thì /health trả 503. */
function gia(kich, { chetSau = Infinity, slotBan = false } = {}) {
  let n = 0;
  const yeuCau = [];
  const tieuDe = [];
  const sv = http.createServer((req, res) => {
    tieuDe.push({ url: req.url, authorization: req.headers.authorization ?? null });
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
  return new Promise((r) => sv.listen(0, "127.0.0.1", () => r({ sv, url: `http://127.0.0.1:${sv.address().port}`, yeuCau, tieuDe })));
}

/** `env` thay hẳn env tiến trình con (khi có): test cờ/khoá không phụ thuộc env của máy chạy test. */
function chay(args, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(DIR, "run-eval.mjs"), "--tho", path.join(tam, "tho"), ...(args.includes("--mau-tai-giay") ? [] : ["--mau-tai-giay", "0"]), ...args], { windowsHide: true, ...(env ? { env } : {}) });
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

// (11/11, dieu-phoi: đỏ 1/4 khi máy bận vì đọc CPU thật ra null) tải máy tiêm GIẢ qua RUN_EVAL_TAI_GIA ⇒ tất định; đọc thật có ca riêng.
test("--ghi-chu và tải máy vào báo cáo: slot bận được đếm, mẫu tải (tiêm giả) vào báo cáo và ghi rõ là giả", async () => {
  const { sv, url } = await gia([OK], { slotBan: true });
  const ra = path.join(tam, "ra6");
  const r = await chay(["--mau-tai-giay", "600", "--url", url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--ngay", "2026-11-08", "--ghi-chu", "lan dau goi model that"], { ...process.env, RUN_EVAL_TAI_GIA: JSON.stringify({ cpu: 37, ds: [] }) });
  sv.close();
  assert.equal(r.ma, 0, r.err);
  const bc = JSON.parse(fs.readFileSync(path.join(ra, "2026-11-08.json"), "utf8"));
  assert.equal(bc.ghiChu, "lan dau goi model that");
  assert.equal(bc.taiMay.soLuotSlotBan, 1);
  assert.equal(bc.taiMay.sach, false);
  assert.ok(bc.taiMay.soMauTai >= 1);
  assert.equal(bc.taiMay.cpuTb, 37);
  assert.equal(bc.taiMay.nguon, "gia");
  const md = fs.readFileSync(path.join(ra, "2026-11-08.md"), "utf8");
  assert.match(md, /Tải máy GIẢ \(RUN_EVAL_TAI_GIA/);
  assert.match(md, /Ghi chú: lan dau goi model that/);
  assert.match(md, /có tiến trình khác trong lúc đo/);
});

test("nhanTienTrinhNang: không tính con cháu, tổ tiên của lượt đo và tiến trình nhàn rỗi; không ghi dòng lệnh", () => {
  const ds = [
    { pid: 1, cha: 0, lenh: "bash -c 'grep vitest; tsc --noEmit'", cpuMs: 60_000 }, // shell bọc lượt đo: đúng lỗi của C3 đêm 08/11
    { pid: 10, cha: 1, lenh: "node run-eval.mjs", cpuMs: 60_000 },
    { pid: 11, cha: 10, lenh: "node check.mjs", cpuMs: 60_000 },
    { pid: 12, cha: 11, lenh: "dotnet run --project p.csproj", cpuMs: 60_000 },
    { pid: 20, cha: 5, lenh: "node node_modules/vitest/vitest.mjs run --db=postgres://u:bimat@h/d", cpuMs: 30_000 },
    { pid: 21, cha: 5, lenh: "node dot-bien.cjs", cpuMs: 3_000 },
    { pid: 22, cha: 5, lenh: null, cpuMs: 60_000 },
    { pid: 23, cha: 5, lenh: "notepad.exe", cpuMs: 60_000 },
    { pid: 24, cha: 5, lenh: "dotnet.exe C:/Users/x/.vscode/extensions/ms-dotnettools.csdevkit/CPS.dll", cpuMs: 500 }, // nhàn rỗi
    { pid: 25, cha: 5, lenh: "dotnet build", cpuMs: 100_500 }, // đã chạy từ trước, khoảng này không làm gì
  ];
  const r = nhanTienTrinhNang(ds, 10, new Map([[25, 100_000]]), 60);
  assert.deepEqual(r, ["dot-bien", "vitest"]);
  assert.ok(!JSON.stringify(r).includes("bimat"));
});

test("nhanTienTrinhNang: mẫu đầu chưa có mẫu trước thì không gắn nhãn", () => {
  assert.deepEqual(nhanTienTrinhNang([{ pid: 2, cha: 1, lenh: "vitest run", cpuMs: 9e6 }], 9, null, 60), []);
});

test("nhanTienTrinhNang: dịch vụ thường trực không vào nhãn; tsc và playwright test thật thì có", () => {
  const nhan = (lenh) => nhanTienTrinhNang([{ pid: 2, cha: 1, lenh, cpuMs: 60_000 }], 9, new Map(), 60);
  assert.deepEqual(nhan("Code.exe --max-old-space-size=3072 d:/x/node_modules/typescript/lib/tsserver.js"), []);
  assert.deepEqual(nhan('"node" C:/npm-cache/_npx/1/node_modules/.bin/../@playwright/mcp/cli.js'), []);
  assert.deepEqual(nhan('cmd /c npx "@playwright/mcp@latest"'), []);
  assert.deepEqual(nhan("node node_modules/@playwright/test/cli.js test-server -c playwright.config.ts"), []);
  assert.deepEqual(nhan("node node_modules/typescript/lib/tsc.js -p tsconfig.tests.json"), ["tsc"]);
  assert.deepEqual(nhan("npx tsc --noEmit"), ["tsc"]);
  assert.deepEqual(nhan("node node_modules/@playwright/test/cli.js test e2e/a.spec.ts"), ["playwright"]);
});

test("docTai thật (không tiêm): trả cpu số hoặc null (máy bận), nhan là mảng, không ném; không có cờ giả", { timeout: 60_000 }, async () => {
  const m = await docTai({ truoc: null }, 60, {});
  assert.ok(m.cpu === null || typeof m.cpu === "number", String(m.cpu));
  assert.ok(Array.isArray(m.nhan));
  assert.equal(m.gia, undefined);
});

test("docTai tiêm giả: nhãn tiến trình tính như thật, JSON hỏng ⇒ cpu null; tongHopTai chỉ ghi nguon gia khi có mẫu giả", async () => {
  const tt = { truoc: new Map([[11, 0]]) };
  const m = await docTai(tt, 1, { RUN_EVAL_TAI_GIA: JSON.stringify({ cpu: 55, ds: [{ pid: 11, cha: 1, lenh: "node vitest run", cpuMs: 5000 }] }) });
  assert.deepEqual(m, { cpu: 55, nhan: ["vitest"], gia: true });
  assert.deepEqual(await docTai({ truoc: null }, 1, { RUN_EVAL_TAI_GIA: "{hong" }), { cpu: null, nhan: [], gia: true });
  assert.equal(tongHopTai([{ cpu: 1, nhan: [] }], 0).nguon, undefined);
  assert.equal(tongHopTai([{ cpu: 1, nhan: [] }, { cpu: 2, nhan: [], gia: true }], 0).nguon, "gia");
  // kiem-dinh P3: mẫu giả không tiến trình nặng, slot rảnh vẫn KHÔNG sạch; mẫu thật như vậy thì sạch.
  assert.equal(tongHopTai([{ cpu: 2, nhan: [], gia: true }], 0).sach, false);
  assert.equal(tongHopTai([{ cpu: 2, nhan: [] }], 0).sach, true);
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

test("--truc H: gọi đúng đường sản phẩm với cookie, đọc SSE, done.answerRevised thay văn bản, cut không đo", async () => {
  const yeuCau = [];
  const sv = http.createServer((req, res) => {
    if (req.url === "/health") return res.end("{}");
    if (req.url === "/slots") return res.end("[]");
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      yeuCau.push({ url: req.url, cookie: req.headers.cookie, than: JSON.parse(b) });
      res.write(`data: ${JSON.stringify({ type: "token", token: "rac" })}\n\n`);
      res.write(`data: {hong\n\n`);
      res.end(`data: ${JSON.stringify({ type: "done", answerRevised: true, answer: OK.text })}\n\n`);
    });
  });
  await new Promise((r) => sv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${sv.address().port}`;
  const ck = path.join(tam, "ck.txt");
  fs.writeFileSync(ck, "127.0.0.1\tFALSE\t/\tFALSE\t0\tapp_session_id\tabc\n");
  const ra = path.join(tam, "ra7");
  const r = await chay(["--truc", "H", "--base", url, "--cookie", ck, "--url", url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--ngay", "2026-11-08"]);
  sv.close();
  assert.equal(r.ma, 0, r.err);
  assert.equal(yeuCau[0].url, "/api/ai/local-kb/stream");
  assert.equal(yeuCau[0].cookie, "app_session_id=abc");
  assert.equal(yeuCau[0].than.context.codingMode, true);
  assert.match(yeuCau[0].than.question, /BoNhoLRU/);
  const bc = JSON.parse(fs.readFileSync(path.join(ra, "2026-11-08.json"), "utf8"));
  assert.equal(bc.truc, "H");
  assert.equal(bc.tong.dat, 1, "văn bản phải là bản done.answerRevised, không phải token rác");
  assert.equal(bc.tong.cut, null);
  assert.match(fs.readFileSync(path.join(ra, "2026-11-08.md"), "utf8"), /không đo/);
});

test("--truc H: máy chủ trả 401 là cấu hình sai: thoát 2, không ghi báo cáo", async () => {
  const sv = http.createServer((req, res) => {
    if (req.url === "/health") return res.end("{}");
    res.statusCode = 401;
    res.end("{}");
  });
  await new Promise((r) => sv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${sv.address().port}`;
  const ck = path.join(tam, "ck2.txt");
  fs.writeFileSync(ck, "");
  const ra = path.join(tam, "ra8");
  const r = await chay(["--truc", "H", "--base", url, "--cookie", ck, "--url", url, "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra]);
  sv.close();
  assert.equal(r.ma, 2);
  assert.ok(!fs.existsSync(ra) || fs.readdirSync(ra).length === 0);
});

test("--truc H: server từ chối dự án là cấu hình sai: thoát 2, không ghi báo cáo", async () => {
  const sv = http.createServer((req, res) => {
    if (req.url === "/health") return res.end("{}");
    if (req.url === "/slots") return res.end("[]");
    req.resume();
    req.on("end", () => {
      const msg = "Dự án đang chọn (`repo`) KHÔNG nằm trong danh sách cho phép.";
      res.write(`data: ${JSON.stringify({ type: "token", token: msg })}\n\n`);
      res.end(`data: ${JSON.stringify({ type: "done", provider: "tool", answer: msg })}\n\n`);
    });
  });
  await new Promise((r) => sv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${sv.address().port}`;
  const ck = path.join(tam, "ck3.txt");
  fs.writeFileSync(ck, "127.0.0.1\tFALSE\t/\tFALSE\t0\tapp_session_id\tabc\n");
  const ra = path.join(tam, "ra10");
  const r = await chay(["--truc", "H", "--base", url, "--cookie", ck, "--url", url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra]);
  sv.close();
  assert.equal(r.ma, 2, r.err);
  assert.match(r.err, /từ chối dự án/);
  assert.ok(!fs.existsSync(ra) || fs.readdirSync(ra).length === 0);
});

test("loiThamSo: --help, cờ lạ, thiếu giá trị, chữ thừa bị chặn; dòng lệnh đêm đo thì qua", () => {
  assert.match(loiThamSo(["--help"]), /cú pháp/);
  assert.match(loiThamSo(["-h"]), /cú pháp/);
  assert.match(loiThamSo(["--samples", "1", "--dry-run"]), /cờ lạ: --dry-run/);
  assert.match(loiThamSo(["--samples"]), /--samples thiếu giá trị/);
  assert.match(loiThamSo(["--nhan", "--sha"]), /--nhan thiếu giá trị/);
  assert.match(loiThamSo(["H-ts1"]), /chữ thừa/);
  assert.equal(loiThamSo([]), null);
  assert.equal(
    loiThamSo(["--truc", "H", "--base", "http://127.0.0.1:3013", "--cookie", "ck.txt", "--ra", "r", "--tho", "t", "--samples", "3", "--bo", "tasks-hard,tasks-api2", "--nhan", "x", "--tran-phut", "60", "--ghi-chu", "a b", "--sha", "--only", "H-cs2", "--project-id", "p", "--ngay", "2026-11-10", "--url", "u", "--max-tokens", "1", "--agent-config", "agent", "--noi", "tam", "--mau-tai-giay", "0"]),
    null,
  );
});

test("--help: thoát 2, in cú pháp, KHÔNG gọi model", async () => {
  const { sv, url, yeuCau } = await gia([OK]);
  const ra = path.join(tam, "ra11");
  const r = await chay(["--help", "--url", url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra]);
  sv.close();
  assert.equal(r.ma, 2);
  assert.match(r.err, /run-eval\.mjs \[--samples N\]/);
  assert.equal(yeuCau.length, 0);
  assert.ok(!fs.existsSync(ra));
});

test("--truc H thiếu --base hoặc --cookie: thoát 2", async () => {
  const r = await chay(["--truc", "H", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", path.join(tam, "ra9")]);
  assert.equal(r.ma, 2);
  assert.match(r.err, /cần --base/);
});

test("agent-f qua run-f --config mau --noi tam: mỗi bài một lần, gom đúng bảng", async () => {
  const ra = path.join(tam, "ra10");
  const r = await chay(["--samples", "1", "--bo", "agent-f", "--only", "js-cli-viec", "--agent-config", "mau", "--noi", "tam", "--ra", ra, "--ngay", "2026-11-08", "--nhan", "thu-rf"]);
  assert.equal(r.ma, 0, r.err);
  const bc = JSON.parse(fs.readFileSync(path.join(ra, "2026-11-08-thu-rf.json"), "utf8"));
  assert.equal(bc.tong.dat, 1);
  assert.equal(bc.tong.cut, null);
  assert.equal(bc.hang[0].stack, "js");
  // config mau: có bộ chấm (testDem) nhưng không có agent ⇒ không có buocDo
  assert.equal(bc.hang[0].buocDo, undefined);
  assert.ok(bc.hang[0].testDem.pass >= 12, JSON.stringify(bc.hang[0].testDem));
  assert.equal(bc.hang[0].testDem.fail, 0);
});

test("hangAgentF: chuyển buocDo + testDem; vắng nguồn hoặc số hỏng thì không bịa trường", () => {
  const buocDo = { soBuocDo: 3, luotMax: 3, soNen: 1, soCuuTran: 0, soDoiBam: 0, tokenUocDinh: 9000, vaoThatDinh: 8800, soCoCache: 3, cacheNTong: 5000, promptNTong: 4000 };
  const x = { id: "py-a", luot: 2, dat: false, cham: { lyDo: ["TEST_DO"], dem: { pass: 9, fail: 4 }, canToiThieu: 13 }, agent: { usage: { ra: 77 }, ms: 1234, lyDo: "het-luot", buocDo, ctxMax: 83 } };
  assert.deepEqual(hangAgentF(x, "py"), { id: "py-a", stack: "py", bo: "agent-f", mau: 2, dat: false, lyDo: ["TEST_DO"], cut: null, tokRa: 77, ms: 1234, lyDoDung: "het-luot", buocDo, ctxMax: 83, testDem: { pass: 9, fail: 4, can: 13 } });
  assert.equal("ctxMax" in hangAgentF({ id: "e", luot: 1, agent: { ctxMax: null } }, "py"), false);
  assert.equal("ctxMax" in hangAgentF({ id: "f", luot: 1, agent: { ctxMax: "83" } }, "py"), false);
  const tron = hangAgentF({ id: "py-b", luot: 1, dat: true }, "py");
  assert.equal("buocDo" in tron, false);
  assert.equal("testDem" in tron, false);
  assert.deepEqual(hangAgentF({ id: "c", luot: 1, cham: { dem: { pass: "9" } }, agent: { buocDo: null } }, "py").testDem, undefined);
  assert.deepEqual(hangAgentF({ id: "d", luot: 1, cham: { dem: { pass: 3 }, canToiThieu: "x" } }, "py").testDem, { pass: 3, fail: null, can: null });
});

test("tieuDeKhoa: tệp thắng khoá env; tệp hỏng không rơi về khoá env; không cấu hình thì không có tiêu đề", () => {
  const p = path.join(tam, "khoa.txt");
  fs.writeFileSync(p, "tu-tep\n");
  assert.deepEqual(tieuDeKhoa({}), {});
  assert.deepEqual(tieuDeKhoa({ LLAMA_SERVER_API_KEY: "k" }), { authorization: "Bearer k" });
  assert.deepEqual(tieuDeKhoa({ LLAMA_SERVER_API_KEY: "k", LLAMA_SERVER_API_KEY_FILE: p }), { authorization: "Bearer tu-tep" });
  assert.deepEqual(tieuDeKhoa({ LLAMA_SERVER_API_KEY: "k", LLAMA_SERVER_API_KEY_FILE: path.join(tam, "khong-co") }), {});
});

// Giá trị bí mật giả, mỗi cái có đuôi riêng để tìm trong mọi tệp ra. Tên chứa KEY/TOKEN/SECRET/PASSWORD, ngoài và trong tiền tố cờ.
const BI_MAT = {
  LLAMA_SERVER_API_KEY: "bm-llama-q7z",
  AI_NGOAI_API_KEY: "bm-ngoai-q7z",
  OPENAI_API_KEY: "bm-openai-q7z",
  GITHUB_TOKEN: "bm-gh-q7z",
  DB_PASSWORD: "bm-db-q7z",
  SESSION_SECRET: "bm-ss-q7z",
  DATABASE_URL: "postgres://u:bm-url-q7z@127.0.0.1:9/x",
  XAI_AGENT_KEY: "bm-x-q7z",
  ai_agent_thuong: "bm-thuong-q7z",
  AI_CODING_API_KEY: "bm-coding-key-q7z",
  AI_AGENT_SECRET: "bm-agent-secret-q7z",
  AI_AGENTIC_ACCESS_TOKEN: "bm-at-q7z",
  AI_AGENT_DB_PASSWORD: "bm-agent-pw-q7z",
};
const CO_THAT = { AI_AGENT_NEN_MOC: "0.5", AI_AGENT_UOC_LUONG_TOKEN: "1", AI_CODING_REPO_CONTEXT: "0" };
/** Env tiến trình con: env máy chạy test bỏ hết cờ/khoá liên quan, rồi thêm `them`. Giữ PATH, SystemRoot… để git/mạng chạy. */
const envSach = (them) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(AI_|LLAMA_SERVER_)/i.test(k))), ...them });

function docCay(d) {
  return fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => fs.readFileSync(path.join(e.parentPath ?? e.path, e.name), "utf8")).join("\n");
}

test("coBaoCao: chỉ cờ ba tiền tố; tên có dáng bí mật bị loại kể cả trong tiền tố; biến khác không bao giờ vào", () => {
  assert.deepEqual(coBaoCao({ ...BI_MAT, ...CO_THAT, AI_AGENT_MAX_TOKENS_MOT_LUOT: "4000" }), { ...CO_THAT, AI_AGENT_MAX_TOKENS_MOT_LUOT: "4000" });
  assert.deepEqual(coBaoCao(BI_MAT), {});
});

// 36 đuôi dáng bí mật × 3 tiền tố = 108 tên (kiem-dinh 10/11: bộ lọc tên cũ để lọt 66/99; P3 thêm LICENSE, SEED, SIGN).
const DUOI_BI_MAT = ["PASS", "PW", "JWT", "BOT_TOKEN", "DSN", "DATABASE_URL", "CONNECTION_STRING", "WEBHOOK_URL", "SALT", "HMAC", "CRED", "PRIVKEY", "OTP", "PASSPHRASE", "API_KEY", "SECRET", "PASSWORD", "ACCESS_TOKEN", "REFRESH_TOKEN", "AUTH_HEADER", "COOKIE", "SESSION_ID", "PRIVATE_KEY", "SIGNING_KEY", "CLIENT_SECRET", "SSH_KEY", "CERT_PEM", "TOTP_SEED", "USERNAME", "LOGIN", "GITHUB_TOKEN", "REDIS_URI", "SMTP_PASSWD", "LICENSE", "SEED", "SIGN"];
const TEN_99 = ["AI_AGENT_", "AI_AGENTIC_", "AI_CODING_"].flatMap((p) => DUOI_BI_MAT.map((d) => p + d));
// 48 cờ thật dưới ba tiền tố trong server/shared/scripts/client (10/11): không cờ nào được bị lọc theo tên.
const CO_THAT_48 = "AI_AGENTIC_ENABLED AI_AGENT_AN_CONG_CU AI_AGENT_CONG_KE_HOACH AI_AGENT_CON_BAO_CAO AI_AGENT_CUU_TRAN AI_AGENT_DAU_RA_DAI AI_AGENT_DOC_TRUOC_KHI_GHI AI_AGENT_GIAO_VIEC AI_AGENT_GIU_NGHI AI_AGENT_HOAN_TAC AI_AGENT_HOUSEKEEPING_ENABLED AI_AGENT_HOUSEKEEPING_INTERVAL_MS AI_AGENT_KIEM_DAC_TA AI_AGENT_MAX_TOKENS_MOT_LUOT AI_AGENT_NEN_MOC AI_AGENT_NEN_SO_THAT AI_AGENT_NGHI AI_AGENT_THEO_VAI_TRO AI_AGENT_TIEP_TUC AI_AGENT_TOM_TAT_80 AI_AGENT_TOOL_TIMEOUT AI_AGENT_TU_DONG AI_AGENT_TU_TRA_API AI_AGENT_UOC_LUONG_TOKEN AI_CODING_ABLATION_NGU_CANH AI_CODING_AUTOLOOP AI_CODING_AUTOLOOP_MAX AI_CODING_AUTOLOOP_VERIFY AI_CODING_BO_SUNG_USING AI_CODING_EDIT AI_CODING_EDIT_HUNKS AI_CODING_GEN AI_CODING_KHOI_SUA AI_CODING_LESSONS AI_CODING_MODEL_TASK AI_CODING_REPO_CONTEXT AI_CODING_REPO_CONTEXT_MIN_SCORE AI_CODING_REPO_CONTEXT_TIMEOUT_MS AI_CODING_TOOL_LLM AI_CODING_TOOL_LOOP AI_CODING_TOOL_LOOP_MAX_ROUNDS AI_CODING_TOOL_VETO AI_CODING_TU_TRI_GHI AI_CODING_TU_TRI_GHI_MAX AI_CODING_TU_TRI_GHI_REPO_CHINH AI_CODING_TU_TRI_LUOT AI_CODING_USING_MO_RONG".split(" ");

test("locCo lớp TÊN: 108 tên dáng bí mật bị loại kể cả khi giá trị trông như cờ; chỉ ghi tên vào boQua", () => {
  assert.equal(new Set(TEN_99).size, 108);
  for (const v of ["1", "hunter2", "true"]) {
    const r = locCo(Object.fromEntries(TEN_99.map((k) => [k, v])));
    assert.deepEqual(r.co, {}, `giá trị ${v}: ${Object.keys(r.co).join(", ")}`);
    assert.deepEqual(r.boQua, [...TEN_99].sort());
  }
});

test("locCo lớp GIÁ TRỊ: chỉ rỗng, số ngắn, từ trong tập cố định; tên vô hại mà giá trị khác (JWT ngắn, từ lạ, URL, DSN, base64, khoá hex, số dài…) bị loại", () => {
  const xau = ["eyJhbGci.eyJ9.c2ln", "hunter2", "abc", "qwen3.6-35b", "12345678901", "123456789.123456", "1e9","postgres://u:p@127.0.0.1:5434/db", "https://hooks.vidu.vn/abc", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln", "dGVzdA==", "0123456789abcdef0123456789abcdef", "sk1234567890ABCDEFGH", "mat khau", "x".repeat(33), "a=b", "C:\\khoa.txt"];
  const env = Object.fromEntries(xau.map((v, i) => [`AI_AGENT_VO_HAI_${i}`, v]));
  const r = locCo(env);
  assert.deepEqual(r.co, {});
  assert.equal(r.boQua.length, xau.length);
  for (const v of xau) assert.ok(!JSON.stringify(r).includes(v), v);
});

test("locCo: 48 cờ thật với giá trị dạng cờ đều vào báo cáo; biến ngoài tiền tố không vào cả co lẫn boQua", () => {
  const giaTri = ["1", "0", "0.5", "true", "false", "", "persona-khong-khoi", "code", "120000", "-1", "khoi-khong-persona", "chat", "TRUE", "3600000"];
  const env = { ...Object.fromEntries(CO_THAT_48.map((k, i) => [k, giaTri[i % giaTri.length]])), AI_AGENT_AN_CONG_CU: "find_symbol,search_code,search_docs" };
  const r = locCo({ ...env, ...BI_MAT, PATH: "/usr/bin" });
  assert.deepEqual(r.co, Object.fromEntries(Object.entries(env).sort()));
  assert.deepEqual(r.boQua, ["AI_AGENTIC_ACCESS_TOKEN", "AI_AGENT_DB_PASSWORD", "AI_AGENT_SECRET", "AI_CODING_API_KEY"]);
});

test("tenCongCuBiet đọc TEN_CONG_CU thật trong shared/agentCore/congCu.ts", () => {
  const ten = tenCongCuBiet();
  for (const t of ["read_file", "find_symbol", "search_code", "search_docs", "lookup_api", "read_output"]) assert.ok(ten.has(t), t);
  assert.ok(ten.size >= 19, String(ten.size));
  for (const t of ten) assert.match(t, /^[a-z_]+$/);
});

test("AI_AGENT_AN_CONG_CU: luật riêng — danh sách tool biết trước phân tách bằng phẩy thì vào; ngoài tập/sai dạng thì chỉ ghi tên", () => {
  for (const v of ["find_symbol,search_code,search_docs", "lookup_api", "find_symbol", ""]) assert.deepEqual(locCo({ AI_AGENT_AN_CONG_CU: v }), { co: { AI_AGENT_AN_CONG_CU: v }, boQua: [] }, v);
  for (const v of ["find_symbol,khong_co_tool", "find_symbol, search_code", "find_symbol,,search_code", "FIND_SYMBOL", "sk_live_abc", "0", "true", "find_symbol;rm"]) {
    const r = locCo({ AI_AGENT_AN_CONG_CU: v });
    assert.deepEqual(r, { co: {}, boQua: ["AI_AGENT_AN_CONG_CU"] }, v);
  }
  // Luật riêng không mở rộng sang cờ khác: danh sách tool dưới tên cờ thường vẫn bị loại.
  assert.deepEqual(locCo({ AI_AGENT_NEN_MOC: "find_symbol" }).co, {});
});

test("nguồn tên tool hỏng (đọc lỗi, không có mảng, không phải chuỗi) ⇒ tập rỗng ⇒ AI_AGENT_AN_CONG_CU bị loại, chỉ ghi tên", () => {
  for (const nd of [null, undefined, 42, "", "export const KHAC = [\"find_symbol\"] as const;", "export const TEN_CONG_CU = [\"find_symbol\""]) {
    const t = tachTenCongCu(nd);
    assert.equal(t.size, 0, String(nd));
    assert.equal(t.has("find_symbol"), false, String(nd));
  }
  assert.deepEqual([...tachTenCongCu('export const TEN_CONG_CU = [\n  "find_symbol",\n  // ghi chú\n  "lookup_api",\n] as const;')], ["find_symbol", "lookup_api"]);
  const hong = path.join(tam, "khong-co", "congCu.ts");
  assert.equal(tenCongCuBiet(hong).size, 0);
  assert.equal(tenCongCuBiet(hong).has("find_symbol"), false);
  const sai = path.join(tam, "congCu-sai.ts");
  fs.writeFileSync(sai, "export const KHONG_PHAI = [\"find_symbol\"];\n");
  for (const tepCongCu of [hong, sai]) {
    for (const v of ["find_symbol,search_code,search_docs", "lookup_api"]) assert.deepEqual(locCo({ AI_AGENT_AN_CONG_CU: v }, { tepCongCu }), { co: {}, boQua: ["AI_AGENT_AN_CONG_CU"] }, `${tepCongCu} ${v}`);
    assert.deepEqual(locCo({ AI_AGENT_AN_CONG_CU: "" }, { tepCongCu }).co, { AI_AGENT_AN_CONG_CU: "" }, "rỗng = không ẩn gì, vẫn ghi được");
  }
});

test("cờ có luật GIÁ TRỊ riêng vẫn qua lớp TÊN: tên dáng bí mật bị loại dù luật riêng nhận giá trị", () => {
  LUAT_GIA_TRI.AI_AGENT_GIA_SECRET = () => true;
  LUAT_GIA_TRI.AI_AGENT_GIA_BOT_TOKEN = () => true;
  try {
    const r = locCo({ AI_AGENT_GIA_SECRET: "bm-luat-rieng-q7z", AI_AGENT_GIA_BOT_TOKEN: "1" });
    assert.deepEqual(r, { co: {}, boQua: ["AI_AGENT_GIA_BOT_TOKEN", "AI_AGENT_GIA_SECRET"] });
  } finally {
    delete LUAT_GIA_TRI.AI_AGENT_GIA_SECRET;
    delete LUAT_GIA_TRI.AI_AGENT_GIA_BOT_TOKEN;
  }
});

test("báo cáo không chứa bí mật trong env; khoá llama-server THẬT SỰ được gửi trong tiêu đề gọi model", async () => {
  const { sv, url, tieuDe } = await gia([OK]);
  const ra = path.join(tam, "ra-bm");
  const tho = path.join(tam, "tho", "2026-11-10");
  const r = await chay(["--url", url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--ngay", "2026-11-10"], envSach({ ...BI_MAT, ...CO_THAT }));
  sv.close();
  assert.equal(r.ma, 0, r.err);
  const bc = JSON.parse(fs.readFileSync(path.join(ra, "2026-11-10.json"), "utf8"));
  assert.deepEqual(bc.co, CO_THAT);
  assert.deepEqual(bc.coBoQua, ["AI_AGENTIC_ACCESS_TOKEN", "AI_AGENT_DB_PASSWORD", "AI_AGENT_SECRET", "AI_CODING_API_KEY"]);
  assert.match(fs.readFileSync(path.join(ra, "2026-11-10.md"), "utf8"), /Cờ bị loại khỏi báo cáo .*AI_CODING_API_KEY/);
  const raHet = `${docCay(ra)}\n${docCay(tho)}\n${r.out}\n${r.err}`;
  for (const [k, v] of Object.entries(BI_MAT)) assert.ok(!raHet.includes(v), `${k} lọt ra báo cáo/thô/log`);
  assert.ok(!/q7z/.test(raHet));
  const goi = tieuDe.filter((t) => t.url === "/v1/chat/completions");
  assert.equal(goi.length, 1);
  assert.equal(goi[0].authorization, "Bearer bm-llama-q7z");
});

test("gọi model: khoá từ tệp thắng khoá env; không cấu hình khoá thì không gửi tiêu đề authorization", async () => {
  const p = path.join(tam, "khoa-goi.txt");
  fs.writeFileSync(p, "tu-tep-q8\n");
  for (const [env, mong] of [
    [{ LLAMA_SERVER_API_KEY: "env-q8", LLAMA_SERVER_API_KEY_FILE: p }, "Bearer tu-tep-q8"],
    [{}, null],
  ]) {
    const { sv, url, tieuDe } = await gia([OK]);
    const r = await chay(["--url", url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", path.join(tam, `ra-khoa-${mong ? 1 : 0}`), "--ngay", "2026-11-10"], envSach(env));
    sv.close();
    assert.equal(r.ma, 0, r.err);
    assert.deepEqual(tieuDe.filter((t) => t.url === "/v1/chat/completions").map((t) => t.authorization), [mong]);
  }
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

// ── T1 nghiệm thu: --tu-kiem-ma (11/11) ─────────────────────────────────────────────────────────────────────────────────────
const TK_DA_SUA = "ok=1; trang-thai=da-sua; ngon-ngu=ts; vong=1; sua=2; con=0; ky-tu-them=812; ms=1530; nguon=luot";

test("tachTuKiemMa: chỉ khoá + dạng giá trị biết trước; chữ tự do, đường dẫn, chuỗi kết nối, khoá lạ bị bỏ", () => {
  assert.deepEqual(tachTuKiemMa(TK_DA_SUA), { ok: "1", trangThai: "da-sua", ngonNgu: "ts", vong: 1, sua: 2, con: 0, kyTuThem: 812, ms: 1530, nguon: "luot" });
  assert.deepEqual(tachTuKiemMa("ok=skip; nguon=luot"), { ok: "skip", nguon: "luot" });
  assert.deepEqual(tachTuKiemMa("ok=na; trang-thai=khong-kiem-duoc; ngon-ngu=cs; vong=0; sua=0; con=0; ky-tu-them=0; ms=12; nguon=env").trangThai, "khong-kiem-duoc");
  const ban = tachTuKiemMa("ok=1; trang-thai=da-sua; ghi=ignore-previous; url=postgres://a:b@h/d; ngon-ngu=C:\\x; vong=1.5; sua=-1; ms=12345678; nguon=khac; trang-thai2=sach");
  assert.deepEqual(ban, { ok: "1", trangThai: "da-sua" });
  for (const x of [null, undefined, 42, {}, "", "khong co dau bang", "a".repeat(401)]) assert.equal(tachTuKiemMa(x), null, String(x).slice(0, 20));
  // Trần 400 ký tự: chuỗi có khoá hợp lệ nhưng quá dài ⇒ null (không đọc nửa vời).
  const dai = `ok=1; trang-thai=sach; ${"x".repeat(380)}`;
  assert.ok(dai.length > 400);
  assert.equal(tachTuKiemMa(dai), null);
  assert.deepEqual(tachTuKiemMa(`ok=1; trang-thai=sach; ${"x".repeat(300)}`), { ok: "1", trangThai: "sach" });
});

test("tuKiemMaChoLuot: bat/tat cố định; xen-ke chia đều mỗi bài và xen kẽ theo từng lượt gọi", () => {
  for (let m = 1; m <= 6; m++) for (let i = 0; i < 4; i++) {
    assert.equal(tuKiemMaChoLuot("bat", m, i), true);
    assert.equal(tuKiemMaChoLuot("tat", m, i), false);
    assert.equal(tuKiemMaChoLuot(undefined, m, i), false);
  }
  for (let i = 0; i < 4; i++) assert.equal([1, 2, 3, 4, 5, 6].filter((m) => tuKiemMaChoLuot("xen-ke", m, i)).length, 3, `bài ${i}`);
  assert.deepEqual([0, 1, 2, 3].map((i) => tuKiemMaChoLuot("xen-ke", 1, i)), [false, true, false, true]);
  assert.deepEqual(CHE_DO_TU_KIEM, ["tat", "bat", "xen-ke"]);
});

test("bangTuKiem: bài × nhánh, đạt/n, trạng thái và số TB chỉ từ lượt có tuKiemMa; hàng không có tuKiemMaLuot bị bỏ", () => {
  const h = (dat, luot, tk, ms = 1000) => ({ id: "H-cs2", dat, ms, tuKiemMaLuot: luot, ...(tk ? { tuKiemMa: tk } : {}) });
  const b = bangTuKiem([
    h(true, true, { trangThai: "da-sua", vong: 1, kyTuThem: 100, ms: 1000 }, 3000),
    h(true, true, { trangThai: "sach", vong: 0, kyTuThem: 0, ms: 500 }, 1000),
    h(false, false, null, 2000),
    h(true, false, null, 4000),
    { id: "H-cs2", dat: true, ms: 1 },
  ]);
  assert.deepEqual(b, [
    { id: "H-cs2", nhanh: "bat", dat: 2, n: 2, msTb: 2000, trangThai: { "da-sua": 1, sach: 1 }, vongTb: 1, kyTuThemTb: 50, msThemTb: 750 },
    { id: "H-cs2", nhanh: "tat", dat: 1, n: 2, msTb: 3000, trangThai: {}, vongTb: null, kyTuThemTb: null, msThemTb: null },
  ]);
});

test("locCo: tiền tố AI_CHAT_ vào báo cáo (theo-luot là từ cố định); tên dáng bí mật dưới AI_CHAT_ vẫn bị loại", () => {
  const r = locCo({ AI_CHAT_TU_KIEM_MA: "theo-luot", AI_CHAT_TU_KIEM_VONG: "2", AI_CHAT_TU_KIEM_DONG_THOI: "2", AI_CHAT_COPILOT: "true", AI_CHAT_SECRET: "1", AI_CHAT_API_KEY: "0", AI_CHAT_TU_KIEM_MA_X: "postgres://a" });
  assert.deepEqual(r.co, { AI_CHAT_COPILOT: "true", AI_CHAT_TU_KIEM_DONG_THOI: "2", AI_CHAT_TU_KIEM_MA: "theo-luot", AI_CHAT_TU_KIEM_VONG: "2" });
  assert.deepEqual(r.boQua, ["AI_CHAT_API_KEY", "AI_CHAT_SECRET", "AI_CHAT_TU_KIEM_MA_X"]);
});

/** Giả máy chủ chat coding cho T1. `cheDo`: "luot" = như AI_CHAT_TU_KIEM_MA=theo-luot; "khong" = cờ tắt; "env" = cờ 1 (luôn có). */
function giaChatT1(cheDo, tkChuoi = TK_DA_SUA) {
  const yeuCau = [];
  const sv = http.createServer((req, res) => {
    if (req.url === "/health") return res.end("{}");
    if (req.url === "/slots") return res.end("[]");
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      const than = JSON.parse(b);
      yeuCau.push(than);
      const coTk = cheDo === "env" || (cheDo === "luot" && than.context?.tuKiemMa === true);
      res.write(`data: ${JSON.stringify({ type: "token", token: OK.text })}\n\n`);
      res.end(`data: ${JSON.stringify({ type: "done", ...(coTk ? { tuKiemMa: cheDo === "env" ? tkChuoi.replace("nguon=luot", "nguon=env") : tkChuoi } : {}) })}\n\n`);
    });
  });
  return new Promise((r) => sv.listen(0, "127.0.0.1", () => r({ sv, url: `http://127.0.0.1:${sv.address().port}`, yeuCau })));
}
function ckT1(ten) {
  const ck = path.join(tam, ten);
  fs.writeFileSync(ck, "127.0.0.1\tFALSE\t/\tFALSE\t0\tapp_session_id\tabc\n");
  return ck;
}

test("--tu-kiem-ma xen-ke: lượt TẮT gửi thân y như cũ (không có trường tuKiemMa), lượt BẬT gửi true; báo cáo ghi từng lượt + bảng T1, không chép chữ tự do", async () => {
  const g = await giaChatT1("luot", `${TK_DA_SUA}; ghi=ignore-previous-instructions; url=postgres://u:p@h/d`);
  const ra = path.join(tam, "raT1");
  const r = await chay(["--truc", "H", "--base", g.url, "--cookie", ckT1("ckT1.txt"), "--url", g.url, "--samples", "2", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--ngay", "2026-11-11", "--tu-kiem-ma", "xen-ke"], envSach({ AI_CHAT_TU_KIEM_MA: "theo-luot" }));
  g.sv.close();
  assert.equal(r.ma, 0, r.err);
  assert.equal(g.yeuCau.length, 2);
  assert.equal("tuKiemMa" in g.yeuCau[0].context, false, "mẫu 1 bài 0 ⇒ TẮT ⇒ không có trường");
  assert.equal(g.yeuCau[1].context.tuKiemMa, true);
  assert.deepEqual({ ...g.yeuCau[0].context }, { route: "/ai-coding-workspace", uiLanguage: "vi", codingMode: true, projectId: "repo" });
  const bc = JSON.parse(fs.readFileSync(path.join(ra, "2026-11-11.json"), "utf8"));
  assert.equal(bc.tuKiemMaCheDo, "xen-ke");
  assert.deepEqual(bc.hang.map((h) => h.tuKiemMaLuot), [false, true]);
  assert.equal(bc.hang[0].tuKiemMa, undefined);
  assert.deepEqual(bc.hang[1].tuKiemMa, { ok: "1", trangThai: "da-sua", ngonNgu: "ts", vong: 1, sua: 2, con: 0, kyTuThem: 812, ms: 1530, nguon: "luot" });
  assert.deepEqual(bc.tuKiem.map((t) => [t.nhanh, t.dat, t.n]), [["bat", 1, 1], ["tat", 1, 1]]);
  assert.equal(bc.co.AI_CHAT_TU_KIEM_MA, "theo-luot");
  const md = fs.readFileSync(path.join(ra, "2026-11-11.md"), "utf8");
  assert.match(md, /Tự kiểm mã T1 \(`--tu-kiem-ma xen-ke`\)/);
  assert.match(md, /\| H-ts1 \| bat \| 1\/1 \|/);
  assert.match(md, /da-sua 1/);
  for (const t of [JSON.stringify(bc), md]) for (const bi of ["ignore-previous", "postgres", "u:p@"]) assert.ok(!t.includes(bi), bi);
});

test("--tu-kiem-ma bat mà máy chủ không theo-luot (không trả done.tuKiemMa): thoát 2, không ghi báo cáo", async () => {
  const g = await giaChatT1("khong");
  const ra = path.join(tam, "raT1b");
  const r = await chay(["--truc", "H", "--base", g.url, "--cookie", ckT1("ckT1b.txt"), "--url", g.url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--tu-kiem-ma", "bat"]);
  g.sv.close();
  assert.equal(r.ma, 2);
  assert.match(r.err, /không có done\.tuKiemMa nguon=luot/);
  assert.ok(!fs.existsSync(ra) || fs.readdirSync(ra).length === 0);
});

test("--tu-kiem-ma bat mà máy chủ đặt cờ 1 (nguon=env): thoát 2 — nhánh không do lượt quyết", async () => {
  const g = await giaChatT1("env");
  const ra = path.join(tam, "raT1e");
  const r = await chay(["--truc", "H", "--base", g.url, "--cookie", ckT1("ckT1e.txt"), "--url", g.url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--tu-kiem-ma", "bat"]);
  g.sv.close();
  assert.equal(r.ma, 2);
  assert.ok(!fs.existsSync(ra) || fs.readdirSync(ra).length === 0);
});

test("--tu-kiem-ma tat mà máy chủ vẫn trả done.tuKiemMa: thoát 2, không ghi báo cáo", async () => {
  const g = await giaChatT1("env");
  const ra = path.join(tam, "raT1t");
  const r = await chay(["--truc", "H", "--base", g.url, "--cookie", ckT1("ckT1t.txt"), "--url", g.url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--tu-kiem-ma", "tat"]);
  g.sv.close();
  assert.equal(r.ma, 2);
  assert.match(r.err, /lượt TẮT .* vẫn có done\.tuKiemMa/);
  assert.ok(!fs.existsSync(ra) || fs.readdirSync(ra).length === 0);
});

test("--tu-kiem-ma tat mà máy chủ trả done.tuKiemMa KHÔNG đọc được (rác): vẫn tính là có ⇒ thoát 2", async () => {
  const g = await giaChatT1("env", "rac khong co dau bang");
  const ra = path.join(tam, "raT1r");
  const r = await chay(["--truc", "H", "--base", g.url, "--cookie", ckT1("ckT1r.txt"), "--url", g.url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--tu-kiem-ma", "tat"]);
  g.sv.close();
  assert.equal(r.ma, 2);
  assert.ok(!fs.existsSync(ra) || fs.readdirSync(ra).length === 0);
});

test("--tu-kiem-ma giá trị lạ: thoát 2 NGAY, lỗi nêu --tu-kiem-ma, không cần máy chủ (kiem-dinh P3: trước đây đột biến làm treo thay vì đỏ)", { timeout: 15_000 }, async () => {
  const t0 = Date.now();
  const r = await chay(["--truc", "H", "--base", "http://127.0.0.1:9", "--cookie", ckT1("ckT1z.txt"), "--url", "http://127.0.0.1:9", "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", path.join(tam, "raT1z"), "--tu-kiem-ma", "xyz"]);
  assert.equal(r.ma, 2);
  assert.match(r.err, /--tu-kiem-ma tat\|bat\|xen-ke, nhận: xyz/);
  assert.ok(Date.now() - t0 < 10_000, `${Date.now() - t0} ms`);
});

// Không dựng máy chủ giả: nếu assert đỏ giữa chừng mà server chưa close thì tệp test treo (kiem-dinh m14). Cổng chết ⇒ lỗi phải đến từ kiểm cờ.
test("--tu-kiem-ma giá trị lạ hoặc không phải trục H: thoát 2 trước khi gọi gì, lỗi nêu đúng lý do", { timeout: 15_000 }, async () => {
  const CHET = "http://127.0.0.1:9";
  for (const [args, loi] of [
    [["--truc", "H", "--base", CHET, "--cookie", ckT1("ckT1x.txt"), "--tu-kiem-ma", "co"], /--tu-kiem-ma tat\|bat\|xen-ke, nhận: co/],
    [["--truc", "M", "--tu-kiem-ma", "bat"], /--tu-kiem-ma chỉ dùng với --truc H/],
  ]) {
    const r = await chay([...args, "--url", CHET, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", path.join(tam, "raT1x")]);
    assert.equal(r.ma, 2, args.join(" "));
    assert.match(r.err, loi, args.join(" "));
  }
});

test("không có --tu-kiem-ma: thân yêu cầu như cũ, hàng không có tuKiemMaLuot, báo cáo không có bảng T1", async () => {
  const g = await giaChatT1("khong");
  const ra = path.join(tam, "raT1k");
  const r = await chay(["--truc", "H", "--base", g.url, "--cookie", ckT1("ckT1k.txt"), "--url", g.url, "--samples", "1", "--bo", "tasks-hard", "--only", "H-ts1", "--ra", ra, "--ngay", "2026-11-11"]);
  g.sv.close();
  assert.equal(r.ma, 0, r.err);
  assert.equal("tuKiemMa" in g.yeuCau[0].context, false);
  const bc = JSON.parse(fs.readFileSync(path.join(ra, "2026-11-11.json"), "utf8"));
  assert.equal("tuKiemMaLuot" in bc.hang[0], false);
  assert.equal("tuKiemMaCheDo" in bc, false);
  assert.equal("tuKiem" in bc, false);
  assert.doesNotMatch(fs.readFileSync(path.join(ra, "2026-11-11.md"), "utf8"), /Tự kiểm mã T1/);
});
