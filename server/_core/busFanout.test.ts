/**
 * U6-b (doc 21 §6 U6 / G-10) — bus fan-out abstraction tests.
 *
 * Covers, WITHOUT a real Redis:
 *   • DEFAULT (flag OFF): routes purely in-process — no Redis client is created,
 *     publish() is a no-op, active=false.
 *   • OPT-IN (flag ON + mock pub/sub): publish() writes an envelope to the Redis
 *     channel; a message from ANOTHER instance is injected into the local injector.
 *   • LOOPBACK-SAFE: a message whose origin === this process is dropped (not
 *     re-injected); a wrong-channel/wrong-bus message is dropped.
 *   • HONEST SEAM (flag ON, factory returns null): stays in-process, active=false,
 *     publish() is a no-op — no fake cross-instance delivery.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBusFanout,
  PROCESS_ORIGIN,
  __resetSeamLog,
  type RedisLikePubSub,
  type FanoutEnvelope,
} from "./busFanout";

/** A minimal in-memory mock of an ioredis pub/sub pair. */
function makeMockPubSub() {
  const published: Array<{ channel: string; message: string }> = [];
  let messageCb: ((channel: string, message: string) => void) | null = null;
  const subscribed: string[] = [];
  const client: RedisLikePubSub = {
    pub: {
      publish(channel, message) {
        published.push({ channel, message });
        return 1;
      },
      quit: vi.fn(async () => "OK"),
    },
    sub: {
      subscribe(channel) {
        subscribed.push(channel);
        return 1;
      },
      on(_event, cb) {
        messageCb = cb;
        return this;
      },
      quit: vi.fn(async () => "OK"),
    },
  };
  return {
    client,
    published,
    subscribed,
    /** Simulate a message arriving on the wire. */
    deliver(channel: string, message: string) {
      messageCb?.(channel, message);
    },
  };
}

describe("busFanout (U6-b / G-10)", () => {
  beforeEach(() => {
    __resetSeamLog();
  });

  it("DEFAULT flag OFF: pure in-process, no client, publish no-op", async () => {
    const factory = vi.fn(async () => makeMockPubSub().client);
    const fo = createBusFanout("event", factory, () => false);
    const received: unknown[] = [];
    fo.onRemote((p) => received.push(p));
    // give the async wiring a tick
    await Promise.resolve();
    fo.publish({ hello: "world" });
    expect(factory).not.toHaveBeenCalled();
    expect(fo.active).toBe(false);
    expect(received).toHaveLength(0);
    await fo.close();
  });

  it("OPT-IN flag ON: publish writes to the channel + subscribes", async () => {
    const mock = makeMockPubSub();
    const fo = createBusFanout("event", async () => mock.client, () => true);
    // wait for the async subscribe wiring
    await new Promise((r) => setTimeout(r, 0));
    expect(fo.active).toBe(true);
    expect(mock.subscribed).toContain("avi:busfanout:event");

    fo.publish({ type: "ng.alert", n: 1 });
    expect(mock.published).toHaveLength(1);
    const env = JSON.parse(mock.published[0].message) as FanoutEnvelope;
    expect(env.o).toBe(PROCESS_ORIGIN);
    expect(env.c).toBe("event");
    expect(env.d).toEqual({ type: "ng.alert", n: 1 });
    await fo.close();
  });

  it("injects a REMOTE message into the local injector", async () => {
    const mock = makeMockPubSub();
    const fo = createBusFanout("event", async () => mock.client, () => true);
    await new Promise((r) => setTimeout(r, 0));
    const received: unknown[] = [];
    fo.onRemote((p) => received.push(p));

    const remoteEnv: FanoutEnvelope = { o: "some-other-process", c: "event", d: { type: "x", v: 42 } };
    mock.deliver("avi:busfanout:event", JSON.stringify(remoteEnv));
    expect(received).toEqual([{ type: "x", v: 42 }]);
    await fo.close();
  });

  it("LOOPBACK-SAFE: drops our own echo + wrong-bus + wrong-channel", async () => {
    const mock = makeMockPubSub();
    const fo = createBusFanout("event", async () => mock.client, () => true);
    await new Promise((r) => setTimeout(r, 0));
    const received: unknown[] = [];
    fo.onRemote((p) => received.push(p));

    // our own origin → dropped
    mock.deliver(
      "avi:busfanout:event",
      JSON.stringify({ o: PROCESS_ORIGIN, c: "event", d: { self: true } } satisfies FanoutEnvelope),
    );
    // wrong bus key → dropped
    mock.deliver(
      "avi:busfanout:event",
      JSON.stringify({ o: "other", c: "telemetry", d: { wrong: true } } satisfies FanoutEnvelope),
    );
    // wrong channel → dropped
    mock.deliver(
      "avi:busfanout:telemetry",
      JSON.stringify({ o: "other", c: "event", d: { wrongch: true } } satisfies FanoutEnvelope),
    );
    // malformed → dropped
    mock.deliver("avi:busfanout:event", "{not json");

    expect(received).toHaveLength(0);
    await fo.close();
  });

  it("HONEST SEAM: flag ON but no client → in-process, active=false, publish no-op", async () => {
    const fo = createBusFanout("telemetry", async () => null, () => true);
    await new Promise((r) => setTimeout(r, 0));
    const received: unknown[] = [];
    fo.onRemote((p) => received.push(p));
    expect(fo.active).toBe(false);
    // publish is a no-op (no client) — must not throw
    expect(() => fo.publish({ any: "thing" })).not.toThrow();
    expect(received).toHaveLength(0);
    await fo.close();
  });
});
