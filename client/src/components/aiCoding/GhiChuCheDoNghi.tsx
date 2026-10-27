/** Một dòng cảnh báo cạnh công tắc chế độ nghĩ khi đang ở "Nhanh" (F3: tắt nghĩ ⇒ kém đúng hơn). */
import { useTranslation } from "react-i18next";

export function GhiChuCheDoNghi({ cheDo }: { cheDo: "can-bang" | "nhanh" }) {
  const { t } = useTranslation();
  if (cheDo !== "nhanh") return null;
  return (
    <span data-testid="ghi-chu-che-do-nghi" className="text-[10px] text-warning">
      {t("repoWs.nghiPick.nhanhCanhBao", "Nhanh: trả lời nhanh hơn nhưng có thể kém chính xác hơn (không suy nghĩ)")}
    </span>
  );
}
