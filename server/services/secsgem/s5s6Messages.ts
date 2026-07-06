/**
 * SECS-II Stream-5 (Alarm) + Stream-6 (Data Collection) messages — built on the
 * full SECS-II item codec (secs2Codec) and the `Secs2Message` shape.
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * A SMALL, ingestion-oriented subset of S5/S6 — exactly the two UNSOLICITED
 * primaries a passive host must handle to notice a GEM equipment's alarms and
 * collection events, plus their acknowledges:
 *   - S5F1 / S5F2  — Alarm Report Send / Ack  (equipment → host, ACKC5)
 *   - S6F11 / S6F12 — Event Report Send / Ack (equipment → host, ACKC6)
 * This is NOT a full E30 data-collection implementation: no report-linking-aware
 * decode (S2F33/F35/F37 report format is not consulted — S6F11 is decoded
 * BEST-EFFORT into flat leaf values), no S6F1/F3 trace, no spooling, no S6F13/F15
 * annotated-event variants. The parsers are PURE (no I/O), so they are unit
 * testable; the live-dispatch loop (hsmsClient.enableLiveDispatch) drives them.
 *
 * ── ALCD (Alarm Code byte, SEMI E5) ──────────────────────────────────────────
 * ALCD is a single byte: BIT 8 (0x80) = alarm STATE (1 = set, 0 = cleared); the
 * low 7 bits are the alarm CATEGORY code (1 Personal Safety, 2 Equipment Safety,
 * 3 Parameter Control Warning, 4 Parameter Control Error, 5 Irrecoverable Error,
 * 6 Equipment Status Warning, 7 Attention Flags, 8 Data Integrity, …). We surface
 * `set` (bit 8) and `category` (low 7 bits) separately; downstream severity is
 * resolved by the E1 alarm taxonomy (adapterAlarmBridge), NOT from ALCD directly.
 */
import { I, type Secs2Item } from "./secs2Codec";
import type { Secs2Message } from "./s1Messages";

// ─── scalar / leaf helpers (fail-safe) ────────────────────────────────────────

/** First integer scalar out of a numeric/binary item (fail-safe → undefined). */
function scalarInt(item: Secs2Item | undefined): number | undefined {
  if (!item) return undefined;
  switch (item.format) {
    case "B":
    case "U1":
    case "U2":
    case "U4":
    case "I1":
    case "I2":
    case "I4":
      return item.value[0];
    case "U8":
    case "I8":
      return item.value[0] != null ? Number(item.value[0]) : undefined;
    default:
      return undefined;
  }
}

/** Flatten a SECS-II leaf item to a JS primitive (lists → null). */
function leafValue(item: Secs2Item): string | number | boolean | null {
  switch (item.format) {
    case "A":
      return item.value;
    case "BOOLEAN":
      return item.value[0] ?? false;
    case "B":
    case "U1":
    case "U2":
    case "U4":
    case "I1":
    case "I2":
    case "I4":
    case "F4":
    case "F8":
      return item.value[0] ?? null;
    case "U8":
    case "I8":
      return item.value[0] != null ? String(item.value[0]) : null;
    case "L":
      return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// S5 — Alarm
// ═════════════════════════════════════════════════════════════════════════════

/** ACKC5 — Alarm-report acknowledge code (S5F2). 0 = accepted. */
export const ACKC5 = { ACCEPTED: 0x00 } as const;

/**
 * S5F1 — Alarm Report Send (W). Equipment → Host.
 * Body: L[ ALCD(B), ALID(U4), ALTX(A) ].
 */
export function s5f1(alcd: number, alid: number, altx: string): Secs2Message {
  return {
    stream: 5,
    streamFunction: 1,
    wbit: true,
    body: I.L(I.B(alcd & 0xff), I.U4(alid >>> 0), I.A(altx)),
    name: "S5F1 Alarm Report Send",
  };
}

/** Decoded S5F1 alarm report. */
export interface ParsedS5F1 {
  /** Raw ALCD byte. */
  alcd: number;
  /** ALCD bit 8 — true = alarm SET, false = alarm CLEARED. */
  set: boolean;
  /** ALCD low 7 bits — alarm category code (SEMI E5). */
  category: number;
  /** ALID — the equipment alarm id. */
  alid: number;
  /** ALTX — alarm text (may be empty if the equipment omitted it). */
  altx: string;
}

/** Parse an S5F1 body — L[ ALCD(B), ALID(U*), ALTX(A) ]. Fail-safe (null if not a list). */
export function parseS5F1(body: Secs2Item): ParsedS5F1 | null {
  if (body.format !== "L") return null;
  const [alcdItem, alidItem, altxItem] = body.value;
  const alcd = scalarInt(alcdItem) ?? 0;
  const alid = scalarInt(alidItem) ?? 0;
  const altx = altxItem && altxItem.format === "A" ? altxItem.value : "";
  return { alcd, set: (alcd & 0x80) !== 0, category: alcd & 0x7f, alid, altx };
}

/** S5F2 — Alarm Report Acknowledge. Body: ACKC5(B). Host → Equipment. */
export function s5f2(ackc5: number): Secs2Message {
  return { stream: 5, streamFunction: 2, wbit: false, body: I.B(ackc5 & 0xff), name: "S5F2 Alarm Report Acknowledge" };
}

/** Parse an S5F2 body → ACKC5. */
export function parseS5F2(body: Secs2Item): number {
  return scalarInt(body) ?? 0xff;
}

// ═════════════════════════════════════════════════════════════════════════════
// S6 — Data Collection (Event Reports)
// ═════════════════════════════════════════════════════════════════════════════

/** ACKC6 — Event-report acknowledge code (S6F12). 0 = accepted. */
export const ACKC6 = { ACCEPTED: 0x00 } as const;

/** One decoded report inside an S6F11 (RPTID + its flattened leaf values). */
export interface ParsedReport {
  rptId: number;
  values: Array<string | number | boolean | null>;
}

/** Decoded S6F11 event report. */
export interface ParsedS6F11 {
  dataId: number;
  /** CEID — the collection-event id that fired. */
  ceid: number;
  /** The linked reports (best-effort: report format is not resolved from S2F33). */
  reports: ParsedReport[];
}

/**
 * S6F11 — Event Report Send (W). Equipment → Host.
 * Body: L[ DATAID(U4), CEID(U4), L[ L[ RPTID(U4), L[ V … ] ] … ] ].
 */
export function s6f11(dataId: number, ceid: number, reports: ParsedReport[] = []): Secs2Message {
  return {
    stream: 6,
    streamFunction: 11,
    wbit: true,
    body: I.L(
      I.U4(dataId >>> 0),
      I.U4(ceid >>> 0),
      I.L(
        ...reports.map((r) =>
          I.L(
            I.U4(r.rptId >>> 0),
            I.L(...r.values.map((v) => (typeof v === "string" ? I.A(v) : typeof v === "boolean" ? I.BOOLEAN(v) : I.F8(Number(v ?? 0))))),
          ),
        ),
      ),
    ),
    name: "S6F11 Event Report Send",
  };
}

/**
 * Parse an S6F11 body — L[ DATAID(U*), CEID(U*), L[ L[ RPTID(U*), L[ V … ] ] … ] ].
 * BEST-EFFORT: the report VID→value binding depends on the report format defined
 * via S2F33/F35 (report-linking); without that context we flatten each report's
 * value list positionally. Fail-safe (null if the top item is not a list).
 */
export function parseS6F11(body: Secs2Item): ParsedS6F11 | null {
  if (body.format !== "L") return null;
  const [dataIdItem, ceidItem, reportsList] = body.value;
  const dataId = scalarInt(dataIdItem) ?? 0;
  const ceid = scalarInt(ceidItem) ?? 0;
  const reports: ParsedReport[] = [];
  if (reportsList && reportsList.format === "L") {
    reportsList.value.forEach((rep, ri) => {
      if (rep.format !== "L") return;
      const rptId = scalarInt(rep.value[0]) ?? ri;
      const values: Array<string | number | boolean | null> = [];
      const valueList = rep.value[1];
      if (valueList && valueList.format === "L") {
        for (const v of valueList.value) values.push(leafValue(v));
      }
      reports.push({ rptId, values });
    });
  }
  return { dataId, ceid, reports };
}

/** S6F12 — Event Report Acknowledge. Body: ACKC6(B). Host → Equipment. */
export function s6f12(ackc6: number): Secs2Message {
  return { stream: 6, streamFunction: 12, wbit: false, body: I.B(ackc6 & 0xff), name: "S6F12 Event Report Acknowledge" };
}

/** Parse an S6F12 body → ACKC6. */
export function parseS6F12(body: Secs2Item): number {
  return scalarInt(body) ?? 0xff;
}

// ═════════════════════════════════════════════════════════════════════════════
// Live-dispatch handler contract (consumed by hsmsClient.enableLiveDispatch)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Callbacks the HSMS live-dispatch loop invokes for each decoded UNSOLICITED
 * primary. Both are optional and may be async; the loop sends the protocol
 * acknowledge (S5F2 / S6F12) regardless of whether a handler is provided or
 * whether it throws (fail-safe — a handler error is swallowed, never propagated
 * into the socket 'data' path). Defined here (not in hsmsClient) so the client
 * has no dependency on the alarm-bridge wiring.
 */
export interface LiveDispatchHandlers {
  /** Fired for an inbound S5F1 alarm report (before the S5F2 ack is sent). */
  onAlarm?: (alarm: ParsedS5F1) => void | Promise<void>;
  /** Fired for an inbound S6F11 event report (before the S6F12 ack is sent). */
  onEvent?: (event: ParsedS6F11) => void | Promise<void>;
}
