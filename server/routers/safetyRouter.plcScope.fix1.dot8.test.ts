/**
 * doc 81 Đợt 8 task N fix 1 (I1) — when the caller's factory scope CANNOT be resolved, the safety-PLC config procedures
 * fail CLOSED: nothing is listed (and by-id actions answer NOT_FOUND), never "full scope".
 * Oracle: the scope resolver is forced to throw; the config list is a fixed fake.
 */
import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => {
  // N fix 1 (M7) — sdk.ts complains at IMPORT time when OAUTH_SERVER_URL is unset; a local dummy keeps stderr clean (never called).
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});


vi.mock("../db/hierarchy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../db/hierarchy")>();
  return {
    ...orig,
    idsTrongPhamVi: vi.fn(async () => {
      throw new Error("tenant scope unavailable");
    }),
  };
});
vi.mock("../services/safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    listPlcConfigs: vi.fn(async () => [
      { id: 1, code: "A", factoryId: 1 },
      { id: 2, code: "B", factoryId: null },
    ]),
  };
});

import { safetyRouter } from "./safetyRouter";

describe("doc 81 Đợt 8 N fix 1 — unresolvable scope ⇒ fail closed", () => {
  it("listSafetyPlcConfigs returns nothing (not every config) when the scope resolver throws", async () => {
    const caller = safetyRouter.createCaller({ user: { id: 7, role: "admin", name: "a", twoFactorEnabled: true } } as never);
    expect(await caller.listSafetyPlcConfigs()).toEqual([]);
  });
});
