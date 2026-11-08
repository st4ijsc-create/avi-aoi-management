#!/usr/bin/env node
/**
 * D5 (kế hoạch cải tiến Thợ Cả, UX-D07): kiểm máy chạy AI Local, chia "Phải sửa" / "Nên sửa". Chỉ đọc: không khởi động, không gọi sinh chữ, không
 * ghi gì ngoài tệp cache băm model.
 *
 *   node scripts/ai/kiem-he-thong.mjs [--json] [--sha] [--env <tệp .env>] [--url http://127.0.0.1:8091]
 *
 * Thoát 0 = không có "Phải sửa" · 1 = có "Phải sửa" · 2 = chính script hỏng.
 * `--sha` băm tệp model (22 GB, cỡ một phút) và lưu cache theo đường + cỡ + mtime; không có cờ thì chỉ dùng cache, để chạy lúc boot không chờ.
 * Từ .env chỉ đọc các khoá trong KHOA_ENV. Không in dòng lệnh thô: có thể chứa khoá API.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Trần VRAM đỉnh của kế hoạch (M12, §5). Kế hoạch viết 27 157 MiB là "27,2 GB" nên 30,5 GB = 30 500 MiB. */
export const TRAN_VRAM_MIB = 30_500;
/** Đo nền Đợt 11.0 (`9de9aa2fd`, có mmproj, Qwen3.6-35B-A3B Q4 KV f16): VRAM đỉnh theo ctx. */
const MOC_VRAM = [
  [65_536, 27_157],
  [98_304, 27_825],
  [131_072, 28_497],
];
/** VRAM dự kiến theo ctx, nội suy tuyến tính trên các mốc đo (ngoài dải: kéo dài đoạn cuối). Chỉ đúng với model đã đo. */
export function vramDuKienMib(ctx) {
  const [[x0, y0], , [x1, y1]] = MOC_VRAM;
  return Math.round(y0 + ((ctx - x0) * (y1 - y0)) / (x1 - x0));
}

/** Tách tham số llama-server từ dòng lệnh. Chỉ giữ trường cần, KHÔNG giữ giá trị khoá API. */
export function tachDongLenh(cmd) {
  const lay = (...ten) => {
    for (const t of ten) {
      const m = cmd.match(new RegExp(`(?:^|\\s)${t}[\\s=]+("[^"]+"|\\S+)`));
      if (m) return m[1].replace(/^"|"$/g, "");
    }
    return null;
  };
  const so = (v) => (v === null ? null : Number(v));
  return {
    model: lay("-m", "--model"),
    mmproj: lay("-mm", "--mmproj"),
    host: lay("--host"),
    port: so(lay("--port")),
    ctx: so(lay("-c", "--ctx-size")),
    slot: so(lay("-np", "--parallel")),
    reasoningBudget: so(lay("--reasoning-budget")),
    coKhoaApi: /(?:^|\s)--api-key(?:-file)?[\s=]/.test(cmd),
    coAlias: /(?:^|\s)(?:-a|--alias)[\s=]/.test(cmd),
  };
}

/** Đọc các khoá được phép từ nội dung .env. */
export const KHOA_ENV = ["LLAMA_SERVER_MODEL", "LLAMA_SERVER_CTX_TOTAL", "LLAMA_SERVER_REASONING_BUDGET", "LLAMA_SERVER_URL"];
export function docEnv(noiDung) {
  const ra = {};
  for (const k of KHOA_ENV) {
    const m = noiDung.match(new RegExp(`^${k}=(.*)$`, "m"));
    if (m) ra[k] = m[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  }
  return ra;
}

const tenTep = (p) => (p ? p.split(/[\\/]/).pop() : p);

/**
 * Luật, hàm thuần. `t`: { gpu: [{ten, driver, tongMib, dungMib}] | null, health: số | null, tienTrinh: [dòng lệnh đã tách], env: {...} | null,
 * tepModel: { ton, byte } | null, sha: { giaTri, doiSoVoiCu } | null }.
 * Trả danh sách { muc: "phai-sua"|"nen-sua"|"tot", ma, chiTiet }.
 */
export function danhGia(t) {
  const ra = [];
  const them = (muc, ma, chiTiet) => ra.push({ muc, ma, chiTiet });

  if (!t.gpu?.length) them("phai-sua", "GPU", "nvidia-smi không chạy được hoặc không thấy GPU");
  else {
    for (const g of t.gpu) them("tot", "GPU", `${g.ten}, driver ${g.driver}, VRAM ${g.dungMib}/${g.tongMib} MiB`);
    // Broker VRAM đọc GPU 0 và không ghim thiết bị (kế hoạch §1.1 L0): chưa sẵn sàng 2 card.
    if (t.gpu.length > 1) them("nen-sua", "NHIEU_GPU", `${t.gpu.length} GPU, broker VRAM mới đọc GPU 0 (việc D6)`);
  }

  const llama = t.tienTrinh?.find((p) => p.port === 8091) ?? t.tienTrinh?.[0] ?? null;
  const song = t.health === 200;
  if (!song) them("phai-sua", "CONG_8091", t.health === null ? "/health không trả lời" : `/health trả ${t.health}`);
  else them("tot", "CONG_8091", "/health 200");

  if (song && !llama) them("nen-sua", "DONG_LENH", "/health sống nhưng không đọc được dòng lệnh llama-server");
  if (llama) {
    const ngoai = llama.host === null ? false : !["127.0.0.1", "localhost", "::1"].includes(llama.host);
    if (ngoai) them("phai-sua", "BIND", `llama-server bind ${llama.host}, chỉ được 127.0.0.1 (KH Ch.7)`);
    if (!llama.coKhoaApi) them("nen-sua", "KHOA_API", "llama-server chưa có --api-key-file (việc F5)");
    if (!llama.coAlias) them("nen-sua", "ALIAS", "llama-server chưa có --alias (việc D1)");
    if (llama.ctx) {
      const duKien = vramDuKienMib(llama.ctx);
      if (duKien > TRAN_VRAM_MIB) them("phai-sua", "CTX_VRAM", `ctx ${llama.ctx} dự kiến ${duKien} MiB, vượt trần ${TRAN_VRAM_MIB} MiB`);
      else them("tot", "CTX_VRAM", `ctx ${llama.ctx} dự kiến ${duKien} MiB, trần ${TRAN_VRAM_MIB} MiB`);
    }
  }
  if (!song && t.gpu?.length && t.env?.LLAMA_SERVER_CTX_TOTAL) {
    // Model chưa nạp: VRAM trống phải đủ cho ctx đã khai.
    const can = vramDuKienMib(Number(t.env.LLAMA_SERVER_CTX_TOTAL));
    const trong = t.gpu[0].tongMib - t.gpu[0].dungMib;
    if (trong < can) them("phai-sua", "VRAM_TRONG", `GPU 0 trống ${trong} MiB, ctx đã khai cần ${can} MiB`);
  }

  if (t.tepModel && !t.tepModel.ton) them("phai-sua", "TEP_MODEL", `không thấy tệp model ${t.tepModel.ten}`);
  if (t.tepModel?.ton) them("tot", "TEP_MODEL", `${t.tepModel.ten}, ${t.tepModel.byte} byte`);
  if (t.sha?.giaTri) them(t.sha.doiSoVoiCu ? "nen-sua" : "tot", "SHA_MODEL", `${t.sha.giaTri}${t.sha.doiSoVoiCu ? ", KHÁC lần băm trước" : ""}`);
  else if (t.tepModel?.ton) them("nen-sua", "SHA_MODEL", "chưa có băm (chạy với --sha)");

  if (llama && t.env) {
    const khac = [];
    if (t.env.LLAMA_SERVER_MODEL && llama.model && tenTep(t.env.LLAMA_SERVER_MODEL) !== tenTep(llama.model)) khac.push(`model .env ${tenTep(t.env.LLAMA_SERVER_MODEL)}, đang chạy ${tenTep(llama.model)}`);
    if (t.env.LLAMA_SERVER_CTX_TOTAL && llama.ctx && Number(t.env.LLAMA_SERVER_CTX_TOTAL) !== llama.ctx) khac.push(`ctx .env ${t.env.LLAMA_SERVER_CTX_TOTAL}, đang chạy ${llama.ctx}`);
    if (t.env.LLAMA_SERVER_REASONING_BUDGET && llama.reasoningBudget !== null && Number(t.env.LLAMA_SERVER_REASONING_BUDGET) !== llama.reasoningBudget) khac.push(`budget .env ${t.env.LLAMA_SERVER_REASONING_BUDGET}, đang chạy ${llama.reasoningBudget}`);
    if (khac.length) them("nen-sua", "LECH_ENV", khac.join("; "));
    else them("tot", "LECH_ENV", "dòng lệnh khớp .env");
  }
  return ra;
}

// ─── đọc máy ───────────────────────────────────────────────────────────────────────────────────

function docGpu() {
  const r = spawnSync("nvidia-smi", ["--query-gpu=name,driver_version,memory.total,memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
  if (r.status !== 0) return null;
  return r.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => {
    const [ten, driver, tong, dung] = l.split(",").map((x) => x.trim());
    return { ten, driver, tongMib: Number(tong), dungMib: Number(dung) };
  });
}

export function docTienTrinh() {
  if (process.platform !== "win32") return [];
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(tachDongLenh);
}

async function docHealth(url) {
  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) })).status;
  } catch {
    return null;
  }
}

const TEP_CACHE = path.join(os.homedir(), ".cache", "ai-local", "sha-model.json");
function docCacheSha() {
  try {
    return JSON.parse(fs.readFileSync(TEP_CACHE, "utf8"));
  } catch {
    return {};
  }
}

async function bamTep(p) {
  const h = crypto.createHash("sha256");
  for await (const c of fs.createReadStream(p, { highWaterMark: 1 << 24 })) h.update(c);
  return h.digest("hex");
}

/** Băm có cache theo đường + cỡ + mtime. Trả null khi chưa có và không được phép băm. */
export async function layBam(p, st, duocBam) {
  const cache = docCacheSha();
  const c = cache[p];
  const khop = c && c.byte === st.size && c.mtimeMs === st.mtimeMs;
  if (khop && !duocBam) return { giaTri: c.sha, doiSoVoiCu: false };
  if (!duocBam) return c ? { giaTri: null } : null;
  const sha = await bamTep(p);
  const doiSoVoiCu = !!c && c.sha !== sha;
  fs.mkdirSync(path.dirname(TEP_CACHE), { recursive: true });
  fs.writeFileSync(TEP_CACHE, JSON.stringify({ ...cache, [p]: { sha, byte: st.size, mtimeMs: st.mtimeMs } }, null, 1));
  return { giaTri: sha, doiSoVoiCu };
}

async function main() {
  const a = process.argv.slice(2);
  const lay = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const goc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const tepEnv = lay("--env", path.join(goc, ".env"));
  const env = fs.existsSync(tepEnv) ? docEnv(fs.readFileSync(tepEnv, "utf8")) : null;
  const url = lay("--url", env?.LLAMA_SERVER_URL || "http://127.0.0.1:8091").replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const tienTrinh = docTienTrinh();
  const duongModel = tienTrinh.find((p) => p.port === 8091)?.model ?? tienTrinh[0]?.model ?? null;
  let tepModel = null;
  let sha = null;
  if (duongModel) {
    const st = fs.existsSync(duongModel) ? fs.statSync(duongModel) : null;
    tepModel = { ten: tenTep(duongModel), ton: !!st, byte: st?.size ?? null };
    if (st) sha = await layBam(duongModel, st, a.includes("--sha"));
  }
  const ds = danhGia({ gpu: docGpu(), health: await docHealth(url), tienTrinh, env, tepModel, sha });
  const dem = (m) => ds.filter((d) => d.muc === m);
  if (a.includes("--json")) console.log(JSON.stringify({ phaiSua: dem("phai-sua").length, nenSua: dem("nen-sua").length, ketQua: ds }, null, 1));
  else {
    for (const [m, nhan] of [["phai-sua", "PHẢI SỬA"], ["nen-sua", "NÊN SỬA"], ["tot", "TỐT"]]) {
      if (!dem(m).length) continue;
      console.log(`${nhan}:`);
      for (const d of dem(m)) console.log(`  ${d.ma}: ${d.chiTiet}`);
    }
  }
  return dem("phai-sua").length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((m) => process.exit(m), (e) => {
    console.error(`kiem-he-thong: ${e?.message ?? e}`);
    process.exit(2);
  });
}
