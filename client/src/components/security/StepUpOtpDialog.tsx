import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";

/**
 * doc 54 P3.2 — Step-up 2FA for deploy/actuation.
 *
 * When ACTUATION_STEPUP_2FA is enabled server-side, the deploy mutations
 * (programming.deployBuild / approveDeployment / rollbackDeployment / deployToFleet,
 * orchestration.deployWorkflow) run through `deployProcedure` → `requireFreshTotp`,
 * which reads a fresh 6-digit `totpCode` from the raw input. This hook collects that
 * code just-in-time and hands it to the caller's mutate().
 *
 * Usage:
 *   const stepUp = useStepUpOtp();
 *   ...
 *   onClick={() => stepUp.guard((totpCode) => deployM.mutate({ ...payload, totpCode }))}
 *   ...
 *   {stepUp.dialog}   // render once in the page
 *
 * The client always prompts for a deploy action (rare + privileged → acceptable).
 *
 * ⚠ Pha 6 Task 1 (M-4) — this block USED to read "the `totpCode` is ignored server-side when the
 * session is still within the step-up window", because a successful step-up was cached ~10 min per
 * session. Task 1 broke that for the two VRAM commands; **Task 1b (2026-08-06, owner decision)
 * closed it for everyone**: `deployProcedure` itself now chains `requirePerCallFreshTotp`
 * (`server/_core/trpc.ts`), so **every** mutation listed above — all five deploy ones and both VRAM
 * ones — must carry a `totpCode` that verifies **at that moment**. Sending the code is therefore
 * **mandatory, never redundant**, for every caller of this hook. Omitting it ⇒ FORBIDDEN
 * `INVALID_VALUE{field:"twoFactorCode"}`.
 *
 * ⚠ Consequence for anyone adding a new deploy mutation: `guard()` is not optional decoration —
 * a call site that skips it can never succeed while `ACTUATION_STEPUP_2FA` is on.
 */
export function useStepUpOtp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const runnerRef = useRef<((code: string) => void) | null>(null);

  const guard = useCallback((run: (code: string) => void) => {
    runnerRef.current = run;
    setCode("");
    setOpen(true);
  }, []);

  const finish = useCallback((submit: boolean) => {
    const run = runnerRef.current;
    const value = code;
    setOpen(false);
    runnerRef.current = null;
    if (submit && run && value.length === 6) run(value);
  }, [code]);

  const dialog = (
    <Dialog open={open} onOpenChange={(o) => { if (!o) finish(false); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-500" />
            {t("stepUp.title", "Xác thực 2 bước để triển khai")}
          </DialogTitle>
          <DialogDescription>
            {t("stepUp.desc", "Nhập mã OTP 6 số từ ứng dụng xác thực để xác nhận lệnh triển khai/điều khiển.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-4">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            onComplete={() => finish(true)}
            autoFocus
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(false)}>
            {t("common.cancel", "Huỷ")}
          </Button>
          <Button disabled={code.length !== 6} onClick={() => finish(true)}>
            {t("common.confirm", "Xác nhận")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { guard, dialog };
}
