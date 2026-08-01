// W2-D — Step 4: issue/rotate the machine's API credential (shown ONCE).
//
// INTEGRATION (W2-C): key issuance goes through the EXISTING per-machine
// endpoint `machine.regenerateApiKey` (admin-only). When W2-C's scoped
// per-machine issuance endpoint lands, swap ONLY the mutation below — the
// show-once/copy/QR UX and the draft bookkeeping stay unchanged.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Copy, KeyRound, Loader2, QrCode, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { StepProps } from "./types";

export default function Step4Credential({ state, update, onNext, onBack, persistDraft }: StepProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // W2-C scoped per-machine issuance (machineApi.issueKey → mk_* key,
  // hash-at-rest in api_keys, default ingest scopes). Replaces the legacy
  // machine.regenerateApiKey swap point.
  const issueMutation = trpc.machineApi.issueKey.useMutation({
    onSuccess: (res) => {
      update({
        keyIssued: true,
        plaintextKey: res.plaintextKey, // memory only — buildSnapshot never persists it
        keyPrefix: res.keyPrefix ?? res.plaintextKey.slice(0, 10),
      });
      setQrDataUrl(null);
      toast.success(t("aoiOnboarding.step4.issued"));
      persistDraft();
    },
    onError: (err) => toast.error(t("aoiOnboarding.step4.issueError"), { description: err.message }),
  });

  const copyKey = () => {
    if (!state.plaintextKey) return;
    void navigator.clipboard.writeText(state.plaintextKey).then(() => toast.success(t("aoiOnboarding.copied")));
  };

  // `qrcode` is already in package.json deps — dynamic import keeps it out of the main bundle.
  const showQr = async () => {
    if (!state.plaintextKey) return;
    try {
      const QRCode = await import("qrcode");
      const url = await QRCode.toDataURL(state.plaintextKey, { width: 220, margin: 1 });
      setQrDataUrl(url);
    } catch {
      toast.error(t("aoiOnboarding.step4.qrError"));
    }
  };

  const canProceed = state.keyIssued || state.machineHasApiKey;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-sm flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {t("aoiOnboarding.step4.title")}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {state.machineHasApiKey
                ? t("aoiOnboarding.step4.hasKeyHint")
                : t("aoiOnboarding.step4.noKeyHint")}
            </p>
          </div>
          {state.machineHasApiKey && !state.keyIssued && (
            <Badge variant="secondary">{t("aoiOnboarding.step4.existingKey")}</Badge>
          )}
        </div>

        <Button
          data-testid="aoi-wizard-issue-key"
          onClick={() => state.machineId && issueMutation.mutate({ machineId: state.machineId })}
          disabled={issueMutation.isPending || !state.machineId || !isAdmin}
          title={!isAdmin ? t("aoiOnboarding.step4.adminOnly") : undefined}
        >
          {issueMutation.isPending
            ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />{t("aoiOnboarding.step4.issuing")}</>
            : <><KeyRound className="h-4 w-4 mr-1" />
                {state.machineHasApiKey ? t("aoiOnboarding.step4.rotate") : t("aoiOnboarding.step4.issue")}</>}
        </Button>
        {!isAdmin && (
          <p className="text-xs text-muted-foreground">{t("aoiOnboarding.step4.adminOnly")}</p>
        )}

        {state.keyIssued && state.plaintextKey && (
          <div className="space-y-2" data-testid="aoi-wizard-key-panel">
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>{t("aoiOnboarding.step4.showOnce")}</AlertTitle>
              <AlertDescription className="space-y-2">
                <code className="block text-xs bg-muted rounded px-2 py-1.5 break-all select-all">
                  {state.plaintextKey}
                </code>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyKey}>
                    <Copy className="h-3 w-3 mr-1" />{t("aoiOnboarding.copy")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={showQr}>
                    <QrCode className="h-3 w-3 mr-1" />{t("aoiOnboarding.step4.qr")}
                  </Button>
                </span>
                {qrDataUrl && (
                  <img src={qrDataUrl} alt="API key QR" className="rounded border bg-white p-1 h-[220px] w-[220px]" />
                )}
              </AlertDescription>
            </Alert>
            <p className="text-xs text-muted-foreground">{t("aoiOnboarding.step4.rotationNote")}</p>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t("aoiOnboarding.back")}</Button>
        <Button data-testid="aoi-wizard-step4-next" onClick={onNext} disabled={!canProceed}>
          {t("aoiOnboarding.next")}
        </Button>
      </div>
    </div>
  );
}
