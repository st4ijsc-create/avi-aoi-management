/**
 * doc 46 FE-W3.4 — Forward traceability & recall search + saved searches.
 *
 * Forward-search finds ALL downstream affected units from a starting point:
 *   • lot        — genealogy.getByLot(lotCode): a production batch → all its
 *                  units; a component/supplier lot → every unit that consumed it
 *                  (recall scoping). REAL data, operator-accessible.
 *   • serial     — genealogy.getBySerial + traceability.bySerial: the unit's own
 *                  forward chain, its downstream dispositions and child serials.
 *   • component  — bom.traceReverse(componentCode): reverse trace by component
 *                  code. NOTE: this procedure is gated behind mes_bom "view";
 *                  roles without it get an honest permission message.
 *
 * Saved searches persist to localStorage only (client-side convenience — see
 * savedSearches.ts). Nothing here fabricates data.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatChip, StatChipRow } from "@/components/patterns";
import { Search, Save, Play, Trash2, Info, Radar, ShieldAlert } from "lucide-react";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  affectedFromRows,
  type ChainRow,
} from "./genealogyAggregate";
import {
  addSavedSearch,
  loadSavedSearches,
  removeSavedSearch,
  type ForwardMode,
  type SavedSearch,
} from "./savedSearches";

const MODES: { key: ForwardMode; label: string; placeholder: string }[] = [
  { key: "lot", label: "trace.fwdByLot", placeholder: "SIM-BATCH-... / SIM-LOT-..." },
  { key: "serial", label: "trace.fwdBySerial", placeholder: "SIM-..." },
  { key: "component", label: "trace.fwdByComponent", placeholder: "SIM-IC-MCU48" },
];

const PAGE = 200;

function fmt(ts?: string | Date | null): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

export default function ForwardSearchPanel({
  onOpenSerial,
}: {
  onOpenSerial: (sn: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ForwardMode>("lot");
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState<{ mode: ForwardMode; value: string } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [visible, setVisible] = useState(PAGE);

  useEffect(() => setSaved(loadSavedSearches()), []);

  const active = submitted;
  const isLot = active?.mode === "lot";
  const isSerial = active?.mode === "serial";
  const isComponent = active?.mode === "component";

  // ── Queries (one per mode; enabled only for the active submitted mode) ──────
  const lotQ = trpc.genealogy.getByLot.useQuery(
    { lotCode: active?.value ?? "", limit: 20000 },
    { enabled: !!active && isLot && (active.value?.length ?? 0) > 0 },
  );
  const serialChainQ = trpc.genealogy.getBySerial.useQuery(
    { serialNumber: active?.value ?? "" },
    { enabled: !!active && isSerial && (active.value?.length ?? 0) > 0 },
  );
  const serialTraceQ = trpc.traceability.bySerial.useQuery(
    { serialNumber: active?.value ?? "" },
    { enabled: !!active && isSerial && (active.value?.length ?? 0) > 0 },
  );
  const componentQ = trpc.bom.traceReverse.useQuery(
    { componentCode: active?.value ?? "" },
    { enabled: !!active && isComponent && (active.value?.length ?? 0) > 0, retry: false },
  );

  const run = (m: ForwardMode, v: string) => {
    const trimmed = v.trim();
    if (!trimmed) return;
    setVisible(PAGE);
    setSubmitted({ mode: m, value: trimmed });
  };

  const submit = () => run(mode, value);

  const saveCurrent = () => {
    if (!value.trim()) return;
    setSaved(addSavedSearch({ name: saveName, mode, value }));
    setSaveName("");
  };

  const rerun = (s: SavedSearch) => {
    setMode(s.mode);
    setValue(s.value);
    run(s.mode, s.value);
  };

  const del = (id: string) => setSaved(removeSavedSearch(id));

  // ── Derived: lot recall scope ───────────────────────────────────────────────
  const lotRows = (lotQ.data ?? []) as unknown as ChainRow[];
  const lotScope = useMemo(() => affectedFromRows(lotRows), [lotRows]);
  const lotIsComponentLot =
    lotRows.length > 0 && !lotRows.some((r) => r.eventType === "station" || r.eventType === "ship");
  const lotCapped = lotRows.length >= 20000;

  const componentSerials: string[] = (componentQ.data?.serials ?? []) as string[];
  const componentForbidden =
    componentQ.isError && (componentQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN";

  const modePlaceholder = MODES.find((m) => m.key === mode)?.placeholder ?? "";

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-1.5">
            {MODES.map((m) => (
              <Button
                key={m.key}
                type="button"
                size="sm"
                variant={mode === m.key ? "default" : "outline"}
                onClick={() => setMode(m.key)}
              >
                {t(m.label, m.key)}
              </Button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="fwd-input" className="text-xs">
                {t("trace.fwdInput", "Serial / lot / component code")}
              </Label>
              <Input
                id="fwd-input"
                placeholder={modePlaceholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            <Button onClick={submit} disabled={!value.trim()}>
              <Search className="h-4 w-4 mr-1" /> {t("trace.runSearch", "Run search")}
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="save-name" className="text-xs">
                {t("trace.saveName", "Name this search (optional)")}
              </Label>
              <Input
                id="save-name"
                placeholder={t("trace.saveNamePh", "e.g. MCU48 recall — Q3")}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
              />
            </div>
            <Button variant="outline" onClick={saveCurrent} disabled={!value.trim()}>
              <Save className="h-4 w-4 mr-1" /> {t("trace.saveSearch", "Save search")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Saved searches */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("trace.savedSearches", "Saved searches")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t(
              "trace.savedLocalNote",
              "Saved searches live in this browser only (localStorage) — a client-side convenience; there is no server store, so they do not sync across devices/users.",
            )}
          </p>
          {saved.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("trace.noSaved", "No saved searches yet.")}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {saved.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-md border p-2">
                  <Badge variant="outline">{t(`trace.fwdBy${s.mode === "lot" ? "Lot" : s.mode === "serial" ? "Serial" : "Component"}`, s.mode)}</Badge>
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{s.value}</span>
                  <div className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => rerun(s)}>
                      <Play className="h-3.5 w-3.5 mr-1" /> {t("trace.rerun", "Re-run")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del(s.id)} aria-label={t("common.delete", "Delete")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {active && (
        <div className="space-y-4">
          {/* LOT mode */}
          {isLot && (
            <>
              {lotQ.isLoading && <p className="text-muted-foreground">{t("common.loading", "Loading...")}</p>}
              {lotQ.isError && <p className="text-destructive">{mapTrpcError(lotQ.error)}</p>}
              {lotQ.data && lotScope.serials.length === 0 && (
                <p className="text-muted-foreground">{t("trace.notFound", "No data found for")} {active.value}</p>
              )}
              {lotScope.serials.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Radar className="h-4 w-4 text-primary" />
                      {lotIsComponentLot
                        ? t("trace.recallComponentLot", "Recall scope — units that consumed this component/supplier lot")
                        : t("trace.recallBatch", "Forward scope — all units in this production lot")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <StatChipRow>
                      <StatChip label={t("trace.affectedUnits", "Affected units")} value={lotScope.serials.length} tone="error" icon={<Radar />} />
                      {lotScope.byProduct.map((p) => (
                        <StatChip key={p.product} label={p.product} value={p.count} />
                      ))}
                      {lotScope.byLine.map((l) => (
                        <StatChip key={l.line} label={l.line} value={l.count} tone="info" />
                      ))}
                    </StatChipRow>
                    {lotCapped && (
                      <p className="text-xs text-warning">
                        {t("trace.capped", "Result reached the 20,000-event cap — the affected list may be truncated.")}
                      </p>
                    )}
                    <AffectedList serials={lotScope.serials} visible={visible} setVisible={setVisible} onOpenSerial={onOpenSerial} />
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* SERIAL mode */}
          {isSerial && (
            <>
              {(serialChainQ.isLoading || serialTraceQ.isLoading) && (
                <p className="text-muted-foreground">{t("common.loading", "Loading...")}</p>
              )}
              {serialChainQ.data && serialChainQ.data.length === 0 && serialTraceQ.data && !serialTraceQ.data.found && (
                <p className="text-muted-foreground">{t("trace.notFound", "No data found for")} {active.value}</p>
              )}
              {serialChainQ.data && serialChainQ.data.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {t("trace.forwardChain", "Forward chain")}: <span className="font-mono">{active.value}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("trace.event", "Event")}</TableHead>
                            <TableHead>{t("trace.station", "Station")}</TableHead>
                            <TableHead>{t("trace.lot", "Lot")}</TableHead>
                            <TableHead>{t("trace.time", "Time")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(serialChainQ.data as unknown as ChainRow[]).map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className="text-xs font-medium">{e.eventType}</TableCell>
                              <TableCell className="text-xs">{e.stationCode ?? "—"}</TableCell>
                              <TableCell className="text-xs font-mono">{e.lotCode ?? "—"}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{fmt(String(e.recordedAt))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
              {serialTraceQ.data && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{t("trace.downstreamUnits", "Downstream dispositions & child units")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(() => {
                      const children = (serialTraceQ.data.wip ?? []).filter(
                        (w: { serialNumber?: string | null; parentSerialNumber?: string | null }) =>
                          w.parentSerialNumber === active.value && w.serialNumber !== active.value,
                      );
                      const disp = serialTraceQ.data.downstream ?? [];
                      if (children.length === 0 && disp.length === 0) {
                        return (
                          <p className="text-sm text-muted-foreground">
                            {t("trace.noDownstream", "No downstream child units or lot dispositions recorded for this serial.")}
                          </p>
                        );
                      }
                      return (
                        <>
                          {children.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {children.map((w: { id: number; serialNumber?: string | null }) => (
                                <Button key={w.id} size="sm" variant="outline" onClick={() => w.serialNumber && onOpenSerial(w.serialNumber)}>
                                  {w.serialNumber}
                                </Button>
                              ))}
                            </div>
                          )}
                          {disp.length > 0 && (
                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>{t("trace.disposition", "Disposition")}</TableHead>
                                    <TableHead>{t("trace.lot", "Lot")}</TableHead>
                                    <TableHead>{t("trace.customerRef", "Customer return ref")}</TableHead>
                                    <TableHead>{t("trace.decidedAt", "Decided at")}</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {disp.map((d, i: number) => (
                                    <TableRow key={i}>
                                      <TableCell>{d.disposition ?? "—"}</TableCell>
                                      <TableCell>{d.lotNumber ?? "—"}</TableCell>
                                      <TableCell>{d.customerReturnRef ?? "—"}</TableCell>
                                      <TableCell className="text-xs">{fmt(d.decidedAt)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* COMPONENT mode */}
          {isComponent && (
            <>
              {componentQ.isLoading && <p className="text-muted-foreground">{t("common.loading", "Loading...")}</p>}
              {componentForbidden && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>{t("trace.permTitle", "Elevated permission required")}</AlertTitle>
                  <AlertDescription>
                    {t(
                      "trace.permBody",
                      "Component-code reverse trace needs the mes_bom \"view\" permission, which your role does not have. Use lot-based recall (Search by lot, entering the component/supplier lot code) — it returns the same affected units and is available to operators.",
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {componentQ.isError && !componentForbidden && (
                <p className="text-destructive">{mapTrpcError(componentQ.error)}</p>
              )}
              {componentQ.data && componentSerials.length === 0 && (
                <p className="text-muted-foreground">{t("trace.notFound", "No data found for")} {active.value}</p>
              )}
              {componentSerials.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Radar className="h-4 w-4 text-primary" />
                      {t("trace.recallComponent", "Recall scope — units carrying this component")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <StatChipRow>
                      <StatChip label={t("trace.affectedUnits", "Affected units")} value={componentSerials.length} tone="error" icon={<Radar />} />
                    </StatChipRow>
                    <AffectedList serials={componentSerials} visible={visible} setVisible={setVisible} onOpenSerial={onOpenSerial} />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {!active && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t("trace.fwdHelpTitle", "Forward traceability & recall")}</AlertTitle>
          <AlertDescription>
            {t(
              "trace.fwdHelpBody",
              "Enter a production/component lot, a serial, or a component code to list every downstream affected unit — then save the search to re-run it during a recall.",
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function AffectedList({
  serials,
  visible,
  setVisible,
  onOpenSerial,
}: {
  serials: string[];
  visible: number;
  setVisible: (n: number) => void;
  onOpenSerial: (sn: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const shown = serials.slice(0, visible);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {shown.map((sn) => (
          <button
            key={sn}
            type="button"
            onClick={() => onOpenSerial(sn)}
            title={t("trace.viewSerialGenealogy", "View this serial's genealogy")}
            className="rounded border px-2 py-0.5 font-mono text-xs text-primary hover:bg-accent/50 focus-visible:underline focus-visible:outline-none"
          >
            {sn}
          </button>
        ))}
      </div>
      {serials.length > visible && (
        <Button size="sm" variant="outline" onClick={() => setVisible(visible + PAGE)}>
          {t("trace.showMore", "Show more")} ({t("trace.showingOf", "showing {{shown}} of {{total}}", { shown: visible, total: serials.length })})
        </Button>
      )}
    </div>
  );
}
