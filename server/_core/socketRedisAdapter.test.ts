/**
 * Socket.IO Redis adapter — channel key isolation per database.
 *
 * Root cause (2026-10-23, measured on :3000): every process that set REDIS_URL attached the adapter with the library's
 * DEFAULT key "socket.io", so test servers running on a cloned `_test` database broadcast into the SAME Redis channels
 * as the dev server. 17,662 messages in 40 s reached `global`/`admin`/`user:<id>` rooms of :3000, including URGENT
 * "robot N: factory changed while edge node … owns it" notifications for factories (F-B10CMD-*) that do not exist in
 * the dev database ⇒ 220–343 critical toasts per page load ⇒ main thread 100 % busy, 3D at 10–19 fps.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createAdapter = vi.fn(() => "ADAPTER");
vi.mock("@socket.io/redis-adapter", () => ({ createAdapter }));
vi.mock("ioredis", () => {
  class FakeRedis {
    constructor(public url: string) {}
    on() { return this; }
    duplicate() { return new FakeRedis(this.url); }
  }
  return { default: FakeRedis };
});

import { resolveSocketRedisKey } from "./socketRedisAdapter";

describe("resolveSocketRedisKey", () => {
  it("uses SOCKET_REDIS_KEY verbatim when set", () => {
    expect(resolveSocketRedisKey({ SOCKET_REDIS_KEY: "synapse-prod", DATABASE_URL: "postgresql://u:p@h:5434/aoi_management" })).toBe("synapse-prod");
  });

  it("derives the key from the database host, port and name", () => {
    expect(resolveSocketRedisKey({ DATABASE_URL: "postgresql://avi_app:secret@127.0.0.1:5434/aoi_management" })).toBe(
      "socket.io:127.0.0.1:5434/aoi_management",
    );
  });

  it("gives a cloned test database a DIFFERENT key than the dev database", () => {
    const dev = resolveSocketRedisKey({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5434/aoi_management" });
    const test = resolveSocketRedisKey({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5434/aoi_management_test" });
    expect(test).not.toBe(dev);
  });

  it("never puts credentials into the key", () => {
    const key = resolveSocketRedisKey({ DATABASE_URL: "postgresql://avi_app:topsecret@127.0.0.1:5434/aoi_management?sslmode=disable" });
    expect(key).not.toContain("topsecret");
    expect(key).not.toContain("avi_app");
    expect(key).not.toContain("sslmode");
  });

  it("defaults the port when the URL omits it", () => {
    expect(resolveSocketRedisKey({ DATABASE_URL: "postgres://u:p@db.local/aoi" })).toBe("socket.io:db.local:5432/aoi");
  });

  it("falls back to the library default only when there is no usable database URL", () => {
    expect(resolveSocketRedisKey({})).toBe("socket.io");
    expect(resolveSocketRedisKey({ DATABASE_URL: "not a url" })).toBe("socket.io");
  });
});

describe("attachRedisAdapter", () => {
  beforeEach(() => {
    vi.resetModules();
    createAdapter.mockClear();
  });

  it("passes the per-database key to createAdapter", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("SOCKET_REDIS_KEY", "");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:5434/aoi_management");
    const { attachRedisAdapter } = await import("./socketRedisAdapter");
    const io = { adapter: vi.fn() };
    await expect(attachRedisAdapter(io as never)).resolves.toBe(true);
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(createAdapter.mock.calls[0][2]).toEqual({ key: "socket.io:127.0.0.1:5434/aoi_management" });
    expect(io.adapter).toHaveBeenCalledWith("ADAPTER");
    vi.unstubAllEnvs();
  });
});
