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
