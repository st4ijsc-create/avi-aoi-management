/**
 * P4.B G17 — Lighting recipe MQTT publisher.
 *
 * Encodes one or more `MpLightingProfile` rows into a compact JSON payload
 * and publishes on `aoi/<machineCode>/recipe/<pointDefId>`. The payload is
 * the contract between the management app and the on-machine controller
 * (firmware/AOI head) for shot setup.
 *
 * The MQTT broker is late-bound from `globalThis.__mqttBroker` (same shape
 * used by spcAlertSink) so this module does not pin a hard dependency on
 * any specific MQTT client at import time.
 */

import type { MpLightingProfile } from "../../drizzle/schema/product";

export interface LightingShotPayload {
  shotIndex: number;
  name?: string | null;
  lightSource: string;
  color: string;
  colorHex?: string | null;
  intensityPct: number;
  angleDeg?: number | null;
  exposureUs?: number | null;
  gain?: number | null;
  focusOffsetUm?: number | null;
  opticalFilter?: string | null;
  purpose?: string | null;
  referenceImageUrl?: string | null;
}

export interface LightingRecipePayload {
  pointDefId: number;
  machineCode: string;
  profileVersion: string;
  shotCount: number;
  shots: LightingShotPayload[];
  publishedAt: string; // ISO8601
}

export interface PublishLightingRecipeResult {
  ok: boolean;
  topic: string;
  bytes: number;
  error?: string;
}

const PROFILE_VERSION = "1.0";

/** Pure encoding — safe to unit-test. */
export function encodeRecipe(
  profiles: Pick<
    MpLightingProfile,
    | "shotIndex"
    | "name"
    | "lightSource"
    | "color"
    | "colorHex"
    | "intensityPct"
    | "angleDeg"
    | "exposureUs"
    | "gain"
    | "focusOffsetUm"
    | "opticalFilter"
    | "purpose"
    | "referenceImageUrl"
    | "isActive"
  >[],
  pointDefId: number,
  machineCode: string,
): LightingRecipePayload {
  const active = profiles.filter((p) => p.isActive !== false);
  const shots: LightingShotPayload[] = active
    .map((p) => ({
      shotIndex: p.shotIndex ?? 1,
      name: p.name ?? null,
      lightSource: p.lightSource ?? "ring",
      color: p.color ?? "white",
      colorHex: p.colorHex ?? null,
      intensityPct: p.intensityPct ?? 100,
      angleDeg: p.angleDeg ?? null,
      exposureUs: p.exposureUs ?? null,
      gain: p.gain != null ? Number(p.gain) : null,
      focusOffsetUm: p.focusOffsetUm ?? null,
      opticalFilter: p.opticalFilter ?? null,
      purpose: p.purpose ?? null,
      referenceImageUrl: p.referenceImageUrl ?? null,
    }))
    .sort((a, b) => a.shotIndex - b.shotIndex);

  return {
    pointDefId,
    machineCode,
    profileVersion: PROFILE_VERSION,
    shotCount: shots.length,
    shots,
    publishedAt: new Date().toISOString(),
  };
}

export function buildRecipeTopic(machineCode: string, pointDefId: number): string {
  // Sanitize machineCode — MQTT topics disallow '+', '#', and NUL.
  const safe = String(machineCode).replace(/[+#\u0000]/g, "_");
  return `aoi/${safe}/recipe/${pointDefId}`;
}

/**
 * Publish via late-bound `globalThis.__mqttBroker`. Never throws — returns
 * `{ ok:false, error }` on any failure so callers can record + continue.
 */
export async function publishLightingRecipe(
  profiles: Parameters<typeof encodeRecipe>[0],
  pointDefId: number,
  machineCode: string,
): Promise<PublishLightingRecipeResult> {
  const topic = buildRecipeTopic(machineCode, pointDefId);
  try {
    const broker: any = (globalThis as any).__mqttBroker ?? null;
    const payload = encodeRecipe(profiles, pointDefId, machineCode);
    const body = JSON.stringify(payload);
    if (!broker || typeof broker.publish !== "function") {
      return {
        ok: false,
        topic,
        bytes: body.length,
        error: "no mqtt broker bound (globalThis.__mqttBroker)",
      };
    }
    await broker.publish(topic, body, { qos: 1, retain: true });
    return { ok: true, topic, bytes: body.length };
  } catch (e: any) {
    return { ok: false, topic, bytes: 0, error: String(e?.message ?? e) };
  }
}
