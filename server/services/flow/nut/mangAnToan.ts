/**
 * ★★★ Đợt 9 (M3 của kiem-dinh) — MẠNG AN TOÀN cho node HTTP của Luồng AI: chống SSRF + DNS rebinding + phản hồi vô hạn.
 *
 *   • PHÂN GIẢI DNS MỘT LẦN rồi kiểm MỌI địa chỉ trả về: loopback · link-local (kể cả metadata 169.254.169.254) · private (RFC 1918) ·
 *     CGNAT · multicast · dành riêng · IPv6 không-công-cộng (ULA, link-local, v4-mapped / NAT64 / 6to4 chứa địa chỉ nội bộ …) ⇒ TỪ CHỐI,
 *     TRỪ KHI danh sách trắng ghi RÕ `host:CỔNG` đúng host + cổng của URL (người vận hành chủ động cho phép đích nội bộ).
 *     Trộn lẫn công cộng + nội bộ ⇒ từ chối (chống rebinding kiểu "trả hai địa chỉ").
 *   • KẾT NỐI TỚI ĐÚNG IP ĐÃ KIỂM (`lookup` bị ghim): TLS/SNI/Host vẫn theo hostname, nhưng lần phân giải DNS thứ hai KHÔNG tồn tại để kẻ
 *     tấn công đổi đáp án.
 *   • KHÔNG theo chuyển hướng (node ném `redirect:"manual"` — tại đây không có đường theo 3xx); trần thời gian theo `signal`.
 *   • Thân phản hồi đọc DẠNG LUỒNG và ngắt ở trần (mặc định 1 MB), kể cả khi máy chủ không khai Content-Length — không `await r.text()`.
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

export class LoiHttpLuong extends Error {
  /** `ma`: mã ỔN ĐỊNH (không dịch) cho UI chú giải — thông điệp tiếng Việt chỉ để người đọc. */
  constructor(message: string, public readonly ma?: string) {
    super(message);
    this.name = "LoiHttpLuong";
  }
}

export interface DichDen {
  ip: string;
  family: 4 | 6;
}

// ── địa chỉ không công cộng ──────────────────────────────────────────────────────────────────────
const V4_KHONG_CONG_KHAI: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const bl4 = new BlockList();
for (const [a, n] of V4_KHONG_CONG_KHAI) bl4.addSubnet(a, n, "ipv4");

/** Mở rộng IPv6 về 8 nhóm 16-bit; `null` nếu không phải IPv6 hợp lệ. */
function moRongV6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let s = ip.toLowerCase().split("%")[0];
  // đuôi dạng IPv4 (::ffff:1.2.3.4)
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    const p = m[2].split(".").map(Number);
    s = `${m[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [dau, cuoi] = s.split("::");
  const a = dau ? dau.split(":") : [];
  const b = cuoi !== undefined ? (cuoi ? cuoi.split(":") : []) : [];
  const thieu = 8 - a.length - b.length;
  const ds = cuoi === undefined ? a : [...a, ...Array(Math.max(0, thieu)).fill("0"), ...b];
  if (ds.length !== 8) return null;
  const so = ds.map((x) => parseInt(x || "0", 16));
  return so.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : so;
}

const v4Tu = (h1: number, h2: number) => `${h1 >> 8}.${h1 & 255}.${h2 >> 8}.${h2 & 255}`;

/**
 * Địa chỉ KHÔNG phải công cộng? Không phân tích được ⇒ coi là KHÔNG công cộng (đóng theo mặc định). IPv6: chỉ `2000::/3` (unicast toàn cầu)
 * mới có thể công cộng — còn lại (::, ::1, ULA fc00::/7, link-local fe80::/10, multicast, NAT64, …) là không công cộng; v4-mapped (::ffff:a.b.c.d)
 * và 6to4 (2002::/16) xét theo địa chỉ IPv4 NHÚNG; 2001:db8::/32 (tài liệu) và 2001::/32 (Teredo) bị loại.
 */
export function laDiaChiNoiBo(ip: string): boolean {
  const f = isIP(ip);
  if (f === 4) return bl4.check(ip, "ipv4");
  if (f === 6) {
    const g = moRongV6(ip);
    if (!g) return true;
    const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return bl4.check(v4Tu(g6, g7), "ipv4"); // v4-mapped
    if (g0 === 0x2002) return bl4.check(v4Tu(g1, g2), "ipv4"); // 6to4 nhúng v4 ở nhóm 2–3
    if ((g0 & 0xe000) !== 0x2000) return true; // ngoài 2000::/3
    if (g0 === 0x2001 && (g1 === 0x0db8 || g1 === 0)) return true; // tài liệu / Teredo
    void g7;
    return false;
  }
  return true;
}

/**
 * ★ Đợt 10.3 (rà kiem-dinh Task 8 E) — link-local / metadata đám mây (169.254.0.0/16, fe80::/10, v4-mapped của chúng): LUÔN cấm, kể cả
 * khi danh sách trắng ghi rõ host:cổng — mục khai chỉ mở dải nội bộ THƯỜNG (máy ERP / LLM trong nhà máy), không mở máy chủ metadata.
 */
export function laDiaChiMetadata(ip: string): boolean {
  const f = isIP(ip);
  const v4 = (s: string) => /^169\.254\./.test(s);
  if (f === 4) return v4(ip);
  if (f === 6) {
    const g = moRongV6(ip);
    if (!g) return true;
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return v4(v4Tu(g[6], g[7]));
    return (g[0] & 0xffc0) === 0xfe80;
  }
  return false;
}

// ── phân giải DNS (tiêm được cho lưới) ───────────────────────────────────────────────────────────
export type HamPhanGiaiDns = (host: string) => Promise<{ address: string; family: number }[]>;
const phanGiaiThat: HamPhanGiaiDns = (host) => dns.lookup(host, { all: true, verbatim: true });
let phanGiai: HamPhanGiaiDns = phanGiaiThat;
/** Phân giải qua bộ HIỆN HÀNH (thật, hoặc bộ lưới đã đặt) — dùng chung cho mô-đun khác cần cùng nguồn DNS (vd `hostAiNgoai`). */
export const phanGiaiDns: HamPhanGiaiDns = (host) => phanGiai(host);

/** Chỉ lưới: thay bộ phân giải DNS. `null` ⇒ về bộ thật. Trả bộ cũ. */
export function datPhanGiaiDns(f: HamPhanGiaiDns | null): HamPhanGiaiDns {
  const cu = phanGiai;
  phanGiai = f ?? phanGiaiThat;
  return cu;
}

const congHieuLuc = (u: URL) => u.port || (u.protocol === "https:" ? "443" : "80");

/** `host:cổng` khai RÕ trong danh sách trắng cho đúng URL này? (đích nội bộ chỉ được phép khi có mục này) */
export function coMucHostCong(u: URL, choPhep: ReadonlySet<string>): boolean {
  return choPhep.has(`${u.hostname.toLowerCase()}:${congHieuLuc(u)}`);
}

/**
 * Phân giải ĐÚNG MỘT LẦN, kiểm mọi địa chỉ, trả IP để GHIM. Trộn công cộng + nội bộ ⇒ từ chối (trừ khi có mục `host:cổng` rõ ràng).
 */
export async function kiemDichDen(url: URL, choPhep: ReadonlySet<string>): Promise<DichDen> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  let ds: { address: string; family: number }[];
  if (isIP(host)) ds = [{ address: host, family: isIP(host) }];
  else {
    try {
      ds = await phanGiai(host);
    } catch {
      throw new LoiHttpLuong(`không phân giải được host '${host.slice(0, 100)}'`);
    }
  }
  if (!ds.length) throw new LoiHttpLuong(`host '${host.slice(0, 100)}' không có địa chỉ`);
  if (ds.some((d) => laDiaChiMetadata(d.address))) {
    throw new LoiHttpLuong(`đích '${host.slice(0, 100)}' là địa chỉ link-local / metadata (nội bộ) — LUÔN cấm, kể cả khi danh sách trắng ghi host:cổng`, "DICH_METADATA");
  }
  const roRang = coMucHostCong(url, choPhep);
  if (!roRang && ds.some((d) => laDiaChiNoiBo(d.address))) {
    throw new LoiHttpLuong(`đích '${host.slice(0, 100)}' là địa chỉ nội bộ / không công cộng — chỉ cho phép khi danh sách trắng ghi rõ host:cổng`, "DICH_NOI_BO");
  }
  const d = ds[0];
  return { ip: d.address, family: isIP(d.address) === 6 ? 6 : 4 };
}

// ── kết nối ghim IP ──────────────────────────────────────────────────────────────────────────────
const KHONG_THAN = new Set([101, 204, 205, 304]);

/**
 * ★ Đợt 10.3 (rà kiem-dinh Task 9) — agent RIÊNG, KHÔNG kế thừa proxy từ env: trên Node ≥ 24, `NODE_USE_ENV_PROXY=1` hoặc
 * `http.setGlobalProxyFromEnv()` làm agent TOÀN CỤC đi qua `HTTP(S)_PROXY` ⇒ proxy tự phân giải / nối đích cuối, vô hiệu ghim IP +
 * `kiemDichDen`. Agent tạo mới không có `proxyEnv` ⇒ luôn nối thẳng tới IP đã ghim. Không keep-alive (mỗi yêu cầu một kết nối ghim).
 */
const AGENT_HTTP = new http.Agent({ keepAlive: false });
const AGENT_HTTPS = new https.Agent({ keepAlive: false });

/**
 * `fetch` tối giản kết nối TỚI ĐÚNG `dich.ip` (ghim `lookup`). Không theo chuyển hướng, không qua proxy env. Trả `Response` chuẩn — thân là luồng.
 */
export function fetchGhim(url: URL, init: RequestInit, dich: DichDen): Promise<Response> {
  const mod = url.protocol === "https:" ? https : http;
  const agent = url.protocol === "https:" ? AGENT_HTTPS : AGENT_HTTP;
  return new Promise<Response>((resolve, reject) => {
    const tieuDe: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) tieuDe[k] = v;
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers: tieuDe,
        signal: init.signal ?? undefined,
        agent,
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          if (opts && opts.all) cb(null, [{ address: dich.ip, family: dich.family }]);
          else cb(null, dich.ip, dich.family);
        }) as never,
      },
      (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) for (const x of v) h.append(k, x);
          else if (v !== undefined) h.set(k, v);
        }
        const status = res.statusCode ?? 0;
        if (KHONG_THAN.has(status)) {
          res.resume();
          resolve(new Response(null, { status, statusText: res.statusMessage, headers: h }));
          return;
        }
        resolve(new Response(Readable.toWeb(res) as unknown as ReadableStream, { status, statusText: res.statusMessage, headers: h }));
      },
    );
    req.once("error", reject);
    req.end(typeof init.body === "string" ? init.body : undefined);
  });
}

/** Đọc thân dạng LUỒNG, ngắt ngay khi vượt `tran` byte (kể cả không có Content-Length). */
export async function docThanCoTran(r: Response, tran: number): Promise<string> {
  return (await docBytesCoTran(r, tran)).toString("utf8");
}

/** Như `docThanCoTran` nhưng trả BYTE (ảnh, tệp nhị phân) — cùng trần, ngắt luồng khi vượt. */
export async function docBytesCoTran(r: Response, tran: number): Promise<Buffer> {
  const cl = Number(r.headers.get("content-length"));
  if (Number.isFinite(cl) && cl > tran) {
    await r.body?.cancel().catch(() => undefined);
    throw new LoiHttpLuong(`phản hồi quá ${tran} byte`);
  }
  if (!r.body) return Buffer.alloc(0);
  const reader = r.body.getReader();
  const manh: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > tran) {
      await reader.cancel().catch(() => undefined);
      throw new LoiHttpLuong(`phản hồi quá ${tran} byte`);
    }
    manh.push(value);
  }
  return Buffer.concat(manh);
}
