/**
 * R3 (kế hoạch AI Local 2026-09-22 §4) — "HỒ SƠ MODEL" thật cho tab Xây dựng mô hình của Training Studio,
 * thay cho panel vô hiệu. Mọi ô đọc từ NGUỒN THẬT, mỗi ô tự nói nguồn của nó:
 *   · dangPhucVu  — `GET <LLAMA_SERVER_URL>/props` (model thật đang nạp, ctx/slot, số slot, bản dựng);
 *   · cauHinh     — `.env` đang hiệu lực (model khai, trần ctx, ngân sách nghĩ, hồ sơ sampling, model nhúng);
 *   · lech        — chỗ khai KHÁC thứ đang chạy (bài học `LLAMA_SERVER_MODEL`: cờ quên hỏng trong im lặng);
 *   · hoSoRouter  — `activeRouterProfile()` (ngưỡng định tuyến đo tại chỗ hay THỪA KẾ);
 *   · soDoSong    — sổ đo lượt `ai_gateway_metrics` (B7) 24 giờ qua: lượt · nghĩ/trả · độ trễ · lỗi;
 *   · baoCaoDo    — các lượt đo trục M/H/dự án trong `scripts/ai-eval/codegen-chay-duoc/reports` (chỉ có ở
 *                   máy phát triển; vắng ⇒ `null`, không phải "0 %").
 * FAIL-SAFE từng phần: một nguồn hỏng chỉ làm ô ĐÓ ra `null` + lý do, không làm hỏng cả hồ sơ.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";

export interface HoSoModel {
  dangPhucVu:
    | { trangThai: "ok"; modelFile: string; ctxMoiSlot: number | null; soSlot: number | null; banDung: string | null }
    | { trangThai: "khong-lien-lac" | "tat"; lyDo: string };
  cauHinh: {
    modelKhai: string | null;
    llamaServerModel: string | null;
    ggufMaxCtx: number | null;
    nganSachNghi: number | null;
    hoSoSampling: string;
    modelNhung: string | null;
  };
  lech: string[];
  hoSoRouter: {
    label: string;
    provenance: string;
    measuredOn: string;
    thresholdsInheritedFrom: string | null;
    needsLocalMeasurement: boolean;
    latencyPinMs: number;
    easyMaxChars: number;
    hardMinChars: number;
  } | null;
  soDoSong: {
    luot: number;
    loi: number;
    coDoNghi: number;
    nghiTB: number | null;
    traTB: number | null;
    treTrungVi: number | null;
    theoModel: Array<{ model: string; luot: number }>;
  } | null;
  baoCaoDo: Array<{ truc: "M" | "H" | "du-an"; nhan: string; soLuot: number; dat: number; tong: number; luc: string }> | null;
}

const tenTep = (p: string | null | undefined) => (p ? path.basename(p.replace(/\\/g, "/")) : null);
const soDuong = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function docProps(): Promise<HoSoModel["dangPhucVu"]> {
  if (String(process.env.LLAMA_SERVER_ENABLED ?? "").toLowerCase() !== "true") return { trangThai: "tat", lyDo: "LLAMA_SERVER_ENABLED" };
  const url = (process.env.LLAMA_SERVER_URL || "http://127.0.0.1:8091").replace(/\/+$/, "");
  try {
    const r = await fetch(`${url}/props`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { trangThai: "khong-lien-lac", lyDo: `HTTP ${r.status}` };
    const j = (await r.json()) as Record<string, any>;
    return {
      trangThai: "ok",
      modelFile: tenTep(j.model_path) ?? String(j.model_alias ?? "?"),
      ctxMoiSlot: soDuong(j.default_generation_settings?.n_ctx),
      soSlot: soDuong(j.total_slots),
      banDung: typeof j.build_info === "string" ? j.build_info : null,
    };
  } catch (e) {
    return { trangThai: "khong-lien-lac", lyDo: (e as Error)?.name === "TimeoutError" ? "timeout" : "fetch" };
  }
}

async function docSoDoSong(): Promise<HoSoModel["soDoSong"]> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [tong] = (await db.execute(sql`
      SELECT count(*)::int AS luot,
             count(*) FILTER (WHERE outcome <> 'ok')::int AS loi,
             count("reasoningTokens")::int AS "coDoNghi",
             avg("reasoningTokens")::float AS "nghiTB",
             avg("tokensOut")::float AS "traTB",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs")::float AS "treTrungVi"
        FROM ai_gateway_metrics WHERE "createdAt" > now() - interval '24 hours'`)) as unknown as Array<Record<string, number | null>>;
    const theo = (await db.execute(sql`
      SELECT model, count(*)::int AS luot FROM ai_gateway_metrics
       WHERE "createdAt" > now() - interval '24 hours' GROUP BY model ORDER BY 2 DESC LIMIT 5`)) as unknown as Array<{ model: string; luot: number }>;
    const r = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(Number(x)));
    return {
      luot: Number(tong?.luot ?? 0),
      loi: Number(tong?.loi ?? 0),
      coDoNghi: Number(tong?.coDoNghi ?? 0),
      nghiTB: r(tong?.nghiTB),
      traTB: r(tong?.traTB),
      treTrungVi: r(tong?.treTrungVi),
      theoModel: theo.map((x) => ({ model: tenTep(x.model) ?? x.model, luot: Number(x.luot) })),
    };
  } catch {
    return null;
  }
}

/** Gom báo cáo đo theo NHÃN (bỏ đuôi `-<số lượt>`), lấy các nhãn mới nhất mỗi trục. */
export function gomBaoCao(
  tep: Array<{ ten: string; mtimeMs: number; noiDung: unknown }>,
  toiDaMoiTruc = 4,
): NonNullable<HoSoModel["baoCaoDo"]> {
  const nhom = new Map<string, { truc: "M" | "H" | "du-an"; nhan: string; soLuot: number; dat: number; tong: number; moi: number }>();
  for (const t of tep) {
    const m = t.ten.match(/^(([HM])-.+?|duan-.+?)-(\d+)\.json$/) ?? t.ten.match(/^(duan[A-Za-z0-9-]*?)()\.json$/);
    if (!m) continue;
    const nhan = m[1];
    const truc = nhan.startsWith("H-") ? "H" : nhan.startsWith("M-") ? "M" : "du-an";
    const ds = Array.isArray(t.noiDung) ? (t.noiDung as any[]) : [];
    let dat = 0;
    let tong = 0;
    if (truc === "du-an") {
      for (const d of ds) for (const v of Object.values(d?.kiem ?? {})) {
        const mm = String(v).match(/^(\d+)\/(\d+)$/);
        if (mm) { dat += Number(mm[1]); tong += Number(mm[2]); }
      }
    } else {
      for (const b of ds) if (b && typeof b.chayDat === "boolean") { tong++; if (b.chayDat) dat++; }
    }
    if (tong === 0) continue;
    const g = nhom.get(nhan) ?? { truc, nhan, soLuot: 0, dat: 0, tong: 0, moi: 0 };
    g.soLuot++; g.dat += dat; g.tong += tong; g.moi = Math.max(g.moi, t.mtimeMs);
    nhom.set(nhan, g);
  }
  const ra: NonNullable<HoSoModel["baoCaoDo"]> = [];
  for (const truc of ["M", "H", "du-an"] as const) {
    [...nhom.values()].filter((g) => g.truc === truc).sort((a, b) => b.moi - a.moi).slice(0, toiDaMoiTruc)
      .forEach((g) => ra.push({ truc, nhan: g.nhan, soLuot: g.soLuot, dat: g.dat, tong: g.tong, luc: new Date(g.moi).toISOString() }));
  }
  return ra;
}

function docBaoCao(): HoSoModel["baoCaoDo"] {
  const dir = path.join(process.cwd(), "scripts", "ai-eval", "codegen-chay-duoc", "reports");
  try {
    if (!fs.existsSync(dir)) return null;
    const tep = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
      const p = path.join(dir, f);
      let noiDung: unknown = null;
      try { noiDung = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* tệp hỏng: bỏ qua */ }
      return { ten: f, mtimeMs: fs.statSync(p).mtimeMs, noiDung };
    });
    return gomBaoCao(tep);
  } catch {
    return null;
  }
}

export async function layHoSoModel(): Promise<HoSoModel> {
  const [dangPhucVu, soDoSong] = await Promise.all([docProps(), docSoDoSong()]);
  const { ggufMaxCtx } = await import("./ggufCtxCap");
  const { docTenHoSo } = await import("./hoSoSampling");
  let hoSoRouter: HoSoModel["hoSoRouter"] = null;
  try {
    const { activeRouterProfile } = await import("../aiModelRouter");
    const p = activeRouterProfile();
    hoSoRouter = {
      label: p.label, provenance: p.provenance, measuredOn: p.measuredOn, thresholdsInheritedFrom: p.thresholdsInheritedFrom,
      needsLocalMeasurement: p.needsLocalMeasurement, latencyPinMs: p.latencyPinMs, easyMaxChars: p.easyMaxChars, hardMinChars: p.hardMinChars,
    };
  } catch { /* hồ sơ router không đọc được ⇒ null */ }
  const cauHinh: HoSoModel["cauHinh"] = {
    modelKhai: tenTep(process.env.GGUF_DEFAULT_MODEL),
    llamaServerModel: tenTep(process.env.LLAMA_SERVER_MODEL),
    ggufMaxCtx: (() => { try { return ggufMaxCtx(); } catch { return null; } })(),
    nganSachNghi: soDuong(process.env.LLAMA_SERVER_REASONING_BUDGET),
    hoSoSampling: docTenHoSo(),
    modelNhung: tenTep(process.env.GGUF_EMBED_MODEL),
  };
  return { dangPhucVu, cauHinh, lech: timLech(dangPhucVu, cauHinh), hoSoRouter, soDoSong, baoCaoDo: docBaoCao() };
}

/** Mã các chỗ khai KHÁC thứ đang chạy — trang dịch mã, không dựng câu ở đây. */
export function timLech(dang: HoSoModel["dangPhucVu"], ch: HoSoModel["cauHinh"]): string[] {
  const ra: string[] = [];
  if (!ch.modelKhai) ra.push("chua-khai-model");
  if (dang.trangThai !== "ok") return ra;
  const cung = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
  if (ch.llamaServerModel && !cung(ch.llamaServerModel, dang.modelFile)) ra.push("llama-server-model-lech");
  if (ch.modelKhai && !cung(ch.modelKhai, dang.modelFile)) ra.push("model-khai-lech");
  if (dang.ctxMoiSlot !== null && ch.ggufMaxCtx !== null && dang.ctxMoiSlot < ch.ggufMaxCtx) ra.push("ctx-slot-nho-hon-tran");
  return ra;
}
