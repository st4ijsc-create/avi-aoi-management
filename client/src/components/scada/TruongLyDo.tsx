/**
 * SCADA R1a Task 13 — ô "Lý do" dùng chung cho mọi hộp thoại sửa của M12 (cùng mẫu với hộp lý do của `ScadaDiag`): bắt buộc, cắt khoảng
 * trắng, ≥ 5 ký tự (khớp `lyDoInput` ở máy chủ: `trim().min(5).max(300)`). Máy chủ vẫn là ranh giới thật.
 */
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const LY_DO_TOI_THIEU = 5;
export const LY_DO_TOI_DA = 300;

export const lyDoDuDai = (lyDo: string): boolean => lyDo.trim().length >= LY_DO_TOI_THIEU;

export function TruongLyDo({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const cat = value.trim();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t("scada.kenh.dialog.lyDo")}</Label>
      <Textarea id={id} rows={3} maxLength={LY_DO_TOI_DA} value={value} onChange={(e) => onChange(e.target.value)} />
      {cat.length > 0 && cat.length < LY_DO_TOI_THIEU && (
        <p className="text-xs text-destructive">{t("scada.kenh.dialog.lyDoNgan", { min: LY_DO_TOI_THIEU })}</p>
      )}
    </div>
  );
}

/** Ô chọn gốc của trình duyệt, cùng kiểu với `Input` (dùng trong hộp thoại — dễ truy cập, không cần Radix Select). */
export const LOP_O_CHON =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
