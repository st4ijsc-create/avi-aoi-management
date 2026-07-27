/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-3) — UNMOCKED integration test for kbWebFetcher's transport
 * layer (`singleHop` + `pinnedLookup`), against a REAL loopback HTTP server.
 *
 * Deliberately a SEPARATE file from kbWebFetcher.test.ts, and deliberately does NOT mock
 * node:http / node:https / node:dns — kbWebFetcher.test.ts mocks all three (hand-built
 * EventEmitter fakes) to keep its 60+ tests hermetic and fast, and that is exactly why it missed
 * a real bug: `pinnedLookup` always replied to its `lookup` callback with the legacy 3-arg form
 * `(err, address, family)`, but Node's `http.request`/`https.request` default to
 * `autoSelectFamily: true` (Node 20+, this repo runs v24), which invokes a custom `lookup` with
 * `{all: true}` and expects an ARRAY reply `[{address, family}, ...]`. Every real request threw
 * "Invalid IP address: undefined" — fails CLOSED (safe) but completely non-functional. A test
 * suite that fakes node:http can never catch a contract mismatch WITH node:http; only a real
 * request, through real Node's real `http.request`, can. This file is that test.
 *
 * The SSRF guard (`isBlockedIp` / `validateTarget`) is intentionally NOT exercised here — it
 * correctly refuses to validate a loopback target (that's its job, and it's covered thoroughly,
 * with mocks, in kbWebFetcher.test.ts). This file drives `singleHop` directly with a hand-built
 * `ValidatedTarget` that points at a real loopback test server, i.e. it tests the transport layer
 * in isolation, downstream of where the guard would already have run for a real public host.
 *
 * Hermetic: loopback only (127.0.0.1), ephemeral port (`listen(0, ...)`), server closed in
 * `afterEach`. No external network access.
 *
 * PRE-FIX BEHAVIOUR (verified before applying the fix): this test rejects with a FetchError
 * ("Invalid IP address: undefined" surfacing via the request's 'error' event) instead of
 * resolving — i.e. it FAILS against the pre-fix `pinnedLookup`/`singleHop`, and PASSES once
 * `singleHop` sets `family`/`autoSelectFamily: false` and `pinnedLookup` handles the array-reply
 * contract. That's the point: this test exists to catch a regression of exactly this bug.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { singleHop, type ValidatedTarget } from "./kbWebFetcher";

describe("singleHop — UNMOCKED real transport (loopback)", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      const s = server;
      server = undefined;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it("completes a real request/response round-trip AND the socket actually reaches the pinned/validated IP", async () => {
    let sawRemoteAddress = "";
    server = http.createServer((req, res) => {
      sawRemoteAddress = req.socket.remoteAddress ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello from real loopback server");
    });

    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;

    // Exactly the shape `validateTarget` would produce for a real, publicly-resolving host — we
    // bypass `validateTarget` here ONLY because it correctly refuses a loopback address (that
    // refusal is what's under test in kbWebFetcher.test.ts's DNS-resolved-IP-guard suite).
    //
    // CRITICAL: `url.hostname` must be a NON-literal-IP hostname here, NOT "127.0.0.1" directly.
    // Node's net/http stack skips invoking a custom `lookup` function entirely when the target
    // hostname is already an IP literal (no resolution needed) — using "127.0.0.1" as the URL
    // hostname would make this test pass unconditionally without ever exercising
    // `pinnedLookup`'s callback-contract at all, defeating the point of this test. A hostname
    // (never actually resolved — `pinnedLookup` intercepts and answers directly, which is the
    // entire mechanism under test here) forces Node through the real custom-`lookup` code path,
    // and `address`/`family` below is where the connection actually lands.
    const target: ValidatedTarget = {
      url: new URL(`http://kb-webfetcher-transport-test.invalid:${port}/some/path`),
      address: "127.0.0.1",
      family: 4,
    };

    const hop = await singleHop(target, new AbortController().signal);

    if (!("statusCode" in hop)) {
      throw new Error("expected a terminal response, got a redirect");
    }
    expect(hop.statusCode).toBe(200);
    expect(hop.body.toString("utf8")).toBe("hello from real loopback server");
    // The critical assertion: the server observed a REAL inbound connection FROM the pinned
    // address. Pre-fix, `singleHop`'s request would never even reach the server — the lookup
    // callback-contract mismatch throws synchronously inside Node's connection setup and the
    // promise rejects — so this line (and everything above it) is what proves the fix works
    // against real Node, not a mock of it.
    expect(sawRemoteAddress).toBe("127.0.0.1");
  });
});
