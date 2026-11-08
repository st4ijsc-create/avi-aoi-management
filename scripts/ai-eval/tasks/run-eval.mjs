#!/usr/bin/env node
/**
 * C2: chạy bài `tasks/` N mẫu mỗi bài, chấm bằng `check.mjs`, tính pass@1 trung bình và pass@N theo stack, ghi báo cáo VÀO REPO
 * (`docs/ai/eval/<ngày>[-nhãn].json` + `.md`). Câu trả lời thô để ngoài repo (`--tho`).
 *
 *   node scripts/ai-eval/tasks/run-eval.mjs --samples 3 [--bo tasks-hard,tasks-api2,agent-f] [--only <id,…|stack>] [--nhan <nhãn>]
 *       [--url http://127.0.0.1:8091] [--max-tokens 16000] [--sha] [--tran-phut 180] [--ra docs/ai/eval] [--tho D:/DO-AI/eval]
 *       [--agent-config agent|mau] [--noi tai-cho|tam]
 *
 * Trước lượt đo chạy `kiem-thuoc.mjs`: thước hỏng thì số vô nghĩa.
 * Thoát 0 = đo xong (kể cả có bài trượt) · 2 = VỨT, không ghi báo cáo (llama-server chết, thước hỏng) · 3 = chạm trần thời gian, báo cáo có `dungSom`.
 *
 * ma-don đo model THUẦN (trục M, cùng sampling và SYS với `run.mjs --config raw`): cờ AI_AGENT_* không tác động. Cờ chỉ tác động lên agent-f.
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
      cut: luot.filter((l) => l.cut).length,
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
  const dong = (s) => `| ${s.stack} | ${s.bai} | ${s.dat}/${s.luot} | ${pct(s.passAt1)} | ${pct(s.passAtN)} | ${s.moiMau.join(" · ")} | ${s.cut} | ${s.tokRaTb ?? "—"} | ${s.msTb === null ? "—" : (s.msTb / 1000).toFixed(1)} |`;
  const m = bc.model;
  return [
    `# Đo Thợ Cả ${bc.ngay}${bc.nhan ? ` (${bc.nhan})` : ""}`,
    "",
    `Commit \`${bc.commit}\`${bc.cayBan ? " (cây có thay đổi chưa commit)" : ""} · ${bc.soMau} mẫu/bài · trần ${bc.maxTokens} token`,
    `Model \`${m.tep ?? "?"}\` · sha256 \`${m.sha ?? "chưa băm"}\` · ctx ${m.ctx ?? "?"} · budget ${m.reasoningBudget ?? "?"}`,
    `Cờ: ${Object.keys(bc.co).length ? Object.entries(bc.co).map(([k, v]) => `\`${k}=${v}\``).join(" ") : "không đặt"}`,
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

async function goiModel(url, sys, prompt, maxTokens) {
  const t0 = Date.now();
  const r = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "system", content: sys }, { role: "user", content: prompt }], ...SAMPLING, max_tokens: maxTokens, stream: false }),
  });
  if (!r.ok) throw new Vut(`llama-server HTTP ${r.status}`);
  const j = await r.json();
  const c = j.choices?.[0];
  return { text: c?.message?.content ?? "", cut: c?.finish_reason === "length", tokRa: j.usage?.completion_tokens ?? null, ms: Date.now() - t0 };
}

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

function doAgentF(baiF, soMau, y) {
  const nhan = `run-eval-${y.ngay}-agentf-1`;
  const r = spawnSync(process.execPath, [TEP_RUN_F, "--config", y.agentConfig, "--luot", String(soMau), "--label", nhan, "--noi", y.noi, "--only", baiF.map((b) => b.id).join(",")], { stdio: ["ignore", "inherit", "inherit"], windowsHide: true, env: process.env });
  // run-f: 2 = vứt. Ở chế độ kiểm thước 1 cũng là thước hỏng.
  if (r.status === 2 || (y.agentConfig !== "agent" && r.status !== 0)) throw new Vut(`run-f thoát ${r.status}`);
  const bc = JSON.parse(fs.readFileSync(`${BENCH_CODEGEN}/reports/${nhan}.json`, "utf8"));
  const stack = new Map(baiF.map((b) => [b.id, b.stack]));
  return bc.rows.map((x) => ({ id: x.id, stack: stack.get(x.id), bo: "agent-f", mau: x.luot, dat: x.dat, lyDo: x.cham?.lyDo ?? [], cut: false, tokRa: x.agent?.usage?.ra ?? null, ms: x.agent?.ms ?? null, lyDoDung: x.agent?.lyDo ?? null }));
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
  const canModel = baiMa.length > 0 || (baiF.length > 0 && lay("--agent-config", "agent") === "agent");
  if (canModel && !(await suKhoe(url))) throw new Vut(`${url}/health không khoẻ trước khi đo`);

  const thoDir = `${tho}/${ngay}${nhan ? `-${nhan}` : ""}`;
  fs.mkdirSync(thoDir, { recursive: true });
  const { SYS } = await import(pathToFileURL(`${BENCH_CODEGEN}/cham.mjs`).href);
  const t0 = Date.now();
  const hang = [];
  let dungSom = null;
  // Vòng ngoài theo MẪU: dừng sớm vẫn còn mỗi mẫu đủ bài, không lệch về bài đầu danh sách.
  ngoai: for (let mau = 1; mau <= soMau; mau++) {
    for (const b of baiMa) {
      if (Date.now() - t0 > tranMs) {
        dungSom = `chạm trần ${tranMs / 60_000} phút ở mẫu ${mau}, bài ${b.id}`;
        break ngoai;
      }
      const prompt = fs.readFileSync(`${b.dir}/prompt.md`, "utf8").trimEnd();
      const g = await goiModel(url, SYS, prompt, maxTokens);
      const tep = `${thoDir}/${b.id}-${mau}.txt`;
      fs.writeFileSync(tep, g.text);
      const c = await chamMaDon(b, tep);
      hang.push({ id: b.id, stack: b.stack, bo: b.bo, mau, dat: c.dat, lyDo: c.lyDo, cut: g.cut, tokRa: g.tokRa, ms: g.ms });
      console.error(`mẫu ${mau} ${b.stack}/${b.id} ${c.dat ? "ĐẠT" : "TRƯỢT"}${g.cut ? " CỤT" : ""} ${g.ms} ms`);
      if (!(await suKhoe(url))) throw new Vut(`llama-server chết sau ${b.id} mẫu ${mau}`);
    }
  }
  if (baiF.length && !dungSom) hang.push(...doAgentF(baiF, soMau, { ngay, noi: lay("--noi", "tai-cho"), agentConfig: lay("--agent-config", "agent") }));

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
    maxTokens,
    sampling: SAMPLING,
    giayTuong: Math.round((Date.now() - t0) / 1000),
    model: { tep: p.model ? p.model.split(/[\\/]/).pop() : null, sha, ctx: p.ctx, reasoningBudget: p.reasoningBudget, slot: p.slot },
    // Tên + giá trị cờ agent trong env của lượt đo: không phải bí mật. Khoá khác không vào báo cáo.
    co: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(AI_AGENT_|AI_AGENTIC_|AI_CODING_)[A-Z0-9_]+$/.test(k)).sort()),
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
