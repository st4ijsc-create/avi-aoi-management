/**
 * doc 46 FE-W3.4 — Carton / Pallet container genealogy (IPC-1782).
 *
 * Real data source: genealogy.getByLot (genealogy_chain hash-chain). Aggregated
 * CLIENT-SIDE into a container tree by aggregateLot(). See genealogyAggregate.ts
 * for the honest-degradation contract (no carton/pallet table in the backend).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatChip, StatChipRow } from "@/components/patterns";
import { Boxes, ChevronDown, ChevronRight, Info, Layers, PackageCheck } from "lucide-react";
import { aggregateLot, type ChainRow, type SerialSummary, type Verdict } from "./genealogyAggregate";

const VERDICT_VARIANT: Record<Verdict, "default" | "secondary" | "destructive" | "outline"> = {
  ship: "default",
  scrap: "destructive",
  ng: "destructive",
  rework: "secondary",
  in_process: "outline",
};

function VerdictBadge({ verdict }: { verdict: Verdict }): React.JSX.Element {
  const { t } = useTranslation();
  const label = t(`trace.verdict_${verdict}`, verdict);
  return <Badge variant={VERDICT_VARIANT[verdict]}>{label}</Badge>;
}

function fmt(ts?: string | null): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

function SerialRow({
  s,
  onOpenSerial,
}: {
  s: SerialSummary;
  onOpenSerial: (sn: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow>
        <TableCell className="w-6 p-1 align-top">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={open ? t("trace.collapse", "Collapse") : t("trace.expand", "Expand")}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell>
          <button
            type="button"
            onClick={() => onOpenSerial(s.serialNumber)}
            title={t("trace.viewSerialGenealogy", "View this serial's genealogy")}
            className="font-mono text-xs text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {s.serialNumber}
          </button>
        </TableCell>
        <TableCell><VerdictBadge verdict={s.verdict} /></TableCell>
        <TableCell className={s.stationFails > 0 ? "font-semibold text-destructive tabular-nums" : "tabular-nums"}>
          {s.stationFails}
        </TableCell>
        <TableCell className="text-xs">
          {s.shipDisposition ? (s.ntf ? t("trace.shipAfterNtf", "Shipped (after NTF)") : s.shipDisposition) : "—"}
        </TableCell>
        <TableCell className="text-xs">{s.product ?? "—"}{s.line ? ` · ${s.line}` : ""}</TableCell>
        <TableCell className="text-xs whitespace-nowrap">{fmt(s.bornAt)}</TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-3">
            <div className="text-xs font-semibold mb-2">{t("trace.timeline", "Event timeline")}</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("trace.event", "Event")}</TableHead>
                  <TableHead>{t("trace.station", "Station")}</TableHead>
                  <TableHead>{t("trace.detail", "Detail")}</TableHead>
                  <TableHead>{t("trace.result", "Result")}</TableHead>
                  <TableHead>{t("trace.time", "Time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.events.map((e) => {
                  const p = (e.payload ?? {}) as Record<string, unknown>;
                  const detail =
                    e.eventType === "merge"
                      ? `${p.componentCode ?? ""}${p.refDesignator ? ` @${p.refDesignator}` : ""}${p.lot ? ` · ${p.lot}` : ""}`
                      : e.eventType === "ship"
                        ? String(p.disposition ?? "")
                        : "";
                  const result = e.eventType === "station" ? String(p.result ?? "") : "";
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs font-medium">{e.eventType}</TableCell>
                      <TableCell className="text-xs">{e.stationCode ?? "—"}</TableCell>
                      <TableCell className="text-xs">{detail || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {result ? (
                          <Badge variant={result === "PASS" ? "default" : result === "NTF" ? "secondary" : "destructive"}>
                            {result}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmt(String(e.recordedAt))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function CartonGenealogyView({
  lotCode,
  onOpenSerial,
}: {
  lotCode: string;
  onOpenSerial: (sn: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const query = trpc.genealogy.getByLot.useQuery(
    { lotCode, limit: 20000 },
    { enabled: lotCode.length > 0 },
  );

  const rows = (query.data ?? []) as unknown as ChainRow[];
  const agg = useMemo(() => aggregateLot(lotCode, rows), [lotCode, rows]);

  const [openContainers, setOpenContainers] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpenContainers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Auto-open when there's a single container.
  const singleKey = agg.containers.length === 1 ? agg.containers[0].key : null;

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t("trace.noCartonTitle", "No dedicated carton/pallet data in this backend")}</AlertTitle>
        <AlertDescription>
          {t(
            "trace.noCartonBody",
            "The backend has no carton/pallet pack-out table (no carton_id/pallet_id/shipment_id column). This container view is aggregated client-side from the real genealogy chain using the container keys that DO exist: production lot → parent-unit (when present) → serial. Roll-ups below are computed from actual born/station/ship events — nothing is fabricated.",
          )}
        </AlertDescription>
      </Alert>

      {lotCode && query.isLoading && (
        <p className="text-muted-foreground">{t("common.loading", "Loading...")}</p>
      )}
      {lotCode && query.isError && (
        <p className="text-destructive">{query.error?.message ?? t("trace.queryError", "Query failed")}</p>
      )}
      {lotCode && query.data && agg.totalSerials === 0 && (
        <p className="text-muted-foreground">{t("trace.notFound", "No data found for")} {lotCode}</p>
      )}

      {agg.totalSerials > 0 && (
        <>
          {agg.lotType === "component" && (
            <Alert>
              <Layers className="h-4 w-4" />
              <AlertTitle>{t("trace.lotTypeComponent", "Component / supplier lot")}</AlertTitle>
              <AlertDescription>
                {t(
                  "trace.mergeOnlyNote",
                  "This lot has only component-install (merge) events — it looks like a component/supplier lot, not a finished-unit batch. Pass/fail roll-up is unavailable here; use the Forward / Recall tab to scope the affected units.",
                )}
              </AlertDescription>
            </Alert>
          )}

          {agg.lotType !== "component" && (
          <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PackageCheck className="h-4 w-4 text-primary" />
                {t("trace.containerRollup", "Container roll-up")}: <span className="font-mono">{agg.lotCode}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StatChipRow>
                <StatChip
                  label={t("trace.containerKey", "Container key")}
                  value={agg.hasParentKey ? t("trace.keyParentUnit", "Parent unit") : t("trace.keyLot", "Lot")}
                  icon={<Boxes />}
                  title={t("trace.containerKeyHint", "Real grouping key available in the data")}
                />
                <StatChip label={t("trace.units", "Units")} value={agg.overall.total} tone="accent" />
                <StatChip label={t("trace.verdict_ship", "Shipped")} value={agg.overall.shipped} tone="success" />
                <StatChip label={t("trace.verdict_ng", "NG / held")} value={agg.overall.ng} tone="error" />
                <StatChip label={t("trace.verdict_scrap", "Scrapped")} value={agg.overall.scrapped} tone="warning" />
                <StatChip label={t("trace.verdict_rework", "Rework")} value={agg.overall.rework} tone="warning" />
                <StatChip label={t("trace.verdict_in_process", "In process")} value={agg.overall.inProcess} />
                <StatChip label={t("trace.fpy", "First-pass yield")} value={`${agg.overall.fpyPct}%`} tone="info" />
              </StatChipRow>
            </CardContent>
          </Card>

          {agg.containers.map((c) => {
            const isOpen = c.key === singleKey || openContainers.has(c.key);
            return (
              <Card key={c.key}>
                <CardHeader className="pb-2">
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className="flex w-full items-center gap-2 text-left"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <Boxes className="h-4 w-4 shrink-0 text-primary" />
                    <span className="font-mono text-sm">
                      {c.isUngrouped ? t("trace.containerLot", "Lot container") : c.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · {c.total} {t("trace.units", "Units").toLowerCase()}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {c.shipped > 0 && <Badge variant="default">{c.shipped} {t("trace.verdict_ship", "Shipped")}</Badge>}
                      {c.ng > 0 && <Badge variant="destructive">{c.ng} {t("trace.verdict_ng", "NG / held")}</Badge>}
                      {c.scrapped > 0 && <Badge variant="secondary">{c.scrapped} {t("trace.verdict_scrap", "Scrapped")}</Badge>}
                      <Badge variant="outline">{t("trace.fpy", "First-pass yield")} {c.fpyPct}%</Badge>
                    </span>
                  </button>
                </CardHeader>
                {isOpen && (
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-6" />
                            <TableHead>{t("trace.serial", "Serial")}</TableHead>
                            <TableHead>{t("trace.verdict", "Verdict")}</TableHead>
                            <TableHead>{t("trace.stationFails", "Station fails")}</TableHead>
                            <TableHead>{t("trace.disposition", "Disposition")}</TableHead>
                            <TableHead>{t("trace.product", "Product")}</TableHead>
                            <TableHead>{t("trace.bornAt", "Born at")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {c.serials.map((s) => (
                            <SerialRow key={s.serialNumber} s={s} onOpenSerial={onOpenSerial} />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
          </>
          )}
        </>
      )}
    </div>
  );
}
