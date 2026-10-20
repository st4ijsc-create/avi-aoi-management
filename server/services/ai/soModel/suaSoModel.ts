/**
 * ★★ Đợt 7.4 — SỬA SỔ MODEL từ "Trung tâm Model" (spec §3.3, §3.8):
 *   • `suaArtifact` — khai giấy phép + cách ly/bỏ cách ly một artifact. KHÔNG cho đặt `missing`: trạng thái đó chỉ bộ
 *     đồng bộ kho (`dongBoKhoModel`) được ghi, theo việc tệp có trên đĩa hay không. Artifact đang `missing` thì không
 *     đổi trạng thái được ở đây (đặt `available` cho một tệp không có trên đĩa là nói dối) — chỉ sửa giấy phép.
 *   • `luuHoSo` — tạo/sửa (upsert) một hồ sơ phục vụ. Artifact phải tồn tại và `loai = 'sinh-chu'` (hồ sơ là thứ khe
 *     sinh chữ nạp; nhúng/xếp hạng/mmproj không phục vụ qua hồ sơ ở v1). `serverArgs`/`sampling` = `{}` ở v1 (chưa mở
 *     chỉnh — danh sách trắng cờ là việc sau); upsert KHÔNG ghi đè hai ô đó nếu hồ sơ đã có.
 * Router gọi `lamMoiAnhSoModel()` sau mỗi lượt. Audit: middleware mutation của tRPC.
 */
import { eq, sql } from "drizzle-orm";
import { aiModelArtifacts, aiServingProfiles } from "../../../../drizzle/schema";
import type { getDb } from "../../../db/connection";
import type { SlotClass } from "./anhSoModel";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type MaLoiSuaSoModel = "ARTIFACT_KHONG_CO" | "ARTIFACT_MAT" | "LOAI_KHONG_PHUC_VU" | "DAU_VAO_SAI";

export class LoiSuaSoModel extends Error {
  constructor(
    public readonly ma: MaLoiSuaSoModel,
    message: string,
  ) {
    super(message);
    this.name = "LoiSuaSoModel";
  }
}

export const RE_GIAY_PHEP = /^[a-z0-9][a-z0-9.+_-]{0,47}$/;
export const RE_ID_HO_SO = /^[a-z0-9][a-z0-9.@-]{0,95}$/;
export const TRANG_THAI_SUA_DUOC = ["available", "quarantined"] as const;
export type TrangThaiSuaDuoc = (typeof TRANG_THAI_SUA_DUOC)[number];

export interface YeuCauSuaArtifact {
  id: string;
  license?: string;
  status?: TrangThaiSuaDuoc;
}

export async function suaArtifact(db: Db, yc: YeuCauSuaArtifact): Promise<{ id: string; license: string; status: string }> {
  if (yc.license === undefined && yc.status === undefined) {
    throw new LoiSuaSoModel("DAU_VAO_SAI", "Không có gì để sửa — cần giấy phép hoặc trạng thái.");
  }
  if (yc.license !== undefined && !RE_GIAY_PHEP.test(yc.license)) {
    throw new LoiSuaSoModel("DAU_VAO_SAI", `Giấy phép "${yc.license}" sai hình dạng (chữ thường, số, . + _ -; tối đa 48).`);
  }
  if (yc.status !== undefined && !TRANG_THAI_SUA_DUOC.includes(yc.status)) {
    throw new LoiSuaSoModel("DAU_VAO_SAI", `Trạng thái "${String(yc.status)}" không đặt tay được (chỉ available | quarantined).`);
  }
  return db.transaction(async (tx) => {
    const [a] = await tx
      .select({ id: aiModelArtifacts.id, status: aiModelArtifacts.status })
      .from(aiModelArtifacts)
      .where(eq(aiModelArtifacts.id, yc.id))
      .for("update");
    if (!a) throw new LoiSuaSoModel("ARTIFACT_KHONG_CO", `Không có artifact ${yc.id}.`);
    if (yc.status !== undefined && a.status === "missing") {
      throw new LoiSuaSoModel("ARTIFACT_MAT", `Artifact ${yc.id} đang mất tệp trên đĩa — chạy "Đồng bộ kho" khi tệp có lại, không đặt tay.`);
    }
    const [r] = await tx
      .update(aiModelArtifacts)
      .set({
        ...(yc.license !== undefined ? { license: yc.license } : {}),
        ...(yc.status !== undefined ? { status: yc.status } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(aiModelArtifacts.id, yc.id))
      .returning({ id: aiModelArtifacts.id, license: aiModelArtifacts.license, status: aiModelArtifacts.status });
    return r;
  });
}

export interface YeuCauLuuHoSo {
  id: string;
  artifactId: string;
  slotClass: SlotClass;
  ctx: number;
  thinking: "on" | "off" | "auto";
  enabled: boolean;
}

export async function luuHoSo(db: Db, yc: YeuCauLuuHoSo): Promise<{ id: string; taoMoi: boolean }> {
  if (!RE_ID_HO_SO.test(yc.id)) throw new LoiSuaSoModel("DAU_VAO_SAI", `Mã hồ sơ "${yc.id}" sai hình dạng.`);
  if (!Number.isInteger(yc.ctx) || yc.ctx < 512 || yc.ctx > 262_144) {
    throw new LoiSuaSoModel("DAU_VAO_SAI", `Ngữ cảnh ${yc.ctx} ngoài khoảng 512..262144.`);
  }
  if (!["nang", "nho", "sidecar"].includes(yc.slotClass) || !["on", "off", "auto"].includes(yc.thinking)) {
    throw new LoiSuaSoModel("DAU_VAO_SAI", "Loại khe hoặc chế độ suy nghĩ không hợp lệ.");
  }
  return db.transaction(async (tx) => {
    const [a] = await tx
      .select({ loai: aiModelArtifacts.loai })
      .from(aiModelArtifacts)
      .where(eq(aiModelArtifacts.id, yc.artifactId));
    if (!a) throw new LoiSuaSoModel("ARTIFACT_KHONG_CO", `Không có artifact ${yc.artifactId}.`);
    if (a.loai !== "sinh-chu") {
      throw new LoiSuaSoModel("LOAI_KHONG_PHUC_VU", `Artifact ${yc.artifactId} loại "${a.loai}" — hồ sơ phục vụ chỉ dành cho model sinh chữ.`);
    }
    const [cu] = await tx.select({ id: aiServingProfiles.id }).from(aiServingProfiles).where(eq(aiServingProfiles.id, yc.id));
    const giaTri = { artifactId: yc.artifactId, slotClass: yc.slotClass, ctx: yc.ctx, thinking: yc.thinking, enabled: yc.enabled };
    await tx
      .insert(aiServingProfiles)
      .values({ id: yc.id, ...giaTri, serverArgs: {}, sampling: {} })
      .onConflictDoUpdate({ target: aiServingProfiles.id, set: giaTri });
    return { id: yc.id, taoMoi: !cu };
  });
}
