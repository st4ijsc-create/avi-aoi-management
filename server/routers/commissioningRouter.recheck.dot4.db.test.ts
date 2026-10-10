/**
 * doc 81 Đợt 4 Task C3 — `commissioning.status.commissioningRecheck`: thay đổi ghim DỪNG MỚI NHẤT gắn cờ soát lại
 * xảy ra SAU bản ký hiện tại; ký lại ⇒ null. So thời điểm trên server (createdAt của CSDL), không đồng hồ client.
 *
 * DB `_test` THẬT (vitest.setup ép; cầu chì `/_test\b/`). Đường thật: ký bằng `commissioning.create`, đổi ghim bằng
 * `deviceAdapter.tags.setStopPin` / `tags.update` / `deviceAdapter.update`. Oracle độc lập: id dòng control_audit_log
 * đọc bằng SELECT thô.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { commissioningRouter } from "./commissioningRouter";
import { deviceAdapterRouter } from "./deviceAdapterRouter";

const DB_URL = process.env.DATABASE_URL;
const RUN = `C3RC${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let userId = 0;
let aA = 0;
let aB = 0;
let tA = 0;
let tA2 = 0;
let tB = 0;

const admin = () => ({ user: { id: userId, role: "admin", name: "C3 admin", twoFactorEnabled: true } }) as any;
const comm = () => commissioningRouter.createCaller(admin());
const dev = () => deviceAdapterRouter.createCaller(admin());
const ghim = (adapterId: number, tagKey: string, stopValue: unknown) =>
  dev().tags.setStopPin({ adapterId, tagKey, stopValue, reason: `C3 ghim ${tagKey}` });
const auditCuoi = async (tagId: number) =>
  Number((await sql<{ id: number }[]>`SELECT max(id)::int AS id FROM control_audit_log WHERE "entityType" = 'device_tag_stop_pin' AND "entityId" = ${String(tagId)}`)[0].id);
/** Bảo đảm createdAt của bước sau lớn hơn hẳn bước trước (cùng mili-giây hiếm nhưng có thể). */
const nghi = () => new Promise((r) => setTimeout(r, 15));

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("doc 81 Đợt 4 C3 — commissioning.status: cần soát lại commissioning (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    userId = Number((await sql`INSERT INTO users ("openId", name, role, "isActive") VALUES (${`${RUN}-admin`}, 'C3 admin', 'admin', true) RETURNING id`)[0].id);
    const adapter = async (hau: string) =>
      Number((await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
                        VALUES (${`${RUN}-${hau}`}, ${`C3 ${hau}`}, 'stub', ${`stub://c3-${hau}`}, false) RETURNING id`)[0].id);
    aA = await adapter("A");
    aB = await adapter("B");
    const tag = async (adapterId: number, key: string) =>
      Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale, "offset")
                        VALUES (${adapterId}, ${key}, ${`DB1.${key}`}, 'bool', true, true, 1, 0) RETURNING id`)[0].id);
    tA = await tag(aA, "stop_cmd");
    tA2 = await tag(aA, "stop_b");
    tB = await tag(aB, "stop_cmd");
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM commissioning_records WHERE "adapterId" IN (${aA}, ${aB})`;
    await sql`DELETE FROM device_tags WHERE "adapterId" IN (${aA}, ${aB})`;
    await sql`DELETE FROM device_adapters WHERE id IN (${aA}, ${aB})`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  // Các ca CHẠY THEO THỨ TỰ (một vòng đời của adapter A).
  it("chưa ký: đổi ghim (cờ soát lại = false) ⇒ commissioningRecheck null", async () => {
    await ghim(aA, "stop_cmd", true);
    const st = await comm().status({ adapterId: aA });
    expect(st.commissioned).toBe(false);
    expect(st.commissioningRecheck).toBeNull();
    expect(st.commissioningRecheckUnreadable).toBe(false);
  });

  it("ký xong, CHƯA đổi gì ⇒ null (thay đổi trước bản ký không tính)", async () => {
    await nghi();
    await comm().create({ adapterId: aA, fatReference: "FAT-C3-1" });
    const st = await comm().status({ adapterId: aA });
    expect(st.commissioned).toBe(true);
    expect(st.commissioningRecheck).toBeNull();
  });

  it("★ đổi ghim SAU bản ký ⇒ trả đúng dòng audit đó (tag, hành động, người đổi)", async () => {
    await nghi();
    await ghim(aA, "stop_cmd", false);
    const st = await comm().status({ adapterId: aA });
    expect(st.commissioningRecheck).toMatchObject({
      auditId: await auditCuoi(tA), tagId: tA, tagKey: "stop_cmd", action: "stop_pin_set", autoClearedBy: null, actorId: userId,
    });
  });

  it("★ hai thay đổi sau bản ký ⇒ trả cái MỚI NHẤT (gỡ tự động khi tắt tag kia)", async () => {
    await ghim(aA, "stop_b", true);
    await dev().tags.update({ id: tA2, isEnabled: false });
    const st = await comm().status({ adapterId: aA });
    expect(st.commissioningRecheck).toMatchObject({ auditId: await auditCuoi(tA2), tagKey: "stop_b", action: "stop_pin_clear", autoClearedBy: "tag_disabled" });
  });

  it("thay đổi ở adapter KHÁC không lọt sang (B chưa ký ⇒ null; B ký rồi đổi ⇒ B thấy của B, A vẫn chỉ thấy của A)", async () => {
    await ghim(aB, "stop_cmd", true);
    expect((await comm().status({ adapterId: aB })).commissioningRecheck).toBeNull();
    await nghi();
    await comm().create({ adapterId: aB, fatReference: "FAT-C3-B" });
    await nghi();
    await ghim(aB, "stop_cmd", false); // cờ soát lại = true, MỚI hơn mọi thay đổi của A
    expect((await comm().status({ adapterId: aB })).commissioningRecheck?.tagId).toBe(tB);
    expect((await comm().status({ adapterId: aA })).commissioningRecheck?.tagId).toBe(tA2);
  });

  it("dòng audit ghim KHÔNG gắn cờ soát lại (vd dòng cũ / ghi tay) sau bản ký không được tính", async () => {
    await sql`INSERT INTO control_audit_log ("entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason)
              VALUES ('device_tag_stop_pin', ${String(tA)}, 'stop_pin_set', ${userId}, '{}'::jsonb,
                      ${sql.json({ tagKey: "stop_cmd", adapterId: aA, dataType: "bool", stopValue: true, commissioningRecheckRequired: false })}, 'C3 khong co')`;
    expect((await comm().status({ adapterId: aA })).commissioningRecheck?.tagId).toBe(tA2);
  });

  it("★ KÝ LẠI ⇒ chip tắt (null); đổi tiếp sau bản ký mới ⇒ hiện lại", async () => {
    await nghi();
    await comm().create({ adapterId: aA, fatReference: "FAT-C3-2" });
    expect((await comm().status({ adapterId: aA })).commissioningRecheck).toBeNull();
    await nghi();
    await dev().update({ id: aA, endpoint: "stub://c3-A-moi" }); // đổi đích ⇒ gỡ MỌI ghim (stop_cmd đang ghim)
    const st = await comm().status({ adapterId: aA });
    expect(st.commissioningRecheck).toMatchObject({ tagId: tA, autoClearedBy: "adapter_redefined" });
  });

  it("thu hồi MỌI bản ký ⇒ không commissioned ⇒ null (cổng đã ép mô phỏng, không còn gì để soát)", async () => {
    await sql`UPDATE commissioning_records SET status = 'revoked' WHERE "adapterId" = ${aA}`;
    const st = await comm().status({ adapterId: aA });
    expect(st.commissioned).toBe(false);
    expect(st.commissioningRecheck).toBeNull();
  });

  it("bản ký active nhưng HẾT HẠN không tính là bản ký hiện tại ⇒ null", async () => {
    // Ký 2 ngày trước (trước MỌI thay đổi của file này), hết hạn hôm qua: nếu bị coi là "bản ký hiện tại" thì mọi
    // thay đổi hôm nay sẽ hiện thành cần soát lại.
    await sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "signedAt", "expiresAt", "createdAt")
              VALUES (${aA}, 'active', ${userId}, now() - interval '2 day', now() - interval '1 day', now() - interval '2 day')`;
    expect((await comm().status({ adapterId: aA })).commissioningRecheck).toBeNull();
  });
});
