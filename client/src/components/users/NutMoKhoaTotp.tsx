/**
 * R1b-2b-2b B-T10 (mục 38) — admin mở khoá xác thực hai lớp (TOTP) của một người dùng KHÁC: nút trên hàng người dùng + hộp lý do.
 * Thủ tục `twoFactor.moKhoaTotp` (adminProcedure): vào { userId, lyDo 5..300 } → ra { success, daMoKhoa }. Máy chủ cấm tự mở khoá,
 * ghi audit mỗi lần, giới hạn 3 lần/giờ/người bị mở. Giao diện chỉ là tiện lợi: không hiện số lần sai, KHÔNG tự thử lại khi bị giới hạn.
 * Lỗi đi qua `toastTrpcError` (mã AppError đã i18n: totpSelfUnlock, ENTITY_NOT_FOUND, RATE_LIMITED).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShieldOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Khớp `lyDo` ở máy chủ (`trim().min(5).max(300)`). */
const LY_DO_TOI_THIEU = 5;
const LY_DO_TOI_DA = 300;

export function NutMoKhoaTotp({ userId, tenHienThi }: { userId: number; tenHienThi: string }) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const mutation = trpc.twoFactor.moKhoaTotp.useMutation({
    onSuccess: (res: { daMoKhoa: boolean }) => {
      if (res.daMoKhoa) toast.success(t("users.totp.moKhoa.daMoKhoa"));
      else toast.info(t("users.totp.moKhoa.khongBiKhoa"));
      setMo(false);
      setLyDo("");
    },
    onError: (e: unknown) => toastTrpcError(e as never),
  });
  const lyDoDu = lyDo.trim().length >= LY_DO_TOI_THIEU;
  const dangGui = mutation.isPending;
  const gui = () => {
    if (!lyDoDu || dangGui) return;
    mutation.mutate({ userId, lyDo: lyDo.trim() });
  };

  return (
    <>
      <Button variant="ghost" size="sm" aria-label={t("users.totp.moKhoa.nut")} title={t("users.totp.moKhoa.nut")} onClick={() => setMo(true)}>
        <ShieldOff aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Dialog open={mo} onOpenChange={(o) => !o && !dangGui && setMo(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("users.totp.moKhoa.tieuDe", { name: tenHienThi })}</DialogTitle>
            <DialogDescription>{t("users.totp.moKhoa.moTa")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`mo-khoa-totp-ly-do-${userId}`}>{t("users.totp.moKhoa.lyDo")}</Label>
            <Textarea
              id={`mo-khoa-totp-ly-do-${userId}`}
              value={lyDo}
              maxLength={LY_DO_TOI_DA}
              onChange={(e) => setLyDo(e.target.value)}
              disabled={dangGui}
            />
            <p className="text-xs text-muted-foreground">{t("users.totp.moKhoa.lyDoGoiY", { min: LY_DO_TOI_THIEU })}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMo(false)} disabled={dangGui}>
              {t("users.totp.moKhoa.huy")}
            </Button>
            <Button onClick={gui} disabled={!lyDoDu || dangGui}>
              {t("users.totp.moKhoa.gui")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
