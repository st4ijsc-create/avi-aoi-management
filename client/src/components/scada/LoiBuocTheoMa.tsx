/**
 * C2 (che chi tiết kỹ thuật) — lỗi của một BƯỚC orchestration nay là MÃ cho người không phải kỹ sư (`FOE_OUTCOME_UNKNOWN`,
 * `TIMEOUT`, `REJECTED`…); kỹ sư vẫn nhận văn bản đầy đủ, đầu chuỗi vẫn là mã. Hiện câu DỊCH của mã đứng đầu chuỗi lỗi;
 * mã không có câu dịch ⇒ không hiện gì (như trước C2: văn bản thô của bước không được in ra). Không đổi gì về quyền — chỉ là trình bày.
 */
import { useTranslation } from "react-i18next";
import { cauMaLoi, maDauChuoiLoi } from "./nhanMaLoi";

export function LoiBuocTheoMa({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const ma = maDauChuoiLoi(error);
  const cau = ma ? cauMaLoi(t, ma) : null;
  if (!ma || !cau) return null;
  return (
    <p data-testid="step-error-code" data-code={ma} className="pb-1 pl-2 text-[11px] text-amber-700 dark:text-amber-300">
      {cau}
    </p>
  );
}
