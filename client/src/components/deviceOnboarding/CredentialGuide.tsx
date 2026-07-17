// Doc 56 Đ2b nhóm 1 — bước CREDENTIAL dùng chung (automation + iot).
//
// NGUYÊN TẮC AN TOÀN (task): KHÔNG bịa procedure. `mk_` per-machine do THIẾT BỊ
// nhận khi enroll/redeem (doc 57 §2) — KHÔNG mint ở UI này. Bước này:
//   • HƯỚNG DẪN mô hình khóa `mk_` (scope ingest:write) + 2 cách cấp: claim `mct_`
//     (per-machine) và enrollment `met_` (zero-touch fleet).
//   • LINK sang tab "Mã gia nhập thiết bị" (Factory Config) + tài liệu API + SDK mẫu.
//   • (tùy chọn, ADMIN) mint enrollment token `met_` NGAY tại đây bằng procedure CÓ
//     THẬT `machine.issueEnrollmentToken` (đúng cái EnrollmentTokensTab dùng) →
//     hiển thị CredentialShowOnceDialog (show-once + QR). Non-admin chỉ thấy hướng dẫn.
//   • (iot) tùy chọn chứng chỉ X.509 mTLS — opt-in tương lai (QĐ4), chỉ ghi chú.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import CredentialShowOnceDialog, {
  type CredentialShowOncePayload,
} from "@/components/machineRegistration/CredentialShowOnceDialog";
import {
  ADAPTER_SDK_PATH,
  API_DOCS_ROUTE,
  ENROLLMENT_TOKENS_ROUTE,
} from "./types";

interface CredentialGuideProps {
  /** "CODE — Name" của thiết bị (nhãn hiển thị). */
  machineLabel: string;
  /** Gợi ý serialPattern cho enrollment token (thường = code). */
  suggestedSerialPattern?: string;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  /** iot: hiện tùy chọn chứng chỉ X.509 mTLS. */
  showCertOption?: boolean;
  useCert?: boolean;
  onUseCertChange?: (v: boolean) => void;
}

export function CredentialGuide({
  machineLabel,
  suggestedSerialPattern,
  acknowledged,
  onAcknowledgedChange,
  showCertOption,
  useCert,
  onUseCertChange,
}: CredentialGuideProps): React.JSX.Element {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [serialPattern, setSerialPattern] = useState(suggestedSerialPattern ?? "");
  const [credential, setCredential] = useState<CredentialShowOncePayload | null>(null);

  // Procedure CÓ THẬT (EnrollmentTokensTab, adminProcedure) — mint met_ zero-touch.
  const issueMutation = trpc.machine.issueEnrollmentToken.useMutation({
    onSuccess: (data) => {
      setCredential({
        kind: "enrollmentToken",
        secret: data.enrollmentToken,
        machineLabel,
        expiresAt: data.expiresAt ?? null,
      });
      toast.success(t("deviceOnboarding.credential.mintSuccess"));
      if (data.enrollmentEnabled === false) {
        toast.warning(t("deviceOnboarding.credential.enrollmentDisabled"));
      }
    },
    onError: (err) => toastTrpcError(err),
  });

  const mint = () =>
    issueMutation.mutate({
      serialPattern: serialPattern.trim() || undefined,
      scopes: ["ingest:write"],
      maxUses: 1,
      ttlMinutes: 7 * 24 * 60,
      note: `[device-onboarding-v2] ${machineLabel}`.slice(0, 255),
    });

  return (
    <div className="space-y-4">
      {/* Mô hình khóa mk_ */}
      <Alert>
        <KeyRound className="h-4 w-4" />
        <AlertTitle>{t("deviceOnboarding.credential.mkTitle")}</AlertTitle>
        <AlertDescription className="text-xs space-y-1">
          <p>{t("deviceOnboarding.credential.mkDesc")}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            Authorization: Bearer mk_live_…  ·  X-API-Key: mk_live_…
          </p>
        </AlertDescription>
      </Alert>

      {/* Hai cách cấp: claim mct_ vs enrollment met_ */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center gap-2 font-medium text-sm">
            <Ticket className="h-4 w-4" />
            {t("deviceOnboarding.credential.claimTitle")}
            <Badge variant="secondary" className="font-mono text-[10px]">mct_</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("deviceOnboarding.credential.claimDesc")}
          </p>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center gap-2 font-medium text-sm">
            <Ticket className="h-4 w-4" />
            {t("deviceOnboarding.credential.enrollTitle")}
            <Badge variant="secondary" className="font-mono text-[10px]">met_</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("deviceOnboarding.credential.enrollDesc")}
          </p>
        </div>
      </div>

      {/* Link tới nơi mint chuẩn + tài liệu */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate(ENROLLMENT_TOKENS_ROUTE)}>
          <ExternalLink className="h-3.5 w-3.5 mr-1" />
          {t("deviceOnboarding.credential.openEnrollTab")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(API_DOCS_ROUTE)}>
          <BookOpen className="h-3.5 w-3.5 mr-1" />
          {t("deviceOnboarding.credential.openApiDocs")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("deviceOnboarding.credential.sdkHint")}{" "}
        <code className="bg-muted rounded px-1 py-0.5">{ADAPTER_SDK_PATH}</code>
      </p>

      {/* Mint met_ tại chỗ (admin) — procedure có thật, show-once qua dialog */}
      <div className="rounded-lg border border-dashed p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          {t("deviceOnboarding.credential.mintHere")}
        </div>
        {isAdmin ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="dev-onboard-serial-pattern" className="text-xs">
                {t("deviceOnboarding.credential.serialPattern")}
              </Label>
              <Input
                id="dev-onboard-serial-pattern"
                value={serialPattern}
                onChange={(e) => setSerialPattern(e.target.value)}
                placeholder={t("deviceOnboarding.credential.serialPatternPlaceholder")}
                className="h-8 text-xs font-mono"
              />
            </div>
            <Button size="sm" onClick={mint} disabled={issueMutation.isPending}>
              {issueMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Ticket className="h-3.5 w-3.5 mr-1" />
              )}
              {t("deviceOnboarding.credential.mintButton")}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              {t("deviceOnboarding.credential.mintNote")}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("deviceOnboarding.credential.adminOnly")}
          </p>
        )}
      </div>

      {/* iot — tùy chọn chứng chỉ X.509 mTLS (opt-in QĐ4) */}
      {showCertOption && (
        <label className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer">
          <Checkbox
            checked={useCert === true}
            onCheckedChange={(c) => onUseCertChange?.(c === true)}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="h-4 w-4" />
              {t("deviceOnboarding.credential.certTitle")}
            </span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              {t("deviceOnboarding.credential.certDesc")}
            </span>
          </span>
        </label>
      )}

      {/* Xác nhận đã hiểu quy trình → mở khóa Tiếp theo */}
      <label className="flex items-start gap-2 cursor-pointer">
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(c) => onAcknowledgedChange(c === true)}
          className="mt-0.5"
          data-testid="device-onboard-credential-ack"
        />
        <span className="text-sm">{t("deviceOnboarding.credential.acknowledge")}</span>
      </label>

      {/* Show-once reveal (met_ plaintext + QR, hủy khi đóng) */}
      <CredentialShowOnceDialog payload={credential} onClose={() => setCredential(null)} />
    </div>
  );
}
