/**
 * ĐO (a) mẫu #5: độ chính xác phân loại 48 phiếu bảo trì (bộ vàng `phieuBaoTri.vang.json`, 12 / nhóm) qua ĐÚNG node `ai.phan-loai` với tham số của mẫu
 * `phieu-bao-tri-phan-loai.json` (vai `classify` ⇒ 4B Instruct in-process theo binding; đường sản phẩm). KHÔNG chạy trong lưới thường — mở bằng LUONG_PL=1 và bộ env
 * bắt buộc của do-model (LLAMA_SERVER_ENABLED/FAIL_CLOSED/URL, GGUF_*). In ma trận nhầm + thời gian lượt lạnh/ấm + model thực (diemModel) + Δ prompt_tokens_total của :8091
 * (vai classify ⇒ 4B in-process ⇒ Δ phải = 0; > 0 nghĩa là sai đường). `LUONG_PL_VAI_TRO` ép vai khác (vd. chat ⇒ 35B) để đo THAM CHIẾU.
 * Không khẳng định ngưỡng — báo số thật (mục tiêu ≥ 90 %).
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { layNut, type NguCanhChay, type VetModel } from "../dangKyNut";
import "../nut";
import { diemModel } from "../nut/ai";

const AQUI = dirname(fileURLToPath(import.meta.url));
const vang = JSON.parse(readFileSync(join(AQUI, "phieuBaoTri.vang.json"), "utf8")) as Array<{ lyDo: string; nhan: string }>;
const mau = JSON.parse(readFileSync(join(AQUI, "..", "mau", "phieu-bao-tri-phan-loai.json"), "utf8")) as { nodes: Array<{ id: string; parameters: Record<string, unknown> }> };
const NHAN = ["dien", "co-khi", "plc-phan-mem", "vat-tu-khac"];

const tokenLlama = async (): Promise<number | null> => {
  try {
    const t = await (await fetch(`${process.env.LLAMA_SERVER_URL ?? "http://127.0.0.1:8091"}/metrics`)).text();
    const m = /^llamacpp:prompt_tokens_total\s+([0-9.e+]+)/m.exec(t);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
};

describe.skipIf(process.env.LUONG_PL !== "1")("(a) độ chính xác phân loại phiếu bảo trì", () => {
  it("48 phiếu qua ai.phan-loai: độ chính xác, ma trận nhầm, lượt lạnh/ấm, model thực", async () => {
    const tham = { ...mau.nodes.find((n) => n.id === "phan-loai")!.parameters };
    if (process.env.LUONG_PL_VAI_TRO) tham.vaiTro = process.env.LUONG_PL_VAI_TRO;
    const kb = layNut("ai.phan-loai")!;
    const vet: VetModel[] = [];
    const tok0 = await tokenLlama();
    const ma: Record<string, Record<string, number>> = Object.fromEntries(NHAN.map((n) => [n, Object.fromEntries([...NHAN, "khac"].map((m) => [m, 0]))]));
    const ms: number[] = [];
    const sai: string[] = [];
    let dung = 0;
    let limit = 0;
    for (const [i, p] of vang.entries()) {
      const item = { json: { lyDo: p.lyDo } };
      const ngu = {
        runId: `eval-${i}`, flowId: "eval", nodeId: "phan-loai", lan: 1, idempotencyKey: `eval-${i}`,
        inputs: { main: [item] }, nodes: {}, env: {}, run: { id: `eval-${i}`, flowId: "eval", batDau: new Date().toISOString() },
        ghiModel: (v: VetModel) => vet.push(v),
      } as unknown as NguCanhChay;
      let kq: { main: Array<{ json: { nhan: string } }> } | undefined;
      let t0 = Date.now();
      for (let lan = 0; lan < 20 && !kq; lan++) {
        t0 = Date.now();
        try {
          kq = (await kb.chay(tham, ngu)) as typeof kq;
        } catch (e) {
          if (!/rate limit/i.test(String((e as Error)?.message))) throw e; // Cổng AI giới hạn tốc độ theo người dùng/tầng ⇒ chờ rồi thử lại (thời gian chờ KHÔNG tính vào lượt)
          limit++;
          await new Promise((res) => setTimeout(res, 45_000));
        }
      }
      if (!kq) throw new Error("rate limit kéo dài");
      ms.push(Date.now() - t0);
      const nhan = kq.main[0].json.nhan;
      ma[p.nhan][nhan] = (ma[p.nhan][nhan] ?? 0) + 1;
      if (nhan === p.nhan) dung++;
      else sai.push(`[${p.nhan} → ${nhan}] ${p.lyDo}`);
    }
    const tok1 = await tokenLlama();
    const model = vet[0] ?? (await diemModel(String(tham.vaiTro ?? "classify"), { flowId: "eval", nodeId: "x" } as NguCanhChay));
    const sap = [...ms.slice(1)].sort((a, b) => a - b);
    console.log("[PL] vai trò:", tham.vaiTro, "· model thực:", model.model, "· nguồn:", model.nguon, "· dự phòng:", model.duPhong, "· khe bận:", model.kheBan);
    console.log(`[PL] chính xác: ${dung}/${vang.length} = ${((dung / vang.length) * 100).toFixed(1)} %`);
    console.log("[PL] ma trận nhầm (hàng = vàng, cột = đoán):");
    for (const n of NHAN) console.log(`[PL]   ${n.padEnd(13)} ${[...NHAN, "khac"].map((m) => `${m}:${ma[n][m]}`).join("  ")}`);
    console.log(`[PL] lượt lạnh (đầu): ${ms[0]} ms · ấm: p50 ${sap[Math.floor(sap.length / 2)]} ms, max ${sap[sap.length - 1]} ms`);
    console.log(`[PL] :8091 prompt_tokens_total Δ = ${tok0 === null || tok1 === null ? "?" : tok1 - tok0} (4B in-process ⇒ 0)`);
    console.log(`[PL] số lần bị giới hạn tốc độ của Cổng AI (chờ 45 s rồi thử lại): ${limit}`);
    console.log("[PL] sai:\n" + sai.map((s) => `[PL]   ${s}`).join("\n"));
    expect(ms.length).toBe(vang.length);
  }, 1_800_000);
});
