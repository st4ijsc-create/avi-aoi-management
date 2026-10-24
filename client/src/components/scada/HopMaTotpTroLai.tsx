/**
 * SCADA R1b-1 Task 9 — "trỏ lại kênh cần TOTP": `deviceAdapter.tags.update` (và `mappingAsCode.applyImport`) đòi mã TOTP tươi CHỈ khi lượt lưu
 * trỏ lại một tag ĐÃ KHAI kênh — máy chủ mới biết điều đó (khai báo kênh + kênh chế độ không có trong form). Nên form KHÔNG hiện ô mã sẵn:
 * gửi như cũ; máy chủ trả `SCADA_CONFIG_TOTP_REQUIRED` (ma TOTP_CAN) ⇒ hộp này mở với ô mã 6 số (`TruongTotp` — cùng ô của M12), người
 * dùng nhập rồi GỬI LẠI CHÍNH lượt đó kèm `totpCode`. Mã sai / đã dùng / tạm khoá (`laLoiMaTotp`) ⇒ giữ hộp mở, xoá ô mã, báo lỗi.
 *
 * `xuLyLoi(e, bien)` trả true khi đã xử lý (bên gọi KHÔNG toast thêm); `daXong()` đóng hộp sau một lượt thành công.
 */
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toastTrpcError } from "@/lib/trpcErrors";
import { TruongTotp, laLoiMaTotp, maTotpDu } from "./TruongLyDo";

/** Máy chủ nói lượt này cần mã TOTP (thiếu mã) — appCode của `kiemTotpCauHinh` cho TOTP_CAN. */
export function laLoiCanMaTotp(e: unknown): boolean {
  return (e as { data?: { appCode?: string } } | null)?.data?.appCode === "SCADA_CONFIG_TOTP_REQUIRED";
}

export function useHopMaTotpTroLai<V extends object>(guiLai: (bien: V & { totpCode: string }) => void, dangGui: boolean) {
  const { t } = useTranslation();
  const [cho, setChoState] = useState<V | null>(null);
  // Bản sao đồng bộ của `cho`: onError của useMutation có thể chạy với closure của lượt render trước.
  const choRef = useRef<V | null>(null);
  const setCho = (v: V | null) => {
    choRef.current = v;
    setChoState(v);
  };
  const [ma, setMa] = useState("");

  const xuLyLoi = (e: unknown, bien: V): boolean => {
    const dangHoi = choRef.current !== null;
    if (laLoiCanMaTotp(e) && !dangHoi) {
      // lượt đầu (chưa có mã) ⇒ hỏi mã; bỏ `totpCode` cũ nếu có để lượt gửi lại mang đúng mã mới
      const { totpCode: _bo, ...goc } = bien as V & { totpCode?: string };
      setCho(goc as V);
      setMa("");
      return true;
    }
    if (dangHoi && laLoiMaTotp(e)) {
      setMa("");
      toastTrpcError(e as never);
      return true;
    }
    if (dangHoi) setCho(null); // lỗi khác khi đang gửi lại ⇒ đóng hộp, bên gọi báo lỗi
    return false;
  };
  const daXong = () => {
    setCho(null);
    setMa("");
  };
  const maDu = maTotpDu(ma);
  const gui = () => {
    if (cho === null || !maDu || dangGui) return;
    guiLai({ ...cho, totpCode: ma });
  };

  const hop: ReactNode = (
    <Dialog open={cho !== null} onOpenChange={(o) => !o && !dangGui && daXong()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deviceAdapter.troLai.title")}</DialogTitle>
          <DialogDescription>{t("deviceAdapter.troLai.body")}</DialogDescription>
        </DialogHeader>
        <TruongTotp id="tro-lai-totp" value={ma} onChange={setMa} disabled={dangGui} />
        <DialogFooter>
          <Button variant="outline" disabled={dangGui} onClick={daXong}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!maDu || dangGui} onClick={gui}>
            {t("deviceAdapter.troLai.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { xuLyLoi, daXong, hop };
}
