/**
 * ★★★ Lô B7-E — chạy MỌI kịch bản `kichBan/*.json` bằng động cơ thật (`_test`) + kiểm chính BỘ CHẠY (bắt kỳ vọng sai, so tập con, AI ngoài kịch bản).
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray, like, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { batDauRun, chayMotMuc, luuPhienBan, traLoiCho } from "../dongCo";
import { datHamGoiAi, type HamGoiAi } from "../nut/ai";
import type { LogprobToken } from "../../ai/logprobDau";

const TT = `t9kb${Math.floor(Math.random() * 1e5)}`;
const AQUI = dirname(fileURLToPath(import.meta.url));

// ═══ BỘ CHẠY KỊCH BẢN (nằm TRONG tệp test: không phải mã sản phẩm ⇒ census cửa-vào-lượt / quyền duyệt không thấy) ═══
/*
 * ★★★ Lô B7-E (dieu-phoi duyệt) — BỘ THỬ LUỒNG chạy CI cục bộ (spec §4.8): kịch bản JSON {luồng hoặc mẫu, item vào, AI giả, trả lời chờ duyệt, kỳ vọng theo bước / trạng thái lượt} chạy bằng ĐỘNG CƠ THẬT trên `_test`.
 * Không gọi model thật, không mạng. Kịch bản KHÔNG thay `ai.giam-khao` (hoãn): ở đây AI là hàm giả tất định nên kỳ vọng kiểm LUỒNG (rẽ nhánh, ngưỡng, duyệt, tham số), không kiểm chất lượng model.
 *
 * Định dạng (xem `kichBan/README.md`):
 *   { ten, luong | mau, thayNut?, ghiDeThamSo?, items?, ai?, duyet?, tuaGio?, kyVong }
 *   thayNut      { "<nodeId>": { type, parameters, … } } — THAY node (vd node tác dụng phụ bằng `du-lieu.dat` đánh dấu); cổng nối giữ nguyên
 *   ghiDeThamSo  { "<nodeId>": { …tham số gộp vào… } }
 *   ai           [{ khop: "<regex trên phần DỮ LIỆU của lời nhắc>", tra: "<văn bản>", tinCay?: 0..1 }] — luật ĐẦU TIÊN khớp thắng; không luật nào khớp ⇒ lỗi rõ (AI không được gọi ngoài kịch bản)
 *   duyet        [{ nodeId, cong, them? }] — trả lời hàng chờ theo thứ tự khi lượt dừng chờ
 *   tuaGio       true ⇒ coi mọi hẹn giờ (logic.cho) là đã tới hạn
 *   kyVong       { trangThai?, loi?: {ma?}, khongChay?: [nodeId], soLanGoiAi?, buoc?: { "<nodeId>": { trangThai?, dauVao?, dauRa?, soLan? } } }  — dauVao/dauRa là TẬP CON (so sánh sâu; mảng khớp độ dài và từng phần tử)
 */

interface LuatAi {
  khop: string;
  tra: string;
  tinCay?: number;
}
interface KichBan {
  ten: string;
  luong?: Record<string, unknown>;
  mau?: string;
  thayNut?: Record<string, Record<string, unknown>>;
  ghiDeThamSo?: Record<string, Record<string, unknown>>;
  items?: Array<{ json: Record<string, unknown> }>;
  ai?: LuatAi[];
  duyet?: Array<{ nodeId: string; cong: string; them?: Record<string, unknown> }>;
  tuaGio?: boolean;
  kyVong: {
    trangThai?: string;
    loi?: { ma?: string };
    khongChay?: string[];
    soLanGoiAi?: number;
    buoc?: Record<string, { trangThai?: string; dauVao?: unknown; dauRa?: unknown; soLan?: number }>;
  };
}
interface KetQuaKichBan {
  ten: string;
  dat: boolean;
  sai: string[];
  trangThai: string;
  soLanGoiAi: number;
}

/** So sánh TẬP CON sâu: đối tượng ⊇, mảng khớp độ dài + từng phần tử, nguyên thuỷ bằng nhau. Trả đường dẫn lệch đầu tiên hoặc null. */
function lechTapCon(thuc: unknown, kyVong: unknown, duongDan = "$"): string | null {
  if (kyVong === null || typeof kyVong !== "object") return Object.is(thuc, kyVong) || thuc === kyVong ? null : `${duongDan}: thực ${JSON.stringify(thuc)} ≠ kỳ vọng ${JSON.stringify(kyVong)}`;
  if (Array.isArray(kyVong)) {
    if (!Array.isArray(thuc)) return `${duongDan}: thực không phải mảng`;
    if (thuc.length !== kyVong.length) return `${duongDan}: độ dài thực ${thuc.length} ≠ kỳ vọng ${kyVong.length}`;
    for (let i = 0; i < kyVong.length; i++) {
      const l = lechTapCon(thuc[i], kyVong[i], `${duongDan}[${i}]`);
      if (l) return l;
    }
    return null;
  }
  if (thuc === null || typeof thuc !== "object" || Array.isArray(thuc)) return `${duongDan}: thực không phải đối tượng`;
  for (const [k, v] of Object.entries(kyVong as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(thuc, k)) return `${duongDan}.${k}: thực THIẾU khoá`;
    const l = lechTapCon((thuc as Record<string, unknown>)[k], v, `${duongDan}.${k}`);
    if (l) return l;
  }
  return null;
}

function docKichBan(tenTep: string): KichBan {
  return JSON.parse(readFileSync(join(AQUI, tenTep), "utf8")) as KichBan;
}
function docMau(tenTep: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(AQUI, "..", "mau", tenTep), "utf8")) as Record<string, unknown>;
}

/** AI giả theo luật kịch bản; đếm số lần gọi. Phần DỮ LIỆU = nội dung giữa <du_lieu> … </du_lieu> (lời nhắc hướng dẫn có thể chứa từ khoá làm nhiễu). */
function aiGia(luat: LuatAi[], dem: { n: number }): HamGoiAi {
  return async (y) => {
    dem.n++;
    const du = /<du_lieu>([\s\S]*?)<\/du_lieu>/.exec(y.nguoiDung)?.[1] ?? y.nguoiDung;
    const l = luat.find((x) => new RegExp(x.khop, "i").test(du));
    if (!l) throw new Error(`kịch bản: không có luật AI khớp dữ liệu «${du.slice(0, 120)}» (AI không được gọi ngoài kịch bản)`);
    if (l.tinCay !== undefined && y.baoLogprobs) {
      const tok = l.tra.trim().slice(0, 3);
      const lp: LogprobToken[] = [{ token: tok, logprob: Math.log(Math.max(l.tinCay, 1e-9)), top: [{ token: tok, logprob: Math.log(Math.max(l.tinCay, 1e-9)) }] }];
      y.baoLogprobs(lp);
    }
    return l.tra;
  };
}

/**
 * Chạy MỘT kịch bản bằng động cơ thật. `chu` = id người dùng test (chủ lượt); `tienTo` = tiền tố id luồng duy nhất (cô lập worker + dọn dữ liệu).
 * Không ném khi kỳ vọng lệch — trả `sai[]` (test gọi quyết định); ném khi kịch bản không chạy được (định nghĩa luồng sai…).
 */
async function chayKichBan(kb: KichBan, chu: number, tienTo: string): Promise<KetQuaKichBan> {
  const db = (await getDb())!;
  const goc = (kb.luong ?? (kb.mau ? docMau(kb.mau) : null)) as Record<string, unknown> | null;
  if (!goc) throw new Error(`kịch bản «${kb.ten}»: cần luong hoặc mau`);
  const id = `${tienTo}-${kb.ten.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)}`.slice(0, 60);
  const def = JSON.parse(JSON.stringify(goc)) as { id: string; settings?: Record<string, unknown>; nodes: Array<Record<string, unknown> & { id: string; parameters?: Record<string, unknown> }> };
  def.id = id;
  def.settings = { ...(def.settings ?? {}), maxConcurrentRuns: 50 };
  def.nodes = def.nodes.map((n) => {
    const thay = kb.thayNut?.[n.id];
    const moi = thay ? { ...n, ...thay, id: n.id } : n;
    const de = kb.ghiDeThamSo?.[n.id];
    return de ? { ...moi, parameters: { ...(moi.parameters ?? {}), ...de } } : moi;
  });
  await luuPhienBan(def, chu, null);
  const dem = { n: 0 };
  const cu = datHamGoiAi(aiGia(kb.ai ?? [], dem));
  const sai: string[] = [];
  let runId = "";
  try {
    runId = await batDauRun({ flowId: id, version: 1, chuLuong: chu, items: kb.items });
    const worker = `w-kb-${id}`;
    const chayHet = async () => {
      for (let i = 0; i < 400 && (await chayMotMuc(worker, undefined, tienTo)); i++);
    };
    const tua = async () => {
      if (kb.tuaGio) await db.execute(sql`UPDATE ai_flow_queue SET "availableAt" = now() - interval '1 second' WHERE "runId" = ${runId} AND NOT (inputs ?| array['__kiem-het-han', '__kiem-han-luot'])`);
    };
    for (let vong = 0; vong < 20; vong++) {
      await tua();
      await chayHet();
      const [cuoi] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, runId));
      if (cuoi.status !== "dang-chay" || !kb.tuaGio) break;
    }
    for (const d of kb.duyet ?? []) {
      const kq = await traLoiCho({ runId, nodeId: d.nodeId, cong: d.cong, ...(d.them ? { them: d.them } : {}) });
      if (!kq.ok) sai.push(`duyệt «${d.nodeId}»/${d.cong}: không có hàng chờ để trả lời`);
      for (let vong = 0; vong < 20; vong++) {
        await tua();
        await chayHet();
        const [r] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, runId));
        if (r.status !== "dang-chay" || !kb.tuaGio) break;
      }
    }
    const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, runId));
    const buocs = await db.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, runId)).orderBy(aiFlowSteps.id);
    const ky = kb.kyVong;
    if (ky.trangThai !== undefined && run.status !== ky.trangThai) sai.push(`trạng thái lượt: thực «${run.status}» ≠ kỳ vọng «${ky.trangThai}»`);
    if (ky.loi?.ma !== undefined) {
      const ma = (run.error as { ma?: string } | null)?.ma;
      if (ma !== ky.loi.ma) sai.push(`mã lỗi lượt: thực «${ma ?? "(không)"}» ≠ kỳ vọng «${ky.loi.ma}»`);
    }
    for (const nid of ky.khongChay ?? []) if (buocs.some((b) => b.nodeId === nid)) sai.push(`node «${nid}» KHÔNG được chạy nhưng đã chạy`);
    if (ky.soLanGoiAi !== undefined && dem.n !== ky.soLanGoiAi) sai.push(`số lần gọi AI: thực ${dem.n} ≠ kỳ vọng ${ky.soLanGoiAi}`);
    for (const [nid, ev] of Object.entries(ky.buoc ?? {})) {
      const cua = buocs.filter((b) => b.nodeId === nid);
      if (ev.soLan !== undefined && cua.length !== ev.soLan) sai.push(`node «${nid}»: số bước thực ${cua.length} ≠ kỳ vọng ${ev.soLan}`);
      const b = cua.at(-1);
      if (!b) {
        sai.push(`node «${nid}»: KHÔNG có bước nào (kỳ vọng có)`);
        continue;
      }
      if (ev.trangThai !== undefined && b.status !== ev.trangThai) sai.push(`node «${nid}»: trạng thái thực «${b.status}» ≠ kỳ vọng «${ev.trangThai}»`);
      if (ev.dauVao !== undefined) {
        const l = lechTapCon(b.input, ev.dauVao, "dauVao");
        if (l) sai.push(`node «${nid}» ${l}`);
      }
      if (ev.dauRa !== undefined) {
        const l = lechTapCon(b.output, ev.dauRa, "dauRa");
        if (l) sai.push(`node «${nid}» ${l}`);
      }
    }
    return { ten: kb.ten, dat: sai.length === 0, sai, trangThai: run.status, soLanGoiAi: dem.n };
  } finally {
    datHamGoiAi(cu);
  }
}
let chu = 0;
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;

beforeAll(async () => {
  db = (await getDb())!;
  chu = (await taoNguoiDungTest("admin", "admin", { tienTo: "kb", ts: TT })).id;
}, 120_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

describe("kịch bản luồng (kichBan/*.json)", () => {
  const tep = readdirSync(AQUI).filter((f) => f.endsWith(".json")).sort();
  it("có ít nhất 6 kịch bản (chống 'xanh vì quét trúng 0 tệp')", () => {
    expect(tep.length).toBeGreaterThanOrEqual(6);
  });
  for (const f of tep) {
    it(`${f}`, async () => {
      const kb = docKichBan(f);
      const kq = await chayKichBan(kb, chu, TT);
      expect(kq.sai, `${kb.ten}: ${kq.sai.join(" | ")}`).toEqual([]);
      expect(kq.dat).toBe(true);
    });
  }
});

describe("chính bộ chạy", () => {
  it("lechTapCon: tập con sâu; mảng khớp độ dài; thiếu khoá; khác giá trị; kiểu khác", () => {
    expect(lechTapCon({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } })).toBeNull();
    expect(lechTapCon({ a: [{ x: 1, y: 2 }] }, { a: [{ x: 1 }] })).toBeNull();
    expect(lechTapCon({ a: [1, 2] }, { a: [1] })).toMatch(/độ dài/);
    expect(lechTapCon({ a: 1 }, { b: 1 })).toMatch(/THIẾU/);
    expect(lechTapCon({ a: 1 }, { a: 2 })).toMatch(/≠/);
    expect(lechTapCon({ a: "1" }, { a: 1 })).toMatch(/≠/);
    expect(lechTapCon(null, { a: 1 })).toMatch(/không phải đối tượng/);
    expect(lechTapCon({ a: null }, { a: null })).toBeNull();
  });

  it("★ BẮT kỳ vọng sai: đổi trạng thái / nhãn / khongChay / soLanGoiAi / dauVao ⇒ dat=false kèm lý do (không im lặng xanh)", async () => {
    const goc = docKichBan("mau5-chac-tao-phieu.json");
    const sai: KichBan = {
      ...goc,
      ten: "mau5 ky vong sai co chu y",
      kyVong: { trangThai: "loi", soLanGoiAi: 3, khongChay: ["tao-phieu"], buoc: { "tao-phieu": { dauVao: { main: [{ json: { nhan: "co-khi" } }] } }, "node-khong-co": { trangThai: "xong" } } },
    };
    const kq = await chayKichBan(sai, chu, TT);
    expect(kq.dat).toBe(false);
    expect(kq.sai.join("\n")).toMatch(/trạng thái lượt: thực «xong» ≠ kỳ vọng «loi»/);
    expect(kq.sai.join("\n")).toMatch(/số lần gọi AI: thực 1 ≠ kỳ vọng 3/);
    expect(kq.sai.join("\n")).toMatch(/«tao-phieu» KHÔNG được chạy nhưng đã chạy/);
    expect(kq.sai.join("\n")).toMatch(/node «tao-phieu» dauVao.*≠/);
    expect(kq.sai.join("\n")).toMatch(/«node-khong-co»: KHÔNG có bước nào/);
  });

  it("★ AI gọi NGOÀI kịch bản (không luật khớp) ⇒ lượt lỗi rõ, kỳ vọng 'xong' bị bắt", async () => {
    const goc = docKichBan("mau5-chac-tao-phieu.json");
    const kq = await chayKichBan({ ...goc, ten: "mau5 ai ngoai kich ban", ai: [{ khop: "khong-bao-gio-khop", tra: "dien" }] }, chu, TT);
    expect(kq.dat).toBe(false);
    expect(kq.trangThai).toBe("loi");
  });

  it("kịch bản thiếu luong và mau ⇒ ném (kịch bản hỏng không được xanh)", async () => {
    await expect(chayKichBan({ ten: "rong", kyVong: {} }, chu, TT)).rejects.toThrow(/cần luong hoặc mau/);
  });
});
