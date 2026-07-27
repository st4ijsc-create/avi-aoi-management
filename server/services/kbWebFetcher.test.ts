/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-3) — kbWebFetcher.ts unit tests.
 *
 * The SSRF guard is THE thing under test here: `isBlockedIp`'s full block matrix, scheme
 * rejection, DNS-resolved-to-private rejection BEFORE any network call, per-hop redirect
 * re-validation (including "public host 302s to a blocked target"), the redirect cap, the
 * byte/timeout/content-type caps, the optional host allowlist, and the WEB_INGEST_ENABLED /
 * KB_STUDIO_ENABLED gating on `ingestUrl`.
 *
 * NO real network call is ever made: `node:dns/promises` (`lookup`) and `node:http`/`node:https`
 * (`.request`) are fully mocked via hand-built EventEmitter fakes that mimic Node's real
 * request/response event sequencing closely enough to exercise the module's actual control
 * flow (headers → data* → end, or an 'error' event). `./kbDocParser` (only its `parseDocument`,
 * for the pdf-content-type route) and `./kbIngestService` (`ingestDocument` /
 * `isKbStudioEnabled`, for the `ingestUrl` tests) are mocked too — this file never touches a
 * real DB/model, mirroring kbIngestService.test.ts's discipline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ─── mocks: node:dns/promises, node:http, node:https ───────────────────────────────────────

const dnsLookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => dnsLookupMock(...args) }));

const httpRequestMock = vi.fn();
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, request: (...args: unknown[]) => httpRequestMock(...args) };
});

const httpsRequestMock = vi.fn();
vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  return { ...actual, request: (...args: unknown[]) => httpsRequestMock(...args) };
});

const parseBinaryDocumentMock = vi.fn();
vi.mock("./kbDocParser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./kbDocParser")>();
  return { ...actual, parseDocument: (...args: unknown[]) => parseBinaryDocumentMock(...args) };
});

const ingestDocumentMock = vi.fn();
const isKbStudioEnabledMock = vi.fn(() => true);
vi.mock("./kbIngestService", () => ({
  ingestDocument: (...args: unknown[]) => ingestDocumentMock(...args),
  isKbStudioEnabled: () => isKbStudioEnabledMock(),
}));

import {
  isBlockedIp,
  fetchUrlForIngest,
  ingestUrl,
  isWebIngestEnabled,
  SsrfBlockedError,
  FetchError,
  WebIngestDisabledError,
} from "./kbWebFetcher";

// ─── mock HTTP transport helpers ────────────────────────────────────────────────────────────

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  chunks?: Buffer[];
  streamError?: Error;
}

/** A `lib.request` fake that responds with one fixed MockRes on every call. */
function fixedResponder(res: MockRes) {
  return vi.fn((options: any, callback: (res: any) => void) => {
    const req: any = new EventEmitter();
    req.end = vi.fn();
    req.destroy = vi.fn(() => {
      req.destroyed = true;
    });
    queueMicrotask(() => {
      const fakeRes: any = new EventEmitter();
      fakeRes.statusCode = res.statusCode;
      fakeRes.headers = res.headers;
      fakeRes.resume = vi.fn();
      fakeRes.destroy = vi.fn(() => {
        fakeRes.destroyed = true;
      });
      callback(fakeRes);
      queueMicrotask(() => {
        for (const chunk of res.chunks ?? []) fakeRes.emit("data", chunk);
        if (res.streamError) fakeRes.emit("error", res.streamError);
        else fakeRes.emit("end");
      });
    });
    return req;
  });
}

/** A `lib.request` fake that fires a request-level 'error' event (network failure). */
function erroringRequester(err: Error) {
  return vi.fn((_options: any) => {
    const req: any = new EventEmitter();
    req.end = vi.fn();
    req.destroy = vi.fn();
    queueMicrotask(() => req.emit("error", err));
    return req;
  });
}

/** A `lib.request` fake that never calls back — only reacts to the request's AbortSignal
 * (simulating Node's real "signal aborted ⇒ request emits an AbortError" behaviour), so the
 * module's own timeout (`setTimeout(() => controller.abort(), TIMEOUT_MS)`) is what resolves
 * the test, not a fake timer. */
function hangingRequester() {
  return vi.fn((options: any) => {
    const req: any = new EventEmitter();
    req.end = vi.fn();
    req.destroy = vi.fn();
    const signal: AbortSignal | undefined = options.signal;
    const onAbort = () => {
      const err: any = new Error("The operation was aborted");
      err.name = "AbortError";
      queueMicrotask(() => req.emit("error", err));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    return req;
  });
}

function lastRequestOptions(mock = httpRequestMock): any {
  return mock.mock.calls.at(-1)?.[0];
}

// ─── env plumbing ────────────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  "WEB_INGEST_ENABLED",
  "WEB_INGEST_ALLOWLIST",
  "WEB_INGEST_TIMEOUT_MS",
  "WEB_INGEST_MAX_BYTES",
  "WEB_INGEST_MAX_REDIRECTS",
  "WEB_INGEST_MAX_CHARS",
  "KB_STUDIO_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.clearAllMocks();
  isKbStudioEnabledMock.mockReturnValue(true);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function loadFresh() {
  vi.resetModules();
  return import("./kbWebFetcher");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// isBlockedIp — the block matrix
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("isBlockedIp — block matrix", () => {
  it.each([
    ["127.0.0.1", true, "loopback"],
    ["10.0.0.5", true, "private 10/8"],
    ["10.255.255.255", true, "private 10/8 edge"],
    ["172.16.0.1", true, "private 172.16/12 lower edge"],
    ["172.31.255.255", true, "private 172.16/12 upper edge"],
    ["172.32.0.1", false, "just outside 172.16/12"],
    ["192.168.0.1", true, "private 192.168/16"],
    ["169.254.169.254", true, "link-local — cloud metadata"],
    ["169.254.0.1", true, "link-local"],
    ["0.0.0.0", true, "this-network"],
    ["100.64.0.1", true, "CGNAT"],
    ["100.127.255.255", true, "CGNAT edge"],
    ["100.128.0.1", false, "just outside CGNAT"],
    ["224.0.0.1", true, "multicast"],
    ["240.0.0.1", true, "reserved"],
    ["255.255.255.255", true, "broadcast (inside reserved/4)"],
    ["8.8.8.8", false, "public (Google DNS)"],
    ["1.1.1.1", false, "public (Cloudflare)"],
    ["93.184.216.34", false, "public (example.com)"],
    ["::1", true, "IPv6 loopback"],
    ["fc00::1", true, "IPv6 ULA"],
    ["fe80::1", true, "IPv6 link-local"],
    ["::", true, "IPv6 unspecified"],
    ["::ffff:127.0.0.1", true, "IPv4-mapped loopback"],
    ["::ffff:169.254.169.254", true, "IPv4-mapped cloud metadata"],
    ["::ffff:8.8.8.8", false, "IPv4-mapped public"],
    ["2001:4860:4860::8888", false, "public IPv6 (Google DNS)"],
    ["2606:4700:4700::1111", false, "public IPv6 (Cloudflare)"],
    ["64:ff9b::169.254.169.254", true, "NAT64 (RFC 6052) embedding cloud-metadata IPv4"],
    ["64:ff9b::7f00:1", true, "NAT64 (RFC 6052) embedding 127.0.0.1 (hex form)"],
    ["2002:7f00:0001::", true, "6to4 (RFC 3056) embedding 127.0.0.1"],
    ["2002:a9fe:a9fe::", true, "6to4 (RFC 3056) embedding 169.254.169.254"],
  ])("isBlockedIp(%s) === %s (%s)", (ip, expected) => {
    expect(isBlockedIp(ip)).toBe(expected);
  });

  it("treats an unrecognisable literal as blocked (fail-safe default)", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// scheme allowlist
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("fetchUrlForIngest — scheme allowlist", () => {
  it.each(["file:///etc/passwd", "ftp://example.com/x", "data:text/plain;base64,aGk=", "gopher://example.com/"])(
    "rejects %s before any DNS lookup or network call",
    async (url) => {
      await expect(fetchUrlForIngest(url)).rejects.toThrow(SsrfBlockedError);
      expect(dnsLookupMock).not.toHaveBeenCalled();
      expect(httpRequestMock).not.toHaveBeenCalled();
      expect(httpsRequestMock).not.toHaveBeenCalled();
    },
  );

  it("an invalid URL string throws FetchError, not SsrfBlockedError", async () => {
    await expect(fetchUrlForIngest("not a url at all")).rejects.toThrow(FetchError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// DNS-resolved-IP guard — rejected BEFORE any fetch
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("fetchUrlForIngest — DNS-resolved-IP guard", () => {
  it("a hostname resolving to a private IP is rejected before any HTTP request is made", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }]);
    await expect(fetchUrlForIngest("http://internal.example/")).rejects.toThrow(SsrfBlockedError);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("cloud metadata IP resolution is rejected", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(fetchUrlForIngest("http://metadata.google.internal/")).rejects.toThrow(SsrfBlockedError);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("rejects when ANY of several resolved addresses is blocked, even if others are public", async () => {
    dnsLookupMock.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(fetchUrlForIngest("http://mixed.example/")).rejects.toThrow(SsrfBlockedError);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("a DNS lookup failure (NXDOMAIN-style) is a FetchError, not silently swallowed", async () => {
    dnsLookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(fetchUrlForIngest("http://doesnotexist.example/")).rejects.toThrow(FetchError);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("an all-public resolution proceeds to the HTTP request, pinned to the validated address", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({
        statusCode: 200,
        headers: { "content-type": "text/plain" },
        chunks: [Buffer.from("hello world")],
      }),
    );
    const result = await fetchUrlForIngest("http://example.com/page");
    expect(result.text).toBe("hello world");
    expect(result.meta.resolvedIp).toBe("93.184.216.34");

    const opts = lastRequestOptions();
    expect(opts.hostname).toBe("example.com"); // Host header / SNI stay the real hostname
    expect(typeof opts.lookup).toBe("function");
    // Invoking the pinned lookup must hand back the validated address, not re-resolve DNS.
    const cb = vi.fn();
    opts.lookup("example.com", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(dnsLookupMock).toHaveBeenCalledTimes(1); // only the guard's own lookup — none from `lookup()`
  });

  it("sends no credentials/cookies/auth headers, and a bland non-browser User-Agent", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({ statusCode: 200, headers: { "content-type": "text/plain" }, chunks: [Buffer.from("x")] }),
    );
    await fetchUrlForIngest("http://example.com/");
    const opts = lastRequestOptions();
    expect(opts.headers.Cookie).toBeUndefined();
    expect(opts.headers.Authorization).toBeUndefined();
    expect(opts.headers["User-Agent"]).toMatch(/^St4i/);
    expect(opts.headers["User-Agent"].toLowerCase()).not.toMatch(/mozilla|chrome|safari/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// redirects — manual following, per-hop re-validation, cap
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("fetchUrlForIngest — redirects", () => {
  it("a 302 from a public host to an internal/metadata target is REJECTED, not followed", async () => {
    dnsLookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === "public.example") return [{ address: "93.184.216.34", family: 4 }];
      if (hostname === "169.254.169.254") return [{ address: "169.254.169.254", family: 4 }];
      throw new Error(`unexpected hostname in test: ${hostname}`);
    });
    httpRequestMock.mockImplementationOnce(
      fixedResponder({
        statusCode: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    await expect(fetchUrlForIngest("http://public.example/redirect-me")).rejects.toThrow(SsrfBlockedError);
    // Exactly ONE HTTP request was ever made — the redirect target was never actually fetched.
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it("follows a same-scheme redirect to another public host and returns the final URL", async () => {
    dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock
      .mockImplementationOnce(fixedResponder({ statusCode: 302, headers: { location: "http://final.example/landed" } }))
      .mockImplementationOnce(
        fixedResponder({ statusCode: 200, headers: { "content-type": "text/plain" }, chunks: [Buffer.from("landed page")] }),
      );
    const result = await fetchUrlForIngest("http://start.example/go");
    expect(result.finalUrl).toBe("http://final.example/landed");
    expect(result.text).toBe("landed page");
    expect(result.meta.redirectCount).toBe(1);
  });

  it("enforces the redirect cap (default 3) — a redirect loop is aborted, never followed forever", async () => {
    dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementation(
      fixedResponder({ statusCode: 302, headers: { location: "http://loop.example/again" } }),
    );
    await expect(fetchUrlForIngest("http://loop.example/start")).rejects.toThrow(FetchError);
    await expect(fetchUrlForIngest("http://loop.example/start")).rejects.toThrow(/too many redirects/i);
    // 1 initial + 3 allowed redirects = 4 requests before the 4th redirect trips the cap.
    expect(httpRequestMock).toHaveBeenCalledTimes(8); // two fetchUrlForIngest calls above, 4 each
  });

  it("a redirect with no Location header is a FetchError", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(fixedResponder({ statusCode: 302, headers: {} }));
    await expect(fetchUrlForIngest("http://example.com/")).rejects.toThrow(FetchError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// caps: timeout, byte size, content-type
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("fetchUrlForIngest — caps", () => {
  it("a disallowed content-type is rejected without reading the body", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({ statusCode: 200, headers: { "content-type": "application/octet-stream" }, chunks: [Buffer.from("bin")] }),
    );
    await expect(fetchUrlForIngest("http://example.com/file.bin")).rejects.toThrow(FetchError);
  });

  it("a declared Content-Length over the cap is rejected before streaming", async () => {
    process.env.WEB_INGEST_MAX_BYTES = "100";
    const fresh = await loadFresh();
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({
        statusCode: 200,
        headers: { "content-type": "text/plain", "content-length": "999999" },
      }),
    );
    await expect(fresh.fetchUrlForIngest("http://example.com/huge")).rejects.toThrow(/exceed/i);
  });

  it("an oversized response (no Content-Length declared) is aborted mid-stream, never buffered whole", async () => {
    process.env.WEB_INGEST_MAX_BYTES = "50";
    const fresh = await loadFresh();
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({
        statusCode: 200,
        headers: { "content-type": "text/plain" },
        chunks: [Buffer.alloc(30, "a"), Buffer.alloc(30, "b")], // 30 then 60 total > 50 cap
      }),
    );
    await expect(fresh.fetchUrlForIngest("http://example.com/stream")).rejects.toThrow(/50-byte cap/);
  });

  it("a hung connection is aborted by the total timeout, never hangs forever", async () => {
    process.env.WEB_INGEST_TIMEOUT_MS = "20";
    const fresh = await loadFresh();
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(hangingRequester());
    await expect(fresh.fetchUrlForIngest("http://example.com/hang")).rejects.toThrow(/timed out/i);
  }, 2000);

  it("a transport-level network error surfaces as FetchError", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(erroringRequester(new Error("ECONNRESET")));
    await expect(fetchUrlForIngest("http://example.com/reset")).rejects.toThrow(FetchError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// content extraction: html / text / pdf
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("fetchUrlForIngest — content extraction", () => {
  it("extracts real text from HTML, dropping script/style/nav/header/footer boilerplate", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    const html =
      "<html><head><style>.x{color:red}</style><script>alert(1)</script></head><body>" +
      "<nav>NAV LINK</nav><header>SITE HEADER</header>" +
      "<main><h1>Real Title</h1><p>Real paragraph content.</p></main>" +
      "<footer>SITE FOOTER</footer></body></html>";
    httpRequestMock.mockImplementationOnce(
      fixedResponder({ statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, chunks: [Buffer.from(html)] }),
    );
    const result = await fetchUrlForIngest("http://example.com/article");
    expect(result.contentType).toBe("text/html");
    // html-to-text renders <h1> in uppercase by default — assert case-insensitively for the
    // heading, exact-case for the paragraph.
    expect(result.text.toLowerCase()).toContain("real title");
    expect(result.text).toContain("Real paragraph content.");
    expect(result.text).not.toContain("NAV LINK");
    expect(result.text).not.toContain("SITE HEADER");
    expect(result.text).not.toContain("SITE FOOTER");
    expect(result.text).not.toContain("alert(1)");
    expect(result.text).not.toContain("color:red");
  });

  it("routes application/pdf content through kbDocParser.parseDocument (reused, not reimplemented)", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    const pdfBytes = Buffer.from("%PDF-1.4 fake");
    httpRequestMock.mockImplementationOnce(
      fixedResponder({ statusCode: 200, headers: { "content-type": "application/pdf" }, chunks: [pdfBytes] }),
    );
    parseBinaryDocumentMock.mockResolvedValueOnce({
      text: "pdf extracted text",
      meta: { sourceType: "pdf", charCount: 19, truncated: false },
    });
    const result = await fetchUrlForIngest("http://example.com/manual.pdf");
    expect(result.text).toBe("pdf extracted text");
    expect(parseBinaryDocumentMock).toHaveBeenCalledWith(expect.any(Buffer), "pdf");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// optional host allowlist (WEB_INGEST_ALLOWLIST)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("fetchUrlForIngest — WEB_INGEST_ALLOWLIST", () => {
  it("when set, a non-allowlisted host is rejected BEFORE any DNS lookup", async () => {
    process.env.WEB_INGEST_ALLOWLIST = "good.example.com, other.example.com";
    const fresh = await loadFresh();
    // NOTE: `fresh` is a distinct module instance (vi.resetModules()), so its SsrfBlockedError
    // class is a different object identity than the one statically imported at the top of this
    // file — assert with the freshly-loaded module's OWN error class, not the outer one.
    await expect(fresh.fetchUrlForIngest("http://evil.example.com/x")).rejects.toThrow(fresh.SsrfBlockedError);
    await expect(fresh.fetchUrlForIngest("http://evil.example.com/x")).rejects.toThrow(/WEB_INGEST_ALLOWLIST/);
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it("when set, an allowlisted host is still fetchable (and still IP-guarded)", async () => {
    process.env.WEB_INGEST_ALLOWLIST = "good.example.com";
    const fresh = await loadFresh();
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({ statusCode: 200, headers: { "content-type": "text/plain" }, chunks: [Buffer.from("ok")] }),
    );
    const result = await fresh.fetchUrlForIngest("http://good.example.com/x");
    expect(result.text).toBe("ok");
  });

  it("when unset, any public host is fetchable (IP-guard-only mode)", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({ statusCode: 200, headers: { "content-type": "text/plain" }, chunks: [Buffer.from("ok")] }),
    );
    const result = await fetchUrlForIngest("http://anything.example/");
    expect(result.text).toBe("ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ingestUrl — WEB_INGEST_ENABLED / KB_STUDIO_ENABLED gating + happy path
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("isWebIngestEnabled", () => {
  it("defaults to false when unset", () => {
    expect(isWebIngestEnabled()).toBe(false);
  });
  it("true for 'true' and '1'", () => {
    process.env.WEB_INGEST_ENABLED = "true";
    expect(isWebIngestEnabled()).toBe(true);
    process.env.WEB_INGEST_ENABLED = "1";
    expect(isWebIngestEnabled()).toBe(true);
  });
});

describe("ingestUrl — flag gating", () => {
  it("WEB_INGEST_ENABLED off (default) ⇒ WebIngestDisabledError, no DNS/fetch/ingestDocument touched", async () => {
    await expect(ingestUrl({ corpus: "c1", url: "http://example.com/" })).rejects.toThrow(WebIngestDisabledError);
    expect(dnsLookupMock).not.toHaveBeenCalled();
    expect(httpRequestMock).not.toHaveBeenCalled();
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("WEB_INGEST_ENABLED on but KB_STUDIO_ENABLED off ⇒ WebIngestDisabledError", async () => {
    process.env.WEB_INGEST_ENABLED = "true";
    isKbStudioEnabledMock.mockReturnValue(false);
    await expect(ingestUrl({ corpus: "c1", url: "http://example.com/" })).rejects.toThrow(WebIngestDisabledError);
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it("both flags on ⇒ proceeds to fetch", async () => {
    process.env.WEB_INGEST_ENABLED = "true";
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({ statusCode: 200, headers: { "content-type": "text/plain" }, chunks: [Buffer.from("hi")] }),
    );
    ingestDocumentMock.mockResolvedValueOnce({
      corpus: "c1",
      sourceRef: "http://example.com/",
      chunksAdded: 1,
      parsedMeta: { sourceType: "url", charCount: 2, truncated: false },
    });
    await ingestUrl({ corpus: "c1", url: "http://example.com/" });
    expect(dnsLookupMock).toHaveBeenCalled();
  });
});

describe("ingestUrl — happy path (mock fetch + dns + ingestDocument)", () => {
  it("fetches a public html page → extracts text → calls ingestDocument with sourceType:'url'", async () => {
    process.env.WEB_INGEST_ENABLED = "true";
    dnsLookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock.mockImplementationOnce(
      fixedResponder({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        chunks: [Buffer.from("<html><body><h1>Doc Title</h1><p>Body text here.</p></body></html>")],
      }),
    );
    ingestDocumentMock.mockResolvedValueOnce({
      corpus: "vendor-docs",
      sourceRef: "http://example.com/page",
      chunksAdded: 1,
      parsedMeta: { sourceType: "url", charCount: 20, truncated: false },
    });

    const result = await ingestUrl({ corpus: "vendor-docs", url: "http://example.com/page", userId: 7 });

    expect(ingestDocumentMock).toHaveBeenCalledTimes(1);
    const call = ingestDocumentMock.mock.calls[0]![0];
    expect(call).toMatchObject({
      corpus: "vendor-docs",
      sourceType: "url",
      sourceRef: "http://example.com/page",
      userId: 7,
    });
    expect(call.text.toLowerCase()).toContain("doc title");
    expect(call.text).toContain("Body text here.");
    expect(result.chunksAdded).toBe(1);
  });

  it("sourceRef passed to ingestDocument is the FINAL URL after redirects, not the input URL", async () => {
    process.env.WEB_INGEST_ENABLED = "true";
    dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    httpRequestMock
      .mockImplementationOnce(fixedResponder({ statusCode: 302, headers: { location: "http://example.com/landed" } }))
      .mockImplementationOnce(
        fixedResponder({ statusCode: 200, headers: { "content-type": "text/plain" }, chunks: [Buffer.from("landed")] }),
      );
    ingestDocumentMock.mockResolvedValueOnce({
      corpus: "c1",
      sourceRef: "http://example.com/landed",
      chunksAdded: 1,
      parsedMeta: { sourceType: "url", charCount: 6, truncated: false },
    });

    await ingestUrl({ corpus: "c1", url: "http://example.com/start" });
    expect(ingestDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: "http://example.com/landed" }),
    );
  });
});
