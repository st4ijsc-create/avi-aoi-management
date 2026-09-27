/**
 * doc 81 Đợt 1B final wave 5b — luật "nhập lại bí mật" (item 5) phải đứng vững trước HAI yêu cầu
 * ĐỒNG THỜI. CSDL THẬT (`_test`, vitest.setup ép DATABASE_URL): khoá hàng chỉ kiểm được trên Postgres.
 *
 * Lỗ được ghim (re-review): update đọc hàng bằng SELECT thường (không giao dịch, không FOR UPDATE)
 * rồi UPDATE vô điều kiện. Kịch bản: B gửi CHỈ connectionOptions mang "[redacted]"; A đổi endpoint
 * sang host kẻ tấn công KÈM bí mật mới. B đọc TRƯỚC khi A commit và ghi SAU ⇒ hàng kết thúc với
 * endpoint của A + bí mật CŨ đã lưu do B khôi phục ⇒ bí mật cũ đi tới host kẻ tấn công.
 *
 * Race CƯỠNG BỨC (cùng khuôn commandDispatcher.dot1b.db.test.ts): một giao dịch ngoài giữ khoá hàng
 * adapter (SELECT … FOR UPDATE) trong lúc B xếp hàng; A (chính giao dịch ấy) ghi endpoint mới + bí
 * mật mới rồi commit; B mới được đi tiếp. Bất biến: bí mật CŨ không bao giờ được ghép với endpoint
 * của A. Với bản vá, B đọc-kiểm-khôi phục-ghi trong MỘT giao dịch dưới FOR UPDATE nên luôn kiểm trên
 * đúng hàng sắp bị ghi đè: (1) B không gửi endpoint ⇒ placeholder khôi phục bí mật CỦA A (A tự cung
 * cấp) — chấp nhận được; (2) B gửi form cũ (endpoint E0) ⇒ endpoint khác hàng của A ⇒ bị từ chối.
 * Đột biến: bỏ FOR UPDATE ⇒ (1) ĐỎ (B khôi phục bí mật cũ lên endpoint của A).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { like } from "drizzle-orm";
import postgres from "postgres";

// RBAC có test riêng (deviceAdapterRouter.test.ts); ở đây chỉ mở cổng để tới được CSDL thật.
vi.mock("../_core/accessControl", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

import { getDb } from "../db";
import { deviceAdapters } from "../../drizzle/schema";
import { deviceAdapterRouter } from "./deviceAdapterRouter";
import { encryptSecret, decryptSecret } from "../services/security/secretBox";

const DB_URL = process.env.DATABASE_URL;
const DAU = `FW5B-${Date.now()}`;
const E0 = "opc.tcp://10.0.0.5:4840";
const ATTACKER = "opc.tcp://attacker.example:4840";
const STORED_PW = "Stored-Pw-5b";
const A_PW = "Attacker-Own-Pw";
const SEC = { securityMode: "SignAndEncrypt", securityPolicy: "Basic256Sha256" } as const;

const ctx = { user: { id: 990_500_950, role: "supervisor", name: "race" } } as any;
const caller = deviceAdapterRouter.createCaller(ctx);
let seq = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

async function seedAdapter(): Promise<number> {
  const a = await caller.create({
    code: `${DAU}-${++seq}`,
    name: `${DAU} adapter`,
    protocol: "opcua",
    endpoint: E0,
    connectionOptions: { userName: "op", password: STORED_PW, ...SEC },
  });
  return a.id;
}

async function rowOf(id: number): Promise<{ endpoint: string; options: any }> {
  const [r] = await (await d()).select().from(deviceAdapters).where(like(deviceAdapters.code, `${DAU}%`)).then((rows) => rows.filter((x) => x.id === id));
  return { endpoint: r!.endpoint, options: r!.connectionOptions as any };
}

/**
 * Giữ khoá hàng `id` bằng giao dịch ngoài; khi `whenLocked` xong (B đã xếp hàng), A ghi endpoint
 * ATTACKER + bí mật mới A_PW rồi commit.
 */
async function raceAgainstA(id: number, whenLocked: () => Promise<void>): Promise<void> {
  const ext = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  try {
    const aOpts = JSON.stringify({ userName: "op", password: encryptSecret(A_PW), ...SEC });
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = ext.begin(async (tx) => {
      await tx`SELECT id FROM device_adapters WHERE id = ${id} FOR UPDATE`;
      locked();
      await gate;
      await tx`UPDATE device_adapters SET endpoint = ${ATTACKER}, "connectionOptions" = ${aOpts}::json WHERE id = ${id}`;
    });
    await lockedP;
    await whenLocked();
    release();
    await holder;
  } finally {
    await ext.end();
  }
}

const settle = <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!DB_URL)("deviceAdapterRouter.update — bí mật đã lưu không bao giờ đi theo endpoint của người khác (race CSDL _test)", () => {
  beforeAll(() => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "task12-router-test-key";
  });
  afterAll(async () => {
    await (await d()).delete(deviceAdapters).where(like(deviceAdapters.code, `${DAU}%`));
  });

  it("★★ (1) B chỉ gửi connectionOptions + placeholder trong lúc A đổi endpoint + bí mật mới ⇒ hàng cuối = endpoint của A + bí mật CỦA A, KHÔNG BAO GIỜ bí mật cũ", async () => {
    const id = await seedAdapter();
    let bP!: Promise<unknown>;
    await raceAgainstA(id, async () => {
      bP = caller.update({ id, connectionOptions: { userName: "op", password: "[redacted]", ...SEC } });
      await sleep(500); // B đã tới chỗ khoá hàng (FOR UPDATE với bản vá; UPDATE với bản cũ)
    });
    const b = await settle(bP);
    const row = await rowOf(id);
    expect(row.endpoint).toBe(ATTACKER);
    // Bất biến: bí mật CŨ không được ghép với endpoint của A. (Với bản vá B đọc được hàng của A nên
    // placeholder khôi phục bí mật CỦA A — thứ A tự cung cấp — và B thành công.)
    expect(decryptSecret(row.options.password)).toBe(A_PW);
    expect(decryptSecret(row.options.password)).not.toBe(STORED_PW);
    if (!b.ok) expect((b.e as any)?.code).toBe("BAD_REQUEST"); // nếu B bị từ chối thì phải là lý do nhập lại
  });

  it("★★ (2) B gửi form CŨ (endpoint E0 + placeholder) trong lúc A đổi endpoint ⇒ B bị từ chối nhập lại (thấy hàng của A), hàng giữ endpoint + bí mật của A", async () => {
    const id = await seedAdapter();
    let bP!: Promise<unknown>;
    await raceAgainstA(id, async () => {
      bP = caller.update({ id, endpoint: E0, connectionOptions: { userName: "op", password: "[redacted]", ...SEC } });
      await sleep(500);
    });
    const b = await settle(bP);
    expect(b.ok).toBe(false);
    expect((b as any).e?.code).toBe("BAD_REQUEST");
    expect(String((b as any).e?.message)).toMatch(/re-enter|Secret re-entry/i);
    const row = await rowOf(id);
    expect(row.endpoint).toBe(ATTACKER);
    expect(decryptSecret(row.options.password)).toBe(A_PW);
  });

  it("(đối chứng) không có A: placeholder + endpoint không đổi ⇒ vẫn giữ bí mật cũ qua đường giao dịch", async () => {
    const id = await seedAdapter();
    await caller.update({ id, endpoint: E0, connectionOptions: { userName: "op2", password: "[redacted]", ...SEC } });
    const row = await rowOf(id);
    expect(row.endpoint).toBe(E0);
    expect(row.options.userName).toBe("op2");
    expect(decryptSecret(row.options.password)).toBe(STORED_PW);
  });
});
