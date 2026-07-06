/**
 * Doc 38 T-1 (P1) — SECS/GEM production BRING-UP caller.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * `attachGemAlarmDispatch()` (liveDispatch.ts, doc 37 P0-6) has been the wired-but-
 * uncalled seam: it needs an ESTABLISHED HSMS session, and nothing in production
 * opened one. This service is that missing caller. For each configured equipment it:
 *   connect → Select → establishCommunications → attachGemAlarmDispatch
 * so an UNSOLICITED S5F1 alarm finally reaches raiseFromGemAlarm (E1 taxonomy → Andon,
 * when EQ_INTEG_ENABLED) and S6F11 events reach the onEvent sink.
 *
 * ── FLAG CHAIN (all default OFF — honest no-op otherwise) ────────────────────
 *   SECS_GEM_ENABLED      — permits an HSMS connection at all.
 *   SECS_GEM_LIVE_ENABLED — permits the inbound dispatch loop to attach.
 *   EQ_INTEG_ENABLED      — (downstream) permits a decoded S5F1 to actually raise
 *                           an Andon; without it the alarm is decoded + acked only.
 *
 * ── EQUIPMENT CONFIG (no new table) ─────────────────────────────────────────
 * Read from env `SECS_GEM_EQUIPMENT` — a JSON array of equipment descriptors:
 *   [{ "machineCode":"AOI-01", "host":"10.0.0.5", "port":5000,
 *      "deviceId":0, "modelName":"...", "softRev":"...", "vendor":"secsgem" }]
 * HONEST-DEGRADE: flags off, empty/invalid JSON, or zero equipment → a logged
 * no-op (nothing is claimed). Every per-equipment bring-up is individually
 * try/caught so one unreachable tool never blocks boot or the others.
 *
 * SCOPE: NOT a certified E30 driver (see hsmsClient/secsGemRegistry headers). It
 * proves an HSMS session + arms the MVP best-effort dispatch loop; validate against
 * real equipment. No equipment-CONTROL write path is opened (no requestOnline / host
 * command here) — alarm/event MONITORING only.
 */
import "./index"; // side-effect: register the built-in "secsgem" connector
import { createSecsGem, isSecsGemEnabled, isSecsGemLiveEnabled, type SecsGemConnector } from "./secsGemRegistry";
import { attachGemAlarmDispatch } from "./liveDispatch";
import type { ParsedS6F11 } from "./s5s6Messages";

export interface SecsGemEquipmentConfig {
  /** Platform machine code this equipment maps to (traceability on raised alarms). */
  machineCode: string;
  host: string;
  port: number;
  deviceId?: number;
  modelName?: string;
  softRev?: string;
  /** Vendor key for the E1 taxonomy lookup (defaults to 'secsgem' in the bridge). */
  vendor?: string;
  connectTimeoutMs?: number;
  controlTimeoutMs?: number;
}

interface LiveSession {
  cfg: SecsGemEquipmentConfig;
  connector: SecsGemConnector;
  dispose: () => void;
}

let started = false;
const sessions: LiveSession[] = [];

/** Parse SECS_GEM_EQUIPMENT (JSON array). Honest-degrade: [] on missing/invalid. */
export function parseEquipmentConfig(raw: string | undefined = process.env.SECS_GEM_EQUIPMENT): SecsGemEquipmentConfig[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is SecsGemEquipmentConfig =>
          e && typeof e.machineCode === "string" && typeof e.host === "string" && typeof e.port === "number",
      )
      .map((e) => ({
        machineCode: e.machineCode,
        host: e.host,
        port: e.port,
        deviceId: typeof e.deviceId === "number" ? e.deviceId : undefined,
        modelName: typeof e.modelName === "string" ? e.modelName : undefined,
        softRev: typeof e.softRev === "string" ? e.softRev : undefined,
        vendor: typeof e.vendor === "string" ? e.vendor : undefined,
        connectTimeoutMs: typeof e.connectTimeoutMs === "number" ? e.connectTimeoutMs : undefined,
        controlTimeoutMs: typeof e.controlTimeoutMs === "number" ? e.controlTimeoutMs : undefined,
      }));
  } catch {
    return [];
  }
}

/** Bring up ONE equipment: connect → Select → establishComms → arm live dispatch. */
async function bringUpOne(cfg: SecsGemEquipmentConfig): Promise<void> {
  const connector = createSecsGem(
    "secsgem",
    {
      host: cfg.host,
      port: cfg.port,
      deviceId: cfg.deviceId,
      modelName: cfg.modelName,
      softRev: cfg.softRev,
      connectTimeoutMs: cfg.connectTimeoutMs,
      controlTimeoutMs: cfg.controlTimeoutMs,
    },
    {
      machineCode: cfg.machineCode,
      modelName: cfg.modelName ?? "",
      softRev: cfg.softRev ?? "",
    },
  );

  await connector.hsms.connect();
  await connector.hsms.select();
  await connector.hsms.establishCommunications();

  const dispose = attachGemAlarmDispatch(connector.hsms, {
    machineCode: cfg.machineCode,
    machineId: null, // resolved by machineCode in the alarm bridge
    vendor: cfg.vendor,
    onEvent: (event: ParsedS6F11) => {
      // Framework module owns NO process_results writer (needs DB + machineId
      // resolution). Log honestly so an operator sees events arrive; the platform
      // sink can be wired later without touching the connectivity layer.
      console.log(
        `[SecsGemBringup] S6F11 event from ${cfg.machineCode}: CEID=${event.ceid} reports=${event.reports?.length ?? 0} (no DB writer wired)`,
      );
    },
  });

  sessions.push({ cfg, connector, dispose });
  console.log(`[SecsGemBringup] live dispatch ARMED for ${cfg.machineCode} (${cfg.host}:${cfg.port})`);
}

/**
 * Start SECS/GEM bring-up for all configured equipment. FAIL-SAFE + idempotent.
 * Honest no-op when the flag chain is off or no equipment is configured.
 */
export async function startSecsGemBringup(): Promise<void> {
  if (started) return;

  if (!isSecsGemEnabled() || !isSecsGemLiveEnabled()) {
    console.log(
      "[SecsGemBringup] disabled — needs SECS_GEM_ENABLED=true AND SECS_GEM_LIVE_ENABLED=true " +
        "(and EQ_INTEG_ENABLED for S5F1→Andon). No HSMS session opened.",
    );
    return;
  }

  const equipment = parseEquipmentConfig();
  if (equipment.length === 0) {
    console.log(
      "[SecsGemBringup] flags ON but no equipment configured (set SECS_GEM_EQUIPMENT to a JSON " +
        "array of { machineCode, host, port }). Honest no-op.",
    );
    return;
  }

  started = true;
  let armed = 0;
  for (const cfg of equipment) {
    try {
      await bringUpOne(cfg);
      armed++;
    } catch (err) {
      console.error(
        `[SecsGemBringup] bring-up failed for ${cfg.machineCode} (${cfg.host}:${cfg.port}):`,
        (err as Error)?.message || err,
      );
    }
  }
  console.log(`[SecsGemBringup] ${armed}/${equipment.length} equipment session(s) armed.`);
}

/** Tear down every live session (idempotent). Called from scheduler shutdown. */
export function stopSecsGemBringup(): void {
  for (const s of sessions) {
    try {
      s.dispose();
    } catch {
      /* fail-safe */
    }
    try {
      void s.connector.hsms.separate();
    } catch {
      /* fail-safe */
    }
  }
  sessions.length = 0;
  started = false;
}

/** Honest status snapshot for a health card (no I/O). */
export function getSecsGemBringupStatus() {
  return {
    started,
    flagChainReady: isSecsGemEnabled() && isSecsGemLiveEnabled(),
    configuredEquipment: parseEquipmentConfig().length,
    liveSessions: sessions.length,
  };
}
