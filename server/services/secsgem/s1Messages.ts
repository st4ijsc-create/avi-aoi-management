/**
 * Standard SECS-II Stream-1 messages, built on the SECS-II item codec (secs2Codec).
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * A SMALL, connectivity-oriented subset of Stream 1 (SEMI E5 §S1) — enough to
 * open a session and confirm the peer is a SECS-II speaker:
 *   - S1F1 / S1F2  — Are You There Request / On Line Data
 *   - S1F13 / S1F14 — Establish Communications Request / Acknowledge (COMMACK)
 *   - S1F17 / S1F18 — Request ON-LINE / ON-LINE Acknowledge (ONLACK)
 * This is NOT a GEM (E30) implementation: there is no control-state model, no
 * dynamic event/report linking, no spooling. These builders/parsers exist so
 * hsmsClient can send a real S1F1 and interpret a real S1F2 for a liveness/model
 * probe — a strictly READ/MONITOR interaction (no equipment-control path).
 *
 * A SECS-II *message* is Stream + Function + W-bit (reply expected) + a root item
 * body. Stream/Function identify the message (e.g. S1F13). W-bit = "a reply
 * (SxF(y+1)) is expected". Encoding/decoding of the body delegates to secs2Codec.
 */
import { I, encodeItem, decodeItem, type Secs2Item } from "./secs2Codec";

/** A full SECS-II message: Stream + Function + W-bit + root body item. */
export interface Secs2Message {
  /** Stream number (the "S" in SxFy). */
  stream: number;
  /** Function number (the "F" in SxFy). */
  streamFunction: number;
  /** W-bit: true → a reply (SxF(y+1)) is expected. */
  wbit: boolean;
  /** Root SECS-II item (the message body). */
  body: Secs2Item;
  /** Human label for logs/tests (e.g. "S1F13 Establish Communications Request"). */
  name?: string;
}

/** Encode a message body to its SECS-II wire bytes (delegates to secs2Codec). */
export function encodeBody(msg: Secs2Message): Buffer {
  return encodeItem(msg.body);
}

/** Decode a SECS-II body buffer into an item tree (delegates to secs2Codec). */
export function decodeBody(buf: Buffer): Secs2Item {
  return decodeItem(buf);
}

// ─── S1F1 / S1F2 — Are You There / On Line Data ──────────────────────────────

/** S1F1 — Are You There Request (W). Empty body. Liveness probe. */
export function s1f1(): Secs2Message {
  return { stream: 1, streamFunction: 1, wbit: true, body: I.L(), name: "S1F1 Are You There Request" };
}

/** On-line data returned by S1F2. */
export interface OnlineData {
  /** MDLN — equipment model name. */
  modelName: string;
  /** SOFTREV — software revision. */
  softRev: string;
}

/** S1F2 — On Line Data. Reply to S1F1: L[ MDLN(A), SOFTREV(A) ]. */
export function s1f2(data: OnlineData): Secs2Message {
  return {
    stream: 1,
    streamFunction: 2,
    wbit: false,
    body: I.L(I.A(data.modelName), I.A(data.softRev)),
    name: "S1F2 On Line Data",
  };
}

/**
 * Parse an S1F2 body — L[ MDLN(A), SOFTREV(A) ].
 * NOTE: some equipment reply to S1F1 with an EMPTY list (host-role probe). We
 * return empty strings in that case rather than throwing, so a liveness probe
 * still succeeds. Returns null only when the body is not a list at all.
 */
export function parseS1F2(body: Secs2Item): OnlineData | null {
  if (body.format !== "L") return null;
  const [mdln, softrev] = body.value;
  return {
    modelName: mdln && mdln.format === "A" ? mdln.value : "",
    softRev: softrev && softrev.format === "A" ? softrev.value : "",
  };
}

// ─── S1F13 / S1F14 — Establish Communications ────────────────────────────────

/** S1F13 — Establish Communications Request (W): L[ MDLN(A), SOFTREV(A) ]. */
export function s1f13(data: OnlineData): Secs2Message {
  return {
    stream: 1,
    streamFunction: 13,
    wbit: true,
    body: I.L(I.A(data.modelName), I.A(data.softRev)),
    name: "S1F13 Establish Communications Request",
  };
}

/** Parse an S1F13 body — L[ MDLN(A), SOFTREV(A) ]. Empty list → empty strings. */
export function parseS1F13(body: Secs2Item): OnlineData | null {
  return parseS1F2(body); // identical body shape
}

/** COMMACK — Establish Communications acknowledge code (SEMI E5). */
export const COMMACK = {
  ACCEPTED: 0x00,
  DENIED_TRY_AGAIN: 0x01,
} as const;

/**
 * S1F14 — Establish Communications Request Acknowledge:
 * L[ COMMACK(B: 0=accepted/1=denied), L[ MDLN(A), SOFTREV(A) ] ].
 */
export function s1f14(commack: number, data: OnlineData): Secs2Message {
  return {
    stream: 1,
    streamFunction: 14,
    wbit: false,
    body: I.L(I.B(commack & 0xff), I.L(I.A(data.modelName), I.A(data.softRev))),
    name: "S1F14 Establish Communications Request Acknowledge",
  };
}

/** Parsed S1F14. `accepted` is COMMACK === 0. */
export interface EstablishCommsAck {
  commack: number;
  accepted: boolean;
  data: OnlineData;
}

/** Parse an S1F14 body — L[ COMMACK(B), L[ MDLN(A), SOFTREV(A) ] ]. */
export function parseS1F14(body: Secs2Item): EstablishCommsAck | null {
  if (body.format !== "L") return null;
  const [commackItem, inner] = body.value;
  const commack = commackItem && commackItem.format === "B" ? (commackItem.value[0] ?? 0xff) : 0xff;
  const data = inner ? parseS1F2(inner) : null;
  return {
    commack,
    accepted: commack === COMMACK.ACCEPTED,
    data: data ?? { modelName: "", softRev: "" },
  };
}

// ─── S1F17 / S1F18 — Request ON-LINE / ON-LINE Acknowledge ────────────────────
//
// The standard GEM online-request handshake (SEMI E5 §S1). The HOST sends S1F17
// (empty body) to request the equipment go ONLINE; the equipment replies with
// S1F18 carrying ONLACK. This is the ONLY "write" the connectivity layer makes:
// it asks the equipment to accept remote/online control — it does NOT push any
// recipe, parameter, or host-command (S2Fxx). READ/MONITOR scope is preserved.

/** S1F17 — Request ON-LINE (W). Empty body (`L[]`). Host → Equipment. */
export function s1f17(): Secs2Message {
  return { stream: 1, streamFunction: 17, wbit: true, body: I.L(), name: "S1F17 Request ON-LINE" };
}

/**
 * ONLACK — ON-LINE Acknowledge code (SEMI E5 S1F18).
 *   ACCEPTED           (0) — request accepted; equipment is/goes ON-LINE.
 *   NOT_ALLOWED        (1) — request refused (e.g. equipment will not go online).
 *   ALREADY_ONLINE     (2) — equipment was already ON-LINE.
 * ACCEPTED and ALREADY_ONLINE both mean the equipment IS online; only
 * NOT_ALLOWED (or any non-standard code) counts as a denial.
 */
export const ONLACK = {
  ACCEPTED: 0x00,
  NOT_ALLOWED: 0x01,
  ALREADY_ONLINE: 0x02,
} as const;

/**
 * S1F18 — ON-LINE Acknowledge. Reply to S1F17. Body is a single ONLACK binary
 * item: `B[ONLACK]`. Equipment → Host.
 */
export function s1f18(onlack: number): Secs2Message {
  return {
    stream: 1,
    streamFunction: 18,
    wbit: false,
    body: I.B(onlack & 0xff),
    name: "S1F18 ON-LINE Acknowledge",
  };
}

/** Parsed S1F18. `online` is true for ACCEPTED or ALREADY_ONLINE. */
export interface OnlineAck {
  onlack: number;
  /** true → the equipment is ON-LINE (ONLACK ACCEPTED or ALREADY_ONLINE). */
  online: boolean;
}

/**
 * Parse an S1F18 body — `B[ONLACK]`. Fail-safe: a missing/wrong-format body
 * yields onlack=0xff (treated as NOT online). Some equipment wrap the ONLACK in
 * a 1-element list; that shape is also accepted.
 */
export function parseS1F18(body: Secs2Item): OnlineAck {
  let onlack = 0xff;
  if (body.format === "B") {
    onlack = body.value[0] ?? 0xff;
  } else if (body.format === "L") {
    const inner = body.value[0];
    if (inner && inner.format === "B") onlack = inner.value[0] ?? 0xff;
  }
  return {
    onlack,
    online: onlack === ONLACK.ACCEPTED || onlack === ONLACK.ALREADY_ONLINE,
  };
}
