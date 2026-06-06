/**
 * P4.A G11 — Seed defect_catalog with IPC-A-610 Class 2/3 standard codes.
 *
 * Idempotent: uses ON CONFLICT (code) DO UPDATE so re-running refreshes
 * names/descriptions/IPC refs without duplicating rows.
 *
 * Coverage: representative defects across the major IPC-A-610 sections that
 * apply to mixed SMT / THT / mechanical / cosmetic AVI lines. Not exhaustive
 * (the standard has hundreds of items) — focuses on the defects most often
 * called by AOI / AVI / AXI / SPI / FCT inspection in EMS production.
 *
 * Run:   node seed-defect-catalog.mjs
 */
import "dotenv/config";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db";
const sql = postgres(DATABASE_URL, { ssl: false, max: 1 });

// Catalog rows. acceptanceClass uses the *strictest* class the defect is
// flagged on ("2" → flagged for Class 2 and 3; "3" → flagged for Class 3
// only). Severity: critical | major | minor | cosmetic.
//
// `classRules` (NEW): per-IPC-class effective verdict for Class 2 (general
// electronics) vs Class 3 (high-reliability — automotive / aerospace /
// medical). Shape:
//   { class2: { accept, severity?, limit?, notes? },
//     class3: { accept, severity?, limit?, notes? } }
// `accept` ∈ 'accept' | 'process' | 'reject'. When omitted, callers fall
// back to `acceptanceClass`.
const ROWS = [
  // ---- IPC-A-610 §5: Soldering ----
  { code: "INSUFFICIENT_SOLDER", name: "Insufficient solder", severity: "major", category: "solder",
    ipcReference: "5.2.3", ipcSection: "5", acceptanceClass: "2",
    appliesTo: ["SMT","THT"], detectableBy: ["AOI","AXI","AVI","SPI"],
    description: "Solder fillet does not meet minimum wetting / fill requirements per IPC-A-610.",
    nameVi: "Thiếu thiếc", descriptionVi: "Mối hàn không đạt mức ngấm / điền đầy tối thiểu theo IPC-A-610." },
  { code: "EXCESS_SOLDER", name: "Excess solder", severity: "minor", category: "solder",
    ipcReference: "5.2.4", ipcSection: "5", acceptanceClass: "3",
    appliesTo: ["SMT","THT"], detectableBy: ["AOI","AXI","AVI"],
    description: "Solder volume exceeds maximum fillet / pad envelope, may obscure inspection or violate clearances.",
    nameVi: "Dư thiếc" },
  { code: "SOLDER_BRIDGE", name: "Solder bridge / short", severity: "critical", category: "solder",
    ipcReference: "5.2.5", ipcSection: "5", acceptanceClass: "2",
    appliesTo: ["SMT","THT","BGA","QFN"], detectableBy: ["AOI","AXI","AVI","ICT"],
    description: "Unwanted solder connection between two adjacent conductive features that should be electrically isolated.",
    nameVi: "Cầu hàn / chập" },
  { code: "COLD_SOLDER", name: "Cold / disturbed solder joint", severity: "major", category: "solder",
    ipcReference: "5.2.6", ipcSection: "5", acceptanceClass: "2",
    appliesTo: ["SMT","THT"], detectableBy: ["AOI","AVI","AXI"],
    description: "Joint with grainy / dull surface or fractured appearance from insufficient heat or movement during solidification.",
    nameVi: "Mối hàn nguội" },
  { code: "SOLDER_BALL", name: "Solder ball", severity: "minor", category: "solder",
    ipcReference: "5.2.7", ipcSection: "5", acceptanceClass: "2",
    appliesTo: ["SMT"], detectableBy: ["AOI","AVI"],
    description: "Free / loose solder spheres on the assembly that may migrate and cause shorts.",
    nameVi: "Bi thiếc" },
  { code: "SOLDER_VOID", name: "Solder void (BGA / QFN)", severity: "major", category: "solder",
    ipcReference: "5.2.8", ipcSection: "5", acceptanceClass: "2",
    appliesTo: ["BGA","QFN","LGA"], detectableBy: ["AXI"],
    description: "Internal cavity within a solder joint exceeding the area-percent limit (typically >25% Class 2, >9% Class 3 thermal pads).",
    nameVi: "Lỗ rỗng trong mối hàn" },
  { code: "NON_WETTING", name: "Non-wetting", severity: "major", category: "solder",
    ipcReference: "5.2.9", ipcSection: "5", acceptanceClass: "2",
    appliesTo: ["SMT","THT"], detectableBy: ["AOI","AVI"],
    description: "Solder did not wet to a metallic surface; original surface remains visible.",
    nameVi: "Không ngấm thiếc" },
  { code: "DEWETTING", name: "Dewetting", severity: "major", category: "solder",
    ipcReference: "5.2.10", ipcSection: "5", acceptanceClass: "2",
    appliesTo: ["SMT","THT"], detectableBy: ["AOI","AVI"],
    description: "Solder initially wet then receded, leaving irregular mounds and exposed base metal.",
    nameVi: "Thiếc co rút" },
  { code: "EXPOSED_BASE_METAL", name: "Exposed base metal", severity: "minor", category: "solder",
    ipcReference: "5.3.4", ipcSection: "5", acceptanceClass: "3",
    appliesTo: ["SMT","THT","PCB"], detectableBy: ["AOI","AVI"],
    description: "Conductor base metal visible where coating / solder is required by design.",
    nameVi: "Lộ kim loại nền" },
  { code: "FLUX_RESIDUE", name: "Flux residue", severity: "cosmetic", category: "solder",
    ipcReference: "10.6.3", ipcSection: "10", acceptanceClass: "3",
    appliesTo: ["SMT","THT","ASSEMBLY"], detectableBy: ["AOI","AVI"],
    description: "Visible flux residue beyond cleanliness limits; acceptable for no-clean within visual limits.",
    nameVi: "Cặn nhựa thông" },

  // ---- IPC-A-610 §8: Component placement (SMT) ----
  { code: "TOMBSTONING", name: "Tombstoning", severity: "critical", category: "component",
    ipcReference: "8.3.5.1", ipcSection: "8", acceptanceClass: "2",
    appliesTo: ["SMT"], detectableBy: ["AOI","AVI"],
    description: "Chip component lifted vertically off one pad, often due to uneven reflow heating.",
    nameVi: "Linh kiện dựng đứng (tombstone)" },
  { code: "BILLBOARDING", name: "Billboarding", severity: "major", category: "component",
    ipcReference: "8.3.5.2", ipcSection: "8", acceptanceClass: "2",
    appliesTo: ["SMT"], detectableBy: ["AOI","AVI"],
    description: "Chip component standing on its side rather than seated flat.",
    nameVi: "Linh kiện nằm nghiêng" },
  { code: "MISALIGNMENT", name: "Component misalignment / offset", severity: "major", category: "component",
    ipcReference: "8.3.2", ipcSection: "8", acceptanceClass: "2",
    appliesTo: ["SMT","BGA","QFN"], detectableBy: ["AOI","AVI","AXI"],
    description: "Component offset from pad exceeds the side-overhang or end-overhang limit for the class.",
    nameVi: "Linh kiện lệch vị trí" },
  { code: "MISSING_COMPONENT", name: "Missing component", severity: "critical", category: "component",
    ipcReference: "8.1", ipcSection: "8", acceptanceClass: "2",
    appliesTo: ["SMT","THT"], detectableBy: ["AOI","AVI"],
    description: "Component absent from designated location per BOM / design.",
    nameVi: "Thiếu linh kiện" },
  { code: "WRONG_COMPONENT", name: "Wrong component", severity: "critical", category: "component",
    ipcReference: "8.1", ipcSection: "8", acceptanceClass: "2",
    appliesTo: ["SMT","THT"], detectableBy: ["AOI","AVI","ICT"],
    description: "Component value / part number does not match BOM.",
    nameVi: "Sai linh kiện" },
  { code: "REVERSED_POLARITY", name: "Reversed polarity", severity: "critical", category: "component",
    ipcReference: "8.1.7", ipcSection: "8", acceptanceClass: "2",
    appliesTo: ["SMT","THT"], detectableBy: ["AOI","AVI","ICT"],
    description: "Polarised component (diode, electrolytic cap, IC) installed in opposite orientation.",
    nameVi: "Sai cực tính" },
  { code: "LIFTED_LEAD", name: "Lifted lead", severity: "critical", category: "component",
    ipcReference: "8.3.10", ipcSection: "8", acceptanceClass: "2",
    appliesTo: ["SMT","THT","QFP","SOIC"], detectableBy: ["AOI","AVI","AXI"],
    description: "Component lead not in contact with pad / solder fillet.",
    nameVi: "Chân linh kiện bị nâng" },
  { code: "BENT_LEAD", name: "Bent / damaged lead", severity: "major", category: "component",
    ipcReference: "8.3.10.4", ipcSection: "8", acceptanceClass: "2",
    appliesTo: ["SMT","THT","QFP"], detectableBy: ["AOI","AVI"],
    description: "Lead deformation beyond formed-lead tolerance, may impair coplanarity.",
    nameVi: "Chân linh kiện cong" },

  // ---- IPC-A-610 §9: Through-hole ----
  { code: "INSUFFICIENT_HOLE_FILL", name: "Insufficient hole fill (THT)", severity: "major", category: "solder",
    ipcReference: "9.3.2", ipcSection: "9", acceptanceClass: "2",
    appliesTo: ["THT"], detectableBy: ["AVI","AXI"],
    description: "Vertical solder fill in plated through-hole below 75% (Class 2) or 100% (Class 3).",
    nameVi: "Thiếu thiếc lỗ xuyên" },
  { code: "PIN_PROTRUSION_INSUFFICIENT", name: "Insufficient pin protrusion", severity: "minor", category: "component",
    ipcReference: "9.3.5", ipcSection: "9", acceptanceClass: "2",
    appliesTo: ["THT"], detectableBy: ["AVI"],
    description: "Lead does not protrude sufficiently beyond solder side of board.",
    nameVi: "Chân chưa ló đủ" },

  // ---- IPC-A-610 §10: Cleanliness & marking ----
  { code: "CONTAMINATION_PARTICULATE", name: "Particulate contamination", severity: "minor", category: "cleanliness",
    ipcReference: "10.6.2", ipcSection: "10", acceptanceClass: "3",
    appliesTo: ["ASSEMBLY"], detectableBy: ["AVI"],
    description: "Loose particles, FOD or debris on assembly surface.",
    nameVi: "Bụi / dị vật" },
  { code: "MARKING_ILLEGIBLE", name: "Illegible marking / label", severity: "minor", category: "marking",
    ipcReference: "10.5.1", ipcSection: "10", acceptanceClass: "2",
    appliesTo: ["MARK","LABEL"], detectableBy: ["AVI","OCR"],
    description: "Required marking unreadable due to smear, low contrast or print defect.",
    nameVi: "Nhãn / mã không đọc được" },
  { code: "BARCODE_UNREADABLE", name: "Barcode / 2D-DMC unreadable", severity: "major", category: "marking",
    ipcReference: "10.5.1", ipcSection: "10", acceptanceClass: "2",
    appliesTo: ["MARK","LABEL"], detectableBy: ["AVI","OCR"],
    description: "Machine-readable code fails decode at required quality grade (typically ISO/IEC 15415 grade C minimum).",
    nameVi: "Mã vạch / DMC không quét được" },

  // ---- IPC-A-610 §10/11: PCB defects ----
  { code: "PCB_SCRATCH", name: "PCB surface scratch", severity: "cosmetic", category: "pcb",
    ipcReference: "10.2.4", ipcSection: "10", acceptanceClass: "3",
    appliesTo: ["PCB"], detectableBy: ["AVI"],
    description: "Surface scratch on PCB substrate or solder mask not exposing copper.",
    nameVi: "Trầy xước PCB" },
  { code: "SOLDERMASK_DAMAGE", name: "Solder mask damage", severity: "minor", category: "pcb",
    ipcReference: "10.3.3", ipcSection: "10", acceptanceClass: "2",
    appliesTo: ["PCB"], detectableBy: ["AVI"],
    description: "Lifted, missing or cracked solder mask exposing conductor.",
    nameVi: "Hỏng lớp phủ hàn" },
  { code: "LAMINATE_DAMAGE", name: "Laminate damage / measling", severity: "major", category: "pcb",
    ipcReference: "10.2.5", ipcSection: "10", acceptanceClass: "2",
    appliesTo: ["PCB"], detectableBy: ["AVI"],
    description: "Internal separation / white spots in PCB laminate (measling, crazing, blistering).",
    nameVi: "Hỏng lớp nền PCB" },

  // ---- §12 Discrete wiring ----
  { code: "DAMAGED_INSULATION", name: "Damaged wire insulation", severity: "major", category: "wiring",
    ipcReference: "12.1.1", ipcSection: "12", acceptanceClass: "2",
    appliesTo: ["WIRING"], detectableBy: ["AVI"],
    description: "Cut, burn or abrasion in wire insulation exposing conductor.",
    nameVi: "Hỏng lớp cách điện dây" },

  // ---- Mechanical / housing (post-CNC, post-assembly) ----
  { code: "EDGE_BURR", name: "Edge burr (machined housing)", severity: "minor", category: "mechanical",
    ipcReference: null, ipcSection: "MECH", acceptanceClass: "3",
    appliesTo: ["MECH","HOUSING"], detectableBy: ["AVI","CMM"],
    description: "Sharp burr along machined edge exceeding max allowed height.",
    nameVi: "Bavia mép gia công" },
  { code: "CHIP_OUT", name: "Chip-out / edge break", severity: "major", category: "mechanical",
    ipcReference: null, ipcSection: "MECH", acceptanceClass: "2",
    appliesTo: ["MECH","HOUSING"], detectableBy: ["AVI","CMM"],
    description: "Material chipped from edge or corner, breaking the design profile.",
    nameVi: "Sứt mép" },
  { code: "DENT", name: "Dent / deformation", severity: "major", category: "mechanical",
    ipcReference: null, ipcSection: "MECH", acceptanceClass: "2",
    appliesTo: ["MECH","HOUSING"], detectableBy: ["AVI","CMM"],
    description: "Localised inward deformation beyond cosmetic / functional limit.",
    nameVi: "Móp / lõm" },

  // ---- Cosmetic ----
  { code: "COSMETIC_SCRATCH", name: "Cosmetic surface scratch", severity: "cosmetic", category: "cosmetic",
    ipcReference: null, ipcSection: "COSM", acceptanceClass: "3",
    appliesTo: ["COSMETIC","HOUSING"], detectableBy: ["AVI"],
    description: "Surface scratch on visible cosmetic area exceeding zone (A/B/C) length / width spec.",
    nameVi: "Trầy xước bề mặt" },
  { code: "COLOR_MISMATCH", name: "Color / gloss mismatch", severity: "minor", category: "cosmetic",
    ipcReference: null, ipcSection: "COSM", acceptanceClass: "3",
    appliesTo: ["COSMETIC","HOUSING"], detectableBy: ["AVI","SPECTRO","GLOSS"],
    description: "Color difference (ΔE) or gloss (GU) outside the master swatch tolerance.",
    nameVi: "Lệch màu / độ bóng" },
  { code: "CONTAMINATION_FINGERPRINT", name: "Fingerprint / smudge", severity: "cosmetic", category: "cosmetic",
    ipcReference: null, ipcSection: "COSM", acceptanceClass: "3",
    appliesTo: ["COSMETIC"], detectableBy: ["AVI"],
    description: "Oils / fingerprint smudge on cosmetic A-surface.",
    nameVi: "Vết tay / vết bẩn" },
];

// ----------------------------------------------------------------------
// Per-IPC-class explicit overrides keyed by `code`. Class 2 = general
// electronics; Class 3 = high-reliability (automotive / aerospace /
// medical). Codes NOT listed here fall back to a default rule synthesised
// from `acceptanceClass` + `severity` (see `defaultClassRulesFor` below).
// Rule shape: { accept: 'accept'|'process'|'reject', severity?, limit?, notes? }
// ----------------------------------------------------------------------
const CLASS_RULE_OVERRIDES = {
  // ---- Soldering (§5) ----
  INSUFFICIENT_SOLDER: {
    class2: { accept: "process", severity: "major",
      limit: "Wetting & fillet >= 75% of pad/lead length",
      notes: "Touch-up allowed if rework count within process window." },
    class3: { accept: "reject", severity: "major",
      limit: "Wetting & fillet >= 100% of pad/lead length",
      notes: "Class 3 requires full fillet — partial fill not acceptable." },
  },
  EXCESS_SOLDER: {
    class2: { accept: "accept", severity: "minor",
      limit: "May exceed pad if no clearance / inspection violation" },
    class3: { accept: "process", severity: "minor",
      limit: "Must not violate min electrical clearance or obscure inspection" },
  },
  SOLDER_BRIDGE: {
    class2: { accept: "reject", severity: "critical",
      limit: "Any unintended electrical connection" },
    class3: { accept: "reject", severity: "critical",
      limit: "Any unintended electrical connection (rework with full re-inspection)" },
  },
  COLD_SOLDER: {
    class2: { accept: "process", severity: "major",
      notes: "Re-flow / re-touch acceptable" },
    class3: { accept: "reject", severity: "critical",
      notes: "Indicative of process drift; quarantine and root-cause required" },
  },
  SOLDER_BALL: {
    class2: { accept: "accept", severity: "minor",
      limit: "<= 0.13 mm and entrapped (no migration risk)" },
    class3: { accept: "process", severity: "minor",
      limit: "Must be entrapped under conformal coat or removed" },
  },
  SOLDER_VOID: {
    class2: { accept: "process", severity: "major",
      limit: "BGA <= 25% area; thermal pad <= 50% area",
      notes: "X-ray voiding limit per IPC-7095 / IPC-A-610 8.3.12.x." },
    class3: { accept: "reject", severity: "major",
      limit: "BGA <= 9%; thermal pad <= 25%; no single void > 6%",
      notes: "Stricter limits for thermal cycling endurance." },
  },
  NON_WETTING: {
    class2: { accept: "reject", severity: "major" },
    class3: { accept: "reject", severity: "critical" },
  },
  DEWETTING: {
    class2: { accept: "reject", severity: "major" },
    class3: { accept: "reject", severity: "critical" },
  },
  EXPOSED_BASE_METAL: {
    class2: { accept: "accept", severity: "minor",
      limit: "Allowed on vertical edges of leads, end of cut leads, fillet meniscus" },
    class3: { accept: "process", severity: "minor",
      limit: "Allowed only on vertical lead cut ends; not on conductor surfaces" },
  },
  FLUX_RESIDUE: {
    class2: { accept: "accept", severity: "cosmetic",
      notes: "No-clean process: visual residue acceptable" },
    class3: { accept: "process", severity: "minor",
      notes: "Residue must be characterised (ROSE / ion chromatography); cleanliness ≤1.56 µg NaCl/cm²" },
  },

  // ---- Component placement (§8) ----
  TOMBSTONING: {
    class2: { accept: "reject", severity: "critical" },
    class3: { accept: "reject", severity: "critical",
      notes: "Open joint — not acceptable any class" },
  },
  BILLBOARDING: {
    class2: { accept: "process", severity: "major",
      notes: "Acceptable if both terminations meet min wetting" },
    class3: { accept: "reject", severity: "major",
      notes: "Side-mounted chip not allowed for high-reliability" },
  },
  MISALIGNMENT: {
    class2: { accept: "process", severity: "major",
      limit: "Side overhang <= 50% of pad/lead width" },
    class3: { accept: "reject", severity: "major",
      limit: "Side overhang <= 25% of pad/lead width" },
  },
  MISSING_COMPONENT: {
    class2: { accept: "reject", severity: "critical" },
    class3: { accept: "reject", severity: "critical" },
  },
  WRONG_COMPONENT: {
    class2: { accept: "reject", severity: "critical" },
    class3: { accept: "reject", severity: "critical" },
  },
  REVERSED_POLARITY: {
    class2: { accept: "reject", severity: "critical" },
    class3: { accept: "reject", severity: "critical" },
  },
  LIFTED_LEAD: {
    class2: { accept: "reject", severity: "major",
      limit: "Lead must contact pad under solder" },
    class3: { accept: "reject", severity: "critical" },
  },
  BENT_LEAD: {
    class2: { accept: "process", severity: "minor",
      limit: "Coplanarity within 100 µm" },
    class3: { accept: "reject", severity: "major",
      limit: "Coplanarity within 50 µm; no field-bent leads on critical assemblies" },
  },

  // ---- Through-hole (§9) ----
  INSUFFICIENT_HOLE_FILL: {
    class2: { accept: "process", severity: "major",
      limit: "Vertical fill >= 75% of barrel" },
    class3: { accept: "reject", severity: "major",
      limit: "Vertical fill >= 100% of barrel; no exceptions for thermally-massive nets without DFM waiver" },
  },
  PIN_PROTRUSION_INSUFFICIENT: {
    class2: { accept: "accept", severity: "minor",
      limit: "Lead end at least flush with solder destination" },
    class3: { accept: "process", severity: "minor",
      limit: "Lead must protrude with discernible solder fillet" },
  },

  // ---- Cleanliness & marking (§10) ----
  CONTAMINATION_PARTICULATE: {
    class2: { accept: "accept", severity: "cosmetic",
      notes: "Removable particulate acceptable post-clean" },
    class3: { accept: "process", severity: "minor",
      notes: "FOD program required; ionic cleanliness verified" },
  },
  MARKING_ILLEGIBLE: {
    class2: { accept: "process", severity: "minor" },
    class3: { accept: "reject", severity: "major",
      notes: "Traceability marking must be readable for full assembly life" },
  },
  BARCODE_UNREADABLE: {
    class2: { accept: "reject", severity: "major",
      limit: "Decode at ISO/IEC 15415 grade C or better" },
    class3: { accept: "reject", severity: "major",
      limit: "Decode at ISO/IEC 15415 grade B or better" },
  },

  // ---- PCB (§10/11) ----
  PCB_SCRATCH: {
    class2: { accept: "accept", severity: "cosmetic",
      limit: "Not exposing copper" },
    class3: { accept: "process", severity: "minor",
      limit: "Must not reduce dielectric thickness below spec" },
  },
  SOLDERMASK_DAMAGE: {
    class2: { accept: "process", severity: "minor",
      limit: "Exposure < 25% conductor width" },
    class3: { accept: "reject", severity: "major",
      limit: "No exposed conductor between adjacent nets" },
  },
  LAMINATE_DAMAGE: {
    class2: { accept: "process", severity: "major",
      limit: "Measling/crazing must not bridge 50% conductor spacing" },
    class3: { accept: "reject", severity: "critical",
      limit: "Any blistering / delamination not acceptable" },
  },

  // ---- Discrete wiring (§12) ----
  DAMAGED_INSULATION: {
    class2: { accept: "process", severity: "major" },
    class3: { accept: "reject", severity: "critical" },
  },

  // ---- Mechanical / housing ----
  EDGE_BURR: {
    class2: { accept: "accept", severity: "minor",
      limit: "Burr height <= 0.2 mm" },
    class3: { accept: "process", severity: "minor",
      limit: "Burr height <= 0.05 mm; deburr required on safety surfaces" },
  },
  CHIP_OUT: {
    class2: { accept: "process", severity: "major",
      limit: "Chip <= 1 mm in any direction, not in functional area" },
    class3: { accept: "reject", severity: "major" },
  },
  DENT: {
    class2: { accept: "process", severity: "major",
      limit: "Depth <= 0.3 mm in non-A surface" },
    class3: { accept: "reject", severity: "major",
      limit: "Any structural dent — reject" },
  },

  // ---- Cosmetic ----
  COSMETIC_SCRATCH: {
    class2: { accept: "accept", severity: "cosmetic",
      limit: "Per cosmetic-zone (A/B/C) length & count limits" },
    class3: { accept: "accept", severity: "cosmetic",
      limit: "Cosmetic acceptance follows product cosmetic spec, not IPC-A-610" },
  },
  COLOR_MISMATCH: {
    class2: { accept: "process", severity: "minor",
      limit: "ΔE2000 <= 1.5 vs master swatch" },
    class3: { accept: "process", severity: "minor",
      limit: "ΔE2000 <= 1.0 vs master swatch (medical / safety branding)" },
  },
  CONTAMINATION_FINGERPRINT: {
    class2: { accept: "accept", severity: "cosmetic",
      notes: "Wipe-clean acceptable" },
    class3: { accept: "process", severity: "cosmetic",
      notes: "Must be cleaned before final pack" },
  },
};

/**
 * Synthesise a default per-class rule when no explicit override exists.
 * Mirrors legacy semantics of `acceptanceClass`:
 *   - flagged at requested class or stricter → 'reject'
 *   - otherwise                              → 'accept'
 */
function defaultClassRulesFor(row) {
  const flag = (target) => {
    const a = parseInt(row.acceptanceClass ?? "", 10);
    return Number.isFinite(a) ? target >= a : true;
  };
  return {
    class2: {
      accept: flag(2) ? "reject" : "accept",
      severity: row.severity,
    },
    class3: {
      accept: flag(3) ? "reject" : "accept",
      severity: row.severity,
    },
  };
}

function classRulesFor(row) {
  const override = CLASS_RULE_OVERRIDES[row.code];
  if (!override) return defaultClassRulesFor(row);
  // Merge: explicit overrides win, missing class falls back to default.
  const def = defaultClassRulesFor(row);
  return {
    class2: override.class2 ?? def.class2,
    class3: override.class3 ?? def.class3,
  };
}

const upsertSql = `
INSERT INTO defect_catalog
  (code, name, severity, category, "ipcReference", "acceptanceClass", "ipcSection",
   "appliesTo", "detectableBy", description, "nameVi", "descriptionVi",
   "classRules",
   "isActive", "createdAt", "updatedAt")
VALUES
  ($1, $2, $3, $4, $5, $6, $7,
   $8, $9, $10, $11, $12,
   $13::jsonb,
   true, NOW(), NOW())
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  severity = EXCLUDED.severity,
  category = EXCLUDED.category,
  "ipcReference" = EXCLUDED."ipcReference",
  "acceptanceClass" = EXCLUDED."acceptanceClass",
  "ipcSection" = EXCLUDED."ipcSection",
  "appliesTo" = EXCLUDED."appliesTo",
  "detectableBy" = EXCLUDED."detectableBy",
  description = EXCLUDED.description,
  "nameVi" = COALESCE(EXCLUDED."nameVi", defect_catalog."nameVi"),
  "descriptionVi" = COALESCE(EXCLUDED."descriptionVi", defect_catalog."descriptionVi"),
  "classRules" = EXCLUDED."classRules",
  "updatedAt" = NOW()
`;

let inserted = 0;
let updated = 0;
try {
  for (const r of ROWS) {
    const existing = await sql`SELECT id FROM defect_catalog WHERE code = ${r.code} LIMIT 1`;
    const isNew = existing.length === 0;
    const rules = classRulesFor(r);
    await sql.unsafe(upsertSql, [
      r.code, r.name, r.severity, r.category,
      r.ipcReference ?? null, r.acceptanceClass ?? null, r.ipcSection ?? null,
      r.appliesTo ?? null, r.detectableBy ?? null,
      r.description ?? null, r.nameVi ?? null, r.descriptionVi ?? null,
      JSON.stringify(rules),
    ]);
    if (isNew) inserted++; else updated++;
  }
  console.log(`Defect catalog seed complete: ${inserted} inserted, ${updated} updated, total ${ROWS.length}.`);
  const explicit = Object.keys(CLASS_RULE_OVERRIDES).length;
  console.log(`Per-class rules: ${explicit} explicit IPC Class 2/3 overrides + ${ROWS.length - explicit} synthesised defaults.`);
} catch (e) {
  console.error("Seed error:", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
