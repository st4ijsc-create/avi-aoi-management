/**
 * Trung tâm Model — so sánh LƯỢT ĐO (`ai_model_eval_runs`) giữa hồ sơ đang gán và hồ sơ đích. Hàm thuần, không gọi mạng.
 * Luật: chỉ so TRỰC TIẾP khi CÙNG bộ đo (suite); độ ĐÚNG trước, tốc độ sau (tiêu chí chủ dự án).
 */
export interface LuotDo {
  id: number;
  profileId: string;
  suite: string;
  nTasks: number | null;
  nPass: number | null;
  nRuns: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  gitSha: string | null;
  createdAt: string | Date;
}

export interface GanTom {
  roleId: string;
  scopeKind: string;
  scopeId: string | null;
  mode: string;
  profileId: string | null;
}

/** Tỉ lệ đạt 0..1; thiếu số liệu ⇒ null. */
export function tiLeDat(r: Pick<LuotDo, "nTasks" | "nPass">): number | null {
  return r.nTasks && r.nTasks > 0 && r.nPass !== null ? r.nPass / r.nTasks : null;
}

const khoa = (r: LuotDo) => new Date(r.createdAt).getTime();

/** Lượt đo TỐT NHẤT của một hồ sơ trong một bộ đo: đúng nhất, hoà thì mới nhất. Không có ⇒ null. */
export function luotTotNhat(runs: readonly LuotDo[], profileId: string | null, suite: string | null): LuotDo | null {
  if (!profileId || !suite) return null;
  let tot: LuotDo | null = null;
  for (const r of runs) {
    if (r.profileId !== profileId || r.suite !== suite) continue;
    if (!tot) { tot = r; continue; }
    const a = tiLeDat(r) ?? -1;
    const b = tiLeDat(tot) ?? -1;
    if (a > b || (a === b && khoa(r) > khoa(tot))) tot = r;
  }
  return tot;
}

/** Hồ sơ đang gán ACTIVE toàn cục cho vai trò (gán theo khoá .env không có hồ sơ ⇒ null). */
export function hoSoDangGan(gan: readonly GanTom[], roleId: string): string | null {
  return gan.find((g) => g.roleId === roleId && g.mode === "active" && g.scopeKind === "global" && g.profileId)?.profileId ?? null;
}

/** Tập "profileId|suite" của các hồ sơ đang gán active (bất kỳ phạm vi) cho vai trò dùng bộ đo đó — để đánh dấu hàng ở bảng lượt đo. */
export function tapDangGan(gan: readonly GanTom[], vaiTro: readonly { id: string; evalSuite: string | null }[]): Set<string> {
  const suiteCua = new Map(vaiTro.map((v) => [v.id, v.evalSuite]));
  const out = new Set<string>();
  for (const g of gan) {
    const s = suiteCua.get(g.roleId);
    if (g.mode === "active" && g.profileId && s) out.add(`${g.profileId}|${s}`);
  }
  return out;
}

export type KetQuaSoSanh = "hon" | "kem" | "bang" | "khongSo";

/** Đích so với hiện tại (cùng bộ đo): "hon" khi đúng hơn, hoà đúng thì nhanh hơn (p50 thấp hơn). Thiếu số liệu ⇒ "khongSo". */
export function soSanh(hienTai: LuotDo | null, dich: LuotDo | null): KetQuaSoSanh {
  if (!hienTai || !dich) return "khongSo";
  const a = tiLeDat(dich);
  const b = tiLeDat(hienTai);
  if (a === null || b === null) return "khongSo";
  if (a !== b) return a > b ? "hon" : "kem";
  if (dich.p50Ms === null || hienTai.p50Ms === null || dich.p50Ms === hienTai.p50Ms) return "bang";
  return dich.p50Ms < hienTai.p50Ms ? "hon" : "kem";
}
