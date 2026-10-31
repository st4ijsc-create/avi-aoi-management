/**
 * Đợt 11.3-C — tầng dữ liệu cổng duyệt kế hoạch trên CSDL THẬT (`_test`, mig 0444): phạm vi chủ, MỘT quyết định thắng, băm máy chủ,
 * lượt đã chết không duyệt được, chốt không đè quyết định của người, trigger bất biến `nguonModel` (0419) không cản cột `keHoach*`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { bamKeHoach, TRAN_SO_BUOC_KE_HOACH } from "@shared/agentCore";
import { getDb } from "./connection";
import { aiAgentRuns } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { chotKeHoachDangCho, chotMoiKeHoachDangCho, docKeHoach, nopKeHoach, quyetKeHoach } from "./aiAgentKeHoach";

const TAG = `akh_${Date.now()}`;
let idA = 0;
let idB = 0;
let coDb = false;
const VIEC = [{ noiDung: "đọc mã" }, { noiDung: "sửa lỗi" }];
const BAM = bamKeHoach(VIEC);

async function mkRun(userId: number, trangThai = "dang-chay"): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db!.insert(aiAgentRuns).values({ id, userId, projectId: "repo", cheDo: "sua", cauHoi: "q", trangThai });
  return id;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  idA = (await taoNguoiDungTest("a", "engineer", { tienTo: "akh", ts: TAG })).id;
  idB = (await taoNguoiDungTest("b", "engineer", { tienTo: "akh", ts: TAG })).id;
});

afterAll(async () => {
  const db = await getDb();
  if (!db || !coDb) return;
  await db.delete(aiAgentRuns).where(inArray(aiAgentRuns.userId, [idA, idB]));
});

describe("nopKeHoach / docKeHoach", () => {
  it("★★★ nộp ⇒ băm do MÁY CHỦ tính (chữ thuần), trạng thái 'cho', chưa có người/giờ duyệt", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    const r = await nopKeHoach(idA, id, [{ noiDung: `đọc   mã${String.fromCodePoint(0x202e)}`, trangThai: "xong" }, { noiDung: "sửa lỗi" }]);
    expect(r?.bam).toBe(BAM);
    expect(r?.viec.map((v) => v.noiDung)).toEqual(["đọc mã", "sửa lỗi"]);
    const h = await docKeHoach(idA, id);
    expect(h).toMatchObject({ bam: BAM, trangThai: "cho", duyetLuc: null, duyetBoi: null });
    expect(h?.nopLuc).toBeInstanceOf(Date);
  });
  it("★★★ phạm vi chủ: người khác không nộp/đọc được lượt của A (≡ không tồn tại)", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    expect(await nopKeHoach(idB, id, VIEC)).toBeNull();
    expect(await nopKeHoach(idA, id, VIEC)).not.toBeNull();
    expect(await docKeHoach(idB, id)).toBeNull();
  });
  it("vượt trần / rỗng / id méo ⇒ null, không ghi", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    const nhieu = Array.from({ length: TRAN_SO_BUOC_KE_HOACH + 1 }, (_, i) => ({ noiDung: `b${i}` }));
    expect(await nopKeHoach(idA, id, nhieu)).toBeNull();
    expect(await nopKeHoach(idA, id, [])).toBeNull();
    expect(await nopKeHoach(idA, "khong-phai-uuid", VIEC)).toBeNull();
    expect(await docKeHoach(idA, id)).toBeNull();
  });
  it("★★★ lượt đã kết thúc ⇒ KHÔNG nộp được", async () => {
    if (!coDb) return;
    for (const tt of ["xong", "huy", "loi", "gian-doan"]) {
      const id = await mkRun(idA, tt);
      expect(await nopKeHoach(idA, id, VIEC)).toBeNull();
    }
  });
  it("nộp lại sau khi đổi bước ⇒ ghi đè, xoá giờ/người duyệt cũ", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    await nopKeHoach(idA, id, VIEC);
    expect((await quyetKeHoach(idA, id, BAM, "duyet")).ok).toBe(true);
    const moi = await nopKeHoach(idA, id, [...VIEC, { noiDung: "chạy test" }]);
    expect(moi?.bam).not.toBe(BAM);
    const h = await docKeHoach(idA, id);
    expect(h).toMatchObject({ bam: moi?.bam, trangThai: "cho", duyetLuc: null, duyetBoi: null });
  });
});

describe("quyetKeHoach", () => {
  it("★★★ duyệt ⇒ ghi người + giờ; lần hai ⇒ DA_QUYET", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    await nopKeHoach(idA, id, VIEC);
    const r = await quyetKeHoach(idA, id, BAM, "duyet");
    expect(r).toMatchObject({ ok: true, trangThai: "duyet" });
    expect(await docKeHoach(idA, id)).toMatchObject({ trangThai: "duyet", duyetBoi: idA });
    expect(await quyetKeHoach(idA, id, BAM, "bac")).toEqual({ ok: false, ma: "DA_QUYET" });
    // đã quyết + băm KHÁC ⇒ vẫn DA_QUYET (không để lộ CONFLICT khi không còn gì để tranh)
    expect(await quyetKeHoach(idA, id, "0".repeat(64), "bac")).toEqual({ ok: false, ma: "DA_QUYET" });
    expect((await docKeHoach(idA, id))?.trangThai).toBe("duyet");
  });
  it("★★★ băm sai ⇒ CONFLICT, vẫn 'cho'; chưa nộp ⇒ NOT_FOUND; người khác ⇒ NOT_FOUND", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    expect(await quyetKeHoach(idA, id, BAM, "duyet")).toEqual({ ok: false, ma: "NOT_FOUND" });
    await nopKeHoach(idA, id, VIEC);
    expect(await quyetKeHoach(idA, id, "0".repeat(64), "duyet")).toEqual({ ok: false, ma: "CONFLICT" });
    expect(await quyetKeHoach(idB, id, BAM, "duyet")).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect((await docKeHoach(idA, id))?.trangThai).toBe("cho");
  });
  it("★★★ lượt đã chết ⇒ không duyệt được dù kế hoạch còn 'cho'", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    await nopKeHoach(idA, id, VIEC);
    const db = await getDb();
    await db!.update(aiAgentRuns).set({ trangThai: "huy" }).where(eq(aiAgentRuns.id, id));
    expect((await quyetKeHoach(idA, id, BAM, "duyet")).ok).toBe(false);
    expect((await docKeHoach(idA, id))?.trangThai).toBe("cho");
  });
  it("★★★ đua: duyệt và bác cùng lúc ⇒ ĐÚNG MỘT bên thắng", async () => {
    if (!coDb) return;
    for (let i = 0; i < 5; i++) {
      const id = await mkRun(idA);
      await nopKeHoach(idA, id, VIEC);
      const [x, y] = await Promise.all([quyetKeHoach(idA, id, BAM, "duyet"), quyetKeHoach(idA, id, BAM, "bac")]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      const thang = x.ok ? "duyet" : "bac";
      expect((await docKeHoach(idA, id))?.trangThai).toBe(thang);
    }
  });
  it("băm cũ sau khi nộp lại ⇒ CONFLICT (không duyệt nhầm kế hoạch mới bằng băm cũ)", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    await nopKeHoach(idA, id, VIEC);
    await nopKeHoach(idA, id, [{ noiDung: "việc khác hẳn" }]);
    expect(await quyetKeHoach(idA, id, BAM, "duyet")).toEqual({ ok: false, ma: "CONFLICT" });
  });
});

describe("chốt của host", () => {
  it("★★★ chốt có điều kiện: KHÔNG đè quyết định đã có của người", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    await nopKeHoach(idA, id, VIEC);
    await quyetKeHoach(idA, id, BAM, "duyet");
    expect(await chotKeHoachDangCho(idA, id, BAM, "het-gio")).toBe(false);
    await chotMoiKeHoachDangCho(idA, id);
    expect((await docKeHoach(idA, id))?.trangThai).toBe("duyet");
  });
  it("★★★ chốt kế hoạch CŨ (băm khác) KHÔNG đè kế hoạch mới đang chờ", async () => {
    if (!coDb) return;
    const id = await mkRun(idA);
    await nopKeHoach(idA, id, VIEC);
    const moi = await nopKeHoach(idA, id, [{ noiDung: "kế hoạch mới" }]);
    expect(await chotKeHoachDangCho(idA, id, BAM, "bac")).toBe(false);
    expect(await docKeHoach(idA, id)).toMatchObject({ bam: moi?.bam, trangThai: "cho" });
  });
  it("còn 'cho' ⇒ chốt được (het-gio) và dọn cuối lượt ⇒ 'bac'", async () => {
    if (!coDb) return;
    const a = await mkRun(idA);
    await nopKeHoach(idA, a, VIEC);
    expect(await chotKeHoachDangCho(idA, a, BAM, "het-gio")).toBe(true);
    expect((await docKeHoach(idA, a))?.trangThai).toBe("het-gio");
    const b = await mkRun(idA);
    await nopKeHoach(idA, b, VIEC);
    await chotMoiKeHoachDangCho(idA, b);
    expect((await docKeHoach(idA, b))?.trangThai).toBe("bac");
    const c = await mkRun(idA);
    await nopKeHoach(idA, c, VIEC);
    expect(await chotKeHoachDangCho(idB, c, BAM, "bac")).toBe(false); // người khác không chốt được
    expect((await docKeHoach(idA, c))?.trangThai).toBe("cho");
  });
});

describe("trigger bất biến nguonModel (mig 0419, nếu có) không cản cột keHoach*", () => {
  it("★★★ hàng có nguonModel ⇒ nộp + duyệt kế hoạch vẫn được", async () => {
    if (!coDb) return;
    const db = await getDb();
    const co = await db!.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_agent_runs' AND column_name='nguonModel'`);
    if ((co as unknown as unknown[]).length === 0) return; // CSDL chưa có 0419
    const id = randomUUID();
    await db!.execute(sql`INSERT INTO public.ai_agent_runs (id, "userId", "projectId", "cheDo", "cauHoi", "nguonModel") VALUES (${id}, ${idA}, 'repo', 'hoi', 'q', 'ngoai:probe:model-1')`);
    expect(await nopKeHoach(idA, id, VIEC)).not.toBeNull();
    expect((await quyetKeHoach(idA, id, BAM, "duyet")).ok).toBe(true);
    const [h] = await db!.execute(sql`SELECT "nguonModel" AS n FROM public.ai_agent_runs WHERE id = ${id}`) as unknown as Array<{ n: string }>;
    expect(h.n).toBe("ngoai:probe:model-1");
  });
});
