/**
 * Đợt 10.2 bước 2 — ô chọn model của node `ai.*` trong Flow Studio (thay datalist vai trò).
 * Tương thích ngược: luồng cũ chỉ có `vaiTro` ⇒ hiện đúng `vai-tro:<vaiTro>`; chọn vai trò ⇒ ghi `vaiTro` và XOÁ `chonModel` (một nguồn sự thật);
 * hồ sơ / model ngoài ⇒ ghi `chonModel` chuỗi cố định. Luồng cũ có `chonModel` là BIỂU THỨC ⇒ báo rõ, không phá việc lưu node khác (máy chủ chỉ chặn node đó).
 */
import { useTranslation } from "react-i18next";
import ChonModel from "@/components/ai/ChonModel";
import { CHON_MODEL_RE } from "@/lib/chonModel";
import { Truong } from "./FormKit";

type ThamSo = Record<string, unknown>;

/** Mã đang hiệu lực của node (đọc): chonModel cố định > vaiTro > auto. Biểu thức ⇒ trả nguyên chuỗi (để hiện cảnh báo). */
export function giaTriChonCuaNut(p: ThamSo): { ma: string; laBieuThuc: boolean } {
  const c = p.chonModel;
  if (typeof c === "string" && c.trim()) return CHON_MODEL_RE.test(c) ? { ma: c, laBieuThuc: false } : { ma: c, laBieuThuc: true };
  const v = typeof p.vaiTro === "string" ? p.vaiTro.trim() : "";
  return { ma: v ? `vai-tro:${v}` : "auto", laBieuThuc: false };
}

/** Tham số mới sau khi chọn `ma` (ghi). */
export function apChonVaoNut(p: ThamSo, ma: string): ThamSo {
  const { chonModel: _c, ...con } = p;
  if (ma === "auto") {
    const { vaiTro: _v, ...r } = con;
    return r;
  }
  if (ma.startsWith("vai-tro:")) return { ...con, vaiTro: ma.slice("vai-tro:".length) };
  return { ...con, chonModel: ma };
}

export default function OChonModel({ p, onDoiThamSo }: { p: ThamSo; onDoiThamSo: (n: ThamSo) => void }) {
  const { t } = useTranslation();
  const { ma, laBieuThuc } = giaTriChonCuaNut(p);
  return (
    <Truong nhan={t("flowStudio.cauHinh.chonModel")} goiY={t("flowStudio.cauHinh.chonModelGoiY")}>
      <ChonModel beMat="luong" giaTri={ma} onDoi={(m) => onDoiThamSo(apChonVaoNut(p, m))} nho={false} tuVeAuto={false} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs font-mono" testId="chon-model-nut" />
      {laBieuThuc && (
        <p className="text-xs text-destructive mt-1" role="alert" data-testid="chon-model-bieu-thuc">
          {t("flowStudio.cauHinh.chonModelBieuThuc", { bt: ma })}
        </p>
      )}
    </Truong>
  );
}
