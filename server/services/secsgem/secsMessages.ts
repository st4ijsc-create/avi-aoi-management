/**
 * SECS/GEM Connectivity FRAMEWORK — SECS-II message model (SEMI E5).
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * This file is a FRAMEWORK skeleton, NOT a certified production codec. It models
 * the common GEM Stream/Function messages as typed structures and provides a
 * MINIMAL SECS-II item codec (clearly marked) covering the item formats this
 * framework actually round-trips in tests (L, A, U1, U2, U4, BOOLEAN, BINARY).
 * A real deployment MUST validate the full SECS-II binary codec (all formats,
 * I1/I2/I4/I8, U8, F4/F8, JIS, signed/unsigned edge cases, length-byte width
 * selection) against actual equipment or a vetted library (e.g. `secs-gem`).
 *
 * ── SECS-II ITEM FORMAT (SEMI E5) ────────────────────────────────────────────
 * Every SECS-II item is: [format-byte][length-bytes...][data...].
 *   - The format byte's high 6 bits are the FORMAT CODE; the low 2 bits encode
 *     the NUMBER OF LENGTH BYTES that follow (1, 2, or 3).
 *   - The length value (1..3 bytes, big-endian) is the BYTE COUNT of the data
 *     that follows — EXCEPT for List (L) where it is the ELEMENT COUNT.
 * Format codes used here (octal in the SEMI spec → we store the 6-bit value):
 *   L       = 0o00 (0)   list      — length = number of child items
 *   BINARY  = 0o10 (8)   raw bytes
 *   BOOLEAN = 0o11 (9)   1 byte per element (0x00 / 0x01)
 *   ASCII   = 0o20 (16)  A — ASCII string, length = byte count
 *   I8/I1/I2/I4 = 0o30/31/32/34  signed ints (NOT implemented — skeleton)
 *   U8/U1/U2/U4 = 0o50/51/52/54  unsigned ints
 *   F8/F4   = 0o40/44   floats     (NOT implemented — skeleton)
 * The codec below implements L, A, BOOLEAN, BINARY, U1, U2, U4 only.
 */

/** SECS-II item format codes (the 6-bit value, not octal-shifted). */
export const SecsFormat = {
  L: 0o00, // 0  — list
  BINARY: 0o10, // 8
  BOOLEAN: 0o11, // 9
  ASCII: 0o20, // 16
  I8: 0o30, // 24 (skeleton — not encoded/decoded)
  I1: 0o31, // 25 (skeleton)
  I2: 0o32, // 26 (skeleton)
  I4: 0o34, // 28 (skeleton)
  F8: 0o40, // 32 (skeleton)
  F4: 0o44, // 36 (skeleton)
  U8: 0o50, // 40 (skeleton)
  U1: 0o51, // 41
  U2: 0o52, // 42
  U4: 0o54, // 44
} as const;

export type SecsFormatCode = (typeof SecsFormat)[keyof typeof SecsFormat];

/**
 * A SECS-II data item — a discriminated union mirroring the SEMI E5 item tree.
 * `L` (list) is recursive. Numeric items carry a JS number[] (one entry per
 * element); the codec enforces range per format width.
 */
export type SecsItem =
  | { format: "L"; value: SecsItem[] }
  | { format: "A"; value: string }
  | { format: "BOOLEAN"; value: boolean[] }
  | { format: "BINARY"; value: number[] } // each 0..255
  | { format: "U1"; value: number[] }
  | { format: "U2"; value: number[] }
  | { format: "U4"; value: number[] };

/** Convenience constructors (keep call-sites declarative). */
export const Item = {
  L: (...items: SecsItem[]): SecsItem => ({ format: "L", value: items }),
  A: (value: string): SecsItem => ({ format: "A", value }),
  BOOLEAN: (...value: boolean[]): SecsItem => ({ format: "BOOLEAN", value }),
  BINARY: (...value: number[]): SecsItem => ({ format: "BINARY", value }),
  U1: (...value: number[]): SecsItem => ({ format: "U1", value }),
  U2: (...value: number[]): SecsItem => ({ format: "U2", value }),
  U4: (...value: number[]): SecsItem => ({ format: "U4", value }),
};

/**
 * A full SECS-II message = Stream + Function + W-bit (reply expected) + body.
 * Stream/Function identify the message (e.g. S1F13). `reply` is the W-bit.
 */
export interface SecsMessage {
  stream: number;
  function: number;
  /** W-bit: true → a reply (SxF(y+1)) is expected. */
  reply: boolean;
  /** Root SECS-II item (the message body). May be an empty list. */
  body: SecsItem;
  /** Human label for logs/tests (e.g. "S1F13 Establish Communications Request"). */
  name?: string;
}

// ─── Common GEM messages (typed factories) ───────────────────────────────────
//
// These mirror the canonical GEM (SEMI E30) message set the framework targets.
// Bodies follow the standard layout; values are placeholders where a real
// equipment model would substitute live data.

/** S1F1 — Are You There (W). Empty body. Host↔equipment liveness probe. */
export function s1f1(): SecsMessage {
  return { stream: 1, function: 1, reply: true, body: Item.L(), name: "S1F1 Are You There" };
}

/** S1F2 — On Line Data. Reply to S1F1: L[ MDLN(A), SOFTREV(A) ]. */
export function s1f2(modelName: string, softRev: string): SecsMessage {
  return {
    stream: 1,
    function: 2,
    reply: false,
    body: Item.L(Item.A(modelName), Item.A(softRev)),
    name: "S1F2 On Line Data",
  };
}

/** S1F13 — Establish Communications Request (W): L[ MDLN(A), SOFTREV(A) ]. */
export function s1f13(modelName: string, softRev: string): SecsMessage {
  return {
    stream: 1,
    function: 13,
    reply: true,
    body: Item.L(Item.A(modelName), Item.A(softRev)),
    name: "S1F13 Establish Communications Request",
  };
}

/**
 * S1F14 — Establish Communications Request Acknowledge:
 * L[ COMMACK(BINARY 0=accepted/1=denied), L[ MDLN(A), SOFTREV(A) ] ].
 */
export function s1f14(commack: number, modelName: string, softRev: string): SecsMessage {
  return {
    stream: 1,
    function: 14,
    reply: false,
    body: Item.L(Item.BINARY(commack & 0xff), Item.L(Item.A(modelName), Item.A(softRev))),
    name: "S1F14 Establish Communications Request Acknowledge",
  };
}

/**
 * S2F41 — Host Command Send (W): L[ RCMD(A), L[ L[ CPNAME(A), CPVAL(A) ] ... ] ].
 * NOTE: this framework only MODELS the host command; it does NOT execute it on
 * equipment (no write-to-machine path).
 */
export function s2f41(rcmd: string, params: Array<{ name: string; value: string }> = []): SecsMessage {
  return {
    stream: 2,
    function: 41,
    reply: true,
    body: Item.L(
      Item.A(rcmd),
      Item.L(...params.map((p) => Item.L(Item.A(p.name), Item.A(p.value)))),
    ),
    name: "S2F41 Host Command Send",
  };
}

/**
 * S5F1 — Alarm Report Send (W): L[ ALCD(BINARY: bit7=set/clear), ALID(U4), ALTX(A) ].
 * ALCD bit 7 (0x80) = alarm SET; cleared = 0x00.
 */
export function s5f1(alid: number, alarmText: string, set = true): SecsMessage {
  return {
    stream: 5,
    function: 1,
    reply: true,
    body: Item.L(Item.BINARY(set ? 0x80 : 0x00), Item.U4(alid >>> 0), Item.A(alarmText)),
    name: "S5F1 Alarm Report Send",
  };
}

/**
 * S6F11 — Event Report Send (W):
 * L[ DATAID(U4), CEID(U4), L[ L[ RPTID(U4), L[ V ... ] ] ... ] ].
 * The classic GEM collection-event report.
 */
export function s6f11(
  dataId: number,
  ceid: number,
  reports: Array<{ rptId: number; values: SecsItem[] }> = [],
): SecsMessage {
  return {
    stream: 6,
    function: 11,
    reply: true,
    body: Item.L(
      Item.U4(dataId >>> 0),
      Item.U4(ceid >>> 0),
      Item.L(
        ...reports.map((r) => Item.L(Item.U4(r.rptId >>> 0), Item.L(...r.values))),
      ),
    ),
    name: "S6F11 Event Report Send",
  };
}

/**
 * S6F1 — Trace Data Send (W): L[ TRID(U4), SMPLN(U4), STIME(A), L[ V ... ] ].
 * Periodic status-variable trace sample.
 */
export function s6f1(trid: number, sampleNo: number, stime: string, values: SecsItem[] = []): SecsMessage {
  return {
    stream: 6,
    function: 1,
    reply: true,
    body: Item.L(Item.U4(trid >>> 0), Item.U4(sampleNo >>> 0), Item.A(stime), Item.L(...values)),
    name: "S6F1 Trace Data Send",
  };
}

// ─── Minimal SECS-II item codec (SKELETON — see header) ───────────────────────

const FMT_CODE: Record<SecsItem["format"], number> = {
  L: SecsFormat.L,
  A: SecsFormat.ASCII,
  BOOLEAN: SecsFormat.BOOLEAN,
  BINARY: SecsFormat.BINARY,
  U1: SecsFormat.U1,
  U2: SecsFormat.U2,
  U4: SecsFormat.U4,
};

const UINT_WIDTH: Partial<Record<SecsItem["format"], number>> = { U1: 1, U2: 2, U4: 4 };

/** Encode the [format-byte][length-bytes] header for a given format + length value. */
function encodeHeader(formatCode: number, length: number): Buffer {
  // Choose the smallest length-byte width (1..3) that holds the length value.
  let nLenBytes: number;
  if (length <= 0xff) nLenBytes = 1;
  else if (length <= 0xffff) nLenBytes = 2;
  else nLenBytes = 3;

  const head = Buffer.alloc(1 + nLenBytes);
  head[0] = ((formatCode & 0x3f) << 2) | (nLenBytes & 0x03);
  for (let i = 0; i < nLenBytes; i++) {
    head[nLenBytes - i] = (length >>> (8 * i)) & 0xff;
  }
  return head;
}

/**
 * Encode a SECS-II item to a Buffer (skeleton — formats listed in header only).
 * Throws on an unsupported numeric range so test failures are explicit.
 */
export function encodeItem(item: SecsItem): Buffer {
  const formatCode = FMT_CODE[item.format];

  if (item.format === "L") {
    const children = item.value.map(encodeItem);
    // List length = ELEMENT count (not byte count).
    return Buffer.concat([encodeHeader(formatCode, item.value.length), ...children]);
  }

  if (item.format === "A") {
    const data = Buffer.from(item.value, "ascii");
    return Buffer.concat([encodeHeader(formatCode, data.length), data]);
  }

  if (item.format === "BOOLEAN") {
    const data = Buffer.from(item.value.map((b) => (b ? 0x01 : 0x00)));
    return Buffer.concat([encodeHeader(formatCode, data.length), data]);
  }

  if (item.format === "BINARY") {
    const data = Buffer.from(item.value.map((n) => n & 0xff));
    return Buffer.concat([encodeHeader(formatCode, data.length), data]);
  }

  // Unsigned integers U1/U2/U4.
  const width = UINT_WIDTH[item.format]!;
  const data = Buffer.alloc(item.value.length * width);
  item.value.forEach((n, idx) => {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff || (width < 4 && n > (1 << (8 * width)) - 1)) {
      throw new Error(`encodeItem: value ${n} out of range for ${item.format}`);
    }
    for (let i = 0; i < width; i++) {
      data[idx * width + (width - 1 - i)] = (n >>> (8 * i)) & 0xff;
    }
  });
  return Buffer.concat([encodeHeader(formatCode, data.length), data]);
}

/** Decode one item at `buf[offset]`; returns the item + the next offset. */
function decodeItemAt(buf: Buffer, offset: number): { item: SecsItem; next: number } {
  const formatByte = buf[offset];
  const formatCode = (formatByte >>> 2) & 0x3f;
  const nLenBytes = formatByte & 0x03;
  if (nLenBytes < 1 || nLenBytes > 3) {
    throw new Error(`decodeItem: invalid length-byte count ${nLenBytes} at offset ${offset}`);
  }
  let length = 0;
  for (let i = 0; i < nLenBytes; i++) {
    length = (length << 8) | buf[offset + 1 + i];
  }
  let cursor = offset + 1 + nLenBytes;

  if (formatCode === SecsFormat.L) {
    const value: SecsItem[] = [];
    for (let i = 0; i < length; i++) {
      const { item, next } = decodeItemAt(buf, cursor);
      value.push(item);
      cursor = next;
    }
    return { item: { format: "L", value }, next: cursor };
  }

  const data = buf.subarray(cursor, cursor + length);
  cursor += length;

  if (formatCode === SecsFormat.ASCII) {
    return { item: { format: "A", value: data.toString("ascii") }, next: cursor };
  }
  if (formatCode === SecsFormat.BOOLEAN) {
    return { item: { format: "BOOLEAN", value: [...data].map((b) => b !== 0) }, next: cursor };
  }
  if (formatCode === SecsFormat.BINARY) {
    return { item: { format: "BINARY", value: [...data] }, next: cursor };
  }

  const fmtName: SecsItem["format"] | undefined =
    formatCode === SecsFormat.U1 ? "U1" : formatCode === SecsFormat.U2 ? "U2" : formatCode === SecsFormat.U4 ? "U4" : undefined;
  if (!fmtName) {
    throw new Error(`decodeItem: unsupported format code ${formatCode} (skeleton codec — see file header)`);
  }
  const width = UINT_WIDTH[fmtName]!;
  const value: number[] = [];
  for (let i = 0; i < data.length; i += width) {
    let n = 0;
    for (let j = 0; j < width; j++) n = (n << 8) | data[i + j];
    value.push(n >>> 0);
  }
  return { item: { format: fmtName, value }, next: cursor };
}

/** Decode a single root SECS-II item from a Buffer. */
export function decodeItem(buf: Buffer): SecsItem {
  return decodeItemAt(buf, 0).item;
}

/** Round-trip a message body's SECS-II item tree (encode then decode). */
export function encodeMessageBody(msg: SecsMessage): Buffer {
  return encodeItem(msg.body);
}
