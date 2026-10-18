/**
 * ★ 2026-10-18 — bảng kiểu .NET → namespace cho bộ bổ sung `using` sau sinh (R2B, `../boSungUsingCSharp.ts`) và cho nhánh
 * `api` của `search_docs` (`../agent/timTaiLieuAgent.ts`).
 *
 * Hai tệp:
 *   • `knowledge/api-ref/dotnet-using.json` — bảng CHỌN TAY (ADO.NET, theo dõi trong git; đo R2B 21→34/35 khối);
 *   • `knowledge/api-ref/ky-hieu/dotnet-kieu-ns.json` — bảng SINH từ toàn bộ XML IntelliSense (.NET 10 + ASP.NET Core +
 *     NuGet dự án) bởi `scripts/ai-kb/api-ref/dung-chi-muc-api.mjs` (gitignore).
 * Hợp nhất TƯƠNG THÍCH: tên bảng cũ có ⇒ giữ nguyên bảng cũ; tên MỚI ⇒ `kieuMoRong` (dùng có rào, xem `boSungUsingCSharp`);
 * `moRong` (phương thức mở rộng) CHỈ từ bảng cũ — bảng sinh trên mọi namespace sẽ khớp nhầm các lời gọi thường
 * (`.Append("…")` của StringBuilder ⇒ `HeaderDictionaryExtensions`).
 */
import fs from "node:fs";
import path from "node:path";
import type { ChiMucUsing } from "../boSungUsingCSharp";

export type ChiMucUsingCoNguon = ChiMucUsing & { nguon?: string[] };

type TepBang = { nguon?: string[]; kieu?: Record<string, string[]>; moRong?: ChiMucUsing["moRong"]; nsBiet?: string[] } | null;

export function hopNhatChiMucUsing(cu: TepBang, sinh: TepBang): ChiMucUsingCoNguon | null {
  if (!cu && !sinh) return null;
  if (!sinh) return cu as ChiMucUsingCoNguon;
  const kieuCu = cu?.kieu ?? {};
  const kieuMoRong: Record<string, string[]> = {};
  for (const [ten, ds] of Object.entries(sinh.kieu ?? {})) {
    if (Object.prototype.hasOwnProperty.call(kieuCu, ten)) continue;
    if (Array.isArray(ds) && ds.length > 0) kieuMoRong[ten] = ds;
  }
  const nsBiet = new Set<string>(sinh.nsBiet ?? []);
  for (const ds of Object.values(kieuCu)) for (const n of ds) nsBiet.add(n);
  return {
    ...(cu?.nguon || sinh.nguon ? { nguon: [...(cu?.nguon ?? []), ...(sinh.nguon ?? [])] } : {}),
    kieu: kieuCu,
    moRong: cu?.moRong ?? {},
    kieuMoRong,
    nsBiet: [...nsBiet],
  };
}

function docJson(p: string): TepBang {
  try {
    if (!fs.existsSync(p)) return null;
    const v = JSON.parse(fs.readFileSync(p, "utf8"));
    return v && typeof v === "object" && v.kieu && typeof v.kieu === "object" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Nạp + hợp nhất hai bảng dưới `gocKnowledge` (mặc định `<cwd>/knowledge`). Không ném. Ablation A/B:
 * `AI_CODING_USING_MO_RONG=0` ⇒ chỉ bảng chọn tay (hành vi trước 2026-10-18).
 */
export function napChiMucUsingDotnet(gocKnowledge = path.join(process.cwd(), "knowledge")): ChiMucUsingCoNguon | null {
  const cu = docJson(path.join(gocKnowledge, "api-ref", "dotnet-using.json"));
  const tat = String(process.env.AI_CODING_USING_MO_RONG ?? "").trim() === "0";
  const sinh = tat ? null : docJson(path.join(gocKnowledge, "api-ref", "ky-hieu", "dotnet-kieu-ns.json"));
  return hopNhatChiMucUsing(cu, sinh);
}
