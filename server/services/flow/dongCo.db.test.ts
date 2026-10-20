/**
 * ★★ Đợt 8.0 — động cơ Luồng AI trên CSDL `_test` (mig 0401 phải đã áp). Gồm CỔNG 8.0: worker chết giữa chừng ⇒ worker
 * khác hoàn tất, node idempotent chạy lại với cùng khoá (đích giả khử trùng ⇒ 1 tác dụng), node atMostOnce KHÔNG chạy lại.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { __goNutChoTest, dangKyNut } from "./dangKyNut";
import { batDauBuoc, batDauRun, chayMotMuc, luuPhienBan, nhatMuc, thucThi } from "./dongCo";

const TT = "t8dc";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, them: Record<string, unknown> = {}) => ({
  id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...them,
});
const noi = (a: string, pa: string, b: string, pb = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: pb } });

// Đích ngoài GIẢ: khử trùng theo idempotencyKey (như một API có Idempotency-Key) + đếm số lần bị GỌI.
const dich = { goi: 0, daNhan: new Map<string, unknown>() };
let hongLanDau = 0;

beforeAll(() => {
  for (const lapLai of ["idempotent", "atMostOnce"] as const) {
    dangKyNut({
      type: `thu.gui-${lapLai === "idempotent" ? "i" : "m"}`, typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["main"],
      tacDungPhu: "ngoai-ghi", lapLai,
      async chay(_t, ngu) {
        dich.goi++;
        if (!dich.daNhan.has(ngu.idempotencyKey)) dich.daNhan.set(ngu.idempotencyKey, ngu.inputs.main);
        return { main: ngu.inputs.main ?? [] };
      },
    });
  }
  dangKyNut({
    type: "thu.chap-chon", typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["main"], tacDungPhu: "thuan", lapLai: "idempotent",
    async chay(_t, ngu) {
      if (hongLanDau-- > 0) throw new Error("lỗi tạm");
      return { main: ngu.inputs.main ?? [] };
    },
  });
});

afterAll(async () => {
  for (const t of ["thu.gui-i", "thu.gui-m", "thu.chap-chon"]) __goNutChoTest(t);
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

async function chayHet(worker = "w1", tran = 200): Promise<number> {
  let n = 0;
  while (n < tran && (await chayMotMuc(worker, undefined, TT))) n++;
  return n;
}
const layRun = async (id: string) => (await (await getDb())!.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];
const layBuoc = async (id: string) => (await getDb())!.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, id));

describe("động cơ Luồng AI (Đợt 8.0, DB)", () => {
  it("luồng thẳng + rẽ nhánh: chỉ nhánh có item mới chạy; biểu thức theo item; lượt xong", async () => {
    const { version } = await luuPhienBan(
      {
        id: `${TT}-a`, name: "thẳng", version: 1,
        nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "du-lieu.dat", { truong: { gap: "{{ $json.soLoi * 2 }}" } }), nut("n", "logic.neu", { dieuKien: "{{ $json.gap > 5 }}" }), nut("cao", "du-lieu.dat", { truong: { muc: "cao" } }), nut("thap", "du-lieu.dat", { truong: { muc: "thap", tu: '{{ $node("d").json.gap }}' } })],
        connections: [noi("t", "main", "d"), noi("d", "main", "n"), noi("n", "dung", "cao"), noi("n", "sai", "thap")],
      },
      null,
    );
    const run = await batDauRun({ flowId: `${TT}-a`, version, items: [{ json: { soLoi: 1 } }, { json: { soLoi: 2 } }] });
    await chayHet();
    expect((await layRun(run)).status).toBe("xong");
    const b = await layBuoc(run);
    const ra = (id: string) => (b.find((x) => x.nodeId === id && x.status === "xong")?.output as { main: { json: Record<string, unknown> }[] })?.main;
    expect(ra("thap")).toEqual([{ json: { soLoi: 1, gap: 2, muc: "thap", tu: 2 } }, { json: { soLoi: 2, gap: 4, muc: "thap", tu: 2 } }]);
    expect(b.some((x) => x.nodeId === "cao"), "nhánh không có item KHÔNG chạy").toBe(false);
  });

  it("gộp chờ đủ hai cổng", async () => {
    const { version } = await luuPhienBan(
      {
        id: `${TT}-g`, name: "gộp", version: 1,
        nodes: [nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat", { truong: { tu: "a" } }), nut("b", "du-lieu.dat", { truong: { tu: "b" } }), nut("g", "logic.gop")],
        connections: [noi("t", "main", "a"), noi("t", "main", "b"), noi("a", "main", "g", "a"), noi("b", "main", "g", "b")],
      },
      null,
    );
    const run = await batDauRun({ flowId: `${TT}-g`, version, items: [{ json: { x: 1 } }] });
    await chayHet();
    const g = (await layBuoc(run)).filter((x) => x.nodeId === "g");
    expect(g).toHaveLength(1);
    expect((g[0].output as { main: unknown[] }).main).toEqual([{ json: { x: 1, tu: "a" } }, { json: { x: 1, tu: "b" } }]);
    expect((await layRun(run)).status).toBe("xong");
  });

  it("luồng không hợp lệ (chu trình) không lưu được", async () => {
    await expect(
      luuPhienBan({ id: `${TT}-x`, name: "x", version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat"), nut("b", "du-lieu.dat")], connections: [noi("t", "main", "a"), noi("a", "main", "b"), noi("b", "main", "a")] }, null),
    ).rejects.toMatchObject({ code: "LUONG_KHONG_HOP_LE" });
  });

  it("thử lại theo retry rồi thành công", async () => {
    hongLanDau = 1;
    const { version } = await luuPhienBan(
      { id: `${TT}-r`, name: "thử lại", version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("c", "thu.chap-chon", {}, { retry: { max: 2, backoffMs: 0 } })], connections: [noi("t", "main", "c")] },
      null,
    );
    const run = await batDauRun({ flowId: `${TT}-r`, version });
    await chayHet();
    const c = (await layBuoc(run)).filter((x) => x.nodeId === "c").map((x) => x.status).sort();
    expect(c).toEqual(["loi", "xong"]);
    expect((await layRun(run)).status).toBe("xong");
  });

  async function luongGui(loai: "i" | "m") {
    const { version } = await luuPhienBan(
      { id: `${TT}-s${loai}`, name: `gửi ${loai}`, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("s", `thu.gui-${loai}`), nut("sau", "du-lieu.dat", { truong: { xong: true } })], connections: [noi("t", "main", "s"), noi("s", "main", "sau")] },
      null,
    );
    const run = await batDauRun({ flowId: `${TT}-s${loai}`, version });
    expect(await chayMotMuc("A", undefined, TT)).toBe(true); // kích hoạt
    // Worker A nhặt node gửi, ghi bước dang-chay, GỌI đích… rồi CHẾT trước khi ghi kết quả.
    const muc = (await nhatMuc("A", 40, TT))!;
    expect(muc.nodeId).toBe("s");
    const bd = await batDauBuoc(muc);
    if (!bd.tiep) throw new Error("phải chạy");
    await thucThi(bd.def, bd.ngu);
    await new Promise((r) => setTimeout(r, 120)); // lease 40 ms hết hạn
    await chayHet("B");
    return run;
  }

  it("★ CỔNG 8.0 — idempotent: worker chết giữa chừng ⇒ B chạy lại CÙNG khoá ⇒ đích nhận đúng 1, lượt xong", async () => {
    dich.goi = 0;
    dich.daNhan.clear();
    const run = await luongGui("i");
    expect(dich.goi).toBe(2);
    expect(dich.daNhan.size).toBe(1);
    expect((await layRun(run)).status).toBe("xong");
    const s = (await layBuoc(run)).filter((x) => x.nodeId === "s").map((x) => x.status).sort();
    expect(s).toEqual(["loi", "xong"]);
  });

  it("★ CỔNG 8.0 — atMostOnce: worker chết giữa chừng ⇒ KHÔNG chạy lại, bước khong-ro, lượt loi", async () => {
    dich.goi = 0;
    dich.daNhan.clear();
    const run = await luongGui("m");
    expect(dich.goi).toBe(1);
    const r = await layRun(run);
    expect(r.status).toBe("loi");
    expect((r.error as { lyDo: string }).lyDo).toBe("khong-ro");
    const b = await layBuoc(run);
    expect(b.filter((x) => x.nodeId === "s").map((x) => x.status)).toEqual(["khong-ro"]);
    expect(b.some((x) => x.nodeId === "sau"), "node sau KHÔNG chạy").toBe(false);
  });

  it("hai worker giành cùng một mục ⇒ đúng một lấy được", async () => {
    const { version } = await luuPhienBan({ id: `${TT}-c`, name: "giành", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, null);
    await batDauRun({ flowId: `${TT}-c`, version });
    const [a, b] = await Promise.all([nhatMuc("X", undefined, TT), nhatMuc("Y", undefined, TT)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    await chayHet();
  });
});
