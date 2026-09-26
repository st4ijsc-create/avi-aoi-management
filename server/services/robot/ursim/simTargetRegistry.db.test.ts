/**
 * doc 81 Đợt 1B Task 3 — sổ đích giả lập đọc CSDL THẬT (`_test`, vitest.setup ép).
 *
 * Chứng minh truy vấn đọc-chỉ `listRealDeviceEndpointsFromDb` thật sự thấy robot + adapter
 * (kể cả endpoint dự phòng HA trong connectionOptions) và `resolveSimTarget("default")` từ
 * chối khi URSIM_HOST trùng một trong chúng. Hàng gieo mang mã riêng, xoá trong afterAll.
 * Địa chỉ dùng dải TEST-NET-1 (192.0.2.0/24, RFC 5737) — không bao giờ được mở kết nối.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../../db/connection";
import { robots, deviceAdapters } from "../../../../drizzle/schema";
import { resolveSimTarget, listRealDeviceEndpointsFromDb } from "./simTargetRegistry";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const RUN = `t3sim${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ROBOT_CODE = `${RUN}-ur`.slice(0, 60);
const ADAPTER_CODE = `${RUN}-plc`.slice(0, 60);

let dbOk = false;

beforeAll(async () => {
  const d = await getDb();
  if (!d) return;
  await d.insert(robots).values({ code: ROBOT_CODE, name: "UR test", vendor: "ur", endpoint: "192.0.2.77:30002" });
  await d.insert(deviceAdapters).values({
    code: ADAPTER_CODE,
    name: "PLC test",
    protocol: "modbus",
    endpoint: "tcp://192.0.2.78:502",
    connectionOptions: { ha: { secondaryEndpoint: "192.0.2.79:502" } },
  });
  dbOk = true;
});

afterAll(async () => {
  const d = await getDb();
  if (!d) return;
  await d.delete(robots).where(inArray(robots.code, [ROBOT_CODE]));
  await d.delete(deviceAdapters).where(inArray(deviceAdapters.code, [ADAPTER_CODE]));
});

afterEach(() => {
  delete process.env.URSIM_HOST;
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof TRPCError) return e.code;
    throw e;
  }
  return "RESOLVED";
}

describe("simTargetRegistry trên CSDL thật", () => {
  it("đọc được endpoint robot + adapter + endpoint dự phòng HA", async () => {
    expect(dbOk).toBe(true);
    const eps = await listRealDeviceEndpointsFromDb();
    expect(eps).toContain("192.0.2.77:30002");
    expect(eps).toContain("tcp://192.0.2.78:502");
    expect(eps).toContain("192.0.2.79:502");
  });

  it.each([
    ["robot", "192.0.2.77"],
    ["adapter", "192.0.2.78"],
    ["adapter HA", "192.0.2.79"],
  ])("URSIM_HOST trùng host %s ⇒ PRECONDITION_FAILED", async (_label, host) => {
    process.env.URSIM_HOST = host;
    expect(await codeOf(resolveSimTarget("default"))).toBe("PRECONDITION_FAILED");
  });

  it("URSIM_HOST không trùng thiết bị nào ⇒ trả đích 'default' (ảo)", async () => {
    process.env.URSIM_HOST = "192.0.2.200";
    const t = await resolveSimTarget("default");
    expect(t.targetId).toBe("default");
    expect(t.kind).toBe("ursim-virtual");
    expect(t.endpoint.host).toBe("192.0.2.200");
  });
});
