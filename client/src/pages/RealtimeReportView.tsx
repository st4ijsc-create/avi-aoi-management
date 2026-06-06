import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Activity, Download, Search, Leaf } from "lucide-react";

type ComplianceView =
  | "CFR21_PART11"
  | "IATF16949"
  | "ISO9001"
  | "ISO17025"
  | "ISO50001";

const COMPLIANCE_VIEWS: ComplianceView[] = [
  "CFR21_PART11",
  "IATF16949",
  "ISO9001",
  "ISO17025",
  "ISO50001",
];

/** Xuất CSV (kèm BOM cho Excel) từ mảng object theo cột cho trước. */
function exportCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RealtimeReportView() {
  const { t } = useTranslation();
  const [machineInput, setMachineInput] = useState("");
  const [machineId, setMachineId] = useState<number | null>(null);
  const [hours, setHours] = useState(168);
  const [view, setView] = useState<ComplianceView>("CFR21_PART11");

  const healthSeries = trpc.realtimeReport.healthSeries.useQuery(
    { machineId: machineId ?? 0, hours, points: 300 },
    { enabled: machineId !== null && machineId > 0 },
  );

  const enpiSummary = trpc.realtimeReport.enpiSummary.useQuery(
    { machineId: machineId ?? undefined, limit: 200 },
  );

  const complianceColumns = trpc.realtimeReport.complianceColumns.useQuery({ view });

  const chartData = useMemo(
    () =>
      (healthSeries.data ?? []).map((p) => ({
        time: new Date(p.t).toLocaleString(),
        value: p.v,
      })),
    [healthSeries.data],
  );

  const submit = () => {
    const n = parseInt(machineInput.trim(), 10);
    setMachineId(Number.isFinite(n) && n > 0 ? n : null);
  };

  const enpiRows = enpiSummary.data ?? [];

  const handleExportEnpi = () => {
    const cols = [
      { key: "machineId", label: "machineId" },
      { key: "periodStart", label: "periodStart" },
      { key: "periodEnd", label: "periodEnd" },
      { key: "totalKwh", label: "totalKwh" },
      { key: "goodUnits", label: "goodUnits" },
      { key: "energyPerUnit", label: "energyPerUnit" },
      { key: "baselineEnergyPerUnit", label: "baselineEnergyPerUnit" },
      { key: "carbonKg", label: "carbonKg" },
    ];
    exportCsv(`enpi_${view}_${Date.now()}.csv`, cols, enpiRows as Record<string, unknown>[]);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            {t("rtReport.title", "Báo cáo realtime & drill-down")}
          </h1>
          <p className="text-muted-foreground">
            {t("rtReport.subtitle", "Chuỗi sức khỏe máy (downsampled), EnPI/carbon và export theo chuẩn tuân thủ")}
          </p>
        </div>

        {/* Bộ lọc */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="w-40">
              <Label htmlFor="machine" className="text-xs">{t("rtReport.machineId", "Mã máy (ID)")}</Label>
              <Input
                id="machine"
                placeholder="123"
                value={machineInput}
                onChange={(e) => setMachineInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            <div className="w-40">
              <Label className="text-xs">{t("rtReport.window", "Khoảng thời gian")}</Label>
              <Select value={String(hours)} onValueChange={(v) => setHours(parseInt(v, 10))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">{t("rtReport.h24", "24 giờ")}</SelectItem>
                  <SelectItem value="168">{t("rtReport.d7", "7 ngày")}</SelectItem>
                  <SelectItem value="720">{t("rtReport.d30", "30 ngày")}</SelectItem>
                  <SelectItem value="2160">{t("rtReport.d90", "90 ngày")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-52">
              <Label className="text-xs">{t("rtReport.complianceView", "View tuân thủ")}</Label>
              <Select value={view} onValueChange={(v) => setView(v as ComplianceView)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPLIANCE_VIEWS.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={submit}>
              <Search className="h-4 w-4 mr-1" />
              {t("rtReport.apply", "Áp dụng")}
            </Button>
          </CardContent>
        </Card>

        {/* Chuỗi sức khỏe */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("rtReport.healthSeries", "Chuỗi điểm sức khỏe máy (LTTB downsample)")}</CardTitle>
            <CardDescription>
              {machineId
                ? t("rtReport.healthDesc", "Máy #{{id}} · {{n}} điểm", { id: machineId, n: chartData.length })
                : t("rtReport.healthHint", "Nhập mã máy để xem chuỗi sức khỏe")}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="time" hide />
                  <YAxis domain={[0, 100]} width={36} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                {t("rtReport.noData", "Không có dữ liệu")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cột tuân thủ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("rtReport.complianceColumns", "Định nghĩa cột theo chuẩn")} · {view}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(complianceColumns.data ?? []).map((c: any) => (
              <Badge key={c.key} variant="outline">{c.label ?? c.key}</Badge>
            ))}
            {(complianceColumns.data ?? []).length === 0 && (
              <span className="text-muted-foreground text-sm">{t("rtReport.noData", "Không có dữ liệu")}</span>
            )}
          </CardContent>
        </Card>

        {/* EnPI / carbon */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Leaf className="h-4 w-4 text-emerald-600" />
                {t("rtReport.enpi", "EnPI & Carbon (ISO 50001)")}
              </CardTitle>
              <CardDescription>{t("rtReport.enpiDesc", "Tiêu thụ năng lượng và phát thải gần nhất theo máy")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleExportEnpi} disabled={enpiRows.length === 0}>
              <Download className="h-4 w-4 mr-1" />
              {t("rtReport.exportCsv", "Export CSV")}
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rtReport.machineId", "Mã máy")}</TableHead>
                  <TableHead>{t("rtReport.periodStart", "Bắt đầu")}</TableHead>
                  <TableHead className="text-right">{t("rtReport.totalKwh", "kWh")}</TableHead>
                  <TableHead className="text-right">{t("rtReport.goodUnits", "SP đạt")}</TableHead>
                  <TableHead className="text-right">{t("rtReport.energyPerUnit", "kWh/SP")}</TableHead>
                  <TableHead className="text-right">{t("rtReport.carbonKg", "CO₂ (kg)")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enpiRows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.machineId ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.periodStart ? new Date(r.periodStart).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-right">{r.totalKwh ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.goodUnits ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.energyPerUnit ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.carbonKg ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {enpiRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">
                      {t("rtReport.noData", "Không có dữ liệu")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
