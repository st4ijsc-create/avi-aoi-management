/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-3) — Knowledge & Training Studio URL ingest source.
 *
 * Fetches an operator-supplied web page → extracts plain text → feeds it into E3-1's
 * kbIngestService.ingestDocument pipeline (parse[pass-through]→chunk→embed→store). This file
 * does NOT reimplement chunk/embed/store — see `ingestUrl` at the bottom, which is a thin
 * wrapper around `ingestDocument`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE DELIVERABLE: an SSRF-safe fetcher. An in-server "fetch this URL" feature is a classic
 * SSRF vector (read cloud instance metadata, hit internal admin panels, port-scan the LAN via
 * response-timing). `fetchUrlForIngest` defends with FIVE independent layers, ALL of which
 * apply unconditionally whenever the feature is on (no bypass):
 *
 *  1. Scheme allowlist — ONLY `http:`/`https:`. `file:`, `ftp:`, `data:`, `gopher:`, `blob:`,
 *     everything else is rejected before any I/O.
 *  2. Optional host allowlist (`WEB_INGEST_ALLOWLIST`) — when SET, ONLY those exact hostnames
 *     are fetchable (checked on every hop, including redirect targets). This is the safest
 *     posture and is RECOMMENDED FOR PRODUCTION — the IP-block guard below is a general-purpose
 *     safety net for when the target set can't be known in advance, not a replacement for it.
 *  3. Block-by-resolved-IP (`isBlockedIp`, built on Node's native `net.BlockList`) — a hostname
 *     can resolve to an internal/link-local/metadata address regardless of how public it looks
 *     (DNS rebinding). `dns.promises.lookup(hostname, {all:true})` resolves EVERY address the
 *     name maps to and the request is refused if ANY of them is blocked — never just the first.
 *  4. Manual redirect following (never delegated to the HTTP client's auto-follow) — capped at
 *     `WEB_INGEST_MAX_REDIRECTS` (default 3), and EVERY hop re-runs steps 1-3 from scratch
 *     against the redirect target before it is followed. A public URL that 302s to
 *     `http://169.254.169.254/latest/meta-data/` is rejected, not followed.
 *  5. DNS-rebinding hardening — once a hostname's addresses are validated, the actual TCP
 *     connection is PINNED to that exact validated IP via a custom `lookup` function passed to
 *     `http.request`/`https.request` (Node's per-request `lookup` option — see
 *     `pinnedLookup`). This means the connect step performs NO second DNS resolution at all, so
 *     there is no window for the name to re-resolve to a different (blocker) address between
 *     validation and connect for THIS request. `Host`/TLS SNI still use the real hostname (only
 *     the socket's destination address is pinned), so certificate validation is unaffected.
 *     HONEST RESIDUAL TOCTOU: this eliminates rebinding *within a single request*, but a
 *     hostname's DNS records can still change between one call to `fetchUrlForIngest` and the
 *     next (e.g. between the initial ingest and a hypothetical future re-fetch) — this file
 *     validates fresh on every call, so that is not a gap for THIS pipeline (there is no
 *     caching of "this host was OK last time"), but it does mean two back-to-back fetches of
 *     the same host are two independent trust decisions, not one. There is no cross-request
 *     DNS cache in front of this guard.
 *
 * Beyond the destination-trust guards: connect+total wall-clock timeout, a byte cap enforced by
 * aborting the stream mid-flight (never buffers unbounded), a content-type allowlist checked
 * BEFORE reading the body, no credentials/cookies/auth headers ever sent, and a bland
 * identifying User-Agent (never a browser UA — no attempt to look like an interactive client).
 *
 * Fail-safe discipline: every rejection reason is a distinct typed error
 * ({@link SsrfBlockedError} for destination-trust rejections, {@link FetchError} for everything
 * else — timeouts, oversized bodies, disallowed content-types, malformed responses). Nothing in
 * this file ever silently fetches a blocked target, and nothing ever hangs past the configured
 * timeout.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import * as http from "node:http";
import * as https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIPv4, isIPv6 } from "node:net";
import { convert } from "html-to-text";
import { parseDocument as parseBinaryDocument } from "./kbDocParser";
import { ingestDocument, isKbStudioEnabled, type IngestDocumentResult } from "./kbIngestService";

// ─── Errors ───────────────────────────────────────────────────────────────────────────────

/** Thrown when the requested target (scheme, resolved IP, or allowlist) is not trusted. */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/** Thrown for every other fetch failure: invalid URL, DNS failure, timeout, oversized body,
 * disallowed content-type, too many redirects, network/transport error. */
export class FetchError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "FetchError";
  }
}

/** Thrown when WEB_INGEST_ENABLED and/or KB_STUDIO_ENABLED is off — `ingestUrl` refuses before
 * doing any network I/O. */
export class WebIngestDisabledError extends Error {
  constructor() {
    super(
      "Web URL ingest is disabled (set WEB_INGEST_ENABLED=true AND KB_STUDIO_ENABLED=true to enable).",
    );
    this.name = "WebIngestDisabledError";
  }
}

// ─── Flags / tunables ────────────────────────────────────────────────────────────────────

/** WEB_INGEST_ENABLED gate. Default OFF — mirrors kbIngestService.isKbStudioEnabled's style.
 * Read fresh on every call (never cached), same discipline as isKbStudioEnabled. */
export function isWebIngestEnabled(): boolean {
  const v = String(process.env.WEB_INGEST_ENABLED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

/** Optional host allowlist (comma-separated hostnames). Read fresh per call so tests/ops can
 * change it without a module reload. When set, this is the ONLY thing consulted for
 * destination trust on hostname — the IP-block guard still ALSO applies (defense-in-depth),
 * but an allowlisted host that resolves to a blocked IP is still rejected. Recommended for
 * production: knowing the exact set of fetchable hosts in advance is strictly safer than any
 * IP-range heuristic. */
function getHostAllowlist(): Set<string> | null {
  const raw = (process.env.WEB_INGEST_ALLOWLIST ?? "").trim();
  if (!raw) return null;
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? new Set(hosts) : null;
}

/** Total wall-clock budget for the ENTIRE fetch, including every redirect hop and the body
 * read. There is no separate "connect" vs "total" timer — one AbortController covers the
 * whole call, which is simpler to reason about and still satisfies "connect + total ~10s". */
const TIMEOUT_MS = (() => {
  const n = Number(process.env.WEB_INGEST_TIMEOUT_MS ?? 10_000);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
})();

/** Max response body size (bytes). Enforced by aborting the stream mid-read — never buffered
 * unbounded. Checked against Content-Length up front too, when the server declares one. */
const MAX_BYTES = (() => {
  const n = Number(process.env.WEB_INGEST_MAX_BYTES ?? 5 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
})();

/** Redirect cap. Re-validated on every hop (see module doc comment, guard layer 4). */
const MAX_REDIRECTS = (() => {
  const n = Number(process.env.WEB_INGEST_MAX_REDIRECTS ?? 3);
  return Number.isFinite(n) && n >= 0 ? n : 3;
})();

/** Bound on extracted text length (chars) — mirrors kbDocParser's KB_PARSE_MAX_CHARS bounding
 * discipline for the pdf/docx path, applied here to the html/txt extraction path. */
const MAX_EXTRACTED_CHARS = (() => {
  const n = Number(process.env.WEB_INGEST_MAX_CHARS ?? 2_000_000);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
})();

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain", "application/pdf"]);

/** Bland, honestly-identifying UA — never a browser UA (no attempt to look like an
 * interactive client hitting someone else's server from inside this platform). */
const USER_AGENT = "St4iTrainingStudioBot/1.0 (+internal-kb-ingest; contact=platform-admin)";

// ─── isBlockedIp — the block matrix, built on Node's native net.BlockList ──────────────────
//
// net.BlockList is a stable, native (non-JS) implementation of exactly this primitive
// (CIDR/range membership for IPv4 + IPv6), shipped in Node core since v15 — chosen over a
// hand-rolled parser to avoid re-deriving CIDR/IPv6-expansion arithmetic for a security
// control. One IMPORTANT verified behaviour this code relies on: BlockList automatically
// normalizes an IPv4-mapped IPv6 address (e.g. "::ffff:127.0.0.1") to its embedded IPv4 form
// and checks it against the registered IPv4 rules — so IPv4 rules and IPv6 rules do not need
// to be duplicated, and an IPv4-mapped bypass attempt is caught by the SAME v4 rule as the
// plain address. (Registering a blanket "::ffff:0:0/96" IPv6 rule was deliberately NOT done —
// verified experimentally that doing so makes BlockList treat EVERY plain IPv4 address as
// blocked when checked with family "ipv4", since v4 checks are internally compared in mapped
// form too. The embedded-v4 re-check the task brief asks for is what BlockList already does
// by construction; adding that rule would have been a silent block-everything regression.)

const BLOCKED_V4_CIDRS: Array<[base: string, prefix: number]> = [
  ["127.0.0.0", 8], // loopback
  ["10.0.0.0", 8], // private
  ["172.16.0.0", 12], // private
  ["192.168.0.0", 16], // private
  ["169.254.0.0", 16], // link-local — INCLUDES cloud metadata 169.254.169.254
  ["0.0.0.0", 8], // "this network"
  ["100.64.0.0", 10], // CGNAT (RFC 6598)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved (also covers 255.255.255.255 broadcast)
];

const BLOCKED_V6_CIDRS: Array<[base: string, prefix: number]> = [
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local address (ULA)
  ["fe80::", 10], // link-local
  ["::", 128], // unspecified
  ["ff00::", 8], // multicast (not in the brief's explicit list, safe/standard addition)
  // IPv6-embedded-IPv4 escape forms: unlike `::ffff:/96` (v4-mapped, which BlockList already
  // auto-normalizes to its embedded v4 form — see the comment above this table), these two
  // encodings are NOT auto-decoded by BlockList, so a literal like "64:ff9b::169.254.169.254" or
  // "2002:7f00:0001::" (which embed the cloud-metadata address / 127.0.0.1 respectively) would
  // sail through the v4 CIDR table entirely undetected. Rather than decode-then-recheck (extra
  // parsing surface for a security control), the whole translation prefix is blocked outright.
  ["64:ff9b::", 96], // NAT64 well-known prefix (RFC 6052) — carries an embedded IPv4 address
  ["2002::", 16], // 6to4 (RFC 3056) — carries an embedded IPv4 address in bits 16-47
];

function buildBlockList(): BlockList {
  const bl = new BlockList();
  for (const [base, prefix] of BLOCKED_V4_CIDRS) bl.addSubnet(base, prefix, "ipv4");
  for (const [base, prefix] of BLOCKED_V6_CIDRS) bl.addSubnet(base, prefix, "ipv6");
  return bl;
}

const blockList = buildBlockList();

/**
 * True when `ip` (a literal IPv4 or IPv6 address string, e.g. from a DNS resolution) falls in
 * any blocked range — loopback/private/link-local/cloud-metadata/CGNAT/multicast/reserved, per
 * the module doc comment's table. An address that is not a recognisable IPv4/IPv6 literal is
 * treated as blocked (fail-safe default — this function is only ever called with addresses
 * that came back from `dns.promises.lookup`, which always returns valid literals, so this
 * branch is defense-in-depth, not an expected path).
 */
export function isBlockedIp(ip: string): boolean {
  const addr = (ip ?? "").trim();
  if (isIPv4(addr)) return blockList.check(addr, "ipv4");
  if (isIPv6(addr)) return blockList.check(addr, "ipv6");
  return true;
}

// ─── DNS + scheme + allowlist validation (guard layers 1-3) ────────────────────────────────

export interface ValidatedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

async function validateTarget(url: URL): Promise<ValidatedTarget> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(
      `Blocked scheme "${url.protocol}" for "${url.href}" — only http/https are allowed.`,
    );
  }

  const hostname = url.hostname.toLowerCase();
  const allowlist = getHostAllowlist();
  if (allowlist && !allowlist.has(hostname)) {
    throw new SsrfBlockedError(
      `Host "${hostname}" is not in WEB_INGEST_ALLOWLIST — allowlist is set, so only listed hosts are fetchable.`,
    );
  }

  // dns.promises.lookup on a bare IP literal (e.g. "http://169.254.169.254/") just echoes the
  // literal back — so URLs that skip DNS entirely by embedding an IP go through the exact
  // same block check as a hostname would.
  let records: Array<{ address: string; family: number }>;
  try {
    records = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new FetchError(
      `DNS resolution failed for "${hostname}": ${(err as Error)?.message ?? String(err)}`,
      err,
    );
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new FetchError(`DNS resolution returned no addresses for "${hostname}"`);
  }

  // Reject if ANY resolved address is blocked — not just the first one a naive implementation
  // might pick. A round-robin/rebinding-style DNS answer that mixes a public and a private
  // address must not be trusted just because one of the answers looks fine.
  const blocked = records.filter((r) => isBlockedIp(r.address));
  if (blocked.length > 0) {
    throw new SsrfBlockedError(
      `Host "${hostname}" resolves to a blocked/internal address ` +
        `(${blocked.map((b) => b.address).join(", ")}) — refusing to fetch.`,
    );
  }

  const chosen = records[0]!;
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

// ─── Pinned single-hop HTTP GET (guard layer 5 + caps) ──────────────────────────────────────

/** Custom `lookup` for http(s).request: ignores whatever hostname Node would otherwise
 * re-resolve and always hands back the ALREADY-VALIDATED address — the connect step performs
 * no DNS resolution of its own. Host header / TLS SNI still come from `options.hostname`
 * (the real hostname), so this only pins the raw socket destination, not certificate identity.
 *
 * ROBUST TO BOTH lookup-callback CONTRACTS Node uses, verified against real Node v24: `http(s)
 * .request` defaults to `autoSelectFamily: true` (Node 20+), which invokes `lookup` with
 * `options.all === true` and expects the callback to reply with an ARRAY of `{address, family}`
 * (the Happy-Eyeballs multi-address shape) — replying with the legacy 3-arg `(err, address,
 * family)` form in that case makes Node throw "Invalid IP address: undefined" and EVERY real
 * request fails closed (safe, but non-functional; the fully-mocked test suite never drove this
 * real contract, so it missed the bug). `singleHop` below also sets `autoSelectFamily: false`
 * (pinning to the single validated family, disabling happy-eyeballs), so in practice the legacy
 * branch is what actually runs — but this function replies correctly under EITHER contract
 * (belt-and-suspenders), so it stays correct even if that request option is ever removed. */
function pinnedLookup(address: string, family: 4 | 6) {
  return (
    _hostname: string,
    optionsOrCallback: unknown,
    maybeCallback?: (...args: unknown[]) => void,
  ): void => {
    const isDirectCallback = typeof optionsOrCallback === "function";
    const options = isDirectCallback ? undefined : (optionsOrCallback as { all?: boolean } | null | undefined);
    const callback = (isDirectCallback ? optionsOrCallback : maybeCallback) as (...args: unknown[]) => void;

    if (options?.all === true) {
      // Array-of-addresses contract (autoSelectFamily / happy-eyeballs lookup shape).
      callback(null, [{ address, family }]);
    } else {
      // Legacy single-address contract.
      callback(null, address, family);
    }
  };
}

export type HopResult =
  | { redirectTo: URL }
  | { statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer };

/** Exported for testing only (the unmocked loopback transport test in
 * kbWebFetcher.transport.test.ts drives this directly with an already-validated target, since
 * the SSRF guard correctly refuses to validate a loopback target — see that file's header
 * comment). Not part of the module's intended public API surface otherwise. */
export function singleHop(target: ValidatedTarget, signal: AbortSignal): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const { url, address, family } = target;
    const lib = url.protocol === "https:" ? https : http;
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

    // `autoSelectFamily` is a real, respected runtime option on http(s).request — Node forwards
    // unrecognized request options through to the underlying `net.createConnection`/`tls.connect`
    // call, which is where `autoSelectFamily` is actually consumed — but @types/node only
    // declares it on `net.TcpSocketConnectOpts`, not on `http.RequestOptions`/
    // `ClientRequestArgs` (a DefinitelyTyped gap, not a runtime restriction; verified empirically
    // against real Node v24 — see pinnedLookup's doc comment above for why this option matters).
    // Typing the options object explicitly (rather than inline) avoids TS's excess-property
    // check on object literals while keeping everything else strictly typed.
    const requestOptions: http.RequestOptions & { autoSelectFamily?: boolean } = {
      hostname: url.hostname,
      port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // Pin to the single validated address family and disable Node's default happy-eyeballs
      // auto-family-selection — that default is what makes Node invoke `lookup` with the
      // array-of-addresses contract (see pinnedLookup's doc comment above). Disabling it here
      // means the socket connects via exactly the family we already validated, no ambiguity.
      family,
      autoSelectFamily: false,
      lookup: pinnedLookup(address, family) as unknown as http.RequestOptions["lookup"],
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,text/plain,application/pdf",
        // Deliberately NO cookies, NO Authorization, NO other credential headers — this is a
        // fresh, unauthenticated, uncredentialed request every time.
      },
      signal,
    };

    const req = lib.request(
      requestOptions,
      (res) => {
        const status = res.statusCode ?? 0;

        if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
          const location = res.headers.location;
          res.resume(); // drain + discard — we never need a redirect response's body
          if (!location) {
            reject(new FetchError(`Redirect (${status}) from "${url.href}" had no Location header`));
            return;
          }
          let redirectTo: URL;
          try {
            redirectTo = new URL(location, url);
          } catch {
            reject(
              new FetchError(`Redirect Location header is not a resolvable URL: "${location}"`),
            );
            return;
          }
          resolve({ redirectTo });
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new FetchError(`Unexpected HTTP status ${status} fetching "${url.href}"`));
          return;
        }

        const contentType = String(res.headers["content-type"] ?? "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
          res.resume();
          reject(
            new FetchError(
              `Disallowed content-type "${contentType || "(none)"}" for "${url.href}" ` +
                `(allowed: ${Array.from(ALLOWED_CONTENT_TYPES).join(", ")})`,
            ),
          );
          return;
        }

        const declaredLength = Number(res.headers["content-length"] ?? NaN);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
          res.destroy();
          reject(
            new FetchError(
              `Response for "${url.href}" declares ${declaredLength} bytes, exceeding the ${MAX_BYTES}-byte cap`,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;

        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.length;
          if (received > MAX_BYTES) {
            settled = true;
            res.destroy();
            reject(
              new FetchError(
                `Response for "${url.href}" exceeded the ${MAX_BYTES}-byte cap — aborted mid-stream`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ statusCode: status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", (err) => {
          if (settled) return;
          settled = true;
          reject(new FetchError(`Response stream error fetching "${url.href}": ${err.message}`, err));
        });
      },
    );

    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.name === "AbortError") {
        reject(new FetchError(`Fetch of "${url.href}" timed out after ${TIMEOUT_MS}ms`, err));
      } else {
        reject(new FetchError(`Request to "${url.href}" failed: ${err.message}`, err));
      }
    });
    req.end();
  });
}

// ─── Text extraction ─────────────────────────────────────────────────────────────────────

const HTML_TO_TEXT_SELECTORS = [
  { selector: "script", format: "skip" as const },
  { selector: "style", format: "skip" as const },
  { selector: "nav", format: "skip" as const },
  { selector: "header", format: "skip" as const },
  { selector: "footer", format: "skip" as const },
  { selector: "img", format: "skip" as const },
  { selector: "a", options: { ignoreHref: true } },
];

function boundExtractedText(raw: string): { text: string; truncated: boolean } {
  const normalized = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_EXTRACTED_CHARS) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}

async function extractText(body: Buffer, contentType: string): Promise<{ text: string; truncated: boolean }> {
  if (contentType === "application/pdf") {
    // Reuse kbDocParser's pdf path (pdf-parse + its own timeout/char bounding) rather than
    // re-implementing pdf extraction here.
    const parsed = await parseBinaryDocument(body, "pdf");
    return { text: parsed.text, truncated: parsed.meta.truncated };
  }
  if (contentType === "text/html") {
    return boundExtractedText(convert(body.toString("utf8"), { wordwrap: false, selectors: HTML_TO_TEXT_SELECTORS }));
  }
  // text/plain (the only other allowed content-type)
  return boundExtractedText(body.toString("utf8"));
}

// ─── Public API ──────────────────────────────────────────────────────────────────────────

export interface FetchUrlResult {
  text: string;
  /** The URL actually fetched, after following any redirects. */
  finalUrl: string;
  contentType: string;
  meta: {
    redirectCount: number;
    resolvedIp: string;
    bytes: number;
    truncated: boolean;
  };
}

/**
 * Fetch `rawUrl` under the full SSRF guard (see module doc comment) and return extracted plain
 * text. Never follows the HTTP client's own redirect handling — every hop is re-validated from
 * scratch. Throws {@link SsrfBlockedError} for any destination-trust rejection (scheme, host
 * allowlist, blocked IP — on the initial URL OR any redirect hop), {@link FetchError} for
 * everything else (invalid URL, DNS failure, timeout, oversized body, disallowed content-type,
 * too many redirects, transport error).
 */
export async function fetchUrlForIngest(rawUrl: string): Promise<FetchUrlResult> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new FetchError(`Invalid URL: "${rawUrl}"`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let redirectCount = 0;
    for (;;) {
      // Re-validated on EVERY hop, including the first — a public URL can 302 to a blocked
      // target, and that must be caught before it is ever followed.
      const target = await validateTarget(current);
      const hop = await singleHop(target, controller.signal);

      if ("redirectTo" in hop) {
        redirectCount += 1;
        if (redirectCount > MAX_REDIRECTS) {
          throw new FetchError(`Too many redirects (> ${MAX_REDIRECTS}) fetching "${rawUrl}"`);
        }
        current = hop.redirectTo;
        continue;
      }

      const contentType = String(hop.headers["content-type"] ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      const { text, truncated } = await extractText(hop.body, contentType);
      return {
        text,
        finalUrl: current.href,
        contentType,
        meta: { redirectCount, resolvedIp: target.address, bytes: hop.body.length, truncated },
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── ingestUrl — wires fetchUrlForIngest into E3-1's ingestDocument pipeline ────────────────

export interface IngestUrlInput {
  corpus: string;
  url: string;
  userId?: number;
}

/**
 * Fetch `input.url` (under the full SSRF guard) and hand the extracted text to E3-1's
 * `ingestDocument` (chunk→embed→store — NOT reimplemented here). Gated behind
 * `WEB_INGEST_ENABLED` (default OFF) AND `KB_STUDIO_ENABLED` — checked here BEFORE any network
 * I/O, and `ingestDocument` re-checks `KB_STUDIO_ENABLED` itself (defense-in-depth, same
 * pattern as kbIngestRouter's uploadDocument). `sourceRef` on the stored chunks is the FINAL
 * URL (post-redirect), not necessarily the URL the caller supplied.
 */
export async function ingestUrl(input: IngestUrlInput): Promise<IngestDocumentResult> {
  if (!isWebIngestEnabled() || !isKbStudioEnabled()) {
    throw new WebIngestDisabledError();
  }

  const fetched = await fetchUrlForIngest(input.url);
  return ingestDocument({
    corpus: input.corpus,
    sourceType: "url",
    sourceRef: fetched.finalUrl,
    text: fetched.text,
    userId: input.userId,
  });
}
