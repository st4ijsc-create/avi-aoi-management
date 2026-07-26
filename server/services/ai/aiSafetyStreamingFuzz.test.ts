/**
 * doc69 W1-2 hardening — PERMANENT property/fuzz guard for `StreamingSecretRedactor`.
 *
 * WHY: this class leaked THREE separate times (see `aiSafety.test.ts`'s "Fix pass 1/2/3"
 * history and `.superpowers/sdd/ai-g2-2-report.md`), and each time the bug was caught only by
 * a hand-written EXAMPLE test (one specific PEM variant, one specific fixed chunk size) that
 * happened to exercise the exact boundary the bug lived on — Fix pass 2's own test suite, for
 * instance, tested only the RSA header variant and completely missed that OPENSSH/ENCRYPTED
 * headers (35/37 chars, both longer than the 32-char tail-hold) leaked in full. A narrow
 * example proves the code works for the cases someone thought to write down; it says nothing
 * about the much larger space of chunk-boundary splits a real token-by-token LLM stream can
 * produce. This file is the durable guard against that FAILURE MODE — not just the 3 bugs
 * already fixed — by streaming a fixed secret corpus through many different (but deterministic
 * and reproducible) chunk-size splits, instead of one or two fixed ones.
 *
 * Determinism: NO `Math.random()` / `Date.now()` anywhere. A tiny seeded LCG (`makeLcg`) drives
 * every "random" choice — both the chunk-size sequence AND the pseudo-random secret-body
 * content itself — so a failure is 100% reproducible by re-running this file, and CI runs are
 * bit-for-bit identical across machines and across runs. Seeds vary by loop index (1000+idx for
 * PEM variants, 2001-2007 for the other secret shapes, 11/12/13/21/22 for chunk-size passes).
 *
 * Scope note — connection strings are intentionally NOT asserted byte-identical: empirically
 * verified (see PROBE below / this file's `sensitiveFragment` cases) that
 * `StreamingSecretRedactor` fully protects the CREDENTIALS in a `scheme://user:pass@host` string
 * under all streaming splits, but the non-sensitive scheme prefix and host/port/db-name tail can
 * leak a few raw characters — because the pending-start pattern for connection strings only
 * covers `scheme://user:pass` (up to `@`; see `PENDING_SECRET_START_PATTERNS` in `aiSafety.ts`),
 * not the host portion after it, so the two-delimiter-style match can finalize the instant the
 * FIRST host character arrives, before the rest of the host has streamed in. This is a real,
 * currently-existing, reproducible characteristic of the redactor for this one secret shape —
 * flagged here and in the task report rather than silently asserted away, per this task's
 * explicit "do not change redactor logic" instruction. It does not affect any of the other 11
 * corpus shapes, all of which are verified fully byte-identical (prefix + placeholder + suffix)
 * even at the most extreme 1-char-at-a-time streaming granularity.
 */
import { describe, it, expect } from "vitest";
import { StreamingSecretRedactor, STREAM_HOLD_CAP } from "./aiSafety";

// ─── Seeded PRNG (LCG) — no Math.random, fully deterministic/reproducible ──────

function makeLcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ALNUM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomString(rng: () => number, alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

// ─── Secret corpus — one realistic instance of every secret SHAPE the redactor guards ──

interface SecretCase {
  label: string;
  /** The complete raw secret string, e.g. a full PEM block or `Bearer <token>`. */
  secret: string;
  /** The literal opening marker that must never appear intact in the redacted output. */
  startMarker: string;
  /** true: assert byte-identical `prefix + "[REDACTED_SECRET]" + suffix` reconstruction.
   *  false (connection strings only — see file header): assert the marker + the credential
   *  fragment never leak, without requiring the whole string to reconstruct exactly — see the
   *  file header note on why. */
  exact: boolean;
  /** Required when `exact === false`: the sensitive substring (credentials) that must never
   *  appear raw in the output, even though non-sensitive tail bytes may. */
  sensitiveFragment?: string;
}

const PEM_VARIANTS: Array<[string, string]> = [
  ["RSA", "RSA PRIVATE KEY"],
  ["OPENSSH (modern ssh-keygen default)", "OPENSSH PRIVATE KEY"],
  ["ENCRYPTED PKCS8", "ENCRYPTED PRIVATE KEY"],
  ["EC", "EC PRIVATE KEY"],
  ["DSA", "DSA PRIVATE KEY"],
  ["PKCS8 (no type word)", "PRIVATE KEY"],
];

/** Realistic multi-line base64-shaped PEM body (5-7 lines of 64 chars, like a real key dump). */
function makePemBody(rng: () => number, lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) out.push(randomString(rng, BASE64_ALPHABET, 64));
  return out.join("\n");
}

function buildCorpus(): SecretCase[] {
  const cases: SecretCase[] = [];

  PEM_VARIANTS.forEach(([label, marker], idx) => {
    const rng = makeLcg(1000 + idx); // seed varies by loop index — deterministic per variant
    const body = makePemBody(rng, 5 + (idx % 3)); // 5-7 realistic body lines
    cases.push({
      label: `PEM ${label}`,
      secret: `-----BEGIN ${marker}-----\n${body}\n-----END ${marker}-----`,
      startMarker: "-----BEGIN",
      exact: true,
    });
  });

  {
    const rng = makeLcg(2001);
    // Realistic fixed JWT header ({"alg":"HS256","typ":"JWT"}) + randomized payload/signature
    // lengths chosen so the whole token lands in the ~150-600 char range the brief asks for.
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const payload = randomString(rng, BASE64URL_ALPHABET, randInt(rng, 120, 400));
    const sig = randomString(rng, BASE64URL_ALPHABET, randInt(rng, 40, 100));
    const jwt = `${header}.${payload}.${sig}`;
    cases.push({ label: "JWT (3 dot-segments)", secret: jwt, startMarker: "eyJ", exact: true });
  }

  {
    const rng = makeLcg(2002);
    const token = randomString(rng, ALNUM_ALPHABET, randInt(rng, 20, 60));
    cases.push({ label: "Bearer <token>", secret: `Bearer ${token}`, startMarker: "Bearer ", exact: true });
  }

  {
    const rng = makeLcg(2003);
    const tail = randomString(rng, ALNUM_ALPHABET, randInt(rng, 29, 48)); // total incl. "sk-" ~32-51 chars
    cases.push({ label: "sk-... API key", secret: `sk-${tail}`, startMarker: "sk-", exact: true });
  }

  {
    const rng = makeLcg(2004);
    const value = randomString(rng, ALNUM_ALPHABET, randInt(rng, 20, 40));
    cases.push({ label: "api_key=<value>", secret: `api_key=${value}`, startMarker: "api_key=", exact: true });
  }

  {
    const rng = makeLcg(2005);
    const user = randomString(rng, ALNUM_ALPHABET, 8);
    const pass = randomString(rng, ALNUM_ALPHABET, 14);
    const host = `10.0.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`;
    cases.push({
      label: "postgres connection string",
      secret: `postgres://${user}:${pass}@${host}:5432/aoi_management`,
      startMarker: "postgres://",
      exact: false,
      sensitiveFragment: `${user}:${pass}`,
    });
  }

  {
    const rng = makeLcg(2006);
    const user = randomString(rng, ALNUM_ALPHABET, 8);
    const pass = randomString(rng, ALNUM_ALPHABET, 14);
    const host = `db-${randInt(rng, 1, 99)}.internal`;
    cases.push({
      label: "mysql connection string",
      secret: `mysql://${user}:${pass}@${host}:3306/factory_db`,
      startMarker: "mysql://",
      exact: false,
      sensitiveFragment: `${user}:${pass}`,
    });
  }

  {
    const rng = makeLcg(2007);
    const value = randomString(rng, ALNUM_ALPHABET, randInt(rng, 10, 20));
    cases.push({ label: "password=<value>", secret: `password=${value}`, startMarker: "password=", exact: true });
  }

  return cases;
}

const SECRET_CORPUS = buildCorpus();

// ─── Surrounding text — realistic EN + VI chat-assistant phrasing ──────────────

const EN_WRAPS: Array<[string, string]> = [
  ["Sure, here is the credential you asked for: ", " — let me know if you need anything else."],
  ["For debugging purposes, use this configuration value: ", " (please rotate it soon)."],
  ["The station's edge-gateway config dump includes: ", " among other unrelated fields."],
];

const VI_WRAPS: Array<[string, string]> = [
  ["Đây là thông tin xác thực bạn yêu cầu: ", " — hãy cho tôi biết nếu cần thêm."],
  ["Để phục vụ gỡ lỗi, dùng giá trị cấu hình sau: ", " (vui lòng đổi sớm)."],
  ["Bản dump cấu hình cổng biên của trạm gồm: ", " cùng vài trường khác không liên quan."],
];

// ─── Chunk-size streaming harness ───────────────────────────────────────────────

function streamRandomChunks(
  text: string,
  seed: number,
  minChunk: number,
  maxChunk: number,
): { emitted: string[]; joined: string } {
  const rng = makeLcg(seed);
  const redactor = new StreamingSecretRedactor();
  const emitted: string[] = [];
  let i = 0;
  while (i < text.length) {
    const size = Math.max(1, randInt(rng, minChunk, maxChunk));
    const chunk = text.slice(i, i + size);
    i += size;
    const out = redactor.push(chunk);
    if (out) emitted.push(out);
  }
  const remaining = redactor.flush();
  if (remaining) emitted.push(remaining);
  return { emitted, joined: emitted.join("") };
}

// 3 seeded passes in the "normal" 1..12-char chunk range (realistic token-streaming
// granularity), plus 2 in a 1..3-char TINY range — the exact granularity that caused Fix pass
// 3's leak (`-----BEGIN` scrolling out of a fixed hold window one character at a time).
const NORMAL_PASSES: Array<{ seed: number; min: number; max: number }> = [
  { seed: 11, min: 1, max: 12 },
  { seed: 12, min: 1, max: 12 },
  { seed: 13, min: 1, max: 12 },
];
const TINY_PASSES: Array<{ seed: number; min: number; max: number }> = [
  { seed: 21, min: 1, max: 3 },
  { seed: 22, min: 1, max: 3 },
];
const ALL_PASSES = [...NORMAL_PASSES, ...TINY_PASSES];

describe("StreamingSecretRedactor — permanent property/fuzz guard (doc69 W1-2 hardening)", () => {
  describe("full corpus × EN/VI wrap × seeded random chunk sizes — no raw marker/body fragment ever emitted", () => {
    SECRET_CORPUS.forEach((secretCase, idx) => {
      const [enPrefix, enSuffix] = EN_WRAPS[idx % EN_WRAPS.length];
      const [viPrefix, viSuffix] = VI_WRAPS[idx % VI_WRAPS.length];
      const wraps: Array<[string, string, string]> = [
        ["EN", enPrefix, enSuffix],
        ["VI", viPrefix, viSuffix],
      ];

      for (const [lang, prefix, suffix] of wraps) {
        const text = prefix + secretCase.secret + suffix;

        for (const pass of ALL_PASSES) {
          it(`${secretCase.label} [${lang}] — chunk ${pass.min}-${pass.max} seed ${pass.seed}`, () => {
            const { emitted, joined } = streamRandomChunks(text, pass.seed, pass.min, pass.max);

            // No individual emitted piece may ever carry the raw start marker or the full secret.
            for (const piece of emitted) {
              expect(piece).not.toContain(secretCase.startMarker);
              expect(piece).not.toContain(secretCase.secret);
            }
            expect(joined).not.toContain(secretCase.secret);
            expect(joined).not.toContain(secretCase.startMarker);

            if (secretCase.exact) {
              // Strong guarantee for 12 of the 13 shapes: exact reconstruction, no leaked and
              // no dropped bytes anywhere in the surrounding text either.
              expect(joined).toBe(prefix + "[REDACTED_SECRET]" + suffix);
            } else {
              // Connection strings only (see file header): credentials must never leak, even
              // though a few non-sensitive bytes (scheme prefix / host tail) may pass through.
              expect(joined).not.toContain(secretCase.sensitiveFragment!);
              expect(joined).toContain("[REDACTED_SECRET]");
            }
          });
        }
      }
    });
  });

  // ─── No-secret text — must stream byte-identical AND incrementally ────────────

  describe("no-secret text — byte-identical reconstruction, streamed incrementally (not held in full)", () => {
    const NO_SECRET_EN =
      "Daily QC summary: defect rate is 2.1% today, down from yesterday. Station 3 recorded the " +
      "most solder defects; recommend re-checking soldering iron temperature and the periodic " +
      "maintenance schedule for next week. No critical alarms triggered during the shift.";
    const NO_SECRET_VI =
      "Tóm tắt QC hôm nay: tỷ lệ lỗi 2.1%, giảm so với hôm qua. Trạm số 3 ghi nhận nhiều lỗi hàn " +
      "nhất, đề xuất kiểm tra lại nhiệt độ mỏ hàn và lịch bảo trì định kỳ trong tuần tới. Không " +
      "có cảnh báo nghiêm trọng nào trong ca làm việc.";

    for (const [label, text] of [
      ["EN", NO_SECRET_EN],
      ["VI", NO_SECRET_VI],
    ] as const) {
      for (const pass of NORMAL_PASSES) {
        it(`${label} normal prose, well over tail-hold size, seed ${pass.seed} — byte-identical + incremental`, () => {
          const { emitted, joined } = streamRandomChunks(text, pass.seed, pass.min, pass.max);
          expect(joined).toBe(text);
          // More than one non-empty emission proves it streamed incrementally rather than
          // being silently held back in full until flush().
          expect(emitted.length).toBeGreaterThan(1);
        });
      }
    }
  });

  // ─── Adversarial cases ──────────────────────────────────────────────────────

  describe("adversarial — -----END----- with no preceding -----BEGIN----- (no false hold)", () => {
    const text =
      "Nhật ký hệ thống: đã đóng khối khóa cũ -----END RSA PRIVATE KEY----- mà không có phần " +
      "BEGIN tương ứng (dữ liệu bị cắt trong log). System log: the old key block was closed " +
      "with -----END OPENSSH PRIVATE KEY----- and no matching BEGIN header — this is expected " +
      "malformed/truncated input, not a real secret.";

    for (const pass of NORMAL_PASSES) {
      it(`byte-identical reconstruction, seed ${pass.seed} (chunk ${pass.min}-${pass.max})`, () => {
        const { joined } = streamRandomChunks(text, pass.seed, pass.min, pass.max);
        expect(joined).toBe(text);
      });
    }
    for (const pass of TINY_PASSES) {
      it(`byte-identical reconstruction under tiny chunking, seed ${pass.seed} (chunk ${pass.min}-${pass.max})`, () => {
        const { joined } = streamRandomChunks(text, pass.seed, pass.min, pass.max);
        expect(joined).toBe(text);
      });
    }
  });

  describe("adversarial — a complete secret whose length exceeds STREAM_HOLD_CAP (bounded, no hang)", () => {
    it("does not hang and produces bounded/finite output (redaction NOT asserted — documented past-cap tradeoff)", () => {
      // Body alone is larger than STREAM_HOLD_CAP, so the hard cap forces at least one
      // flush BEFORE the closing "-----END...-----" is ever seen, even though this PEM block
      // is well-formed (has a real END marker) and would eventually complete if unbounded.
      const hugeBody = "A".repeat(STREAM_HOLD_CAP + 3000);
      const hugePem = `-----BEGIN RSA PRIVATE KEY-----\n${hugeBody}\n-----END RSA PRIVATE KEY-----`;
      const text = "Here is the archived key dump: " + hugePem + " — that block is now retired.";

      const { emitted, joined } = streamRandomChunks(text, 11, 1, 12);

      // Bounded/finite: no runaway growth (redaction only ever shrinks or roughly preserves
      // length; a generous 2x ceiling catches any pathological duplication bug without
      // over-specifying the exact past-cap byte count, which is explicitly best-effort).
      expect(typeof joined).toBe("string");
      expect(joined.length).toBeGreaterThan(0);
      expect(joined.length).toBeLessThan(text.length * 2);
      // Forced at least one flush before the natural end-of-stream flush — proves the cap
      // actually engaged rather than silently holding the whole thing in one growing buffer.
      expect(emitted.length).toBeGreaterThan(1);
      // Deliberately NOT asserting `joined` is redacted or byte-identical — past-cap behavior
      // is documented best-effort (see the STREAM_HOLD_CAP doc comment in aiSafety.ts).
    });
  });
});
