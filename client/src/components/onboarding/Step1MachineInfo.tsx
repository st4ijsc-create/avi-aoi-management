// WS-2 — Wizard Step 1: machine info & network address
// Doc 27 Đợt 5 / W5-E — gap F3: debounced duplicate-code check (machine.checkCode)
// + inline field validation (code format, IP format, port range) BEFORE Next.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { StepProps } from "./types";
import { MACHINE_TYPES, type MachineType } from "@/constants/machineTypes";
import { machineTypeLabel } from "@/lib/machineTypeLabel";
import { isValidAddress, isValidMachineCode, isValidPort } from "./validation";

export default function Step1MachineInfo({ state, update, onNext }: StepProps) {
  const { t } = useTranslation();

  // Debounce the code before hitting machine.checkCode (400 ms).
  const [debouncedCode, setDebouncedCode] = useState(state.code.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCode(state.code.trim()), 400);
    return () => clearTimeout(timer);
  }, [state.code]);

  const codeFormatOk = isValidMachineCode(state.code);
  const checkQuery = trpc.machine.checkCode.useQuery(
    { code: debouncedCode },
    { enabled: debouncedCode.length > 0 && isValidMachineCode(debouncedCode) },
  );
  const checking =
    codeFormatOk && (checkQuery.isFetching || debouncedCode !== state.code.trim());
  const codeTaken =
    codeFormatOk && !checking && checkQuery.data ? !checkQuery.data.available : false;
  const codeAvailable =
    codeFormatOk && !checking && checkQuery.data ? checkQuery.data.available : false;

  const codeError = state.code.trim().length > 0 && !codeFormatOk
    ? t("onboarding.validation.codeFormat")
    : codeTaken
      ? t("onboarding.validation.codeTaken", {
          name: checkQuery.data?.holder?.name ?? checkQuery.data?.holder?.code ?? "",
        })
      : null;
  const ipError = state.ipAddress.trim().length > 0 && !isValidAddress(state.ipAddress)
    ? t("onboarding.validation.ipFormat")
    : null;
  const portOk = isValidPort(state.port);
  const portError = state.port !== 0 && !portOk
    ? t("onboarding.validation.portRange")
    : null;

  const valid =
    codeFormatOk &&
    !codeTaken &&
    !checking &&
    state.name.trim().length > 0 &&
    isValidAddress(state.ipAddress) &&
    portOk;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ob-code">{t("onboarding.fields.code")}</Label>
          <div className="relative">
            <Input id="ob-code" value={state.code}
              aria-invalid={!!codeError}
              className={codeError ? "border-destructive pr-8" : "pr-8"}
              onChange={(e) => update({ code: e.target.value })}
              placeholder="AOI-LINE1-01" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {checking && state.code.trim() ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : codeTaken ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : codeAvailable ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : null}
            </span>
          </div>
          {codeError ? (
            <p className="text-xs text-destructive">{codeError}</p>
          ) : codeAvailable ? (
            <p className="text-xs text-success">{t("onboarding.validation.codeAvailable")}</p>
          ) : null}
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
            aria-invalid={!!ipError}
            className={ipError ? "border-destructive" : undefined}
            onChange={(e) => update({ ipAddress: e.target.value, connectionTested: false })}
            placeholder="192.168.1.50" />
          {ipError && <p className="text-xs text-destructive">{ipError}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ob-port">{t("onboarding.fields.port")}</Label>
          <Input id="ob-port" type="number" value={state.port}
            aria-invalid={!!portError}
            className={portError ? "border-destructive" : undefined}
            min={1} max={65535}
            onChange={(e) => update({ port: parseInt(e.target.value || "0", 10), connectionTested: false })} />
          {portError && <p className="text-xs text-destructive">{portError}</p>}
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
        <Button onClick={onNext} disabled={!valid}>
          {checking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t("onboarding.next")}
        </Button>
      </div>
    </div>
  );
}
