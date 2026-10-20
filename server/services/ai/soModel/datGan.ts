/**
 * ★★ Đợt 7.0 — ĐỔI GÁN vai trò → model, có CỔNG (spec §3.6):
 *   • gán `active` trỏ PROFILE cố định cần ≥ 1 lượt đo (`ai_model_eval_runs`) của profile đó VÀ giấy phép artifact ≠ `unknown`;
 *   • gán theo-env (`envKey`) không cần đo — nó chỉ là hành vi `.env` hiện hành;
 *   • lịch sử: hàng cũ cùng (vai trò, phạm vi, chế độ) được đặt `retiredAt`, rồi chèn hàng mới — MỘT giao dịch.
 * Audit: middleware mutation của tRPC ghi lượt gọi (`aiGguf.soModelDatGan`).
 */
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { VAI_TRO_GOC, type EnvKeyModel } from "../../../../shared/aiRoles";
import { aiModelArtifacts, aiModelBindings, aiModelEvalRuns, aiRoles, aiServingProfiles } from "../../../../drizzle/schema";
import type { getDb } from "../../../db/connection";
import type { CheDoGan, PhamViGan } from "./anhSoModel";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export const ENV_KEY_HOP_LE: readonly EnvKeyModel[] = [...new Set(VAI_TRO_GOC.map((v) => v.envKey))];

export type MaLoiDatGan = "VAI_TRO_KHONG_CO" | "PROFILE_KHONG_CO" | "CHUA_CO_DO" | "GIAY_PHEP_CHUA_RO" | "DICH_SAI";

export class LoiDatGan extends Error {
  constructor(
    public readonly ma: MaLoiDatGan,
    message: string,
  ) {
    super(message);
    this.name = "LoiDatGan";
  }
}

export interface YeuCauDatGan {
  roleId: string;
  scopeKind: PhamViGan;
  scopeId: string | null;
  profileId: string | null;
  envKey: EnvKeyModel | null;
  fallback: string[];
  mode: CheDoGan;
}

export async function datGanModel(db: Db, yc: YeuCauDatGan, userId: number | null): Promise<{ id: number; daThay: number }> {
  if ((yc.profileId === null) === (yc.envKey === null)) {
    throw new LoiDatGan("DICH_SAI", "Gán phải trỏ đúng một trong hai: hồ sơ phục vụ hoặc khoá .env.");
  }
  if (yc.envKey && !ENV_KEY_HOP_LE.includes(yc.envKey)) {
    throw new LoiDatGan("DICH_SAI", `Khoá .env ${yc.envKey} không nằm trong danh sách khoá model.`);
  }
  return db.transaction(async (tx) => {
    const [vt] = await tx.select({ id: aiRoles.id }).from(aiRoles).where(eq(aiRoles.id, yc.roleId));
    if (!vt) throw new LoiDatGan("VAI_TRO_KHONG_CO", `Không có vai trò ${yc.roleId}.`);
    for (const pid of [yc.profileId, ...yc.fallback].filter((x): x is string => !!x)) {
      const [p] = await tx
        .select({ license: aiModelArtifacts.license })
        .from(aiServingProfiles)
        .innerJoin(aiModelArtifacts, eq(aiServingProfiles.artifactId, aiModelArtifacts.id))
        .where(eq(aiServingProfiles.id, pid));
      if (!p) throw new LoiDatGan("PROFILE_KHONG_CO", `Không có hồ sơ phục vụ ${pid}.`);
      if (yc.mode === "active" && pid === yc.profileId) {
        if (p.license === "unknown") {
          throw new LoiDatGan("GIAY_PHEP_CHUA_RO", `Hồ sơ ${pid}: giấy phép model chưa khai — không gán chế độ active được.`);
        }
        const [d] = await tx.select({ n: count() }).from(aiModelEvalRuns).where(eq(aiModelEvalRuns.profileId, pid));
        if (!d || d.n === 0) {
          throw new LoiDatGan("CHUA_CO_DO", `Hồ sơ ${pid} chưa có lượt đo nào — gán ở chế độ 'thu', chạy bộ đo vai trò, rồi mới active.`);
        }
      }
    }
    const thay = await tx
      .update(aiModelBindings)
      .set({ retiredAt: sql`now()` })
      .where(
        and(
          eq(aiModelBindings.roleId, yc.roleId),
          eq(aiModelBindings.scopeKind, yc.scopeKind),
          yc.scopeId === null ? isNull(aiModelBindings.scopeId) : eq(aiModelBindings.scopeId, yc.scopeId),
          eq(aiModelBindings.mode, yc.mode),
          isNull(aiModelBindings.retiredAt),
        ),
      )
      .returning({ id: aiModelBindings.id });
    const [moi] = await tx
      .insert(aiModelBindings)
      .values({
        roleId: yc.roleId,
        scopeKind: yc.scopeKind,
        scopeId: yc.scopeId,
        profileId: yc.profileId,
        envKey: yc.envKey,
        fallback: yc.fallback,
        mode: yc.mode,
        createdBy: userId,
      })
      .returning({ id: aiModelBindings.id });
    return { id: moi.id, daThay: thay.length };
  });
}
