/**
 * ★★ Đợt 7.0 — ĐỒNG BỘ kho GGUF (`GGUF_MODELS_DIR`, gốc, không đệ quy) → `ai_model_artifacts`.
 * Liệt kê bằng `lietKeModelTrongKho` (cùng danh sách trắng với đổi model). Giấy phép KHÔNG đoán (để `unknown`; người khai
 * ở Trung tâm Model — `unknown` chặn gán active trỏ profile). Không bao giờ ném.
 */
import fs from "node:fs";
import { notInArray, sql } from "drizzle-orm";
import { aiModelArtifacts } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { lietKeModelTrongKho } from "../doiModelLlamaServer";

export interface ArtifactSuyRa {
  id: string;
  family: string;
  quant: string | null;
  loai: "sinh-chu" | "nhung" | "xep-hang" | "chieu-thi-giac";
  paramsTotalB: number | null;
  paramsActiveB: number | null;
}

const RE_QUANT = /(UD-)?(IQ\d_[A-Z]+|Q\d_K_[A-Z]+|Q\d_K|Q\d_\d|F16|BF16|F32)$/i;

/** Thuần — suy siêu dữ liệu từ TÊN tệp (header GGUF đọc ở 7.1 khi ước lượng VRAM theo ctx). */
export function suyRaArtifact(tenTep: string): ArtifactSuyRa {
  const base = tenTep.replace(/\.gguf$/i, "");
  const id = base.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
  const mTong = /(?:^|[-_])(\d+(?:\.\d+)?)B(?=[-_.]|$)/i.exec(base);
  const mHoat = /(?:^|[-_])A(\d+(?:\.\d+)?)B(?=[-_.]|$)/i.exec(base);
  const family = (mTong ? base.slice(0, mTong.index) : base.split(/[-_]/)[0]).toLowerCase().replace(/[-_]+$/, "") || "khac";
  const q = RE_QUANT.exec(base);
  const loai: ArtifactSuyRa["loai"] = /mmproj/i.test(base)
    ? "chieu-thi-giac"
    : /embed/i.test(base)
      ? "nhung"
      : /rerank/i.test(base)
        ? "xep-hang"
        : "sinh-chu";
  return {
    id,
    family: family.slice(0, 48),
    quant: q ? q[0].toUpperCase() : null,
    loai,
    paramsTotalB: mTong ? Number(mTong[1]) : null,
    paramsActiveB: mHoat ? Number(mHoat[1]) : null,
  };
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface PhuThuocDongBo {
  thuMuc?: string;
  db?: Db | null;
  liet?: typeof lietKeModelTrongKho;
}

export async function dongBoKhoModel(deps: PhuThuocDongBo = {}): Promise<{ them: number; capNhat: number; mat: number }> {
  const rong = { them: 0, capNhat: 0, mat: 0 };
  try {
    const thuMuc = deps.thuMuc ?? process.env.GGUF_MODELS_DIR ?? "";
    const db = deps.db ?? (await getDb());
    if (!db || !thuMuc) return rong;
    // Kho không đọc được (ổ chưa gắn, quyền) ⇒ KHÔNG đánh dấu mất gì cả: `lietKeModelTrongKho` trả [] cho lỗi đọc, và
    // "[] ⇒ mọi artifact missing" sẽ đẩy mọi gán profile sang dự phòng chỉ vì một lần đọc hỏng.
    if (!deps.liet && !fs.existsSync(thuMuc)) return rong;
    const tep = (deps.liet ?? lietKeModelTrongKho)(thuMuc);
    if (tep.length === 0) return rong;
    // `lietKeModelTrongKho` gắn `khong-ho-tro` cho mmproj/embed/rerank — vẫn VÀO sổ (vai trò embed/rerank/vision cần chúng).
    const coSan = new Set((await db.select({ f: aiModelArtifacts.filePath }).from(aiModelArtifacts)).map((r) => r.f));
    let them = 0;
    let capNhat = 0;
    for (const t of tep) {
      const s = suyRaArtifact(t.ten);
      await db
        .insert(aiModelArtifacts)
        .values({
          id: s.id,
          filePath: t.ten,
          family: s.family,
          quant: s.quant,
          loai: s.loai,
          paramsTotalB: s.paramsTotalB == null ? null : String(s.paramsTotalB),
          paramsActiveB: s.paramsActiveB == null ? null : String(s.paramsActiveB),
          sizeBytes: t.kichThuoc,
          vramWeightsMb: Math.ceil(t.kichThuoc / 1048576),
          modalities: s.loai === "chieu-thi-giac" ? ["image"] : ["text"],
        })
        .onConflictDoUpdate({
          target: aiModelArtifacts.filePath,
          set: { sizeBytes: t.kichThuoc, vramWeightsMb: Math.ceil(t.kichThuoc / 1048576), status: "available", updatedAt: sql`now()` },
        });
      if (coSan.has(t.ten)) capNhat++;
      else them++;
    }
    const conTren = tep.map((t) => t.ten);
    const matRows = await db
      .update(aiModelArtifacts)
      .set({ status: "missing", updatedAt: sql`now()` })
      .where(sql`${notInArray(aiModelArtifacts.filePath, conTren)} AND ${aiModelArtifacts.status} = 'available'`)
      .returning({ f: aiModelArtifacts.filePath });
    return { them, capNhat, mat: matRows.length };
  } catch (e) {
    console.warn(`[so-model] đồng bộ kho model hỏng: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    return rong;
  }
}
