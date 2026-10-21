/**
 * ★★ Đợt 8.2 Task 1 — BÍ MẬT của Luồng AI (khoá API / mật khẩu cho node HTTP qua `credentialRef`). Spec §4.6 luật 3.
 *
 *   • AES-256-GCM; khoá 32 byte từ `AI_FLOW_KHOA_BI_MAT` (base64). Vắng / không đủ 32 byte ⇒ MỌI thao tác bí mật từ chối
 *     (`LoiBiMat("THIEU_KHOA")`) — fail-closed; luồng không dùng bí mật không chạm tệp này nên vẫn chạy.
 *   • Mỗi lần mã: IV 12 byte ngẫu nhiên + tag 16 byte + `phienBanKhoa`; AAD = id bí mật (đổi chéo bản mã giữa hai hàng ⇒ hỏng tag).
 *   • Xoay khoá: `AI_FLOW_KHOA_BI_MAT_PHIEN_BAN` (mặc định 1) là phiên bản của khoá hiện hành; bản mã của phiên bản ngay trước
 *     giải bằng `AI_FLOW_KHOA_BI_MAT_CU`. Ghi luôn bằng khoá hiện hành (`maHoaLaiTheoKhoaMoi` đưa hàng cũ sang khoá mới).
 *   • Giá trị CHỈ GHI: không hàm xuất khẩu nào trả giá trị ngoài `giaiMaChoChay` — chỉ động cơ gọi, lúc chạy node.
 *   • `bienTheBiMat` + `cheBiMat` / `cheSau`: thay mọi dạng có thể rò của giá trị (nguyên văn, base64, base64url, mã URL, phần
 *     mật khẩu của "tên:mật khẩu") bằng `[BI_MAT]` trước khi bất cứ gì được ghi vào bước/sự kiện.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { aiFlowCredentials } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";

export type LoaiBiMat = "token" | "tai-khoan" | "khac";
export const LOAI_BI_MAT: readonly LoaiBiMat[] = ["token", "tai-khoan", "khac"];
export const RE_ID_BI_MAT = /^[A-Za-z0-9_-]{1,64}$/;
export const NHAN_CHE = "[BI_MAT]";
const TRAN_GIA_TRI = 8192;

export class LoiBiMat extends Error {
  constructor(
    public readonly code: "THIEU_KHOA" | "KHONG_CO" | "GIAI_MA_HONG" | "KHONG_HOP_LE" | "DA_CO" | "KHONG_CO_DB",
    message: string,
  ) {
    super(message);
    this.name = "LoiBiMat";
  }
}

function docKhoa(raw: string | undefined, ten: string): Buffer {
  const s = (raw ?? "").trim();
  const k = s ? Buffer.from(s, "base64") : Buffer.alloc(0);
  if (k.length !== 32) throw new LoiBiMat("THIEU_KHOA", `${ten} vắng hoặc không phải 32 byte base64 — thao tác bí mật bị từ chối`);
  return k;
}

function phienBanHienTai(env: NodeJS.ProcessEnv): number {
  const raw = (env.AI_FLOW_KHOA_BI_MAT_PHIEN_BAN ?? "1").trim();
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new LoiBiMat("THIEU_KHOA", "AI_FLOW_KHOA_BI_MAT_PHIEN_BAN phải là số nguyên ≥ 1");
  return n;
}

/** Khoá hiện hành (ném `THIEU_KHOA` nếu vắng/sai). */
export function khoaHienTai(env: NodeJS.ProcessEnv = process.env): { khoa: Buffer; phienBan: number } {
  return { khoa: docKhoa(env.AI_FLOW_KHOA_BI_MAT, "AI_FLOW_KHOA_BI_MAT"), phienBan: phienBanHienTai(env) };
}

function khoaCho(phienBan: number, env: NodeJS.ProcessEnv): Buffer {
  const ht = khoaHienTai(env);
  if (phienBan === ht.phienBan) return ht.khoa;
  if (phienBan === ht.phienBan - 1 && (env.AI_FLOW_KHOA_BI_MAT_CU ?? "").trim()) return docKhoa(env.AI_FLOW_KHOA_BI_MAT_CU, "AI_FLOW_KHOA_BI_MAT_CU");
  throw new LoiBiMat("THIEU_KHOA", `không có khoá cho phiên bản ${phienBan} (hiện hành ${ht.phienBan})`);
}

const aad = (id: string) => Buffer.from(`ai_flow_credentials:${id}`, "utf8");

export interface BanMa {
  banMa: Buffer;
  iv: Buffer;
  tag: Buffer;
  phienBanKhoa: number;
}

/** Mã một giá trị cho bí mật `id` bằng khoá hiện hành. */
export function maHoa(id: string, giaTri: string, env: NodeJS.ProcessEnv = process.env): BanMa {
  const { khoa, phienBan } = khoaHienTai(env);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", khoa, iv);
  c.setAAD(aad(id));
  const banMa = Buffer.concat([c.update(giaTri, "utf8"), c.final()]);
  return { banMa, iv, tag: c.getAuthTag(), phienBanKhoa: phienBan };
}

/** Giải một bản mã (sai tag / sai khoá / sai id ⇒ `GIAI_MA_HONG`). */
export function giaiMa(id: string, b: BanMa, env: NodeJS.ProcessEnv = process.env): string {
  const khoa = khoaCho(b.phienBanKhoa, env);
  try {
    const d = createDecipheriv("aes-256-gcm", khoa, Buffer.from(b.iv));
    d.setAAD(aad(id));
    d.setAuthTag(Buffer.from(b.tag));
    return Buffer.concat([d.update(Buffer.from(b.banMa)), d.final()]).toString("utf8");
  } catch {
    throw new LoiBiMat("GIAI_MA_HONG", `bí mật '${id}' không giải mã được (khoá sai hoặc bản mã bị sửa)`);
  }
}

/** Hostname hợp lệ cho `hostChoPhep`: chữ thường/số/gạch/chấm, không scheme, cổng, đường dẫn hay ký tự đại diện. */
export const RE_HOST_BI_MAT = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Chuẩn hoá + kiểm danh sách host (1–20, không trùng, không rỗng). Sai ⇒ KHONG_HOP_LE. */
export function chuanHoaHost(ds: unknown): string[] {
  if (!Array.isArray(ds) || ds.length < 1 || ds.length > 20) throw new LoiBiMat("KHONG_HOP_LE", "hostChoPhep phải có 1–20 hostname");
  const ra = new Set<string>();
  for (const h of ds) {
    const x = typeof h === "string" ? h.trim().toLowerCase() : "";
    if (!RE_HOST_BI_MAT.test(x)) throw new LoiBiMat("KHONG_HOP_LE", `host '${String(h).slice(0, 64)}' không hợp lệ (chỉ hostname: không scheme, cổng, đường dẫn, ký tự đại diện)`);
    ra.add(x);
  }
  return [...ra];
}

export function kiemGiaTri(loai: string, giaTri: string): void {
  if (!LOAI_BI_MAT.includes(loai as LoaiBiMat)) throw new LoiBiMat("KHONG_HOP_LE", `loại bí mật '${loai}' không hợp lệ`);
  if (typeof giaTri !== "string" || giaTri.length < 4 || giaTri.length > TRAN_GIA_TRI) {
    throw new LoiBiMat("KHONG_HOP_LE", `giá trị bí mật phải dài 4–${TRAN_GIA_TRI} ký tự`);
  }
  // CR/LF/NUL trong tiêu đề HTTP = tách tiêu đề (và lỗi của fetch có thể lặp lại giá trị) ⇒ chặn ngay lúc tạo.
  if (/[\r\n\0]/.test(giaTri)) throw new LoiBiMat("KHONG_HOP_LE", "giá trị bí mật không được chứa xuống dòng / NUL");
  if (loai === "tai-khoan" && !giaTri.includes(":")) throw new LoiBiMat("KHONG_HOP_LE", "bí mật loại tai-khoan phải có dạng 'tên:mật khẩu'");
}

async function layDb() {
  const db = await getDb();
  if (!db) throw new LoiBiMat("KHONG_CO_DB", "không có kết nối CSDL");
  return db;
}

/** Tạo (hoặc `ghiDe` — thay giá trị) một bí mật. Trả thông tin KHÔNG có giá trị. */
export async function taoBiMat(
  y: { id: string; ten: string; loai: string; giaTri: string; ghiDe?: boolean; /** Đợt 9 — phạm vi nhà máy (vắng/NULL = toàn hệ thống: chỉ admin dùng). */ factoryId?: number | null; /** Đợt 9 (M2) — host được phép; vắng ⇒ [] = CHƯA khai, chưa dùng được. */ hostChoPhep?: string[] },
  userId: number | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ id: string; ten: string; loai: string; phienBanKhoa: number }> {
  if (!RE_ID_BI_MAT.test(y.id)) throw new LoiBiMat("KHONG_HOP_LE", "id bí mật phải khớp ^[A-Za-z0-9_-]{1,64}$");
  const ten = String(y.ten ?? "").trim();
  if (!ten || ten.length > 120) throw new LoiBiMat("KHONG_HOP_LE", "tên bí mật phải dài 1–120 ký tự");
  kiemGiaTri(y.loai, y.giaTri);
  const m = maHoa(y.id, y.giaTri, env);
  const db = await layDb();
  const host = y.hostChoPhep === undefined ? undefined : chuanHoaHost(y.hostChoPhep);
  const hang = { id: y.id, ten, loai: y.loai, ...m, createdBy: userId, factoryId: y.factoryId ?? null, hostChoPhep: host ?? [] };
  const q = db.insert(aiFlowCredentials).values(hang);
  const ra = y.ghiDe
    ? await q.onConflictDoUpdate({ target: aiFlowCredentials.id, set: { ten, loai: y.loai, ...m, createdBy: userId, ...(y.factoryId !== undefined ? { factoryId: y.factoryId } : {}), ...(host ? { hostChoPhep: host } : {}) } }).returning({ id: aiFlowCredentials.id })
    : await q.onConflictDoNothing().returning({ id: aiFlowCredentials.id });
  if (!ra.length) throw new LoiBiMat("DA_CO", `bí mật '${y.id}' đã có`);
  return { id: y.id, ten, loai: y.loai, phienBanKhoa: m.phienBanKhoa };
}

/** Đặt (thay) danh sách host của một bí mật — admin. Không đụng giá trị. `false` nếu không có bí mật. */
export async function datHostBiMat(id: string, ds: unknown): Promise<string[] | false> {
  const host = chuanHoaHost(ds);
  const db = await layDb();
  const ra = await db.update(aiFlowCredentials).set({ hostChoPhep: host }).where(eq(aiFlowCredentials.id, id)).returning({ id: aiFlowCredentials.id });
  return ra.length ? host : false;
}

export async function xoaBiMat(id: string): Promise<boolean> {
  const db = await layDb();
  const ra = await db.delete(aiFlowCredentials).where(eq(aiFlowCredentials.id, id)).returning({ id: aiFlowCredentials.id });
  return ra.length > 0;
}

/** Danh sách — KHÔNG BAO GIỜ có giá trị hay bản mã. */
export async function lietKeBiMat(): Promise<{ id: string; ten: string; loai: string; phienBanKhoa: number; createdBy: number | null; createdAt: Date }[]> {
  const db = await layDb();
  return db
    .select({
      id: aiFlowCredentials.id, ten: aiFlowCredentials.ten, loai: aiFlowCredentials.loai, phienBanKhoa: aiFlowCredentials.phienBanKhoa,
      createdBy: aiFlowCredentials.createdBy, createdAt: aiFlowCredentials.createdAt,
    })
    .from(aiFlowCredentials)
    .orderBy(asc(aiFlowCredentials.id));
}

/** ⚠ NỘI BỘ ĐỘNG CƠ: giải mã đúng lúc chạy node. Không gọi từ router / không trả ra API. */
export async function giaiMaChoChay(id: string, env: NodeJS.ProcessEnv = process.env): Promise<{ giaTri: string; loai: LoaiBiMat; hostChoPhep: string[] }> {
  khoaHienTai(env); // fail-closed TRƯỚC khi đọc CSDL
  const db = await layDb();
  const [h] = await db.select().from(aiFlowCredentials).where(eq(aiFlowCredentials.id, id));
  if (!h) throw new LoiBiMat("KHONG_CO", `không có bí mật '${id}'`);
  return { giaTri: giaiMa(id, h, env), loai: h.loai as LoaiBiMat, hostChoPhep: h.hostChoPhep ?? [] };
}

/** Mã lại mọi hàng chưa ở khoá hiện hành (sau khi xoay khoá). Trả số hàng đã chuyển. */
export async function maHoaLaiTheoKhoaMoi(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { phienBan } = khoaHienTai(env);
  const db = await layDb();
  const hang = await db.select().from(aiFlowCredentials);
  let n = 0;
  for (const h of hang) {
    if (h.phienBanKhoa === phienBan) continue;
    const m = maHoa(h.id, giaiMa(h.id, h, env), env);
    await db.update(aiFlowCredentials).set(m).where(eq(aiFlowCredentials.id, h.id));
    n++;
  }
  return n;
}

// ── che ─────────────────────────────────────────────────────────────────────────────────────────

/** Mọi dạng của giá trị có thể lọt vào chuỗi lỗi / phản hồi (dài trước để thay chuỗi dài nhất trước). */
export function bienTheBiMat(giaTri: string, loai?: string): string[] {
  const ds = new Set<string>([giaTri]);
  const b64 = Buffer.from(giaTri, "utf8").toString("base64");
  ds.add(b64);
  ds.add(b64.replace(/=+$/, ""));
  ds.add(Buffer.from(giaTri, "utf8").toString("base64url"));
  ds.add(encodeURIComponent(giaTri));
  if (loai === "tai-khoan") {
    const mk = giaTri.slice(giaTri.indexOf(":") + 1);
    ds.add(mk);
    ds.add(encodeURIComponent(mk));
  }
  return [...ds].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
}

/** Thay mọi biến thể bằng `[BI_MAT]` trong một chuỗi. */
export function cheBiMat(chuoi: string, bienThe: readonly string[]): string {
  let s = chuoi;
  for (const v of bienThe) if (v && s.includes(v)) s = s.split(v).join(NHAN_CHE);
  return s;
}

/** Che sâu trong một giá trị JSON (chuỗi + khoá đối tượng). Không có biến thể ⇒ trả nguyên. */
export function cheSau<T>(v: T, bienThe: readonly string[]): T {
  if (!bienThe.length) return v;
  const di = (x: unknown): unknown => {
    if (typeof x === "string") return cheBiMat(x, bienThe);
    if (Array.isArray(x)) return x.map(di);
    if (x && typeof x === "object" && !(x instanceof Date)) {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, y]) => [cheBiMat(k, bienThe), di(y)]));
    }
    return x;
  };
  return di(v) as T;
}

// ── xoay khoá (Đợt 9.4) ──────────────────────────────────────────────────────────────────────────

export interface KetQuaXoayKhoa {
  kho: boolean;
  /** Số bí mật trong phạm vi. */
  tong: number;
  /** Số hàng chưa ở phiên bản khoá hiện hành. */
  canChuyen: number;
  /** Số hàng đã mã lại (0 khi chạy khô). */
  daChuyen: number;
  phienBanDen: number;
}

/**
 * ★★ Đợt 9.4 — QUY TRÌNH XOAY KHOÁ. Đặt khoá mới vào `AI_FLOW_KHOA_BI_MAT` + `…_PHIEN_BAN` = n+1, khoá cũ vào `…_CU`, rồi gọi
 * hàm này (CLI `scripts/flow-xoay-khoa.ts`). Hàm:
 *   1. khoá mọi hàng trong phạm vi (`FOR UPDATE`) và TIỀN KIỂM: hàng nào không có khoá giải (phiên bản cách hiện hành > 1, hoặc
 *      thiếu `…_CU`) ⇒ `THIEU_KHOA` liệt kê id@phiên-bản — chưa đổi gì;
 *   2. giải từng hàng (kể cả hàng đã ở khoá hiện hành — hàng hỏng bị báo sớm), mã lại bằng khoá hiện hành (IV mới);
 *   3. ĐỌC LẠI hàng vừa ghi và giải CHỈ bằng khoá hiện hành (không `…_CU`) — chứng minh khoá cũ không còn cần;
 *   4. tất cả trong MỘT giao dịch: bất kỳ hàng nào lỗi ⇒ lùi cả lô.
 * `kho: true` làm bước 1–2 (kể cả giải thử) nhưng không ghi. Kết quả / lỗi chỉ mang id + số đếm — không giá trị, bản mã, khoá.
 */
export async function xoayKhoaBiMat(
  env: NodeJS.ProcessEnv = process.env,
  tuyChon: { kho?: boolean; tienTo?: string } = {},
): Promise<KetQuaXoayKhoa> {
  const { phienBan } = khoaHienTai(env); // fail-closed trước khi chạm CSDL
  const chiKhoaMoi = { AI_FLOW_KHOA_BI_MAT: env.AI_FLOW_KHOA_BI_MAT, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: env.AI_FLOW_KHOA_BI_MAT_PHIEN_BAN } as NodeJS.ProcessEnv;
  const kho = tuyChon.kho === true;
  const db = await layDb();
  return db.transaction(async (tx) => {
    const q = tx.select().from(aiFlowCredentials);
    const hang = await (tuyChon.tienTo ? q.where(sql`starts_with(${aiFlowCredentials.id}, ${tuyChon.tienTo})`) : q).orderBy(asc(aiFlowCredentials.id)).for("update");

    const khongGiai: string[] = [];
    for (const h of hang) {
      try {
        khoaCho(h.phienBanKhoa, env);
      } catch {
        khongGiai.push(`${h.id}@${h.phienBanKhoa}`);
      }
    }
    if (khongGiai.length) {
      throw new LoiBiMat("THIEU_KHOA", `không có khoá để giải ${khongGiai.length} bí mật (id@phiên-bản): ${khongGiai.slice(0, 20).join(", ")} — phiên bản hiện hành ${phienBan}`);
    }

    const canChuyen = hang.filter((h) => h.phienBanKhoa !== phienBan).length;
    let daChuyen = 0;
    for (const h of hang) {
      const giaTri = giaiMa(h.id, h, env); // hàng hỏng ⇒ GIAI_MA_HONG nêu id
      if (h.phienBanKhoa === phienBan) continue;
      if (kho) continue;
      const m = maHoa(h.id, giaTri, env);
      if (giaiMa(h.id, m, chiKhoaMoi) !== giaTri) throw new LoiBiMat("GIAI_MA_HONG", `bí mật '${h.id}': mã lại xong nhưng giải thử không khớp`);
      await tx.update(aiFlowCredentials).set(m).where(eq(aiFlowCredentials.id, h.id));
      daChuyen++;
    }

    if (!kho && daChuyen) {
      // đọc lại những gì giao dịch vừa ghi, giải CHỈ bằng khoá hiện hành
      const sau = await tx.select().from(aiFlowCredentials).where(sql`${aiFlowCredentials.id} IN (${sql.join(hang.map((h) => sql`${h.id}`), sql`, `)})`);
      for (const h of sau) {
        if (h.phienBanKhoa !== phienBan) throw new LoiBiMat("GIAI_MA_HONG", `bí mật '${h.id}' vẫn ở phiên bản ${h.phienBanKhoa} sau khi mã lại`);
        giaiMa(h.id, h, chiKhoaMoi);
      }
    }
    return { kho, tong: hang.length, canChuyen, daChuyen, phienBanDen: phienBan };
  });
}
