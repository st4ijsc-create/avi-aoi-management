/**
 * ★★ Đợt 8.1 — NODE TÍCH HỢP: HTTP, tách HAI loại vì hạng tác dụng phụ khai theo LOẠI node:
 *   tich-hop.http-doc   GET            · hạng `doc`        · `idempotent`
 *   tich-hop.http-gui   POST/PUT/PATCH/DELETE · `ngoai-ghi` · `atMostOnce` (gửi kèm `Idempotency-Key` = khoá bước)
 * Hàng rào: chỉ host trong `AI_FLOW_HTTP_HOST_CHO_PHEP` (danh sách, mặc định RỖNG ⇒ từ chối mọi host); chỉ http/https;
 * KHÔNG theo chuyển hướng (`redirect: "manual"` — 3xx trả về như kết quả, không đi sang host khác); trần 30 s; trần thân
 * phản hồi 1 MB. URL/thân/tiêu đề là biểu thức theo item; tiêu đề `Authorization`/`Cookie` chỉ lấy từ credential (8.2).
 */
import { danhGiaThamSo, type ItemLuong } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type KetQuaChay, type NguCanhChay } from "../dangKyNut";

export class LoiHttpLuong extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiHttpLuong";
  }
}

const TRAN_THAN = 1024 * 1024;
const TIEU_DE_CAM = new Set(["authorization", "cookie", "proxy-authorization", "host"]);

export function hostChoPhep(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.AI_FLOW_HTTP_HOST_CHO_PHEP ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** Kiểm URL theo danh sách trắng. Trả URL đã phân tích hoặc ném. */
export function kiemUrl(raw: unknown, choPhep: Set<string>): URL {
  let u: URL;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    throw new LoiHttpLuong(`URL không hợp lệ: ${String(raw).slice(0, 200)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new LoiHttpLuong(`chỉ http/https (nhận ${u.protocol})`);
  if (u.username || u.password) throw new LoiHttpLuong("URL không được chứa tài khoản/mật khẩu");
  if (!choPhep.has(u.hostname.toLowerCase())) {
    throw new LoiHttpLuong(`host '${u.hostname}' không có trong AI_FLOW_HTTP_HOST_CHO_PHEP`);
  }
  return u;
}

export type HamFetch = typeof fetch;
let fetchLuong: HamFetch = (...a) => fetch(...a);
/** Chỉ lưới. */
export function datFetchLuong(f: HamFetch | null): HamFetch {
  const cu = fetchLuong;
  if (f) fetchLuong = f;
  return cu;
}

async function goi(phuongThuc: string, item: ItemLuong, vao: ItemLuong[], thamSo: Record<string, unknown>, ngu: NguCanhChay, gui: boolean): Promise<ItemLuong> {
  const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
  const url = kiemUrl(t.url, hostChoPhep());
  const tieuDe: Record<string, string> = {};
  for (const [k, v] of Object.entries((t.tieuDe as Record<string, unknown>) ?? {})) {
    if (TIEU_DE_CAM.has(k.toLowerCase())) throw new LoiHttpLuong(`tiêu đề '${k}' chỉ được lấy từ credential`);
    tieuDe[k] = String(v);
  }
  if (gui) tieuDe["Idempotency-Key"] = ngu.idempotencyKey;
  let than: string | undefined;
  if (gui && t.than !== undefined) {
    than = typeof t.than === "string" ? t.than : JSON.stringify(t.than);
    tieuDe["Content-Type"] ??= typeof t.than === "string" ? "text/plain; charset=utf-8" : "application/json";
  }
  const r = await fetchLuong(url, { method: phuongThuc, headers: tieuDe, body: than, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const chu = await r.text();
  if (chu.length > TRAN_THAN) throw new LoiHttpLuong(`phản hồi quá ${TRAN_THAN} byte`);
  let duLieu: unknown = chu;
  if ((r.headers.get("content-type") ?? "").includes("json")) {
    try {
      duLieu = JSON.parse(chu);
    } catch {
      /* giữ chuỗi */
    }
  }
  if (!r.ok && t.loiKhiKhong2xx !== false) throw new LoiHttpLuong(`HTTP ${r.status} từ ${url.hostname}`);
  return { json: { ...item.json, [String(t.truongRa ?? "phanHoi")]: { trangThai: r.status, duLieu } } };
}

dangKyNut({
  type: "tich-hop.http-doc",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "doc",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const vao = ngu.inputs.main ?? [];
    const ra: ItemLuong[] = [];
    for (const item of vao) ra.push(await goi("GET", item, vao, thamSo, ngu, false));
    return { main: ra };
  },
});

dangKyNut({
  type: "tich-hop.http-gui",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "ngoai-ghi",
  lapLai: "atMostOnce",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const pt = String(thamSo.phuongThuc ?? "POST").toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(pt)) throw new LoiHttpLuong(`phương thức '${pt}' không hợp lệ cho http-gui`);
    const vao = ngu.inputs.main ?? [];
    const ra: ItemLuong[] = [];
    for (const item of vao) ra.push(await goi(pt, item, vao, thamSo, ngu, true));
    return { main: ra };
  },
});
