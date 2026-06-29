/**
 * Sprint G2.2a — Command Audit Log (READ-ONLY).
 *
 * Surfaces the append-only command_log: every machine command the dispatcher
 * handled (rejected/failed/simulated/sent/acked/...), across HITL + interlock
 * triggers. No mutations — purely an audit view. RBAC: machine_control / canView.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  acked: "default",
  acked_verified: "default",
  acked_unverified: "secondary",
  sent: "secondary",
  simulated: "outline",
  failed: "destructive",
  timeout: "destructive",
  rejected: "destructive",
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-rose-600" />
          <h1 className="text-2xl font-bold">Command Audit Log</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={autoRefresh ? "default" : "outline"} size="sm" onClick={() => setAutoRefresh((v) => !v)}>
            <RefreshCw className="h-4 w-4 mr-1" /> Auto {autoRefresh ? "ON" : "OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Làm mới</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Nhật ký kiểm toán mọi lệnh điều khiển máy (chỉ XEM). Bao gồm cả lệnh mô phỏng/từ chối/thất bại.
      </p>

      <Card>
        <CardHeader><CardTitle>Bộ lọc</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label>Machine ID</Label>
              <Input value={machineId} onChange={(e) => setMachineId(e.target.value)} placeholder="(tất cả)" />
            </div>
            <div>
              <Label>Adapter ID</Label>
              <Input value={adapterId} onChange={(e) => setAdapterId(e.target.value)} placeholder="(tất cả)" />
            </div>
            <div>
              <Label>Nguồn (trigger)</Label>
              <Select value={triggerKind} onValueChange={setTriggerKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tất cả</SelectItem>
                  {TRIGGERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Trạng thái</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tất cả</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Lệnh ({rows.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thời gian</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead>Adapter</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Lệnh</TableHead>
                <TableHead>Giá trị</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Nguồn</TableHead>
                <TableHead>Xác nhận</TableHead>
                <TableHead>Duyệt</TableHead>
                <TableHead>Read-back</TableHead>
                <TableHead>Lỗi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground">Không có bản ghi.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{r.machineId ?? "—"}</TableCell>
                  <TableCell>{r.adapterId}</TableCell>
                  <TableCell>{r.tagKey ?? "—"}</TableCell>
                  <TableCell>{r.commandType ?? "—"}</TableCell>
                  <TableCell className="max-w-[140px] truncate" title={fmtValue(r.requestedValue)}>{fmtValue(r.requestedValue)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                  <TableCell><Badge variant={r.triggerKind === "interlock" ? "destructive" : "secondary"}>{r.triggerKind}</Badge></TableCell>
                  <TableCell>{r.confirmedBy ?? "—"}</TableCell>
                  <TableCell>{r.approvedBy ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate" title={fmtValue(r.readBackValue)}>{fmtValue(r.readBackValue)}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-destructive" title={r.errorText ?? ""}>{r.errorText ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CommandAuditLog() {
  return (
    <DashboardLayout title="Command Audit Log" navItems={navItems} currentPath="/command-audit">
      <CommandAuditLogContent />
    </DashboardLayout>
  );
}
