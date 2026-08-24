/**
 * GEM300 message-stream layer — S2 (Equipment Control) + S7 (Process Program /
 * Recipe), built on the SECS-II item codec (secs2Codec) and the Secs2Message shape.
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * This is the **SECS-II MESSAGE-STREAM layer** for Streams 2 and 7 — the
 * encode/decode + a small equipment-side simulation handler. It is DELIBERATELY
 * BOUNDED and it is NOT a certified SEMI E30/E30.1 (GEM/GEM300) host-comms stack:
 *   - A real GEM300 stack requires certification against real equipment (or a
 *     vetted SECS library), the full T1–T8 timer set, spooling (S2F43/F45), data
 *     correlation by System Bytes, multi-block transfers, and an E39/E40/E90/E94/
 *     E116/E157 object-services layer. NONE of that is claimed here.
 *   - What IS here: round-trippable builders/parsers for the key S2 control
 *     messages (S2F41/F42 Host Command, S2F33/F34 Define Report, S2F35/F36 Link
 *     Event Report, S2F37/F38 Enable/Disable Event Report, S2F13/F14 Equipment
 *     Constant Request) and the S7 recipe messages (S7F1/F2 PP-Load Inquire/Grant,
 *     S7F3/F4 PP-Send/Ack, S7F5/F6 PP-Request/Data, S7F17/F18 Delete PP, S7F19/F20
 *     PP Directory), plus a pure equipment-side handler (`Gem300Equipment`) that
 *     maintains the dynamic report/event/EC registries and a pluggable PP store.
 *
 * ── SAFETY — a host command is NEVER an ungated actuation ─────────────────────
 * An inbound S2F41 host command (START/STOP/PP-SELECT/…) is mapped to a canonical
 * platform command and returned as a **gated PROPOSAL** (`gated: true,
 * requiresApproval: true`). The protocol layer NEVER calls the OT command
 * dispatcher or a driver; it does not import commandDispatcher as a value. To
 * actually reach a device the caller must build a HITL `DispatchInput` via
 * `buildHitlDispatchInput()` — which is FLAG-GATED (throws when GEM300 is
 * disabled) and produces a `triggeredBy.kind: "hitl"` input, i.e. the SAME
 * human-confirmed path every AI/host trigger takes (commandDispatcher then still
 * enforces confirm-owner + OT_CONTROL_ENABLED + commissioning). The equipment side
 * therefore acknowledges a host command with HCACK=4 ("will be performed with a
 * completion signal later") — deferred to HITL — never HCACK=0 ("already done").
 *
 * ── PP ↔ recipe binding ──────────────────────────────────────────────────────
 * A Process Program (PP) IS a versioned recipe: PPID encodes the recipe `code`
 * (optionally `code@v<version>`) and the PP body is a JSON envelope of the recipe
 * ({ code, name, version, payload, checksum }). PP storage REUSES the existing
 * recipe storage (machine_recipes / recipeVersioningService) — **NO new migration
 * (0162 not needed)**. The default `PpStore` here is in-memory (for the
 * message-layer simulation + tests and for flag-OFF safety); a recipe-backed store
 * can wrap recipeVersioningService (itself EQ_INTEG_ENABLED-gated) at the seam.
 *
 * Flag: GEM300_ENABLED (default OFF). Pure codec builders/parsers are always safe
 * (they emit nothing on a wire, like secs2Codec); the flag gates the one boundary
 * that constructs an actuation-intent dispatch input.
 */
import { I, encodeItem, decodeItem, type Secs2Item } from "./secs2Codec";
import { type Secs2Message, encodeBody, decodeBody } from "./s1Messages";
import type { MachineRecipe } from "../../../drizzle/schema";
import { FeatureDisabledError } from "../../_core/deviceErrors";
// Type-only imports: erased at runtime, so this module pulls in NO DB / dispatcher
// value code. `DispatchInput` is the exact shape the gated OT dispatcher consumes.
import type { DispatchInput } from "../ot/commandDispatcher";
import type { RiskLevel } from "../equipment/capabilityModel";

/**
 * Master flag — default OFF. Read inline (not imported) to mirror the SECS/GEM
 * flag helpers and avoid an import cycle. GEM300 is a superset of the SECS/GEM
 * connectivity framework; this flag gates the actuation-intent boundary only.
 */
export function isGem300Enabled(): boolean {
  return process.env.GEM300_ENABLED === "true";
}

/** Honest scope caveat surfaced by callers/tests. */
export const GEM300_CAVEAT =
  "GEM300 message-stream layer (S2/S7) over the SECS-II codec — NOT a certified " +
  "SEMI E30/E30.1 host-comms stack. Host commands are gated HITL proposals, never " +
  "ungated actuations. Going live requires validation against real equipment.";

// ─── re-exported codec helpers (so callers need one import) ───────────────────
export { encodeBody, decodeBody } from "./s1Messages";
export { encodeItem, decodeItem } from "./secs2Codec";

// ═════════════════════════════════════════════════════════════════════════════
// Standard acknowledge / grant codes (SEMI E5).
// ═════════════════════════════════════════════════════════════════════════════

/** HCACK — Host Command Acknowledge code (S2F42). */
export const HCACK = {
  /** Command has been performed. NOTE: this layer never uses 0 — commands are gated. */
  PERFORMED: 0x00,
  /** Command does not exist. */
  NO_SUCH_COMMAND: 0x01,
  /** Cannot perform now. */
  CANNOT_PERFORM_NOW: 0x02,
  /** At least one parameter is invalid. */
  PARAMETER_INVALID: 0x03,
  /** Acknowledge — command will be performed with a completion signal later. */
  ACK_FINISH_LATER: 0x04,
  /** Rejected — already in desired condition. */
  ALREADY_IN_CONDITION: 0x05,
  /** No such object exists. */
  NO_SUCH_OBJECT: 0x06,
} as const;

/** CPACK — Command Parameter acknowledge (per-parameter, in S2F42). */
export const CPACK = {
  OK: 0x00,
  PARAMETER_NAME_UNKNOWN: 0x01,
  PARAMETER_VALUE_ILLEGAL: 0x02,
  PARAMETER_VALUE_OUT_OF_RANGE: 0x03,
} as const;

/** DRACK — Define Report acknowledge (S2F34). */
export const DRACK = {
  OK: 0x00,
  DENIED_INSUFFICIENT_SPACE: 0x01,
  DENIED_INVALID_FORMAT: 0x02,
  DENIED_RPTID_ALREADY_DEFINED: 0x03,
  DENIED_VID_DOES_NOT_EXIST: 0x04,
} as const;

/** LRACK — Link Event Report acknowledge (S2F36). */
export const LRACK = {
  OK: 0x00,
  DENIED_INSUFFICIENT_SPACE: 0x01,
  DENIED_INVALID_FORMAT: 0x02,
  DENIED_CEID_LINKED: 0x03,
  DENIED_CEID_DOES_NOT_EXIST: 0x04,
  DENIED_RPTID_DOES_NOT_EXIST: 0x05,
} as const;

/** ERACK — Enable/Disable Event Report acknowledge (S2F38). */
export const ERACK = {
  OK: 0x00,
  DENIED_CEID_DOES_NOT_EXIST: 0x01,
} as const;

/** PPGNT — Process Program Load Grant (S7F2). */
export const PPGNT = {
  OK: 0x00,
  ALREADY_HAVE: 0x01,
  NO_SPACE: 0x02,
  INVALID_PPID: 0x03,
  BUSY: 0x04,
  WILL_NOT_ACCEPT: 0x05,
} as const;

/** ACKC7 — Process Program acknowledge (S7F4 / S7F18). */
export const ACKC7 = {
  ACCEPTED: 0x00,
  PERMISSION_NOT_GRANTED: 0x01,
  LENGTH_ERROR: 0x02,
  MATRIX_OVERFLOW: 0x03,
  PPID_NOT_FOUND: 0x04,
  MODE_UNSUPPORTED: 0x05,
} as const;

// ─── small item helpers ───────────────────────────────────────────────────────

/** First unsigned/binary scalar out of an item (fail-safe). */
function firstScalarInt(item: Secs2Item | undefined): number | undefined {
  if (!item) return undefined;
  switch (item.format) {
    case "U1":
    case "U2":
    case "U4":
    case "I1":
    case "I2":
    case "I4":
    case "B":
      return item.value[0];
    default:
      return undefined;
  }
}

/** Coerce an item's leading scalar to a JS primitive (for params / VID values). */
export function itemScalar(item: Secs2Item | undefined): string | number | boolean | null {
  if (!item) return null;
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

/** Encode a UTF-8 string as a SECS-II Binary (B) item (PP body carrier). */
export function binaryFromString(s: string): Secs2Item {
  return { format: "B", value: [...Buffer.from(s, "utf8")] };
}

/** Decode a Binary (B) — or ASCII (A) — item back to a UTF-8 string (fail-safe). */
export function stringFromBinary(item: Secs2Item | undefined): string {
  if (!item) return "";
  if (item.format === "A") return item.value;
  if (item.format === "B") return Buffer.from(item.value).toString("utf8");
  return "";
}

// ═════════════════════════════════════════════════════════════════════════════
// S2 — Equipment Control
// ═════════════════════════════════════════════════════════════════════════════

// ─── S2F41 / S2F42 — Host Command Send / Acknowledge ─────────────────────────

/** One host-command parameter (CPNAME + CPVAL). CPVAL is any SECS-II item. */
export interface HostCommandParam {
  name: string;
  value: Secs2Item;
}

/** Convenience: an ASCII-valued command parameter. */
export function cpText(name: string, value: string): HostCommandParam {
  return { name, value: I.A(value) };
}
/** Convenience: a U4-valued command parameter. */
export function cpU4(name: string, value: number): HostCommandParam {
  return { name, value: I.U4(value) };
}

/**
 * S2F41 — Host Command Send (W). Host → Equipment.
 * Body: L[ RCMD(A), L[ L[ CPNAME(A), CPVAL ] … ] ].
 */
export function s2f41(rcmd: string, params: HostCommandParam[] = []): Secs2Message {
  return {
    stream: 2,
    streamFunction: 41,
    wbit: true,
    body: I.L(I.A(rcmd), I.L(...params.map((p) => I.L(I.A(p.name), p.value)))),
    name: "S2F41 Host Command Send",
  };
}

/** Parse an S2F41 body. Fail-safe: non-list body → null. */
export function parseS2F41(body: Secs2Item): { rcmd: string; params: HostCommandParam[] } | null {
  if (body.format !== "L") return null;
  const [rcmdItem, paramsList] = body.value;
  const rcmd = rcmdItem && rcmdItem.format === "A" ? rcmdItem.value : "";
  const params: HostCommandParam[] = [];
  if (paramsList && paramsList.format === "L") {
    for (const p of paramsList.value) {
      if (p.format !== "L") continue;
      const [nameItem, valItem] = p.value;
      params.push({
        name: nameItem && nameItem.format === "A" ? nameItem.value : "",
        value: valItem ?? I.A(""),
      });
    }
  }
  return { rcmd, params };
}

/** One per-parameter acknowledge in S2F42 (CPNAME + CPACK). */
export interface CommandParamAck {
  name: string;
  cpack: number;
}

/**
 * S2F42 — Host Command Acknowledge. Equipment → Host.
 * Body: L[ HCACK(B), L[ L[ CPNAME(A), CPACK(B) ] … ] ].
 */
export function s2f42(hcack: number, params: CommandParamAck[] = []): Secs2Message {
  return {
    stream: 2,
    streamFunction: 42,
    wbit: false,
    body: I.L(I.B(hcack & 0xff), I.L(...params.map((p) => I.L(I.A(p.name), I.B(p.cpack & 0xff))))),
    name: "S2F42 Host Command Acknowledge",
  };
}

/** Parse an S2F42 body. */
export function parseS2F42(body: Secs2Item): { hcack: number; params: CommandParamAck[] } | null {
  if (body.format !== "L") return null;
  const [hcackItem, paramsList] = body.value;
  const hcack = firstScalarInt(hcackItem) ?? 0xff;
  const params: CommandParamAck[] = [];
  if (paramsList && paramsList.format === "L") {
    for (const p of paramsList.value) {
      if (p.format !== "L") continue;
      const [nameItem, ackItem] = p.value;
      params.push({
        name: nameItem && nameItem.format === "A" ? nameItem.value : "",
        cpack: firstScalarInt(ackItem) ?? 0xff,
      });
    }
  }
  return { hcack, params };
}

// ─── S2F33 / S2F34 — Define Report ───────────────────────────────────────────

/** A report definition: a report id + the VIDs it collects (empty VIDs = delete). */
export interface ReportDefinition {
  rptId: number;
  vids: number[];
}

/**
 * S2F33 — Define Report (W). Host → Equipment.
 * Body: L[ DATAID(U4), L[ L[ RPTID(U4), L[ VID(U4) … ] ] … ] ].
 * An empty report list deletes ALL reports; a report with an empty VID list
 * deletes that report.
 */
export function s2f33(dataId: number, reports: ReportDefinition[]): Secs2Message {
  return {
    stream: 2,
    streamFunction: 33,
    wbit: true,
    body: I.L(
      I.U4(dataId >>> 0),
      I.L(...reports.map((r) => I.L(I.U4(r.rptId >>> 0), I.L(...r.vids.map((v) => I.U4(v >>> 0)))))),
    ),
    name: "S2F33 Define Report",
  };
}

/** Parse an S2F33 body. */
export function parseS2F33(body: Secs2Item): { dataId: number; reports: ReportDefinition[] } | null {
  if (body.format !== "L") return null;
  const [dataIdItem, reportsList] = body.value;
  const dataId = firstScalarInt(dataIdItem) ?? 0;
  const reports: ReportDefinition[] = [];
  if (reportsList && reportsList.format === "L") {
    for (const r of reportsList.value) {
      if (r.format !== "L") continue;
      const [rptIdItem, vidList] = r.value;
      const rptId = firstScalarInt(rptIdItem) ?? 0;
      const vids: number[] = [];
      if (vidList && vidList.format === "L") {
        for (const v of vidList.value) {
          const n = firstScalarInt(v);
          if (n != null) vids.push(n);
        }
      }
      reports.push({ rptId, vids });
    }
  }
  return { dataId, reports };
}

/** S2F34 — Define Report Acknowledge. Body: DRACK(B). */
export function s2f34(drack: number): Secs2Message {
  return { stream: 2, streamFunction: 34, wbit: false, body: I.B(drack & 0xff), name: "S2F34 Define Report Acknowledge" };
}
/** Parse an S2F34 body → DRACK. */
export function parseS2F34(body: Secs2Item): number {
  return firstScalarInt(body) ?? 0xff;
}

// ─── S2F35 / S2F36 — Link Event Report ───────────────────────────────────────

/** A CEID → report-ids link (empty rptIds = unlink the CEID). */
export interface EventReportLink {
  ceid: number;
  rptIds: number[];
}

/**
 * S2F35 — Link Event Report (W). Host → Equipment.
 * Body: L[ DATAID(U4), L[ L[ CEID(U4), L[ RPTID(U4) … ] ] … ] ].
 */
export function s2f35(dataId: number, links: EventReportLink[]): Secs2Message {
  return {
    stream: 2,
    streamFunction: 35,
    wbit: true,
    body: I.L(
      I.U4(dataId >>> 0),
      I.L(...links.map((l) => I.L(I.U4(l.ceid >>> 0), I.L(...l.rptIds.map((r) => I.U4(r >>> 0)))))),
    ),
    name: "S2F35 Link Event Report",
  };
}

/** Parse an S2F35 body. */
export function parseS2F35(body: Secs2Item): { dataId: number; links: EventReportLink[] } | null {
  if (body.format !== "L") return null;
  const [dataIdItem, linksList] = body.value;
  const dataId = firstScalarInt(dataIdItem) ?? 0;
  const links: EventReportLink[] = [];
  if (linksList && linksList.format === "L") {
    for (const l of linksList.value) {
      if (l.format !== "L") continue;
      const [ceidItem, rptList] = l.value;
      const ceid = firstScalarInt(ceidItem) ?? 0;
      const rptIds: number[] = [];
      if (rptList && rptList.format === "L") {
        for (const r of rptList.value) {
          const n = firstScalarInt(r);
          if (n != null) rptIds.push(n);
        }
      }
      links.push({ ceid, rptIds });
    }
  }
  return { dataId, links };
}

/** S2F36 — Link Event Report Acknowledge. Body: LRACK(B). */
export function s2f36(lrack: number): Secs2Message {
  return { stream: 2, streamFunction: 36, wbit: false, body: I.B(lrack & 0xff), name: "S2F36 Link Event Report Acknowledge" };
}
/** Parse an S2F36 body → LRACK. */
export function parseS2F36(body: Secs2Item): number {
  return firstScalarInt(body) ?? 0xff;
}

// ─── S2F37 / S2F38 — Enable/Disable Event Report ─────────────────────────────

/**
 * S2F37 — Enable/Disable Event Report (W). Host → Equipment.
 * Body: L[ CEED(BOOLEAN), L[ CEID(U4) … ] ]. Empty CEID list = ALL events.
 * CEED true = enable, false = disable.
 */
export function s2f37(enable: boolean, ceids: number[]): Secs2Message {
  return {
    stream: 2,
    streamFunction: 37,
    wbit: true,
    body: I.L(I.BOOLEAN(enable), I.L(...ceids.map((c) => I.U4(c >>> 0)))),
    name: "S2F37 Enable/Disable Event Report",
  };
}

/** Parse an S2F37 body. */
export function parseS2F37(body: Secs2Item): { enable: boolean; ceids: number[] } | null {
  if (body.format !== "L") return null;
  const [ceedItem, ceidList] = body.value;
  const enable = ceedItem && ceedItem.format === "BOOLEAN" ? (ceedItem.value[0] ?? false) : false;
  const ceids: number[] = [];
  if (ceidList && ceidList.format === "L") {
    for (const c of ceidList.value) {
      const n = firstScalarInt(c);
      if (n != null) ceids.push(n);
    }
  }
  return { enable, ceids };
}

/** S2F38 — Enable/Disable Event Report Acknowledge. Body: ERACK(B). */
export function s2f38(erack: number): Secs2Message {
  return { stream: 2, streamFunction: 38, wbit: false, body: I.B(erack & 0xff), name: "S2F38 Enable/Disable Event Report Acknowledge" };
}
/** Parse an S2F38 body → ERACK. */
export function parseS2F38(body: Secs2Item): number {
  return firstScalarInt(body) ?? 0xff;
}

// ─── S2F13 / S2F14 — Equipment Constant Request / Data ───────────────────────

/** An equipment-constant value (ECID → typed SECS-II value item). */
export interface EquipmentConstantValue {
  ecid: number;
  value: Secs2Item;
}

/**
 * S2F13 — Equipment Constant Request (W). Host → Equipment.
 * Body: L[ ECID(U4) … ]. An EMPTY list requests ALL equipment constants.
 */
export function s2f13(ecids: number[]): Secs2Message {
  return {
    stream: 2,
    streamFunction: 13,
    wbit: true,
    body: I.L(...ecids.map((e) => I.U4(e >>> 0))),
    name: "S2F13 Equipment Constant Request",
  };
}

/** Parse an S2F13 body → the requested ECIDs (empty = request all). */
export function parseS2F13(body: Secs2Item): number[] {
  if (body.format !== "L") return [];
  const out: number[] = [];
  for (const e of body.value) {
    const n = firstScalarInt(e);
    if (n != null) out.push(n);
  }
  return out;
}

/**
 * S2F14 — Equipment Constant Data. Equipment → Host.
 * Body: L[ ECV … ] — one typed value item per requested ECID, in request order.
 * An unknown ECID is represented by a zero-length list item (SEMI convention).
 */
export function s2f14(values: Secs2Item[]): Secs2Message {
  return { stream: 2, streamFunction: 14, wbit: false, body: I.L(...values), name: "S2F14 Equipment Constant Data" };
}

/** Parse an S2F14 body → the ECV item list (types preserved). */
export function parseS2F14(body: Secs2Item): Secs2Item[] {
  return body.format === "L" ? body.value : [];
}

// ═════════════════════════════════════════════════════════════════════════════
// S7 — Process Program / Recipe
// ═════════════════════════════════════════════════════════════════════════════

// ─── S7F1 / S7F2 — PP-Load Inquire / Grant ───────────────────────────────────

/** S7F1 — Process Program Load Inquire (W). Body: L[ PPID(A), LENGTH(U4) ]. */
export function s7f1(ppid: string, length: number): Secs2Message {
  return {
    stream: 7,
    streamFunction: 1,
    wbit: true,
    body: I.L(I.A(ppid), I.U4(length >>> 0)),
    name: "S7F1 Process Program Load Inquire",
  };
}
/** Parse an S7F1 body. */
export function parseS7F1(body: Secs2Item): { ppid: string; length: number } | null {
  if (body.format !== "L") return null;
  const [ppidItem, lenItem] = body.value;
  return {
    ppid: ppidItem && ppidItem.format === "A" ? ppidItem.value : "",
    length: firstScalarInt(lenItem) ?? 0,
  };
}

/** S7F2 — Process Program Load Grant. Body: PPGNT(B). */
export function s7f2(ppgnt: number): Secs2Message {
  return { stream: 7, streamFunction: 2, wbit: false, body: I.B(ppgnt & 0xff), name: "S7F2 Process Program Load Grant" };
}
/** Parse an S7F2 body → PPGNT. */
export function parseS7F2(body: Secs2Item): number {
  return firstScalarInt(body) ?? 0xff;
}

// ─── S7F3 / S7F4 — PP-Send / Acknowledge ─────────────────────────────────────

/**
 * S7F3 — Process Program Send (W). Host → Equipment (send the recipe body).
 * Body: L[ PPID(A), PPBODY(B) ]. PPBODY carries the recipe JSON envelope bytes.
 */
export function s7f3(ppid: string, body: string): Secs2Message {
  return {
    stream: 7,
    streamFunction: 3,
    wbit: true,
    body: I.L(I.A(ppid), binaryFromString(body)),
    name: "S7F3 Process Program Send",
  };
}
/** Parse an S7F3 body → { ppid, body }. */
export function parseS7F3(body: Secs2Item): { ppid: string; body: string } | null {
  if (body.format !== "L") return null;
  const [ppidItem, bodyItem] = body.value;
  return {
    ppid: ppidItem && ppidItem.format === "A" ? ppidItem.value : "",
    body: stringFromBinary(bodyItem),
  };
}

/** S7F4 — Process Program Acknowledge. Body: ACKC7(B). */
export function s7f4(ackc7: number): Secs2Message {
  return { stream: 7, streamFunction: 4, wbit: false, body: I.B(ackc7 & 0xff), name: "S7F4 Process Program Acknowledge" };
}
/** Parse an S7F4 body → ACKC7. */
export function parseS7F4(body: Secs2Item): number {
  return firstScalarInt(body) ?? 0xff;
}

// ─── S7F5 / S7F6 — PP-Request / Data ─────────────────────────────────────────

/** S7F5 — Process Program Request (W). Body: PPID(A). Host asks for a PP. */
export function s7f5(ppid: string): Secs2Message {
  return { stream: 7, streamFunction: 5, wbit: true, body: I.A(ppid), name: "S7F5 Process Program Request" };
}
/** Parse an S7F5 body → PPID. */
export function parseS7F5(body: Secs2Item): string {
  return body.format === "A" ? body.value : "";
}

/**
 * S7F6 — Process Program Data. Equipment → Host (reply to S7F5).
 * Body: L[ PPID(A), PPBODY(B) ]. An absent PP replies with an EMPTY PPBODY.
 */
export function s7f6(ppid: string, body: string): Secs2Message {
  return {
    stream: 7,
    streamFunction: 6,
    wbit: false,
    body: I.L(I.A(ppid), binaryFromString(body)),
    name: "S7F6 Process Program Data",
  };
}
/** Parse an S7F6 body → { ppid, body }. */
export function parseS7F6(body: Secs2Item): { ppid: string; body: string } | null {
  if (body.format !== "L") return null;
  const [ppidItem, bodyItem] = body.value;
  return {
    ppid: ppidItem && ppidItem.format === "A" ? ppidItem.value : "",
    body: stringFromBinary(bodyItem),
  };
}

// ─── S7F17 / S7F18 — Delete Process Program ──────────────────────────────────

/** S7F17 — Delete Process Program (W). Body: L[ PPID(A) … ]. */
export function s7f17(ppids: string[]): Secs2Message {
  return {
    stream: 7,
    streamFunction: 17,
    wbit: true,
    body: I.L(...ppids.map((p) => I.A(p))),
    name: "S7F17 Delete Process Program",
  };
}
/** Parse an S7F17 body → PPID list. */
export function parseS7F17(body: Secs2Item): string[] {
  if (body.format !== "L") return [];
  return body.value.filter((x): x is Extract<Secs2Item, { format: "A" }> => x.format === "A").map((x) => x.value);
}

/** S7F18 — Delete Process Program Acknowledge. Body: ACKC7(B). */
export function s7f18(ackc7: number): Secs2Message {
  return { stream: 7, streamFunction: 18, wbit: false, body: I.B(ackc7 & 0xff), name: "S7F18 Delete Process Program Acknowledge" };
}
/** Parse an S7F18 body → ACKC7. */
export function parseS7F18(body: Secs2Item): number {
  return firstScalarInt(body) ?? 0xff;
}

// ─── S7F19 / S7F20 — Current EPPD (PP Directory) ─────────────────────────────

/** S7F19 — Request current Process Program Directory (W). Empty body (L[]). */
export function s7f19(): Secs2Message {
  return { stream: 7, streamFunction: 19, wbit: true, body: I.L(), name: "S7F19 Request PP Directory" };
}

/** S7F20 — Process Program Directory Data. Body: L[ PPID(A) … ]. */
export function s7f20(ppids: string[]): Secs2Message {
  return {
    stream: 7,
    streamFunction: 20,
    wbit: false,
    body: I.L(...ppids.map((p) => I.A(p))),
    name: "S7F20 Process Program Directory Data",
  };
}
/** Parse an S7F20 body → PPID list. */
export function parseS7F20(body: Secs2Item): string[] {
  if (body.format !== "L") return [];
  return body.value.filter((x): x is Extract<Secs2Item, { format: "A" }> => x.format === "A").map((x) => x.value);
}

// ═════════════════════════════════════════════════════════════════════════════
// PP ↔ recipe binding (a PP IS a versioned recipe) — NO migration, reuse recipe
// storage. The PP body is a JSON envelope of the recipe.
// ═════════════════════════════════════════════════════════════════════════════

/** A recipe subset that maps 1:1 onto a Process Program body. */
export interface RecipeLike {
  code: string;
  name?: string | null;
  version?: number | null;
  payload: Record<string, unknown>;
  checksum?: string | null;
}

/** Build a PPID from a recipe code (+ optional version). `code@v3` or bare `code`. */
export function ppidForRecipe(code: string, version?: number | null): string {
  return version != null ? `${code}@v${version}` : code;
}

/** Parse a PPID back into { code, version }. Tolerates a bare code (version=null). */
export function parsePpid(ppid: string): { code: string; version: number | null } {
  const m = /^(.*)@v(\d+)$/.exec(ppid);
  if (m) return { code: m[1], version: Number(m[2]) };
  return { code: ppid, version: null };
}

/** Serialise a recipe to a PP body (deterministic JSON envelope). */
export function recipeToPpBody(recipe: RecipeLike): string {
  return JSON.stringify({
    code: recipe.code,
    name: recipe.name ?? recipe.code,
    version: recipe.version ?? null,
    payload: recipe.payload,
    checksum: recipe.checksum ?? null,
  });
}

/** Parse a PP body back into a RecipeLike. Returns null on malformed JSON. */
export function ppBodyToRecipe(ppid: string, body: string): RecipeLike | null {
  try {
    const obj = JSON.parse(body) as Partial<RecipeLike>;
    if (!obj || typeof obj !== "object" || typeof obj.payload !== "object" || obj.payload == null) return null;
    const parsed = parsePpid(ppid);
    return {
      code: typeof obj.code === "string" ? obj.code : parsed.code,
      name: typeof obj.name === "string" ? obj.name : null,
      version: typeof obj.version === "number" ? obj.version : parsed.version,
      payload: obj.payload as Record<string, unknown>,
      checksum: typeof obj.checksum === "string" ? obj.checksum : null,
    };
  } catch {
    return null;
  }
}

/** Adapt a full DB `MachineRecipe` row to the PP body envelope. */
export function machineRecipeToPpBody(recipe: Pick<MachineRecipe, "code" | "name" | "version" | "payload" | "checksum">): string {
  return recipeToPpBody({
    code: recipe.code,
    name: recipe.name,
    version: recipe.version,
    payload: recipe.payload,
    checksum: recipe.checksum,
  });
}

// ─── PP store (pluggable; default in-memory) ─────────────────────────────────

/**
 * A minimal PP (process program) store. The DEFAULT is in-memory (for the
 * message-layer simulation, tests, and flag-OFF safety). A recipe-backed store
 * can wrap recipeVersioningService (EQ_INTEG_ENABLED-gated) at this seam so a PP
 * round-trips through the real, versioned recipe catalog — REUSING recipe storage,
 * no migration 0162.
 */
export interface PpStore {
  putPp(ppid: string, body: string): void | Promise<void>;
  getPp(ppid: string): (string | undefined) | Promise<string | undefined>;
  deletePp(ppid: string): boolean | Promise<boolean>;
  listPpids(): string[] | Promise<string[]>;
}

/** In-memory PP store (deterministic; used by the sim + tests). */
export class InMemoryPpStore implements PpStore {
  private readonly store = new Map<string, string>();

  putPp(ppid: string, body: string): void {
    this.store.set(ppid, body);
  }
  getPp(ppid: string): string | undefined {
    return this.store.get(ppid);
  }
  deletePp(ppid: string): boolean {
    return this.store.delete(ppid);
  }
  listPpids(): string[] {
    return [...this.store.keys()];
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Host-command → gated PROPOSAL mapping (NO ungated actuation)
// ═════════════════════════════════════════════════════════════════════════════

/** Canonical platform command verbs a host RCMD may map onto. */
export type CanonicalCommand =
  | "start"
  | "stop"
  | "pause"
  | "reset"
  | "abort"
  | "select_recipe";

// PERM/risk mirror server/services/equipment/capabilityModel.ts (PERM_CONTROL /
// PERM_PARAM, risk high/low) — the SAME contract the OT dispatcher enforces.
const PERM_CONTROL = "machine_control/canCreate";

interface CommandMapEntry {
  command: CanonicalCommand;
  riskLevel: RiskLevel;
  requiredPermission: string;
  /** Default OT tag the gated dispatcher writes (mirrors writeHandlers/machineControl.ts). */
  defaultTag: string;
  /** For PP-SELECT: the CPNAME(s) that carry the PPID/recipe code. */
  recipeParamNames?: string[];
}

/**
 * RCMD → canonical command table. RCMD spellings are normalised (upper-case, `-`
 * and `_` stripped) so "PP-SELECT", "PPSELECT", "pp_select" all match. Every
 * mapped command is HIGH risk and requires machine_control/canCreate — identical
 * to the capability model, so a host command can never be quietly lower-gated.
 */
const HOST_COMMAND_MAP: Record<string, CommandMapEntry> = {
  START: { command: "start", riskLevel: "high", requiredPermission: PERM_CONTROL, defaultTag: "cmd_start" },
  STOP: { command: "stop", riskLevel: "high", requiredPermission: PERM_CONTROL, defaultTag: "cmd_stop" },
  PAUSE: { command: "pause", riskLevel: "high", requiredPermission: PERM_CONTROL, defaultTag: "cmd_pause" },
  HOLD: { command: "pause", riskLevel: "high", requiredPermission: PERM_CONTROL, defaultTag: "cmd_pause" },
  RESUME: { command: "reset", riskLevel: "high", requiredPermission: PERM_CONTROL, defaultTag: "cmd_reset" },
  RESET: { command: "reset", riskLevel: "high", requiredPermission: PERM_CONTROL, defaultTag: "cmd_reset" },
  ABORT: { command: "abort", riskLevel: "high", requiredPermission: PERM_CONTROL, defaultTag: "cmd_abort" },
  PPSELECT: {
    command: "select_recipe",
    riskLevel: "high",
    requiredPermission: PERM_CONTROL,
    defaultTag: "recipe_select",
    recipeParamNames: ["PPID", "RCP", "RECIPE", "RECIPECODE"],
  },
};

/** Normalise an RCMD spelling for table lookup. */
function normaliseRcmd(rcmd: string): string {
  return rcmd.toUpperCase().replace(/[-_\s]/g, "");
}

/**
 * A GATED host-command proposal. It is NEVER an actuation — it declares the
 * canonical command + the RBAC/risk contract the OT dispatcher enforces and MUST
 * pass through the HITL confirm flow. `hcack` is the recommended S2F42 reply
 * (4 = "will be performed later" — deferred to HITL; 1 = unknown command;
 * 3 = a required parameter is missing/invalid).
 */
export interface HostCommandProposal {
  rcmd: string;
  /** Canonical platform command, or null when the RCMD is unknown. */
  canonicalCommand: CanonicalCommand | null;
  params: HostCommandParam[];
  /** For PP-SELECT: the recipe code extracted from the PPID parameter. */
  recipeCode?: string;
  riskLevel: RiskLevel | null;
  requiredPermission: string | null;
  /** ALWAYS true — a host command is a proposal, never a direct actuation. */
  gated: true;
  /** ALWAYS true — a human must approve via the HITL flow before any write. */
  requiresApproval: true;
  /** The protocol layer performs NO write; only the gated dispatcher can. */
  willActuate: false;
  /** Recommended S2F42 acknowledge code. */
  hcack: number;
  /** Per-parameter acknowledges for the S2F42 reply. */
  paramAcks: CommandParamAck[];
  reason: string;
}

/**
 * Map an inbound host command (RCMD + params) to a GATED proposal. PURE — no side
 * effects, no DB, no dispatcher. Always safe to call (flag-independent) because it
 * only ANALYSES; it never actuates. The equipment side turns this into an S2F42
 * (`proposalToS2F42`) and, separately and flag-gated, a HITL DispatchInput.
 */
export function mapHostCommandToProposal(rcmd: string, params: HostCommandParam[] = []): HostCommandProposal {
  const entry = HOST_COMMAND_MAP[normaliseRcmd(rcmd)];
  if (!entry) {
    return {
      rcmd,
      canonicalCommand: null,
      params,
      riskLevel: null,
      requiredPermission: null,
      gated: true,
      requiresApproval: true,
      willActuate: false,
      hcack: HCACK.NO_SUCH_COMMAND,
      paramAcks: params.map((p) => ({ name: p.name, cpack: CPACK.PARAMETER_NAME_UNKNOWN })),
      reason: `Unknown RCMD "${rcmd}" — no mapped platform command`,
    };
  }

  const paramAcks: CommandParamAck[] = params.map((p) => ({ name: p.name, cpack: CPACK.OK }));

  // PP-SELECT must carry a PPID/recipe parameter.
  let recipeCode: string | undefined;
  let hcack: number = HCACK.ACK_FINISH_LATER;
  let reason = `Host command "${rcmd}" → "${entry.command}" accepted as a gated HITL proposal (will be performed later)`;
  if (entry.command === "select_recipe") {
    const names = new Set((entry.recipeParamNames ?? []).map((n) => n.toUpperCase()));
    const ppidParam = params.find((p) => names.has(p.name.toUpperCase()));
    const raw = ppidParam ? itemScalar(ppidParam.value) : null;
    if (raw == null || String(raw).length === 0) {
      hcack = HCACK.PARAMETER_INVALID;
      reason = `PP-SELECT missing a PPID/recipe parameter (${[...names].join("/")})`;
    } else {
      recipeCode = parsePpid(String(raw)).code;
    }
  }

  return {
    rcmd,
    canonicalCommand: entry.command,
    params,
    recipeCode,
    riskLevel: entry.riskLevel,
    requiredPermission: entry.requiredPermission,
    gated: true,
    requiresApproval: true,
    willActuate: false,
    hcack,
    paramAcks,
    reason,
  };
}

/** Build the S2F42 acknowledge for a proposal. */
export function proposalToS2F42(proposal: HostCommandProposal): Secs2Message {
  return s2f42(proposal.hcack, proposal.paramAcks);
}

/** Context needed to construct the HITL dispatch input for a gated proposal. */
export interface HitlDispatchContext {
  adapterId: number;
  machineId?: number | null;
  /** User who APPROVED/confirmed the HITL action (owns the pending row). */
  confirmedBy: number;
  /** User who originally requested (proposed) the action. */
  requestedBy: number;
  /** ai_pending_actions.id of the confirmed HITL action (defense-in-depth). */
  actionId?: string;
  idempotencyKey?: string;
  lang?: "vi" | "en" | "zh";
  /** Override the OT tag written (defaults to the command's canonical tag). */
  tagKey?: string;
}

/**
 * Construct the `DispatchInput` that routes a gated host-command proposal through
 * the EXISTING OT command dispatcher — the SAME `triggeredBy.kind: "hitl"` path an
 * AI write-action takes. This does NOT call dispatch(); it only builds the input,
 * which the dispatcher will still gate on confirm-owner + OT_CONTROL_ENABLED +
 * commissioning. FLAG-GATED: throws when GEM300 is disabled (so no actuation-intent
 * input can even be constructed with the flag OFF), and throws for an unmapped
 * command (there is no ungated fallback).
 */
export function buildHitlDispatchInput(proposal: HostCommandProposal, ctx: HitlDispatchContext): DispatchInput {
  if (!isGem300Enabled()) {
    throw new FeatureDisabledError("gem300", "GEM300 is disabled (set GEM300_ENABLED=true). No host-command dispatch input can be built.");
  }
  if (!proposal.canonicalCommand) {
    throw new Error(`Cannot dispatch an unmapped host command "${proposal.rcmd}"`);
  }
  const entry = HOST_COMMAND_MAP[normaliseRcmd(proposal.rcmd)];
  const tagKey = ctx.tagKey ?? entry.defaultTag;
  const value =
    proposal.canonicalCommand === "select_recipe" ? (proposal.recipeCode ?? "") : true;

  return {
    adapterId: ctx.adapterId,
    machineId: ctx.machineId ?? null,
    commandType: proposal.canonicalCommand,
    writes: [{ tagKey, value }],
    triggeredBy: {
      kind: "hitl",
      actionId: ctx.actionId,
      confirmedBy: ctx.confirmedBy,
      requestedBy: ctx.requestedBy,
    },
    lang: ctx.lang,
    idempotencyKey: ctx.idempotencyKey ?? `gem300-s2f41-${proposal.canonicalCommand}-${Date.now()}`,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Equipment-side simulation handler — dynamic report/event/EC registries + PP store
// ═════════════════════════════════════════════════════════════════════════════

/** Config for the equipment-side GEM300 handler. */
export interface Gem300Config {
  /** Platform machine code this equipment maps to (for traceability). */
  machineCode?: string;
  /** Pluggable PP store (default: in-memory). */
  ppStore?: PpStore;
  /** Seed equipment constants (ECID → typed value item). */
  equipmentConstants?: EquipmentConstantValue[];
}

/**
 * Equipment-side GEM300 handler. Implements the dynamic report/event definition
 * that gemStateModel explicitly leaves out (S2F33/F35/F37), an equipment-constant
 * registry (S2F13/F14), and the S7 PP transfer flow bound to a PP store. It is
 * PURE (no sockets, no timers, no DB): every handler takes a decoded inbound body
 * (or a parsed request) and returns the SECS-II reply message. A host command is
 * only ever answered with a gated proposal + S2F42 (deferred to HITL).
 */
export class Gem300Equipment {
  readonly machineCode: string | undefined;
  private readonly ppStore: PpStore;
  /** RPTID → the VIDs it collects. */
  readonly reports = new Map<number, number[]>();
  /** CEID → the linked RPTIDs. */
  readonly links = new Map<number, number[]>();
  /** Enabled CEIDs (event reports). */
  readonly enabledEvents = new Set<number>();
  /** ECID → typed value item. */
  readonly equipmentConstants = new Map<number, Secs2Item>();

  constructor(config: Gem300Config = {}) {
    this.machineCode = config.machineCode;
    this.ppStore = config.ppStore ?? new InMemoryPpStore();
    for (const ec of config.equipmentConstants ?? []) this.equipmentConstants.set(ec.ecid, ec.value);
  }

  // ── S2F41 → gated proposal + S2F42 ─────────────────────────────────────────

  /**
   * Handle an inbound S2F41 host command. Returns the gated proposal AND the
   * S2F42 acknowledge to send back. NEVER actuates — the proposal must go through
   * `buildHitlDispatchInput()` + the OT dispatcher (HITL) to reach a device.
   */
  handleHostCommand(body: Secs2Item): { proposal: HostCommandProposal; reply: Secs2Message } {
    const parsed = parseS2F41(body);
    if (!parsed) {
      const proposal = mapHostCommandToProposal("", []);
      return { proposal, reply: proposalToS2F42(proposal) };
    }
    const proposal = mapHostCommandToProposal(parsed.rcmd, parsed.params);
    return { proposal, reply: proposalToS2F42(proposal) };
  }

  // ── S2F33 Define Report ────────────────────────────────────────────────────

  /** Handle S2F33 Define Report → update the report registry, return S2F34. */
  defineReports(body: Secs2Item): Secs2Message {
    const parsed = parseS2F33(body);
    if (!parsed) return s2f34(DRACK.DENIED_INVALID_FORMAT);
    // Empty report list = delete ALL reports (and unlink everything).
    if (parsed.reports.length === 0) {
      this.reports.clear();
      this.links.clear();
      return s2f34(DRACK.OK);
    }
    for (const r of parsed.reports) {
      if (r.vids.length === 0) {
        this.reports.delete(r.rptId);
        // A deleted report can no longer be linked.
        for (const [ceid, rptIds] of this.links) {
          const filtered = rptIds.filter((x) => x !== r.rptId);
          if (filtered.length === 0) this.links.delete(ceid);
          else this.links.set(ceid, filtered);
        }
      } else {
        this.reports.set(r.rptId, [...r.vids]);
      }
    }
    return s2f34(DRACK.OK);
  }

  // ── S2F35 Link Event Report ────────────────────────────────────────────────

  /** Handle S2F35 Link Event Report → update the CEID→report links, return S2F36. */
  linkEventReports(body: Secs2Item): Secs2Message {
    const parsed = parseS2F35(body);
    if (!parsed) return s2f36(LRACK.DENIED_INVALID_FORMAT);
    for (const l of parsed.links) {
      if (l.rptIds.length === 0) {
        this.links.delete(l.ceid);
        continue;
      }
      // A link referencing an undefined report is rejected (LRACK 5).
      const missing = l.rptIds.find((r) => !this.reports.has(r));
      if (missing != null) return s2f36(LRACK.DENIED_RPTID_DOES_NOT_EXIST);
      this.links.set(l.ceid, [...l.rptIds]);
    }
    return s2f36(LRACK.OK);
  }

  // ── S2F37 Enable/Disable Event Report ──────────────────────────────────────

  /** Handle S2F37 Enable/Disable Event Report → toggle enabled CEIDs, return S2F38. */
  enableEventReports(body: Secs2Item): Secs2Message {
    const parsed = parseS2F37(body);
    if (!parsed) return s2f38(ERACK.DENIED_CEID_DOES_NOT_EXIST);
    // Empty CEID list = ALL linked events.
    const targets = parsed.ceids.length > 0 ? parsed.ceids : [...this.links.keys()];
    for (const ceid of targets) {
      if (parsed.enable) this.enabledEvents.add(ceid);
      else this.enabledEvents.delete(ceid);
    }
    return s2f38(ERACK.OK);
  }

  /** Test/inspection helper: is a CEID currently enabled? */
  isEventEnabled(ceid: number): boolean {
    return this.enabledEvents.has(ceid);
  }

  // ── S2F13 Equipment Constant Request ───────────────────────────────────────

  /** Handle S2F13 Equipment Constant Request → build S2F14 with the values. */
  requestEquipmentConstants(body: Secs2Item): Secs2Message {
    const ecids = parseS2F13(body);
    // Empty request = ALL ECIDs (in ascending id order for determinism).
    const targets = ecids.length > 0 ? ecids : [...this.equipmentConstants.keys()].sort((a, b) => a - b);
    const values = targets.map((ecid) => this.equipmentConstants.get(ecid) ?? I.L()); // unknown → zero-length list
    return s2f14(values);
  }

  // ── S7 PP transfer ─────────────────────────────────────────────────────────

  /** Handle S7F1 PP-Load Inquire → S7F2 grant (accept the load). */
  async ppLoadInquire(body: Secs2Item): Promise<Secs2Message> {
    const parsed = parseS7F1(body);
    if (!parsed || parsed.ppid.length === 0) return s7f2(PPGNT.INVALID_PPID);
    return s7f2(PPGNT.OK);
  }

  /** Handle S7F3 PP-Send → store the PP body, return S7F4 acknowledge. */
  async ppSend(body: Secs2Item): Promise<Secs2Message> {
    const parsed = parseS7F3(body);
    if (!parsed || parsed.ppid.length === 0) return s7f4(ACKC7.LENGTH_ERROR);
    await this.ppStore.putPp(parsed.ppid, parsed.body);
    return s7f4(ACKC7.ACCEPTED);
  }

  /** Handle S7F5 PP-Request → return S7F6 with the stored PP (empty body if absent). */
  async ppRequest(body: Secs2Item): Promise<Secs2Message> {
    const ppid = parseS7F5(body);
    const stored = await this.ppStore.getPp(ppid);
    return s7f6(ppid, stored ?? "");
  }

  /** Handle S7F17 Delete PP → delete the PPIDs, return S7F18 acknowledge. */
  async deleteProcessPrograms(body: Secs2Item): Promise<Secs2Message> {
    const ppids = parseS7F17(body);
    let allFound = true;
    for (const ppid of ppids) {
      const deleted = await this.ppStore.deletePp(ppid);
      if (!deleted) allFound = false;
    }
    return s7f18(allFound ? ACKC7.ACCEPTED : ACKC7.PPID_NOT_FOUND);
  }

  /** Handle S7F19 Request PP Directory → S7F20 with the stored PPIDs. */
  async processProgramDirectory(): Promise<Secs2Message> {
    const ppids = await this.ppStore.listPpids();
    return s7f20(ppids);
  }

  /** Convenience: store a recipe as a PP (PPID = code@vN, body = JSON envelope). */
  async loadRecipeAsPp(recipe: RecipeLike): Promise<string> {
    const ppid = ppidForRecipe(recipe.code, recipe.version);
    await this.ppStore.putPp(ppid, recipeToPpBody(recipe));
    return ppid;
  }

  /** Convenience: read a PP back into a RecipeLike (null if absent/malformed). */
  async readPpAsRecipe(ppid: string): Promise<RecipeLike | null> {
    const body = await this.ppStore.getPp(ppid);
    if (body == null) return null;
    return ppBodyToRecipe(ppid, body);
  }
}
