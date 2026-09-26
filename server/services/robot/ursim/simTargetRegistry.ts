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
 * Mọi đường gửi `power on`/`brake release` của harness (router + HIL + deploy URSim) lấy
 * endpoint TỪ ĐÂY, không bao giờ từ tham số client.
 *
 * Fix round 1 (Ruling R9) — kiểm FAIL-CLOSED và KIỂM = DÙNG:
 *   • mọi IP literal được CHUẨN HOÁ (IPv4-mapped ⇒ IPv4, IPv6 đầy đủ ⇔ rút gọn, ngoặc, hoa/
 *     thường, dấu chấm cuối) trước khi so;
 *   • URSIM_HOST không phân giải được (lỗi / hết giờ / rỗng) ⇒ TỪ CHỐI;
 *   • URSIM_HOST được phân giải MỘT lần và endpoint trả về mang ĐỊA CHỈ IP đó (không phải tên)
 *     ⇒ UrsimClient nối đúng địa chỉ đã kiểm, không tự phân giải lại;
 *   • một tên máy thiết bị không phân giải được ⇒ TỪ CHỐI, TRỪ KHI mọi địa chỉ của sim đều là
 *     loopback (127.0.0.0/8, ::1): cánh tay thật đăng ký dưới một tên không phân giải được
 *     không thể là URSim loopback cục bộ — giữ HIL dev chạy được với CSDL `_test`.
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
  /** `endpoint.host` là ĐỊA CHỈ IP đã phân giải + đã kiểm (không phải tên máy). */
  endpoint: UrsimEndpoint;
  /** Giá trị URSIM_HOST như cấu hình (chỉ để hiển thị / log). */
  configuredHost: string;
  /** Luôn là đích ẢO (URSim) — đã kiểm không trùng robot/adapter thật trong CSDL. */
  kind: "ursim-virtual";
}

export interface SimTargetRegistryDeps {
  /** Danh sách chuỗi endpoint/host của robot + adapter thiết bị thật (mặc định: đọc CSDL). */
  listRealDeviceEndpoints?: () => Promise<string[]>;
  /**
   * Phân giải tên máy → địa chỉ IP (mặc định: dns.lookup). Ném / treo / trả rỗng ⇒ "không phân
   * giải được" (fail-closed). Mỗi lượt gọi bị bọc hạn `dnsTimeoutMs`.
   */
  resolveAddresses?: (host: string) => Promise<string[]>;
  /** Hạn cho MỖI lượt phân giải (ms). Mặc định 1500. */
  dnsTimeoutMs?: number;
}

/**
 * Dạng CHUẨN của một IP literal, hoặc null nếu không phải IP. IPv4-mapped (::ffff:a.b.c.d /
 * ::ffff:XXXX:XXXX) ⇒ IPv4 chấm; IPv6 ⇒ dạng rút gọn chữ thường (WHATWG URL); bỏ ngoặc,
 * zone id, dấu chấm cuối.
 */
export function canonicalIp(raw: string): string | null {
  let h = String(raw ?? "").trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  h = h.replace(/\.$/, "");
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  if (net.isIPv4(h)) return h.split(".").map((o) => String(Number(o))).join(".");
  if (!net.isIPv6(h)) return null;
  let c: string;
  try {
    c = new URL(`http://[${h}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(c);
  if (mapped) {
    const a = parseInt(mapped[1], 16);
    const b = parseInt(mapped[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return c;
}

/** Loopback: 127.0.0.0/8 hoặc ::1 (đầu vào đã chuẩn hoá). */
function isLoopback(ip: string): boolean {
  return ip === "::1" || /^127\./.test(ip);
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
  const res = await lookup(host, { all: true });
  return res.map((a) => a.address);
}

const DEFAULT_DNS_TIMEOUT_MS = 1500;

/** Địa chỉ CHUẨN của một host: literal ⇒ chính nó; tên ⇒ phân giải (có hạn). null = không phân giải được. */
async function canonicalAddresses(
  host: string,
  resolve: (host: string) => Promise<string[]>,
  timeoutMs: number,
): Promise<string[] | null> {
  const lit = canonicalIp(host);
  if (lit) return [lit];
  let timer: NodeJS.Timeout | undefined;
  try {
    const addrs = await Promise.race([
      resolve(host),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("dns timeout")), timeoutMs);
        timer.unref?.();
      }),
    ]);
    const out = [...new Set((addrs ?? []).map(canonicalIp).filter((a): a is string => !!a))];
    return out.length > 0 ? out : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type SimHostCheck =
  | { ok: true; address: string }
  | { ok: false; reason: "simTargetUnresolvable" | "simTargetIsRealDevice" | "deviceHostUnresolvable"; detail: string };

/**
 * Kiểm URSIM_HOST với mọi host thiết bị thật (R9). Trả địa chỉ IP sẽ DÙNG khi đạt.
 */
export async function checkSimHost(
  simHost: string,
  deviceEndpoints: string[],
  resolve: (host: string) => Promise<string[]> = defaultResolveAddresses,
  timeoutMs: number = DEFAULT_DNS_TIMEOUT_MS,
): Promise<SimHostCheck> {
  const simName = hostOfEndpoint(simHost);
  const simAddrs = simName ? await canonicalAddresses(simName, resolve, timeoutMs) : null;
  if (!simName || !simAddrs) {
    return { ok: false, reason: "simTargetUnresolvable", detail: `URSIM_HOST "${simHost}" could not be resolved to an IP address` };
  }
  const simSet = new Set(simAddrs);
  const deviceHosts = [...new Set(deviceEndpoints.map(hostOfEndpoint).filter((h): h is string => !!h))];
  const unresolved: string[] = [];
  const matches: string[] = [];
  await Promise.all(
    deviceHosts.map(async (h) => {
      if (h === simName) {
        matches.push(h);
        return;
      }
      const addrs = await canonicalAddresses(h, resolve, timeoutMs);
      if (!addrs) unresolved.push(h);
      else if (addrs.some((a) => simSet.has(a))) matches.push(h);
    }),
  );
  if (matches.length > 0) {
    return { ok: false, reason: "simTargetIsRealDevice", detail: `URSIM_HOST matches device host(s): ${matches.slice(0, 5).join(", ")}` };
  }
  if (unresolved.length > 0 && !simAddrs.every(isLoopback)) {
    return {
      ok: false,
      reason: "deviceHostUnresolvable",
      detail: `device host(s) could not be resolved, so URSIM_HOST cannot be proven not to be one of them: ${unresolved.slice(0, 5).join(", ")}`,
    };
  }
  return { ok: true, address: simAddrs[0] };
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
  const check = await checkSimHost(
    endpoint.host,
    deviceEndpoints,
    deps.resolveAddresses ?? defaultResolveAddresses,
    deps.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS,
  );
  if (!check.ok) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: "resolveSimTarget", reason: check.reason },
      `${check.detail} — refusing to send power on / brake release / script (sim target must be provably virtual).`,
    );
  }
  // KIỂM = DÙNG: nối tới đúng địa chỉ đã kiểm, không để UrsimClient phân giải lại tên.
  return { targetId, endpoint: { ...endpoint, host: check.address }, configuredHost: endpoint.host, kind: "ursim-virtual" };
}
