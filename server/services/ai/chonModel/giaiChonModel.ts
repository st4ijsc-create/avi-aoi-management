/**
 * ★ Đợt 10.1 A2 — HỢP ĐỒNG `chonModel` dùng chung cho mọi bề mặt. Vắng / `auto` ⇒ `null` (người gọi giữ NGUYÊN đường
 * hiện nay, không đổi một byte). Giá trị lạ ⇒ BAD_REQUEST — KHÔNG BAO GIỜ âm thầm rơi về mặc định.
 *
 * Bất biến (rà kiem-dinh mục 6): `vai-tro:*` và `ho-so:*` LUÔN ra `loai:"local"`; chỉ `ngoai:*` có trong danh mục ngoài
 * của nhà máy mới ra `loai:"ngoai"`; `auto` không bao giờ ra ngoài. Mã khớp `CHON_MODEL_RE` CHƯA đủ — còn phải có trong
 * danh mục (không tin regex).
 */
import { appError } from "../../../_core/appError";
import { toBasename } from "../modelResolver";
import type { AnhSoModel } from "../soModel/anhSoModel";
import {
  dinhTuyenVaiTro,
  laVaiTroDaBiet,
  laVaiTroSinhChu,
  VAI_TRO_NHE_KHONG_DOI_KHE,
  type KetQuaDinhTuyen,
  type YeuCauDinhTuyen,
} from "../soModel/dinhTuyenVaiTro";
import { trangThaiHoSo } from "./danhMuc";
import { CHON_MODEL_RE, type PhuThuocDanhMuc } from "./kieu";

export type DichChon =
  | {
      loai: "local";
      /** basename GGUF (không `.gguf`); `undefined` = engine dùng mặc định (như định tuyến hiện nay). */
      modelId: string | undefined;
      vaiTro: string;
      nguon: KetQuaDinhTuyen["nguon"] | "chon-tuong-minh";
      phamVi: string | null;
      canDoiKhe: boolean;
      uocTinhDoiKheGiay?: number;
    }
  | { loai: "ngoai"; nhaCungCap: string; model: string };

export interface NguCanhChon {
  phamVi?: YeuCauDinhTuyen["phamVi"];
  khongDoiKhe?: boolean;
  kheBiKhoa?: boolean;
  factoryId: number | null;
  /** true = bề mặt SINH CHỮ (chat / agent / lập trình / node sinh chữ) ⇒ cấm vai nhúng / xếp hạng / thị giác. */
  beMatChu: boolean;
}

const DANG_HOP_LE = "auto | vai-tro:<id> | ho-so:<id> | ngoai:<nha-cung-cap>:<model>";

function khongHopLe(reason: string, chiTiet: string): never {
  throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "chonModel", reason }, `chonModel không hợp lệ (${chiTiet}); dạng hợp lệ: ${DANG_HOP_LE}`);
}

export async function giaiChonModel(
  chonModel: string | undefined,
  ngu: NguCanhChon,
  dep: PhuThuocDanhMuc,
): Promise<DichChon | null> {
  if (chonModel === undefined || chonModel === "" || chonModel === "auto") return null;
  if (!CHON_MODEL_RE.test(chonModel)) khongHopLe("chonModelKhongHopLe", "sai dạng");
  const env = dep.env ?? process.env;

  if (chonModel.startsWith("vai-tro:")) return giaiVaiTro(chonModel.slice("vai-tro:".length), ngu, dep.anh, dep.kheDangGiu, env);

  if (chonModel.startsWith("ho-so:")) {
    const id = chonModel.slice("ho-so:".length);
    const p = dep.anh.profile.get(id);
    const trangThai = p ? trangThaiHoSo(id, p, dep) : null;
    if (!p || !trangThai || trangThai === "tat") khongHopLe("chonModelKhongHopLe", `hồ sơ ${id} không có, chưa đo, chưa khai giấy phép hoặc đang tắt`);
    const canDoiKhe = trangThai === "can-doi-khe";
    const dich: DichChon = { loai: "local", modelId: toBasename(p.artifactFile), vaiTro: "ho-so", nguon: "chon-tuong-minh", phamVi: null, canDoiKhe };
    if (canDoiKhe) {
      const uoc = await dep.uocTinhDoiKheGiay().catch(() => null);
      if (uoc !== null) dich.uocTinhDoiKheGiay = uoc;
    }
    return dich;
  }

  // ngoai:<ncc>:<model> — model có thể chứa ":" (vd "a:b") ⇒ tách ở dấu ":" ĐẦU sau tiền tố.
  const sau = chonModel.slice("ngoai:".length);
  const i = sau.indexOf(":");
  const nhaCungCap = sau.slice(0, i);
  const model = sau.slice(i + 1);
  const daBat = await dep.ngoai.layModelDaBat(ngu.factoryId);
  if (!daBat.some((m) => m.nhaCungCap === nhaCungCap && m.model === model)) {
    throw appError("NOT_FOUND", "OPERATION_FAILED", { operation: "chonModel", reason: "modelNgoaiKhongTonTaiHoacNgoaiPhamVi" }, "model ngoài không tồn tại hoặc ngoài phạm vi");
  }
  return { loai: "ngoai", nhaCungCap, model };
}

function giaiVaiTro(vaiTro: string, ngu: NguCanhChon, anh: AnhSoModel, kheDangGiu: string | null, env: NodeJS.ProcessEnv): DichChon {
  if (!laVaiTroDaBiet(vaiTro, anh)) khongHopLe("chonModelKhongHopLe", `vai trò ${vaiTro} không có`);
  if (ngu.beMatChu && !laVaiTroSinhChu(vaiTro, anh)) khongHopLe("chonModelKhongSinhChu", `vai trò ${vaiTro} không sinh chữ`);
  const khongDoiKhe = ngu.khongDoiKhe ?? (ngu.phamVi?.beMat === "luong" && VAI_TRO_NHE_KHONG_DOI_KHE.has(vaiTro));
  const kq = dinhTuyenVaiTro({ vaiTro, phamVi: ngu.phamVi, khongDoiKhe, kheBiKhoa: ngu.kheBiKhoa, kheDangGiu }, anh, env);
  return {
    loai: "local",
    modelId: kq.model,
    vaiTro: kq.vaiTro,
    nguon: kq.nguon,
    phamVi: kq.phamVi,
    canDoiKhe: kq.lyDo.bangChung.includes("can-doi-khe"),
  };
}
