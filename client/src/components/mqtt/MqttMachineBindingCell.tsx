/**
 * doc 81 Đợt 1C Task 5b — ô "Gắn với máy" của bảng thiết bị MQTT + hộp thoại gắn/gỡ.
 *
 * Ràng buộc thiết bị ↔ máy (`mqtt_clients."machineId"`) là thứ broker dùng để cho thiết bị ghi/đọc
 * `factory/…` và `syn/…` của ĐÚNG máy đó (Task 5). Chỉ admin/engineer có `settings_factory` canEdit mới
 * thấy cột này (`coTheGanMayMqtt`); máy chủ vẫn tự kiểm vai + quyền + phạm vi + luật (mqttClient.bindMachine).
 * Xác nhận bắt buộc kèm lý do (ghi vào control_audit_log / audit_logs).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EntityPicker, type EntityOption } from "@/components/patterns/EntityPicker";

/** Vai + quyền được gắn máy (cùng cổng máy chủ: admin/engineer + settings_factory canEdit). */
export function coTheGanMayMqtt(role: string | null | undefined, canEditFactory: boolean): boolean {
  return (role === "admin" || role === "engineer") && canEditFactory;
}

export interface MqttClientRow {
  id: number;
  deviceId: string;
  machineId?: number | null;
}

export interface MachineRow {
  id: number;
  code: string;
  name: string;
}

/** Độ dài tối thiểu của lý do (cùng zod ở máy chủ). */
const LY_DO_TOI_THIEU = 3;

export function MqttMachineBindingCell({
  client,
  machines,
  canEdit,
  onChanged,
}: {
  client: MqttClientRow;
  machines: MachineRow[];
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [chon, setChon] = useState<number | null>(client.machineId ?? null);
  const [lyDo, setLyDo] = useState("");

  const options = useMemo<EntityOption[]>(
    () => machines.map((m) => ({ value: m.id, label: m.name, sublabel: m.code })),
    [machines],
  );
  const dangGan = machines.find((m) => m.id === client.machineId) ?? null;

  const bind = trpc.mqttClient.bindMachine.useMutation({
    onSuccess: (r) => {
      toast.success(r.changed ? t("mqtt.clientMgmt.bindSaved") : t("mqtt.clientMgmt.bindNoChange"));
      setOpen(false);
      onChanged?.();
    },
    onError: (e) => toastTrpcError(e),
  });

  if (!canEdit) return null;

  const hienTai = client.machineId ?? null;
  const coTheXacNhan = lyDo.trim().length >= LY_DO_TOI_THIEU && chon !== hienTai && !bind.isPending;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm" data-testid={`mqtt-bound-${client.id}`}>
        {hienTai == null
          ? <span className="text-muted-foreground">{t("mqtt.clientMgmt.notBound")}</span>
          : dangGan
            ? <>{dangGan.name} <span className="text-muted-foreground">({dangGan.code})</span></>
            : <span className="text-muted-foreground">#{hienTai}</span>}
      </span>
      <Button
        variant="ghost"
        size="sm"
        title={t("mqtt.clientMgmt.bindMachine")}
        aria-label={t("mqtt.clientMgmt.bindMachine")}
        onClick={() => {
          setChon(hienTai);
          setLyDo("");
          setOpen(true);
        }}
      >
        <Link2 className="w-4 h-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mqtt.clientMgmt.bindMachineTitle")}</DialogTitle>
            <DialogDescription>{t("mqtt.clientMgmt.bindMachineDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm font-mono">{client.deviceId}</div>
            <EntityPicker
              options={options}
              value={chon}
              onChange={(v) => setChon(v == null ? null : Number(v))}
              placeholder={t("mqtt.clientMgmt.selectMachine")}
              aria-label={t("mqtt.clientMgmt.selectMachine")}
            />
            <div className="space-y-1">
              <Label htmlFor={`bind-reason-${client.id}`}>{t("mqtt.clientMgmt.bindReason")}</Label>
              <Textarea
                id={`bind-reason-${client.id}`}
                value={lyDo}
                maxLength={500}
                placeholder={t("mqtt.clientMgmt.bindReasonPlaceholder")}
                onChange={(e) => setLyDo(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            {hienTai != null && (
              <Button variant="outline" onClick={() => setChon(null)} disabled={chon == null}>
                {t("mqtt.clientMgmt.unbind")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button
              disabled={!coTheXacNhan}
              onClick={() => bind.mutate({ clientId: client.id, machineId: chon, reason: lyDo.trim() })}
            >
              {t("mqtt.clientMgmt.confirmBind")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
