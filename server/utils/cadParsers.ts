/**
 * P4.B G9 — Minimal CAD parsers for AOI/AVI measurement-point seeding.
 *
 * Two formats supported:
 *  - DXF (AutoCAD R12+, ASCII variant) → full geometry extraction for
 *    CIRCLE / LINE / LWPOLYLINE entities. Each becomes a candidate MP.
 *  - STEP AP242 (ISO 10303-21 Part-21 file) → entity tally + CIRCLE entities
 *    with explicit radius. Full B-Rep geometry resolution is intentionally
 *    out of scope (multi-week effort); user can confirm/edit candidates.
 *
 * No external deps. All pure functions.
 */

export interface CadCandidate {
  candidateIndex: number;
  code?: string;
  name?: string;
  shape: "circle" | "rect" | "polygon" | "line";
  positionX: number;
  positionY: number;
  positionZ?: number;
  radius?: number;
  geometry?: any;
  sourceEntityType: string;
  sourceEntityId?: string;
}

export interface CadParseResult {
  format: "dxf" | "step" | "gerber";
  parserVersion: string;
  entityCounts: Record<string, number>;
  candidates: CadCandidate[];
  warnings: string[];
}

// ============================================================================
// DXF parser — reads ASCII DXF stream as alternating (group code, value) pairs.
// ============================================================================
export function parseDxf(text: string): CadParseResult {
  const warnings: string[] = [];
  const entityCounts: Record<string, number> = {};
  const candidates: CadCandidate[] = [];

  // Normalize line endings, split into trimmed pairs.
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.length < 4) {
    warnings.push("DXF too short — not a valid DXF stream.");
    return { format: "dxf", parserVersion: "1.0", entityCounts, candidates, warnings };
  }

  // Locate ENTITIES section.
  let i = 0;
  let inEntities = false;
  while (i < lines.length - 1) {
    if (lines[i] === "0" && lines[i + 1] === "SECTION") {
      // peek section name (group 2)
      if (lines[i + 2] === "2" && lines[i + 3] === "ENTITIES") {
        inEntities = true;
        i += 4;
        break;
      }
    }
    i += 2;
  }
  if (!inEntities) {
    warnings.push("DXF has no ENTITIES section.");
    return { format: "dxf", parserVersion: "1.0", entityCounts, candidates, warnings };
  }

  // Walk entities until ENDSEC.
  let candidateIndex = 0;
  while (i < lines.length - 1) {
    if (lines[i] === "0" && lines[i + 1] === "ENDSEC") break;
    if (lines[i] !== "0") {
      i += 2;
      continue;
    }
    const entType = lines[i + 1];
    entityCounts[entType] = (entityCounts[entType] || 0) + 1;
    i += 2;

    // Collect pairs until next "0" group.
    const props: Record<string, string[]> = {};
    while (i < lines.length - 1 && lines[i] !== "0") {
      const code = lines[i];
      const val = lines[i + 1];
      if (!props[code]) props[code] = [];
      props[code].push(val);
      i += 2;
    }
    const num = (code: string, idx = 0) => {
      const v = props[code]?.[idx];
      const n = v != null ? parseFloat(v) : NaN;
      return Number.isFinite(n) ? n : 0;
    };
    const handle = props["5"]?.[0];

    switch (entType) {
      case "CIRCLE": {
        const cx = num("10");
        const cy = num("20");
        const cz = num("30");
        const r = num("40");
        candidates.push({
          candidateIndex: candidateIndex++,
          shape: "circle",
          positionX: cx,
          positionY: cy,
          positionZ: cz,
          radius: r,
          geometry: { shape: "circle", x: cx, y: cy, radius: r },
          sourceEntityType: "DXF/CIRCLE",
          sourceEntityId: handle,
        });
        break;
      }
      case "LINE": {
        const x1 = num("10");
        const y1 = num("20");
        const x2 = num("11");
        const y2 = num("21");
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        candidates.push({
          candidateIndex: candidateIndex++,
          shape: "line",
          positionX: cx,
          positionY: cy,
          radius: Math.hypot(x2 - x1, y2 - y1) / 2,
          geometry: { shape: "line", x1, y1, x2, y2, thickness: 1 },
          sourceEntityType: "DXF/LINE",
          sourceEntityId: handle,
        });
        break;
      }
      case "LWPOLYLINE": {
        const xs = (props["10"] ?? []).map((v) => parseFloat(v));
        const ys = (props["20"] ?? []).map((v) => parseFloat(v));
        const pts: Array<{ x: number; y: number }> = [];
        for (let k = 0; k < Math.min(xs.length, ys.length); k++) {
          if (Number.isFinite(xs[k]) && Number.isFinite(ys[k])) pts.push({ x: xs[k], y: ys[k] });
        }
        if (pts.length >= 3) {
          const cx = pts.reduce((a, b) => a + b.x, 0) / pts.length;
          const cy = pts.reduce((a, b) => a + b.y, 0) / pts.length;
          let maxR = 0;
          for (const p of pts) maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
          candidates.push({
            candidateIndex: candidateIndex++,
            shape: "polygon",
            positionX: cx,
            positionY: cy,
            radius: maxR,
            geometry: { shape: "polygon", points: pts },
            sourceEntityType: "DXF/LWPOLYLINE",
            sourceEntityId: handle,
          });
        }
        break;
      }
      // Other entities (TEXT, INSERT, ARC, ELLIPSE, ...) only counted, not turned
      // into candidates in this minimal parser.
      default:
        break;
    }
  }

  return { format: "dxf", parserVersion: "1.0", entityCounts, candidates, warnings };
}

// ============================================================================
// STEP AP242 (ISO 10303-21) parser — minimal text scan.
// ============================================================================
export function parseStep(text: string): CadParseResult {
  const warnings: string[] = [];
  const entityCounts: Record<string, number> = {};
  const candidates: CadCandidate[] = [];

  if (!text.startsWith("ISO-10303-21")) {
    warnings.push("File does not start with ISO-10303-21 header — may not be a valid STEP file.");
  }

  // Extract DATA section.
  const dataStart = text.indexOf("DATA;");
  const endsec = text.indexOf("ENDSEC;", dataStart >= 0 ? dataStart : 0);
  const body = dataStart >= 0 && endsec > dataStart ? text.slice(dataStart + 5, endsec) : text;

  // Tally entity types: lines like "#123 = ENTITY_NAME(...);"
  // Capture id + entity type + first-arg payload (best-effort).
  const cartesian = new Map<string, [number, number, number?]>();
  const axisPlacements = new Map<string, string>(); // axis ref → CARTESIAN_POINT id
  const circleEntries: Array<{ id: string; refAxis: string; radius: number }> = [];

  // Split into logical statements (handles multi-line; STEP statements end with ';').
  const statements = body.split(";").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    // Lines may have whitespace and refs like #123, e.g. "#42 = CARTESIAN_POINT('',(0.0, 1.0, 2.0))"
    const m = stmt.match(/^#(\d+)\s*=\s*([A-Z_][A-Z0-9_]*)\s*\((.*)\)\s*$/i);
    if (!m) continue;
    const id = m[1];
    const ent = m[2].toUpperCase();
    const payload = m[3];
    entityCounts[ent] = (entityCounts[ent] || 0) + 1;

    if (ent === "CARTESIAN_POINT") {
      // payload like: '',(0.,1.,2.)
      const tup = payload.match(/\(\s*([-0-9.eE+]+)\s*,\s*([-0-9.eE+]+)(?:\s*,\s*([-0-9.eE+]+))?\s*\)/);
      if (tup) {
        cartesian.set("#" + id, [
          parseFloat(tup[1]),
          parseFloat(tup[2]),
          tup[3] ? parseFloat(tup[3]) : undefined,
        ]);
      }
    } else if (ent === "AXIS2_PLACEMENT_3D" || ent === "AXIS2_PLACEMENT_2D") {
      // payload like: '',#42,#43,#44
      const refs = payload.match(/#\d+/g) ?? [];
      if (refs.length >= 1) axisPlacements.set("#" + id, refs[0]!);
    } else if (ent === "CIRCLE") {
      // payload like: '',#10,5.0
      const refs = payload.match(/#\d+/g) ?? [];
      const numMatch = payload.match(/,\s*([-0-9.eE+]+)\s*$/);
      if (refs.length >= 1 && numMatch) {
        circleEntries.push({
          id: "#" + id,
          refAxis: refs[0]!,
          radius: parseFloat(numMatch[1]),
        });
      }
    }
  }

  let candidateIndex = 0;
  for (const c of circleEntries) {
    const ptRef = axisPlacements.get(c.refAxis);
    if (!ptRef) continue;
    const pt = cartesian.get(ptRef);
    if (!pt) continue;
    const [x, y, z] = pt;
    candidates.push({
      candidateIndex: candidateIndex++,
      shape: "circle",
      positionX: x,
      positionY: y,
      positionZ: z,
      radius: c.radius,
      geometry: { shape: "circle", x, y, radius: c.radius },
      sourceEntityType: "STEP/CIRCLE",
      sourceEntityId: c.id,
    });
  }

  if (candidates.length === 0 && Object.keys(entityCounts).length > 0) {
    warnings.push(
      "STEP entity tally produced no resolvable circle candidates; B-Rep geometry resolution is not supported in this minimal parser. User can manually add MPs from the entity list.",
    );
  }

  return { format: "step", parserVersion: "1.0", entityCounts, candidates, warnings };
}

// ============================================================================
// Gerber (RS-274X) parser — minimal flash/draw extraction.
//   • Apertures defined via `%ADDnn<shape>,params*%` (C=circle, R=rect,
//     O=obround, P=polygon).
//   • Coordinate format set via `%FSLAXn.mYn.m*%` (omit-leading-zero, absolute).
//   • Units set via `%MOMM*%` or `%MOIN*%`.
//   • Operations: `Dnn*` selects aperture; `X..Y..D01*` interpolate (line),
//     `D02*` move, `D03*` flash → emits a candidate at the flash location
//     using the currently-selected aperture's geometry.
// Anything else is counted but ignored.
// ============================================================================
export function parseGerber(text: string): CadParseResult {
  const warnings: string[] = [];
  const entityCounts: Record<string, number> = {};
  const candidates: CadCandidate[] = [];

  interface Aperture {
    shape: "circle" | "rect" | "polygon" | "line";
    radius?: number;
    width?: number;
    height?: number;
    sides?: number;
  }
  const apertures = new Map<number, Aperture>();

  // Coordinate format defaults: 2.4 absolute, omit-leading-zero.
  let xInt = 2;
  let xDec = 4;
  let yInt = 2;
  let yDec = 4;
  let unitsMm = true;
  let currentAperture: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let candidateIndex = 0;

  // Parse coordinate token like "X1234" / "Y56789" — leading-zero omitted, value scales by 10^-dec.
  const parseCoord = (raw: string, dec: number): number => {
    if (!raw) return 0;
    const neg = raw.startsWith("-");
    const digits = neg ? raw.slice(1) : raw;
    if (digits === "") return 0;
    const n = parseInt(digits, 10);
    if (Number.isNaN(n)) return 0;
    const v = n / Math.pow(10, dec);
    return neg ? -v : v;
  };

  // Split into commands by '*' (Gerber statement terminator), preserving '%...%' extended commands.
  const cleaned = text.replace(/\r?\n/g, "");
  const tokens: string[] = [];
  let buf = "";
  let inExt = false;
  for (const ch of cleaned) {
    if (ch === "%") {
      if (inExt) { tokens.push("%" + buf); buf = ""; inExt = false; }
      else { if (buf.trim()) tokens.push(buf); buf = ""; inExt = true; }
      continue;
    }
    if (ch === "*" && !inExt) {
      if (buf.trim()) tokens.push(buf);
      buf = "";
      continue;
    }
    if (ch === "*" && inExt) { tokens.push("%" + buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) tokens.push(buf);

  for (const tok of tokens) {
    const t = tok.trim();
    if (!t) continue;

    // Extended: %FSLAXnnYnn*%
    let m = t.match(/^%FS[LT]?[AI]X(\d)(\d)Y(\d)(\d)/);
    if (m) {
      xInt = parseInt(m[1], 10); xDec = parseInt(m[2], 10);
      yInt = parseInt(m[3], 10); yDec = parseInt(m[4], 10);
      entityCounts.FS = (entityCounts.FS || 0) + 1;
      continue;
    }
    // Units
    if (t.startsWith("%MOMM")) { unitsMm = true; entityCounts.MO = (entityCounts.MO || 0) + 1; continue; }
    if (t.startsWith("%MOIN")) { unitsMm = false; entityCounts.MO = (entityCounts.MO || 0) + 1; continue; }

    // Aperture definition: %ADDnnSHAPE,params*%
    m = t.match(/^%ADD(\d+)([CROP])(?:,([^%]+))?/);
    if (m) {
      const num = parseInt(m[1], 10);
      const shapeChar = m[2];
      const params = (m[3] || "").split("X").map((p) => parseFloat(p)).filter((n) => !Number.isNaN(n));
      let ap: Aperture;
      if (shapeChar === "C") {
        ap = { shape: "circle", radius: (params[0] ?? 0) / 2 };
      } else if (shapeChar === "R") {
        ap = { shape: "rect", width: params[0] ?? 0, height: params[1] ?? params[0] ?? 0 };
      } else if (shapeChar === "O") {
        ap = { shape: "rect", width: params[0] ?? 0, height: params[1] ?? params[0] ?? 0 };
      } else {
        // Polygon: outer-diameter, sides, [rotation]
        ap = { shape: "polygon", radius: (params[0] ?? 0) / 2, sides: Math.round(params[1] ?? 0) };
      }
      apertures.set(num, ap);
      entityCounts.AD = (entityCounts.AD || 0) + 1;
      continue;
    }

    // Skip other extended commands (%LP, %AM, %TF, etc.)
    if (t.startsWith("%")) { entityCounts.EXT = (entityCounts.EXT || 0) + 1; continue; }

    // Standard command — may include G, X, Y, I, J, D codes interleaved.
    const gMatch = t.match(/G(\d+)/);
    if (gMatch) entityCounts["G" + gMatch[1]] = (entityCounts["G" + gMatch[1]] || 0) + 1;

    const dMatch = t.match(/D(\d+)\s*$/);
    const xMatch = t.match(/X(-?\d+)/);
    const yMatch = t.match(/Y(-?\d+)/);
    if (xMatch) lastX = parseCoord(xMatch[1], xDec);
    if (yMatch) lastY = parseCoord(yMatch[1], yDec);

    if (!dMatch) continue;
    const dCode = parseInt(dMatch[1], 10);
    if (dCode >= 10) {
      // Aperture select.
      currentAperture = dCode;
      entityCounts.DSEL = (entityCounts.DSEL || 0) + 1;
      continue;
    }
    entityCounts["D0" + dCode] = (entityCounts["D0" + dCode] || 0) + 1;
    if (dCode === 3 && currentAperture != null) {
      // Flash → emit candidate.
      const ap = apertures.get(currentAperture);
      if (!ap) {
        warnings.push(`Flash references undefined aperture D${currentAperture}.`);
        continue;
      }
      // Convert to mm for downstream consistency.
      const scale = unitsMm ? 1 : 25.4;
      candidates.push({
        candidateIndex: candidateIndex++,
        shape: ap.shape,
        positionX: lastX * scale,
        positionY: lastY * scale,
        radius: ap.radius != null ? ap.radius * scale : undefined,
        geometry: {
          width: ap.width != null ? ap.width * scale : undefined,
          height: ap.height != null ? ap.height * scale : undefined,
          sides: ap.sides,
          aperture: currentAperture,
        },
        sourceEntityType: "FLASH",
        sourceEntityId: `D${currentAperture}@${candidateIndex}`,
      });
    }
  }

  if (candidates.length === 0) {
    warnings.push("Gerber parsed but no flashes (D03) found — only line/arc draws? No MP candidates emitted.");
  }
  if (xInt + xDec === 0 || yInt + yDec === 0) {
    warnings.push("Gerber missing %FS coordinate format — assuming 2.4 absolute.");
  }

  return { format: "gerber", parserVersion: "1.0", entityCounts, candidates, warnings };
}

/** Auto-detect by suffix or first chars. */
export function parseCad(filename: string, text: string): CadParseResult {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dxf")) return parseDxf(text);
  if (lower.endsWith(".step") || lower.endsWith(".stp") || lower.endsWith(".p21")) {
    return parseStep(text);
  }
  if (lower.endsWith(".gbr") || lower.endsWith(".ger") || lower.endsWith(".gerber")
      || lower.endsWith(".gtl") || lower.endsWith(".gbl") || lower.endsWith(".gto")
      || lower.endsWith(".gbo") || lower.endsWith(".gts") || lower.endsWith(".gbs")) {
    return parseGerber(text);
  }
  // Sniff
  const trimmed = text.trimStart();
  if (trimmed.startsWith("ISO-10303-21")) return parseStep(text);
  if (trimmed.startsWith("%FS") || trimmed.startsWith("G04") || trimmed.match(/^%(FS|MO|AD)/)) {
    return parseGerber(text);
  }
  return parseDxf(text);
}
