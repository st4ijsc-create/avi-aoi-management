/**
 * ★★★ M5 (audit bảo mật 2026-10-21) — TRẦN chống DoS / nhân bậc ba của Luồng AI, trên CSDL `_test`:
 *   (i)   `settings.maxConcurrentRuns` được THI HÀNH, mặc định 1 — lượt vượt trần bị TỪ CHỐI (KHÔNG xếp hàng), mỗi cửa vào xử lý riêng
 *         (chạy tay ⇒ CONFLICT, webhook ⇒ 429, MCP ⇒ lỗi tool, lịch ⇒ bỏ mốc);
 *   (ii)  node `kich-hoat.lich`: ≤ 3 node / luồng, ≤ 60 lượt bắn / giờ / luồng (lúc LƯU và lúc BẮN);
 *   (iii) cây lượt con ≤ 50 lượt, ≤ 100 item vào `luong.goi-con`;
 *   (iv)  kill switch con — đã ở H1 (luongCon.db.test.ts).
 * Mỗi ca dựng đúng kịch bản của audit và HỎNG trên mã trước bản vá (không có trần ⇒ mọi lượt đều vào).
 */
import { vi, beforeAll } from "vitest";
import { donLuongTheoTienTo } from "./__donDuLieuTest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlows } from "../../../drizzle/schema";
import { flowRouter } from "../../routers/flowRouter";
import { LoiLuong, batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";
import { banLich, kiemThamSoKichHoat, soLuotToiDaMoiGio } from "./kichHoat/lich";
import { xuLyWebhook } from "./kichHoat/webhook";
import { goiToolLuongMcp } from "./kichHoat/mcp";
import { TRAN_ITEM_GOI_CON, TRAN_LUOT_TRONG_CAY } from "../../../shared/flow/model";

const TT = "m5tr";
beforeAll(() => donLuongTheoTienTo(TT)); // Dọn dữ liệu SÓT của lượt trước bị ngắt (afterAll không chạy) — xem flow/__donDuLieuTest.ts
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const db = async () => (await getDb())!;
const ADMIN = () => flowRouter.createCaller({ user: { id: uidAdmin, role: "admin" } } as never);
let uidAdmin = 0;

/** Luồng đơn giản có node CHỜ DUYỆT: lượt dừng ở `cho-duyet` (không chiếm `dang-chay`). */
const dangChay = (id: string, settings?: Record<string, unknown>) => ({
  id: `${TT}-${id}`, name: id, version: 1, ...(settings ? { settings } : {}),
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "du-lieu.dat", { truong: { x: 1 } })],
  connections: [noi("t", "d")],
});

beforeAll(async () => {
  const [u] = (await (await db()).execute(sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" ORDER BY id LIMIT 1`)) as unknown as { id: number }[];
  uidAdmin = u.id;
});
afterAll(async () => {
  const d = await getDb();
  if (!d) return;
  const runs = await d.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await d.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await d.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});
async function chayHet() {
  for (let i = 0; i < 300 && (await chayMotMuc("w-m5", undefined, TT)); i++);
}
const soDangChay = async (flowId: string) =>
  ((await (await db()).execute(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${flowId} AND status = 'dang-chay'`)) as unknown as { n: number }[])[0].n;

describe("M5 (i) — maxConcurrentRuns được thi hành (mặc định 1, từ chối KHÔNG xếp hàng)", () => {
  it("★ KỊCH BẢN AUDIT: lượt thứ hai khi lượt đầu còn chạy ⇒ QUA_TRAN_DONG_THOI; xong lượt đầu ⇒ lượt mới vào được", async () => {
    const def = dangChay("mac-dinh");
    const { version } = await luuPhienBan(def, null);
    await batDauRun({ flowId: def.id, version }); // lượt 1 — chưa chạy ⇒ vẫn `dang-chay`
    await expect(batDauRun({ flowId: def.id, version })).rejects.toMatchObject({ name: "LoiLuong", code: "QUA_TRAN_DONG_THOI", message: expect.stringMatching(/maxConcurrentRuns=1.*KHÔNG xếp hàng|TỪ CHỐI/) });
    expect(await soDangChay(def.id)).toBe(1); // trước bản vá: 2
    await chayHet(); // lượt 1 xong
    await expect(batDauRun({ flowId: def.id, version })).resolves.toBeTruthy();
  });

  it("settings.maxConcurrentRuns = 3 ⇒ đúng 3 lượt vào, lượt thứ 4 bị từ chối", async () => {
    const def = dangChay("ba", { maxConcurrentRuns: 3 });
    const { version } = await luuPhienBan(def, null);
    for (let i = 0; i < 3; i++) await batDauRun({ flowId: def.id, version });
    await expect(batDauRun({ flowId: def.id, version })).rejects.toMatchObject({ code: "QUA_TRAN_DONG_THOI" });
    expect(await soDangChay(def.id)).toBe(3);
  });

  it("hai lượt gọi ĐỒNG THỜI ở trần 1 ⇒ đúng MỘT lượt vào (khoá cố vấn, không cùng lọt qua phép đếm)", async () => {
    const def = dangChay("dua");
    const { version } = await luuPhienBan(def, null);
    const kq = await Promise.allSettled(Array.from({ length: 6 }, () => batDauRun({ flowId: def.id, version })));
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    expect(kq.filter((k) => k.status === "rejected").every((k) => ((k as PromiseRejectedResult).reason as LoiLuong).code === "QUA_TRAN_DONG_THOI")).toBe(true);
  });

  it("lượt CHỜ DUYỆT không chiếm chỗ (không dùng tài nguyên) — nhiều lượt chờ cùng tồn tại; lượt CON được miễn (đã có trần cây lượt)", async () => {
    const def = {
      id: `${TT}-cho`, name: "chờ", version: 1,
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "chờ" })],
      connections: [noi("t", "d")],
    };
    const { version } = await luuPhienBan(def, null);
    for (let i = 0; i < 3; i++) {
      await batDauRun({ flowId: def.id, version });
      await chayHet(); // chạy tới node duyệt ⇒ lượt sang `cho-duyet`
    }
    const [{ n }] = (await (await db()).execute(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${def.id} AND status = 'cho-duyet'`)) as unknown as { n: number }[];
    expect(n).toBe(3);
    // lượt con (parentRunId có) không bị trần của chính luồng con chặn
    const con = dangChay("con-mien");
    const { version: vc } = await luuPhienBan(con, null);
    const cha = await batDauRun({ flowId: def.id, version });
    await expect(chayMotMuc("w-m5", undefined, TT).then(() => true)).resolves.toBe(true);
    await batDauRun({ flowId: con.id, version: vc, parentRunId: cha });
    await expect(batDauRun({ flowId: con.id, version: vc, parentRunId: cha, idempotencyKey: `${TT}-k2` })).resolves.toBeTruthy();
  });

  it("chạy tay (flow.chayTay) vượt trần ⇒ CONFLICT nêu lý do; webhook ⇒ 429 RATE_LIMITED; trùng idempotency-key khi đang bão hoà ⇒ vẫn 202 (không 429)", async () => {
    const def = {
      id: `${TT}-tay`, name: "tay", version: 1,
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("wh", "kich-hoat.webhook"), nut("d", "du-lieu.dat", { truong: { x: 1 } })],
      connections: [noi("t", "d"), noi("wh", "d")],
    };
    const r = await ADMIN().luu({ definition: def });
    const bat = await ADMIN().datPhienBanHoatDong({ flowId: def.id, version: r.version, bat: true });
    const token = bat.tokenWebhook!; // trả THÔ đúng một lần lúc bật
    await ADMIN().chayTay({ flowId: def.id }); // lượt 1 chưa chạy
    await expect(ADMIN().chayTay({ flowId: def.id })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/maxConcurrentRuns/) });
    const wh = await xuLyWebhook({ flowId: def.id, nodeId: "wh", token, than: { a: 1 } });
    expect(wh).toMatchObject({ ma: 429, code: "RATE_LIMITED", retryAfterS: 30 }); // tuyến REST đặt header Retry-After: 30
    await chayHet(); // giải phóng
    const hai = await xuLyWebhook({ flowId: def.id, nodeId: "wh", token, than: { a: 2 }, idemKey: "k-1" });
    expect(hai).toMatchObject({ ma: 202, trung: false });
    // đang bão hoà (lượt webhook chưa chạy) — gửi lại CÙNG idempotency-key ⇒ trả đúng lượt đã có
    const lai = await xuLyWebhook({ flowId: def.id, nodeId: "wh", token, than: { a: 2 }, idemKey: "k-1" });
    expect(lai).toMatchObject({ ma: 202, trung: true });
    expect((lai as { runId: string }).runId).toBe((hai as { runId: string }).runId);
  });

  it("MCP: lượt vượt trần ⇒ lỗi tool nêu lý do (không ném)", async () => {
    const def = {
      id: `${TT}-mcp`, name: "mcp", version: 1,
      nodes: [nut("m", "kich-hoat.mcp", { thamSo: [{ ten: "x", kieu: "chuoi" }] }), nut("d", "du-lieu.dat", { truong: { x: 1 } })],
      connections: [noi("m", "d")],
    };
    const r = await ADMIN().luu({ definition: def });
    await ADMIN().datPhienBanHoatDong({ flowId: def.id, version: r.version, bat: true });
    await batDauRun({ flowId: def.id, version: r.version, nutKichHoat: "m" }); // chiếm chỗ
    const kq = await goiToolLuongMcp(def.id, {}, { userId: uidAdmin, role: "admin" });
    expect(kq).toMatchObject({ loi: true, chu: expect.stringMatching(/Từ chối.*maxConcurrentRuns/) });
  });
});

describe("M5 (ii) — lịch: ≤ 3 node, ≤ 60 lượt/giờ/luồng", () => {
  const lich = (n: number, cron: string) => ({
    nodes: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, type: "kich-hoat.lich", parameters: { cron } })),
  });
  it("soLuotToiDaMoiGio: * ⇒ 60 · */5 ⇒ 12 · 0,30 ⇒ 2 · 1-5 ⇒ 5 · 10-50/10 ⇒ 5 · rác ⇒ 60 (fail-closed)", () => {
    expect(["* * * * *", "*/5 * * * *", "0,30 * * * *", "1-5 * * * *", "10-50/10 * * * *", "x * * * *", "*/0 * * * *"].map(soLuotToiDaMoiGio)).toEqual([60, 12, 2, 5, 5, 60, 60]);
  });
  it("★ KỊCH BẢN AUDIT: 500 node lịch `* * * * *` ⇒ không lưu được; 4 node ⇒ lỗi; 2 node `* * * * *` (120/giờ) ⇒ lỗi; 1 node `* * * * *` (60/giờ) ⇒ hợp lệ", () => {
    expect(kiemThamSoKichHoat(lich(500, "* * * * *")).join(" ")).toMatch(/500 node lịch — tối đa 3/);
    expect(kiemThamSoKichHoat(lich(4, "0 6 * * *")).join(" ")).toMatch(/4 node lịch — tối đa 3/);
    expect(kiemThamSoKichHoat(lich(2, "* * * * *")).join(" ")).toMatch(/120 lượt\/giờ — tối đa 60/);
    expect(kiemThamSoKichHoat(lich(1, "* * * * *"))).toEqual([]);
    expect(kiemThamSoKichHoat(lich(3, "*/5 * * * *"))).toEqual([]); // 36/giờ
  });
  it("router flow.luu từ chối luồng lịch vượt trần (BAD_REQUEST)", async () => {
    const def = { id: `${TT}-nhieu-lich`, name: "nhiều lịch", version: 1, nodes: [...lich(4, "0 6 * * *").nodes.map((n) => nut(n.id, n.type, n.parameters)), nut("d", "du-lieu.dat", { truong: { x: 1 } })], connections: [noi("l0", "d")] };
    await expect(ADMIN().luu({ definition: def })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/tối đa 3/) });
  });
  it("lúc BẮN: đã đủ 60 lượt lịch trong 1 giờ ⇒ bỏ mốc (null), không tạo lượt; còn chỗ ⇒ bắn được", async () => {
    const def = { id: `${TT}-lich-gio`, name: "lịch giờ", version: 1, settings: { maxConcurrentRuns: 100 }, nodes: [nut("l", "kich-hoat.lich", { cron: "*/5 * * * *" }), nut("d", "du-lieu.dat", { truong: { x: 1 } })], connections: [noi("l", "d")] };
    const { version } = await luuPhienBan(def, null);
    const d = await db();
    // 59 lượt lịch trong giờ qua (gieo thẳng) ⇒ còn 1 chỗ
    for (let i = 0; i < 59; i++) {
      await d.execute(sql`INSERT INTO ai_flow_runs (id, "flowId", version, "triggerKind", status) VALUES (gen_random_uuid(), ${def.id}, ${version}, 'lich', 'xong')`);
    }
    const bay = new Date("2026-10-21T10:00:00Z");
    expect(await banLich({ flowId: def.id, version, nodeId: "l", bayGio: bay })).toBeTruthy(); // lượt thứ 60
    expect(await banLich({ flowId: def.id, version, nodeId: "l", bayGio: new Date(bay.getTime() + 300_000) })).toBeNull(); // thứ 61 ⇒ bỏ
    expect(((await d.execute(sql`SELECT count(*)::int AS n FROM ai_flow_runs WHERE "flowId" = ${def.id} AND "triggerKind" = 'lich'`)) as unknown as { n: number }[])[0].n).toBe(60);
  });
  it("lúc BẮN: luồng đã đủ lượt đồng thời ⇒ bỏ mốc (null), không ném", async () => {
    const def = { id: `${TT}-lich-dt`, name: "lịch đồng thời", version: 1, nodes: [nut("l", "kich-hoat.lich", { cron: "*/5 * * * *" }), nut("d", "du-lieu.dat", { truong: { x: 1 } })], connections: [noi("l", "d")] };
    const { version } = await luuPhienBan(def, null);
    expect(await banLich({ flowId: def.id, version, nodeId: "l", bayGio: new Date("2026-10-21T10:00:00Z") })).toBeTruthy();
    expect(await banLich({ flowId: def.id, version, nodeId: "l", bayGio: new Date("2026-10-21T10:05:00Z") })).toBeNull(); // lượt trước chưa xong, trần mặc định 1
  });
});

describe("M5 (iii) — cây lượt con ≤ 50, item vào goi-con ≤ 100", () => {
  it("★ KỊCH BẢN AUDIT: cây lượt đã đủ trần ⇒ goi-con từ chối tạo thêm lượt con; item vượt trần ⇒ từ chối", async () => {
    const con = dangChay("cay-con", { maxConcurrentRuns: 100 });
    const rc = await ADMIN().luu({ definition: con });
    await ADMIN().datPhienBanHoatDong({ flowId: con.id, version: rc.version, bat: true });
    const cha = {
      id: `${TT}-cay-cha`, name: "cha", version: 1, settings: { maxConcurrentRuns: 100 },
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: con.id })],
      connections: [noi("t", "g")],
    };
    const rcha = await ADMIN().luu({ definition: cha });
    // (a) cây còn chỗ: lượt cha bình thường ⇒ chạy xong
    const ok = await batDauRun({ flowId: cha.id, version: rcha.version });
    await chayHet();
    expect((await (await db()).execute(sql`SELECT status FROM ai_flow_runs WHERE id = ${ok}`) as unknown as { status: string }[])[0].status).toBe("xong");
    // (b) cây đã có TRAN_LUOT_TRONG_CAY lượt: gieo 49 lượt con thẳng dưới gốc ⇒ gốc + 49 = 50 ⇒ lượt con thứ 51 bị từ chối
    const goc = await batDauRun({ flowId: cha.id, version: rcha.version });
    const d = await db();
    for (let i = 0; i < TRAN_LUOT_TRONG_CAY - 1; i++) {
      await d.execute(sql`INSERT INTO ai_flow_runs (id, "flowId", version, "triggerKind", status, "parentRunId") VALUES (gen_random_uuid(), ${con.id}, ${rc.version}, 'luong-con', 'xong', ${goc}::uuid)`);
    }
    await chayHet();
    const [r] = (await d.execute(sql`SELECT status, error FROM ai_flow_runs WHERE id = ${goc}`)) as unknown as { status: string; error: unknown }[];
    expect(r.status).toBe("loi");
    expect(JSON.stringify(r.error)).toMatch(new RegExp(`cây lượt .* đã có ${TRAN_LUOT_TRONG_CAY} lượt \\(trần ${TRAN_LUOT_TRONG_CAY}\\)`));
    // (c) item vào goi-con vượt trần
    const nhieu = await batDauRun({ flowId: cha.id, version: rcha.version, items: Array.from({ length: TRAN_ITEM_GOI_CON + 1 }, (_, i) => ({ json: { i } })) });
    await chayHet();
    const [r2] = (await d.execute(sql`SELECT status, error FROM ai_flow_runs WHERE id = ${nhieu}`)) as unknown as { status: string; error: unknown }[];
    expect(r2.status).toBe("loi");
    expect(JSON.stringify(r2.error)).toMatch(new RegExp(`${TRAN_ITEM_GOI_CON + 1} item vào luong.goi-con vượt trần ${TRAN_ITEM_GOI_CON}`));
  });
});
