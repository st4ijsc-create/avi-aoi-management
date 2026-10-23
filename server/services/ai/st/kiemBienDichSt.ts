/**
 * ★★ Đợt 9 (2026-10-21, dieu-phoi duyệt) — VÒNG KIỂM BIÊN DỊCH ST cho bề mặt TƯƠNG TÁC (/v1 code.plc, trợ lý, Cmd+K).
 * Đo trục M: 27B + vòng sửa 53/72 vs 27B không vòng 39/72 (sổ #11 vs #1) — đòn bẩy lớn nhất của code.plc.
 *
 * Lõi THUẦN với I/O tiêm vào (`bienDich`, `goiLai`): trích mã ST (`trichMaST`; KHÔNG có mã ST ⇒ "bo-qua", không gắn nhãn) →
 * chuẩn hoá SCL nếu cần (`sclSangSt`, giữ số dòng) → biên dịch (RuSTy `plc -c` qua `bienDichST` 8.4 — CHỈ biên dịch, không
 * chạy) → lỗi ⇒ gửi chẩn đoán lại model trong CÙNG hội thoại (`goiLai`), tối đa `vongToiDa` (2) vòng, trần `tranMs` (90 s)
 * cho phần THÊM. Hạ tầng hỏng (docker / ảnh vắng) ⇒ "khong-kiem-duoc", KHÔNG chặn câu trả lời. Không bao giờ ném (trừ huỷ).
 *
 * Không thay lặng lẽ: kết quả mang `cauTraLoiDau` + `cauTraLoiCuoi` + trạng thái để bề mặt hiển thị ("đã tự sửa K lỗi…").
 */
import { bienDichST, LoiBienDichST, type ChanDoanST, type KetQuaBienDichST } from "../../flow/lib/bienDichST";
import { sclSangSt } from "./sclSangSt";
import { trichMaST, type KhoiMaST } from "./trichMaST";
import { TEN_TRINH_DICH_ST, cauNhacSuaST, dongLoiST } from "../../../../shared/stNhacSua.mjs";
import { layAnhSoModel, type AnhSoModel } from "../soModel/anhSoModel";
import { laModelHoSoKheNang } from "../soModel/tapKheNang";

/** Trần thời gian vòng sửa cho model khe NHẸ (giữ như thiết kế 2026-10-21). */
export const TRAN_MS_VONG_SUA_NHE = 90_000;
/**
 * ★ (2026-10-22, dieu-phoi) — trần cho model HỒ SƠ khe nặng: đủ 2 lần sinh lại. Đo (A/B /v1, 27B nghĩ 16k): một lần sinh lại
 * 67–197 s (13 lượt sửa thật, p90 ≈ 192 s), câu trả lời đầu p90 239 s ⇒ mặc định 2 × 240 s. Trần 90 s cũ nhỏ hơn MỘT lần sinh lại
 * ⇒ 7/7 lượt còn lỗi chỉ được đúng một vòng. Ghi đè: `AI_KIEM_BIEN_DICH_ST_TRAN_MS_NANG`.
 */
export const TRAN_MS_VONG_SUA_NANG_MAC_DINH = 480_000;

/** Trần thời gian vòng sửa theo khe của model chạy lượt này. */
export function tranMsVongSuaST(model: string | undefined, env: NodeJS.ProcessEnv = process.env, anh: AnhSoModel = layAnhSoModel()): number {
  if (!laModelHoSoKheNang(model, anh)) return TRAN_MS_VONG_SUA_NHE;
  const n = Number(env.AI_KIEM_BIEN_DICH_ST_TRAN_MS_NANG);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : TRAN_MS_VONG_SUA_NANG_MAC_DINH;
}

export type TrangThaiKiemST = "bo-qua" | "sach" | "da-sua" | "con-loi" | "khong-kiem-duoc";

export interface KetQuaKiemBienDichST {
  trangThai: TrangThaiKiemST;
  /** "bo-qua": không có mã ST; "khong-kiem-duoc": lý do hạ tầng */
  lyDo: string | null;
  phuongNgu: "st" | "scl" | null;
  trinhDich: "rusty";
  /** số lượt model sinh LẠI (0 = bản đầu đã sạch / bỏ qua) */
  soVong: number;
  /** số lỗi biên dịch của bản ĐẦU đã được sửa hết (chỉ khi "da-sua") */
  soLoiDaSua: number;
  /** chẩn đoán của bản được trả (rỗng khi sạch) */
  chanDoanCuoi: ChanDoanST[];
  cauTraLoiDau: string;
  cauTraLoiCuoi: string;
  msThem: number;
}

export interface TuyChonKiemST {
  cauTraLoi: string;
  /** Gửi `tinSua` (lỗi biên dịch) vào CÙNG hội thoại, sau câu trả lời `lanTruoc`; trả câu trả lời mới. */
  goiLai: (tinSua: string, lanTruoc: string) => Promise<string>;
  vongToiDa?: number;
  tranMs?: number;
  bienDich?: (ma: string) => Promise<KetQuaBienDichST>;
  bayGio?: () => number;
  signal?: AbortSignal;
}

/** Ghép các khối ST thành MỘT đơn vị biên dịch (SCL ⇒ chuẩn hoá, giữ số dòng) + bảng dòng → khối để báo lỗi theo khối. */
export function ghepMaST(khoi: KhoiMaST[]): { ma: string; bang: { tu: number; den: number; chiSo: number }[]; phuongNgu: "st" | "scl" } {
  let dong = 1;
  let ma = "";
  const bang: { tu: number; den: number; chiSo: number }[] = [];
  khoi.forEach((k, chiSo) => {
    const than = (k.laScl ? sclSangSt(k.ma) : k.ma.replace(/\r\n/g, "\n")).replace(/\n?$/, "\n");
    const soDong = than.split("\n").length - 1;
    bang.push({ tu: dong, den: dong + soDong - 1, chiSo });
    ma += than;
    dong += soDong;
  });
  return { ma, bang, phuongNgu: khoi.some((k) => k.laScl) ? "scl" : "st" };
}

/** Chẩn đoán trên đơn vị ghép ⇒ "khối k, dòng j" (dòng TRONG khối người dùng thấy). */
export function chanDoanTheoKhoi(
  ds: ChanDoanST[],
  bang: { tu: number; den: number; chiSo: number }[],
  soKhoi: number,
  /** ★ (2026-10-22) tên tệp của từng khối (dòng `// tệp:`) — có ⇒ chẩn đoán mang ĐÚNG tên model đã viết. */
  tenKhoi: (string | null)[] = [],
): ChanDoanST[] {
  return ds.map((d) => {
    if (d.dong === null) return d;
    const b = bang.find((x) => d.dong! >= x.tu && d.dong! <= x.den);
    if (!b) return d;
    return { ...d, tep: tenKhoi[b.chiSo] ?? (soKhoi > 1 ? `khối ${b.chiSo + 1}` : "mã"), dong: d.dong - b.tu + 1 };
  });
}

const soLoi = (ds: ChanDoanST[]) => ds.filter((d) => d.mucDo === "error").length;

/** Chẩn đoán ⇒ chữ gửi model / người dùng (chỉ lỗi, ≤ 20 dòng). Cùng hình dạng `chanDoanChoModel` của ai.sinh-ma (không import
 * module node Luồng để tránh kéo đăng ký node vào đường /v1). */
export function chanDoanChoModel(ds: ChanDoanST[]): string {
  return ds
    .filter((d) => d.mucDo === "error")
    .slice(0, 20)
    .map((d) => `${d.tep ?? "?"}:${d.dong ?? "?"}:${d.cot ?? "?"} ${d.ma ? `error[${d.ma}]` : "error"}: ${d.thongDiep}`)
    .join("\n");
}

export async function kiemVaSuaST(y: TuyChonKiemST): Promise<KetQuaKiemBienDichST> {
  const bayGio = y.bayGio ?? Date.now;
  const t0 = bayGio();
  const vongToiDa = Math.max(0, y.vongToiDa ?? 2);
  const tranMs = y.tranMs ?? TRAN_MS_VONG_SUA_NHE;
  const bienDich = y.bienDich ?? ((ma: string) => bienDichST(ma));
  const kq = (p: Partial<KetQuaKiemBienDichST>): KetQuaKiemBienDichST => ({
    trangThai: "bo-qua", lyDo: null, phuongNgu: null, trinhDich: "rusty", soVong: 0, soLoiDaSua: 0, chanDoanCuoi: [],
    cauTraLoiDau: y.cauTraLoi, cauTraLoiCuoi: y.cauTraLoi, msThem: bayGio() - t0, ...p,
  });

  const kiem = async (chu: string) => {
    const khoi = trichMaST(chu);
    if (!khoi.length) return null;
    const g = ghepMaST(khoi);
    const r = await bienDich(g.ma);
    return { ...r, chanDoan: chanDoanTheoKhoi(r.chanDoan, g.bang, khoi.length, khoi.map((k) => k.tep)), phuongNgu: g.phuongNgu, coTep: khoi.some((k) => k.tep) };
  };

  let dau: Awaited<ReturnType<typeof kiem>>;
  try {
    dau = await kiem(y.cauTraLoi);
  } catch (e) {
    if (e instanceof LoiBienDichST) return kq({ trangThai: "khong-kiem-duoc", lyDo: `${e.loai}: ${e.message}`.slice(0, 300) });
    throw e;
  }
  if (!dau) return kq({ trangThai: "bo-qua", lyDo: "khong-co-ma-st" });
  if (dau.ok) return kq({ trangThai: "sach", phuongNgu: dau.phuongNgu });

  const loiDau = soLoi(dau.chanDoan);
  let tot = { chu: y.cauTraLoi, chanDoan: dau.chanDoan };
  let lanTruoc = y.cauTraLoi;
  let chanDoan = dau.chanDoan;
  // ★ (2026-10-22) số vòng ĐÃ GỌI model thật — A/B /v1: trần 90 s cắt sau vòng 1 mà nhãn vẫn báo `vong=2` (7/7 con-loi).
  let daGoi = 0;
  for (let vong = 1; vong <= vongToiDa; vong++) {
    if (y.signal?.aborted) break;
    if (bayGio() - t0 >= tranMs) break;
    // ★ (2026-10-22, dieu-phoi) lời nhắc DÙNG CHUNG với bộ đo M (`shared/stNhacSua.mjs`): A/B /v1 cho thấy cùng chẩn đoán, M sửa
    // được tt7 2/3 còn đường này 0/3 — khác biệt còn lại là lời nhắc (M đòi trả lại ĐỦ mọi tệp đúng định dạng `// tệp:`).
    const tin = cauNhacSuaST({
      trinhDich: TEN_TRINH_DICH_ST.rusty,
      laScl: dau.phuongNgu === "scl",
      loi: chanDoan.filter((d) => d.mucDo === "error").map(dongLoiST),
      dinhDangTep: dau.coTep,
    });
    let moi: string;
    try {
      daGoi = vong;
      moi = await y.goiLai(tin, lanTruoc);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      break; // model lỗi giữa vòng ⇒ trả bản tốt nhất đã có
    }
    let r: Awaited<ReturnType<typeof kiem>>;
    try {
      r = await kiem(moi);
    } catch (e) {
      if (e instanceof LoiBienDichST) break;
      throw e;
    }
    if (!r) break; // bản sửa không còn khối ST ⇒ giữ bản tốt nhất
    lanTruoc = moi;
    chanDoan = r.chanDoan;
    if (r.ok) return kq({ trangThai: "da-sua", phuongNgu: dau.phuongNgu, soVong: vong, soLoiDaSua: loiDau, cauTraLoiCuoi: moi });
    if (soLoi(r.chanDoan) < soLoi(tot.chanDoan)) tot = { chu: moi, chanDoan: r.chanDoan };
    if (vong === vongToiDa) return kq({ trangThai: "con-loi", phuongNgu: dau.phuongNgu, soVong: vong, chanDoanCuoi: tot.chanDoan, cauTraLoiCuoi: tot.chu });
  }
  return kq({ trangThai: "con-loi", phuongNgu: dau.phuongNgu, soVong: daGoi, chanDoanCuoi: tot.chanDoan, cauTraLoiCuoi: tot.chu });
}

/**
 * ★ Đợt 9 (2026-10-22, dieu-phoi — ablation tác nhân 36 lượt đạt cổng đăng ký trước) — giá trị MẶC ĐỊNH khi `AI_KIEM_BIEN_DICH_ST`
 * KHÔNG đặt: `agent-plc` (lộ `compile_st` + luật 13 cho tác nhân, CHỈ ở dự án nhận diện là PLC). Mọi bề mặt khác (v1, tro-ly,
 * cmdk) vẫn TẮT mặc định. Đặt rõ (`off`, danh sách khác) ⇒ theo env, không mặc định nào chen vào.
 */
export const KIEM_BIEN_DICH_ST_MAC_DINH = "agent-plc,v1-stream";

/**
 * ★ (2026-10-22, dieu-phoi — A/B /v1 #2 đạt cổng +8/72, nhưng > 300 s 0 → 7/72 = 10 %) — chế độ vòng kiểm cho /v1:
 *   `bat`         (env có `v1`/`all`): stream + non-stream, khách tắt được bằng `st4i_kiem_bien_dich:false`;
 *   `chi-stream`  (`v1-stream` — MẶC ĐỊNH khi env không đặt): STREAM bật (keep-alive, giữ chunk finish_reason); NON-STREAM tắt —
 *                 khách non-stream có trần header 300 s (fetch Node/SDK) sẽ bị CẮT ~10 % lượt nếu bật, tệ hơn không bật — trừ khi
 *                 khách tự opt-in `st4i_kiem_bien_dich:true`;
 *   `tat`.
 */
export function cheDoKiemBienDichV1(env: NodeJS.ProcessEnv = process.env): "bat" | "chi-stream" | "tat" {
  const ds = dsCoKiemBienDich(env);
  if (ds.includes("v1") || ds.includes("all")) return "bat";
  if (ds.includes("v1-stream")) return "chi-stream";
  return "tat";
}

function dsCoKiemBienDich(env: NodeJS.ProcessEnv): string[] {
  return (env.AI_KIEM_BIEN_DICH_ST ?? KIEM_BIEN_DICH_ST_MAC_DINH).split(",").map((x) => x.trim().toLowerCase());
}

/** Cờ `AI_KIEM_BIEN_DICH_ST` = danh sách bề mặt (`v1`, `tro-ly`, `cmdk`, `agent`, `agent-plc`, `all`) hoặc `off`. */
export function kiemBienDichBat(beMat: "v1" | "tro-ly" | "cmdk" | "agent", env: NodeJS.ProcessEnv = process.env): boolean {
  const ds = dsCoKiemBienDich(env);
  return ds.includes(beMat) || ds.includes("all");
}

/** `compile_st` cho TÁC NHÂN: `moi-du-an` (agent/all) · `plc` (agent-plc — mặc định) · `tat`. */
export function cheDoCompileStTacNhan(env: NodeJS.ProcessEnv = process.env): "moi-du-an" | "plc" | "tat" {
  const ds = dsCoKiemBienDich(env);
  if (ds.includes("agent") || ds.includes("all")) return "moi-du-an";
  if (ds.includes("agent-plc")) return "plc";
  return "tat";
}

/** Dòng ghi chú cho người dùng (không thay lặng lẽ). `null` = không hiển thị gì ("bo-qua"). */
/** Tóm tắt máy đọc được của một lượt kiểm (header `x-st4i-bien-dich` của /v1, ô `kiemBienDichST` của `done` ở trợ lý). */
export function headerKiemBienDich(k: KetQuaKiemBienDichST): string {
  if (k.trangThai === "bo-qua") return "ok=skip";
  const loiCon = k.chanDoanCuoi.filter((d) => d.mucDo === "error").length;
  const ok = k.trangThai === "sach" || k.trangThai === "da-sua" ? "1" : k.trangThai === "khong-kiem-duoc" ? "na" : "0";
  return `ok=${ok}; trang-thai=${k.trangThai}; vong=${k.soVong}; sua=${k.soLoiDaSua}; con=${loiCon}`;
}

export function nhanKiemBienDich(k: KetQuaKiemBienDichST): string | null {
  switch (k.trangThai) {
    case "bo-qua":
      return null;
    case "sach":
      return "✓ Đã biên dịch thử mã ST (RuSTy): không lỗi.";
    case "da-sua":
      return `✓ Đã tự sửa ${k.soLoiDaSua} lỗi biên dịch (RuSTy) sau ${k.soVong} vòng — bản dưới đây là bản đã sửa.`;
    case "con-loi":
      return `⚠ Mã ST còn ${soLoi(k.chanDoanCuoi)} lỗi biên dịch (RuSTy) sau ${k.soVong} vòng tự sửa:\n${chanDoanChoModel(k.chanDoanCuoi)}`;
    case "khong-kiem-duoc":
      return `ℹ Chưa kiểm biên dịch được (${k.lyDo ?? "hạ tầng"}).`;
  }
}
