/**
 * kiem-dinh R1b-1 I1 (a) + I3 (điều phối 2026-10-25) — BÁM ĐỊNH NGHĨA của tag nguồn / đích một luật interlock, chụp lúc DUYỆT.
 *
 * Vì sao: duyệt một luật là duyệt "khi nguồn X đọc vượt ngưỡng thì ghi giá trị V xuống thanh ghi Y của thiết bị Z". Trước bản sửa, `approvedBy`
 * sống tiếp khi X / Y / Z đổi định nghĩa (address, kiểu, scale / offset, adapter) hay adapter đổi CHỦ EDGE (`changeDeviceOwner` — đổi đích:
 * lệnh tới node edge khác) — qua `deviceAdapter.tags.update` (có TOTP), `scripts/mappings-import.mjs --cho-phep-tag-bao-ve`, đường robot, hay ghi
 * thẳng bảng — và người duyệt lại không thấy định nghĩa đã đổi. Nay:
 *   • `approve` chụp bám vào `interlock_rules."approvedDefHash"` (mig 0434) VÀ đưa bám vào `versionToken` (duyệt ĐÚNG định nghĩa đang xem);
 *   • luật chỉ "ĐÃ DUYỆT CÒN HIỆU LỰC" khi `approvedBy` khác NULL VÀ bám HIỆN TẠI == bám đã chụp (`duyetConHieuLuc`) — fail-closed: NULL (duyệt
 *     trước bản build) / lệch / không tính được ⇒ CHƯA duyệt. Áp ở: `interlock.enable` (từ chối), engine (không tự chặn), dispatcher
 *     (`verifyInterlockAuthorization` từ chối lệnh interlock).
 *   • KHÔNG áp ở hai chỗ mà "coi là chưa duyệt" sẽ NỚI an toàn (chiều fail-open): cổng inline `interlockGate` (luật bật vẫn CHẶN lệnh theo điều
 *     kiện) và `troLaiKenh.luatBaoVe` (luật đã duyệt — dù bám lệch — vẫn BẢO VỆ tag của nó: sửa tag vẫn cần TOTP). Lệch bám không bao giờ làm
 *     một tag hết được bảo vệ hay một lệnh hết bị chặn.
 *
 * NỘI DUNG BÁM (dạng chuẩn hoá, khoá sắp xếp — `stableJson`):
 *   • đích (`targetAdapterId` khác NULL): adapter { id, có tồn tại, edgeNodeId } + (khi có `commandTag`) tag { tagKey, address, dataType, scale,
 *     offset } — tag vắng ⇒ null (vẫn bám: tạo tag lên khoá sau khi duyệt cũng là đổi định nghĩa);
 *   • nguồn (`sourceType = 'telemetry_tag'` + `machineId` + `sourceKey`): MỌI tag mang `sourceKey` trên MỌI adapter của máy đó (sắp theo
 *     adapterId) { adapterId, edgeNodeId, address, dataType, scale, offset } — thêm / bớt / chuyển adapter giữa các máy cũng đổi bám;
 *   • scale / offset chuẩn hoá NHƯ ĐƯỜNG ĐỌC (`troLaiKenh.scaleDoc` / `offsetDoc`: NULL ⇒ 1 / 0) — ghi lại "1" thành "1.000000" không phải thay đổi;
 *   • luật không có đích tag lẫn nguồn tag (chỉ `targetMachineId`, nguồn spc / ng_rate …) ⇒ bám hằng (không có định nghĩa tag để đổi).
 * Cột của CHÍNH luật đã nằm trong `versionToken` (sửa luật ⇒ MOC bỏ duyệt) — bám này chỉ phủ phần định nghĩa nằm NGOÀI hàng luật.
 *
 * Đọc KHÔNG khoá (các bên gọi đã khoá LUẬT FOR UPDATE; khoá adapter sau luật là đảo thứ tự `congAdapterTx`). Đua với một lượt sửa tag / đổi chủ
 * edge chỉ có thể làm bám đã chụp CŨ hơn định nghĩa ⇒ lần kiểm sau thấy lệch ⇒ chưa duyệt (chiều an toàn).
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { InterlockRule } from "../../../drizzle/schema";

/**
 * Chuẩn hoá NHƯ ĐƯỜNG ĐỌC — CÙNG công thức `troLaiKenh.scaleDoc` / `offsetDoc` (chép, không import: module này nằm trên đường nóng của dispatcher
 * và engine, không kéo chuỗi phụ thuộc của troLaiKenh vào đó). `dinhNghiaDuyet.test.ts` so hai bản trên cùng bộ giá trị.
 */
export function scaleBam(v: unknown): number {
  if (v === null || v === undefined || v === "") return 1;
  return Number(v);
}
export function offsetBam(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  return Number(v);
}

/** Cột luật mà bám cần. */
export type LuatChoBam = Pick<InterlockRule, "id" | "sourceType" | "machineId" | "sourceKey" | "targetAdapterId" | "commandTag">;

// cú pháp PHƯƠNG THỨC (tham số song biến) — nhận cả db lẫn tx của drizzle (`execute(query: string | SQLWrapper)`).
type ChayRaw = { execute(q: ReturnType<typeof sql>): PromiseLike<unknown> };

type DinhNghiaTag = { address: string | null; dataType: string | null; scale: number; offset: number };
export type DinhNghiaLuat = {
  v: 1;
  dich: null | { adapterId: number; adapterTonTai: boolean; edgeNodeId: number | null; tag: null | ({ tagKey: string } & DinhNghiaTag) };
  nguon: null | { machineId: number; sourceKey: string; tags: Array<{ adapterId: number; edgeNodeId: number | null } & DinhNghiaTag> };
};

const hang = (r: unknown): Array<Record<string, unknown>> =>
  Array.isArray(r) ? (r as Array<Record<string, unknown>>) : (((r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>);

function stableJson(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(",")}}`;
}

const soHoacNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dinhNghiaTag = (r: Record<string, unknown>): DinhNghiaTag => ({
  address: r.address == null ? null : String(r.address),
  dataType: r.dataType == null ? null : String(r.dataType),
  scale: scaleBam(r.scale),
  offset: offsetBam(r.offset),
});

/** Luật có đích tag (adapter) / nguồn tag (telemetry_tag đủ máy + khoá) không. */
const coDich = (l: LuatChoBam) => l.targetAdapterId != null;
const coNguon = (l: LuatChoBam) => l.sourceType === "telemetry_tag" && l.machineId != null && !!l.sourceKey;

/**
 * Định nghĩa HIỆN TẠI của nhiều luật trong ≤ 2 lượt đọc (adapter liên quan; tag liên quan). Ném khi DB lỗi — bên gọi quyết (approve / enable ném;
 * `luatDuyetConHieuLuc` đổi thành "chưa duyệt").
 */
export async function dinhNghiaNhieuLuat(d: ChayRaw, luat: ReadonlyArray<LuatChoBam>): Promise<Map<number, DinhNghiaLuat>> {
  const out = new Map<number, DinhNghiaLuat>();
  const idDich = [...new Set(luat.filter(coDich).map((l) => l.targetAdapterId as number))];
  const mayNguon = [...new Set(luat.filter(coNguon).map((l) => l.machineId as number))];
  type HangAdapter = { id: number; machineId: number | null; edgeNodeId: number | null };
  let adapters: HangAdapter[] = [];
  if (idDich.length || mayNguon.length) {
    const dk: ReturnType<typeof sql>[] = [];
    if (idDich.length) dk.push(sql`a.id IN (${sql.join(idDich.map((i) => sql`${i}`), sql`, `)})`);
    if (mayNguon.length) dk.push(sql`a."machineId" IN (${sql.join(mayNguon.map((i) => sql`${i}`), sql`, `)})`);
    adapters = hang(
      await d.execute(sql`SELECT a.id AS id, a."machineId" AS "machineId", a."edgeNodeId" AS "edgeNodeId" FROM public.device_adapters a WHERE ${sql.join(dk, sql` OR `)}`),
    ).map((r) => ({ id: Number(r.id), machineId: soHoacNull(r.machineId), edgeNodeId: soHoacNull(r.edgeNodeId) }));
  }
  const khoaTag = [...new Set([...luat.filter(coDich).map((l) => l.commandTag), ...luat.filter(coNguon).map((l) => l.sourceKey)].filter((k): k is string => !!k))];
  let tags: Array<Record<string, unknown>> = [];
  if (adapters.length && khoaTag.length) {
    tags = hang(
      await d.execute(sql`SELECT t."adapterId" AS "adapterId", t."tagKey" AS "tagKey", t.address AS address, t."dataType"::text AS "dataType",
          t.scale::text AS scale, t."offset"::text AS "offset"
        FROM public.device_tags t
        WHERE t."adapterId" IN (${sql.join(adapters.map((a) => sql`${a.id}`), sql`, `)})
          AND t."tagKey" IN (${sql.join(khoaTag.map((k) => sql`${k}`), sql`, `)})`),
    );
  }
  const adapterTheoId = new Map(adapters.map((a) => [a.id, a] as const));
  const tagTheoCap = new Map(tags.map((t) => [`${Number(t.adapterId)}\u0000${String(t.tagKey)}`, t] as const));
  for (const l of luat) {
    let dich: DinhNghiaLuat["dich"] = null;
    if (coDich(l)) {
      const a = adapterTheoId.get(l.targetAdapterId as number);
      const t = a && l.commandTag ? tagTheoCap.get(`${a.id}\u0000${l.commandTag}`) : undefined;
      dich = {
        adapterId: l.targetAdapterId as number,
        adapterTonTai: !!a,
        edgeNodeId: a?.edgeNodeId ?? null,
        tag: t ? { tagKey: String(t.tagKey), ...dinhNghiaTag(t) } : null,
      };
    }
    let nguon: DinhNghiaLuat["nguon"] = null;
    if (coNguon(l)) {
      const ds = adapters
        .filter((a) => a.machineId === l.machineId)
        .map((a) => ({ a, t: tagTheoCap.get(`${a.id}\u0000${l.sourceKey}`) }))
        .filter((x): x is { a: HangAdapter; t: Record<string, unknown> } => !!x.t)
        .sort((p, q) => p.a.id - q.a.id)
        .map(({ a, t }) => ({ adapterId: a.id, edgeNodeId: a.edgeNodeId, ...dinhNghiaTag(t) }));
      nguon = { machineId: l.machineId as number, sourceKey: l.sourceKey as string, tags: ds };
    }
    out.set(l.id, { v: 1, dich, nguon });
  }
  return out;
}

/** Bám của MỘT định nghĩa: `d1:` + sha256 hex của dạng chuẩn hoá (67 ký tự ≤ varchar(80) của 0434). */
export function bamDinhNghia(dn: DinhNghiaLuat): string {
  return `d1:${createHash("sha256").update(stableJson(dn)).digest("hex")}`;
}

/** Bám HIỆN TẠI của nhiều luật (theo id). Ném khi DB lỗi. */
export async function bamDinhNghiaNhieu(d: ChayRaw, luat: ReadonlyArray<LuatChoBam>): Promise<Map<number, string>> {
  const dn = await dinhNghiaNhieuLuat(d, luat);
  return new Map([...dn].map(([id, x]) => [id, bamDinhNghia(x)] as const));
}

/** Bám HIỆN TẠI của một luật. Ném khi DB lỗi. */
export async function bamDinhNghiaLuat(d: ChayRaw, luat: LuatChoBam): Promise<string> {
  return (await bamDinhNghiaNhieu(d, [luat])).get(luat.id) as string;
}

/** THUẦN — duyệt còn hiệu lực ⇔ có người duyệt VÀ bám đã chụp khác NULL VÀ bằng bám hiện tại. */
export function duyetConHieuLuc(luat: { approvedBy: number | null; approvedDefHash?: string | null }, bamHienTai: string | null | undefined): boolean {
  return luat.approvedBy != null && typeof luat.approvedDefHash === "string" && luat.approvedDefHash.length > 0 && luat.approvedDefHash === bamHienTai;
}

/**
 * Đường THI HÀNH (engine / dispatcher): duyệt còn hiệu lực? KHÔNG BAO GIỜ ném — lỗi đọc / thiếu cột ⇒ false (fail-closed: luật coi như chưa
 * duyệt, không tự gửi lệnh).
 */
export async function luatDuyetConHieuLuc(
  d: ChayRaw | null | undefined,
  luat: LuatChoBam & { approvedBy: number | null; approvedDefHash?: string | null },
): Promise<boolean> {
  if (luat.approvedBy == null || !luat.approvedDefHash || !d || typeof d.execute !== "function") return false;
  try {
    return duyetConHieuLuc(luat, await bamDinhNghiaLuat(d, luat));
  } catch {
    return false;
  }
}
