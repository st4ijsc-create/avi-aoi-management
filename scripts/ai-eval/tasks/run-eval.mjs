#!/usr/bin/env node
/**
 * C2: chạy bài `tasks/` N mẫu mỗi bài, chấm bằng `check.mjs`, tính pass@1 trung bình và pass@N theo stack, ghi báo cáo VÀO REPO
 * (`docs/ai/eval/<ngày>[-nhãn].json` + `.md`). Câu trả lời thô để ngoài repo (`--tho`).
 *
 *   node scripts/ai-eval/tasks/run-eval.mjs --samples 3 [--bo tasks-hard,tasks-api2,agent-f] [--only <id,…|stack>] [--nhan <nhãn>]
 *       [--url http://127.0.0.1:8091] [--max-tokens 16000] [--sha] [--tran-phut 180] [--ra docs/ai/eval] [--tho D:/DO-AI/eval]
 *       [--agent-config agent|mau] [--noi tai-cho|tam] [--ghi-chu <chữ vào báo cáo>] [--mau-tai-giay 60]
 *       [--truc M|H] [--base http://127.0.0.1:3013] [--cookie <tệp>] [--project-id <id>]
 *
 * Trước lượt đo chạy `kiem-thuoc.mjs`: thước hỏng thì số vô nghĩa.
 * Thoát 0 = đo xong (kể cả có bài trượt) · 2 = VỨT, không ghi báo cáo (llama-server chết, thước hỏng) · 3 = chạm trần thời gian, báo cáo có `dungSom`.
 *
 * ma-don mặc định đo model THUẦN (trục M, cùng sampling và SYS với `run.mjs --config raw`): cờ AI_AGENT_* không tác động, tài liệu và tool không tới model.
 * `--truc H` đi đường sản phẩm `/api/ai/local-kb/stream` của máy chủ ở `--base` (cùng thân yêu cầu với `run.mjs --config pipeline`).
 * Với bài sinh mã, đường này là MỘT lượt gọi model (`streamCodingGenerate`, audit `kb_sinh_ma`) có persona + ngữ cảnh mã repo
 * (`AI_CODING_REPO_CONTEXT`), KHÔNG vòng tool, không lookup_api/search_docs: đêm 09/11 đếm 127 hàng `kb_sinh_ma` cho 127 mẫu, 0 hàng khác.
 * Trục H không có `finish_reason` nên không đếm được bài cụt: báo cáo để `cut: null`.
 * agent-f gọi `run-f.mjs`, cần máy chủ ở AI_EVAL_BASE và cookie như README của nó. Bài pilot-repo cần bộ chạy pilot + lượt `_test`: chưa đo ở đây, ghi trong `chuaDo`.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BENCH_CODEGEN, danhSachBai, ROOT, thamSo } from "./lib/chung.mjs";
import { docTienTrinh, layBam, tachDongLenh } from "../../ai/kiem-he-thong.mjs";

const SAMPLING = { temperature: 0.2, top_p: 0.9 };
const TEP_RUN_F = `${BENCH_CODEGEN}/agent-f/run-f.mjs`;

const CO_GIA_TRI = ["--samples", "--bo", "--only", "--nhan", "--url", "--max-tokens", "--tran-phut", "--ra", "--tho", "--agent-config", "--noi", "--ghi-chu", "--mau-tai-giay", "--truc", "--base", "--cookie", "--project-id", "--ngay"];
const CO_BAT = ["--sha"];

/**
 * Dòng lệnh hợp lệ thì trả null, không thì trả lý do. Đêm 10/11 `run-eval --help` đã chạy thật một lượt lên :8091
 * vì tham số lạ bị bỏ qua: nay `--help`, `-h`, cờ lạ, cờ thiếu giá trị, hay chữ thừa đều làm thoát 2 trước khi gọi model.
 */
export function loiThamSo(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return "in cú pháp";
    if (CO_BAT.includes(a)) continue;
    if (CO_GIA_TRI.includes(a)) {
      if (argv[i + 1] === undefined || CO_GIA_TRI.includes(argv[i + 1]) || CO_BAT.includes(argv[i + 1])) return `${a} thiếu giá trị`;
      i++;
      continue;
    }
    return a.startsWith("-") ? `cờ lạ: ${a}` : `chữ thừa không thuộc cờ nào: ${a}`;
  }
  return null;
}

const CU_PHAP = `node scripts/ai-eval/tasks/run-eval.mjs [--samples N] [--bo …] [--only …] [--nhan …] [--url …] [--max-tokens N] [--sha]
  [--tran-phut N] [--ra …] [--tho …] [--agent-config agent|mau] [--noi tai-cho|tam] [--ghi-chu …] [--mau-tai-giay N]
  [--truc M|H] [--base …] [--cookie …] [--project-id …] [--ngay YYYY-MM-DD]
Không có chế độ khô: thiếu lỗi tham số là CHẠY THẬT lên model. Xem docblock đầu tệp.`;

/** Nhãn tiến trình làm méo số đo. Báo cáo vào repo chỉ ghi nhãn, không ghi dòng lệnh (có thể chứa bí mật). */
const NHAN_NANG = [
  ["vitest", /vitest/i],
  ["dot-bien", /dot-?bien/i],
  ["tsc", /\btsc(\.js|\.cmd)?\b/i],
  ["esbuild-vite", /esbuild|vite(\.js|\.mjs|\s)/i],
  ["dotnet", /\bdotnet(\.exe)?\b/i],
  ["playwright", /@playwright[\\/]test[\\/]cli\.js"?\s+test(?!-server)|\bplaywright\s+test\b/i],
  ["kiem-thuoc", /kiem-thuoc/i],
];
/** Dùng ≥ 5 % một lõi trong khoảng giữa hai mẫu mới tính là đang làm việc. */
const NGUONG_MOT_LOI = 0.05;

/**
 * Nhãn tiến trình ĐANG LÀM VIỆC giữa hai mẫu. `ds`: [{ pid, cha, lenh, cpuMs }], `truoc`: Map pid → cpuMs của mẫu trước.
 * Không tính chính lượt đo: con cháu của `pidMinh` (bộ chấm) và tổ tiên của nó (shell bọc lệnh, dòng lệnh có thể chứa chữ "vitest").
 * Không tính tiến trình nhàn rỗi: cùng tên "dotnet" hay "tsc" có thể là dịch vụ thường trực của VS Code hoặc VBCSCompiler bộ chấm để lại.
 * Mẫu đầu chưa có `truoc` nên không gắn nhãn được: trả rỗng.
 */
export function nhanTienTrinhNang(ds, pidMinh, truoc, giay) {
  if (!truoc) return [];
  const con = new Map();
  const cha = new Map();
  for (const x of ds) {
    con.set(x.cha, [...(con.get(x.cha) ?? []), x.pid]);
    cha.set(x.pid, x.cha);
  }
  const cuaMinh = new Set([pidMinh]);
  const hang = [pidMinh];
  while (hang.length) for (const c of con.get(hang.pop()) ?? []) if (!cuaMinh.has(c)) (cuaMinh.add(c), hang.push(c));
  for (let p = cha.get(pidMinh); p !== undefined && !cuaMinh.has(p); p = cha.get(p)) cuaMinh.add(p);
  const ra = new Set();
  for (const x of ds) {
    if (cuaMinh.has(x.pid) || !x.lenh) continue;
    if ((x.cpuMs - (truoc.get(x.pid) ?? 0)) / (giay * 1000) < NGUONG_MOT_LOI) continue;
    for (const [nhan, re] of NHAN_NANG) if (re.test(x.lenh)) ra.add(nhan);
  }
  return [...ra].sort();
}

/** Gộp các mẫu tải { cpu, nhan: [] } thành phần `taiMay` của báo cáo. */
export function tongHopTai(mau, soLuotSlotBan) {
  const cpu = mau.map((m) => m.cpu).filter((x) => typeof x === "number");
  const tienTrinhNang = {};
  for (const m of mau) for (const n of m.nhan) tienTrinhNang[n] = (tienTrinhNang[n] ?? 0) + 1;
  return {
    soMauTai: mau.length,
    cpuTb: cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null,
    cpuMax: cpu.length ? Math.max(...cpu) : null,
    tienTrinhNang,
    soLuotSlotBan,
    sach: Object.keys(tienTrinhNang).length === 0 && soLuotSlotBan === 0,
  };
}

/** Một mẫu tải máy. Không đọc được thì trả cpu null, không làm hỏng lượt đo. `trangThai.truoc` giữ cpuMs của mẫu trước. */
function docTai(trangThai, giay) {
  return new Promise((resolve) => {
    const lenh = "$c=(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average; $p=Get-CimInstance Win32_Process | Select-Object @{n='pid';e={$_.ProcessId}},@{n='cha';e={$_.ParentProcessId}},@{n='lenh';e={$_.CommandLine}},@{n='cpuMs';e={[math]::Round(($_.KernelModeTime+$_.UserModeTime)/10000)}}; @{cpu=$c;ds=@($p)} | ConvertTo-Json -Depth 3 -Compress";
    const c = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", lenh], { windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("error", () => resolve({ cpu: null, nhan: [] }));
    c.on("close", () => {
      try {
        const j = JSON.parse(out);
        const nhan = nhanTienTrinhNang(j.ds, process.pid, trangThai.truoc, giay);
        trangThai.truoc = new Map(j.ds.map((x) => [x.pid, x.cpuMs]));
        resolve({ cpu: j.cpu, nhan });
      } catch {
        resolve({ cpu: null, nhan: [] });
      }
    });
  });
}

/** Slot đang bận lúc sắp gửi = có người khác dùng :8091 (Thợ Cả trong VS Code), thời gian của bài đó bị méo. */
async function slotBan(url) {
  try {
    const r = await fetch(`${url}/slots`, { headers: tieuDeKhoa(), signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    return (await r.json()).some((x) => x.is_processing);
  } catch {
    return false;
  }
}

export function tinhBang(hang, soMau) {
  const theoStack = new Map();
  for (const h of hang) {
    if (!theoStack.has(h.stack)) theoStack.set(h.stack, new Map());
    const bai = theoStack.get(h.stack);
    if (!bai.has(h.id)) bai.set(h.id, []);
    bai.get(h.id).push(h);
  }
  const mot = (ten, nhom) => {
    const luot = [...nhom.values()].flat();
    const dat = luot.filter((l) => l.dat).length;
    const so = (f) => luot.map(f).filter((x) => typeof x === "number");
    const tb = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const moiMau = Array.from({ length: soMau }, (_, i) => luot.filter((l) => l.mau === i + 1 && l.dat).length);
    return {
      stack: ten,
      bai: nhom.size,
      luot: luot.length,
      dat,
      passAt1: luot.length ? +(dat / luot.length).toFixed(3) : null,
      passAtN: nhom.size ? +([...nhom.values()].filter((g) => g.some((l) => l.dat)).length / nhom.size).toFixed(3) : null,
      moiMau,
      // Trục H và agent-f không có finish_reason: "không đo được" khác 0 bài cụt.
      cut: luot.some((l) => l.cut === null) ? null : luot.filter((l) => l.cut).length,
      tokRaTb: tb(so((l) => l.tokRa)),
      msTb: tb(so((l) => l.ms)),
    };
  };
  const stacks = [...theoStack.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => mot(t, n));
  const tatCa = new Map();
  for (const [t, n] of theoStack) for (const [id, l] of n) tatCa.set(`${t}/${id}`, l);
  return { stacks, tong: mot("TỔNG", tatCa) };
}

export function bangMarkdown(bc) {
  const pct = (x) => (x === null ? "—" : `${(x * 100).toFixed(1)} %`);
  const dong = (s) => `| ${s.stack} | ${s.bai} | ${s.dat}/${s.luot} | ${pct(s.passAt1)} | ${pct(s.passAtN)} | ${s.moiMau.join(" · ")} | ${s.cut ?? "không đo"} | ${s.tokRaTb ?? "—"} | ${s.msTb === null ? "—" : (s.msTb / 1000).toFixed(1)} |`;
  const m = bc.model;
  return [
    `# Đo Thợ Cả ${bc.ngay}${bc.nhan ? ` (${bc.nhan})` : ""}`,
    "",
    `Trục ${bc.truc ?? "M"} · commit \`${bc.commit}\`${bc.cayBan ? " (cây có thay đổi chưa commit)" : ""} · ${bc.soMau} mẫu/bài · trần ${bc.maxTokens} token`,
    `Model \`${m.tep ?? "?"}\` · sha256 \`${m.sha ?? "chưa băm"}\` · ctx ${m.ctx ?? "?"} · budget ${m.reasoningBudget ?? "?"}`,
    `Cờ: ${Object.keys(bc.co).length ? Object.entries(bc.co).map(([k, v]) => `\`${k}=${v}\``).join(" ") : "không đặt"}`,
    ...(bc.coBoQua?.length ? [`Cờ bị loại khỏi báo cáo (tên/giá trị dáng bí mật, chỉ ghi tên): ${bc.coBoQua.join(", ")}`] : []),
    ...(bc.ghiChu ? [`Ghi chú: ${bc.ghiChu}`] : []),
    ...(bc.taiMay ? [bc.taiMay.sach ? `Tải máy: không thấy tiến trình nặng, slot không bận (${bc.taiMay.soMauTai} mẫu, CPU TB ${bc.taiMay.cpuTb ?? "?"} %, đỉnh ${bc.taiMay.cpuMax ?? "?"} %)` : `**Tải máy: có tiến trình khác trong lúc đo, thời gian có thể méo.** ${Object.entries(bc.taiMay.tienTrinhNang).map(([k, v]) => `${k} ${v}/${bc.taiMay.soMauTai} mẫu`).join(", ") || "không có tiến trình nặng"}; slot bận ${bc.taiMay.soLuotSlotBan} lượt; CPU TB ${bc.taiMay.cpuTb ?? "?"} %, đỉnh ${bc.taiMay.cpuMax ?? "?"} %`] : []),
    ...(bc.dungSom ? ["", `**Dừng sớm: ${bc.dungSom}. Số dưới đây chưa đủ mẫu.**`] : []),
    ...(bc.tong.cut ? ["", `**Cụt ${bc.tong.cut}/${bc.tong.luot}: số dưới đây là chặn dưới.**`] : []),
    "",
    "| Stack | Bài | Đạt | pass@1 TB | pass@N | Đạt từng mẫu | Cụt | Token ra TB | Giây TB |",
    "|---|---|---|---|---|---|---|---|---|",
    ...bc.stacks.map(dong),
    dong({ ...bc.tong, stack: "**TỔNG**" }),
    "",
    ...(bc.chuaDo.length ? ["Chưa đo:", ...bc.chuaDo.map((c) => `- ${c}`), ""] : []),
  ].join("\n");
}

async function suKhoe(url) {
  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })).status === 200;
  } catch {
    return false;
  }
}

class Vut extends Error {}

/** Khoá llama-server trong env tiến trình, cùng luật với server/services/ai/khoaLlamaServer.ts: tệp thắng khoá env. Tệp khai mà hỏng ⇒ không rơi về khoá env. */
export function tieuDeKhoa(env = process.env) {
  const tep = (env.LLAMA_SERVER_API_KEY_FILE || "").trim();
  let khoa = (env.LLAMA_SERVER_API_KEY || "").trim();
  if (tep) {
    try {
      khoa = fs.readFileSync(tep, "utf8").trim();
    } catch {
      khoa = "";
    }
  }
  return khoa ? { authorization: `Bearer ${khoa}` } : {};
}

const TIEN_TO_CO = /^(AI_AGENT_|AI_AGENTIC_|AI_CODING_)[A-Z0-9_]+$/;
// Lớp 1, GIÁ TRỊ: chỉ nhận rỗng, số ngắn (≤ 10 ký tự, có thể âm/thập phân), hoặc MỘT từ trong tập cố định. Cờ thật dưới ba tiền tố
// (10/11) là bool/số, cộng hai cờ chuỗi: AI_CODING_MODEL_TASK (code|chat) và AI_CODING_ABLATION_NGU_CANH (hai giá trị dưới).
// Thêm cờ chuỗi mới ⇒ thêm giá trị vào tập này; giá trị lạ bị loại (chỉ ghi tên vào coBoQua), không đoán.
const SO_CO = /^-?\d{1,9}(\.\d{1,6})?$/;
const TU_CO = new Set(["true", "false", "on", "off", "yes", "no", "code", "chat", "auto", "persona-khong-khoi", "khoi-khong-persona"]);
// Lớp 2, TÊN: đoạn tên có dáng bí mật bị loại kể cả khi đúng tiền tố. 48 cờ thật dưới ba tiền tố (10/11) không tên nào khớp.
const DOAN_BI_MAT =
  /(^|_)(KEYS?|APIKEY|PRIVKEY|PRIVATEKEY|SECRETS?|PASSWORD|PASSWD|PASS|PWD|PW|PASSPHRASE|PASSCODE|PIN|CREDS?|CREDENTIALS?|BEARER|O?AUTH|COOKIES?|SESSION|SESSID|SID|PRIVATE|JWT|DSN|URL|URI|CONN|CONNECTION|CONNSTR|WEBHOOK|HOOK|SALT|HMAC|M?OTP|TOTP|MFA|SIGNATURE|SIGNING|SIG|CERT|PEM|SSH|GPG|PGP|ENCRYPTION|CIPHER|NONCE|ACCOUNT|USER|USERNAME|LOGIN|EMAIL|PHONE|LICENSE|LICENCE|SEED|SIGN|SERIAL|ACTIVATION)(_|$)/;
// TOKEN số ít là bí mật (BOT_TOKEN, ACCESS_TOKEN…), trừ dạng đếm token của cờ thật; TOKENS số nhiều là đếm (MAX_TOKENS).
const TOKEN_BI_MAT = /(^|_)TOKEN(_|$)/;
const TOKEN_DEM = /(UOC_LUONG|MAX|SO|DEM|TRAN|NGAN_SACH)_TOKEN(_|$)/;
const tenBiMat = (k) => DOAN_BI_MAT.test(k) || (TOKEN_BI_MAT.test(k) && !TOKEN_DEM.test(k));
const giaTriChung = (v) => v === "" || (v.length <= 10 && SO_CO.test(v)) || TU_CO.has(v.toLowerCase());

export const TEP_TEN_CONG_CU = `${ROOT}/shared/agentCore/congCu.ts`;

/** Tên tool trong NỘI DUNG nguồn `congCu.ts` (mảng `TEN_CONG_CU`). Không phải chuỗi, hoặc không thấy mảng ⇒ tập rỗng. Thuần. */
export function tachTenCongCu(noiDung) {
  const m = typeof noiDung === "string" ? noiDung.match(/export const TEN_CONG_CU = \[([\s\S]*?)\] as const;/) : null;
  return new Set(m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : []);
}

const tenCongCuDem = new Map();
/**
 * Tên tool biết trước = `TEN_CONG_CU` trong `shared/agentCore/congCu.ts` (đọc mỗi tệp một lần). Đọc hỏng ⇒ tập rỗng ⇒ cờ dùng nó bị loại
 * (nghiêng về không ghi), không đoán. `tep` chỉ để lưới tiêm đường hỏng.
 */
export function tenCongCuBiet(tep = TEP_TEN_CONG_CU) {
  if (!tenCongCuDem.has(tep)) {
    let noiDung = null;
    try {
      noiDung = fs.readFileSync(tep, "utf8");
    } catch {
      noiDung = null;
    }
    tenCongCuDem.set(tep, tachTenCongCu(noiDung));
  }
  return tenCongCuDem.get(tep);
}

// Cờ chuỗi có luật GIÁ TRỊ riêng (quét 48 cờ thật 10/11: chỉ cờ này mang giá trị ngoài số/từ cố định). Cờ có luật riêng KHÔNG rơi về luật chung.
// Luật riêng chỉ thay lớp GIÁ TRỊ; lớp TÊN (`tenBiMat`) vẫn áp cho MỌI cờ trong `locCo`, kể cả cờ có luật riêng.
export const LUAT_GIA_TRI = {
  // Bộ đo tìm mã (`boThucThiMayChu.congCuBiAn`, `run-tim-ma.mjs`): danh sách tên tool, phân tách bằng phẩy, mọi tên phải là tool biết trước.
  AI_AGENT_AN_CONG_CU: (v, nd) => v === "" || (/^[a-z_]+(,[a-z_]+)*$/.test(v) && v.split(",").every((t) => nd.tenCongCu.has(t))),
};
const giaTriCo = (k, v, nd) => typeof v === "string" && (LUAT_GIA_TRI[k] ? LUAT_GIA_TRI[k](v, nd) : giaTriChung(v));

/**
 * Cờ agent của lượt đo vào báo cáo. Đúng tiền tố mới xét; vào `co` (tên + giá trị) chỉ khi qua CẢ hai lớp giá trị và tên.
 * Bị loại thì chỉ ghi TÊN vào `boQua`, không bao giờ ghi giá trị. Mọi biến env ngoài ba tiền tố không vào đâu cả.
 * `tepCongCu`: nguồn tên tool cho luật của AI_AGENT_AN_CONG_CU (lưới tiêm đường hỏng).
 */
export function locCo(env = process.env, { tepCongCu = TEP_TEN_CONG_CU } = {}) {
  const nd = {
    get tenCongCu() {
      return tenCongCuBiet(tepCongCu);
    },
  };
  const co = {};
  const boQua = [];
  for (const [k, v] of Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!TIEN_TO_CO.test(k)) continue;
    if (giaTriCo(k, v, nd) && !tenBiMat(k)) co[k] = v;
    else boQua.push(k);
  }
  return { co, boQua };
}

export const coBaoCao = (env = process.env) => locCo(env).co;

async function goiModel(url, sys, prompt, maxTokens) {
  const t0 = Date.now();
  const r = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tieuDeKhoa() },
    body: JSON.stringify({ messages: [{ role: "system", content: sys }, { role: "user", content: prompt }], ...SAMPLING, max_tokens: maxTokens, stream: false }),
  });
  if (!r.ok) throw new Vut(`llama-server HTTP ${r.status}`);
  const j = await r.json();
  const c = j.choices?.[0];
  return { text: c?.message?.content ?? "", cut: c?.finish_reason === "length", tokRa: j.usage?.completion_tokens ?? null, ms: Date.now() - t0 };
}

/** Một bài qua đường sản phẩm. Đọc SSE như client thật: `done.answerRevised` thay văn bản đã tích luỹ. */
async function goiDuongSanPham(base, cookie, prompt) {
  const t0 = Date.now();
  const r = await fetch(`${base}/api/ai/local-kb/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ question: prompt, topK: 5, history: [], userRole: "admin", context: { route: "/ai-coding-workspace", uiLanguage: "vi", codingMode: true, projectId: "repo" } }),
  });
  // 401/403/404 là cấu hình lượt đo sai, không phải bài trượt.
  if (!r.ok) throw new Vut(`${base}/api/ai/local-kb/stream HTTP ${r.status}`);
  let text = "";
  let buf = "";
  const dec = new TextDecoder();
  for await (const c of r.body) {
    buf += dec.decode(c, { stream: true });
    for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
      const m = buf.slice(0, i).match(/^data:\s*([\s\S]*)$/m);
      buf = buf.slice(i + 2);
      if (!m) continue;
      let o;
      try {
        o = JSON.parse(m[1]);
      } catch {
        continue;
      }
      if (o.type === "token") text += o.token ?? "";
      else if (o.type === "done" && o.answerRevised === true && typeof o.answer === "string") text = o.answer;
    }
  }
  // Server từ chối dự án (`codingProjectDeniedMessage`) mà không gọi model: lượt đo cấu hình sai, không phải bài trượt (đêm 09/11).
  if (TU_CHOI_DU_AN.test(text.trimStart())) throw new Vut(`server từ chối dự án "repo" (thiếu trong AI_REPO_SANDBOX_ROOTS?): ${text.slice(0, 120)}`);
  return { text, cut: null, tokRa: null, ms: Date.now() - t0 };
}

const TU_CHOI_DU_AN = /^(Dự án đang chọn \(`|The selected project \(`|所选项目（`)/;

function chamMaDon(b, tepTraLoi) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [`${b.dir}/check.mjs`, "--tra-loi", tepTraLoi], { windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (ma) => {
      if (ma !== 0 && ma !== 1) return reject(new Vut(`thước hỏng ở ${b.id}: ${out.trim().slice(-400)}`));
      let lyDo = [];
      try {
        lyDo = JSON.parse(out.trim().split(/\r?\n/).pop()).lyDo ?? [];
      } catch {
        /* giữ rỗng: mã thoát là kết quả */
      }
      resolve({ dat: ma === 0, lyDo });
    });
  });
}

/** Mỗi bài một lần `run-f`: `--tien-to` chỉ nhận một thư mục, và dự án sandbox gốc là thư mục cha chứa các bài. */
function doAgentF(baiF, soMau, y) {
  const ra = [];
  for (const b of baiF) {
    const nhan = `run-eval-${y.ngay}-${y.nhan || "x"}-${b.id}-1`;
    const thamSoDuAn = y.projectId ? ["--project-id", y.projectId, "--tien-to", b.id] : [];
    const r = spawnSync(process.execPath, [TEP_RUN_F, "--config", y.agentConfig, "--luot", String(soMau), "--label", nhan, "--noi", y.noi, "--only", b.id, ...thamSoDuAn, ...(y.cookie ? ["--cookie", y.cookie] : [])], { stdio: ["ignore", "inherit", "inherit"], windowsHide: true, env: { ...process.env, ...(y.base ? { AI_EVAL_BASE: y.base } : {}) } });
    // run-f: 2 = vứt. Ở chế độ kiểm thước 1 cũng là thước hỏng.
    if (r.status === 2 || (y.agentConfig !== "agent" && r.status !== 0)) throw new Vut(`run-f ${b.id} thoát ${r.status}`);
    const bc = JSON.parse(fs.readFileSync(`${BENCH_CODEGEN}/reports/${nhan}.json`, "utf8"));
    for (const x of bc.rows) ra.push({ id: x.id, stack: b.stack, bo: "agent-f", mau: x.luot, dat: x.dat, lyDo: x.cham?.lyDo ?? [], cut: null, tokRa: x.agent?.usage?.ra ?? null, ms: x.agent?.ms ?? null, lyDoDung: x.agent?.lyDo ?? null });
  }
  return ra;
}

/** Tên tệp báo cáo không đè lượt cùng ngày. */
export function tenBaoCao(thuMuc, ngay, nhan) {
  const goc = `${ngay}${nhan ? `-${nhan}` : ""}`;
  for (let i = 1; ; i++) {
    const ten = i === 1 ? goc : `${goc}-${i}`;
    if (!fs.existsSync(`${thuMuc}/${ten}.json`)) return ten;
  }
}

async function main() {
  // Như chayCheck: run-f chấm bằng `node --test`; biến này được kế thừa khi run-eval chạy dưới `node --test`, bộ chấm lồng sẽ thoát 0 dù đỏ.
  delete process.env.NODE_TEST_CONTEXT;
  const loiTs = loiThamSo(process.argv.slice(2));
  if (loiTs) {
    console.error(`${loiTs}\n${CU_PHAP}`);
    return 2;
  }
  const { lay, co } = thamSo();
  const soMau = Number(lay("--samples", "3"));
  if (!Number.isInteger(soMau) || soMau < 1) throw new Vut(`--samples: ${lay("--samples")}`);
  const url = lay("--url", "http://127.0.0.1:8091").replace(/\/$/, "");
  const maxTokens = Number(lay("--max-tokens", "16000"));
  const nhan = lay("--nhan", "");
  const bo = lay("--bo", "tasks-hard,tasks-api2,agent-f").split(",");
  const only = lay("--only")?.split(",");
  const ra = path.resolve(ROOT, lay("--ra", "docs/ai/eval"));
  const tho = lay("--tho", "D:/DO-AI/eval");
  const tranMs = Number(lay("--tran-phut", "180")) * 60_000;
  const ngay = lay("--ngay", new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));
  const tatCaBai = danhSachBai();
  const bai = tatCaBai.filter((b) => bo.includes(b.bo) && (!only || only.includes(b.id) || only.includes(b.stack)));
  const baiMa = bai.filter((b) => b.kieu === "ma-don");
  const baiF = bai.filter((b) => b.kieu === "agent-f");
  if (!bai.length) throw new Vut("không có bài nào khớp --bo/--only");
  const truc = lay("--truc", "M");
  if (!["M", "H"].includes(truc)) throw new Vut(`--truc M|H, nhận: ${truc}`);
  const base = lay("--base", "").replace(/\/$/, "");
  const tepCookie = lay("--cookie");
  if (truc === "H" && baiMa.length && (!base || !tepCookie)) throw new Vut("--truc H cần --base và --cookie");
  const canModel = baiMa.length > 0 || (baiF.length > 0 && lay("--agent-config", "agent") === "agent");
  if (canModel && !(await suKhoe(url))) throw new Vut(`${url}/health không khoẻ trước khi đo`);

  const thoDir = `${tho}/${ngay}${nhan ? `-${nhan}` : ""}`;
  fs.mkdirSync(thoDir, { recursive: true });
  const { SYS } = await import(pathToFileURL(`${BENCH_CODEGEN}/cham.mjs`).href);
  const cookie = truc === "H" && baiMa.length ? (await import(pathToFileURL(`${BENCH_CODEGEN}/cookie.mjs`).href)).ck(tepCookie) : "";
  const t0 = Date.now();
  const hang = [];
  let dungSom = null;
  const mauTai = [];
  let soLuotSlotBan = 0;
  const giayTai = Number(lay("--mau-tai-giay", "60"));
  const trangThaiTai = { truoc: null };
  let dangDocTai = giayTai > 0 ? docTai(trangThaiTai, giayTai).then((m) => void mauTai.push(m)) : Promise.resolve();
  const henTai = giayTai > 0 ? setInterval(() => void (dangDocTai = dangDocTai.then(() => docTai(trangThaiTai, giayTai)).then((m) => void mauTai.push(m))), giayTai * 1000) : null;
  // Vòng ngoài theo MẪU: dừng sớm vẫn còn mỗi mẫu đủ bài, không lệch về bài đầu danh sách.
  ngoai: for (let mau = 1; mau <= soMau; mau++) {
    for (const b of baiMa) {
      if (Date.now() - t0 > tranMs) {
        dungSom = `chạm trần ${tranMs / 60_000} phút ở mẫu ${mau}, bài ${b.id}`;
        break ngoai;
      }
      const prompt = fs.readFileSync(`${b.dir}/prompt.md`, "utf8").trimEnd();
      if (await slotBan(url)) soLuotSlotBan++;
      const g = truc === "H" ? await goiDuongSanPham(base, cookie, prompt) : await goiModel(url, SYS, prompt, maxTokens);
      const tep = `${thoDir}/${b.id}-${mau}.txt`;
      fs.writeFileSync(tep, g.text);
      const c = await chamMaDon(b, tep);
      hang.push({ id: b.id, stack: b.stack, bo: b.bo, mau, dat: c.dat, lyDo: c.lyDo, cut: g.cut, tokRa: g.tokRa, ms: g.ms });
      console.error(`mẫu ${mau} ${b.stack}/${b.id} ${c.dat ? "ĐẠT" : "TRƯỢT"}${g.cut ? " CỤT" : ""} ${g.ms} ms`);
      if (!(await suKhoe(url))) throw new Vut(`llama-server chết sau ${b.id} mẫu ${mau}`);
    }
  }
  if (baiF.length && !dungSom) hang.push(...doAgentF(baiF, soMau, { ngay, nhan, noi: lay("--noi", "tai-cho"), agentConfig: lay("--agent-config", "agent"), projectId: lay("--project-id"), cookie: tepCookie, base }));
  if (henTai) clearInterval(henTai);
  await dangDocTai;

  const port = Number(new URL(url).port);
  const p = docTienTrinh().find((x) => x.port === port) ?? tachDongLenh("");
  let sha = null;
  if (p.model && fs.existsSync(p.model)) sha = (await layBam(p.model, fs.statSync(p.model), co("--sha")))?.giaTri ?? null;
  const git = (...a) => spawnSync("git", ["-C", ROOT, ...a], { encoding: "utf8", windowsHide: true }).stdout.trim();
  const bang = tinhBang(hang, soMau);
  const baiPilot = tatCaBai.filter((b) => b.kieu === "pilot-repo" && (!only || only.includes(b.id) || only.includes(b.stack)));
  const bc = {
    ngay,
    nhan: nhan || null,
    commit: git("rev-parse", "--short", "HEAD"),
    cayBan: git("status", "--porcelain", "--", "scripts/ai-eval", "server").length > 0,
    soMau,
    truc,
    maxTokens,
    sampling: SAMPLING,
    giayTuong: Math.round((Date.now() - t0) / 1000),
    model: { tep: p.model ? p.model.split(/[\\/]/).pop() : null, sha, ctx: p.ctx, reasoningBudget: p.reasoningBudget, slot: p.slot },
    ...(({ co, boQua }) => ({ co, ...(boQua.length ? { coBoQua: boQua } : {}) }))(locCo(process.env)),
    ghiChu: lay("--ghi-chu") ?? null,
    taiMay: giayTai > 0 ? tongHopTai(mauTai, soLuotSlotBan) : null,
    dungSom,
    chuaDo: baiPilot.length ? [`pilot-repo (${baiPilot.map((b) => b.id).join(", ")}): cần bộ chạy pilot và lượt _test`] : [],
    ...bang,
    hang,
  };
  fs.mkdirSync(ra, { recursive: true });
  const ten = tenBaoCao(ra, ngay, nhan);
  fs.writeFileSync(`${ra}/${ten}.json`, `${JSON.stringify(bc, null, 1)}\n`);
  fs.writeFileSync(`${ra}/${ten}.md`, bangMarkdown(bc));
  console.log(JSON.stringify({ tep: `${ra}/${ten}.json`.replace(`${ROOT}/`, ""), tong: bc.tong, giayTuong: bc.giayTuong, dungSom }));
  return dungSom ? 3 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]).split(path.sep).join("/") === fileURLToPath(import.meta.url).split(path.sep).join("/")) {
  main().then(
    (m) => process.exit(m),
    (e) => {
      console.error(`VỨT, không ghi báo cáo: ${e?.message ?? e}`);
      process.exit(2);
    },
  );
}
