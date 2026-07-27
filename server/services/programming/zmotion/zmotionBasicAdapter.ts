/**
 * Doc 09 / Phase D2 — Device Programming & Control: ZMOTION BASIC adapter.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A real ProgrammingAdapter for Zmotion ZMC / VPLC motion controllers (kind
 * "zmotion-basic"). Zmotion is an OPEN controller — we author Zmotion-BASIC + motion in
 * the platform and (when enabled) download it directly over the ZMC Ethernet link.
 *
 * WHAT IS REAL HERE (works on an emulator / no hardware):
 *   • validate() — a Zmotion-BASIC lexer + block-balance + motion-op checks.
 *   • compile()  — produces a deterministic transferable token (checksum + op summary).
 *   • simulate() — a motion timeline from the parsed MOVE ops (pure; no device I/O).
 *
 * WHAT IS AN HONEST FRAMEWORK (needs the FFI shim + real-HW validation):
 *   • ZmcLink — deploys over the Zmotion **ZAux command channel** (zauxdll.dll), NOT
 *     Modbus. The deploy sequence is now pinned to the REAL SDK signatures transcribed
 *     from Zmcaux.cs (D:/SOURCES/AI Local/Manual/Zmotion/Zmotion DLL/Zmcaux.cs):
 *         ZAux_OpenEth(ip, &handle) → ZAux_BasDown/ZarDown/ZpjDown(handle, file, run_mode)
 *         → ZAux_Close(handle);   every call returns Int32, 0 = ERR_OK (success).
 *     Because those are native __stdcall exports in zauxdll.dll, the actual call needs
 *     an FFI binding (koffi / ffi-napi). That shim is NOT yet present, so deploy() fails
 *     honestly with a precise TODO — never a fake success. deploy()/upload() are reached
 *     ONLY when programmingService opens the gate (DPC_DEPLOY_ENABLED + HITL sign-off).
 *
 * SAFETY: this adapter authors MOTION/PROCESS logic only. E-stop / hardware limits / SIL
 * safety remain on the certified controller/PLC and are never authored or deployed here.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { connect, type Socket } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safetyLintDiagnostics } from "../safetyLinter";
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

// ── Zmotion-BASIC surface we recognise (enough for validate + motion simulate). ──
const MOTION_OPS = ["MOVE", "MOVEABS", "MOVECIRC", "MOVESP", "MHELICAL", "CONNECT", "CAM"];
const BLOCK_OPEN = /\b(IF|FOR|WHILE|SUB)\b/i;
const BLOCK_CLOSE = /\b(ENDIF|END\s+IF|NEXT|WEND|ENDSUB|END\s+SUB)\b/i;

interface ParsedLine {
  lineNo: number;
  raw: string;
  op?: string;
  args: number[];
}

function parseBasic(content: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const code = raw.replace(/'.*$/, "").trim(); // strip ' comments
    if (!code) return;
    const m = code.match(/^([A-Za-z_]+)/);
    const op = m ? m[1].toUpperCase() : undefined;
    const args = (code.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    out.push({ lineNo: i + 1, raw: code, op, args });
  });
  return out;
}

function lint(src: ProgramSource): ProgDiagnostic[] {
  const diags: ProgDiagnostic[] = [];
  if (!src.content || src.content.trim().length === 0) {
    diags.push({ severity: "error", message: "Empty Zmotion-BASIC program." });
    return diags;
  }
  let open = 0;
  let close = 0;
  let motionCount = 0;
  for (const ln of src.content.split(/\r?\n/)) {
    const code = ln.replace(/'.*$/, "");
    if (BLOCK_OPEN.test(code)) open++;
    if (BLOCK_CLOSE.test(code)) close++;
    if (MOTION_OPS.some((op) => new RegExp(`\\b${op}\\b`, "i").test(code))) motionCount++;
  }
  if (open !== close) {
    diags.push({ severity: "error", message: `Unbalanced block keywords (${open} open / ${close} close).` });
  }
  if (motionCount === 0) {
    diags.push({ severity: "warning", message: "No motion op (MOVE/MOVEABS/…) found — is this a motion program?" });
  }
  // C4 (doc 69 Wave-4) — SEMANTIC safety-linter pass: structural checks (unbounded loop /
  // motion envelope / missing interlock) that fire even with no "safety" keyword present.
  // Always WARNING severity (advisory) — never affects `ok`, never blocks codegen.
  diags.push(...safetyLintDiagnostics("zmotion-basic", src.content));
  return diags;
}

// ── ZAux (zauxdll.dll) deploy contract ───────────────────────────────────────

/**
 * zauxdll return code. Every ZAux_* export returns Int32 where 0 = ERR_OK (success).
 * A non-zero value is an error code — surface it and look it up in the Zmotion PC
 * Programming Manual V2.1.4 return-code / error-code table. (Common non-zero cases:
 * link/timeout, wrong controller ID, file/compile error, ROM write error.)
 */
const ZAUX_ERR_OK = 0;

/**
 * *Down run_mode, per Zmcaux.cs ("RAM-ROM  0-RAM  1-ROM"):
 *   0 = RAM  → runs immediately, volatile (lost on power-cycle)   — use for staging.
 *   1 = ROM  → compiled to controller flash, persists across reboot — use for production.
 */
export type ZmcRunMode = 0 | 1;

/**
 * The subset of zauxdll.dll needed to DEPLOY. A future FFI shim must implement this
 * against the real DLL. Entry points transcribed EXACTLY from Zmcaux.cs
 * (D:/SOURCES/AI Local/Manual/Zmotion/Zmotion DLL/Zmcaux.cs) — all __stdcall,
 * CharSet.Ansi, returning Int32:
 *   L131   ZAux_OpenEth(string ipaddr, out IntPtr phandle)
 *   L184   ZAux_BasDown(IntPtr handle, string Filename, UInt32 run_mode)   // .bas → ZAR → download+run
 *   L3411  ZAux_ZarDown(IntPtr handle, string Filename, UInt32 run_mode)   // precompiled .zar
 *   L197   ZAux_ZpjDown(IntPtr h, string zpj, string zar, string pass, UInt32 uid, UInt32 run_mode) // project
 *   L158   ZAux_Close(IntPtr handle)
 * NOTE: ZAux_OpenEth takes ONLY the IP — the ZAux Ethernet port + handshake live
 * INSIDE zauxdll.dll; it is NOT Modbus TCP 502 (that was the previous wrong label).
 */
export interface ZauxBinding {
  openEth(ip: string): { code: number; handle: unknown };
  basDown(handle: unknown, file: string, runMode: ZmcRunMode): number;
  zarDown(handle: unknown, file: string, runMode: ZmcRunMode): number;
  close(handle: unknown): number;
}

/**
 * Optionally load the FFI shim that binds zauxdll.dll (server/services/programming/zmotion/
 * zauxFfi.ts, T-2 doc 38). That shim imports **koffi** LAZILY via a variable specifier — no
 * package.json dependency — so this returns a working loader ONLY when koffi is installed on the
 * HW-wired host (owner: `npm i koffi` + set ZAUXDLL_PATH). Absent koffi/shim → the loader (or the
 * binding it returns) throws, and deploy() degrades to an HONEST dry-run — never a fake success.
 */
type ZauxLoader = (dllPath: string) => ZauxBinding | Promise<ZauxBinding>;
async function loadZauxBinding(): Promise<ZauxLoader | null> {
  try {
    const spec = "./zauxFfi"; // variable specifier → not statically resolved by TS/bundler
    const mod: Record<string, unknown> = await import(spec);
    const fn = mod?.loadZauxBinding;
    return typeof fn === "function" ? (fn as ZauxLoader) : null;
  } catch {
    return null; // FFI shim / koffi not installed — deploy() stays an honest dry-run
  }
}

/**
 * ZmcLink — deploys to a Zmotion ZMC/VPLC controller over the ZAux command channel
 * (zauxdll.dll), NOT Modbus. The real download runs the OpenEth → *Down → Close
 * sequence via the FFI binding above; without that binding it fails honestly.
 */
class ZmcLink {
  constructor(private readonly endpoint: string, private readonly timeoutMs = 4000) {}

  /**
   * Parse "host[:probePort]". The optional :port is used ONLY for the courtesy TCP
   * reachability probe below — ZAux_OpenEth needs just the IP (the ZAux protocol port
   * is internal to zauxdll.dll), so `host` is what the real deploy uses.
   */
  private hostPort(): { host: string; port: number } {
    const [host, port] = this.endpoint.split(":");
    return { host: host || "127.0.0.1", port: Number(port) || 0 };
  }

  get host(): string { return this.hostPort().host; }

  /**
   * Best-effort TCP reachability probe (courtesy only — the authoritative check is
   * ZAux_OpenEth inside the DLL). If no probe port was supplied we do NOT block:
   * OpenEth becomes the real reachability test. Resolves false on error/timeout.
   */
  async probe(): Promise<boolean> {
    const { host, port } = this.hostPort();
    if (!port) return true; // no courtesy port → defer to ZAux_OpenEth
    return new Promise((resolve) => {
      let done = false;
      let sock: Socket;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        try { sock?.destroy(); } catch { /* noop */ }
        resolve(ok);
      };
      try {
        sock = connect({ host, port }, () => finish(true));
        sock.setTimeout(this.timeoutMs, () => finish(false));
        sock.on("error", () => finish(false));
      } catch {
        finish(false);
      }
    });
  }

  /**
   * REAL deploy sequence (contract): ZAux_OpenEth(ip) → [Bas|Zar]Down(handle, file,
   * runMode) → ZAux_Close(handle). Every step must return ZAUX_ERR_OK(0); a non-zero
   * code or a missing binding yields a clear failure — NEVER a fake success. `file`
   * must be a real on-disk path (.zar → ZAux_ZarDown, otherwise ZAux_BasDown).
   */
  async deployFile(
    file: string,
    runMode: ZmcRunMode,
  ): Promise<{ ok: boolean; code?: number; step?: string; error?: string }> {
    const loader = await loadZauxBinding();
    if (!loader) {
      return {
        ok: false,
        error:
          "zauxdll FFI binding not installed — add koffi + server/services/programming/zmotion/zauxFfi.ts (see ZauxBinding TODO) to enable real ZAux deploy.",
      };
    }
    const dll = process.env.ZAUXDLL_PATH;
    if (!dll) return { ok: false, error: "ZAUXDLL_PATH not set (absolute path to zauxdll.dll)." };

    let zaux: ZauxBinding;
    try {
      zaux = await loader(dll);
    } catch (e) {
      return { ok: false, error: `Failed to load zauxdll.dll from ${dll}: ${(e as Error).message}` };
    }

    // 1) Open the ZAux Ethernet link (IP only; port/handshake owned by the DLL).
    const { code: openCode, handle } = zaux.openEth(this.host);
    if (openCode !== ZAUX_ERR_OK) {
      return { ok: false, code: openCode, step: "ZAux_OpenEth", error: `ZAux_OpenEth(${this.host}) failed: code ${openCode}` };
    }
    try {
      // 2) Compile+download the program (.bas → BasDown auto-generates the ZAR).
      const isZar = file.toLowerCase().endsWith(".zar");
      const step = isZar ? "ZAux_ZarDown" : "ZAux_BasDown";
      const code = isZar ? zaux.zarDown(handle, file, runMode) : zaux.basDown(handle, file, runMode);
      if (code !== ZAUX_ERR_OK) {
        return {
          ok: false,
          code,
          step,
          error: `${step} failed: code ${code} (see Zmotion PC Programming Manual V2.1.4 return-code table).`,
        };
      }
      return { ok: true, code: ZAUX_ERR_OK, step };
    } finally {
      // 3) Always close the handle (best-effort).
      try { zaux.close(handle); } catch { /* best-effort */ }
    }
  }
}

export class ZmotionBasicAdapter implements ProgrammingAdapter {
  readonly kind = "zmotion-basic" as const;
  readonly capabilities: ProgrammingCapability = {
    canCompile: true,
    canSimulate: true,
    canDownload: true,   // via ZmcLink (gated; needs HW validation)
    canUpload: true,
    canOnlineMonitor: true,
    canForce: true,
    canTeach: false,
    languages: ["basic"],
  };

  async validate(src: ProgramSource): Promise<Diagnostics> {
    const diagnostics = lint(src);
    return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics };
  }

  async compile(src: ProgramSource): Promise<BuildResult> {
    const diagnostics = lint(src);
    const ok = !diagnostics.some((d) => d.severity === "error");
    const parsed = parseBasic(src.content);
    const moves = parsed.filter((p) => p.op && MOTION_OPS.includes(p.op)).length;
    const checksum = createHash("sha256").update(src.content, "utf8").digest("hex").slice(0, 16);

    // T-2 (doc 38) — PERSIST the program to a real on-disk .bas so a (gated) deploy can hand
    // the file path to ZAux_BasDown. Written under ZMC_BUILD_DIR (or the OS temp dir). This is
    // the ONLY device-facing artefact compile produces; deploy resolves it from meta.filePath.
    // Best-effort: a write failure does NOT fail the build (deploy will report "no file path").
    let filePath: string | undefined;
    if (ok) {
      try {
        const dir = process.env.ZMC_BUILD_DIR || join(tmpdir(), "zmc-builds");
        await mkdir(dir, { recursive: true });
        filePath = join(dir, `${checksum}.bas`);
        await writeFile(filePath, src.content, "utf8");
      } catch {
        filePath = undefined; // honest — deploy() surfaces the missing file path
      }
    }

    return {
      ok,
      diagnostics,
      outputRef: ok ? `zmc://build/${checksum}` : undefined,
      bytes: src.content.length,
      meta: { moves, ops: parsed.length, checksum, ...(filePath ? { filePath } : {}) },
    };
  }

  async simulate(build: BuildResult, scenario: ProgSimScenario): Promise<ProgSimResult> {
    // Reconstruct a motion timeline. Without the original source on the build we use the
    // op summary; the workspace passes a scenario that may override per-move duration.
    const moves = Number((build.meta?.moves as number) ?? 0);
    const ops = Number((build.meta?.ops as number) ?? Math.max(1, moves));
    const perMs = scenario.durationMsOverride ?? 250; // default move time
    const timeline: ProgSimStep[] = [];
    let t = 0;
    for (let i = 0; i < Math.max(1, ops); i++) {
      const isMove = i < moves;
      const dur = isMove ? perMs : Math.round(perMs / 5);
      timeline.push({
        index: i,
        label: isMove ? `MOVE ${i + 1}` : `op ${i + 1}`,
        startMs: t,
        endMs: t + dur,
        note: isMove ? "motion" : "logic",
      });
      t += dur;
    }
    return {
      ok: build.ok,
      timeline,
      warnings: moves === 0 ? ["No motion ops to simulate."] : [],
      totalDurationMs: t,
    };
  }

  async deploy(build: BuildResult, opts: ProgDeployOpts): Promise<ProgDeployResult> {
    // Reached ONLY when the service opened the gate (DPC_DEPLOY_ENABLED + HITL sign-off).
    // Honest by construction: any failure → status 'failed', never a fake 'deployed'.
    // Endpoint precedence: explicit opts.endpoint → ZMC_ENDPOINT env (owner sets the wired
    // controller's host[:probePort] on the HW host). Absent → honest 'failed', no device write.
    const endpoint = opts.endpoint || process.env.ZMC_ENDPOINT;
    if (!endpoint) {
      return {
        ok: false,
        status: "failed",
        simulated: false,
        error: "No ZMC endpoint — set opts.endpoint or ZMC_ENDPOINT (host[:probePort]) before deploy.",
      };
    }

    // Documented run_mode (Zmcaux.cs): production → ROM(1, persist), staging → RAM(0, volatile).
    const runMode: ZmcRunMode = opts.stage === "production" ? 1 : 0;

    const link = new ZmcLink(endpoint);
    const reachable = await link.probe();
    if (!reachable) {
      return {
        ok: false,
        status: "failed",
        simulated: false,
        detail: { reachable },
        error: `ZMC endpoint ${endpoint} unreachable.`,
      };
    }

    // ZAux_BasDown/ZarDown need the program as a real file on disk. compile() persists the
    // .bas under ZMC_BUILD_DIR and sets build.meta.filePath (T-2 doc 38); resolve it here.
    // When the build carries no path (write failed, or a token-only build) fail honestly.
    const file = typeof build.meta?.filePath === "string" ? (build.meta.filePath as string) : undefined;
    if (!file) {
      return {
        ok: false,
        status: "failed",
        simulated: false,
        detail: { reachable },
        error:
          "No compiled .bas/.zar file path on the build — compile() did not persist the program (build.meta.filePath missing).",
      };
    }

    // Real deploy: ZAux_OpenEth → BasDown/ZarDown → Close via the FFI binding. Fails
    // honestly (with the FFI TODO) until server/services/programming/zmotion/zauxFfi.ts
    // + koffi exist.
    const res = await link.deployFile(file, runMode);
    if (!res.ok) {
      return {
        ok: false,
        status: "failed",
        simulated: false,
        detail: { reachable, step: res.step, code: res.code },
        error: res.error,
      };
    }
    return {
      ok: true,
      status: "deployed",
      simulated: false,
      // `endpoint` is surfaced so programmingService.verifyAfterDownload can read the program
      // back from the same controller for verify-after-download (T-2 doc 38).
      detail: { reachable, step: res.step, runMode, code: res.code, endpoint },
    };
  }

  async upload(target: { endpoint?: string }): Promise<ProgramSource> {
    // Honest stub: structured but not HW-validated.
    throw new Error(
      `Zmotion upload needs real-HW validation of the ZMC read protocol (endpoint ${target.endpoint ?? "?"}).`,
    );
  }
}
