/**
 * ★★ Đợt 8.2 Task 1–2 — BÍ MẬT trên CSDL `_test` (mig 0403 phải đã áp) + LƯỚI BẤT BIẾN KHÔNG RÒ.
 *
 * Luồng THẬT qua động cơ (`luuPhienBan` → `batDauRun` → `chayMotMuc`), node HTTP dùng `credentialRef`, đích HTTP GIẢ ghi lại
 * tiêu đề nhận được. Đích giả còn cố tình (a) PHẢN HỒI LẠI tiêu đề trong thân, (b) NÉM lỗi lặp lại tiêu đề — hai đường rò
 * thật. Sau mọi lượt: KHÔNG một biến thể nào của giá trị (nguyên văn, base64, base64url, mã URL, phần mật khẩu) xuất hiện
 * trong `ai_flow_steps` (input/output/error), `ai_flow_events`, `ai_flow_runs.error`, `ai_flow_versions.definition`, bảng
 * `ai_flow_credentials` (cột nào cũng vậy) hay stdout/stderr/console đã bắt.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowCredentials, aiFlowRuns, aiFlows } from "../../../drizzle/schema";
import { bienTheBiMat, giaiMaChoChay, lietKeBiMat, taoBiMat, xoaBiMat } from "./biMat";
import { batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";
import { BO_KIEM_CHO_QUA, __datBoKiemChuLuongChoTest } from "./boKiemPhamVi";
import { datFetchLuong } from "./nut/tichHop";

const TT = "t8bm";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, them: Record<string, unknown> = {}) => ({
  id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...them,
});
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });

const TOKEN = `tok-${randomBytes(18).toString("hex")}`;
const TAI_KHOAN = `nguoi-dung:${randomBytes(12).toString("base64url")}+/=`;
const API_KEY = `key-${randomBytes(16).toString("hex")}`;
const BIEN_THE = [...bienTheBiMat(TOKEN, "token"), ...bienTheBiMat(TAI_KHOAN, "tai-khoan"), ...bienTheBiMat(API_KEY, "token")];

const giuEnv = { k: process.env.AI_FLOW_KHOA_BI_MAT, h: process.env.AI_FLOW_HTTP_HOST_CHO_PHEP, pb: process.env.AI_FLOW_KHOA_BI_MAT_PHIEN_BAN };
const nhan: { url: string; headers: Record<string, string> }[] = [];
let cheDoDich: "vong-lai" | "nem" = "vong-lai";
let fetchCu: typeof fetch// Lưới này kiểm bí mật / luồng con qua động cơ, KHÔNG phải phạm vi ⇒ cho-qua-hết; phạm vi thật: flowPhamViLuong.db.test.ts
beforeAll(() => __datBoKiemChuLuongChoTest(async () => BO_KIEM_CHO_QUA));
afterAll(() => __datBoKiemChuLuongChoTest(null));

;
const batDuoc: string[] = [];
const spies: { mockRestore(): void }[] = [];

beforeAll(async () => {
  process.env.AI_FLOW_KHOA_BI_MAT = randomBytes(32).toString("base64");
  delete process.env.AI_FLOW_KHOA_BI_MAT_PHIEN_BAN;
  process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "dich.gia";
  fetchCu = datFetchLuong((async (url: URL, init: RequestInit) => {
    const headers = { ...(init.headers as Record<string, string>) };
    nhan.push({ url: String(url), headers });
    if (cheDoDich === "nem") throw new Error(`kết nối hỏng khi gửi tiêu đề ${JSON.stringify(headers)}`);
    return new Response(JSON.stringify({ daNhan: headers }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch);
  const bat = (...a: unknown[]) => void batDuoc.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  for (const m of ["log", "info", "warn", "error", "debug"] as const) spies.push(vi.spyOn(console, m).mockImplementation(bat));
  for (const s of [process.stdout, process.stderr]) {
    const goc = s.write.bind(s);
    spies.push(vi.spyOn(s, "write").mockImplementation(((c: unknown, ...r: unknown[]) => {
      batDuoc.push(String(c));
      return (goc as (...x: unknown[]) => boolean)(c, ...r);
    }) as never));
  }
  await taoBiMat({ id: `${TT}-tok`, ten: "token ERP", loai: "token", giaTri: TOKEN, hostChoPhep: ["dich.gia"] }, null);
  await taoBiMat({ id: `${TT}-tk`, ten: "tài khoản MES", loai: "tai-khoan", giaTri: TAI_KHOAN, hostChoPhep: ["dich.gia"] }, null);
  await taoBiMat({ id: `${TT}-key`, ten: "khoá API", loai: "token", giaTri: API_KEY, hostChoPhep: ["dich.gia"] }, null);
});

afterAll(async () => {
  for (const s of spies) s.mockRestore();
  datFetchLuong(fetchCu);
  for (const [k, v] of [["AI_FLOW_KHOA_BI_MAT", giuEnv.k], ["AI_FLOW_HTTP_HOST_CHO_PHEP", giuEnv.h], ["AI_FLOW_KHOA_BI_MAT_PHIEN_BAN", giuEnv.pb]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
});

async function chayHet(tran = 100): Promise<void> {
  for (let i = 0; i < tran && (await chayMotMuc("w-bm", undefined, TT)); i++);
}

async function luongHttp(ten: string, nodeHttp: ReturnType<typeof nut>): Promise<string> {
  if (!ten.startsWith("nem")) cheDoDich = "vong-lai";
  const { version } = await luuPhienBan({ id: `${TT}-${ten}`, name: ten, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nodeHttp], connections: [noi("t", nodeHttp.id)] }, null);
  const run = await batDauRun({ flowId: `${TT}-${ten}`, version, items: [{ json: { ma: "P1" } }] });
  await chayHet();
  return run;
}

const trangThai = async (run: string) => ((await (await getDb())!.execute(sql`SELECT status FROM ai_flow_runs WHERE id = ${run}`)) as unknown as { status: string }[])[0]?.status;

describe("bí mật Luồng AI (Đợt 8.2, DB)", () => {
  it("liệt kê KHÔNG có giá trị / bản mã; trùng id ⇒ DA_CO; giải mã nội bộ đúng; xoá", async () => {
    const ds = (await lietKeBiMat()).filter((b) => b.id.startsWith(TT));
    expect(ds.map((b) => b.id)).toEqual([`${TT}-key`, `${TT}-tk`, `${TT}-tok`]);
    for (const b of ds) expect(Object.keys(b).sort()).toEqual(["createdAt", "createdBy", "id", "loai", "phienBanKhoa", "ten"]);
    await expect(taoBiMat({ id: `${TT}-tok`, ten: "x", loai: "token", giaTri: "khac-gia-tri" }, null)).rejects.toMatchObject({ code: "DA_CO" });
    expect((await giaiMaChoChay(`${TT}-tok`)).giaTri).toBe(TOKEN);
    await taoBiMat({ id: `${TT}-tam`, ten: "tạm", loai: "khac", giaTri: "tam-thoi-1" }, null);
    expect(await xoaBiMat(`${TT}-tam`)).toBe(true);
    expect(await xoaBiMat(`${TT}-tam`)).toBe(false);
    await expect(giaiMaChoChay(`${TT}-tam`)).rejects.toMatchObject({ code: "KHONG_CO" });
  });

  it("bearer: đích nhận ĐÚNG tiêu đề; đích vọng lại tiêu đề trong thân ⇒ đầu ra bước bị che", async () => {
    cheDoDich = "vong-lai";
    nhan.length = 0;
    const run = await luongHttp("bearer", nut("h", "tich-hop.http-doc", { url: "http://dich.gia/a/{{ $json.ma }}", kieuXacThuc: "bearer" }, { credentialRef: `${TT}-tok` }));
    expect(await trangThai(run)).toBe("xong");
    expect(nhan).toHaveLength(1);
    expect(nhan[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const [b] = (await (await getDb())!.execute(sql`SELECT output::text AS o FROM ai_flow_steps WHERE "runId" = ${run} AND "nodeId" = 'h'`)) as unknown as { o: string }[];
    expect(b.o).toContain("[BI_MAT]");
  });

  it("basic + header:<tên>: đích nhận đúng; http-gui vẫn gửi Idempotency-Key", async () => {
    cheDoDich = "vong-lai";
    nhan.length = 0;
    await luongHttp("basic", nut("h", "tich-hop.http-doc", { url: "http://dich.gia/b", kieuXacThuc: "basic" }, { credentialRef: `${TT}-tk` }));
    await luongHttp("hdr", nut("h", "tich-hop.http-gui", { url: "http://dich.gia/c", than: { a: 1 }, kieuXacThuc: "header:X-Api-Key" }, { credentialRef: `${TT}-key` }));
    expect(nhan[0].headers.Authorization).toBe(`Basic ${Buffer.from(TAI_KHOAN).toString("base64")}`);
    expect(nhan[1].headers["X-Api-Key"]).toBe(API_KEY);
    expect(nhan[1].headers["Idempotency-Key"]).toMatch(/:h:1$/);
  });

  it("lỗi fetch LẶP LẠI tiêu đề (thử lại 1 lần) ⇒ error của bước, sự kiện thử lại, lỗi của lượt đều bị che", async () => {
    cheDoDich = "nem";
    const run = await luongHttp("nem", nut("h", "tich-hop.http-doc", { url: "http://dich.gia/d", kieuXacThuc: "bearer" }, { credentialRef: `${TT}-tok`, retry: { max: 1, backoffMs: 0 } }));
    expect(await trangThai(run)).toBe("loi");
    const loi = (await (await getDb())!.execute(sql`SELECT error::text AS e FROM ai_flow_steps WHERE "runId" = ${run} AND "nodeId" = 'h'`)) as unknown as { e: string }[];
    expect(loi).toHaveLength(2);
    for (const l of loi) expect(l.e).toContain("[BI_MAT]");
  });

  it("cấu hình sai bị chặn: node không nhận bí mật có credentialRef ⇒ không lưu; thiếu kieuXacThuc / bí mật không có ⇒ lỗi node", async () => {
    await expect(
      luuPhienBan({ id: `${TT}-sai`, name: "sai", version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "du-lieu.dat", {}, { credentialRef: `${TT}-tok` })], connections: [noi("t", "d")] }, null),
    ).rejects.toMatchObject({ code: "LUONG_KHONG_HOP_LE", message: expect.stringMatching(/không nhận bí mật/) });
    const r1 = await luongHttp("thieu-kieu", nut("h", "tich-hop.http-doc", { url: "http://dich.gia/e" }, { credentialRef: `${TT}-tok` }));
    expect(await trangThai(r1)).toBe("loi");
    const r2 = await luongHttp("khong-co", nut("h", "tich-hop.http-doc", { url: "http://dich.gia/e", kieuXacThuc: "bearer" }, { credentialRef: `${TT}-khong-co` }));
    expect(await trangThai(r2)).toBe("loi");
    const r3 = await luongHttp("tay", nut("h", "tich-hop.http-doc", { url: "http://dich.gia/e", kieuXacThuc: "bearer", tieuDe: { authorization: "{{ $json.ma }}" } }, { credentialRef: `${TT}-tok` }));
    expect(await trangThai(r3)).toBe("loi");
  });

  it("thiếu khoá (fail-closed): node dùng bí mật ⇒ lỗi rõ; luồng KHÔNG dùng bí mật vẫn chạy", async () => {
    const giu = process.env.AI_FLOW_KHOA_BI_MAT;
    delete process.env.AI_FLOW_KHOA_BI_MAT;
    try {
      const r = await luongHttp("khong-khoa", nut("h", "tich-hop.http-doc", { url: "http://dich.gia/f", kieuXacThuc: "bearer" }, { credentialRef: `${TT}-tok` }));
      expect(await trangThai(r)).toBe("loi");
      const [e] = (await (await getDb())!.execute(sql`SELECT error::text AS e FROM ai_flow_runs WHERE id = ${r}`)) as unknown as { e: string }[];
      expect(e.e).toMatch(/AI_FLOW_KHOA_BI_MAT/);
      const r2 = await luongHttp("khong-bi-mat", nut("h", "tich-hop.http-doc", { url: "http://dich.gia/g" }));
      expect(await trangThai(r2)).toBe("xong");
      await expect(taoBiMat({ id: `${TT}-x`, ten: "x", loai: "token", giaTri: "abcdefgh" }, null)).rejects.toMatchObject({ code: "THIEU_KHOA" });
    } finally {
      process.env.AI_FLOW_KHOA_BI_MAT = giu;
    }
  });

  it("★ BẤT BIẾN KHÔNG RÒ: không biến thể nào của 3 giá trị trong bước / sự kiện / lượt / định nghĩa / bảng bí mật / log", async () => {
    const db = (await getDb())!;
    const kho = (await db.execute(sql`
      SELECT coalesce(s.input::text, '') || ' ' || coalesce(s.output::text, '') || ' ' || coalesce(s.error::text, '') AS t
        FROM ai_flow_steps s JOIN ai_flow_runs r ON r.id = s."runId" WHERE r."flowId" LIKE ${TT + "%"}
      UNION ALL SELECT coalesce(e.payload::text, '') FROM ai_flow_events e JOIN ai_flow_runs r ON r.id = e."runId" WHERE r."flowId" LIKE ${TT + "%"}
      UNION ALL SELECT coalesce(error::text, '') FROM ai_flow_runs WHERE "flowId" LIKE ${TT + "%"}
      UNION ALL SELECT definition::text FROM ai_flow_versions WHERE "flowId" LIKE ${TT + "%"}
      UNION ALL SELECT row_to_json(c)::text || encode(c."banMa", 'escape') FROM ai_flow_credentials c WHERE c.id LIKE ${TT + "%"}`)) as unknown as { t: string }[];
    expect(kho.length).toBeGreaterThan(20);
    const tatCa = [...kho.map((k) => k.t), ...batDuoc].join("\n");
    expect(nhan.length, "đích giả phải đã thật sự nhận giá trị (chứng minh luồng có dùng bí mật)").toBeGreaterThanOrEqual(4);
    for (const v of BIEN_THE) expect(tatCa.includes(v), `rò biến thể dài ${v.length}`).toBe(false);
    expect(tatCa).toContain("[BI_MAT]");
  });
});
