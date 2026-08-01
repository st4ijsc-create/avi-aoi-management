/**
 * Sprint G2.2a — Command Audit Log (READ-ONLY).
 *
 * Surfaces the append-only command_log: every machine command the dispatcher
 * handled (rejected/failed/simulated/sent/acked/...), across HITL + interlock
 * triggers. No mutations — purely an audit view. RBAC: machine_control / canView.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { PageHeader, PageContainer, SectionCard, StatusBadge, EmptyState } from "@/components/patterns";
import type { StatusMapEntry } from "@/components/patterns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollText, RefreshCw } from "lucide-react";

const STATUSES = ["simulated", "sent", "acked", "acked_verified", "acked_unverified", "failed", "timeout", "rejected"] as const;
const TRIGGERS = ["hitl", "interlock"] as const;

const STATUS_MAP: Record<string, StatusMapEntry> = {
  acked: { variant: "default" },
  acked_verified: { variant: "default" },
  acked_unverified: { variant: "secondary" },
  sent: { variant: "secondary" },
  simulated: { variant: "outline" },
  failed: { variant: "destructive" },
  timeout: { variant: "destructive" },
  rejected: { variant: "destructive" },
};

const ALL = "__all__";

function fmtValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Embeddable command-audit content (no DashboardLayout wrapper).
 * Consumed by the unified Audit page (AuditLogs) "Command" tab and by the
 * standalone /command-audit route below.
 */
export function CommandAuditLogContent() {
  const { t } = useTranslation();
  const [machineId, setMachineId] = useState("");
  const [adapterId, setAdapterId] = useState("");
  const [triggerKind, setTriggerKind] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const query = trpc.commandLog.list.useQuery(
    {
      machineId: machineId.trim() ? Number(machineId) : undefined,
      adapterId: adapterId.trim() ? Number(adapterId) : undefined,
      triggerKind: triggerKind !== ALL ? (triggerKind as "hitl" | "interlock") : undefined,
      status: status !== ALL ? (status as any) : undefined,
      limit: 200,
    },
    { refetchInterval: autoRefresh ? 15_000 : false },
  );

  const rows = query.data ?? [];

  return (
    <PageContainer fluid>
      <PageHeader
        icon={<ScrollText className="h-6 w-6" />}
        title={t('commandAudit.title')}
        description={t('commandAudit.subtitle')}
        actions={
          <>
            <Button variant={autoRefresh ? "default" : "outline"} size="sm" onClick={() => setAutoRefresh((v) => !v)}>
              <RefreshCw className="h-4 w-4 mr-1" /> {t('commandAudit.autoRefresh')} {autoRefresh ? t('common.enabled') : t('common.disabled')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> {t('common.refresh')}
            </Button>
          </>
        }
      />

      <SectionCard title={t('audit.filters')}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-2">
            <Label>{t('commandAudit.machineId')}</Label>
            <Input value={machineId} onChange={(e) => setMachineId(e.target.value)} placeholder={t('common.all')} />
          </div>
          <div className="space-y-2">
            <Label>{t('commandAudit.adapterId')}</Label>
            <Input value={adapterId} onChange={(e) => setAdapterId(e.target.value)} placeholder={t('common.all')} />
          </div>
          <div className="space-y-2">
            <Label>{t('commandAudit.trigger')}</Label>
            <Select value={triggerKind} onValueChange={setTriggerKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('common.all')}</SelectItem>
                {TRIGGERS.map((tr) => <SelectItem key={tr} value={tr}>{tr}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('common.status')}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('common.all')}</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t('commandAudit.commands', { count: rows.length })} contentClassName="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.time')}</TableHead>
              <TableHead>{t('common.machine')}</TableHead>
              <TableHead>{t('commandAudit.adapter')}</TableHead>
              <TableHead>{t('commandAudit.tag')}</TableHead>
              <TableHead>{t('commandAudit.command')}</TableHead>
              <TableHead>{t('common.value')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
              <TableHead>{t('commandAudit.source')}</TableHead>
              <TableHead>{t('commandAudit.confirmed')}</TableHead>
              <TableHead>{t('commandAudit.approved')}</TableHead>
              <TableHead>{t('commandAudit.readBack')}</TableHead>
              <TableHead>{t('commandAudit.error')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="p-0">
                  <EmptyState variant="no-data" title={t('audit.noData')} compact />
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell>{r.machineId ?? "—"}</TableCell>
                <TableCell>{r.adapterId}</TableCell>
                <TableCell>{r.tagKey ?? "—"}</TableCell>
                <TableCell>{r.commandType ?? "—"}</TableCell>
                <TableCell className="max-w-[140px] truncate" title={fmtValue(r.requestedValue)}>{fmtValue(r.requestedValue)}</TableCell>
                <TableCell><StatusBadge status={r.status} map={STATUS_MAP} /></TableCell>
                <TableCell><StatusBadge status={r.triggerKind} variant={r.triggerKind === "interlock" ? "destructive" : "secondary"} /></TableCell>
                <TableCell>{r.confirmedBy ?? "—"}</TableCell>
                <TableCell>{r.approvedBy ?? "—"}</TableCell>
                <TableCell className="max-w-[120px] truncate" title={fmtValue(r.readBackValue)}>{fmtValue(r.readBackValue)}</TableCell>
                <TableCell className="max-w-[160px] truncate text-destructive" title={r.errorText ?? ""}>{r.errorText ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </PageContainer>
  );
}

export default function CommandAuditLog() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t('commandAudit.title')} navItems={navItems} currentPath="/command-audit">
      <CommandAuditLogContent />
    </DashboardLayout>
  );
}
