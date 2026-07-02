import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, StatusBadge as PatternStatusBadge, type BadgeVariant } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  GitMerge,
  Search,
  ArrowUp,
  ArrowDown,
  Boxes,
  Truck,
  PackageCheck,
} from "lucide-react";

// Domain status → solid shadcn <Badge> variant. Unified onto the shared
// <StatusBadge> (W4): thin wrapper keeps the `value` API + em-dash empty state,
// delegating rendering to the pattern component (identical solid look).
function traceStatusVariant(v: string): BadgeVariant {
  if (v.includes("COMPLETED") || v === "RELEASE" || v === "APPROVED" || v === "OK") return "default";
  if (v.includes("HOLD") || v.includes("WAIT") || v === "QUARANTINE" || v === "REWORK") return "secondary";
  if (v.includes("SCRAP") || v.includes("REJECT") || v.includes("RETURN")) return "destructive";
  return "outline";
}
function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <PatternStatusBadge status={value} variant={traceStatusVariant(value.toUpperCase())} />;
}

export default function TraceabilityLineage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"serial" | "lot">("serial");
  const [serialInput, setSerialInput] = useState("");
  const [lotInput, setLotInput] = useState("");
  const [serialQuery, setSerialQuery] = useState("");
  const [lotQuery, setLotQuery] = useState("");

  const bySerial = trpc.traceability.bySerial.useQuery(
    { serialNumber: serialQuery },
    { enabled: mode === "serial" && serialQuery.length > 0 },
  );
  const byLot = trpc.traceability.byLot.useQuery(
    { lotNumber: lotQuery },
    { enabled: mode === "lot" && lotQuery.length > 0 },
  );

  const submit = () => {
    if (mode === "serial") setSerialQuery(serialInput.trim());
    else setLotQuery(lotInput.trim());
  };

  const sData = bySerial.data;
  const lData = byLot.data;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-1">
        <PageHeader
          icon={<GitMerge className="h-6 w-6" />}
          title={t("trace.title", "Truy xuất nguồn gốc (Genealogy)")}
          description={t("trace.subtitle", "Tra cứu lineage 2 chiều: nguyên vật liệu → serial → quyết định lô/khách hàng")}
        />

        <Tabs value={mode} onValueChange={(v) => setMode(v as "serial" | "lot")}>
          <TabsList>
            <TabsTrigger value="serial">{t("trace.bySerial", "Theo Serial")}</TabsTrigger>
            <TabsTrigger value="lot">{t("trace.byLot", "Theo Lô")}</TabsTrigger>
          </TabsList>

          {/* SERIAL */}
          <TabsContent value="serial" className="space-y-4">
            <Card>
              <CardContent className="flex items-end gap-2 pt-6">
                <div className="flex-1">
                  <Label htmlFor="serial" className="text-xs">{t("trace.serialNumber", "Serial number")}</Label>
                  <Input
                    id="serial"
                    placeholder="SN-..."
                    value={serialInput}
                    onChange={(e) => setSerialInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                  />
                </div>
                <Button onClick={submit} disabled={!serialInput.trim()}>
                  <Search className="h-4 w-4 mr-1" /> {t("common.search", "Tra cứu")}
                </Button>
              </CardContent>
            </Card>

            {serialQuery && bySerial.isLoading && (
              <p className="text-muted-foreground">{t("common.loading", "Đang tải...")}</p>
            )}
            {serialQuery && sData && !sData.found && (
              <p className="text-muted-foreground">{t("trace.notFound", "Không tìm thấy dữ liệu cho")} {serialQuery}</p>
            )}

            {sData && sData.found && (
              <div className="space-y-4">
                {/* Upstream */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ArrowUp className="h-4 w-4 text-info" />
                      <Truck className="h-4 w-4" /> {t("trace.upstream", "Thượng nguồn — Nguyên vật liệu")}
                    </CardTitle>
                    <CardDescription>{t("trace.upstreamDesc", "Lô nhà cung cấp & phiếu nhập liên quan")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {sData.upstream.length === 0 ? (
                      <span className="text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</span>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {sData.upstream.map((u: any, i: number) => (
                          <div key={i} className="rounded-lg border p-3">
                            <div className="text-sm font-semibold">{u.supplierLot?.supplierLotNumber ?? u.supplierLot?.lotNumber ?? `Lot #${u.supplierLot?.id}`}</div>
                            <div className="text-xs text-muted-foreground">{t("trace.material", "Vật tư")}: {u.supplierLot?.materialCode ?? "—"}</div>
                            {u.receipt && (
                              <div className="mt-1 text-xs">
                                {t("trace.receipt", "Phiếu nhập")}: {u.receipt.receiptNumber ?? `#${u.receipt.id}`}
                                {u.receipt.supplierName ? ` · ${u.receipt.supplierName}` : ""}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Center: serial / WIP */}
                <Card className="border-primary">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Boxes className="h-4 w-4 text-primary" /> {t("trace.serial", "Serial")}: <span className="font-mono">{sData.serialNumber}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("trace.serial", "Serial")}</TableHead>
                          <TableHead>{t("trace.parent", "Serial cha")}</TableHead>
                          <TableHead>{t("trace.lot", "Lô")}</TableHead>
                          <TableHead>{t("trace.product", "Sản phẩm")}</TableHead>
                          <TableHead>{t("trace.status", "Trạng thái")}</TableHead>
                          <TableHead>{t("trace.enteredAt", "Vào lúc")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(sData.wip ?? []).map((w: any) => (
                          <TableRow key={w.id}>
                            <TableCell className="font-mono text-xs">{w.serialNumber ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{w.parentSerialNumber ?? "—"}</TableCell>
                            <TableCell>{w.lotNumber ?? "—"}</TableCell>
                            <TableCell>{w.productCode ?? "—"}</TableCell>
                            <TableCell><StatusBadge value={w.status} /></TableCell>
                            <TableCell className="text-xs">{w.enteredAt ? new Date(w.enteredAt).toLocaleString() : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Downstream */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ArrowDown className="h-4 w-4 text-success" />
                      <PackageCheck className="h-4 w-4" /> {t("trace.downstream", "Hạ nguồn — Quyết định lô / Khách hàng")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sData.downstream.length === 0 ? (
                      <span className="text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</span>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("trace.disposition", "Quyết định")}</TableHead>
                            <TableHead>{t("trace.lot", "Lô")}</TableHead>
                            <TableHead>{t("trace.quantity", "Số lượng")}</TableHead>
                            <TableHead>{t("trace.defect", "Mã lỗi")}</TableHead>
                            <TableHead>{t("trace.customerRef", "Mã trả khách")}</TableHead>
                            <TableHead>{t("trace.decidedAt", "Thời điểm")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sData.downstream.map((d: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell><StatusBadge value={d.disposition} /></TableCell>
                              <TableCell>{d.lotNumber ?? "—"}</TableCell>
                              <TableCell>{d.quantity ?? "—"}</TableCell>
                              <TableCell>{d.defectCode ?? "—"}</TableCell>
                              <TableCell>{d.customerReturnRef ?? "—"}</TableCell>
                              <TableCell className="text-xs">{d.decidedAt ? new Date(d.decidedAt).toLocaleString() : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* LOT */}
          <TabsContent value="lot" className="space-y-4">
            <Card>
              <CardContent className="flex items-end gap-2 pt-6">
                <div className="flex-1">
                  <Label htmlFor="lot" className="text-xs">{t("trace.lotNumber", "Lot number")}</Label>
                  <Input
                    id="lot"
                    placeholder="LOT-..."
                    value={lotInput}
                    onChange={(e) => setLotInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                  />
                </div>
                <Button onClick={submit} disabled={!lotInput.trim()}>
                  <Search className="h-4 w-4 mr-1" /> {t("common.search", "Tra cứu")}
                </Button>
              </CardContent>
            </Card>

            {lotQuery && byLot.isLoading && (
              <p className="text-muted-foreground">{t("common.loading", "Đang tải...")}</p>
            )}
            {lotQuery && lData && !lData.found && (
              <p className="text-muted-foreground">{t("trace.notFound", "Không tìm thấy dữ liệu cho")} {lotQuery}</p>
            )}

            {lData && lData.found && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t("trace.serialsInLot", "Serial trong lô")} {lData.lotNumber}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("trace.serial", "Serial")}</TableHead>
                          <TableHead>{t("trace.product", "Sản phẩm")}</TableHead>
                          <TableHead>{t("trace.status", "Trạng thái")}</TableHead>
                          <TableHead>{t("trace.enteredAt", "Vào lúc")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(lData.wip ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                        )}
                        {(lData.wip ?? []).map((w: any) => (
                          <TableRow key={w.id}>
                            <TableCell className="font-mono text-xs">{w.serialNumber ?? "—"}</TableCell>
                            <TableCell>{w.productCode ?? "—"}</TableCell>
                            <TableCell><StatusBadge value={w.status} /></TableCell>
                            <TableCell className="text-xs">{w.enteredAt ? new Date(w.enteredAt).toLocaleString() : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t("trace.dispositions", "Quyết định lô")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("trace.disposition", "Quyết định")}</TableHead>
                          <TableHead>{t("trace.quantity", "Số lượng")}</TableHead>
                          <TableHead>{t("trace.reason", "Lý do")}</TableHead>
                          <TableHead>{t("trace.customerRef", "Mã trả khách")}</TableHead>
                          <TableHead>{t("trace.decidedAt", "Thời điểm")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(lData.dispositions ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                        )}
                        {(lData.dispositions ?? []).map((d: any) => (
                          <TableRow key={d.id}>
                            <TableCell><StatusBadge value={d.disposition} /></TableCell>
                            <TableCell>{d.quantity ?? "—"}</TableCell>
                            <TableCell className="max-w-60 truncate">{d.reason ?? "—"}</TableCell>
                            <TableCell>{d.customerReturnRef ?? "—"}</TableCell>
                            <TableCell className="text-xs">{d.decidedAt ? new Date(d.decidedAt).toLocaleString() : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
