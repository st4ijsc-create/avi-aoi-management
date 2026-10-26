/**
 * ★ Đợt 10.3 Task 10 (B4) — RÀO CHỐNG NHẦM đường vòng: node Luồng gọi ra ngoài (`tich-hop.http-*`, `tich-hop.mcp`) KHÔNG được nhắm tới
 * máy chủ AI ngoài — mọi lượt gọi AI ngoài phải đi qua cổng `goiAiNgoai` (che dữ liệu, trần, sổ, duyệt). Đây là rào chống NHẦM / dán
 * URL tiện tay, KHÔNG chống người có quyền sửa luồng cố tình (họ có thể dựng proxy riêng) — xem docs/AI_FLOW_SECURITY_OPERATIONS.md.
 *
 * Tập chặn:
 *   (1) `DANH_SACH_HOST_AI_MAC_DINH` (khớp hậu tố THEO NHÃN, gồm aggregator) + mẫu Bedrock;
 *   (2) env `AI_NGOAI_HOST_CHAN_THEM` (phẩy);
 *   (3) ĐỘNG: host:cổng của mọi `endpoint` khoá `openai_compat` + mọi mục `ai_ngoai_host_noi_bo`, và IP:cổng chúng phân giải ra
 *       (so với IP:cổng đã ghim của lượt gọi ⇒ tên khác cùng máy CÙNG cổng bị chặn; khác cổng ⇒ dịch vụ khác, cho qua). Bộ nhớ đệm 60 s.
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
// So theo CẶP host:cổng / IP:cổng (rà kiem-dinh 10.3 T10): khai `llm.local:8000` KHÔNG được chặn dịch vụ khác cùng máy (vd `mes.local:3000`
// cùng IP, hay MCP cục bộ 127.0.0.1:8811 khi khai `localhost:8000`).
export interface TapDong {
  /** `host|cổng` */
  hostCong: ReadonlySet<string>;
  /** `ip|cổng` */
  ipCong: ReadonlySet<string>;
}
/** Nguồn tập động: danh sách `host:cổng`. */
type HamDocHostDong = () => Promise<string[]>;
const congMacDinh = (u: URL) => u.port || (u.protocol === "https:" ? "443" : "80");

/** Đọc từ CSDL: endpoint khoá `openai_compat` (host:cổng của URL) + `ai_ngoai_host_noi_bo`. Không có CSDL ⇒ NÉM (đóng, không trả rỗng). */
export async function docHostDongTuDb(layDb?: () => Promise<unknown>): Promise<string[]> {
  const { sql } = await import("drizzle-orm");
  const db = (await (layDb ?? (async () => (await import("../../../db/connection")).getDb()))()) as { execute(q: unknown): Promise<unknown> } | null;
  if (!db) throw new LoiHttpLuong("không có CSDL để đọc danh sách máy chủ AI ngoài đã khai", "DICH_AI_KHONG_RO");
  const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;
  const khoa = hang(await db.execute(sql`SELECT endpoint FROM ai_api_keys WHERE provider = 'openai_compat' AND endpoint IS NOT NULL`));
  const noiBo = hang(await db.execute(sql`SELECT DISTINCT "hostCong" FROM ai_ngoai_host_noi_bo`));
  const ra: string[] = [];
  for (const k of khoa) {
    try {
      const u = new URL(String(k.endpoint));
      ra.push(`${u.hostname}:${congMacDinh(u)}`);
    } catch {
      /* endpoint hỏng: đã bị kiểm lúc lưu — bỏ qua */
    }
  }
  for (const h of noiBo) ra.push(String(h.hostCong));
  return ra;
}
let docHostDong: HamDocHostDong = () => docHostDongTuDb();
let boNho: { luc: number; tap: TapDong } | null = null;
const TTL_MS = 60_000;

/** Lưới: thay nguồn host động (null ⇒ CSDL thật); luôn xoá bộ nhớ đệm. */
export function __datNguonHostDongChoTest(f: HamDocHostDong | null): void {
  docHostDong = f ?? (() => docHostDongTuDb());
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
  const hostCong = new Set<string>();
  const ipCong = new Set<string>();
  for (const muc of tho) {
    const i = muc.lastIndexOf(":");
    const cong = i > 0 ? muc.slice(i + 1) : "";
    const host = chuanHoaHost(i > 0 ? muc.slice(0, i) : muc);
    if (!host || !/^\d{1,5}$/.test(cong)) continue;
    hostCong.add(`${host}|${cong}`);
    if (isIP(host)) {
      ipCong.add(`${host}|${cong}`);
      continue;
    }
    try {
      for (const d of await phanGiaiDns(host)) ipCong.add(`${d.address}|${cong}`);
    } catch {
      /* không phân giải được lúc này — vẫn chặn theo TÊN */
    }
  }
  const tap = { hostCong, ipCong };
  boNho = { luc: Date.now(), tap };
  return tap;
}

/**
 * Ném `LoiHttpLuong(…, "DICH_LA_AI_NGOAI")` nếu đích là máy chủ AI ngoài: host khớp danh sách tĩnh / env, HOẶC `host:cổng` của URL khớp
 * tập động, HOẶC `IP đã ghim:cổng` (`dich.ip`) khớp IP:cổng của tập động. Gọi SAU `kiemDichDen` (để có IP đã ghim) và TRƯỚC khi kết nối.
 */
export async function chanHostAiNgoai(url: URL, dich?: DichDen): Promise<void> {
  const host = chuanHoaHost(url.hostname);
  const cong = congMacDinh(url);
  const tap = laHostAiNgoai(host) ? null : await layTapDong();
  if (!tap || tap.hostCong.has(`${host}|${cong}`) || (dich && tap.ipCong.has(`${dich.ip}|${cong}`))) {
    throw new LoiHttpLuong(`đích '${host.slice(0, 100)}' là máy chủ AI ngoài — chỉ gọi qua node AI với model 'ngoai:…' (cổng AI ngoài: che dữ liệu, trần, sổ, duyệt)`, "DICH_LA_AI_NGOAI");
  }
}
