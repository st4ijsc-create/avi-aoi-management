/**
 * Doc 34 · P4 (improvement 1b) — GBNF JSON SCHEMAS for the STRUCTURED-JSON program kinds.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY: the codegen eval measured ir-flow 0/3 and iec61131-pou 0/3 validPass — the failures
 * were PURELY STRUCTURAL, never semantic:
 *   • iec61131-pou — the LLM emits a SINGLE pou object `{name, pouType, vars, body, …}` but the
 *     model needs a top-level `{ pous: [ … ] }` wrapper → the adapter reports
 *     "POU shape error at 'pous': expected array, received undefined".
 *   • ir-flow — the LLM emits valid JSON then TRAILING prose → parseFlowJson reports
 *     "Invalid JSON: Unexpected non-whitespace character after JSON at position N".
 *
 * Feeding these schemas to aiGgufEngine.generateJSON() (a node-llama-cpp GBNF grammar) fixes
 * BOTH mechanically: the grammar FORCES the array wrapper + the discriminator key and STOPS at
 * the object's closing brace, so no trailing text is even representable.
 *
 * DESIGN — node-llama-cpp 3.19 `GbnfJsonSchema` semantics (verified against its dist types):
 *   • `additionalProperties: true` ⇒ arbitrary extra keys of ANY JSON value are allowed after
 *     the declared ones (see node_modules/node-llama-cpp/.../GbnfObjectMap.js). So the model can
 *     STILL express every block-/body-specific field it already emits correctly (target_pose,
 *     speed_mms, networks, text, …). We therefore REQUIRE only the load-bearing structure that
 *     was FAILING — the array wrapper + the `type`/`language` discriminator + id/name — and leave
 *     the deep/variant bodies free-form. (node-llama-cpp defaults additionalProperties to `false`,
 *     so it MUST be set to `true` explicitly on every object that carries variant fields.)
 *   • EVERY key listed in `properties` is treated as REQUIRED — node-llama-cpp's `required` key
 *     is a documented no-op (dist/utils/gbnfJson/types.d.ts). So here `properties` == "must emit";
 *     only strictly-required (or harmless-to-force) fields are listed, everything optional flows
 *     through `additionalProperties`.
 *
 * Each schema MIRRORS the real zod source (field names copied VERBATIM — a wrong name would just
 * move the error to a different field):
 *   • ir-flow      → server/services/programming/ir/irModel.ts
 *                    flowSchema (~L381): required flow_id, target_device_type, blocks
 *                    irBlockSchema union (~L262): each block's `type` literal discriminator.
 *   • iec61131-pou → server/services/programming/iec61131/pouModel.ts
 *                    pouProjectSchema (~L252): required `pous` array wrapper (+ name)
 *                    pouSchema (~L240): required name, pouType, vars, body
 *                    pouBodySchema (~L227): `language` discriminator (LD/FBD/SFC/ST).
 *
 * PURE DATA — no imports, no side-effects. Consumed only by aiProgrammingCopilot.generateProgram().
 * ════════════════════════════════════════════════════════════════════════════
 */

/** A plain (non-zod) JSON Schema object as accepted by aiGgufEngine.generateJSON(). */
export type CodegenJsonSchema = Record<string, unknown>;

// irModel.ts irBlockSchema union (L262-281) — every block's `type` literal, in source order.
const IR_BLOCK_TYPES = [
  "move_linear",
  "move_joint",
  "grip",
  "release",
  "set_output",
  "wait",
  "if_condition",
  "loop",
  "set_variable",
  "counter",
  "wait_until",
  "set_analog",
  "pid_control",
  "call_block",
] as const;

// irModel.ts targetDeviceTypeSchema (L378).
const IR_TARGET_DEVICE_TYPES = ["universal-robots", "ros2", "generic"] as const;

/**
 * ir-flow → mirrors irModel.flowSchema. REQUIRED (load-bearing): `flow_id`, `target_device_type`
 * (enum), and the `blocks` array WRAPPER. Each block REQUIRES its `type` discriminator + an `id`
 * handle; the block-specific fields (target_pose/speed_mms/joints/signal/…) flow through
 * `additionalProperties` so the model reproduces the (already-correct) block bodies. Top-level
 * `additionalProperties: true` lets the optional version/author/linked_capability/function_blocks
 * keys through unchanged.
 */
const IR_FLOW_JSON_SCHEMA: CodegenJsonSchema = {
  type: "object",
  properties: {
    flow_id: { type: "string" },
    target_device_type: { enum: [...IR_TARGET_DEVICE_TYPES] },
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { enum: [...IR_BLOCK_TYPES] },
          id: { type: "string" },
        },
        // block-specific fields (target_pose, speed_mms, signal, true_branch, body, …)
        additionalProperties: true,
      },
    },
  },
  // version (default 1), author, linked_capability, function_blocks — all optional.
  additionalProperties: true,
};

// pouModel.ts iecTypeSchema (L31-39) — the elementary data types a variable may declare.
const IEC_TYPES = [
  "BOOL",
  "BYTE", "WORD", "DWORD", "LWORD",
  "SINT", "INT", "DINT", "LINT",
  "USINT", "UINT", "UDINT", "ULINT",
  "REAL", "LREAL",
  "TIME", "DATE", "TOD", "DT",
  "STRING", "WSTRING",
] as const;

// pouModel.ts pouTypeSchema (L237) + pouBodySchema discriminator (L227-232).
const POU_TYPES = ["program", "functionBlock", "function"] as const;
const POU_BODY_LANGUAGES = ["LD", "FBD", "SFC", "ST"] as const;

/**
 * iec61131-pou → mirrors pouModel.pouProjectSchema. THE FIX: REQUIRE the top-level `pous` array
 * WRAPPER (+ project `name`). Each POU REQUIRES `name`, `pouType` (enum), `vars` (array) and
 * `body`; the body REQUIRES its `language` discriminator (LD/FBD/SFC/ST). The body-specific
 * fields (networks / steps / transitions / text) and each var's section/initial/address/comment
 * flow through `additionalProperties`, so the model reproduces the (already-correct) POU content
 * inside the now-mandatory wrapper. Top-level `additionalProperties: true` lets `fileHeader` through.
 */
const POU_PROJECT_JSON_SCHEMA: CodegenJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    pous: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          pouType: { enum: [...POU_TYPES] },
          vars: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { enum: [...IEC_TYPES] },
              },
              // section (default VAR), initial, address, comment.
              additionalProperties: true,
            },
          },
          body: {
            type: "object",
            properties: {
              language: { enum: [...POU_BODY_LANGUAGES] },
            },
            // networks (LD/FBD) | steps+transitions (SFC) | text (ST).
            additionalProperties: true,
          },
        },
        // returnType (FUNCTION only), comment.
        additionalProperties: true,
      },
    },
  },
  // fileHeader provenance — optional.
  additionalProperties: true,
};

/**
 * The programmingAdapter kinds whose artifact `content` is STRUCTURED JSON (parsed by a zod
 * model), for which grammar-constrained generation is used. Text kinds return null.
 */
export function getCodegenJsonSchema(kind: string): CodegenJsonSchema | null {
  switch (kind) {
    case "ir-flow":
      return IR_FLOW_JSON_SCHEMA;
    case "iec61131-pou":
      return POU_PROJECT_JSON_SCHEMA;
    default:
      return null;
  }
}

/** True when `kind` is a structured-JSON program kind (has a GBNF schema). */
export function isStructuredJsonKind(kind: string): boolean {
  return getCodegenJsonSchema(kind) != null;
}
