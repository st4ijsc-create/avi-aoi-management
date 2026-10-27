/**
 * Đợt 10.4 (T3) — form CÓ KIỂU cho node `ai.kiem-dinh-ngoai`: AI NGOÀI kiểm định câu trả lời / mã của bước trước.
 * `chonModel` là chuỗi CỐ ĐỊNH `ngoai:<ncc>:<model>` — ô chọn CHỈ liệt kê mục `ngoai` mà máy chủ khai dùng được ở Luồng (`duocDungO ∋ "luong"`),
 * KHÔNG có "Tự động"/model cục bộ (máy chủ từ chối). Rỗng được phép lúc LƯU (sau nhập gói: "việc phải điền"), nhưng KHÔNG chạy được khi rỗng.
 * Ghi chú bắt buộc: duyệt phiên bản · dữ liệu vận hành chỉ khi nhà máy cho phép · kết quả AI ngoài là dữ liệu không tin cậy · tối đa 20 item.
 * Máy chủ kiểm lại mọi thứ y như nhau (đường JSON thô không vượt được).
 */
import { useTranslation } from "react-i18next";
import { useDanhMucModel } from "@/hooks/useDanhMucModel";
import { Input } from "@/components/ui/input";
import { DUOC_DUNG_O } from "@/lib/chonModel";
import { O_CHON, OBieuThuc, Truong } from "./FormKit";

export const TRAN_ITEM_KIEM_DINH_FORM = 20;
export const RE_TRUONG_RA_KIEM_DINH_FORM = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

interface Props {
  p: Record<string, unknown>;
  doi: (k: string, v: unknown) => void;
}

export function FormKiemDinhNgoai({ p, doi }: Props) {
  const { t } = useTranslation();
  const { danhMuc } = useDanhMucModel();
  const s = (k: string) => (p[k] === undefined || p[k] === null ? "" : String(p[k]));
  const chon = s("chonModel");
  const ngoai = danhMuc.filter((m) => m.loai === "ngoai" && Array.isArray(m.duocDungO) && m.duocDungO.includes(DUOC_DUNG_O.luong));
  const coTrongDs = ngoai.some((m) => m.ma === chon);
  const truongRa = s("truongRa");
  return (
    <div className="space-y-3" data-testid="form-kiem-dinh-ngoai">
      <p className="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-xs" data-testid="kdn-ghi-chu">
        {t("flowStudio.form.kiemDinhNgoai.ghiChu", { max: TRAN_ITEM_KIEM_DINH_FORM })}
      </p>
      <Truong nhan={t("flowStudio.form.kiemDinhNgoai.model")} goiY={t("flowStudio.form.kiemDinhNgoai.modelGoiY")}>
        <select data-testid="kdn-model" className={O_CHON} value={chon} onChange={(e) => doi("chonModel", e.target.value)}>
          <option value="">{t("flowStudio.form.kiemDinhNgoai.chuaChon")}</option>
          {ngoai.map((m) => (
            <option key={m.ma} value={m.ma} disabled={m.trangThai === "tat"}>
              {m.nhan}
            </option>
          ))}
          {chon !== "" && !coTrongDs && <option value={chon}>{chon}</option>}
        </select>
        {ngoai.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="kdn-khong-co-model">
            {t("flowStudio.form.kiemDinhNgoai.khongCoModel")}
          </p>
        )}
        {chon !== "" && !coTrongDs && ngoai.length > 0 && (
          <p className="text-xs text-destructive" role="alert" data-testid="kdn-model-het">
            {t("flowStudio.form.kiemDinhNgoai.modelHet")}
          </p>
        )}
        {chon === "" && (
          <p className="text-xs text-destructive" role="alert" data-testid="kdn-chua-chon">
            {t("flowStudio.form.kiemDinhNgoai.chuaChonCanhBao")}
          </p>
        )}
      </Truong>
      <Truong nhan={t("flowStudio.form.kiemDinhNgoai.cauHoi")} goiY={t("flowStudio.form.kiemDinhNgoai.cauHoiGoiY")}>
        <OBieuThuc testId="kdn-cau-hoi" nhieuDong giaTri={p.cauHoi} onDoi={(v) => doi("cauHoi", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.kiemDinhNgoai.traLoi")} goiY={t("flowStudio.form.kiemDinhNgoai.traLoiGoiY")}>
        <OBieuThuc testId="kdn-tra-loi" nhieuDong giaTri={p.traLoi} onDoi={(v) => doi("traLoi", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.kiemDinhNgoai.tieuChi")} goiY={t("flowStudio.form.kiemDinhNgoai.tieuChiGoiY")}>
        <OBieuThuc testId="kdn-tieu-chi" nhieuDong giaTri={p.tieuChi} onDoi={(v) => doi("tieuChi", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.cauHinh.truongRa")} goiY={t("flowStudio.form.kiemDinhNgoai.truongRaGoiY")}>
        <Input data-testid="kdn-truong-ra" className="h-9 text-xs font-mono" value={truongRa} placeholder="kiemDinh" onChange={(e) => doi("truongRa", e.target.value === "" ? undefined : e.target.value)} />
        {truongRa !== "" && !RE_TRUONG_RA_KIEM_DINH_FORM.test(truongRa) && (
          <p className="text-xs text-destructive" role="alert" data-testid="kdn-truong-ra-sai">
            {t("flowStudio.form.kiemDinhNgoai.truongRaSai")}
          </p>
        )}
      </Truong>
    </div>
  );
}
