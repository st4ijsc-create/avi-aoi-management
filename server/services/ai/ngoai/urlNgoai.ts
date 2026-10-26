/**
 * ★ Đợt 10.3 — kiểm TĨNH endpoint AI ngoài (máy chủ tương thích OpenAI) lúc LƯU khoá (rà kiem-dinh Task 7 F3) — trước khi giá trị được
 * lưu và có thể hiện ra nơi khác. Lúc GỌI còn kiểm lại đầy đủ (DNS + ghim IP — `mangNgoai.ts`, Task 9).
 *   • chỉ `https:` (host công cộng) / `http:` chỉ cho host nội bộ ĐÃ KHAI; cấm userinfo (`user:pw@`), query/fragment mang bí mật;
 *   • chuẩn hoá host: chữ thường, bỏ dấu chấm cuối, punycode;
 *   • link-local / metadata (169.254.0.0/16, fe80::/10, `metadata.google.internal`, `metadata`) LUÔN cấm;
 *   • host nội bộ (localhost, 127/8, 10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7, `.local`, `.internal`, `.lan`, tên không dấu chấm)
 *     chỉ khi `host:cổng` có trong `ai_ngoai_host_noi_bo` của nhà máy.
 */
import { domainToASCII } from "node:url";
import { LoiNgoai } from "./loi";

const RE_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Link-local / metadata — dùng cho cả HOST (lúc lưu) lẫn ĐỊA CHỈ ĐÃ PHÂN GIẢI (lúc gọi, `mangNgoai`). */
export function laLinkLocalHoacMetadata(hostTho: string): boolean {
  // IPv6 ánh xạ IPv4 (::ffff:169.254.x.x) ⇒ xét phần IPv4
  const host = hostTho.replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  const m = host.match(RE_IPV4);
  if (m && Number(m[1]) === 169 && Number(m[2]) === 254) return true;
  if (/^\[?fe[89ab][0-9a-f]:/i.test(host)) return true;
  return host === "metadata.google.internal" || host === "metadata" || host === "instance-data";
}

export function laHostNoiBo(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  const m = h.match(RE_IPV4);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h === "::1" || /^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  return h === "localhost" || !h.includes(".") || /\.(local|internal|lan|localdomain|home|corp)$/.test(h);
}

/** Chuẩn hoá + kiểm; trả URL đã chuẩn hoá. `hostNoiBo`: tập `host:cổng` đã khai của nhà máy. */
export function kiemEndpointLuu(tho: string, hostNoiBo: ReadonlySet<string>): string {
  let u: URL;
  try {
    u = new URL(tho);
  } catch {
    throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "url");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "scheme");
  if (u.username || u.password || tho.includes("@")) throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "userinfo");
  if (u.search || u.hash) throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "query");
  const host = domainToASCII(u.hostname.toLowerCase().replace(/\.$/, ""));
  if (!host) throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "host");
  if (laLinkLocalHoacMetadata(host)) throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "metadata");
  const cong = u.port || (u.protocol === "https:" ? "443" : "80");
  if (laHostNoiBo(host)) {
    if (!hostNoiBo.has(`${host}:${cong}`)) throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "noi-bo-chua-khai");
  } else if (u.protocol !== "https:") {
    throw new LoiNgoai("NGOAI_URL_KHONG_HOP_LE", "can-https");
  }
  u.hostname = host;
  return u.toString().replace(/\/$/, "");
}
