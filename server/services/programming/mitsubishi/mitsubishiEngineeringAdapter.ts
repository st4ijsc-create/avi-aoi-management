/**
 * Doc 09 / Phase D3 — Device Programming & Control: MITSUBISHI ENGINEERING adapter.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A ProgrammingAdapter for Mitsubishi MELSEC controllers (kind "mitsubishi-engineering").
 * Mitsubishi is a VENDOR-CLOSED toolchain: we do NOT reimplement GX Works' compiler.
 * Instead this adapter covers the engineering work the platform CAN own safely —
 * a DEVICE / RECIPE PARAMETER table (set MELSEC devices D/M/Y/... to values) — and wraps
 * the vendor toolchain for the rest.
 *
 * WHAT IS REAL HERE (works with no hardware):
 *   • validate() — parses `<DEVICE> = <value>` assignment lines and validates MELSEC
 *     device syntax (X/Y/M/L/F/B/D/W/R/Z/T/C/S/V).
 *   • compile()  — builds a device→value parameter map (the transferable recipe).
 *   • simulate() — a param-write PREVIEW timeline (one step per assignment; no I/O).
 *
 * WHAT IS WIRED (T-2 doc 38), STILL HW-GATED:
 *   • deploy() — (a) param/recipe PUSH routes each device write through the EXISTING OT
 *     commandDispatcher (its own HITL + commissioning + OT_CONTROL_ENABLED gates). With the
 *     mode gate off / adapter not commissioned it records 'simulated'; missing tag/adapter →
 *     honest 'rejected'. Never a fake 'deployed'. (b) full PROGRAM transfer still requires a
 *     GX Works headless/CLI wrap — that path is not claimed here.
 *
 * SAFETY: authors process PARAMETERS only. Ladder/safety logic stays in GX Works on the
 * certified PLC; native ladder authoring (open runtime only) is Phase D5.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import type {
  ProgrammingAdapter,
  ProgrammingCapability,
  ProgramSource,
  Diagnostics,
  ProgDiagnostic,
  BuildResult,
  ProgSimScenario,
  ProgSimResult,
  ProgSimStep,
  ProgDeployOpts,
  ProgDeployResult,
} from "../programmingAdapter";

// MELSEC device prefixes (bit + word). Address may be decimal or hex (X/Y/B/W are hex).
const DEVICE_RE = /^([XYMLFBVSTCDWRZ])(\d+|[0-9A-Fa-f]+)$/;
const HEX_DEVICES = new Set(["X", "Y", "B", "W"]);

interface Assignment {
  lineNo: number;
  device: string;
  value: string;
}

function parseAssignments(content: string): { rows: Assignment[]; diags: ProgDiagnostic[] } {
  const rows: Assignment[] = [];
  const diags: ProgDiagnostic[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const code = raw.replace(/'.*$/, "").trim();
    if (!code) return;
    // Accept "D100 = 1234" or "M0 := TRUE".
    const m = code.match(/^([A-Za-z]\w*)\s*:?=\s*(.+)$/);
    if (!m) {
      diags.push({ severity: "error", message: `Not a "<DEVICE> = <value>" assignment.`, line: i + 1 });
      return;
    }
    const device = m[1].toUpperCase();
    const dm = device.match(DEVICE_RE);
    if (!dm) {
      diags.push({ severity: "error", message: `Invalid MELSEC device "${device}".`, line: i + 1, symbol: device });
      return;
    }
    const [, prefix, addr] = dm;
    if (!HEX_DEVICES.has(prefix) && !/^\d+$/.test(addr)) {
      diags.push({ severity: "error", message: `Device ${device}: address must be decimal.`, line: i + 1, symbol: device });
      return;
    }
    rows.push({ lineNo: i + 1, device, value: m[2].trim() });
  });
  return { rows, diags };
}

export class MitsubishiEngineeringAdapter implements ProgrammingAdapter {
  readonly kind = "mitsubishi-engineering" as const;
  readonly capabilities: ProgrammingCapability = {
    canCompile: true,
    canSimulate: true,
    canDownload: true,   // via commandDispatcher param-push or GX Works wrap (gated)
    canUpload: false,    // GX Works upload — toolchain wrap (later)
    canOnlineMonitor: true,
    canForce: true,
    canTeach: false,
    languages: ["st", "device"],
  };

  async validate(src: ProgramSource): Promise<Diagnostics> {
    if (!src.content || src.content.trim().length === 0) {
      return { ok: false, diagnostics: [{ severity: "error", message: "Empty parameter table." }] };
    }
    const { rows, diags } = parseAssignments(src.content);
    if (rows.length === 0 && !diags.some((d) => d.severity === "error")) {
      diags.push({ severity: "warning", message: "No device assignments parsed." });
    }
    return { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags };
  }

  async compile(src: ProgramSource): Promise<BuildResult> {
    const { rows, diags } = parseAssignments(src.content);
    const ok = !diags.some((d) => d.severity === "error") && rows.length > 0;
    const paramMap = Object.fromEntries(rows.map((r) => [r.device, r.value]));
    const checksum = createHash("sha256").update(JSON.stringify(paramMap)).digest("hex").slice(0, 16);
    return {
      ok,
      diagnostics: diags,
      outputRef: ok ? `melsec://recipe/${checksum}` : undefined,
      bytes: src.content.length,
      meta: { devices: rows.length, paramMap, checksum },
    };
  }

  async simulate(build: BuildResult, _scenario: ProgSimScenario): Promise<ProgSimResult> {
    const paramMap = (build.meta?.paramMap as Record<string, string>) ?? {};
    const entries = Object.entries(paramMap);
    const timeline: ProgSimStep[] = entries.map(([device, value], i) => ({
      index: i,
      label: `${device} = ${value}`,
      startMs: i * 10,
      endMs: (i + 1) * 10,
      note: "param-write (preview)",
    }));
    return {
      ok: build.ok,
      timeline,
      warnings: entries.length === 0 ? ["No parameters to write."] : [],
      totalDurationMs: Math.max(1, entries.length) * 10,
    };
  }

  async deploy(build: BuildResult, opts: ProgDeployOpts): Promise<ProgDeployResult> {
    // T-2 (doc 38) — ROUTE each recipe/device write through the EXISTING OT commandDispatcher
    // (its own HITL re-verify → adapter/tag-writable → commissioning → OT_CONTROL_ENABLED mode
    // gate → interlock). Reached ONLY after programmingService opened its gate (DPC_DEPLOY_
    // ENABLED + HITL sign-off). With OT_CONTROL_ENABLED off / adapter not commissioned it is
    // recorded 'simulated'; missing tag/adapter → an honest 'rejected' with the exact reason —
    // never a fake 'deployed'. (Full PROGRAM transfer still needs a GX Works headless wrap.)
    const adapterId = opts.deviceId;
    if (!adapterId) {
      return {
        ok: false,
        status: "failed",
        simulated: false,
        error: "No OT adapterId (deviceId) bound to this project — cannot route the MELSEC param push.",
      };
    }
    const paramMap = (build.meta?.paramMap as Record<string, string> | undefined) ?? {};
    const writes = Object.entries(paramMap).map(([device, value]) => ({ tagKey: device, value }));
    if (writes.length === 0) {
      return { ok: false, status: "failed", simulated: false, error: "No device parameters to push (empty recipe)." };
    }
    // The dispatcher's HITL trigger requires a confirming user (four-eyes). Absent → honest reject.
    if (opts.hitl.confirmedBy == null) {
      return { ok: false, status: "rejected", simulated: true, error: "HITL sign-off (confirmedBy) required to push MELSEC parameters." };
    }

    const { dispatch } = await import("../../ot/commandDispatcher");
    const res = await dispatch({
      adapterId,
      machineId: adapterId,
      commandType: "recipe_param_push",
      writes,
      triggeredBy: {
        kind: "hitl",
        actionId: opts.hitl.actionId,
        confirmedBy: opts.hitl.confirmedBy,
        requestedBy: opts.hitl.requestedBy,
      },
      idempotencyKey: opts.idempotencyKey,
    });

    // Map DispatchResult → ProgDeployResult (honest, mirrors the dispatcher outcome).
    if (res.simulated) {
      return {
        ok: true,
        status: "simulated",
        simulated: true,
        detail: { via: "commandDispatcher", reason: res.reason ?? "OT_CONTROL_ENABLED off / not commissioned — dry-run.", writes: writes.length },
      };
    }
    if (res.ok) {
      return { ok: true, status: "deployed", simulated: false, detail: { via: "commandDispatcher", writes: writes.length } };
    }
    return {
      ok: false,
      status: res.status === "rejected" ? "rejected" : "failed",
      simulated: res.status === "rejected",
      detail: { via: "commandDispatcher", reason: res.reason },
      error: res.reason ?? `MELSEC param push ${res.status}.`,
    };
  }
}
