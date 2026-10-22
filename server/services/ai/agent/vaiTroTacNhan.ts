/**
 * ★ Đợt 9 (2026-10-22, dieu-phoi duyệt kèm 4 chỉnh — `docs/superpowers/specs/2026-10-22-tac-nhan-theo-vai-tro-design.md`) — tác nhân
 * lập trình chọn model theo VAI TRÒ và đi qua aiGateway. Cờ `AI_AGENT_THEO_VAI_TRO`: MẶC ĐỊNH BẬT (dieu-phoi 2026-10-23, sau ablation
 * đăng ký trước: 19/24 vs 15/24, cặp 4–0, thời gian 1,56×); `false`/`off`/`0` ⇒ tắt = tác nhân như cũ từng byte (model mặc định của
 * llama-server, ngoài aiGateway).
 *
 * MỘT lần mỗi lượt chạy, TRƯỚC token đầu (§2.1–2.3):
 *   1. vai trò: dự án PLC (`laDuAnPlc` — .st/.scl/PLCopen tc6, chỉnh 1) hoặc chữ câu hỏi chọn `code.plc` (tầng 3) ⇒ `code.plc`;
 *      còn lại ⇒ `code.software` (tên vai trò của "code" trong bộ gốc `shared/aiRoles.ts`).
 *   2. model: `dinhTuyenVaiTro` (gán dự án > bề mặt > global, khoá khe, khe đang giữ). Chỉnh 2: khoá khe giữ model khác ⇒ bộ định
 *      tuyến đã thử dự phòng của gán (khai dự phòng `code.software` → hồ sơ khe đang giữ là việc DỮ LIỆU, không lối tắt ở đây);
 *      đích cuối VẪN đòi đổi khe ⇒ TỪ CHỐI NÓI THẬT ở đây, không chạy 0 tool rồi báo "xong".
 *   3. gating: một `planInference` (license/safety/rate-limit/quota) trên câu hỏi; quota so với ƯỚC LƯỢNG token của cả lượt chạy
 *      (chỉnh 3) — không kiểm lại giữa vòng tool.
 * Đo lường: mỗi lượt model ⇒ `recordPhu({ luotPhu: "agent-luot", requestId: runId })`; kết thúc ⇒ `record` một hàng chính.
 */
import { vaiTroTuCauHoi } from "../../../../shared/aiRoles";
import type { GoiModel, ManhModel } from "@shared/agentCore";
import {
  LicenseGateError,
  QuotaExceededError,
  RateLimitError,
  SafetyBlockedError,
  type GatewayPlan,
  type GatewayRequest,
} from "../../aiGateway";
import { toBasename } from "../modelResolver";
import type { AnhSoModel } from "../soModel/anhSoModel";
import { dinhTuyenVaiTro, type KetQuaDinhTuyen } from "../soModel/dinhTuyenVaiTro";
import { laModelHoSoKheNang } from "../soModel/tapKheNang";

/** Cờ. Vắng / rỗng ⇒ BẬT (mặc định); "false"/"off"/"0"/"no" ⇒ TẮT; giá trị khác ⇒ bật. */
export function tacNhanTheoVaiTroBat(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(0|false|off|no)$/i.test((env.AI_AGENT_THEO_VAI_TRO ?? "").trim());
}

/**
 * Ước lượng token của MỘT lượt chạy cho cổng quota (chỉnh 3). Nguồn số: ablation tác nhân 2026-10-22 (35B, 48 lượt chạy ST,
 * `reports/AB-agent-cst-*`): token ra trung vị ~31k (tắt compile_st 30,2k · bật 32,3k); hệ số an toàn 2 ⇒ 64k. KHÔNG dùng
 * `soLuotToiDa × maxTokens` (chặn thừa). Ghi đè: `AI_AGENT_UOC_LUONG_TOKEN`.
 */
export const UOC_LUONG_TOKEN_LUOT_CHAY_MAC_DINH = 64_000;

export function uocLuongTokenLuotChay(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AI_AGENT_UOC_LUONG_TOKEN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : UOC_LUONG_TOKEN_LUOT_CHAY_MAC_DINH;
}

export type VaiTroTacNhan = "code.plc" | "code.software";

/** Thông tin model của lượt chạy — đi vào sự kiện `bat-dau` (UI hiện "đang chạy 27B vì dự án PLC"). */
export interface ThongTinModelLuotChay {
  vaiTro: VaiTroTacNhan;
  model: string | null;
  nguon: KetQuaDinhTuyen["nguon"];
  bangChung: string;
}

export function chonVaiTroTacNhan(y: { laDuAnPlc: boolean; cauHoi: string }): { vaiTro: VaiTroTacNhan; bangChung: string } {
  if (y.laDuAnPlc) return { vaiTro: "code.plc", bangChung: "dự án PLC (.st/.scl/PLCopen tc6)" };
  const tinHieu = vaiTroTuCauHoi(y.cauHoi);
  if (tinHieu?.vaiTro === "code.plc") return { vaiTro: "code.plc", bangChung: tinHieu.bangChung };
  return { vaiTro: "code.software", bangChung: "mặc định của tác nhân lập trình" };
}

/** Mã từ chối ở bước chuẩn bị — `quanLyLuotChay` đổi ra HTTP. */
export type MaTuChoiVaiTro = "AI_KHONG_CO_MODEL" | "AI_GIOI_HAN_TAN_SUAT" | "AI_HET_HAN_MUC" | "AI_CHAN_AN_TOAN" | "AI_CHUA_CAP_PHEP";

export interface PhuThuocVaiTro {
  planInference: (req: GatewayRequest) => Promise<GatewayPlan>;
  layAnh: () => AnhSoModel;
  nguCanhKhe: () => { kheBiKhoa: boolean; kheDangGiu: string | null };
  /** Làm mới "khe đang giữ" TRƯỚC `nguCanhKhe` (mặc định `lamMoiKheDangGiu`; đổi khe ngoài tiến trình ⇒ giá trị cũ ⇒ từ chối oan). */
  lamMoiKhe?: () => Promise<void>;
  laDuAnPlc: (goc: string) => boolean;
  env?: NodeJS.ProcessEnv;
}

export type KetQuaChuanBi =
  | { ok: true; thongTin: ThongTinModelLuotChay; modelId: string | undefined; plan: GatewayPlan }
  | { ok: false; ma: MaTuChoiVaiTro; thongDiep: string; thongTin?: ThongTinModelLuotChay };

export async function chuanBiLuotChayTheoVaiTro(
  y: { cauHoi: string; gocDuAn: string; projectId: string; user: { id: number; role: string } },
  p: PhuThuocVaiTro,
): Promise<KetQuaChuanBi> {
  const env = p.env ?? process.env;
  const chon = chonVaiTroTacNhan({ laDuAnPlc: p.laDuAnPlc(y.gocDuAn), cauHoi: y.cauHoi });
  const anh = p.layAnh();
  await p.lamMoiKhe?.();
  const khe = p.nguCanhKhe();
  const r = dinhTuyenVaiTro({ vaiTro: chon.vaiTro, phamVi: { projectId: y.projectId }, ...khe }, anh, env);
  const thongTin: ThongTinModelLuotChay = {
    vaiTro: chon.vaiTro,
    model: r.model ?? null,
    nguon: r.nguon,
    bangChung: `${chon.bangChung}; ${r.lyDo.bangChung}`,
  };

  // Khoá khe còn hạn và đích cuối là model khe nặng KHÁC model khe đang giữ ⇒ bộ lập lịch khe sẽ từ chối ở lượt model đầu
  // (đo: ablation 2026-10-22 lần 1 — mọi lượt `MODEL_LOI`, 0 tool). Nói thật NGAY, trước mọi token / checkpoint.
  if (khe.kheBiKhoa && r.model && laModelHoSoKheNang(r.model, anh)) {
    const dang = toBasename(khe.kheDangGiu ?? env.LLAMA_SERVER_MODEL);
    if (toBasename(r.model) !== dang) {
      return {
        ok: false,
        ma: "AI_KHONG_CO_MODEL",
        thongDiep:
          `Khe model đang bị khoá (một phép đo/đổi model đang giữ ${dang || "?"}); vai trò ${chon.vaiTro} cần ${r.model} ` +
          "và không có hồ sơ dự phòng nào dùng được với model đang giữ. Thử lại khi khoá được nhả.",
        thongTin,
      };
    }
  }

  try {
    const plan = await p.planInference({
      task: "code",
      text: y.cauHoi,
      userId: y.user.id,
      role: y.user.role,
      auditTask: "agent_run",
      uocLuongToken: uocLuongTokenLuotChay(env),
    });
    return { ok: true, thongTin, modelId: r.model, plan };
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, ma: "AI_GIOI_HAN_TAN_SUAT", thongDiep: e.message, thongTin };
    if (e instanceof QuotaExceededError) return { ok: false, ma: "AI_HET_HAN_MUC", thongDiep: e.message, thongTin };
    if (e instanceof SafetyBlockedError) return { ok: false, ma: "AI_CHAN_AN_TOAN", thongDiep: e.message, thongTin };
    if (e instanceof LicenseGateError) return { ok: false, ma: "AI_CHUA_CAP_PHEP", thongDiep: e.message, thongTin };
    throw e;
  }
}

/**
 * Bọc `GoiModel`: đo MỖI lượt model (từ lúc gọi tới mảnh `xong`) và báo `usage` + thời gian. Bọc được cả model giả của lưới
 * — đo lường không phụ thuộc engine thật. Lượt ném / bị huỷ trước `xong` ⇒ không báo (không có usage đo được).
 */
export function boDemLuotModel(
  goc: GoiModel,
  baoLuot: (l: { vao: number | null; ra: number | null; nghi: number | null; ms: number }) => void,
  dongHo: () => number = Date.now,
): GoiModel {
  return (vao) =>
    (async function* (): AsyncGenerator<ManhModel> {
      const t0 = dongHo();
      for await (const m of goc(vao)) {
        if (m.loai === "xong") {
          try {
            baoLuot({ vao: m.usage?.vao ?? null, ra: m.usage?.ra ?? null, nghi: m.usage?.nghi ?? null, ms: dongHo() - t0 });
          } catch {
            /* đo lường không bao giờ làm hỏng lượt chạy */
          }
        }
        yield m;
      }
    })();
}
