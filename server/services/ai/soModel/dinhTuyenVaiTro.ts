/**
 * ★★ Đợt 7.0 — BỘ ĐỊNH TUYẾN VAI TRÒ (tầng 1 tường minh · 2 phạm vi · 3 tín hiệu · 5 mặc định). THUẦN: đọc ảnh chụp +
 * env được truyền vào, không I/O. Tầng 4 (phân loại ngữ nghĩa) là pha 7.3. Spec §3.4.
 *
 * ⚠ KHE NẶNG: gán trỏ profile `nang` mà llama-server KHÔNG đang giữ artifact đó ⇒ (7.1) dùng được, ghi `can-doi-khe`
 *   — model ấy thuộc tập khe nặng (`tapKheNang`) nên engine đi server + cấm nạp trong tiến trình, bộ giám sát khe nặng
 *   đổi khe. `AI_KHE_NANG_HOAN_DOI=false` ⇒ như 7.0: rơi dự phòng, ghi `khe-nang-chua-hoan-doi`.
 */
import { VAI_TRO_GOC, laTenVaiTro, vaiTroTuTinHieu, type EnvKeyModel, type TinHieuVaiTro } from "../../../../shared/aiRoles";
import { toBasename } from "../modelResolver";
import type { AnhSoModel, GanTrongAnh, PhamViGan } from "./anhSoModel";
import { hoanDoiKheNangBat } from "./tapKheNang";

export interface YeuCauDinhTuyen {
  vaiTro?: string;
  /**
   * ★ Đợt 9 — `beMat`: bề mặt gọi (phạm vi `be-mat`, mig 0405; vd `luong`). Thứ tự: flow > project > be-mat > tenant >
   * global — gán theo dự án do người dùng chọn thắng chính sách của bề mặt.
   */
  phamVi?: { tenantId?: string; projectId?: string; flowId?: string; beMat?: string };
  tinHieu?: TinHieuVaiTro;
  /**
   * ★ Đợt 9 — bề mặt chạy NỀN (Luồng): KHÔNG kéo đổi khe nặng. Profile `nang` mà llama-server không đang giữ ⇒ coi như
   * không dùng được ⇒ dự phòng ⇒ env của vai trò. Tránh đổi khe qua lại (15–50 s mỗi lần) khi :8091 đang giữ model khác
   * cho bề mặt tương tác.
   */
  khongDoiKhe?: boolean;
}

export interface KetQuaDinhTuyen {
  vaiTro: string;
  /** Basename GGUF (không `.gguf`); `undefined` = để engine dùng mặc định của nó (hành vi cũ). */
  model: string | undefined;
  nguon: "gan-env" | "gan-profile" | "du-phong" | "mac-dinh-env";
  phamVi: PhamViGan | null;
  lyDo: { tang: 1 | 2 | 3 | 5; bangChung: string };
}

/** Chuỗi lùi của từng khoá env — khớp `modelResolver` (CODE → DEFAULT; FIM → FAST → DEFAULT; còn lại không lùi). */
function modelTheoEnv(envKey: EnvKeyModel, env: NodeJS.ProcessEnv): string | undefined {
  const doc = (k: string) => {
    const v = toBasename(env[k]);
    return v || undefined;
  };
  const v = doc(envKey);
  if (v) return v;
  if (envKey === "GGUF_CODE_MODEL") return doc("GGUF_DEFAULT_MODEL");
  if (envKey === "GGUF_FIM_MODEL") return doc("GGUF_FAST_MODEL") ?? doc("GGUF_DEFAULT_MODEL");
  return undefined;
}

function envKeyCuaVaiTro(vaiTro: string, anh: AnhSoModel): EnvKeyModel {
  return anh.vaiTro.get(vaiTro)?.envKey ?? VAI_TRO_GOC.find((v) => v.id === vaiTro)?.envKey ?? "GGUF_DEFAULT_MODEL";
}

/** Vai trò có biết không (trong ảnh hoặc trong bộ gốc). */
export function laVaiTroDaBiet(vaiTro: string, anh: AnhSoModel): boolean {
  return anh.vaiTro.has(vaiTro) || VAI_TRO_GOC.some((v) => v.id === vaiTro);
}

const TASK_SINH_CHU: ReadonlySet<string> = new Set(["chat", "code", "fast", "fim"]);

/**
 * Vai trò SINH CHỮ (taskKind chat/code/fast/fim) — chỉ những vai trò này được `/v1/chat/completions` phân giải: gọi
 * `rerank`/`vision` qua đường chat sẽ nạp một reranker/model thị giác làm model chat trong tiến trình.
 */
export function laVaiTroSinhChu(vaiTro: string, anh: AnhSoModel): boolean {
  const tk = anh.vaiTro.get(vaiTro)?.taskKind ?? VAI_TRO_GOC.find((v) => v.id === vaiTro)?.taskKind;
  return !!tk && TASK_SINH_CHU.has(tk);
}

type KetQuaProfile = { ok: true; model: string; ghiChu?: string } | { ok: false; lyDo: string };

function thuProfile(profileId: string, anh: AnhSoModel, env: NodeJS.ProcessEnv, khongDoiKhe = false): KetQuaProfile {
  const p = anh.profile.get(profileId);
  if (!p) return { ok: false, lyDo: `profile ${profileId} không có` };
  if (!p.enabled) return { ok: false, lyDo: `profile ${profileId} tắt` };
  if (p.artifactStatus !== "available") return { ok: false, lyDo: `artifact-${p.artifactStatus} (${profileId})` };
  const model = toBasename(p.artifactFile);
  if (p.slotClass === "nang" && model !== toBasename(env.LLAMA_SERVER_MODEL)) {
    if (khongDoiKhe) return { ok: false, lyDo: `khe-dang-giu-model-khac (${profileId}; bề mặt nền không đổi khe)` };
    // Đợt 7.1: khe nặng đổi được (bộ giám sát khe nặng) ⇒ dùng được, ghi `can-doi-khe`; cờ tắt ⇒ như 7.0.
    if (!hoanDoiKheNangBat(env)) return { ok: false, lyDo: `khe-nang-chua-hoan-doi (${profileId})` };
    return { ok: true, model, ghiChu: "can-doi-khe" };
  }
  return { ok: true, model };
}

const THU_TU_PHAM_VI: readonly PhamViGan[] = ["flow", "project", "be-mat", "tenant", "global"];

function chonGan(vaiTro: string, yc: YeuCauDinhTuyen, anh: AnhSoModel): GanTrongAnh | null {
  const id: Record<PhamViGan, string | null> = {
    flow: yc.phamVi?.flowId ?? null,
    project: yc.phamVi?.projectId ?? null,
    "be-mat": yc.phamVi?.beMat ?? null,
    tenant: yc.phamVi?.tenantId ?? null,
    global: null,
  };
  for (const pv of THU_TU_PHAM_VI) {
    if (pv !== "global" && !id[pv]) continue;
    const g = anh.gan.find((x) => x.roleId === vaiTro && x.mode === "active" && x.scopeKind === pv && x.scopeId === id[pv]);
    if (g) return g;
  }
  return null;
}

export function dinhTuyenVaiTro(
  yc: YeuCauDinhTuyen,
  anh: AnhSoModel,
  env: NodeJS.ProcessEnv,
  vaiTroMacDinh = "chat",
): KetQuaDinhTuyen {
  let vaiTro: string;
  let tang: 1 | 3 | 5;
  let bangChung: string;
  const tinHieu = yc.tinHieu ? vaiTroTuTinHieu(yc.tinHieu) : null;
  if (laTenVaiTro(yc.vaiTro) && laVaiTroDaBiet(yc.vaiTro, anh)) {
    vaiTro = yc.vaiTro;
    tang = 1;
    bangChung = "chọn tường minh";
  } else if (tinHieu) {
    vaiTro = tinHieu.vaiTro;
    tang = 3;
    bangChung = tinHieu.bangChung;
  } else {
    vaiTro = laVaiTroDaBiet(vaiTroMacDinh, anh) ? vaiTroMacDinh : "chat";
    tang = 5;
    bangChung = "mặc định của bề mặt";
  }

  const macDinhEnv = (lyDo: string, nguon: KetQuaDinhTuyen["nguon"], phamVi: PhamViGan | null): KetQuaDinhTuyen => ({
    vaiTro,
    model: modelTheoEnv(envKeyCuaVaiTro(vaiTro, anh), env),
    nguon,
    phamVi,
    lyDo: { tang, bangChung: lyDo ? `${bangChung}; ${lyDo}` : bangChung },
  });

  const gan = chonGan(vaiTro, yc, anh);
  if (!gan) return macDinhEnv("", "mac-dinh-env", null);
  const tangGan = gan.scopeKind === "global" ? tang : 2;
  if (gan.envKey) {
    return {
      vaiTro,
      model: modelTheoEnv(gan.envKey, env),
      nguon: "gan-env",
      phamVi: gan.scopeKind,
      lyDo: { tang: tangGan, bangChung: `${bangChung}; gán ${gan.scopeKind} theo ${gan.envKey}` },
    };
  }
  const loi: string[] = [];
  for (const pid of [gan.profileId!, ...gan.fallback]) {
    const kq = thuProfile(pid, anh, env, yc.khongDoiKhe === true);
    if (kq.ok) {
      return {
        vaiTro,
        model: kq.model,
        nguon: pid === gan.profileId ? "gan-profile" : "du-phong",
        phamVi: gan.scopeKind,
        lyDo: { tang: tangGan, bangChung: [`${bangChung}; gán ${gan.scopeKind} → ${pid}`, ...loi, ...(kq.ghiChu ? [kq.ghiChu] : [])].join("; ") },
      };
    }
    loi.push(kq.lyDo);
  }
  const kq = macDinhEnv(loi.join("; "), "du-phong", gan.scopeKind);
  return { ...kq, lyDo: { ...kq.lyDo, tang: tangGan } };
}
