/**
 * TeachTreeTab.tsx — Khối C Task 10 (QĐ-4 spec, đường đọc `appRouter.cayDay` Task 9).
 *
 * Tab "Cây dạy" của `ProductModels.tsx`: chọn MÁY đã dạy sản phẩm này → xem cây
 * surface→position→capture (`getTree`) → chọn một capture → xem bảng linh kiện của capture đó
 * (`ComponentLimitsTable`, đọc `listComponents`). ĐỌC-CHỈ — mọi ghi giới hạn vẫn qua
 * `measurementPoint.update`/`setLimitsBatch` (QĐ-5), Task 11 gắn dialog (R-KC-1: canvas nằm
 * TRONG dialog đó, KHÔNG ở tab này).
 *
 * Ba quyết định chủ dự án (2026-09-03) hiện thực ở đây:
 *   1. Nguồn giới hạn = kỹ sư dạy trên hệ — bảng chỉ ĐỌC, nút "Dạy giới hạn" là chỗ trống.
 *   2. Bảng chỉ phơi 5 cột giới hạn ĐANG DÙNG (xem `teachTreeLogic.ts`).
 *   3. Bảng là màn chính; canvas KHÔNG nhúng ở đây (Task 11 mở trong dialog).
 *
 * ⚠ BG-105 — nhãn trạng thái "đã dạy / chưa dạy" là phân loại CẤU HÌNH (`coGioiHan`), KHÔNG
 * phải "bo này chấm được không" (spec-gate, trục khác — xem `teachTreeLogic.ts` đầu file).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { vi as viLocale } from "date-fns/locale";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { EmptyState } from "@/components/EmptyState";
import { ComponentLimitsTable } from "./ComponentLimitsTable";
import { layMayMacDinh } from "./teachTreeLogic";

export interface TeachTreeTabProps {
  productModelId: number;
}

export function TeachTreeTab({ productModelId }: TeachTreeTabProps) {
  const { t } = useTranslation();
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [selectedCaptureRowId, setSelectedCaptureRowId] = useState<number | null>(null);

  const machinesQuery = trpc.cayDay.listMachinesForProduct.useQuery(
    { productModelId },
    { enabled: productModelId > 0 },
  );
  const danhSachMay = machinesQuery.data ?? [];

  // Tự chọn máy đầu tiên khi danh sách vừa nạp — KHÔNG bịa máy khi rỗng (layMayMacDinh trả null).
  useEffect(() => {
    if (selectedMachineId == null) {
      const macDinh = layMayMacDinh(danhSachMay);
      if (macDinh != null) setSelectedMachineId(macDinh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [danhSachMay.map((m) => m.machineId).join(","), selectedMachineId]);

  // Đổi máy ⇒ bỏ chọn capture cũ (thuộc cây của máy trước, không còn nghĩa).
  useEffect(() => {
    setSelectedCaptureRowId(null);
  }, [selectedMachineId]);

  const treeQuery = trpc.cayDay.getTree.useQuery(
    { productModelId, machineId: selectedMachineId ?? 0 },
    { enabled: selectedMachineId != null },
  );
  const statsQuery = trpc.cayDay.thongKeGioiHan.useQuery(
    { productModelId, machineId: selectedMachineId ?? 0 },
    { enabled: selectedMachineId != null },
  );

  if (machinesQuery.isLoading) {
    return <Skeleton className="h-40 w-full" data-testid="teach-tree-loading" />;
  }

  if (danhSachMay.length === 0) {
    return (
      <EmptyState
        variant="no-data"
        title={t("teachTree.chuaCoMay", "Chưa máy nào dạy sản phẩm này")}
        description={t(
          "teachTree.chuaCoMayDesc",
          "Chưa máy nào đẩy cây dạy (submitMachineTemplate) cho sản phẩm này — chưa có gì để xem.",
        )}
      />
    );
  }

  const may = danhSachMay.find((m) => m.machineId === selectedMachineId) ?? null;
  const surfaces = treeQuery.data?.surfaces ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedMachineId != null ? String(selectedMachineId) : ""}
          onValueChange={(v) => setSelectedMachineId(Number(v))}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder={t("teachTree.chonMay", "Chọn máy")} />
          </SelectTrigger>
          <SelectContent>
            {danhSachMay.map((m) => (
              <SelectItem key={m.machineId} value={String(m.machineId)}>
                {m.machineCode} — {m.machineName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {may?.banDayHienHanh ? (
          <Badge variant="secondary">
            {t("teachTree.banDay", "Bản dạy v{{version}}", { version: may.banDayHienHanh.version })}
            {" · "}
            {format(may.banDayHienHanh.pushedAt, "dd/MM/yyyy HH:mm", { locale: viLocale })}
          </Badge>
        ) : may ? (
          <Badge variant="destructive">{t("teachTree.chuaCoBanDayHienHanh", "Chưa có bản dạy hiện hành")}</Badge>
        ) : null}
      </div>

      {treeQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : surfaces.length === 0 ? (
        <EmptyState variant="no-data" compact title={t("teachTree.cayRong", "Cây dạy rỗng cho máy này")} />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("teachTree.caySurface", "Cây bản dạy")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" defaultValue={surfaces.map((s) => `s-${s.id}`)} className="w-full">
              {surfaces.map((s) => (
                <AccordionItem key={s.id} value={`s-${s.id}`}>
                  <AccordionTrigger>{s.surfaceName}</AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 pl-2">
                      {s.positions.map((p) => (
                        <div key={p.id}>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">
                            {p.positionId}
                            {p.name ? ` — ${p.name}` : ""}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {p.captures.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => setSelectedCaptureRowId(c.id)}
                                className={cn(
                                  "rounded-md border px-2 py-1 text-xs transition-colors",
                                  selectedCaptureRowId === c.id
                                    ? "border-primary bg-primary/10"
                                    : "border-border hover:bg-accent",
                                )}
                              >
                                {c.captureName ?? c.captureExtId}
                                <Badge variant="outline" className="ml-1.5">{c.soComponent}</Badge>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {selectedCaptureRowId != null && (
        <ComponentLimitsTable
          captureRowId={selectedCaptureRowId}
          stats={statsQuery.data ?? null}
          // Task 11 nối dialog dạy giới hạn thật — Task 10 chỉ ĐỌC (spec QĐ-4).
          onEdit={() => {}}
          onBatchEdit={() => {}}
        />
      )}
    </div>
  );
}
