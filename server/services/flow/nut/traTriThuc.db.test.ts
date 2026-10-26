/**
 * ★★★ Lô Luồng-2 (2026-10-25) — node `ai.tra-tri-thuc` với động cơ THẬT, bộ truy hồi giả:
 * ghi NGUỒN TRÍCH (`trich[]`), vai tra cứu = vai CHỦ LƯỢT lúc chạy, không chủ ⇒ lỗi, không thấy tài liệu ⇒ rỗng (không bịa), tham số sai ⇒ lỗi.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { batDauRun, chayMotMuc, luuPhienBan } from "../dongCo";
import { __datTimTaiLieuTriThucChoTest } from "./traTriThuc";

const RUN = `tk_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t2tk${Math.floor(Math.random() * 1e5)}`;
const FL = `${TT}-kb`;
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let eng = 0;
let khoa = 0;

const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const luong = (tham: Record<string, unknown>) => ({
  id: FL, name: "kb", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("k", "ai.tra-tri-thuc", tham)],
  connections: [{ from: { node: "t", port: "main" }, to: { node: "k", port: "main" } }],
});
async function mkUser(suffix: string, role: "engineer", active = true): Promise<number> {
  return (await taoNguoiDungTest(suffix, role, { tienTo: "tk", ten: `TK ${suffix}`, ts: RUN, extra: { isActive: active } })).id;
}
async function chay(tham: Record<string, unknown>, chu: number | null, cauHoi = "Làm sao đặt ngưỡng NG?") {
  await luuPhienBan(luong(tham), eng, null);
  const v = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${FL}`)) as unknown as { v: number }[];
  const r = await batDauRun({ flowId: FL, version: v[0].v, chuLuong: chu, items: [{ json: { cauHoi } }] });
  for (let i = 0; i < 50 && (await chayMotMuc("w-tk", undefined, TT)); i++);
  const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, r));
  const [b] = await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r), eq(aiFlowSteps.nodeId, "k")));
  const out = (b?.output as { main?: Array<{ json: Record<string, unknown> }> } | null)?.main?.[0]?.json;
  return { status: run.status, out, loi: b?.error as { ma?: string } | null | undefined };
}

beforeAll(async () => {
  db = (await getDb())!;
  eng = await mkUser("eng", "engineer");
  khoa = await mkUser("khoa", "engineer", false);
}, 120_000);
afterEach(() => __datTimTaiLieuTriThucChoTest(null));
afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

describe("ai.tra-tri-thuc", () => {
  it("★ ghi NGUỒN TRÍCH: chữ các đoạn kèm tiêu đề nguồn + trich[] {nguon, loai, diem}; truyền đúng câu hỏi, kho, k và VAI CHỦ LƯỢT", async () => {
    const goi: Array<{ query: string; corpus: string; vaiTro: string; k?: number }> = [];
    __datTimTaiLieuTriThucChoTest(async (y) => {
      goi.push(y);
      return {
        doan: [
          { nguon: "Siemens S7-1500 manual §4.2", loai: "vendor", diem: 0.8123, noiDung: "Ngưỡng NG đặt ở …" },
          { nguon: "Studio: AOI threshold", loai: "studio", diem: 0.5, noiDung: "Dùng SPC …" },
        ],
        daTim: ["vendor", "studio"],
      };
    });
    const r = await chay({ cauHoi: "{{ $json.cauHoi }}", kho: "vendor", k: 3 }, eng);
    expect(r.status).toBe("xong");
    expect(goi).toEqual([{ query: "Làm sao đặt ngưỡng NG?", corpus: "vendor", vaiTro: "engineer", k: 3 }]);
    expect(r.out?.soDoan).toBe(2);
    expect(r.out?.trich).toEqual([
      { nguon: "Siemens S7-1500 manual §4.2", loai: "vendor", diem: 0.81 },
      { nguon: "Studio: AOI threshold", loai: "studio", diem: 0.5 },
    ]);
    expect(String(r.out?.triThuc)).toContain("# Siemens S7-1500 manual §4.2\nNgưỡng NG đặt ở");
  });

  it("không thấy tài liệu ⇒ soDoan 0, triThuc rỗng, trich rỗng (không bịa)", async () => {
    __datTimTaiLieuTriThucChoTest(async () => ({ doan: [], daTim: ["vendor"] }));
    const r = await chay({ cauHoi: "câu không có tài liệu" }, eng);
    expect(r.status).toBe("xong");
    expect(r.out).toMatchObject({ soDoan: 0, triThuc: "", trich: [] });
  });

  it("★ không chủ / chủ bị khoá ⇒ lượt LỖI, bộ truy hồi KHÔNG được gọi", async () => {
    let n = 0;
    __datTimTaiLieuTriThucChoTest(async () => {
      n++;
      return { doan: [], daTim: [] };
    });
    for (const chu of [null, khoa]) {
      const r = await chay({ cauHoi: "x" }, chu);
      expect(r.status).toBe("loi");
      expect(r.loi?.ma).toBe("CHU_LUOT_KHONG_XAC_DINH");
    }
    expect(n).toBe(0);
  });

  it("tham số sai (cauHoi rỗng, kho lạ, k ngoài 1..8) ⇒ lỗi THAM_SO_SAI", async () => {
    __datTimTaiLieuTriThucChoTest(async () => ({ doan: [], daTim: [] }));
    for (const tham of [{ cauHoi: "  " }, { cauHoi: "x", kho: "operational" }, { cauHoi: "x", k: 99 }, { cauHoi: "x", k: 1.5 }]) {
      const r = await chay(tham, eng);
      expect(r.status).toBe("loi");
      expect(r.loi?.ma).toBe("THAM_SO_SAI");
    }
  });
});
