/**
 * ★ Đợt 10.3 Task 10 (B4) — RÀO CHỐNG NHẦM đường vòng: node Luồng gọi ra ngoài (`tich-hop.http-*`, `tich-hop.mcp`) KHÔNG được nhắm tới
 * máy chủ AI ngoài — mọi lượt gọi AI ngoài phải đi qua cổng `goiAiNgoai` (che dữ liệu, trần, sổ, duyệt). Đây là rào chống NHẦM / dán
 * URL tiện tay, KHÔNG chống người có quyền sửa luồng cố tình (họ có thể dựng proxy riêng) — xem docs/AI_FLOW_SECURITY_OPERATIONS.md.
 *
 * Tập chặn:
 *   (1) `DANH_SACH_HOST_AI_MAC_DINH` (khớp hậu tố THEO NHÃN, gồm aggregator) + mẫu Bedrock;
 *   (2) env `AI_NGOAI_HOST_CHAN_THEM` (phẩy);
 *   (3) ĐỘNG: host của mọi `endpoint` khoá `openai_compat` + mọi host trong `ai_ngoai_host_noi_bo`, và TẬP IP chúng phân giải ra
 *       (so với IP đã ghim của lượt gọi ⇒ tên khác cùng máy cũng bị chặn). Bộ nhớ đệm 60 s.
 */
import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import { LoiHttpLuong, phanGiaiDns, type DichDen } from "../../flow/nut/mangAnToan";

export const DANH_SACH_HOST_AI_MAC_DINH: readonly string[] = [
  "anthropic.com",
  "claude.ai",
  "openai.com",
  "chatgpt.com",
  "generativelanguage.googleapis.com",
  "aiplatform.googleapis.com",
  "openai.azure.com",
  "cognitiveservices.azure.com",
  "openrouter.ai",
  "api.groq.com",
  "api.mistral.ai",
  "api.together.xyz",
  "api.together.ai",
  "api.deepseek.com",
  "api.cohere.com",
  "api.cohere.ai",
  "api.x.ai",
  "api.perplexity.ai",
  "api.fireworks.ai",
];
/** Bedrock: `bedrock-runtime.<vùng>.amazonaws.com` (+ biến thể agent / fips). */
const RE_BEDROCK = /^bedrock(?:-agent)?(?:-runtime)?(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com$/;

export function chuanHoaHost(h: string): string {
  const bo = h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return isIP(bo) ? bo : domainToASCII(bo) || bo;
}

export function hostChanThemEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.AI_NGOAI_HOST_CHAN_THEM ?? "")
    .split(",")
    .map((x) => chuanHoaHost(x))
    .filter(Boolean);
}

const khopHauTo = (host: string, mien: string) => host === mien || host.endsWith(`.${mien}`);

/** Host (sau chuẩn hoá) thuộc danh sách mặc định / mẫu Bedrock / env bổ sung. */
export function laHostAiNgoai(hostname: string, them: readonly string[] = hostChanThemEnv()): boolean {
  const host = chuanHoaHost(hostname);
  if (!host) return false;
  if (RE_BEDROCK.test(host)) return true;
  return [...DANH_SACH_HOST_AI_MAC_DINH, ...them].some((m) => khopHauTo(host, m));
}

// ── tập ĐỘNG (khoá tương thích + host nội bộ đã khai) ──────────────────────────────────────────────
export interface TapDong {
  host: ReadonlySet<string>;
  ip: ReadonlySet<string>;
}
type HamDocHostDong = () => Promise<string[]>;

const docHostDongThat: HamDocHostDong = async () => {
  const { getDb } = await import("../../../db/connection");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return [];
  const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;
  const khoa = hang(await db.execute(sql`SELECT endpoint FROM ai_api_keys WHERE provider = 'openai_compat' AND endpoint IS NOT NULL`));
  const noiBo = hang(await db.execute(sql`SELECT DISTINCT "hostCong" FROM ai_ngoai_host_noi_bo`));
  const ra: string[] = [];
  for (const k of khoa) {
    try {
      ra.push(new URL(String(k.endpoint)).hostname);
    } catch {
      /* endpoint hỏng: đã bị kiểm lúc lưu — bỏ qua */
    }
  }
  for (const h of noiBo) ra.push(String(h.hostCong).replace(/:\d+$/, ""));
  return ra;
};
let docHostDong: HamDocHostDong = docHostDongThat;
let boNho: { luc: number; tap: TapDong } | null = null;
const TTL_MS = 60_000;

/** Lưới: thay nguồn host động (null ⇒ CSDL thật); luôn xoá bộ nhớ đệm. */
export function __datNguonHostDongChoTest(f: HamDocHostDong | null): void {
  docHostDong = f ?? docHostDongThat;
  boNho = null;
}

export async function layTapDong(): Promise<TapDong> {
  if (boNho && Date.now() - boNho.luc < TTL_MS) return boNho.tap;
  let tho: string[];
  try {
    tho = await docHostDong();
  } catch {
    // không đọc được tập động ⇒ ĐÓNG (không biết đích có phải máy chủ AI đã khai hay không)
    throw new LoiHttpLuong("không đọc được danh sách máy chủ AI ngoài đã khai — tạm từ chối gọi ra ngoài", "DICH_AI_KHONG_RO");
  }
  const host = new Set(tho.map(chuanHoaHost).filter(Boolean));
  const ip = new Set<string>();
  for (const h of host) {
    if (isIP(h)) {
      ip.add(h);
      continue;
    }
    try {
      for (const d of await phanGiaiDns(h)) ip.add(d.address);
    } catch {
      /* không phân giải được lúc này — vẫn chặn theo TÊN */
    }
  }
  const tap = { host, ip };
  boNho = { luc: Date.now(), tap };
  return tap;
}

/**
 * Ném `LoiHttpLuong(…, "DICH_LA_AI_NGOAI")` nếu đích là máy chủ AI ngoài: host khớp danh sách tĩnh / env / host động, HOẶC IP đã ghim
 * của lượt gọi (`dich.ip`) thuộc tập IP của host động. Gọi SAU `kiemDichDen` (để có IP đã ghim) và TRƯỚC khi kết nối.
 */
export async function chanHostAiNgoai(url: URL, dich?: DichDen): Promise<void> {
  const host = chuanHoaHost(url.hostname);
  const tap = laHostAiNgoai(host) ? null : await layTapDong();
  if (!tap || tap.host.has(host) || (dich && tap.ip.has(dich.ip))) {
    throw new LoiHttpLuong(`đích '${host.slice(0, 100)}' là máy chủ AI ngoài — chỉ gọi qua node AI với model 'ngoai:…' (cổng AI ngoài: che dữ liệu, trần, sổ, duyệt)`, "DICH_LA_AI_NGOAI");
  }
}
