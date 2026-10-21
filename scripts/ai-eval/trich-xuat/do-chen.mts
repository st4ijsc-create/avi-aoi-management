/**
 * ★★ Đợt 9 (c2)(c3) — ĐO SỰ CHEN khi vai trò `extract` của Luồng chạy NỀN trên model nhà (:8091, MỘT slot):
 *   (c3) một lượt sinh mã `code.*` lên :8091 chậm thêm bao nhiêu khi có K vòng extract nền xếp trước nó;
 *   (c2) một câu ngắn trên 4B TRONG TIẾN TRÌNH (đường chat.ops) chậm thêm bao nhiêu khi :8091 đang bận extract (chung GPU).
 *   npx tsx --env-file=.env scripts/ai-eval/trich-xuat/do-chen.mts [--pha c2|c3|ca-hai] [--k 1] [--lap 2] [--url …]
 * Mỗi pha: A = một mình · B = có K vòng extract nền chạy liên tục (bài trong bo-mu-2026-10-21.json, TẮT nghĩ, như Luồng).
 * Lời nhắc mã: 6 câu cố định, TẮT nghĩ, nhiệt độ 0, trần 1500 token — để phần CHỜ (thứ cần đo) không bị nhiễu bởi độ dài suy
 * luận; ghi rõ trong báo cáo. Kết quả: tmp/do-chen-<nhãn>.json. ⚠ Nạp Qwen3-4B (~3 GB VRAM) trong tiến trình cho (c2).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Truong = { ten: string; kieu: "chuoi" | "so" | "boolean" | "danh-sach"; batBuoc?: boolean; moTa: string };
type Bai = { id: string; vanBan: string; truong: Truong[] };
const DIR = path.dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PHA = arg("--pha", "ca-hai");
const K = Math.max(1, Number(arg("--k", "1")));
const LAP = Math.max(1, Number(arg("--lap", "2")));
const URL_CHAT = arg("--url", "http://127.0.0.1:8091/v1/chat/completions");
const bo = JSON.parse(fs.readFileSync(path.join(DIR, "bo-mu-2026-10-21.json"), "utf8")) as Bai[];

// Bản chép lời nhắc của do.mts (giữ đồng bộ nếu do.mts đổi).
const MO_TA_KIEU = { chuoi: "chuỗi", so: "số (JSON number, không kèm đơn vị)", boolean: "true/false", "danh-sach": "mảng JSON" };
const HE_THONG = "Bạn là bộ trích xuất thông tin từ văn bản nhà máy. Chỉ trả về MỘT đối tượng JSON, không giải thích, không thêm khoá.";
const nhacBai = (b: Bai) =>
  `Trích các trường sau từ văn bản. Trường không có thông tin trong văn bản ⇒ null (không được đoán).\nTrường:\n` +
  b.truong.map((t) => `- ${t.ten} (${MO_TA_KIEU[t.kieu]}${t.batBuoc ? ", bắt buộc" : ""}): ${t.moTa}`).join("\n") +
  `\n\nVăn bản:\n"""\n${b.vanBan}\n"""`;

const CAU_MA = [
  "Viết hàm TypeScript `tinhOee(khaDung: number, hieuSuat: number, chatLuong: number): number` trả OEE (tích ba tỉ lệ 0..1), ném lỗi nếu đầu vào ngoài [0,1]. Chỉ trả mã.",
  "Viết hàm Python `gom_theo_ca(ban_ghi)` nhận danh sách dict {thoi_gian: datetime, so_loi: int}, trả dict {ca: tổng lỗi} với ca sáng 6–14h, chiều 14–22h, đêm còn lại. Chỉ trả mã.",
  "Viết câu SQL PostgreSQL: từ bảng defects(id, line_id, created_at, code) đếm số lỗi theo line_id và theo ngày trong 7 ngày gần nhất, sắp giảm dần. Chỉ trả SQL.",
  "Viết hàm C# `static int[] TopK(int[] a, int k)` trả k phần tử lớn nhất theo thứ tự giảm dần, O(n log k). Chỉ trả mã.",
  "Viết hàm JavaScript `debounce(fn, ms)` trả hàm đã chống dội, có phương thức `.cancel()`. Chỉ trả mã.",
  "Viết hàm Go `func ChuanHoaMaLo(s string) (string, error)` chuẩn hoá mã lô dạng `lot-2026-0042` thành `LOT-2026-0042`, lỗi nếu sai khuôn. Chỉ trả mã.",
];

async function goi(heThong: string, nguoiDung: string, maxTokens: number): Promise<number> {
  const t0 = Date.now();
  const res = await fetch(URL_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "system", content: heThong }, { role: "user", content: nguoiDung }],
      temperature: 0, max_tokens: maxTokens, chat_template_kwargs: { enable_thinking: false },
    }),
  });
  await res.json();
  return Date.now() - t0;
}

/** K vòng extract nền chạy liên tục tới khi `dung()` — đếm số lượt xong. */
function chayNen(k: number) {
  let dung = false;
  const msNen: number[] = [];
  const vong = Array.from({ length: k }, async (_, v) => {
    for (let i = v; !dung; i++) msNen.push(await goi(HE_THONG, nhacBai(bo[i % bo.length]), 2000));
  });
  return { msNen, dung: async () => { dung = true; await Promise.all(vong); } };
}
const tv = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ket: Record<string, unknown> = { luc: new Date().toISOString(), k: K, lap: LAP, url: URL_CHAT };
try {
  const u = new URL(URL_CHAT);
  const m = (await (await fetch(`${u.origin}/v1/models`)).json()) as { data?: { id?: string }[] };
  ket.model8091 = String(m.data?.[0]?.id ?? "?").split(/[\\/]/).pop();
} catch { ket.model8091 = "?"; }
console.log(`model :8091 = ${ket.model8091} · K = ${K} vòng extract nền · lặp ${LAP}`);

if (PHA === "c3" || PHA === "ca-hai") {
  const mot: number[] = [], chen: number[] = [];
  for (let l = 0; l < LAP; l++) for (const c of CAU_MA) mot.push(await goi("Bạn là trợ lý lập trình.", c, 1500));
  const nen = chayNen(K);
  await ngu(3000);
  for (let l = 0; l < LAP; l++) for (const c of CAU_MA) { await ngu(Math.random() * 1500); chen.push(await goi("Bạn là trợ lý lập trình.", c, 1500)); }
  await nen.dung();
  const them = mot.map((x, i) => chen[i] - x);
  ket.c3 = { motMinh: mot, coNen: chen, trungViMotMinh: tv(mot), trungViCoNen: tv(chen), trungViThem: tv(them), maxThem: Math.max(...them), extractNen: { soLuot: nen.msNen.length, trungVi: tv(nen.msNen) } };
  console.log(`(c3) code.* trên :8091: một mình trung vị ${tv(mot)} ms · có ${K} extract nền ${tv(chen)} ms · CHẬM THÊM trung vị ${tv(them)} ms (max ${Math.max(...them)}) · extract nền ${nen.msNen.length} lượt, trung vị ${tv(nen.msNen)} ms`);
}

if (PHA === "c2" || PHA === "ca-hai") {
  const MODEL = path.join(process.env.GGUF_MODELS_DIR || "D:/SOURCES/16.AI", process.env.GGUF_FAST_MODEL || "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf");
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: MODEL });
  const ctx = await model.createContext({ contextSize: 8192 });
  const hoi4b = async (b: Bai) => {
    const t0 = Date.now();
    const seq = ctx.getSequence();
    const s = new LlamaChatSession({ contextSequence: seq, systemPrompt: HE_THONG });
    await s.prompt(nhacBai(b), { temperature: 0, maxTokens: 600 });
    s.dispose();
    seq.dispose();
    return Date.now() - t0;
  };
  const DS = bo.slice(0, 10);
  await hoi4b(DS[0]); // khởi động (không tính)
  const mot: number[] = [], chen: number[] = [];
  for (const b of DS) mot.push(await hoi4b(b));
  const nen = chayNen(K);
  await ngu(3000);
  for (const b of DS) chen.push(await hoi4b(b));
  await nen.dung();
  await ctx.dispose();
  await model.dispose();
  const them = mot.map((x, i) => chen[i] - x);
  ket.c2 = { model: path.basename(MODEL), motMinh: mot, coNen: chen, trungViMotMinh: tv(mot), trungViCoNen: tv(chen), trungViThem: tv(them), extractNen: { soLuot: nen.msNen.length, trungVi: tv(nen.msNen) } };
  console.log(`(c2) 4B trong tiến trình (chat.ops): một mình trung vị ${tv(mot)} ms · khi :8091 bận extract ${tv(chen)} ms · CHẬM THÊM trung vị ${tv(them)} ms · extract nền ${nen.msNen.length} lượt`);
}

fs.mkdirSync("tmp", { recursive: true });
const tep = `tmp/do-chen-${arg("--nhan", `k${K}`)}.json`;
fs.writeFileSync(tep, JSON.stringify(ket, null, 1));
console.log(`ghi ${tep}`);
