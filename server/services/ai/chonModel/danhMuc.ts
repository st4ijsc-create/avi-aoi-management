/**
 * ★ Đợt 10.1 A1 — DANH MỤC model chọn được cho mọi bề mặt (chat, lập trình, agent, node Luồng, /v1).
 *
 * Thứ tự: `auto` → 11 vai trò gốc → hồ sơ đủ điều kiện → model ngoài đã bật (10.3). Hồ sơ đủ điều kiện = có ≥ 1 lượt đo
 * + giấy phép đã khai (cùng cổng gán `datGan`); hồ sơ tắt / artifact mất vẫn HIỆN với `tat` (người dùng thấy vì sao không
 * chọn được) nhưng `giaiChonModel` từ chối. Không trường nào mang tên tệp / đường dẫn / cổng.
 */
import { sql, type SQL } from "drizzle-orm";
import { VAI_TRO_GOC } from "../../../../shared/aiRoles";
import { toBasename } from "../modelResolver";
import { hoanDoiKheNangBat } from "../soModel/tapKheNang";
import { BE_MAT_NGOAI_DUOC_DUNG, type MucModel, type PhuThuocDanhMuc, type TrangThaiMuc } from "./kieu";
import type { ProfileTrongAnh } from "../soModel/anhSoModel";

/** Trạng thái của MỘT hồ sơ (dùng chung với `giaiChonModel`); `null` = không thuộc danh mục. */
export function trangThaiHoSo(
  id: string,
  p: ProfileTrongAnh,
  dep: Pick<PhuThuocDanhMuc, "hoSoCoDo" | "kheDangGiu" | "env">,
): TrangThaiMuc | null {
  if (p.license === "unknown" || !dep.hoSoCoDo.has(id)) return null;
  if (!p.enabled || p.artifactStatus !== "available") return "tat";
  if (p.slotClass !== "nang") return "san-sang";
  const env = dep.env ?? process.env;
  const dangGiu = dep.kheDangGiu ? toBasename(dep.kheDangGiu) : toBasename(env.LLAMA_SERVER_MODEL);
  if (toBasename(p.artifactFile) === dangGiu) return "san-sang";
  return hoanDoiKheNangBat(env) ? "can-doi-khe" : "tat";
}

export async function layDanhMucModel(factoryId: number | null, dep: PhuThuocDanhMuc): Promise<MucModel[]> {
  const ds: MucModel[] = [
    { ma: "auto", loai: "auto", nhan: "Tự động", moTa: "Hệ thống chọn theo nội dung câu hỏi", trangThai: "san-sang" },
  ];
  for (const v of VAI_TRO_GOC) {
    const moTa = v.moTa;
    ds.push({ ma: `vai-tro:${v.id}`, loai: "vai-tro", nhan: v.id, moTa, trangThai: "san-sang" });
  }

  let uocTinh: number | null | undefined;
  for (const [id, p] of [...dep.anh.profile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const trangThai = trangThaiHoSo(id, p, dep);
    if (!trangThai) continue;
    const muc: MucModel = { ma: `ho-so:${id}`, loai: "ho-so", nhan: id, moTa: `Hồ sơ ${p.slotClass}`, trangThai };
    if (trangThai === "can-doi-khe") {
      if (uocTinh === undefined) uocTinh = await dep.uocTinhDoiKheGiay().catch(() => null);
      if (uocTinh !== null) muc.uocTinhDoiKheGiay = uocTinh;
    }
    ds.push(muc);
  }

  for (const m of await dep.ngoai.layModelDaBat(factoryId)) {
    ds.push({
      ma: `ngoai:${m.nhaCungCap}:${m.model}`,
      loai: "ngoai",
      nhan: m.nhan,
      moTa: `AI bên ngoài (${m.nhaCungCap})`,
      trangThai: "san-sang",
      nhaCungCap: m.nhaCungCap,
      duocDungO: [...BE_MAT_NGOAI_DUOC_DUNG],
    });
  }
  return ds;
}

const SO_SU_KIEN_UOC_TINH = 20;

/** Trung vị thời gian đổi khe THÀNH CÔNG (20 sự kiện `doi_khe` gần nhất), giây làm tròn; chưa có sự kiện ⇒ null. */
export async function uocTinhDoiKheTuSuKien(db: { execute(q: SQL): Promise<unknown> }): Promise<number | null> {
  const kq = await db.execute(sql`
    SELECT (detail->>'ms')::numeric AS ms FROM vram_events
    WHERE event = 'doi_khe' AND detail->>'ketQua' = 'thanh-cong' AND detail ? 'ms'
    ORDER BY "createdAt" DESC, id DESC LIMIT ${SO_SU_KIEN_UOC_TINH}`);
  const hang = (Array.isArray(kq) ? kq : ((kq as { rows?: unknown[] }).rows ?? [])) as Array<{ ms: unknown }>;
  const ms = hang.map((h) => Number(h.ms)).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (ms.length === 0) return null;
  const giua = Math.floor(ms.length / 2);
  const trungVi = ms.length % 2 ? ms[giua]! : (ms[giua - 1]! + ms[giua]!) / 2;
  return Math.round(trungVi / 1000);
}

/** Phụ thuộc THẬT (ảnh sổ, hồ sơ có lượt đo, khe đang giữ, ước tính từ sự kiện). */
export async function layPhuThuocDanhMucMacDinh(): Promise<PhuThuocDanhMuc> {
  const [{ layAnhSoModel }, { nguCanhKhe }, { getDb }, sm] = await Promise.all([
    import("../soModel/anhSoModel"),
    import("../modelResolver"),
    import("../../../db/connection"),
    import("../../../../drizzle/schema"),
  ]);
  const db = await getDb();
  const hoSoCoDo = db
    ? new Set((await db.selectDistinct({ profileId: sm.aiModelEvalRuns.profileId }).from(sm.aiModelEvalRuns)).map((r) => r.profileId))
    : new Set<string>();
  // ★ Đợt 10.3 — model ngoài THẬT: cờ env + nhà máy bật + model bật (đọc LÚC GỌI, không đệm).
  const { layModelDaBat } = await import("../ngoai/cauHinhNgoai");
  return {
    anh: layAnhSoModel(),
    hoSoCoDo,
    kheDangGiu: nguCanhKhe().kheDangGiu,
    uocTinhDoiKheGiay: async () => (db ? uocTinhDoiKheTuSuKien(db) : null),
    ngoai: { layModelDaBat: (factoryId) => layModelDaBat(db as never, factoryId) },
  };
}
