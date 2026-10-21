/**
 * ★★ Đợt 7 còn mở (3) — ĐO vai trò `extract` trên bộ MÙ `bo-mu-2026-10-21.json` (30 bài, 227 trường, đáp án tay).
 *   npx tsx --env-file=.env scripts/ai-eval/trich-xuat/do.mts --dich 4b        # GGUF_FAST_MODEL trong tiến trình (như gán hiện tại)
 *   npx tsx --env-file=.env scripts/ai-eval/trich-xuat/do.mts --dich nha [--nghi]  # model nhà qua :8091 (mặc định TẮT nghĩ)
 *   npx tsx scripts/ai-eval/trich-xuat/do.mts --kiem-thuoc                    # chấm đáp án với chính nó (=100 %) + đột biến (<100 %)
 * Cùng MỘT prompt cho mọi đích, nhiệt độ 0. Luật chấm: README.md cùng thư mục. Kết quả ghi tmp/trich-xuat-<dich>.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Truong = { ten: string; kieu: "chuoi" | "so" | "boolean" | "danh-sach"; batBuoc?: boolean; moTa: string };
type Bai = { id: string; vanBan: string; truong: Truong[]; dapAn: Record<string, unknown> };

const DIR = path.dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const bo = JSON.parse(fs.readFileSync(path.join(DIR, "bo-mu-2026-10-21.json"), "utf8")) as Bai[];

const gonChuoi = (s: string) => s.trim().replace(/\s+/g, " ");
function khopMot(kieu: "chuoi" | "so" | "boolean", khongPhanBietHoa: boolean, ra: unknown, dung: unknown): boolean {
  if (dung === null) return ra === null || ra === undefined;
  if (kieu === "so") {
    const n = typeof ra === "number" ? ra : typeof ra === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(ra) ? Number(ra) : NaN;
    return Number.isFinite(n) && Math.abs(n - Number(dung)) < 1e-9;
  }
  if (kieu === "boolean") return ra === dung;
  if (typeof ra !== "string" && typeof ra !== "number") return false;
  const a = gonChuoi(String(ra)), b = gonChuoi(String(dung));
  return khongPhanBietHoa ? a.toLowerCase() === b.toLowerCase() : a === b;
}
export function chamTruong(t: Truong, ra: unknown, dung: unknown): boolean {
  const kpb = /không phân biệt hoa/i.test(t.moTa);
  if (t.kieu !== "danh-sach") return khopMot(t.kieu, kpb, ra, dung);
  if (dung === null) return ra === null || ra === undefined;
  if (!Array.isArray(ra) || !Array.isArray(dung) || ra.length !== dung.length) return false;
  return dung.every((d, i) => khopMot(typeof d === "number" ? "so" : "chuoi", kpb, ra[i], d));
}
export function chamBai(b: Bai, ra: Record<string, unknown> | null) {
  const sai: string[] = [];
  let dung = 0;
  for (const t of b.truong) {
    if (chamTruong(t, ra?.[t.ten] ?? null, b.dapAn[t.ten] ?? null)) dung++;
    else sai.push(`${t.ten}: ra ${JSON.stringify(ra?.[t.ten] ?? null)} ≠ ${JSON.stringify(b.dapAn[t.ten] ?? null)}`);
  }
  return { dung, tong: b.truong.length, sai };
}

const MO_TA_KIEU = { chuoi: "chuỗi", so: "số (JSON number, không kèm đơn vị)", boolean: "true/false", "danh-sach": "mảng JSON" };
const HE_THONG = "Bạn là bộ trích xuất thông tin từ văn bản nhà máy. Chỉ trả về MỘT đối tượng JSON, không giải thích, không thêm khoá.";
const nhacBai = (b: Bai) =>
  `Trích các trường sau từ văn bản. Trường không có thông tin trong văn bản ⇒ null (không được đoán).\nTrường:\n` +
  b.truong.map((t) => `- ${t.ten} (${MO_TA_KIEU[t.kieu]}${t.batBuoc ? ", bắt buộc" : ""}): ${t.moTa}`).join("\n") +
  `\n\nVăn bản:\n"""\n${b.vanBan}\n"""`;
function docJson(text: string): Record<string, unknown> | null {
  const s = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j < i) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    return null;
  }
}

if (process.argv.includes("--kiem-thuoc")) {
  let ok = true;
  for (const b of bo) {
    const r = chamBai(b, b.dapAn);
    if (r.dung !== r.tong) { ok = false; console.error(`✗ ${b.id} đáp án tự chấm ${r.dung}/${r.tong}: ${r.sai.join("; ")}`); }
    const dot = Object.fromEntries(Object.entries(b.dapAn).map(([k, v]) => [k, v === null ? "bịa" : Array.isArray(v) ? v.slice(1) : typeof v === "number" ? v + 1 : typeof v === "boolean" ? !v : v + "x"]));
    const d = chamBai(b, dot);
    if (d.dung !== 0) { ok = false; console.error(`✗ ${b.id} đột biến mọi trường vẫn đúng ${d.dung}: ${b.truong.filter((t) => !d.sai.some((s) => s.startsWith(t.ten + ":"))).map((t) => t.ten)}`); }
  }
  console.log(ok ? `thước ĐẠT: ${bo.length} bài, đáp án = 100 %, đột biến mọi trường = 0` : "thước HỎNG");
  process.exit(ok ? 0 : 1);
}

const DICH = arg("--dich", "4b");
const NGHI = process.argv.includes("--nghi");
let hoi: (b: Bai) => Promise<{ text: string; ms: number }>;
let donDep = async () => {};
if (DICH === "4b") {
  const MODEL = path.join(process.env.GGUF_MODELS_DIR || "D:/SOURCES/16.AI", process.env.GGUF_FAST_MODEL || "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf");
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: MODEL });
  const ctx = await model.createContext({ contextSize: 8192 });
  hoi = async (b) => {
    const t0 = Date.now();
    const seq = ctx.getSequence();
    const s = new LlamaChatSession({ contextSequence: seq, systemPrompt: HE_THONG });
    const text = await s.prompt(nhacBai(b), { temperature: 0, maxTokens: 2000 });
    s.dispose();
    seq.dispose();
    return { text, ms: Date.now() - t0 };
  };
  donDep = async () => { await ctx.dispose(); await model.dispose(); };
} else {
  const url = arg("--url", "http://127.0.0.1:8091/v1/chat/completions");
  hoi = async (b) => {
    const t0 = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "system", content: HE_THONG }, { role: "user", content: nhacBai(b) }],
        temperature: 0, max_tokens: NGHI ? 12000 : 2000,
        ...(NGHI ? {} : { chat_template_kwargs: { enable_thinking: false } }),
      }),
    });
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { text: j.choices?.[0]?.message?.content ?? "", ms: Date.now() - t0 };
  };
}

let dung = 0, tong = 0, baiTron = 0, khongJson = 0;
const ms: number[] = [], chiTiet: unknown[] = [];
for (const b of bo) {
  const { text, ms: t } = await hoi(b);
  const ra = docJson(text);
  if (!ra) khongJson++;
  const r = chamBai(b, ra);
  dung += r.dung; tong += r.tong; ms.push(t);
  if (r.dung === r.tong) baiTron++;
  console.log(`${r.dung === r.tong ? "ĐẠT " : "    "} ${b.id} ${r.dung}/${r.tong} · ${t} ms${r.sai.length ? "\n      " + r.sai.join("\n      ") : ""}`);
  chiTiet.push({ id: b.id, dung: r.dung, tong: r.tong, sai: r.sai, text });
}
ms.sort((a, b) => a - b);
const nhan = DICH === "4b" ? "4b" : NGHI ? "nha-nghi" : "nha";
console.log(`\n══ extract đích ${nhan}: trường ${dung}/${tong} = ${Math.round((100 * dung) / tong)} % · bài trọn ${baiTron}/${bo.length} · không ra JSON ${khongJson} · trung vị ${ms[ms.length >> 1]} ms ══`);
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync(`tmp/trich-xuat-${nhan}.json`, JSON.stringify({ dich: nhan, dung, tong, baiTron, khongJson, chiTiet }, null, 1));
await donDep();
