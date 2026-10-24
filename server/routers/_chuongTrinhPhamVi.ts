/**
 * ★★★ 2026-10-25 · L3 — PHẠM VI NHÀ MÁY CHO CHƯƠNG TRÌNH ĐIỀU KHIỂN (dự án · phiên bản · build · deploy · symbol).
 *
 * LỖ: mọi thủ tục `programming.*` nhận `projectId`/`artifactId`/`buildId`/`deploymentId`/`symbol id` mà KHÔNG đối chiếu nhà máy của người gọi — người dùng nhà máy A đọc mã nguồn PLC/robot của B,
 * tạo phiên bản, build, mô phỏng, duyệt/từ chối/rollback deploy và xoá dự án của B. Riêng ba đường deploy (`deployBuild`, `requestDeployApproval`, `deployToFleet`) chỉ kiểm phạm vi KHI người gọi tự
 * gửi `expectedProjectId` (tuỳ chọn) — bỏ trường ấy đi là lách được cổng (ĐƯỜNG ĐIỀU KHIỂN THIẾT BỊ).
 *
 * LUẬT (CÙNG luật cổng bản xem trước `deployPreview.assertPreviewInScope`, nay dùng cho mọi thủ tục):
 *   dự án thấy được ⇔ phạm vi toàn quyền, HOẶC `factoryId ∈ phạm vi`, HOẶC (`factoryId IS NULL` VÀ thiết bị của dự án ∈ phạm vi) — dự án không chiếu được vào nhà máy nào ⇒ NGOÀI phạm vi
 *   (fail-closed). Thiết bị: máy (\`machines\`) cho mọi loại, riêng \`mitsubishi-engineering\` id là \`device_adapters.id\` ⇒ xét \`machineId\` của adapter.
 * Phiên bản/build/deploy/symbol thừa hưởng phạm vi của DỰ ÁN chứa nó. Ngoài phạm vi ≡ KHÔNG TỒN TẠI (cùng thực thể + cùng thông điệp với dịch vụ khi thiếu thật), danh sách theo id ⇒ rỗng.
 */
import { and, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { appError } from "../_core/appError";
import { getDb } from "../db/connection";
import { idsTrongPhamVi } from "../db/hierarchy";
import { deviceAdapters, programArtifacts, programBuilds, programDeployments, programProjects, programSymbols } from "../../drizzle/schema";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";

const MITSUBISHI = "mitsubishi-engineering";

async function layDb() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Tập nhà máy + máy trong phạm vi người gọi; \`null\` = toàn quyền. */
export async function phamViChuongTrinh(ctx: CoDanhTinh): Promise<{ nhaMay: number[]; may: number[] } | null> {
  const pv = phamViCua(ctx);
  const [nhaMay, may] = await Promise.all([idsTrongPhamVi("factory", pv, { strict: true }), idsTrongPhamVi("machine", pv, { strict: true })]);
  if (nhaMay === null && may === null) return null;
  return { nhaMay: nhaMay ?? [], may: may ?? [] };
}

/** Điều kiện SQL "dự án (\`program_projects\`) thuộc phạm vi"; \`undefined\` khi toàn quyền. */
export async function dieuKienDuAn(ctx: CoDanhTinh): Promise<SQL | undefined> {
  const p = await phamViChuongTrinh(ctx);
  if (p === null) return undefined;
  const f = p.nhaMay.length > 0 ? p.nhaMay : [-1];
  const m = p.may.length > 0 ? p.may : [-1];
  const adapterCuaMay = sql`(SELECT id FROM device_adapters WHERE "machineId" IN (${sql.join(m.map((x) => sql`${x}`), sql`, `)}))`;
  return or(
    inArray(programProjects.factoryId, f),
    and(
      isNull(programProjects.factoryId),
      isNotNull(programProjects.deviceId),
      or(
        and(eq(programProjects.kind, MITSUBISHI as never), inArray(programProjects.deviceId, adapterCuaMay)),
        and(ne(programProjects.kind, MITSUBISHI as never), inArray(programProjects.deviceId, m)),
      ),
    ),
  );
}

/** Dự án có thấy được không (dự án không tồn tại ⇒ false). */
export async function duAnThayDuoc(ctx: CoDanhTinh, projectId: number): Promise<boolean> {
  const d = await layDb();
  const cong = await dieuKienDuAn(ctx);
  const rows = await d
    .select({ id: programProjects.id })
    .from(programProjects)
    .where(cong ? and(eq(programProjects.id, projectId), cong) : eq(programProjects.id, projectId))
    .limit(1);
  return rows.length > 0;
}

/** Thiết bị (máy hoặc adapter MELSEC) có thuộc phạm vi không — cùng luật \`deployPreview\`. \`kind\` quyết định id là máy hay adapter. */
export async function thietBiTrongPhamVi(ctx: CoDanhTinh, deviceId: number, kind: string): Promise<boolean> {
  const p = await phamViChuongTrinh(ctx);
  if (p === null) return true;
  if (kind !== MITSUBISHI) return p.may.includes(deviceId);
  const d = await layDb();
  const [ad] = await d.select({ machineId: deviceAdapters.machineId }).from(deviceAdapters).where(eq(deviceAdapters.id, deviceId)).limit(1);
  return ad?.machineId != null && p.may.includes(ad.machineId);
}

const khongThay = (entity: string, ten: string, id: number) => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity }, `${ten} ${id} not found`);

/** Chặn theo dự án: ngoài phạm vi ≡ \`programmingProject\` không tồn tại. */
export async function chanDuAn(ctx: CoDanhTinh, projectId: number): Promise<void> {
  if (!(await duAnThayDuoc(ctx, projectId))) throw khongThay("programmingProject", "Project", projectId);
}

/** projectId của phiên bản/build/deploy/symbol (không tồn tại ⇒ \`null\`). */
export async function duAnCuaArtifact(artifactId: number): Promise<number | null> {
  const d = await layDb();
  const [r] = await d.select({ p: programArtifacts.projectId }).from(programArtifacts).where(eq(programArtifacts.id, artifactId)).limit(1);
  return r?.p ?? null;
}
export async function duAnCuaBuild(buildId: number): Promise<number | null> {
  const d = await layDb();
  const [r] = await d
    .select({ p: programArtifacts.projectId })
    .from(programBuilds)
    .innerJoin(programArtifacts, eq(programBuilds.artifactId, programArtifacts.id))
    .where(eq(programBuilds.id, buildId))
    .limit(1);
  return r?.p ?? null;
}
export async function duAnCuaDeployment(deploymentId: number): Promise<number | null> {
  const d = await layDb();
  const [r] = await d.select({ p: programDeployments.projectId }).from(programDeployments).where(eq(programDeployments.id, deploymentId)).limit(1);
  return r?.p ?? null;
}
export async function duAnCuaSymbol(symbolId: number): Promise<number | null> {
  const d = await layDb();
  const [r] = await d.select({ p: programSymbols.projectId }).from(programSymbols).where(eq(programSymbols.id, symbolId)).limit(1);
  return r?.p ?? null;
}

/** Phiên bản chương trình ngoài phạm vi ≡ \`programmingArtifact\` không tồn tại (dịch vụ để NGUYÊN thông điệp "Artifact N not found" cho phiên bản thiếu thật). */
export async function chanArtifact(ctx: CoDanhTinh, artifactId: number): Promise<void> {
  const p = await duAnCuaArtifact(artifactId);
  if (p !== null && !(await duAnThayDuoc(ctx, p))) throw khongThay("programmingArtifact", "Artifact", artifactId);
}
export async function chanBuild(ctx: CoDanhTinh, buildId: number): Promise<void> {
  const p = await duAnCuaBuild(buildId);
  if (p !== null && !(await duAnThayDuoc(ctx, p))) throw khongThay("programBuild", "Build", buildId);
}
export async function chanDeployment(ctx: CoDanhTinh, deploymentId: number): Promise<void> {
  const p = await duAnCuaDeployment(deploymentId);
  if (p !== null && !(await duAnThayDuoc(ctx, p))) throw khongThay("programDeployment", "Deployment", deploymentId);
}

/** Điều kiện SQL "deploy thuộc dự án trong phạm vi" (\`program_deployments.projectId\`); \`undefined\` khi toàn quyền. */
export async function dieuKienDeployment(ctx: CoDanhTinh): Promise<SQL | undefined> {
  const cong = await dieuKienDuAn(ctx);
  return cong ? sql`${programDeployments.projectId} IN (SELECT ${programProjects.id} FROM ${programProjects} WHERE ${cong})` : undefined;
}
