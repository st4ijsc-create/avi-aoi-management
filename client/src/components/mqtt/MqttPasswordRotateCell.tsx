/**
 * doc 81 Đợt 1C Task 5b fix round 1+2 — ô "Mật khẩu MQTT": cấp/xoay mật khẩu và XOÁ mật khẩu thiết bị.
 *
 * Máy chủ (`mqttClient.rotatePassword`) sinh mật khẩu ngẫu nhiên, chỉ lưu bcrypt, và trả bản rõ ĐÚNG MỘT
 * lần trong phản hồi. Bản rõ nằm ở HAI chỗ phía trình duyệt: state của hộp thoại kết quả VÀ state của
 * mutation react-query (`rotate.data`) — đóng hộp thoại xoá CẢ HAI (`setMatKhau(null)` + `rotate.reset()`).
 * Không log, không localStorage.
 *
 * ⚠ App FactoryAlertSystem trên broker nhúng KHÔNG gửi mật khẩu ⇒ cấp mật khẩu cho máy tính bảng là khoá
 * nó ngoài. Vì vậy: (1) câu cảnh báo nói thẳng điều đó; (2) thiết bị báo `appVersion` (SUY ĐOÁN là máy
 * tính bảng chạy app — không chắc chắn) phải gõ lại mã thiết bị trước khi xoay; (3) có đường phục hồi
 * "Xoá mật khẩu" (`mqttClient.clearCredential` — gỡ luôn ràng buộc máy nếu có).
 *
 * Chỉ admin/engineer có settings_factory canEdit thấy (cùng cổng `coTheGanMayMqtt`); máy chủ vẫn tự kiểm.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Copy, AlertTriangle, Eraser } from "lucide-react";
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

export interface MqttCredentialRow {
  id: number;
  deviceId: string;
  hasCredential?: boolean | null;
  hasLegacyPlaintext?: boolean | null;
  appVersion?: string | null;
}

export function MqttPasswordRotateCell({
  client,
  canEdit,
  onChanged,
}: {
  client: MqttCredentialRow;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [goMa, setGoMa] = useState("");
  const [matKhau, setMatKhau] = useState<string | null>(null);
  const [openXoa, setOpenXoa] = useState(false);
  const [lyDoXoa, setLyDoXoa] = useState("");

  const rotate = trpc.mqttClient.rotatePassword.useMutation({
    onSuccess: (r) => {
      setOpen(false);
      setMatKhau(r.password);
      onChanged?.();
    },
    onError: (e) => toastTrpcError(e),
  });
  const clear = trpc.mqttClient.clearCredential.useMutation({
    onSuccess: () => {
      setOpenXoa(false);
      onChanged?.();
    },
    onError: (e) => toastTrpcError(e),
  });

  if (!canEdit) return null;

  // SUY ĐOÁN: thiết bị báo appVersion ⇒ có thể là máy tính bảng chạy FactoryAlertSystem.
  const coTheLaApp = Boolean(client.appVersion && String(client.appVersion).trim());
  const daGoDung = !coTheLaApp || goMa.trim() === client.deviceId;
  const coCredential = Boolean(client.hasCredential || client.hasLegacyPlaintext);

  const dongKetQua = () => {
    setMatKhau(null);
    rotate.reset(); // bản rõ cũng rời state mutation của react-query
  };

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
      ) : client.hasLegacyPlaintext ? (
        <Badge variant="outline" className="text-warning" data-testid={`mqtt-cred-${client.id}`}>{t("mqtt.clientMgmt.legacyPlaintext")}</Badge>
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
          setGoMa("");
          setOpen(true);
        }}
      >
        <KeyRound className="w-4 h-4" />
      </Button>
      {coCredential && (
        <Button
          variant="ghost"
          size="sm"
          title={t("mqtt.clientMgmt.clearCredential")}
          aria-label={t("mqtt.clientMgmt.clearCredential")}
          onClick={() => {
            setLyDoXoa("");
            setOpenXoa(true);
          }}
        >
          <Eraser className="w-4 h-4" />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mqtt.clientMgmt.rotatePasswordTitle")}</DialogTitle>
            <DialogDescription>{t("mqtt.clientMgmt.rotatePasswordDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-mono">{client.deviceId}</div>
            {coTheLaApp && (
              <div className="space-y-1">
                <p className="flex gap-2 text-sm text-warning" data-testid="rotate-app-warning">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{t("mqtt.clientMgmt.rotateAppDeviceWarning")}</span>
                </p>
                <Label htmlFor={`rotate-type-${client.id}`}>{t("mqtt.clientMgmt.rotateTypeDeviceId")}</Label>
                <Input id={`rotate-type-${client.id}`} value={goMa} autoComplete="off" onChange={(e) => setGoMa(e.target.value)} />
              </div>
            )}
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
              disabled={lyDo.trim().length < LY_DO_TOI_THIEU || !daGoDung || rotate.isPending}
              onClick={() => rotate.mutate({ clientId: client.id, reason: lyDo.trim() })}
            >
              {t("mqtt.clientMgmt.rotatePasswordConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={matKhau !== null} onOpenChange={(o) => { if (!o) dongKetQua(); }}>
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
            <Button onClick={dongKetQua}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openXoa} onOpenChange={setOpenXoa}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mqtt.clientMgmt.clearCredentialTitle")}</DialogTitle>
            <DialogDescription>{t("mqtt.clientMgmt.clearCredentialDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-mono">{client.deviceId}</div>
            <Label htmlFor={`clear-reason-${client.id}`}>{t("mqtt.clientMgmt.bindReason")}</Label>
            <Textarea
              id={`clear-reason-${client.id}`}
              value={lyDoXoa}
              maxLength={500}
              placeholder={t("mqtt.clientMgmt.bindReasonPlaceholder")}
              onChange={(e) => setLyDoXoa(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenXoa(false)}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={lyDoXoa.trim().length < LY_DO_TOI_THIEU || clear.isPending}
              onClick={() => clear.mutate({ clientId: client.id, reason: lyDoXoa.trim() })}
            >
              {t("mqtt.clientMgmt.clearCredentialConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
