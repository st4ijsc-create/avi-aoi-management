/**
 * AI Safety layer (doc 69 Wave 1, G2-2) — prompt-injection scan + secret/PII redaction +
 * output leak check.
 *
 * WHY: prior to this module there was ZERO safety layer between user text / tool-result
 * JSON and the local LLM prompt — no injection detection, no redaction (in OR out). This
 * file is PURE (no env reads, no I/O, no throws) so the detection/redaction logic is
 * trivially unit-testable; the env-gated wiring (AI_SAFETY_ENABLED / AI_SAFETY_BLOCK_HIGH_RISK,
 * fail-safe try/catch, compact flag recording) lives in `../aiGateway.ts` (planInference),
 * which is the single choke-point this task wires into.
 *
 * POSTURE (see aiGateway.ts for the enforcement of this posture):
 *   - redaction (secrets/PII) is ALWAYS safe to apply — it never changes MEANING, only masks
 *     sensitive substrings with a stable placeholder, so callers can apply it unconditionally.
 *   - injection scanning is a HEURISTIC signal only (`risk` + `matched` labels) — the caller
 *     decides whether to flag-only (default) or hard-block. The pattern lists below are
 *     deliberately narrow (anchored to concrete attack verbs/nouns, e.g. "ignore previous
 *     INSTRUCTIONS", not bare "ignore"/"bỏ qua") so ordinary manufacturing text — RCA
 *     requests, SOP references, "so sánh"/"compare", "bỏ qua cảnh báo" (ignore the OLD
 *     ALARM, a completely normal operator instruction) — does NOT read as an attack.
 *
 * All functions are pure: same input → same output, no side effects, never throw (a
 * malformed/huge input degrades to "no matches" rather than throwing — see the try/catch
 * WRAPPING at the aiGateway call-site for the outer fail-safe contract).
 */

// ─── Types ──────────────────────────────────────────────────────

export type InjectionRisk = "none" | "low" | "high";

export interface InjectionScanResult {
  risk: InjectionRisk;
  /** Machine-readable labels of the patterns that matched (empty when risk === "none"). */
  matched: string[];
}

export interface RedactionCount {
  type: string;
  count: number;
}

export interface RedactionResult {
  text: string;
  redactions: RedactionCount[];
}

export interface OutputCheckResult extends RedactionResult {
  /** Labels of leak signals found in the OUTPUT (e.g. the model echoing its system prompt). */
  leakFlags: string[];
}

/** Compact summary attached to a gateway plan / logged — NEVER carries the raw text. */
export interface SafetyFlagsSummary {
  scope: "input" | "output";
  risk: InjectionRisk;
  matched: string[];
  redactedCount: number;
  /** Unique redaction types seen (e.g. ["email","api_key"]) — compact, no raw values. */
  redactionTypes: string[];
}

export interface SafetyResult {
  text: string;
  flags: SafetyFlagsSummary;
}

// ─── Injection / jailbreak scan (INPUT) ────────────────────────
//
// Anchored to concrete attack verb+noun combinations so generic manufacturing vocabulary
// ("ignore the old alarm", "so sánh với tuần trước", "bỏ qua bước kiểm tra cũ") never lands
// in HIGH. HIGH = a clear attempt to override/exfiltrate instructions. LOW = a weaker signal
// (bare "system prompt" mention, generic "act as a ..." roleplay) worth flagging but common
// enough in legitimate use (translator/reviewer roleplay, asking what the assistant can do)
// that it must never hard-block by default.

interface LabeledPattern {
  label: string;
  re: RegExp;
}

const INJECTION_HIGH: LabeledPattern[] = [
  { label: "ignore_instructions", re: /\bignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)\b/i },
  { label: "disregard_system_prompt", re: /\bdisregard\s+(the\s+)?(system\s+)?(prompt|instructions?|rules?)\b/i },
  { label: "forget_instructions", re: /\bforget\s+(your\s+|my\s+|the\s+)?(all\s+|any\s+)?(previous|prior|earlier)\s+(instructions?|rules?)\b/i },
  { label: "reveal_system_prompt", re: /\b(reveal|show\s+me|print|output|repeat)\s+(your\s+)?(the\s+)?(system\s+)?prompt\b/i },
  { label: "reveal_instructions", re: /\bwhat\s+(is|are)\s+your\s+(system\s+)?(instructions?|rules?)\b/i },
  { label: "role_hijack", re: /\byou\s+are\s+now\s+[a-z0-9]/i },
  { label: "unrestricted_persona", re: /\b(act\s+as|become)\s+(an?\s+)?(unrestricted|jailbroken|uncensored)\b/i },
  { label: "dan_jailbreak", re: /\bDAN\b[^.]{0,20}\b(mode|jailbreak)\b/i },
  { label: "exfiltrate_secret", re: /\b(exfiltrate|leak)\s+(the\s+)?(api[\s_-]?key|secret|credentials?|password)\b/i },
  // Vietnamese: "bỏ qua [tất cả/mọi] các hướng dẫn/chỉ thị/lệnh [trước/trên/hệ thống]"
  { label: "vi_ignore_instructions", re: /\bbỏ\s*qua\s+(mọi\s+|tất\s*cả\s+)?(các\s+)?(hướng\s*dẫn|chỉ\s*thị|lệnh)\s*(trước|trên|hệ\s*thống)?/i },
  { label: "vi_reveal_system_prompt", re: /\btiết\s*lộ\s+(prompt|hướng\s*dẫn)\s*hệ\s*thống/i },
];

const INJECTION_LOW: LabeledPattern[] = [
  { label: "system_prompt_mention", re: /\bsystem\s+prompt\b/i },
  { label: "roleplay_pretend", re: /\bpretend\s+(to\s+be|you\s+are)\b/i },
  { label: "roleplay_act_as", re: /\bact\s+as\s+(a|an)\b/i },
  { label: "jailbreak_mention", re: /\bjailbreak\b/i },
  { label: "bypass_rules", re: /\bbypass\s+(your\s+)?(restrictions?|rules?|filters?)\b/i },
];

/**
 * Heuristic prompt-injection / jailbreak scan. PURE. Returns 'high' when a clear
 * override/exfiltration attempt is matched, 'low' for a weaker signal only, else 'none'.
 */
export function scanForInjection(text: string): InjectionScanResult {
  if (!text || typeof text !== "string") return { risk: "none", matched: [] };

  const highMatched = INJECTION_HIGH.filter((p) => p.re.test(text)).map((p) => p.label);
  if (highMatched.length > 0) return { risk: "high", matched: highMatched };

  const lowMatched = INJECTION_LOW.filter((p) => p.re.test(text)).map((p) => p.label);
  if (lowMatched.length > 0) return { risk: "low", matched: lowMatched };

  return { risk: "none", matched: [] };
}

// ─── Secret / PII redaction (used for BOTH input and output) ──

interface RedactPattern {
  type: string;
  re: RegExp;
  placeholder: string;
}

// Order matters: multi-line/structured patterns first (PEM blocks, connection strings) so a
// later narrower pattern doesn't fragment a match already claimed by a broader one.
const REDACT_PATTERNS: RedactPattern[] = [
  {
    type: "private_key",
    re: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
    placeholder: "[REDACTED_SECRET]",
  },
  // scheme://user:pass@host — generic DB/broker connection string with embedded credentials.
  {
    type: "connection_string",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@]+@[^\s]+/gi,
    placeholder: "[REDACTED_SECRET]",
  },
  { type: "bearer_token", re: /\bBearer\s+[A-Za-z0-9\-_.]{10,}/gi, placeholder: "[REDACTED_SECRET]" },
  { type: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, placeholder: "[REDACTED_SECRET]" },
  // Recognizable API-key-shaped prefixes (OpenAI-style sk-…, GitHub ghp_…, AWS AKIA…).
  { type: "api_key", re: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g, placeholder: "[REDACTED_SECRET]" },
  // Labeled key=value / key: value forms (api_key=, access_token:, client_secret=…).
  {
    type: "api_key",
    re: /\b(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{12,}["']?/gi,
    placeholder: "[REDACTED_SECRET]",
  },
  // password=/pwd:/passwd= forms. Deliberately EXCLUDES bare "pass" (QC "Pass/Fail" status
  // text like "Pass: PASSED" is common manufacturing vocabulary and must not be redacted).
  {
    type: "password",
    re: /\b(?:password|pwd|passwd)\s*[:=]\s*["']?[^\s"']{4,}["']?/gi,
    placeholder: "[REDACTED_SECRET]",
  },
  { type: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: "[REDACTED_EMAIL]" },
  // NOTE: phone numbers are handled separately by `redactPhones()` below, NOT via this
  // shape-only pattern list — see that function's doc comment for why.
];

// Secret-only subset (excludes email/phone, which are PII rather than credentials). Used by
// `redactSecretsOnly()` for the streaming per-chunk redaction path (doc69 review fix), where
// we deliberately want only the highest-severity signal, not the full PII scan.
const SECRET_ONLY_TYPES = new Set(["private_key", "connection_string", "bearer_token", "jwt", "api_key", "password"]);
const SECRET_REDACT_PATTERNS: RedactPattern[] = REDACT_PATTERNS.filter((p) => SECRET_ONLY_TYPES.has(p.type));

function applyRedactPatterns(text: string, patterns: RedactPattern[]): RedactionResult {
  let out = text;
  const counts = new Map<string, number>();
  for (const p of patterns) {
    out = out.replace(p.re, () => {
      counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
      return p.placeholder;
    });
  }
  const redactions: RedactionCount[] = [...counts.entries()].map(([type, count]) => ({ type, count }));
  return { text: out, redactions };
}

// ─── Phone redaction — context-aware ────────────────────────────
//
// A bare VN-mobile-prefixed digit run (03/05/07/08/09 + 8 digits, optional +84) is
// shape-identical to a large share of manufacturing serial/lot/batch/barcode values, which
// are also just digit strings, often starting with "0". Redacting on shape alone corrupts
// production text — e.g. `redactSecretsAndPII("Số lô: 0912345678-A")` used to mangle a lot
// number into "[REDACTED_PHONE]-A" (doc69 review finding). A phone-shaped number is now only
// redacted when ONE of:
//   (a) a phone/contact keyword appears within a few characters before or after it
//       (sđt/số điện thoại/điện thoại/liên hệ/hotline/gọi/phone/tel/mobile/zalo/call), or
//   (b) it is written with internal separators (space/dot/hyphen) — the way humans actually
//       type phone numbers ("0912 345 678", "+84-91-234-5678") — a formatting signal strong
//       enough on its own even without a keyword.
// A lot/serial/batch/barcode label immediately before the digits ALWAYS suppresses redaction
// (checked first, wins even if a phone keyword also happens to be nearby), since that
// combination is the exact false-positive this guards against.
const PHONE_RE = /(?<![A-Za-z0-9.])(?:\+84|0)[35789](?:[\s.-]?\d){8}(?!\d)/g;
// NOTE: plain `\b` is ASCII-only (defined via \w = [A-Za-z0-9_]) and silently fails to match
// at the edges of Vietnamese diacritic letters (đ, ệ, ô, …) — e.g. a trailing \b right after
// "hệ" or "lô" never fires because neither the diacritic vowel nor the punctuation/space that
// follows it counts as \w, so no ASCII word/non-word transition exists. Use explicit
// Unicode-letter/number-aware boundaries (requires the `u` flag) instead.
const WORD_BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}_])";
const WORD_BOUNDARY_AFTER = "(?![\\p{L}\\p{N}_])";
const PHONE_CONTEXT_RE = new RegExp(
  `${WORD_BOUNDARY_BEFORE}(sđt|số\\s*điện\\s*thoại|điện\\s*thoại|liên\\s*hệ|hotline|gọi|phone|tel|mobile|zalo|call)${WORD_BOUNDARY_AFTER}`,
  "iu",
);
const LOT_LABEL_RE = new RegExp(
  `${WORD_BOUNDARY_BEFORE}(lô|lot|batch|serial|s/n|sn|mã|barcode)${WORD_BOUNDARY_AFTER}\\s*[:#.-]?\\s*$`,
  "iu",
);
const PHONE_CONTEXT_BEFORE_CHARS = 30;
const PHONE_CONTEXT_AFTER_CHARS = 15;

function redactPhones(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(PHONE_RE, (match: string, offset: number, full: string) => {
    const before = full.slice(Math.max(0, offset - PHONE_CONTEXT_BEFORE_CHARS), offset);
    if (LOT_LABEL_RE.test(before)) return match; // lot/serial/batch/barcode label wins — never a phone
    const after = full.slice(offset + match.length, offset + match.length + PHONE_CONTEXT_AFTER_CHARS);
    const hasContext = PHONE_CONTEXT_RE.test(before) || PHONE_CONTEXT_RE.test(after);
    const looksFormatted = /[\s.-]/.test(match); // internal separator = typed as a phone number
    if (!hasContext && !looksFormatted) return match; // bare digit run, no signal — leave production data alone
    count++;
    return "[REDACTED_PHONE]";
  });
  return { text: out, count };
}

/**
 * Redact obvious secrets (API keys, Bearer tokens, password=/pwd: forms, private keys,
 * DB/broker connection strings) and PII (emails, VN phone numbers) with a stable
 * placeholder. PURE, idempotent (re-running on already-redacted text is a no-op since the
 * placeholders don't match any pattern). Never throws.
 */
export function redactSecretsAndPII(text: string): RedactionResult {
  if (!text || typeof text !== "string") return { text: text ?? "", redactions: [] };

  const base = applyRedactPatterns(text, REDACT_PATTERNS);
  const { text: withPhones, count: phoneCount } = redactPhones(base.text);
  const redactions = phoneCount > 0 ? [...base.redactions, { type: "phone", count: phoneCount }] : base.redactions;
  return { text: withPhones, redactions };
}

/**
 * Redact ONLY secret/credential-shaped patterns (private keys, connection strings, Bearer
 * tokens, JWTs, API keys, password= forms) — deliberately EXCLUDES email/phone PII. Used for
 * the streaming per-chunk redaction path (doc69 review fix), where a lighter/cheaper check
 * per token chunk is preferable to the full scan. PURE, never throws.
 */
export function redactSecretsOnly(text: string): RedactionResult {
  if (!text || typeof text !== "string") return { text: text ?? "", redactions: [] };
  return applyRedactPatterns(text, SECRET_REDACT_PATTERNS);
}

// ─── Streaming secret redaction (STATEFUL) ───────────────────────
//
// doc69 W1-2 fix — replaces an earlier FIXED-size (64-char) trailing hold-back window that
// looked correct but failed on realistic LONG secrets: a model-echoed PEM private key
// (~180+ chars) or JWT (~150 chars), streamed token-by-token in small chunks, has its opening
// delimiter (`-----BEGIN...KEY-----`, `eyJ...`) scroll past the fixed window and get released
// as plain text BEFORE the closing delimiter ever arrives — the two-delimiter regex
// (`redactSecretsOnly`) can only match a COMPLETE secret, so an incomplete one already released
// never gets caught, and the whole secret leaks in full once the rest streams in. A fixed
// window can never be large enough in general: any secret longer than the window defeats it.
//
// Fix: track whether the tail of the buffer looks like the START of an in-progress secret
// (an open PEM block, a partial JWT/Bearer/api-key/connection-string prefix). If so, hold back
// the WHOLE pending fragment — however long — until the secret completes (then
// `redactSecretsOnly` replaces it with the placeholder) or a hard cap is hit. Normal text still
// streams incrementally, holding back only a small tail to catch a short secret straddling a
// chunk boundary.

/** Hard cap on the pending (held-back) fragment. If a "secret" never completes (e.g. a
 * pathological/never-closing PEM block), the fragment is force-flushed (best-effort
 * redacted — any complete sub-secrets inside it are already masked) once it reaches this many
 * characters, and the redactor resets. Guarantees `StreamingSecretRedactor` can never hold
 * forever or grow its buffer unbounded. */
export const STREAM_HOLD_CAP = 8192;

// Held back when NO secret-start signal is present — just enough to catch a short secret
// (e.g. a bare `sk-...` key) split across a chunk boundary, without meaningfully delaying
// normal incremental rendering.
const STREAM_NORMAL_TAIL_HOLD = 32;

// IMPORTANT: these run against the RAW (not-yet-redacted) buffer — see the class doc comment
// below for why (running them AFTER redaction would let an open-ended pattern like `Bearer
// <token>`/`sk-...`/a JWT's final segment match PREMATURELY: those patterns have no upper
// bound, only a minimum length, so a partial token that merely reaches the minimum — with more
// characters still to come in a later chunk — would already satisfy the "complete" regex purely
// because JS's `\b` treats "end of the string given to it so far" as a valid boundary. Checking
// the pending-start marker FIRST, on the raw buffer, keeps such a fragment in `HOLD` for as
// long as its tail keeps extending, and only allows `redactSecretsOnly` to run once a genuine
// terminating character (or true end of stream, in `flush()`) proves nothing more is coming).
// Each pattern is anchored with `$` (fires only while the suspicious prefix sits at the very
// TAIL of the CURRENT buffer — once a real non-matching character arrives after it, the pattern
// can no longer reach the true end and naturally stops matching, at which point
// `redactSecretsOnly` runs and correctly redacts the now-complete secret) EXCEPT the
// "PEM marker already complete, block still open" pattern below, which uses a negative
// lookahead instead of `$` (a closed PEM block is followed by ordinary trailing text, not
// necessarily the end of the buffer) — it stops matching once its own `-----END...-----` has
// actually appeared, not merely once *something* follows it.
//
// doc69 review fix (all-header-variant leak): the PEM *growing-marker* pattern below is what
// makes this safe for the FULL family of header lines, not just the one variant a shallower
// review might spot-check. `-----BEGIN[ A-Z]*PRIVATE KEY-----` allows an UNBOUNDED-length type
// word between "BEGIN" and "PRIVATE KEY" (`RSA`/`OPENSSH`/`ENCRYPTED`/`EC`/`DSA`/none for
// PKCS8) — real headers like `-----BEGIN OPENSSH PRIVATE KEY-----` (35 chars) and
// `-----BEGIN ENCRYPTED PRIVATE KEY-----` (37 chars) are LONGER than `STREAM_NORMAL_TAIL_HOLD`
// (32). Without a pattern that can match a growing PARTIAL prefix, `findPendingSecretStart`
// would report "no pending secret" for every intermediate state while the marker is still being
// typed token-by-token, so the "no marker" branch below evicts the leading chars of the marker
// (anything past the last 32) before the negative-lookahead pattern ever gets a chance to
// engage — `-----BEGIN` scrolls out of the buffer, detection is permanently defeated, and the
// entire key streams to the client raw. `-----BEGIN RSA PRIVATE KEY-----` (31 chars) happened
// to survive by one character, which is why a narrow test suite could miss this. The fix holds
// from the very FIRST dash of `-----BEGIN`, growing the hold through the (unboundedly long) type
// word and the closing dashes, so no amount of streaming granularity can ever let any prefix of
// the marker escape.
const PENDING_SECRET_START_PATTERNS: RegExp[] = [
  // PEM private-key block opened, not yet followed anywhere later by its closing
  // `-----END...-----` — hold everything from the opening marker onward, however long it
  // takes, until the block actually closes. Only matches once the FULL `-----BEGIN...KEY-----`
  // literal is present; the pattern below covers every state before that.
  /-----BEGIN[ A-Z]*PRIVATE KEY-----(?![\s\S]*-----END[ A-Z]*PRIVATE KEY-----)/,
  // PEM marker STILL BEING TYPED — a growing prefix of `-----BEGIN[ A-Z]*PRIVATE KEY-----`,
  // anchored at the tail of the buffer: `-`, `--`, …, `-----`, `-----B`, …, `-----BEGIN`,
  // `-----BEGIN `, `-----BEGIN OPENSSH PRI`, …, `-----BEGIN OPENSSH PRIVATE KEY----` (one dash
  // short of complete). The nested optional groups enforce that each letter can only match
  // immediately after its predecessor (so e.g. a bare "-E" in ordinary text — dash then some
  // unrelated capital E — can NOT falsely match; "E" only counts once "B" was consumed right
  // before it). Once the marker's 5 trailing dashes are fully typed, this pattern stops matching
  // (`-{0,4}` can hold at most 4 trailing dashes) and the pattern above takes over seamlessly.
  //
  // The leading `(?<![A-Za-z0-9-])` is NOT optional decoration — without it this pattern also
  // matches the CLOSING `-----` of an already-complete `-----END...KEY-----` delimiter (found
  // by empirical streaming test: OPENSSH variant), because a bare dash run has no way to tell
  // "these dashes open a NEW marker" from "these dashes close the one that just finished". At
  // the instant `-----END...KEY-----` completes, the pattern above (index 0) correctly stops
  // matching — the secret is done and should be released via `redactSecretsOnly`, not held — but
  // this pattern would otherwise re-engage on those same closing dashes and slice the block at
  // exactly the point where the two-delimiter secret regex can no longer see BOTH delimiters,
  // permanently defeating redaction on that piece. Excluding "preceded by a letter/digit/dash"
  // blocks a match from starting anywhere inside such a run (every position after the true start
  // is itself preceded by another dash, so it can't be used as a restart point either) while
  // still allowing every genuine new-marker case: a real PEM block always begins at the start of
  // a line (RFC 7468) — preceded by whitespace/newline/start-of-buffer, never by an
  // alphanumeric character or a fused dash run.
  /(?<![A-Za-z0-9-])-{1,5}(?:B(?:E(?:G(?:I(?:N(?:[ A-Z]*-{0,4})?)?)?)?)?)?$/,
  // JWT header/payload/signature in progress — fewer than the 3 complete dot-separated
  // segments the full `jwt` pattern requires, still growing at the tail of the buffer.
  /\beyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2}$/,
  // "Bearer <token>" — the token run is still growing at the tail of the buffer (not yet
  // confirmed complete by a terminating character).
  /\bBearer\s+[A-Za-z0-9\-_.]*$/i,
  // Recognizable API-key prefix (`sk-`, `ghp_`, `AKIA`) started, still growing at the tail.
  /\b(?:sk-|ghp_|AKIA)[A-Za-z0-9]*$/,
  // Labeled `api_key=`/`access_token:`/`client_secret=`… form started, still growing.
  /\b(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9\-_.]*$/i,
  // `password=`/`pwd:`/`passwd=` form started, still growing.
  /\b(?:password|pwd|passwd)\s*[:=]\s*["']?[^\s"']*$/i,
  // `scheme://user:pass@...` connection string — scheme+`://` seen, still growing.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s@]*$/i,
];

// doc69 review fix — audit of the OTHER 6 patterns above for this same "required literal
// longer than STREAM_NORMAL_TAIL_HOLD (32 chars)" defect class: every one of them requires a
// SHORT fixed literal before its growing `*$` suffix engages — `eyJ` (3), `Bearer ` (7),
// `sk-`/`ghp_`/`AKIA` (3-4), the longest labeled-form alternative `access_token`/`client_secret`
// (12-13) + a `[:=]` char, `password`/`passwd` (6-8) + `[:=]`. All comfortably under 32, so the
// normal-text tail-hold can never evict any of their leading chars before the pattern engages —
// unlike the PEM type word (`[ A-Z]*`), none of these required-literal lengths are unbounded.
// The connection-string pattern's scheme portion (`[a-z][a-z0-9+.-]*` before `://`) is,
// strictly, also unbounded in the regex — but deliberately NOT made growing the same way PEM
// was: real URI schemes (postgres, mysql, mongodb+srv, redis, amqp, mqtt, https, …) are all
// well under 32 chars, so this is not a *practically* exploitable instance of the defect, and
// the fix would cost more than it buys — a scheme is not a distinctive marker the way `-----` +
// `BEGIN` is, so holding on the shape "some lowercase word sits at the tail of the buffer"
// would make ordinary lowercase words throughout normal streamed prose enter HOLD on every
// chunk boundary, defeating incremental streaming far more broadly than the narrow, highly
// distinctive PEM dash-prefix does.

/** Index of the earliest pending-secret-start marker in `text`, or -1 if none present. */
function findPendingSecretStart(text: string): number {
  let holdFrom = -1;
  for (const re of PENDING_SECRET_START_PATTERNS) {
    const idx = text.search(re);
    if (idx >= 0 && (holdFrom === -1 || idx < holdFrom)) holdFrom = idx;
  }
  return holdFrom;
}

/**
 * Stateful per-stream secret redactor for token-by-token streaming output. One instance per
 * stream (NOT shared across concurrent streams — state is per-conversation by design).
 *
 * `push(chunk)` returns the text now safe to emit; `flush()` returns whatever remains held once
 * the underlying stream ends. Both are fail-safe: any internal error falls back to emitting the
 * raw buffered text unredacted rather than breaking the stream (never throws), matching this
 * module's fail-safe posture. Cheap by design — patterns re-scan only the small pending buffer
 * during normal text, growing only while an actual secret-start marker is open.
 *
 * Deliberately checks `findPendingSecretStart` on the RAW buffer BEFORE calling
 * `redactSecretsOnly` (rather than after, which was this fix's first draft) — see the
 * `PENDING_SECRET_START_PATTERNS` comment above for why that ordering matters: it prevents an
 * open-ended pattern (Bearer/api-key/JWT-final-segment) from being finalized the instant it
 * merely reaches its minimum length, while more of the same token is still about to arrive in a
 * later chunk.
 */
export class StreamingSecretRedactor {
  private buffer = "";

  push(chunk: string): string {
    try {
      this.buffer += chunk ?? "";
      const pendingIdx = findPendingSecretStart(this.buffer);

      if (pendingIdx >= 0) {
        const pendingRaw = this.buffer.slice(pendingIdx);
        if (pendingRaw.length >= STREAM_HOLD_CAP) {
          // Hard cap — never hold forever / never grow unbounded. Force-emit everything
          // accumulated so far (best-effort redacted) and reset.
          const forced = redactSecretsOnly(this.buffer).text;
          this.buffer = "";
          return forced;
        }
        const settled = this.buffer.slice(0, pendingIdx);
        this.buffer = pendingRaw; // kept RAW — re-evaluated fresh against the next chunk
        return redactSecretsOnly(settled).text;
      }

      // No secret-in-progress signal — safe to redact the whole buffer (any complete secret
      // gets replaced) and release everything except a small trailing tail, so a short secret
      // straddling a chunk boundary is still caught once its start marker becomes visible.
      const redacted = redactSecretsOnly(this.buffer).text;
      const releaseUpTo = Math.max(0, redacted.length - STREAM_NORMAL_TAIL_HOLD);
      this.buffer = redacted.slice(releaseUpTo);
      return redacted.slice(0, releaseUpTo);
    } catch {
      const raw = this.buffer;
      this.buffer = "";
      return raw;
    }
  }

  flush(): string {
    try {
      const redacted = redactSecretsOnly(this.buffer).text;
      this.buffer = "";
      return redacted;
    } catch {
      const raw = this.buffer;
      this.buffer = "";
      return raw;
    }
  }
}

// ─── Output leak check ──────────────────────────────────────────

const OUTPUT_LEAK_PATTERNS: LabeledPattern[] = [
  { label: "system_prompt_echo", re: /\b(my|the)\s+system\s+prompt\s+(is|:)/i },
  { label: "instructions_echo", re: /\bmy\s+(instructions|rules)\s+(are|is)\s*:/i },
  { label: "told_to_echo", re: /\bi\s+(was|am)\s+(told|instructed)\s+to\b/i },
  { label: "internal_marker", re: /<\|(system|im_start|im_end)\|>/i },
];

/**
 * Light disallowed-content / leaked-secret check on model OUTPUT: did the model echo a
 * secret it saw in context, or leak its own system prompt/instructions? Redacts any leaked
 * secret using the same patterns as `redactSecretsAndPII` and flags leak signals. PURE,
 * never throws.
 */
export function checkOutput(text: string): OutputCheckResult {
  if (!text || typeof text !== "string") return { text: text ?? "", redactions: [], leakFlags: [] };

  const leakFlags = OUTPUT_LEAK_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  const redacted = redactSecretsAndPII(text);
  return { text: redacted.text, redactions: redacted.redactions, leakFlags };
}

// ─── Orchestrators ──────────────────────────────────────────────

function summarize(scope: "input" | "output", risk: InjectionRisk, matched: string[], redactions: RedactionCount[]): SafetyFlagsSummary {
  return {
    scope,
    risk,
    matched,
    redactedCount: redactions.reduce((sum, r) => sum + r.count, 0),
    redactionTypes: redactions.map((r) => r.type),
  };
}

/**
 * INPUT orchestrator: scan for injection (on the ORIGINAL text, before redaction — a
 * redacted placeholder must never mask an injection attempt from the scanner), then redact
 * secrets/PII. Returns the sanitized text + a compact flags summary. PURE, never throws.
 */
export function applySafety(input: string): SafetyResult {
  const text = typeof input === "string" ? input : "";
  const scan = scanForInjection(text);
  const redacted = redactSecretsAndPII(text);
  return { text: redacted.text, flags: summarize("input", scan.risk, scan.matched, redacted.redactions) };
}

/**
 * OUTPUT orchestrator: leak-check + redact the model's OUTPUT before it reaches the caller.
 * Reuses the same 'risk' scale for leak severity (any leak signal → 'low'; a leak signal
 * THAT ALSO redacted a secret → 'high', since an echoed live secret is the worst case).
 * PURE, never throws.
 */
export function applyOutputSafety(output: string): SafetyResult {
  const text = typeof output === "string" ? output : "";
  const checked = checkOutput(text);
  const redactedCount = checked.redactions.reduce((sum, r) => sum + r.count, 0);
  const risk: InjectionRisk = redactedCount > 0 ? "high" : checked.leakFlags.length > 0 ? "low" : "none";
  return { text: checked.text, flags: summarize("output", risk, checked.leakFlags, checked.redactions) };
}
