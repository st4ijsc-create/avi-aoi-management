/**
 * Đợt 9.1 — `flow.chayThuNut` qua `createCaller` trên CSDL `_test`: vai chỉ-đọc bị chặn · KHÔNG tạo hàng nào ở
 * `ai_flow_runs/steps/queue/events/waits` · HTTP chỉ xem trước (không giải mã bí mật) · đề xuất OT chỉ MÔ PHỎNG · output dài bị cắt.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { flowRouter } from "./flowRouter";

const nut = (type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id: "n1", type, typeVersion: 1, name: "n1", position: [0, 0] as [number, number], parameters, ...extra,
});
let uid = 0;
const goi = (role: string) => flowRouter.createCaller({ user: { id: uid, role } } as never);

async function demHang(): Promise<number[]> {
  const db = (await getDb())!;
  const r = (await db.execute(sql`SELECT
    (SELECT count(*) FROM ai_flow_runs)::int AS a, (SELECT count(*) FROM ai_flow_steps)::int AS b,
    (SELECT count(*) FROM ai_flow_queue)::int AS c, (SELECT count(*) FROM ai_flow_events)::int AS d,
    (SELECT count(*) FROM ai_flow_waits)::int AS e`)) as unknown as Record<string, number>[];
  return [r[0].a, r[0].b, r[0].c, r[0].d, r[0].e];
}

beforeAll(async () => {
  const [u] = (await (await getDb())!.execute(sql`SELECT id FROM users ORDER BY id LIMIT 1`)) as unknown as { id: number }[];
  uid = u.id;
});

describe("flow.chayThuNut (Đợt 9.1, DB)", () => {
  it("vai chỉ-đọc (viewer) bị chặn", async () => {
    await expect(goi("viewer").chayThuNut({ nut: nut("du-lieu.dat", { truong: { a: 1 } }) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("chạy thật node lõi; không tạo hàng nào ở bảng lượt chạy", async () => {
    const truoc = await demHang();
    const r = await goi("engineer").chayThuNut({ nut: nut("du-lieu.dat", { truong: { gap: "{{ $json.x * 2 }}" } }), inputs: { main: [{ json: { x: 4 } }] } });
    expect(r).toMatchObject({ che: "chay", ok: true, output: { main: [{ json: { x: 4, gap: 8 } }] } });
    expect(await demHang()).toEqual(truoc);
  });

  it("HTTP: xem trước, không giải mã bí mật (id không có trong CSDL vẫn không lỗi)", async () => {
    const r = await goi("engineer").chayThuNut({
      nut: nut("tich-hop.http-gui", { url: "https://x.example/{{ $json.id }}" }, { credentialRef: "khong-ton-tai" }),
      inputs: { main: [{ json: { id: "Q" } }] },
    });
    expect(r).toMatchObject({ che: "xem-truoc", ok: true, thamSoDaDanhGia: { url: "https://x.example/Q" }, credentialRef: "khong-ton-tai" });
  });

  it("OT: đề xuất lệnh chỉ là yêu cầu chờ duyệt MÔ PHỎNG hoặc bị từ chối — không bao giờ gửi, không ghi hàng chờ", async () => {
    const truoc = await demHang();
    const r = await goi("engineer").chayThuNut({
      nut: nut("ot.de-xuat-lenh", { may: 999999, lenh: "pause" }),
      inputs: { main: [{ json: {} }] },
    });
    expect(r.che).toBe("chay");
    if (r.ok) expect(JSON.stringify(r.cho)).toMatch(/MÔ PHỎNG|moPhong/);
    else expect(r.loi).toBeTruthy();
    expect(JSON.stringify(r)).not.toMatch(/"daGui":\s*true/);
    expect(await demHang()).toEqual(truoc);
  });

  it("đầu ra dài bị cắt như dòng thời gian", async () => {
    const dai = "x".repeat(40_000);
    const r = await goi("engineer").chayThuNut({ nut: nut("du-lieu.dat", { truong: { d: "{{ $json.s }}" } }), inputs: { main: [{ json: { s: dai } }] } });
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ __catBot: true });
  });

  it("node loại lạ ⇒ ok=false kèm lý do; id cổng sai khuôn bị zod từ chối", async () => {
    const r = await goi("engineer").chayThuNut({ nut: nut("khong.co") });
    expect(r.ok).toBe(false);
    await expect(goi("engineer").chayThuNut({ nut: nut("du-lieu.dat"), inputs: { "co khoang": [] } })).rejects.toBeTruthy();
  });
});
