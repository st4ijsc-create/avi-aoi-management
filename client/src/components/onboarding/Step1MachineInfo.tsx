// WS-2 — Wizard Step 1: machine info & network address
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { StepProps } from "./types";
import { MACHINE_TYPES, type MachineType } from "@/constants/machineTypes";
import { machineTypeLabel } from "@/lib/machineTypeLabel";

export default function Step1MachineInfo({ state, update, onNext }: StepProps) {
  const { t } = useTranslation();

  const valid =
    state.code.trim().length > 0 &&
    state.name.trim().length > 0 &&
    state.ipAddress.trim().length > 0 &&
    state.port > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ob-code">{t("onboarding.fields.code")}</Label>
          <Input id="ob-code" value={state.code}
            onChange={(e) => update({ code: e.target.value })}
            placeholder="AOI-LINE1-01" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ob-name">{t("onboarding.fields.name")}</Label>
          <Input id="ob-name" value={state.name}
            onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>{t("onboarding.fields.machineType")}</Label>
          <Select value={state.machineType}
            onValueChange={(v) => update({ machineType: v as MachineType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MACHINE_TYPES.map((mt) => (
                <SelectItem key={mt} value={mt}>{machineTypeLabel(t, mt)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ob-serial">{t("onboarding.fields.serialNumber")}</Label>
          <Input id="ob-serial" value={state.serialNumber}
            onChange={(e) => update({ serialNumber: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ob-ip">{t("onboarding.fields.ipAddress")}</Label>
          <Input id="ob-ip" value={state.ipAddress}
            onChange={(e) => update({ ipAddress: e.target.value, connectionTested: false })}
            placeholder="192.168.1.50" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ob-port">{t("onboarding.fields.port")}</Label>
          <Input id="ob-port" type="number" value={state.port}
            onChange={(e) => update({ port: parseInt(e.target.value || "0", 10), connectionTested: false })} />
        </div>
        <div className="space-y-2">
          <Label>{t("onboarding.fields.protocol")}</Label>
          <Select value={state.protocol}
            onValueChange={(v) => update({ protocol: v as any, connectionTested: false })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">TCP</SelectItem>
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="websocket">WebSocket</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!valid}>{t("onboarding.next")}</Button>
      </div>
    </div>
  );
}
