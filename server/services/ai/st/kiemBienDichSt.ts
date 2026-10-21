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
export function chanDoanTheoKhoi(ds: ChanDoanST[], bang: { tu: number; den: number; chiSo: number }[], soKhoi: number): ChanDoanST[] {
  return ds.map((d) => {
    if (d.dong === null) return d;
    const b = bang.find((x) => d.dong! >= x.tu && d.dong! <= x.den);
    if (!b) return d;
    return { ...d, tep: soKhoi > 1 ? `khối ${b.chiSo + 1}` : "mã", dong: d.dong - b.tu + 1 };
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
  const tranMs = y.tranMs ?? 90_000;
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
    return { ...r, chanDoan: chanDoanTheoKhoi(r.chanDoan, g.bang, khoi.length), phuongNgu: g.phuongNgu };
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
  for (let vong = 1; vong <= vongToiDa; vong++) {
    if (y.signal?.aborted) break;
    if (bayGio() - t0 >= tranMs) break;
    const tin =
      `Trình biên dịch IEC 61131-3 (RuSTy, ${dau.phuongNgu === "scl" ? "mã SCL đã chuẩn hoá sang ST, số dòng giữ nguyên" : "ST"}) báo lỗi:\n` +
      `${chanDoanChoModel(chanDoan)}\n\nSửa các lỗi trên và trả lại ĐẦY ĐỦ mã trong khối \`\`\`${dau.phuongNgu === "scl" ? "scl" : "st"} … \`\`\` (không lược bớt phần đúng).`;
    let moi: string;
    try {
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
  return kq({ trangThai: "con-loi", phuongNgu: dau.phuongNgu, soVong: lanTruoc === y.cauTraLoi ? 0 : vongToiDa, chanDoanCuoi: tot.chanDoan, cauTraLoiCuoi: tot.chu });
}

/** Cờ `AI_KIEM_BIEN_DICH_ST` = danh sách bề mặt (`v1`, `tro-ly`, `cmdk`) hoặc `off` (mặc định). */
export function kiemBienDichBat(beMat: "v1" | "tro-ly" | "cmdk", env: NodeJS.ProcessEnv = process.env): boolean {
  const ds = (env.AI_KIEM_BIEN_DICH_ST ?? "off").split(",").map((x) => x.trim().toLowerCase());
  return ds.includes(beMat) || ds.includes("all");
}

/** Dòng ghi chú cho người dùng (không thay lặng lẽ). `null` = không hiển thị gì ("bo-qua"). */
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
