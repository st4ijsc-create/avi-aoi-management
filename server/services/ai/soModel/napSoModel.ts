/**
 * ★★ Đợt 7.0 — NẠP sổ model từ CSDL vào ảnh chụp (`anhSoModel.ts`) + làm mới mỗi 15 s (như `luaChonModelLlamaServer`:
 * tiến trình anh em đổi gán ⇒ tiến trình này theo kịp ≤ 1 nhịp). Lỗi/thiếu bảng ⇒ GIỮ ảnh cũ (ảnh rỗng = hành vi `.env`),
 * log một lần cho mỗi loại lỗi — không làm ồn log mỗi 15 s.
 */
import { eq, isNull } from "drizzle-orm";
import type { EnvKeyModel } from "../../../../shared/aiRoles";
import { aiModelArtifacts, aiModelBindings, aiRoles, aiServingProfiles } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { isMissingTable } from "../../../_core/dbErrors";
import { datAnhSoModel, layAnhSoModel, type AnhSoModel, type CheDoGan, type PhamViGan, type SlotClass } from "./anhSoModel";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function napAnhSoModel(dbVao?: Db | null): Promise<AnhSoModel> {
  const db = dbVao ?? (await getDb());
  if (!db) throw new Error("không có kết nối CSDL");
  const [vt, pf, gan] = await Promise.all([
    db.select().from(aiRoles),
    db
      .select({
        id: aiServingProfiles.id,
        slotClass: aiServingProfiles.slotClass,
        enabled: aiServingProfiles.enabled,
        filePath: aiModelArtifacts.filePath,
        status: aiModelArtifacts.status,
        license: aiModelArtifacts.license,
      })
      .from(aiServingProfiles)
      .innerJoin(aiModelArtifacts, eq(aiServingProfiles.artifactId, aiModelArtifacts.id)),
    db.select().from(aiModelBindings).where(isNull(aiModelBindings.retiredAt)),
  ]);
  return {
    taiLuc: Date.now(),
    vaiTro: new Map(vt.map((r) => [r.id, { envKey: r.envKey as EnvKeyModel, taskKind: r.taskKind }])),
    profile: new Map(
      pf.map((p) => [
        p.id,
        { artifactFile: p.filePath, slotClass: p.slotClass as SlotClass, artifactStatus: p.status, license: p.license, enabled: p.enabled },
      ]),
    ),
    gan: gan.map((g) => ({
      roleId: g.roleId,
      scopeKind: g.scopeKind as PhamViGan,
      scopeId: g.scopeId,
      profileId: g.profileId,
      envKey: (g.envKey as EnvKeyModel | null) ?? null,
      fallback: g.fallback ?? [],
      mode: g.mode as CheDoGan,
    })),
  };
}

let loiDaBao = "";

/** Nạp và đặt ảnh; lỗi ⇒ giữ ảnh cũ. Không bao giờ ném. Trả ảnh đang dùng sau lượt. */
export async function lamMoiAnhSoModel(): Promise<AnhSoModel> {
  try {
    const anh = await napAnhSoModel();
    datAnhSoModel(anh);
    if (loiDaBao) {
      console.log("[so-model] nạp lại sổ model thành công.");
      loiDaBao = "";
    }
  } catch (e) {
    const loai = isMissingTable(e) ? "thieu-bang" : String((e as Error)?.message ?? e).slice(0, 120);
    if (loai !== loiDaBao) {
      console.warn(
        loai === "thieu-bang"
          ? "[so-model] chưa có bảng sổ model (mig 0400) — định tuyến vai trò dùng .env."
          : `[so-model] nạp sổ model hỏng, giữ ảnh cũ: ${loai}`,
      );
      loiDaBao = loai;
    }
  }
  return layAnhSoModel();
}

let hen: NodeJS.Timeout | null = null;

/** Nạp ngay (KHÔNG chờ — không chặn boot) rồi mỗi `nhipMs`. Gọi lại lần hai = no-op. */
export function khoiChayDongBoSoModel(nhipMs = 15_000): void {
  if (hen) return;
  void lamMoiAnhSoModel();
  hen = setInterval(() => void lamMoiAnhSoModel(), nhipMs);
  hen.unref?.();
}

