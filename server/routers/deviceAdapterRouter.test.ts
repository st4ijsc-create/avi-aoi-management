/**
 * Sprint G2.2a — deviceAdapterRouter tests.
 *
 * Covers: adapter + tag CRUD, unique(code), unique(adapterId,tagKey), delete-enabled
 * guard, testConnection (stub→ok / unregistered protocol→clean error, NO write),
 * and RBAC denial when the caller lacks machine_control.
 *
 * The router talks to drizzle via getDb() — we mock `../db` with an in-memory fake
 * and mock drizzle's eq/and/gte/desc to JS predicates. testConnection uses the REAL
 * driver registry (stub driver registered via side-effect import).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeGte, makeDesc, resetSeq } from "./__otFakeDb";
import { deviceAdapters, deviceTags } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, gte: makeGte, desc: makeDesc };
});

// `phaiDoiMatKhau` is read by the GLOBAL root middleware (server/_core/trpc.ts) — a bare
// `{ getDb }` mock makes Vitest throw "No 'phaiDoiMatKhau' export" on every call (same fix
// as equipmentIntegrationRouter.test.ts).
vi.mock("../db", () => ({ getDb: vi.fn(async () => fake), phaiDoiMatKhau: vi.fn(async () => false) }));

// Driver registry: delegate to the REAL implementation by default, but allow a
// per-test override of createDriver (to exercise the clean-error branch).
const driverOverride = vi.hoisted(() => ({ createDriver: null as ((p: any) => any) | null }));
vi.mock("../services/ot/driverRegistry", async (orig) => {
  const actual = await orig<typeof import("../services/ot/driverRegistry")>();
  return {
    ...actual,
    createDriver: (p: any) => (driverOverride.createDriver ?? actual.createDriver)(p),
  };
});

// RBAC: a configurable permission gate. `allow` toggles the machine_control grant.
const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: (_module: string, _action: string) =>
    async ({ ctx, next }: any) => {
      if (!perm.allow) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "FORBIDDEN", message: "no machine_control" });
      }
      return next({ ctx });
    },
}));

import { deviceAdapterRouter } from "./deviceAdapterRouter";

const ctx = { user: { id: 9, role: "supervisor", name: "Sup" } } as any;
const caller = deviceAdapterRouter.createCaller(ctx);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  fake.setUnique(deviceAdapters, [["code"]]);
  fake.setUnique(deviceTags, [["adapterId", "tagKey"]]);
});

describe("adapter CRUD", () => {
  it("create → list → get(with tags) → update → delete", async () => {
    const created = await caller.create({
      code: "PLC-1", name: "Line1 PLC", protocol: "stub", endpoint: "stub://x",
    });
    expect(created.code).toBe("PLC-1");
    expect(created.isEnabled).toBe(false);
    expect(created.createdBy).toBe(9);

    const list = await caller.list();
    expect(list).toHaveLength(1);

    const got = await caller.get({ id: created.id });
    expect(got.tags).toEqual([]);

    const updated = await caller.update({ id: created.id, name: "Renamed" });
    expect(updated.name).toBe("Renamed");

    const del = await caller.delete({ id: created.id });
    expect(del).toEqual({ success: true });
    expect(await caller.list()).toHaveLength(0);
  });

  it("rejects duplicate code with friendly CONFLICT", async () => {
    await caller.create({ code: "DUP", name: "A", protocol: "stub", endpoint: "stub://a" });
    await expect(
      caller.create({ code: "DUP", name: "B", protocol: "stub", endpoint: "stub://b" }),
    ).rejects.toThrow(/đã tồn tại/);
  });

  it("refuses to delete an enabled adapter", async () => {
    const a = await caller.create({ code: "EN", name: "On", protocol: "stub", endpoint: "stub://e", isEnabled: true });
    await expect(caller.delete({ id: a.id })).rejects.toThrow(/đang bật/);
  });

  it("list filters by protocol", async () => {
    await caller.create({ code: "A", name: "a", protocol: "stub", endpoint: "s://a" });
    await caller.create({ code: "B", name: "b", protocol: "modbus", endpoint: "tcp://b" });
    const onlyStub = await caller.list({ protocol: "stub" });
    expect(onlyStub.map((r) => r.code)).toEqual(["A"]);
  });
});

describe("tag CRUD + unique", () => {
  it("create tag → unique(adapterId,tagKey) friendly error → list → update → delete", async () => {
    const a = await caller.create({ code: "T", name: "t", protocol: "stub", endpoint: "s://t" });
    const tag = await caller.tags.create({ adapterId: a.id, tagKey: "temp", address: "DB1.0", dataType: "float" });
    expect(tag.tagKey).toBe("temp");
    expect(tag.writable).toBe(false);

    await expect(
      caller.tags.create({ adapterId: a.id, tagKey: "temp", address: "DB1.4", dataType: "float" }),
    ).rejects.toThrow(/đã tồn tại trong adapter/);

    const tags = await caller.tags.listByAdapter({ adapterId: a.id });
    expect(tags).toHaveLength(1);

    const upd = await caller.tags.update({ id: tag.id, writable: true });
    expect(upd.writable).toBe(true);

    const del = await caller.tags.delete({ id: tag.id });
    expect(del).toEqual({ success: true });
    expect(await caller.tags.listByAdapter({ adapterId: a.id })).toHaveLength(0);
  });
});

describe("testConnection (read-only probe, NO write)", () => {
  it("stub protocol → ok with latency", async () => {
    const res = await caller.testConnection({ protocol: "stub", endpoint: "stub://probe" });
    expect(res.ok).toBe(true);
    expect(typeof res.latencyMs).toBe("number");
  });

  it("by adapter id → ok", async () => {
    const a = await caller.create({ code: "P", name: "p", protocol: "stub", endpoint: "stub://p" });
    const res = await caller.testConnection({ id: a.id });
    expect(res.ok).toBe(true);
  });

  it("driver create/connect failure (e.g. missing protocol lib) → ok:false with clean error, never throws", async () => {
    driverOverride.createDriver = () => { throw new Error("modbus-serial not installed"); };
    try {
      const res = await caller.testConnection({ protocol: "modbus", endpoint: "tcp://x:502" });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not installed/);
      expect(res.latencyMs).toBe(0);
    } finally {
      driverOverride.createDriver = null;
    }
  });

  // doc 81 Đợt 1B Task 1 — hạn TỔNG (timeoutMs 8 s + 2 s) cho connect + disconnect, và
  // luôn dọn. Trước bản vá: connect 8 s + disconnect 8 s nối tiếp = 16 s khi driver treo.
  it("driver treo ở CẢ connect lẫn disconnect ⇒ trả ok:false trong ≤ 10 s + biên, disconnect được gọi", async () => {
    let disconnectCalls = 0;
    driverOverride.createDriver = () => ({
      protocol: "modbus",
      connect: () => new Promise<void>(() => undefined),
      disconnect: () => {
        disconnectCalls += 1;
        return new Promise<void>(() => undefined);
      },
      isConnected: () => false,
    });
    try {
      const t0 = Date.now();
      const guard = new Promise<"treo">((r) => setTimeout(() => r("treo"), 11_000).unref());
      const res = await Promise.race([
        caller.testConnection({ protocol: "modbus", endpoint: "tcp://127.0.0.1:1" }),
        guard,
      ]);
      const elapsed = Date.now() - t0;
      expect(res, `testConnection treo > 11 s`).not.toBe("treo");
      expect((res as { ok: boolean }).ok).toBe(false);
      expect((res as { errorCode?: string }).errorCode).toBe("DEVICE_UNREACHABLE");
      expect(elapsed).toBeLessThan(11_000);
      expect(disconnectCalls).toBeGreaterThanOrEqual(1);
    } finally {
      driverOverride.createDriver = null;
    }
  }, 20_000);
});

describe("RBAC", () => {
  it("denies create when caller lacks machine_control", async () => {
    perm.allow = false;
    await expect(
      caller.create({ code: "X", name: "x", protocol: "stub", endpoint: "s://x" }),
    ).rejects.toThrow(/machine_control|FORBIDDEN/i);
  });

  it("denies list when caller lacks machine_control", async () => {
    perm.allow = false;
    await expect(caller.list()).rejects.toThrow(/machine_control|FORBIDDEN/i);
  });
});

// doc 81 Đợt 1B Task 12 — mật khẩu OPC UA trong connectionOptions đi qua secretBox (không
// lưu plaintext mới, không cột/migration mới). Oracle: dòng lưu KHÔNG chứa chuỗi gốc, mang
// tiền tố enc:v1:, và giải mã (secretBox) ra đúng chuỗi gốc.
/** Dòng THẬT trong kho giả (router nay che mật khẩu ở mọi phản hồi — Task 12 fix round 1). */
function adapterRows(): any[] {
  return fake.store.get((deviceAdapters as any)[Symbol.for("drizzle:Name")]) ?? [];
}
const storedOpts = (id: number) => adapterRows().find((r) => r.id === id)?.connectionOptions as any;

describe("connectionOptions.password is sealed at rest (Task 12)", () => {
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "task12-router-test-key";
  });

  it("create + update store enc:v1: ciphertext (also ha.secondaryOptions.password); other keys untouched", async () => {
    const { decryptSecret } = await import("../services/security/secretBox");
    const a = await caller.create({
      code: "UA1", name: "S7-1500", protocol: "opcua", endpoint: "opc.tcp://10.0.0.5:4840",
      connectionOptions: {
        securityMode: "SignAndEncrypt", userName: "op", password: "Pl@in-Pw",
        ha: { secondaryEndpoint: "opc.tcp://10.0.0.6:4840", secondaryOptions: { userName: "op", password: "Sec-Pw" } },
      },
    });
    const co = storedOpts(a.id);
    const stored = JSON.stringify(co);
    expect(stored).not.toContain("Pl@in-Pw");
    expect(stored).not.toContain("Sec-Pw");
    expect(co.password).toMatch(/^enc:v1:/);
    expect(decryptSecret(co.password)).toBe("Pl@in-Pw");
    expect(decryptSecret(co.ha.secondaryOptions.password)).toBe("Sec-Pw");
    expect(co.securityMode).toBe("SignAndEncrypt");
    expect(co.userName).toBe("op");

    // Sửa: gửi lại nguyên ciphertext (form edit round-trip) ⇒ KHÔNG mã hoá chồng.
    await caller.update({ id: a.id, connectionOptions: { ...co } });
    expect(storedOpts(a.id).password).toBe(co.password);
    await caller.update({ id: a.id, connectionOptions: { ...co, password: "New-Pw" } });
    expect(JSON.stringify(storedOpts(a.id))).not.toContain("New-Pw");
    expect(decryptSecret(storedOpts(a.id).password)).toBe("New-Pw");
  });

  it("Fix round 1 #2 — list/get/create/update never return password values (ciphertext OR legacy plaintext)", async () => {
    const a = await caller.create({
      code: "UA9", name: "n", protocol: "opcua", endpoint: "opc.tcp://h:4840",
      connectionOptions: { userName: "op", password: "Pw-1", ha: { secondaryEndpoint: "opc.tcp://h2:4840", secondaryOptions: { password: "Pw-2" } } },
    });
    // Dòng cũ còn plaintext (trước Task 12) ghi thẳng vào kho giả.
    const legacy = await caller.create({ code: "UA10", name: "n", protocol: "opcua", endpoint: "opc.tcp://h:4840" });
    const rows = adapterRows();
    rows.find((r) => r.id === legacy.id).connectionOptions = { userName: "old", password: "legacy-plain", apiKey: "k-123" };

    const outs = [a, await caller.get({ id: a.id }), await caller.get({ id: legacy.id }), ...(await caller.list())];
    for (const o of outs) {
      const j = JSON.stringify(o.connectionOptions);
      expect(j).not.toMatch(/enc:v1:|Pw-1|Pw-2|legacy-plain|k-123/);
    }
    const got = (await caller.get({ id: a.id })).connectionOptions as any;
    expect(got.password).toBe("[redacted]");
    expect(got.ha.secondaryOptions.password).toBe("[redacted]");
    expect(got.userName).toBe("op");
    const upd = await caller.update({ id: a.id, name: "renamed" });
    expect(JSON.stringify(upd.connectionOptions)).not.toMatch(/enc:v1:|Pw-1/);
  });

  it("Fix round 1 #2 — update sending the redacted placeholder back KEEPS the stored secret (when nothing about where/how it is sent changes)", async () => {
    const { decryptSecret } = await import("../services/security/secretBox");
    const a = await caller.create({
      code: "UA11", name: "n", protocol: "opcua", endpoint: "opc.tcp://h:4840",
      connectionOptions: { userName: "op", password: "Keep-Me", securityMode: "SignAndEncrypt", ha: { secondaryEndpoint: "opc.tcp://h2:4840", secondaryOptions: { password: "Keep-2" } } },
    });
    const form = (await caller.get({ id: a.id })).connectionOptions as any; // có "[redacted]"
    // final wave (item 5): đổi trường KHÔNG ràng buộc bí mật (tên đăng nhập, tên adapter) ⇒ giữ.
    await caller.update({ id: a.id, name: "renamed", connectionOptions: { ...form, userName: "op2" } });
    const row = adapterRows().find((r) => r.id === a.id);
    expect(decryptSecret(row.connectionOptions.password)).toBe("Keep-Me");
    expect(decryptSecret(row.connectionOptions.ha.secondaryOptions.password)).toBe("Keep-2");
    expect(row.connectionOptions.userName).toBe("op2");
    expect(row.connectionOptions.securityMode).toBe("SignAndEncrypt");
    // Placeholder khi TẠO (không có gì để giữ) ⇒ không lưu chuỗi placeholder làm mật khẩu.
    const b = await caller.create({ code: "UA12", name: "n", protocol: "opcua", endpoint: "opc.tcp://h:4840", connectionOptions: { userName: "x", password: "[redacted]" } });
    const rowB = adapterRows().find((r) => r.id === b.id);
    expect(rowB.connectionOptions.password).toBeUndefined();
  });

  // ── doc 81 Đợt 1B final wave (item 5, security) — placeholder + đổi endpoint/bảo mật ⇒ KHÔNG khôi phục bí mật ──
  describe("final wave #5 — a canEdit user cannot re-point a stored secret by sending the placeholder", () => {
    async function seed(code: string) {
      const a = await caller.create({
        code, name: "n", protocol: "opcua", endpoint: "opc.tcp://10.0.0.5:4840",
        connectionOptions: {
          userName: "op", password: "Stored-Pw", securityMode: "SignAndEncrypt", securityPolicy: "Basic256Sha256",
          ha: { secondaryEndpoint: "opc.tcp://10.0.0.6:4840", secondaryOptions: { userName: "op", password: "Stored-2", securityMode: "SignAndEncrypt" } },
        },
      });
      const form = (await caller.get({ id: a.id })).connectionOptions as any; // placeholders
      const before = JSON.stringify(storedOpts(a.id));
      return { a, form, before };
    }

    it("endpoint change + placeholder ⇒ BAD_REQUEST INVALID_VALUE/secretReentryRequired; stored row untouched (secret AND endpoint)", async () => {
      const { a, form, before } = await seed("UA20");
      await expect(caller.update({ id: a.id, endpoint: "opc.tcp://attacker.example:4840", connectionOptions: form })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/secret|password|nhập lại|re-enter/i),
      });
      expect(JSON.stringify(storedOpts(a.id))).toBe(before);
      expect(adapterRows().find((r) => r.id === a.id).endpoint).toBe("opc.tcp://10.0.0.5:4840");
    });

    it("securityMode → None + placeholder ⇒ refused (the stored password would go over the wire in clear); with a NEW secret ⇒ OK and sealed", async () => {
      const { decryptSecret } = await import("../services/security/secretBox");
      const { a, form, before } = await seed("UA21");
      await expect(caller.update({ id: a.id, connectionOptions: { ...form, securityMode: "None", securityPolicy: "None" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(JSON.stringify(storedOpts(a.id))).toBe(before);
      const ha = { ...form.ha, secondaryOptions: { ...form.ha.secondaryOptions, password: "Second-New" } };
      await caller.update({ id: a.id, connectionOptions: { ...form, securityMode: "None", securityPolicy: "None", password: "Typed-Again", ha } });
      const co = storedOpts(a.id);
      expect(co.securityMode).toBe("None");
      expect(decryptSecret(co.password)).toBe("Typed-Again");
      expect(JSON.stringify(co)).not.toContain("Typed-Again");
    });

    it("endpoint change WITHOUT connectionOptions in the request (stored row holds a secret) ⇒ refused; a row with no secret may change endpoint freely", async () => {
      const { a, before } = await seed("UA22");
      await expect(caller.update({ id: a.id, endpoint: "opc.tcp://other:4840" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(JSON.stringify(storedOpts(a.id))).toBe(before);
      const plain = await caller.create({ code: "UA23", name: "n", protocol: "opcua", endpoint: "opc.tcp://a:4840", connectionOptions: { userName: "ro" } });
      const upd = await caller.update({ id: plain.id, endpoint: "opc.tcp://b:4840" });
      expect(upd.endpoint).toBe("opc.tcp://b:4840");
    });

    it("HA: secondaryEndpoint change + secondary placeholder ⇒ refused; same change with the secondary secret re-entered ⇒ OK, primary secret kept", async () => {
      const { decryptSecret } = await import("../services/security/secretBox");
      const { a, form, before } = await seed("UA24");
      await expect(
        caller.update({ id: a.id, connectionOptions: { ...form, ha: { ...form.ha, secondaryEndpoint: "opc.tcp://evil:4840" } } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(JSON.stringify(storedOpts(a.id))).toBe(before);
      await caller.update({
        id: a.id,
        connectionOptions: { ...form, ha: { ...form.ha, secondaryEndpoint: "opc.tcp://new:4840", secondaryOptions: { ...form.ha.secondaryOptions, password: "Second-Typed" } } },
      });
      const co = storedOpts(a.id);
      expect(decryptSecret(co.password)).toBe("Stored-Pw"); // primary untouched (placeholder, no binding change)
      expect(decryptSecret(co.ha.secondaryOptions.password)).toBe("Second-Typed");
      expect(co.ha.secondaryEndpoint).toBe("opc.tcp://new:4840");
    });

    it("no change + placeholder ⇒ keeps the secret (the ordinary edit-form round-trip still works)", async () => {
      const { decryptSecret } = await import("../services/security/secretBox");
      const { a, form } = await seed("UA25");
      await caller.update({ id: a.id, endpoint: "opc.tcp://10.0.0.5:4840", connectionOptions: form, pollIntervalMs: 2000 });
      expect(decryptSecret(storedOpts(a.id).password)).toBe("Stored-Pw");
      expect(decryptSecret(storedOpts(a.id).ha.secondaryOptions.password)).toBe("Stored-2");
    });
  });

  it("Fix round 1 #6 — contradictory OPC UA security is refused at save time (create + update), other protocols untouched", async () => {
    await expect(
      caller.create({ code: "UA13", name: "n", protocol: "opcua", endpoint: "opc.tcp://h:4840", connectionOptions: { securityMode: "None", securityPolicy: "Basic256Sha256" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const ok = await caller.create({ code: "UA14", name: "n", protocol: "opcua", endpoint: "opc.tcp://h:4840" });
    await expect(caller.update({ id: ok.id, connectionOptions: { securityMode: "SignAndEncrypt", securityPolicy: "None" } })).rejects.toThrow(
      /requires a securityPolicy/,
    );
    await expect(
      caller.update({ id: ok.id, connectionOptions: { ha: { secondaryEndpoint: "opc.tcp://h2", secondaryOptions: { securityMode: "Bogus" } } } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Modbus không có khái niệm securityMode của OPC UA ⇒ không kiểm.
    const mb = await caller.create({ code: "MB1", name: "n", protocol: "modbus", endpoint: "tcp://h:502", connectionOptions: { securityMode: "whatever" } });
    expect((mb.connectionOptions as any).securityMode).toBe("whatever");
  });

  it("no password ⇒ connectionOptions stored unchanged; null stays null", async () => {
    const a = await caller.create({
      code: "UA2", name: "n", protocol: "opcua", endpoint: "opc.tcp://h:4840",
      connectionOptions: { securityMode: "None" },
    });
    expect(a.connectionOptions).toEqual({ securityMode: "None" });
    const b = await caller.create({ code: "UA3", name: "n", protocol: "stub", endpoint: "s://x" });
    expect(b.connectionOptions).toBeNull();
  });
});
