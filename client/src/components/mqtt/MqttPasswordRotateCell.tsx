/**
 * doc 81 Đợt 1C Task 5b fix round 1 — ô "Mật khẩu MQTT" + cấp/xoay mật khẩu thiết bị.
 *
 * Máy chủ (`mqttClient.rotatePassword`) sinh mật khẩu ngẫu nhiên, chỉ lưu bcrypt, và trả bản rõ ĐÚNG MỘT
 * lần trong phản hồi. Ô này chỉ giữ bản rõ trong state của hộp thoại kết quả (xoá khi đóng) — không log,
 * không lưu localStorage, không đưa vào cache query. Chỉ admin/engineer có settings_factory canEdit thấy
 * (cùng cổng `coTheGanMayMqtt`); máy chủ vẫn tự kiểm.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Copy, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const LY_DO_TOI_THIEU = 3;

export function MqttPasswordRotateCell({
  client,
  canEdit,
  onChanged,
}: {
  client: { id: number; deviceId: string; hasCredential?: boolean | null };
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [matKhau, setMatKhau] = useState<string | null>(null);

  const rotate = trpc.mqttClient.rotatePassword.useMutation({
    onSuccess: (r) => {
      setOpen(false);
      setMatKhau(r.password);
      onChanged?.();
    },
    onError: (e) => toastTrpcError(e),
  });

  if (!canEdit) return null;

  const saoChep = async () => {
    if (!matKhau) return;
    try {
      await navigator.clipboard.writeText(matKhau);
      toast.success(t("common.copied"));
    } catch {
      /* clipboard bị chặn — người dùng vẫn chọn-sao chép được từ ô nhập */
    }
  };

  return (
    <div className="flex items-center gap-2">
      {client.hasCredential ? (
        <Badge variant="outline" data-testid={`mqtt-cred-${client.id}`}>{t("mqtt.clientMgmt.hasCredential")}</Badge>
      ) : (
        <Badge variant="outline" className="text-warning" data-testid={`mqtt-cred-${client.id}`}>{t("mqtt.clientMgmt.noCredential")}</Badge>
      )}
      <Button
        variant="ghost"
        size="sm"
        title={t("mqtt.clientMgmt.rotatePassword")}
        aria-label={t("mqtt.clientMgmt.rotatePassword")}
        onClick={() => {
          setLyDo("");
          setOpen(true);
        }}
      >
        <KeyRound className="w-4 h-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mqtt.clientMgmt.rotatePasswordTitle")}</DialogTitle>
            <DialogDescription>{t("mqtt.clientMgmt.rotatePasswordDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-mono">{client.deviceId}</div>
            <Label htmlFor={`rotate-reason-${client.id}`}>{t("mqtt.clientMgmt.bindReason")}</Label>
            <Textarea
              id={`rotate-reason-${client.id}`}
              value={lyDo}
              maxLength={500}
              placeholder={t("mqtt.clientMgmt.bindReasonPlaceholder")}
              onChange={(e) => setLyDo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button
              disabled={lyDo.trim().length < LY_DO_TOI_THIEU || rotate.isPending}
              onClick={() => rotate.mutate({ clientId: client.id, reason: lyDo.trim() })}
            >
              {t("mqtt.clientMgmt.rotatePasswordConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={matKhau !== null} onOpenChange={(o) => { if (!o) setMatKhau(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mqtt.clientMgmt.newPasswordTitle")}</DialogTitle>
            <DialogDescription className="flex gap-2 text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{t("mqtt.clientMgmt.newPasswordWarning")}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={matKhau ?? ""} className="font-mono" aria-label={t("mqtt.clientMgmt.newPasswordTitle")} autoComplete="off" />
            <Button variant="outline" onClick={saoChep} aria-label={t("common.copy")}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setMatKhau(null)}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
