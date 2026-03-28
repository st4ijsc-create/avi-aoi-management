// Preconfigured storage helpers
// Default: use Manus Forge storage proxy (Authorization: Bearer <token>)
// Optional: local filesystem mode for self-hosted deployments

import { ENV } from './_core/env';
import fs from "fs";
import path from "path";

type StorageConfig = { baseUrl: string; apiKey: string };

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });
  return (await response.json()).url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const storageMode = process.env.STORAGE_MODE ?? "forge";

  // Local filesystem mode: save files under LOCAL_STORAGE_DIR (default: ./uploads)
  if (storageMode === "local") {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");

    const filePath = path.join(uploadsRoot, key);

    // Prevent path traversal attacks
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(uploadsRoot) + path.sep) && resolved !== path.resolve(uploadsRoot)) {
      throw new Error("Invalid storage key: path traversal detected");
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    if (typeof data === "string") {
      await fs.promises.writeFile(filePath, data);
    } else {
      await fs.promises.writeFile(filePath, Buffer.from(data));
    }

    // Files will be served by Express from /uploads
    const url = `/uploads/${key}`;
    return { key, url };
  }

  // Default: Forge storage proxy mode
  const { baseUrl, apiKey } = getStorageConfig();
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string; }> {
  const key = normalizeKey(relKey);
  const storageMode = process.env.STORAGE_MODE ?? "forge";

  if (storageMode === "local") {
    // In local mode, files are served directly from /uploads
    return {
      key,
      url: `/uploads/${key}`,
    };
  }

  const { baseUrl, apiKey } = getStorageConfig();
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/**
 * Resolve an image URL for external API consumers.
 * - data: URLs are returned as-is.
 * - Relative /uploads/... URLs (local storage mode) are read from disk and
 *   converted to base64 data URLs so that external clients can use them.
 * - Absolute http(s) URLs are returned as-is.
 */
export async function resolveImageToDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;

  // Relative /uploads/... path → read file from disk and convert to data URL
  if (url.startsWith('/uploads/')) {
    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), 'uploads');

    const relativePart = url.slice('/uploads/'.length);
    const filePath = path.join(uploadsRoot, relativePart);

    // Prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(uploadsRoot) + path.sep) && resolved !== path.resolve(uploadsRoot)) {
      return null;
    }

    try {
      const buffer = await fs.promises.readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  return url;
}
