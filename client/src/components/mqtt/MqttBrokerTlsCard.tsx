/**
 * doc 81 Đợt 7 task J1 / J redesign (round 4) — "Built-in broker TLS" card (Connectivity → Devices).
 *
 * Shows whether the built-in broker's MQTTS listener runs, on which port, and the SHA-256 fingerprint of the certificate
 * an ADMINISTRATOR provisioned with scripts/provision-mqtt-tls.ps1. The technician types that fingerprint into each
 * tablet (app ≥ 1.0.18, Settings → MQTT) next to the device password; the tablet then connects ONLY to a broker
 * presenting exactly this certificate. Three states: NOT PROVISIONED (the script has not been run — the expected path is
 * shown), OK (fingerprint), REFUSED (the server verified the files and found doubt: the reason is shown; the server never
 * repairs or regenerates anything — the admin re-runs the script). Same audience as the password column: shown with
 * settings_factory canEdit (or admin) — the API `mqttClient.brokerTls` uses the same gate (J fix 1).
 */
import { useTranslation } from "react-i18next";
import { Copy, Lock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Refusal codes with their own text (anything else ⇒ the generic "listener error (CODE)"). */
const KNOWN_ERRORS = new Set([
  "TLS_FILE_CORRUPT",
  "TLS_KEY_MISMATCH",
  "TLS_FILE_UNREADABLE",
  "TLS_CONFIG_INCOMPLETE",
  "EADDRINUSE",
  // J redesign — read-only verification of the admin-provisioned files (owner / access list / links)
  "TLS_KEY_OWNER_FOREIGN",
  "TLS_KEY_ACL_OPEN",
  "TLS_KEY_ACL_UNPROTECTED",
  "TLS_KEY_ACL_UNVERIFIED",
  "TLS_KEY_LINKED",
]);
const NOT_PROVISIONED = "TLS_NOT_PROVISIONED";

export function MqttBrokerTlsCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const q = trpc.mqttClient.brokerTls.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  if (!enabled) return null;
  const s = q.data;

  let status: { tone: "ok" | "warn" | "error"; text: string };
  if (!s) status = { tone: "warn", text: q.isError ? t("mqtt.clientMgmt.brokerTls.loadFailed") : "…" };
  else if (!s.running) status = { tone: "warn", text: t("mqtt.clientMgmt.brokerTls.brokerOff") };
  else if (!s.enabled) status = { tone: "warn", text: t("mqtt.clientMgmt.brokerTls.statusOff") };
  else if (s.error === NOT_PROVISIONED) status = { tone: "warn", text: t("mqtt.clientMgmt.brokerTls.notProvisioned") };
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

  // a verification refusal (not "port taken"): the key is never used until an administrator re-provisions it
  const refused = !!s?.error && s.error !== NOT_PROVISIONED && s.error !== "EADDRINUSE";

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
        {s?.running && s.enabled && s.error === NOT_PROVISIONED ? (
          <div className="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-xs" data-testid="mqtt-broker-tls-provision">
            <div>{t("mqtt.clientMgmt.brokerTls.provisionHint")}</div>
            {s.certPath ? <code className="mt-1 block break-all font-mono" data-testid="mqtt-broker-tls-path">{s.certPath}</code> : null}
          </div>
        ) : null}
        {refused ? (
          <div className="rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive" data-testid="mqtt-broker-tls-refused" role="alert">
            <div>{t("mqtt.clientMgmt.brokerTls.refusedHint")}</div>
            {s?.certPath ? <code className="mt-1 block break-all font-mono" data-testid="mqtt-broker-tls-path">{s.certPath}</code> : null}
          </div>
        ) : null}
        {s?.fingerprintSha256 && !refused ? (
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
              {s.source === "configured" ? t("mqtt.clientMgmt.brokerTls.sourceConfigured") : t("mqtt.clientMgmt.brokerTls.sourceDefault")}
              {s.notAfter ? ` · ${t("mqtt.clientMgmt.brokerTls.validUntil", { date: s.notAfter.slice(0, 10) })}` : ""}
            </div>
            <div className="text-xs text-amber-700 dark:text-amber-400">{t("mqtt.clientMgmt.brokerTls.changeWarning")}</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
