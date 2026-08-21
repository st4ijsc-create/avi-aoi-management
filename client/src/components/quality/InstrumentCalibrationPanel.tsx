import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Gauge, AlertTriangle, ShieldCheck, ShieldAlert, Clock, Plus, FileText, FlaskConical,
} from "lucide-react";

// ── Instrument-health RAG mapping ───────────────────────────────────────────
type HealthStatus =
  | "ok" | "cal_due_soon" | "cal_expired" | "msa_missing" | "msa_expired" | "inactive";

function healthMeta(status: HealthStatus | undefined) {
  switch (status) {
    case "ok":
      return { tone: "green", className: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", labelKey: "instrumentCal.health.ok" };
    case "cal_due_soon":
      return { tone: "amber", className: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400", labelKey: "instrumentCal.health.calDueSoon" };
    case "cal_expired":
      return { tone: "red", className: "border-transparent bg-destructive/15 text-destructive", labelKey: "instrumentCal.health.calExpired" };
    case "msa_missing":
      return { tone: "amber", className: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400", labelKey: "instrumentCal.health.msaMissing" };
    case "msa_expired":
      return { tone: "red", className: "border-transparent bg-destructive/15 text-destructive", labelKey: "instrumentCal.health.msaExpired" };
    case "inactive":
      return { tone: "gray", className: "border-transparent bg-muted text-muted-foreground", labelKey: "instrumentCal.health.inactive" };
    default:
      return { tone: "gray", className: "border-transparent bg-muted text-muted-foreground", labelKey: "instrumentCal.health.unknown" };
  }
}

function fmtDate(d: any): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toISOString().split("T")[0];
}

function HealthBadge({ status }: { status: HealthStatus | undefined }) {
  const { t } = useTranslation();
  const meta = healthMeta(status);
  return <Badge className={meta.className}>{t(meta.labelKey)}</Badge>;
}

// ── One instrument row — owns its own health query and reports status up so the
//    parent can render an aggregate "needs attention" reminder banner. ─────────
function InstrumentRow({
  inst,
  selected,
  onSelect,
  onStatus,
}: {
  inst: any;
  selected: boolean;
  onSelect: () => void;
  onStatus: (id: number, status: HealthStatus) => void;
}) {
  const healthQuery = trpc.instrumentCalibration.health.useQuery({ instrumentId: inst.id });
  const status = healthQuery.data?.status as HealthStatus | undefined;

  // Report status up whenever it resolves (react-query v5 removed useQuery
  // onSuccess, so mirror the data into the parent via an effect).
  useEffect(() => {
    if (status) onStatus(inst.id, status);
  }, [status, inst.id, onStatus]);

  return (
    <TableRow
      className={selected ? "bg-muted/60 cursor-pointer" : "cursor-pointer"}
      onClick={onSelect}
    >
      <TableCell className="font-medium">{inst.code}</TableCell>
      <TableCell>{inst.name}</TableCell>
      <TableCell className="text-muted-foreground">{inst.instrumentType}</TableCell>
      <TableCell>
        {healthQuery.isLoading ? (
          <span className="text-xs text-muted-foreground">…</span>
        ) : (
          <HealthBadge status={status} />
        )}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {fmtDate(healthQuery.data?.calValidUntil ?? inst.nextCalibrationAt)}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {fmtDate(healthQuery.data?.msaValidUntil)}
      </TableCell>
    </TableRow>
  );
}

// ── Create-calibration dialog (admin only) ──────────────────────────────────
function CreateCalibrationDialog({ instrumentId, onDone }: { instrumentId: number; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [certNumber, setCertNumber] = useState("");
  const [performedAt, setPerformedAt] = useState(() => new Date().toISOString().split("T")[0]);
  const [validUntil, setValidUntil] = useState("");
  const [result, setResult] = useState<"pass" | "conditional" | "fail">("pass");
  const [traceability, setTraceability] = useState("");
  const [performedByOrg, setPerformedByOrg] = useState("");
  const [certPdfUrl, setCertPdfUrl] = useState("");
  const [notes, setNotes] = useState("");

  const createMutation = trpc.instrumentCalibration.create.useMutation({
    onSuccess: () => {
      toast.success(t("instrumentCal.form.created"));
      setOpen(false);
      setCertNumber(""); setValidUntil(""); setTraceability("");
      setPerformedByOrg(""); setCertPdfUrl(""); setNotes("");
      onDone();
    },
    onError: (e) => toastTrpcError(e),
  });

  const submit = () => {
    if (!certNumber.trim() || !validUntil) {
      toast.error(t("instrumentCal.form.missingRequired"));
      return;
    }
    createMutation.mutate({
      instrumentId,
      certNumber: certNumber.trim(),
      performedAt: new Date(performedAt) as any,
      validUntil: new Date(validUntil) as any,
      result,
      traceability: traceability.trim() || undefined,
      performedByOrg: performedByOrg.trim() || undefined,
      certPdfUrl: certPdfUrl.trim() || undefined,
      notes: notes.trim() || undefined,
    } as any);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          {t("instrumentCal.form.addCert")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("instrumentCal.form.title")}</DialogTitle>
          <DialogDescription>{t("instrumentCal.form.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("instrumentCal.form.certNumber")} *</Label>
            <Input value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("instrumentCal.form.performedAt")}</Label>
            <Input type="date" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("instrumentCal.form.validUntil")} *</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("instrumentCal.form.result")}</Label>
            <Select value={result} onValueChange={(v) => setResult(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pass">{t("instrumentCal.result.pass")}</SelectItem>
                <SelectItem value="conditional">{t("instrumentCal.result.conditional")}</SelectItem>
                <SelectItem value="fail">{t("instrumentCal.result.fail")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("instrumentCal.form.traceability")}</Label>
            <Input value={traceability} onChange={(e) => setTraceability(e.target.value)} placeholder="NIST / VMI / PJLA…" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("instrumentCal.form.performedByOrg")}</Label>
            <Input value={performedByOrg} onChange={(e) => setPerformedByOrg(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("instrumentCal.form.certPdfUrl")}</Label>
            <Input value={certPdfUrl} onChange={(e) => setCertPdfUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("instrumentCal.form.notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail: cert history + MSA records for the selected instrument ──────────
function InstrumentDetail({ inst, isAdmin }: { inst: any; isAdmin: boolean }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const calQuery = trpc.instrumentCalibration.list.useQuery({ instrumentId: inst.id });
  const msaQuery = trpc.instrumentMsaRecord.list.useQuery({ instrumentId: inst.id });
  const healthQuery = trpc.instrumentCalibration.health.useQuery({ instrumentId: inst.id });

  const refresh = useCallback(() => {
    void utils.instrumentCalibration.list.invalidate({ instrumentId: inst.id });
    void utils.instrumentCalibration.health.invalidate({ instrumentId: inst.id });
  }, [utils, inst.id]);

  const verdictBadge = (v: string) => {
    const map: Record<string, string> = {
      good: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      acceptable: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
      poor: "border-transparent bg-destructive/15 text-destructive",
    };
    return <Badge className={map[v] ?? "border-transparent bg-muted text-muted-foreground"}>{v}</Badge>;
  };
  const resultBadge = (r: string) => {
    const map: Record<string, string> = {
      pass: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      conditional: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
      fail: "border-transparent bg-destructive/15 text-destructive",
    };
    return <Badge className={map[r] ?? "border-transparent bg-muted text-muted-foreground"}>{r}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              {inst.code} — {inst.name}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <HealthBadge status={healthQuery.data?.status as HealthStatus | undefined} />
              <span className="text-xs">
                {t("instrumentCal.calValidUntil")}: {fmtDate(healthQuery.data?.calValidUntil ?? inst.nextCalibrationAt)}
              </span>
            </CardDescription>
          </div>
          {isAdmin && <CreateCalibrationDialog instrumentId={inst.id} onDone={refresh} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Calibration certificate history */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" /> {t("instrumentCal.certHistory")}
          </h4>
          {calQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : calQuery.isError ? (
            <p className="text-sm text-destructive">{mapTrpcError(calQuery.error)}</p>
          ) : (calQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t("instrumentCal.noCerts")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("instrumentCal.form.certNumber")}</TableHead>
                  <TableHead>{t("instrumentCal.form.result")}</TableHead>
                  <TableHead>{t("instrumentCal.form.performedAt")}</TableHead>
                  <TableHead>{t("instrumentCal.form.validUntil")}</TableHead>
                  <TableHead>{t("instrumentCal.form.traceability")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calQuery.data!.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.certNumber}</TableCell>
                    <TableCell>{resultBadge(c.result)}</TableCell>
                    <TableCell className="tabular-nums">{fmtDate(c.performedAt)}</TableCell>
                    <TableCell className="tabular-nums">{fmtDate(c.validUntil)}</TableCell>
                    <TableCell className="text-muted-foreground">{c.traceability ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* MSA records */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> {t("instrumentCal.msaRecords")}
          </h4>
          {msaQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : msaQuery.isError ? (
            <p className="text-sm text-destructive">{mapTrpcError(msaQuery.error)}</p>
          ) : (msaQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t("instrumentCal.noMsa")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("instrumentCal.msa.method")}</TableHead>
                  <TableHead>{t("instrumentCal.msa.grrPct")}</TableHead>
                  <TableHead>NDC</TableHead>
                  <TableHead>{t("instrumentCal.msa.verdict")}</TableHead>
                  <TableHead>{t("instrumentCal.form.validUntil")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {msaQuery.data!.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.method}</TableCell>
                    <TableCell className="tabular-nums">{m.grrPct != null ? `${Number(m.grrPct).toFixed(2)}%` : "—"}</TableCell>
                    <TableCell className="tabular-nums">{m.ndc ?? "—"}</TableCell>
                    <TableCell>{verdictBadge(m.verdict)}</TableCell>
                    <TableCell className="tabular-nums">{fmtDate(m.validUntil)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function InstrumentCalibrationPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const instrumentsQuery = trpc.measurementInstrument.list.useQuery({ includeInactive: true });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusMap, setStatusMap] = useState<Record<number, HealthStatus>>({});

  const onStatus = useCallback((id: number, status: HealthStatus) => {
    setStatusMap((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);

  const instruments = instrumentsQuery.data ?? [];

  // Aggregate "needs attention" reminder — the whole point of surfacing the
  // orphaned health view: cal expired/due-soon + MSA missing/expired.
  const attention = useMemo(() => {
    const expired: string[] = [];
    const dueSoon: string[] = [];
    const msaGap: string[] = [];
    for (const inst of instruments as any[]) {
      const s = statusMap[inst.id];
      if (s === "cal_expired") expired.push(inst.code);
      else if (s === "cal_due_soon") dueSoon.push(inst.code);
      else if (s === "msa_missing" || s === "msa_expired") msaGap.push(inst.code);
    }
    return { expired, dueSoon, msaGap };
  }, [instruments, statusMap]);

  const selected = (instruments as any[]).find((i) => i.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      {/* Calibration-due reminder banner */}
      {(attention.expired.length > 0 || attention.dueSoon.length > 0 || attention.msaGap.length > 0) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {t("instrumentCal.reminder.title")}
            </CardTitle>
            <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              {attention.expired.length > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {t("instrumentCal.reminder.calExpired", { count: attention.expired.length })}: {attention.expired.join(", ")}
                </span>
              )}
              {attention.dueSoon.length > 0 && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Clock className="h-3.5 w-3.5" />
                  {t("instrumentCal.reminder.calDueSoon", { count: attention.dueSoon.length })}: {attention.dueSoon.join(", ")}
                </span>
              )}
              {attention.msaGap.length > 0 && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <FlaskConical className="h-3.5 w-3.5" />
                  {t("instrumentCal.reminder.msaGap", { count: attention.msaGap.length })}: {attention.msaGap.join(", ")}
                </span>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {t("instrumentCal.title")}
          </CardTitle>
          <CardDescription>{t("instrumentCal.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {instrumentsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : instrumentsQuery.isError ? (
            <p className="text-sm text-destructive">{mapTrpcError(instrumentsQuery.error)}</p>
          ) : instruments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("instrumentCal.noInstruments")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.code")}</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("instrumentCal.type")}</TableHead>
                  <TableHead>{t("instrumentCal.status")}</TableHead>
                  <TableHead>{t("instrumentCal.calValidUntil")}</TableHead>
                  <TableHead>{t("instrumentCal.msaValidUntil")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(instruments as any[]).map((inst) => (
                  <InstrumentRow
                    key={inst.id}
                    inst={inst}
                    selected={inst.id === selectedId}
                    onSelect={() => setSelectedId(inst.id)}
                    onStatus={onStatus}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && <InstrumentDetail inst={selected} isAdmin={isAdmin} />}
    </div>
  );
}

export default InstrumentCalibrationPanel;
