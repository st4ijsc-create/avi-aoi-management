/**
 * doc 81 Đợt 1B Task 3 — ĐĂNG KÝ ĐÍCH GIẢ LẬP URSim (BE2 §L3b, §3 S2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Trước đây `simTargets.validateUrscript` / `ursimPing` nhận `host`/cổng DO NGƯỜI GỌI ĐIỀN
 * rồi gửi `power on` + `brake release` + một URScript tuỳ ý tới đó — không qua dispatcher,
 * interlock, commissioning, HITL hay sổ. Trỏ vào IP một robot UR thật là nhả phanh và chạy
 * script trên cánh tay thật (S2: "KHÔNG CÓ lớp nào chặn").
 *
 * Repo KHÔNG có sổ đăng ký đích giả lập ⇒ (Ruling R3) đích DUY NHẤT được chấp nhận là đích
 * máy chủ tự cấu hình qua `URSIM_HOST`/`URSIM_*_PORT` (đọc bởi `ursimEndpointFromEnv`),
 * mang `targetId = "default"`. Và nó CHỈ được coi là giả lập khi host đó KHÔNG trùng host
 * của BẤT KỲ robot (`robots.endpoint`) hay adapter thiết bị (`device_adapters.endpoint`,
 * kể cả endpoint dự phòng HA / tuỳ chọn host trong `connectionOptions`) có trong CSDL —
 * đọc-chỉ, không ghi gì. Không đọc được CSDL ⇒ từ chối (fail-closed).
 *
 * Mọi đường gửi `power on`/`brake release` của harness (router + HIL) lấy endpoint TỪ ĐÂY,
 * không bao giờ từ tham số client.
 * ════════════════════════════════════════════════════════════════════════════
 */
import net from "node:net";
import { lookup } from "node:dns/promises";
import { appError } from "../../../_core/appError";
import { getDb } from "../../../db/connection";
import { robots, deviceAdapters } from "../../../../drizzle/schema";
import { ursimEndpointFromEnv } from "./ursimHarness";
import type { UrsimEndpoint } from "./ursimClient";

/** targetId của đích duy nhất: đích máy chủ cấu hình qua URSIM_HOST. */
export const DEFAULT_SIM_TARGET_ID = "default";

export interface RegisteredSimTarget {
  targetId: string;
  endpoint: UrsimEndpoint;
  /** Luôn là đích ẢO (URSim) — đã kiểm không trùng robot/adapter thật trong CSDL. */
  kind: "ursim-virtual";
}

export interface SimTargetRegistryDeps {
  /** Danh sách chuỗi endpoint/host của robot + adapter thiết bị thật (mặc định: đọc CSDL). */
  listRealDeviceEndpoints?: () => Promise<string[]>;
  /** Phân giải tên máy → địa chỉ IP (mặc định: dns.lookup có hạn giờ). */
  resolveAddresses?: (host: string) => Promise<string[]>;
}

/**
 * Rút phần HOST từ một endpoint ở các dạng repo đang dùng: "tcp://h:p", "opc.tcp://h:p/x",
 * "modbus-tcp://h:p", "h:p", "h", "[v6]:p", "user@h:p". Trả chữ thường, không dấu chấm
 * cuối; null khi rỗng.
 */
export function hostOfEndpoint(raw: string | null | undefined): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i;
  if (scheme.test(s)) {
    try {
      const u = new URL(s);
      if (u.hostname) s = u.hostname;
      else s = s.replace(scheme, "");
    } catch {
      s = s.replace(scheme, "");
    }
  }
  const at = s.lastIndexOf("@");
  if (at >= 0) s = s.slice(at + 1);
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    s = close > 0 ? s.slice(1, close) : s.slice(1);
  } else if ((s.match(/:/g) ?? []).length === 1) {
    s = s.slice(0, s.indexOf(":"));
  }
  s = s.trim().toLowerCase().replace(/\.$/, "");
  return s || null;
}

/** Khoá tuỳ chọn trong connectionOptions có thể mang host của thiết bị (trừ host LẮNG NGHE cục bộ). */
const HOST_OPTION_KEY = /(host|endpoint|address|^ip$|ip$)/i;

function collectOptionHosts(opts: unknown, out: string[], depth = 0): void {
  if (!opts || typeof opts !== "object" || depth > 3) return;
  for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
    if (/^listen/i.test(k)) continue;
    if (typeof v === "string" && HOST_OPTION_KEY.test(k)) out.push(v);
    else if (v && typeof v === "object") collectOptionHosts(v, out, depth + 1);
  }
}

/** Đọc-chỉ: mọi endpoint của robot + adapter thiết bị trong CSDL. Ném khi CSDL không sẵn sàng. */
export async function listRealDeviceEndpointsFromDb(): Promise<string[]> {
  const d = await getDb();
  if (!d) throw new Error("DB unavailable");
  const [robotRows, adapterRows] = await Promise.all([
    d.select({ endpoint: robots.endpoint, connectionOptions: robots.connectionOptions }).from(robots),
    d.select({ endpoint: deviceAdapters.endpoint, connectionOptions: deviceAdapters.connectionOptions }).from(deviceAdapters),
  ]);
  const out: string[] = [];
  for (const r of [...robotRows, ...adapterRows]) {
    if (r.endpoint) out.push(r.endpoint);
    collectOptionHosts(r.connectionOptions, out);
  }
  return out;
}

async function defaultResolveAddresses(host: string): Promise<string[]> {
  if (net.isIP(host)) return [host];
  try {
    const res = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("dns timeout")), 1500).unref?.()),
    ]);
    return res.map((a) => a.address.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * True ⇔ `simHost` trùng host của một thiết bị thật: so chữ (chuẩn hoá) và so địa chỉ đã
 * phân giải (tên máy ↔ IP). Không phân giải được thì chỉ so chữ.
 */
export async function hostMatchesRealDevice(
  simHost: string,
  deviceEndpoints: string[],
  resolveAddresses: (host: string) => Promise<string[]> = defaultResolveAddresses,
): Promise<boolean> {
  const sim = hostOfEndpoint(simHost);
  if (!sim) return false;
  const simKeys = new Set([sim, ...(await resolveAddresses(sim))]);
  const deviceHosts = [...new Set(deviceEndpoints.map(hostOfEndpoint).filter((h): h is string => !!h))];
  if (deviceHosts.some((h) => simKeys.has(h))) return true;
  const resolved = await Promise.all(deviceHosts.filter((h) => !net.isIP(h)).map((h) => resolveAddresses(h)));
  return resolved.some((addrs) => addrs.some((a) => simKeys.has(a)));
}

/**
 * Tra một đích giả lập đã đăng ký. Ném `PRECONDITION_FAILED` khi: targetId không có trong
 * danh sách; máy chủ chưa cấu hình URSIM_HOST; không kiểm được CSDL; hoặc host trùng một
 * robot/adapter thật. Không bao giờ trả một endpoint do client cung cấp.
 */
export async function resolveSimTarget(
  targetId: string,
  deps: SimTargetRegistryDeps = {},
): Promise<RegisteredSimTarget> {
  if (targetId !== DEFAULT_SIM_TARGET_ID) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: "resolveSimTarget", reason: "simTargetUnknown" },
      `Unknown sim target "${targetId}" — only the server-configured target "${DEFAULT_SIM_TARGET_ID}" exists.`,
    );
  }
  const endpoint = ursimEndpointFromEnv();
  if (!endpoint) {
    throw appError(
      "PRECONDITION_FAILED",
      "FEATURE_NOT_CONFIGURED",
      { feature: "ursimHarness" },
      "No URSim target configured on the server (set URSIM_HOST).",
    );
  }
  let deviceEndpoints: string[];
  try {
    deviceEndpoints = await (deps.listRealDeviceEndpoints ?? listRealDeviceEndpointsFromDb)();
  } catch (e) {
    throw appError(
      "PRECONDITION_FAILED",
      "DB_UNAVAILABLE",
      undefined,
      `Cannot verify the URSim target is not a real device (${(e as Error)?.message ?? e}) — refusing.`,
    );
  }
  if (await hostMatchesRealDevice(endpoint.host, deviceEndpoints, deps.resolveAddresses)) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: "resolveSimTarget", reason: "simTargetIsRealDevice" },
      "URSIM_HOST matches a registered robot / device adapter host — refusing to send power on / brake release / script to a real device.",
    );
  }
  return { targetId, endpoint, kind: "ursim-virtual" };
}
