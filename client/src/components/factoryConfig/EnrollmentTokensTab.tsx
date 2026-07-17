// Doc 56 Đợt 2 việc 1 (Đ2a nhóm 2) — UI "Mã gia nhập thiết bị".
//
// Zero-touch enrollment: an admin mints a single-use (or batch-allowlisted)
// `met_` enrollment token; firmware presents it once and the machine auto-joins
// (POST enroll → a scoped `mk_` key), gated server-side by ENROLLMENT_ENABLED.
// This tab lets an admin ISSUE (plaintext shown exactly once + QR), LIST and
// REVOKE those tokens. It nests inside the Factory Config hub (DataSettings).
//
// Backend (server/routers/hierarchyRouters.ts — machineRouter, adminProcedure):
//   • machine.issueEnrollmentToken  { serialPattern?, scopes?, maxUses?, ttlMinutes?, note? }
//         → { enrollmentToken, prefix, serialPattern, scopes, maxUses, expiresAt, enrollmentEnabled }
//   • machine.listEnrollmentTokens  → PublicEnrollmentTokenRow[]  (never the hash)
//   • machine.revokeEnrollmentToken { id } → { success }
//
// NOTE on machineType: the enrollment TOKEN is machine-type-agnostic (the type is
// supplied by the machine itself at enroll time). The optional "intended type"
// selector below is therefore advisory — it is folded into the token `note` so
// the admin can label a batch. See report / doc 56 for the shape reconciliation.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { useAuth } from "@/_core/hooks/useAuth";
import { format } from "date-fns";
import {
  Ticket,
  Plus,
  RefreshCw,
  Loader2,
  Ban,
  Info,
  ShieldAlert,
  KeyRound,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { MachineTypeSelectOptions } from "@/components/MachineTypeSelectOptions";
import CredentialShowOnceDialog, {
  type CredentialShowOncePayload,
} from "@/components/machineRegistration/CredentialShowOnceDialog";

/** Wire shape of machine.listEnrollmentTokens (Date → string over tRPC/JSON). */
type EnrollmentTokenRow = {
  id: number;
  tokenPrefix: string;
  serialPattern: string | null;
  scopes: string[];
  maxUses: number;
  useCount: number;
  expiresAt: string | Date;
  revokedAt: string | Date | null;
  lastUsedAt: string | Date | null;
  note: string | null;
  issuedBy: number | null;
  createdAt: string | Date;
};

type TokenStatus = "active" | "revoked" | "expired" | "exhausted";

/** Sentinel for the optional "intended machine type" select (shadcn forbids ""). */
const TYPE_NONE = "__none";

/**
 * Curated scope grants for device ingest (mirrors server ENROLLMENT_DEFAULT_SCOPES
 * / MACHINE_KEY_DEFAULT_SCOPES). The client deliberately does NOT fork the full
 * scope vocabulary — the server validates every grant (isValidScopeGrant) and
 * rejects anything outside the published set. `descKey` avoids ":" in i18n paths
 * (i18next treats ":" as a namespace separator).
 */
const SCOPE_OPTIONS: ReadonlyArray<{ value: string; descKey: string }> = [
  { value: "ingest:write", descKey: "ingestWrite" },
  { value: "equipment:read", descKey: "equipmentRead" },
  { value: "edge:sync", descKey: "edgeSync" },
];

const DEFAULT_SCOPES = ["ingest:write"];
const DEFAULT_TTL_DAYS = 7;
const MAX_TTL_DAYS = 30; // server clamps ttlMinutes to 30 days
const MAX_USES_CAP = 100_000;

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  try {
    return format(d, "dd/MM/yyyy HH:mm");
  } catch {
    return "—";
  }
}

function deriveStatus(row: EnrollmentTokenRow): TokenStatus {
  if (row.revokedAt) return "revoked";
  const exp = toDate(row.expiresAt);
  if (exp && exp.getTime() <= Date.now()) return "expired";
  if (row.useCount >= row.maxUses) return "exhausted";
  return "active";
}

export function EnrollmentTokensTab(): React.JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Enrollment procedures are adminProcedure server-side — pre-gate the whole tab.
  const isAdmin = user?.role === "admin";

  // ── Issue-token dialog form state ──────────────────────────────────────────
  const [issueOpen, setIssueOpen] = useState(false);
  const [intendedType, setIntendedType] = useState<string>(TYPE_NONE);
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(
    () => new Set(DEFAULT_SCOPES),
  );
  const [serialPattern, setSerialPattern] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [ttlDays, setTtlDays] = useState(String(DEFAULT_TTL_DAYS));
  const [note, setNote] = useState("");

  // ── Show-once reveal (plaintext held ONLY while the dialog is open) ─────────
  const [credential, setCredential] = useState<CredentialShowOncePayload | null>(null);

  // ── Revoke confirm ─────────────────────────────────────────────────────────
  const [tokenToRevoke, setTokenToRevoke] = useState<EnrollmentTokenRow | null>(null);

  const utils = trpc.useUtils();
  const tokensQuery = trpc.machine.listEnrollmentTokens.useQuery(undefined, {
    enabled: isAdmin,
  });

  const issueMutation = trpc.machine.issueEnrollmentToken.useMutation({
    onSuccess: (data) => {
      // Summary the reveal dialog shows in its "Máy: {{machine}}" line — there is
      // no single machine, so describe the token's allowlist instead.
      const scopeLabel = (data.scopes ?? []).join(", ");
      const machineLabel = data.serialPattern
        ? t("enrollmentTokens.revealLabelPattern", {
            pattern: data.serialPattern,
            max: data.maxUses,
          })
        : t("enrollmentTokens.revealLabelAny", { max: data.maxUses });
      setCredential({
        kind: "enrollmentToken",
        secret: data.enrollmentToken,
        machineLabel: scopeLabel ? `${machineLabel} · ${scopeLabel}` : machineLabel,
        expiresAt: data.expiresAt ?? null,
      });
      toast.success(t("enrollmentTokens.toast.issued"));
      // The token is minted even while the feature is OFF — tell the admin so the
      // batch is not deployed into a server that will refuse every enroll.
      if (data.enrollmentEnabled === false) {
        toast.warning(t("enrollmentTokens.toast.enrollmentDisabled"));
      }
      setIssueOpen(false);
      resetForm();
      utils.machine.listEnrollmentTokens.invalidate();
    },
    onError: (err) => toastTrpcError(err),
  });

  const revokeMutation = trpc.machine.revokeEnrollmentToken.useMutation({
    onSuccess: () => {
      toast.success(t("enrollmentTokens.toast.revoked"));
      setTokenToRevoke(null);
      utils.machine.listEnrollmentTokens.invalidate();
    },
    onError: (err) => toastTrpcError(err),
  });

  const resetForm = () => {
    setIntendedType(TYPE_NONE);
    setSelectedScopes(new Set(DEFAULT_SCOPES));
    setSerialPattern("");
    setMaxUses("1");
    setTtlDays(String(DEFAULT_TTL_DAYS));
    setNote("");
  };

  const toggleScope = (scope: string, on: boolean) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  };

  const handleIssue = () => {
    const scopes = Array.from(selectedScopes);
    const ttl = Math.max(1, Math.min(MAX_TTL_DAYS, Math.trunc(Number(ttlDays) || DEFAULT_TTL_DAYS)));
    const uses = Math.max(1, Math.min(MAX_USES_CAP, Math.trunc(Number(maxUses) || 1)));
    // The optional intended-type + free note fold into the single `note` field
    // (the enrollment token has no first-class machineType — see file header).
    const noteParts: string[] = [];
    if (intendedType !== TYPE_NONE) noteParts.push(`[${intendedType}]`);
    if (note.trim()) noteParts.push(note.trim());
    const finalNote = noteParts.join(" ").slice(0, 255) || undefined;

    issueMutation.mutate({
      serialPattern: serialPattern.trim() || undefined,
      scopes: scopes.length > 0 ? scopes : undefined,
      maxUses: uses,
      ttlMinutes: ttl * 24 * 60,
      note: finalNote,
    });
  };

  const tokens = (tokensQuery.data ?? []) as EnrollmentTokenRow[];

  const statusBadge = (status: TokenStatus) => {
    switch (status) {
      case "active":
        return (
          <Badge variant="outline" className="border-success/30 bg-success/15 text-success">
            {t("enrollmentTokens.status.active")}
          </Badge>
        );
      case "revoked":
        return (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive">
            {t("enrollmentTokens.status.revoked")}
          </Badge>
        );
      case "expired":
        return (
          <Badge variant="outline" className="text-muted-foreground">
            {t("enrollmentTokens.status.expired")}
          </Badge>
        );
      case "exhausted":
        return (
          <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning">
            {t("enrollmentTokens.status.exhausted")}
          </Badge>
        );
    }
  };

  const columns = useMemo<DataTableColumn<EnrollmentTokenRow>[]>(
    () => [
      {
        id: "prefix",
        header: t("enrollmentTokens.columns.prefix"),
        cell: (r) => <span className="font-mono text-xs">{r.tokenPrefix}…</span>,
        sortValue: (r) => r.tokenPrefix,
        filterValue: (r) => r.tokenPrefix,
        alwaysVisible: true,
      },
      {
        id: "scopes",
        header: t("enrollmentTokens.columns.scopes"),
        cell: (r) => (
          <div className="flex flex-wrap gap-1">
            {r.scopes.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              r.scopes.map((s) => (
                <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                  {s}
                </Badge>
              ))
            )}
          </div>
        ),
        filterValue: (r) => r.scopes.join(" "),
      },
      {
        id: "serialPattern",
        header: t("enrollmentTokens.columns.serialPattern"),
        cell: (r) =>
          r.serialPattern ? (
            <span className="font-mono text-xs">{r.serialPattern}</span>
          ) : (
            <span className="text-muted-foreground">{t("enrollmentTokens.serialAny")}</span>
          ),
        sortValue: (r) => r.serialPattern ?? "",
        filterValue: (r) => r.serialPattern ?? "",
      },
      {
        id: "uses",
        header: t("enrollmentTokens.columns.uses"),
        cell: (r) => (
          <span className="tabular-nums">
            {r.useCount} / {r.maxUses}
          </span>
        ),
        sortValue: (r) => r.useCount,
        align: "right",
      },
      {
        id: "expiresAt",
        header: t("enrollmentTokens.columns.expiresAt"),
        cell: (r) => <span className="text-xs">{formatDateTime(r.expiresAt)}</span>,
        sortValue: (r) => toDate(r.expiresAt),
      },
      {
        id: "note",
        header: t("enrollmentTokens.columns.note"),
        cell: (r) =>
          r.note ? (
            <span className="text-xs">{r.note}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        filterValue: (r) => r.note ?? "",
      },
      {
        id: "status",
        header: t("enrollmentTokens.columns.status"),
        cell: (r) => statusBadge(deriveStatus(r)),
        sortValue: (r) => deriveStatus(r),
      },
      {
        id: "actions",
        header: t("enrollmentTokens.columns.actions"),
        align: "right",
        alwaysVisible: true,
        cell: (r) => {
          const status = deriveStatus(r);
          return (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              disabled={status !== "active"}
              onClick={() => setTokenToRevoke(r)}
            >
              <Ban className="h-3.5 w-3.5 mr-1" />
              {t("enrollmentTokens.revoke.action")}
            </Button>
          );
        },
      },
    ],
    [t],
  );

  // ── RBAC — the whole tab is admin-only (matches the adminProcedure backend) ──
  if (!isAdmin) {
    return (
      <Card className="glass-card">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-lg font-medium">{t("enrollmentTokens.adminOnly.title")}</p>
          <p className="text-sm text-muted-foreground">{t("enrollmentTokens.adminOnly.desc")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + primary action */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Ticket className="h-5 w-5 text-primary" />
            {t("enrollmentTokens.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("enrollmentTokens.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => tokensQuery.refetch()}
            disabled={tokensQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${tokensQuery.isFetching ? "animate-spin" : ""}`}
            />
            {t("enrollmentTokens.refresh")}
          </Button>
          <Button size="sm" onClick={() => setIssueOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t("enrollmentTokens.issueButton")}
          </Button>
        </div>
      </div>

      {/* Token list */}
      <DataTable<EnrollmentTokenRow>
        data={tokens}
        columns={columns}
        getRowId={(r) => r.id}
        loading={tokensQuery.isLoading}
        searchable
        searchPlaceholder={t("enrollmentTokens.searchPlaceholder")}
        pageSize={25}
        tableId="enrollment-tokens"
        initialSort={{ columnId: "expiresAt", dir: "desc" }}
        emptyState={
          <EmptyState
            icon={Ticket}
            title={t("enrollmentTokens.empty.title")}
            description={t("enrollmentTokens.empty.desc")}
          />
        }
      />

      {/* How-it-works guide (firmware enrollment flow) */}
      <Card className="border-info/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Info className="h-4 w-4 text-info" />
            {t("enrollmentTokens.guide.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-4 md:grid-cols-3">
            {(["step1", "step2", "step3"] as const).map((step, idx) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-info/15 font-bold text-info">
                  {idx + 1}
                </span>
                <div>
                  <p className="font-medium">{t(`enrollmentTokens.guide.${step}Title`)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(`enrollmentTokens.guide.${step}Desc`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* ── Issue-token dialog ── */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-primary" />
              {t("enrollmentTokens.form.title")}
            </DialogTitle>
            <DialogDescription>{t("enrollmentTokens.form.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Intended machine type (advisory → folded into note) */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5" />
                {t("enrollmentTokens.form.machineType")}
              </Label>
              <Select value={intendedType} onValueChange={setIntendedType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TYPE_NONE}>
                    {t("enrollmentTokens.form.machineTypeNone")}
                  </SelectItem>
                  <MachineTypeSelectOptions />
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("enrollmentTokens.form.machineTypeHint")}
              </p>
            </div>

            {/* Scopes */}
            <div className="space-y-1.5">
              <Label>{t("enrollmentTokens.form.scopes")}</Label>
              <div className="space-y-2 rounded-md border p-3">
                {SCOPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <Checkbox
                      checked={selectedScopes.has(opt.value)}
                      onCheckedChange={(c) => toggleScope(opt.value, c === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-mono text-xs">{opt.value}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`enrollmentTokens.form.scopeDesc.${opt.descKey}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("enrollmentTokens.form.scopesHint")}
              </p>
            </div>

            {/* Serial pattern + max uses */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="enroll-serial-pattern">
                  {t("enrollmentTokens.form.serialPattern")}
                </Label>
                <Input
                  id="enroll-serial-pattern"
                  value={serialPattern}
                  onChange={(e) => setSerialPattern(e.target.value)}
                  placeholder={t("enrollmentTokens.form.serialPatternPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("enrollmentTokens.form.serialPatternHint")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="enroll-max-uses">{t("enrollmentTokens.form.maxUses")}</Label>
                <Input
                  id="enroll-max-uses"
                  type="number"
                  min={1}
                  max={MAX_USES_CAP}
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("enrollmentTokens.form.maxUsesHint")}
                </p>
              </div>
            </div>

            {/* TTL (days) */}
            <div className="space-y-1.5">
              <Label htmlFor="enroll-ttl-days">{t("enrollmentTokens.form.ttlDays")}</Label>
              <Input
                id="enroll-ttl-days"
                type="number"
                min={1}
                max={MAX_TTL_DAYS}
                value={ttlDays}
                onChange={(e) => setTtlDays(e.target.value)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {t("enrollmentTokens.form.ttlDaysHint", { max: MAX_TTL_DAYS })}
              </p>
            </div>

            {/* Free-text note */}
            <div className="space-y-1.5">
              <Label htmlFor="enroll-note">{t("enrollmentTokens.form.note")}</Label>
              <Input
                id="enroll-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("enrollmentTokens.form.notePlaceholder")}
                maxLength={200}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>
              {t("enrollmentTokens.form.cancel")}
            </Button>
            <Button onClick={handleIssue} disabled={issueMutation.isPending}>
              {issueMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4 mr-1" />
              )}
              {t("enrollmentTokens.form.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke confirm ── */}
      <AlertDialog
        open={tokenToRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setTokenToRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              {t("enrollmentTokens.revoke.dialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("enrollmentTokens.revoke.dialogDesc", {
                prefix: tokenToRevoke?.tokenPrefix ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("enrollmentTokens.revoke.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeMutation.isPending}
              onClick={() => {
                if (tokenToRevoke) revokeMutation.mutate({ id: tokenToRevoke.id });
              }}
            >
              {revokeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Ban className="h-4 w-4 mr-1" />
              )}
              {t("enrollmentTokens.revoke.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Show-once reveal (met_ plaintext + QR, destroyed on close) ── */}
      <CredentialShowOnceDialog payload={credential} onClose={() => setCredential(null)} />
    </div>
  );
}

export default EnrollmentTokensTab;
