/**
 * ★★★ ĐỢT 4C — chạy bộ đo FIM TRỰC TIẾP trên GGUF qua node-llama-cpp (KHÔNG qua máy chủ :3000/:8091).
 *
 *   npx tsx scripts/ai-eval/fim/chay-fim.mts --model=Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf[,khac.gguf] \
 *       [--thu-muc=D:/SOURCES/16.AI] [--che-do=infill|van-ban] [--gioi-han=N] [--mau=mau-fim-2.jsonl]
 *   npx tsx scripts/ai-eval/fim/chay-fim.mts --thuoc=dapan|rong|qua-cat   # kiểm thước, không nạp model
 *
 * Đường mô phỏng ĐÚNG đường sản phẩm:
 *   thân yêu cầu = `dungThanYeuCauFim` của extension (che bí mật, trần token theo chế độ một/nhiều dòng, nhiệt độ 0)
 *   → sinh: `infill` = `LlamaCompletion.generateInfillCompletion` (đúng `generateFimNative` của aiGgufEngine, mỗi yêu
 *     cầu một sequence mới, cùng `customStopTriggers` FIM_STOP); `van-ban` = prompt chuẩn Qwen2.5-Coder
 *     `<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>` tokenize với special token (đối chứng hai đường cho cùng số)
 *   → `catGoiY` của extension → chấm (`chamFim.ts`).
 * Độ trễ = thời gian sinh của MỘT yêu cầu (model đã nạp sẵn, một lượt khởi động bỏ qua) — không gồm mạng/HTTP.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ghostTextMod from "../../../vscode-extension/src/loi/ghostText";
import { chamMot, tongHop, type KetQuaMot, type MauFim, type TongHop } from "./chamFim";

// vscode-extension/ là gói CJS ⇒ tsx đưa export vào `default` khi nhập từ ESM.
const { catGoiY, dungThanYeuCauFim, laCheDoMotDong } = ((ghostTextMod as { default?: typeof ghostTextMod }).default ??
  ghostTextMod) as typeof ghostTextMod;

const thamSo = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "1"] : [a, "1"];
  }),
);
const THU_MUC = thamSo["thu-muc"] ?? "D:/SOURCES/16.AI";
const CHE_DO = (thamSo["che-do"] ?? "infill") as "infill" | "van-ban";
const FIM_STOP = ["<|endoftext|>", "<|fim_pad|>", "<|file_sep|>", "<|repo_name|>"];

const mauDu: MauFim[] = readFileSync(join(import.meta.dirname, thamSo.mau ?? "mau-fim.jsonl"), "utf8")
  .split("\n")
  .filter((x) => x.trim())
  .map((x) => JSON.parse(x));
const mau = thamSo["gioi-han"] ? mauDu.slice(0, Number(thamSo["gioi-han"])) : mauDu;

function inBang(ten: string, t: TongHop, ds: KetQuaMot[]): void {
  const pc = (x: number) => `${(x * 100).toFixed(1)} %`;
  console.log(
    `\n== ${ten} (n=${t.n}) — dòng đầu ${pc(t.khopDongDau)} · toàn đoạn ${pc(t.khopToanDoan)} · tương tự ${pc(t.tuongTu)} · rỗng ${pc(t.tiLeRong)} · p50 ${t.p50} ms · p95 ${t.p95} ms`,
  );
  for (const [nhan, loc] of [
    ...(["giua-dong", "dong", "khoi"] as const).map((k) => [k, (x: KetQuaMot) => x.kieu === k] as const),
    ...(["ts", "js", "py", "cs"] as const).map((k) => [k, (x: KetQuaMot) => x.ngonNgu === k] as const),
  ]) {
    const c = tongHop(ds.filter(loc));
    console.log(`   ${nhan.padEnd(9)} n=${String(c.n).padStart(2)} dòng đầu ${pc(c.khopDongDau).padStart(7)} · toàn đoạn ${pc(c.khopToanDoan).padStart(7)} · tương tự ${pc(c.tuongTu).padStart(7)}`);
  }
}

const baoCao: Record<string, unknown> = { ngay: new Date().toISOString(), cheDo: CHE_DO, soMau: mau.length, ketQua: {} };

if (thamSo.thuoc) {
  // `qua-cat` = trần do LUẬT CẮT: model sinh ĐÚNG đáp án rồi chép tiếp hậu tố (ca xấu thực tế) ⇒ còn bao nhiêu % sau
  // `catGoiY`. Đây là trần trên của mọi model — thấp ⇒ lỗi ở luật cắt, không phải ở model.
  const ds = mau.map((m) =>
    chamMot(
      m,
      thamSo.thuoc === "dapan"
        ? m.dapAn
        : thamSo.thuoc === "qua-cat"
          ? catGoiY(m.dapAn + m.hauTo, { tienTo: m.tienTo, hauTo: m.hauTo, motDong: laCheDoMotDong(m.tienTo, m.hauTo) })
          : "",
      0,
    ),
  );
  inBang(`KIỂM THƯỚC — ${thamSo.thuoc}`, tongHop(ds), ds);
  process.exit(0);
}

const dsModel = String(thamSo.model ?? "").split(",").filter(Boolean);
if (!dsModel.length) {
  console.error("thiếu --model=<tệp.gguf>");
  process.exit(2);
}

const { getLlama, LlamaCompletion } = await import("node-llama-cpp");
const llama = await getLlama();
for (const tep of dsModel) {
  const model = await llama.loadModel({ modelPath: join(THU_MUC, tep), gpuLayers: "max" });
  const context = await model.createContext({ contextSize: 4096, sequences: 1 });
  const sinh = async (m: MauFim): Promise<{ tho: string; ms: number; motDong: boolean }> => {
    const motDong = laCheDoMotDong(m.tienTo, m.hauTo);
    const than = dungThanYeuCauFim({ tienTo: m.tienTo, hauTo: m.hauTo, motDong });
    const seq = context.getSequence();
    const cmp = new LlamaCompletion({ contextSequence: seq });
    const opts = { maxTokens: than.max_tokens, temperature: than.temperature, customStopTriggers: FIM_STOP };
    const t0 = performance.now();
    try {
      const tho =
        CHE_DO === "infill"
          ? await cmp.generateInfillCompletion(than.prompt, than.suffix, opts)
          : await cmp.generateCompletion(
              model.tokenize(`<|fim_prefix|>${than.prompt}<|fim_suffix|>${than.suffix}<|fim_middle|>`, true),
              opts,
            );
      return { tho, ms: Math.round(performance.now() - t0), motDong };
    } finally {
      cmp.dispose();
      seq.dispose();
    }
  };
  await sinh(mau[0]); // khởi động (CUDA graph/kernels) — không tính
  const ds: KetQuaMot[] = [];
  const chiTiet: Array<Record<string, unknown>> = [];
  for (const m of mau) {
    const { tho, ms, motDong } = await sinh(m);
    const goiY = catGoiY(tho, { tienTo: m.tienTo, hauTo: m.hauTo, motDong });
    const kq = chamMot(m, goiY, ms);
    ds.push(kq);
    chiTiet.push({ id: m.id, kieu: m.kieu, motDong, ms, dapAn: m.dapAn, goiY, tho, khopToanDoan: kq.khopToanDoan });
  }
  const t = tongHop(ds);
  inBang(`${tep} [${CHE_DO}]`, t, ds);
  (baoCao.ketQua as Record<string, unknown>)[tep] = { tongHop: t, chiTiet };
  await context.dispose();
  await model.dispose();
}
const thuMucBc = join(import.meta.dirname, "..", "reports");
mkdirSync(thuMucBc, { recursive: true });
const ra = join(thuMucBc, `fim-${CHE_DO}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`);
writeFileSync(ra, JSON.stringify(baoCao, null, 2), "utf8");
console.log(`\nbáo cáo → ${ra}`);
process.exit(0);
