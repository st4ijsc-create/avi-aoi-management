/**
 * ★★★ Đợt 8.5 — node OT qua ĐỘNG CƠ THẬT (CSDL `_test`), CHẾ ĐỘ MÔ PHỎNG:
 *   • bộ đột biến mức 4–5 (biểu thức `{{ $json.* }}` ⇒ tham số node) ⇒ 100 % lượt `loi`, 0 hàng chờ đề xuất (ĐẾM BẢNG
 *     `ai_flow_waits`); tag lạ được tra trong `device_tags` THẬT (chỉ đọc) ⇒ không có ⇒ mức 5;
 *   • stop/pause ⇒ hàng chờ `nguon: "luong-ai"`, `moPhong: true`; đồng ý ⇒ "đã duyệt (mô phỏng) — không gửi";
 *   • `command_log` / `orchestration_runs` KHÔNG đổi một hàng suốt lưới (không có đường gửi);
 *   • `ot.doc-tag` với nguồn giả; `ot.de-xuat-luong` với FOE workflow giả (đọc tiêm).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../../drizzle/schema";
import { batDauRun, chayMotMuc, luuPhienBan, traLoiCho } from "../dongCo";
import { __datNguonDocTagChoTest } from "../nut/ot";
import { __datBoKiemChuLuongChoTest } from "../boKiemPhamVi";
import { GHI_CHU_DA_DUYET_MO_PHONG, __datPhuThuocCongOtChoTest, ketQuaSauDuyetMoPhong } from "./congOtLuong";
import { CA_CAO, CA_THAP } from "./__boDotBienOt";

const TT = "t85ot";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, pa: string, b: string) => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const db = async () => (await getDb())!;

// Lưới này kiểm CỔNG OT (phân loại mức 4–5, đề xuất mô phỏng) với máy số tuỳ ý ⇒ cho mọi máy "tồn tại + trong phạm vi". PHẠM VI thật
// được kiểm ở `flowPhamViChuLuong.db.test.ts` (hai nhà máy, người dùng thật).
beforeAll(() => __datBoKiemChuLuongChoTest(async () => ({ may: async () => true })));
afterAll(() => __datBoKiemChuLuongChoTest(null));

afterEach(() => {
  __datNguonDocTagChoTest(null);
  __datPhuThuocCongOtChoTest(null);
});

afterAll(async () => {
  const d = await getDb();
  if (!d) return;
  const runs = await d.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await d.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await d.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

async function chayHet() {
  for (let i = 0; i < 2000 && (await chayMotMuc("w-85", undefined, TT)); i++);
}
const demBang = async (bang: "command_log" | "orchestration_runs") =>
  ((await (await db()).execute(sql.raw(`SELECT count(*)::int AS n FROM ${bang}`))) as unknown as { n: number }[])[0].n;
const demDeXuat = async (runIds: string[]) =>
  runIds.length
    ? ((await (await db()).execute(sql`SELECT count(*)::int AS n FROM ai_flow_waits WHERE "runId" IN ${sql.raw(`(${runIds.map((r) => `'${r}'`).join(",")})`)} AND payload->>'nguon' = 'luong-ai'`)) as unknown as { n: number }[])[0].n
    : 0;
const trangThai = async (id: string) => (await (await db()).select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0].status;

const luongLenh = {
  id: `${TT}-lenh`, name: "đề xuất lệnh", version: 1,
  nodes: [
    nut("t", "kich-hoat.thu-cong"),
    nut("d", "ot.de-xuat-lenh", { may: "{{ $json.may }}", lenh: "{{ $json.lenh }}", tag: "{{ $json.tag }}", giaTri: "{{ $json.giaTri }}" }),
    nut("ok", "du-lieu.dat", { truong: { nhanh: "dong-y" } }),
    nut("ko", "du-lieu.dat", { truong: { nhanh: "tu-choi" } }),
  ],
  connections: [noi("t", "main", "d"), noi("d", "dong-y", "ok"), noi("d", "tu-choi", "ko")],
};

describe("Đợt 8.5 — node OT chế độ mô phỏng (động cơ thật, DB)", () => {
  it("luồng có node OT ⇒ hạng `ot`", async () => {
    expect((await luuPhienBan(luongLenh, null)).hang).toBe("ot");
  });

  it(`★★★ bộ đột biến: ${CA_CAO.length} yêu cầu mức 4–5 ⇒ ${CA_CAO.length}/${CA_CAO.length} lượt bị chặn, 0 đề xuất (đếm bảng); ${CA_THAP.length} stop/pause ⇒ ${CA_THAP.length} đề xuất mô phỏng`, async () => {
    const { version } = await luuPhienBan(luongLenh, null);
    const cmd0 = await demBang("command_log");
    const orch0 = await demBang("orchestration_runs");

    const runCao: string[] = [];
    for (const c of CA_CAO) runCao.push(await batDauRun({ flowId: luongLenh.id, version, items: [{ json: { may: c.may, lenh: c.lenh, tag: c.tag ?? null, giaTri: c.giaTri ?? null } }] }));
    const runThap: string[] = [];
    for (const c of CA_THAP) runThap.push(await batDauRun({ flowId: luongLenh.id, version, items: [{ json: { may: c.may, lenh: c.lenh, tag: null, giaTri: null } }] }));
    await chayHet();

    const lot: string[] = [];
    for (const [i, r] of runCao.entries()) if ((await trangThai(r)) !== "loi") lot.push(CA_CAO[i].ten);
    expect(lot, "yêu cầu mức cao KHÔNG bị chặn").toEqual([]);
    expect(await demDeXuat(runCao), "đề xuất được tạo cho yêu cầu mức cao").toBe(0);
    const loiBuoc = await (await db()).select().from(aiFlowSteps).where(inArray(aiFlowSteps.runId, runCao));
    expect(loiBuoc.filter((b) => b.nodeId === "d").every((b) => b.status === "loi" && /tu-choi-muc-cao/.test(JSON.stringify(b.error)))).toBe(true);

    for (const r of runThap) expect(await trangThai(r)).toBe("cho-duyet");
    expect(await demDeXuat(runThap)).toBe(CA_THAP.length);

    expect(await demBang("command_log"), "command_log phải đứng yên").toBe(cmd0);
    expect(await demBang("orchestration_runs"), "không có lượt FOE nào").toBe(orch0);
  });

  it("★★ đồng ý một đề xuất ⇒ 'đã duyệt (mô phỏng) — không gửi', item mang deXuatId/muc/ketQua; command_log đứng yên", async () => {
    const { version } = await luuPhienBan(luongLenh, null);
    const cmd0 = await demBang("command_log");
    const r = await batDauRun({ flowId: luongLenh.id, version, items: [{ json: { may: 7, lenh: "stop", tag: null, giaTri: null } }] });
    await chayHet();
    const [w] = (await (await db()).execute(sql`SELECT payload FROM ai_flow_waits WHERE "runId" = ${r}`)) as unknown as { payload: Record<string, unknown> }[];
    expect(w.payload).toMatchObject({ nguon: "luong-ai", moPhong: true, muc: 1, vaiTroDuyet: "supervisor" });
    expect(String(w.payload.tieuDe)).toMatch(/^\[MÔ PHỎNG\]/);
    expect(await traLoiCho({ runId: r, nodeId: "d", cong: "dong-y", them: { duyet: { dongY: true, nguoi: 1 }, ...ketQuaSauDuyetMoPhong(true) } })).toEqual({ ok: true, cong: "dong-y" });
    await chayHet();
    expect(await trangThai(r)).toBe("xong");
    const [b] = await (await db()).select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, r)).then((x) => x.filter((y) => y.nodeId === "ok"));
    const item = (b.output as { main: { json: Record<string, unknown> }[] }).main[0].json;
    expect(item).toMatchObject({ deXuatId: `ot:${r}:d:1`, muc: 1, ketQua: "da-de-xuat", moPhong: true, nhanh: "dong-y" });
    expect(item.thucThi).toMatchObject({ daGui: false, moPhong: true, ghiChu: GHI_CHU_DA_DUYET_MO_PHONG });
    expect(await demBang("command_log")).toBe(cmd0);
  });

  it("nhiều item vào một node đề xuất ⇒ lỗi, không đề xuất hàng loạt", async () => {
    const { version } = await luuPhienBan(luongLenh, null);
    const r = await batDauRun({ flowId: luongLenh.id, version, items: [{ json: { may: 7, lenh: "stop" } }, { json: { may: 7, lenh: "pause" } }] });
    await chayHet();
    expect(await trangThai(r)).toBe("loi");
    expect(await demDeXuat([r])).toBe(0);
  });

  it("ot.doc-tag (hạng doc) đọc qua nguồn giả — một tag / nhiều tag", async () => {
    const goi: unknown[] = [];
    __datNguonDocTagChoTest(async (y) => {
      goi.push(y);
      const dong = [
        { tagKey: "Speed", valueNumeric: 12.5, valueText: null, quality: "good", timestamp: "2026-10-20T00:00:00.000Z", unit: "m/s" },
        { tagKey: "Mode", valueNumeric: null, valueText: "AUTO", quality: "good", timestamp: "2026-10-20T00:00:00.000Z", unit: null },
      ];
      return y.tagKey ? dong.filter((d) => d.tagKey === y.tagKey) : dong;
    });
    const def = {
      id: `${TT}-doc`, name: "đọc tag", version: 1,
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("a", "ot.doc-tag", { may: "{{ $json.may }}", tag: "Speed", truongRa: "toc" }), nut("b", "ot.doc-tag", { may: 3 })],
      connections: [noi("t", "main", "a"), noi("a", "main", "b")],
    };
    const { version, hang } = await luuPhienBan(def, null);
    expect(hang).toBe("doc");
    const r = await batDauRun({ flowId: def.id, version, items: [{ json: { may: 3 } }] });
    await chayHet();
    expect(await trangThai(r)).toBe("xong");
    const b = (await (await db()).select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, r))).find((x) => x.nodeId === "b")!;
    const json = (b.output as { main: { json: Record<string, unknown> }[] }).main[0].json;
    expect(json.toc).toMatchObject({ tag: "Speed", giaTri: 12.5, donVi: "m/s" });
    expect(json.tag).toHaveLength(2);
    expect(goi).toEqual([{ machineId: 3, tagKey: "Speed", limit: 1 }, { machineId: 3, tagKey: undefined, limit: 20 }]);
  });

  it("ot.de-xuat-luong: FOE workflow active chỉ stop ⇒ đề xuất; có start ⇒ chặn; không gọi động cơ FOE", async () => {
    __datPhuThuocCongOtChoTest({
      async docLuongFoe(id) {
        const steps = id === 1 ? [{ id: "a", type: "command", machineId: 7, command: "stop" }] : [{ id: "a", type: "command", machineId: 7, command: "start" }];
        return { ref: `wf-${id}`, ten: "wf", trangThai: "active", definition: { steps } };
      },
    });
    const def = {
      id: `${TT}-foe`, name: "đề xuất FOE", version: 1,
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "ot.de-xuat-luong", { workflowId: "{{ $json.wf }}", version: 1 })],
      connections: [noi("t", "main", "d")],
    };
    const { version, hang } = await luuPhienBan(def, null);
    expect(hang).toBe("ot");
    const orch0 = await demBang("orchestration_runs");
    const r1 = await batDauRun({ flowId: def.id, version, items: [{ json: { wf: 1 } }] });
    const r2 = await batDauRun({ flowId: def.id, version, items: [{ json: { wf: 2 } }] });
    await chayHet();
    expect(await trangThai(r1)).toBe("cho-duyet");
    expect(await demDeXuat([r1])).toBe(1);
    expect(await trangThai(r2)).toBe("loi");
    expect(await demDeXuat([r2])).toBe(0);
    expect(await demBang("orchestration_runs")).toBe(orch0);
  });
});
