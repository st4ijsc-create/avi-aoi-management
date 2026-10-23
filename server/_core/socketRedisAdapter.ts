/**
 * Optional Redis adapter for Socket.IO (horizontal scale unlock — GAP G3).
 *
 * Behaviour:
 *  - Activated ONLY when REDIS_URL is set AND `@socket.io/redis-adapter` is
 *    installed. Otherwise it is a silent no-op and the server keeps running
 *    with the default single-instance in-memory adapter.
 *  - All imports are dynamic + guarded so the build/runtime never breaks when
 *    the optional package or Redis infrastructure is absent.
 *
 * To enable across multiple instances:
 *   1. pnpm add @socket.io/redis-adapter
 *   2. set REDIS_URL=redis://host:6379
 */
import type { Server as SocketIOServer } from "socket.io";

let attached = false;

/**
 * The Redis channel key this process broadcasts on. Instances that share ONE database (real horizontal scaling) share a
 * key; a process on another database — e.g. a test server on the cloned `_test` database — gets a different key and can
 * no longer push its rooms' traffic into this server's sockets. With the library default ("socket.io") for everybody,
 * test runs flooded the dev server with URGENT notifications for factories that do not exist there (2026-10-23).
 * Override with SOCKET_REDIS_KEY. Never contains credentials or query parameters.
 */
export function resolveSocketRedisKey(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SOCKET_REDIS_KEY?.trim();
  if (explicit) return explicit;
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return "socket.io";
  try {
    const u = new URL(raw);
    const db = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!u.hostname || !db) return "socket.io";
    return `socket.io:${u.hostname}:${u.port || "5432"}/${db}`;
  } catch {
    return "socket.io";
  }
}

export async function attachRedisAdapter(io: SocketIOServer): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log("[Socket.io] REDIS_URL not set — using in-memory adapter (single instance).");
    return false;
  }
  if (attached) return true;

  try {
    // Variable specifiers keep these as optional runtime imports so the build
    // does not fail when the packages are not installed.
    const ioredisPkg = "ioredis";
    const adapterPkg = "@socket.io/redis-adapter";

    const RedisMod: any = await import(ioredisPkg).catch(() => null);
    const adapterMod: any = await import(adapterPkg).catch(() => null);

    if (!RedisMod || !adapterMod) {
      console.warn(
        "[Socket.io] REDIS_URL is set but '@socket.io/redis-adapter' is not installed. " +
          "Run `pnpm add @socket.io/redis-adapter` to enable multi-instance scaling. " +
          "Falling back to in-memory adapter.",
      );
      return false;
    }

    const Redis = RedisMod.default ?? RedisMod;
    const { createAdapter } = adapterMod;

    const pubClient = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
    const subClient = pubClient.duplicate();

    pubClient.on("error", (err: Error) => console.error("[Socket.io][Redis pub] error:", err.message));
    subClient.on("error", (err: Error) => console.error("[Socket.io][Redis sub] error:", err.message));

    const key = resolveSocketRedisKey();
    io.adapter(createAdapter(pubClient, subClient, { key }));
    attached = true;
    console.log(`[Socket.io] Redis adapter attached — multi-instance broadcasting enabled (key "${key}").`);
    return true;
  } catch (err: any) {
    console.error("[Socket.io] Failed to attach Redis adapter, staying in-memory:", err?.message ?? err);
    return false;
  }
}
