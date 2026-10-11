/**
 * doc 81 Đợt 7 task J1 — "Built-in broker TLS" card (Connectivity → Devices).
 *
 * Shows whether the built-in broker's MQTTS listener runs, on which port, and the SHA-256 fingerprint of its
 * site certificate. The technician types that fingerprint into each tablet (app ≥ 1.0.18, Settings → MQTT) next
 * to the device password; the tablet then connects ONLY to a broker presenting exactly this certificate.
 * A certificate fault is shown as such (the server never silently regenerates it — that would change the
 * fingerprint and lock every pinned tablet out). Same audience as the password column: shown with settings_factory
 * canEdit (or admin) — the API `mqttClient.brokerTls` uses the same gate (J fix 1).
 */
import { useTranslation } from "react-i18next";
import { Copy, Lock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const KNOWN_ERRORS = new Set([
  "TLS_FILE_CORRUPT",
  "TLS_KEY_MISMATCH",
  "TLS_FILE_UNREADABLE",
  "TLS_CONFIG_INCOMPLETE",
  "TLS_WRITE_FAILED",
  "EADDRINUSE",
  // doc 81 Đợt 7 J fix 3 — key-material security refusals (Windows allow-list / owner / links / exposure)
  "TLS_KEY_EXPOSED",
  "TLS_KEY_OWNER_FOREIGN",
  "TLS_KEY_LINKED",
  "TLS_KEY_DIR_NOT_EMPTY",
  "TLS_KEY_ACL_UNVERIFIED",
  "TLS_KEY_ACL_UNPROTECTED",
  "TLS_KEY_ACL_OPEN",
]);

export function MqttBrokerTlsCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const q = trpc.mqttClient.brokerTls.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  if (!enabled) return null;
  const s = q.data;

  let status: { tone: "ok" | "warn" | "error"; text: string };
  if (!s) status = { tone: "warn", text: q.isError ? t("mqtt.clientMgmt.brokerTls.loadFailed") : "…" };
  else if (!s.running) status = { tone: "warn", text: t("mqtt.clientMgmt.brokerTls.brokerOff") };
  else if (!s.enabled) status = { tone: "warn", text: t("mqtt.clientMgmt.brokerTls.statusOff") };
  else if (s.error) {
    const reason = KNOWN_ERRORS.has(s.error)
      ? t(`mqtt.clientMgmt.brokerTls.error_${s.error}`)
      : t("mqtt.clientMgmt.brokerTls.error_other", { code: s.error });
    status = { tone: "error", text: t("mqtt.clientMgmt.brokerTls.statusError", { reason }) };
  } else if (s.listening) status = { tone: "ok", text: t("mqtt.clientMgmt.brokerTls.statusListening", { port: s.port }) };
  else status = { tone: "warn", text: t("mqtt.clientMgmt.brokerTls.statusStarting") };

  const copy = async () => {
    if (!s?.fingerprintSha256) return;
    try {
      await navigator.clipboard.writeText(s.fingerprintSha256);
      toast.success(t("mqtt.clientMgmt.brokerTls.copied"));
    } catch {
      toast.error(t("mqtt.clientMgmt.brokerTls.copyFailed"));
    }
  };

  return (
    <Card data-testid="mqtt-broker-tls">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4" />
          {t("mqtt.clientMgmt.brokerTls.title")}
        </CardTitle>
        <CardDescription>{t("mqtt.clientMgmt.brokerTls.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            data-testid="mqtt-broker-tls-status"
            variant={status.tone === "ok" ? "default" : status.tone === "error" ? "destructive" : "secondary"}
          >
            {status.tone === "error" ? <ShieldAlert className="mr-1 h-3 w-3" /> : null}
            {status.text}
          </Badge>
          {s?.enabled ? (
            <span className="text-muted-foreground" data-testid="mqtt-broker-tls-plain">
              {s.plainEnabled ? t("mqtt.clientMgmt.brokerTls.plainOpen") : t("mqtt.clientMgmt.brokerTls.plainClosed")}
            </span>
          ) : null}
        </div>
        {s?.error === "TLS_KEY_EXPOSED" ? (
          // J fix 3 (R-7-b) — the key may be exposed: it is never used again; the admin must rotate it
          <div className="rounded border border-destructive bg-destructive/10 p-2 text-destructive" data-testid="mqtt-broker-tls-rotate" role="alert">
            <div className="font-semibold">{t("mqtt.clientMgmt.brokerTls.rotateRequired")}</div>
            <div className="text-xs">{t("mqtt.clientMgmt.brokerTls.error_TLS_KEY_EXPOSED")}</div>
          </div>
        ) : null}
        {s?.fingerprintSha256 && s.error !== "TLS_KEY_EXPOSED" ? (
          <div className="space-y-1">
            <div className="text-muted-foreground">{t("mqtt.clientMgmt.brokerTls.fingerprint")}</div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs" data-testid="mqtt-broker-tls-fingerprint">
                {s.fingerprintSha256}
              </code>
              <Button size="sm" variant="outline" onClick={copy} aria-label={t("common.copy")}>
                <Copy className="mr-1 h-3 w-3" />
                {t("common.copy")}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {s.source === "configured" ? t("mqtt.clientMgmt.brokerTls.sourceConfigured") : t("mqtt.clientMgmt.brokerTls.sourceGenerated")}
              {s.notAfter ? ` · ${t("mqtt.clientMgmt.brokerTls.validUntil", { date: s.notAfter.slice(0, 10) })}` : ""}
            </div>
            <div className="text-xs text-amber-700 dark:text-amber-400">{t("mqtt.clientMgmt.brokerTls.changeWarning")}</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
