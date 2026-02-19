import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as db from "../db";
import { storagePut } from "../storage";
import { protectedProcedure } from "../_core/trpc";

export type PointDefRecord = Awaited<ReturnType<typeof db.getMeasurementPointDefById>>;
export type PointDefCache = Map<string, PointDefRecord | null>;

export async function resolveMeasurementPointDefinition(
  code: string | undefined,
  productModelId: number | undefined,
  machineId: number,
  productCache: PointDefCache,
  machineCache: PointDefCache,
) {
  if (!code) return null;
  const normalized = code.trim();
  if (!normalized) return null;

  if (productModelId) {
    if (!productCache.has(normalized)) {
      const point = await db.getMeasurementPointDefByCode(productModelId, normalized);
      productCache.set(normalized, point ?? null);
    }
    const cached = productCache.get(normalized);
    if (cached) {
      return cached;
    }
  }

  if (!machineCache.has(normalized)) {
    const point = await db.getMeasurementPointDefByMachineAndCode(machineId, normalized);
    machineCache.set(normalized, point ?? null);
  }
  return machineCache.get(normalized) ?? null;
}

export type WorkstationCache = Map<string, number | null>;

export async function resolveWorkstationId(code: string | undefined, cache: WorkstationCache) {
  if (!code) return undefined;
  const normalized = code.trim();
  if (!normalized) return undefined;

  if (!cache.has(normalized)) {
    const workstation = await db.getWorkstationByCode(normalized);
    cache.set(normalized, workstation?.id ?? null);
  }

  const cached = cache.get(normalized);
  return cached ?? undefined;
}

export function toOptionalDecimal(value?: string | number | null) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return value.toString();
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function cleanUndefined<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, val]) => val !== undefined)
  ) as Partial<T>;
}

export function inferImageExtension(mimeType?: string) {
  if (!mimeType) return "png";
  const normalized = mimeType.toLowerCase();
  const mapping: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/bmp": "bmp",
  };
  return mapping[normalized] || normalized.split("/").pop() || "png";
}

export async function uploadPointReferenceImage(
  productModelId: number,
  pointCode: string,
  imageBase64?: string,
  mimeType?: string,
  imageUrl?: string,
) {
  if (imageUrl && imageUrl.trim().length > 0) {
    return { url: imageUrl.trim(), key: undefined as string | undefined };
  }

  if (!imageBase64 || imageBase64.trim().length === 0) {
    return undefined;
  }

  const trimmed = imageBase64.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, key: undefined };
  }

  let actualMime = mimeType || "image/png";
  let base64Payload = trimmed;
  const dataUrlMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    actualMime = dataUrlMatch[1];
    base64Payload = dataUrlMatch[2];
  }

  try {
    const buffer = Buffer.from(base64Payload, "base64");
    const safeCode = pointCode.replace(/[^a-zA-Z0-9-_]/g, "_");
    const ext = inferImageExtension(actualMime);
    const fileKey = `measurement-points/${productModelId}/${safeCode}-${Date.now()}-${nanoid(6)}.${ext}`;
    const upload = await storagePut(fileKey, buffer, actualMime);
    return upload;
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid image payload for point ${pointCode}` });
  }
}

// Admin procedure - only admin users can access
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});
