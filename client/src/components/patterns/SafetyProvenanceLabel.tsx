/**
 * doc 63 (P6 FEA-F4 / AUD-16 / ISO-TS 15066) — read-only provenance label for any safety
 * status shown on the web (E-stop, safety gate, collaborative zone). Makes explicit that the
 * value is DERIVED FROM TELEMETRY and the web is NOT a safety channel, and surfaces the signal
 * source + latency + as-of so a stale reading can never be mistaken for a live safety state.
 */
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function SafetyProvenanceLabel({
  source = "telemetry",
  latencyMs,
  asOf,
  className,
}: {
  /** Signal source, e.g. "telemetry", "OPC UA", "MQTT". */
  source?: string;
  /** Round-trip / staleness latency in ms, if known. */
  latencyMs?: number;
  /** Absolute "as-of HH:MM:SS" of the reading, if known. */
  asOf?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      role="note"
      className={cn("inline-flex items-center gap-1 text-[11px] leading-tight text-muted-foreground", className)}
    >
      <ShieldAlert className="size-3 shrink-0" aria-hidden="true" />
      <span>
        {t("safety.provenance", {
          source,
          defaultValue: "Nguồn: {{source}} — KHÔNG phải kênh an toàn",
        })}
      </span>
      {typeof latencyMs === "number" && (
        <span className="font-mono tabular-nums">· ~{latencyMs}ms</span>
      )}
      {asOf && <span className="font-mono tabular-nums">· as-of {asOf}</span>}
    </span>
  );
}

export default SafetyProvenanceLabel;
