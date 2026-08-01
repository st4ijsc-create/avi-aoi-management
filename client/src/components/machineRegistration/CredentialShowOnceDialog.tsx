// Doc 56 Đ0 (nhóm B) — REG-2/REG-3: show-once credential dialog for the
// MachineRegistration page. Displays a machine secret (one-time mct_ claim
// token, or a freshly rotated mach_ API key) EXACTLY ONCE: the plaintext lives
// only in the parent's transient dialog state (never in a query cache, never
// localStorage) and is destroyed the moment the dialog closes. UX pattern
// mirrors aoiOnboarding/Step4Credential (show-once warning + copy + QR).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Copy, KeyRound, QrCode, ShieldAlert, Ticket } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export type CredentialShowOncePayload = {
  /**
   * claimToken = one-time mct_ per-machine bootstrap token ·
   * enrollmentToken = met_ zero-touch batch token (a whole fleet self-enrolls) ·
   * apiKey = (re)issued mach_ key.
   */
  kind: "claimToken" | "enrollmentToken" | "apiKey";
  /** Plaintext secret — held ONLY while the dialog is open. */
  secret: string;
  /** "CODE — Name" label of the machine (or fleet batch) the secret belongs to. */
  machineLabel: string;
  /** Bootstrap tokens only — expiry (Date server-side, ISO string on the wire). */
  expiresAt?: string | Date | null;
};

type Props = {
  payload: CredentialShowOncePayload | null;
  /** Parent MUST null the payload here — that is what destroys the secret. */
  onClose: () => void;
};

export default function CredentialShowOnceDialog({ payload, onClose }: Props) {
  const { t } = useTranslation();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const isClaim = payload?.kind === "claimToken";
  const isEnroll = payload?.kind === "enrollmentToken";
  const isBootstrapToken = isClaim || isEnroll; // Ticket icon + expiry apply to both

  const expiresLabel = (() => {
    if (!payload?.expiresAt) return null;
    try {
      const d =
        typeof payload.expiresAt === "string"
          ? new Date(payload.expiresAt)
          : payload.expiresAt;
      if (Number.isNaN(d.getTime())) return null;
      return format(d, "dd/MM/yyyy HH:mm");
    } catch {
      return null;
    }
  })();

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setQrDataUrl(null);
      onClose();
    }
  };

  const copySecret = () => {
    if (!payload) return;
    void navigator.clipboard
      .writeText(payload.secret)
      .then(() => toast.success(t("machineRegistration.credential.copied")));
  };

  // `qrcode` is already a dependency — dynamic import keeps it out of the main bundle.
  const showQr = async () => {
    if (!payload) return;
    try {
      const QRCode = await import("qrcode");
      const url = await QRCode.toDataURL(payload.secret, { width: 220, margin: 1 });
      setQrDataUrl(url);
    } catch {
      toast.error(t("machineRegistration.credential.qrError"));
    }
  };

  return (
    <Dialog open={payload !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isBootstrapToken ? (
              <Ticket className="h-5 w-5 text-primary" />
            ) : (
              <KeyRound className="h-5 w-5 text-primary" />
            )}
            {isEnroll
              ? t("machineRegistration.credential.enrollTitle")
              : isClaim
                ? t("machineRegistration.credential.claimTitle")
                : t("machineRegistration.credential.apiKeyTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("machineRegistration.credential.machineLabel", {
              machine: payload?.machineLabel ?? "",
            })}
          </DialogDescription>
        </DialogHeader>

        {payload && (
          <div className="space-y-3">
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>{t("machineRegistration.credential.showOnceTitle")}</AlertTitle>
              <AlertDescription className="space-y-2">
                <span className="block">
                  {t("machineRegistration.credential.showOnceDesc")}
                </span>
                <code
                  className="block text-xs bg-muted rounded px-2 py-1.5 break-all select-all"
                  data-testid="credential-show-once-secret"
                >
                  {payload.secret}
                </code>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copySecret}>
                    <Copy className="h-3 w-3 mr-1" />
                    {t("machineRegistration.credential.copy")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={showQr}>
                    <QrCode className="h-3 w-3 mr-1" />
                    {t("machineRegistration.credential.qr")}
                  </Button>
                </span>
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt={isBootstrapToken ? "Bootstrap token QR" : "API key QR"}
                    className="rounded border bg-white p-1 h-[220px] w-[220px]"
                  />
                )}
              </AlertDescription>
            </Alert>

            <div className="text-xs text-muted-foreground space-y-1">
              {isBootstrapToken ? (
                <>
                  <p>
                    {isEnroll
                      ? t("machineRegistration.credential.enrollHint")
                      : t("machineRegistration.credential.claimHint")}
                  </p>
                  {expiresLabel && (
                    <p>
                      {t("machineRegistration.credential.expiresAt", {
                        time: expiresLabel,
                      })}
                    </p>
                  )}
                  {isClaim && (
                    <p>{t("machineRegistration.credential.claimReissueNote")}</p>
                  )}
                </>
              ) : (
                <p>{t("machineRegistration.credential.apiKeyHint")}</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t("machineRegistration.credential.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
