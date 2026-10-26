/**
 * Đợt 10.2 — Ô CHỌN MODEL dùng chung (Chat AI · bong bóng · lập trình · agent · node Luồng · extension dùng bản riêng cùng hợp đồng).
 * Nhóm: Tự động · Vai trò · Hồ sơ Local · Model ngoài (chỉ khi danh mục có). `tat` ⇒ vô hiệu; `can-doi-khe` ⇒ hậu tố "cần đổi khe ~N s | chưa đo". Lựa chọn dính theo bề mặt (localStorage).
 * `auto` KHÔNG BAO GIỜ tự đổi sang model ngoài — ô không bao giờ tự thêm mục ngoài danh mục.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDanhMucModel } from "@/hooks/useDanhMucModel";
import { docChonDaLuu, hauToTrangThai, luuChon, nhomMuc, xacThucChon, type BeMatChon, type MucModel } from "@/lib/chonModel";

interface Props {
  beMat: BeMatChon;
  /** Mã hiện chọn (điều khiển từ ngoài — bề mặt giữ state). */
  giaTri: string;
  onDoi: (ma: string) => void;
  /** Nhỏ gọn (thanh công cụ). */
  compact?: boolean;
  /** `false` ⇒ không ghi localStorage (node Luồng lưu vào tham số, không vào máy người dùng). */
  nho?: boolean;
  /** `false` ⇒ mã không còn trong danh mục vẫn GIỮ NGUYÊN (form node: không âm thầm xoá dữ liệu đã lưu của luồng). */
  tuVeAuto?: boolean;
  className?: string;
  testId?: string;
}

const NHAN_NHOM: Record<string, [string, string]> = {
  vaiTro: ["chonModel.nhom.vaiTro", "Vai trò"],
  hoSo: ["chonModel.nhom.hoSo", "Hồ sơ Local"],
  ngoai: ["chonModel.nhom.ngoai", "Model ngoài"],
};

export default function ChonModel({ beMat, giaTri, onDoi, compact, nho = true, tuVeAuto = true, className, testId }: Props) {
  const { t } = useTranslation();
  const { danhMuc, daTai } = useDanhMucModel();
  const nhom = nhomMuc(danhMuc, beMat);
  const daBao = useRef(false);

  // Mã đã lưu mà danh mục không còn ⇒ về auto + toast MỘT lần (chỉ khi danh mục đã tải thật).
  useEffect(() => {
    if (!daTai || !tuVeAuto) return;
    const kq = xacThucChon(giaTri, danhMuc);
    if (kq.hetHieuLuc) {
      onDoi("auto");
      if (nho) luuChon(beMat, "auto");
      if (!daBao.current) {
        daBao.current = true;
        toast.info(t("chonModel.hetHieuLuc", "Model đã chọn không còn khả dụng — dùng Tự động."));
      }
    }
  }, [daTai, tuVeAuto, giaTri, danhMuc, beMat, nho, onDoi, t]);

  const mot = (m: MucModel) => {
    const hau = hauToTrangThai(m, (k, def, o) => String(t(k, { defaultValue: def, ...o })));
    return (
      <option key={m.ma} value={m.ma} disabled={m.trangThai === "tat"} title={m.moTa}>
        {m.loai === "auto" ? t("chonModel.tuDong", "Tự động") : m.nhan}
        {hau ? ` — ${hau}` : ""}
      </option>
    );
  };
  const nhomOpt = (khoa: "vaiTro" | "hoSo" | "ngoai", ds: MucModel[]) =>
    ds.length ? (
      <optgroup key={khoa} label={t(NHAN_NHOM[khoa][0], NHAN_NHOM[khoa][1])}>
        {ds.map(mot)}
      </optgroup>
    ) : null;

  return (
    <select
      data-testid={testId ?? `chon-model-${beMat}`}
      aria-label={t("chonModel.nhan", "Chọn model")}
      className={className ?? `rounded-md border border-input bg-background px-1.5 ${compact ? "h-[22px] text-[10px]" : "h-8 text-xs"}`}
      value={giaTri}
      onChange={(e) => {
        onDoi(e.target.value);
        if (nho) luuChon(beMat, e.target.value);
      }}
    >
      {mot(nhom.tuDong)}
      {nhomOpt("vaiTro", nhom.vaiTro)}
      {nhomOpt("hoSo", nhom.hoSo)}
      {nhomOpt("ngoai", nhom.ngoai)}
      {/* mã đang chọn mà chưa có trong danh mục (đang tải / vừa hết hiệu lực) vẫn hiện để select không nhảy giá trị */}
      {!danhMuc.some((m) => m.ma === giaTri) ? <option value={giaTri}>{giaTri}</option> : null}
    </select>
  );
}

export { docChonDaLuu };
