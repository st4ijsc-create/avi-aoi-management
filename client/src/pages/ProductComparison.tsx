import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import ReportExportButton, { type ReportExportConfig } from "@/components/ReportExportButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { PageHeader, MetricCard } from "@/components/patterns";
import { ArrowRight, Plus, Minus } from "lucide-react";

export function ProductComparison() {
  const { t } = useTranslation();
  const [product1Id, setProduct1Id] = useState<number | null>(null);
  const [product2Id, setProduct2Id] = useState<number | null>(null);

  const { data: products } = trpc.productModel.list.useQuery();
  const { data: points1 } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: product1Id || 0 },
    { enabled: !!product1Id }
  );
  const { data: points2 } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: product2Id || 0 },
    { enabled: !!product2Id }
  );

  const product1 = useMemo(() => products?.find(p => p.id === product1Id), [products, product1Id]);
  const product2 = useMemo(() => products?.find(p => p.id === product2Id), [products, product2Id]);

  // Calculate differences
  const comparison = useMemo(() => {
    if (!points1 || !points2) return null;

    const codes1 = new Set(points1.map(p => p.code));
    const codes2 = new Set(points2.map(p => p.code));

    return {
      onlyInProduct1: points1.filter(p => !codes2.has(p.code)),
      onlyInProduct2: points2.filter(p => !codes1.has(p.code)),
      common: points1.filter(p => codes2.has(p.code)),
      totalPoints1: points1.length,
      totalPoints2: points2.length,
    };
  }, [points1, points2]);

  const handleSwap = () => {
    const temp = product1Id;
    setProduct1Id(product2Id);
    setProduct2Id(temp);
  };

  // Full localized export (PDF / XLSX / HTML) — this page previously had none.
  const getExportConfig = (): ReportExportConfig => {
    const sections: ReportExportConfig["sections"] = [];
    if (comparison) {
      sections.push({
        title: t('reports.summary', 'Summary'),
        type: 'stats',
        stats: [
          { label: `${product1?.code ?? 'P1'} · ${t('products.totalPoints')}`, value: comparison.totalPoints1 },
          { label: t('products.commonPoints'), value: comparison.common.length },
          { label: `${product2?.code ?? 'P2'} · ${t('products.totalPoints')}`, value: comparison.totalPoints2 },
        ],
      });
      if (comparison.onlyInProduct1.length)
        sections.push({
          title: `${t('products.onlyIn')} ${product1?.code ?? 'P1'}`,
          type: 'table',
          tableHeaders: [t('products.code'), t('products.name'), t('products.type')],
          tableRows: comparison.onlyInProduct1.map((p) => [p.code, p.name, p.measurementType]),
        });
      if (comparison.onlyInProduct2.length)
        sections.push({
          title: `${t('products.onlyIn')} ${product2?.code ?? 'P2'}`,
          type: 'table',
          tableHeaders: [t('products.code'), t('products.name'), t('products.type')],
          tableRows: comparison.onlyInProduct2.map((p) => [p.code, p.name, p.measurementType]),
        });
      if (comparison.common.length)
        sections.push({
          title: t('products.commonPoints'),
          type: 'table',
          tableHeaders: [
            t('products.code'), t('products.name'), t('products.type'),
            t('products.unit'), t('products.lowerLimit'), t('products.upperLimit'),
          ],
          tableRows: comparison.common.map((p) => [
            p.code, p.name, p.measurementType, p.unit || '-', p.lowerLimit ?? '-', p.upperLimit ?? '-',
          ]),
        });
    }
    return {
      title: t('products.comparison'),
      subtitle: `${product1?.code ?? ''} vs ${product2?.code ?? ''}`,
      sections,
      filenamePrefix: 'product_comparison',
      orientation: 'landscape',
    };
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          title={t('products.comparison')}
          description={t('products.comparisonDescription')}
          actions={comparison ? <ReportExportButton getConfig={getExportConfig} /> : undefined}
        />

        {/* Product Selection */}
        <Card>
          <CardHeader>
            <CardTitle>{t('products.selectProducts')}</CardTitle>
            <CardDescription>{t('products.selectTwoProducts')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium">{t('products.product1')}</label>
                <Select value={product1Id?.toString() || ""} onValueChange={(val) => setProduct1Id(parseInt(val))}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('products.selectProduct')} />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.code} - {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button variant="outline" size="icon" onClick={handleSwap} disabled={!product1Id || !product2Id}>
                <ArrowRight className="h-4 w-4" />
              </Button>

              <div className="flex-1">
                <label className="text-sm font-medium">{t('products.product2')}</label>
                <Select value={product2Id?.toString() || ""} onValueChange={(val) => setProduct2Id(parseInt(val))}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('products.selectProduct')} />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.code} - {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {comparison && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <MetricCard
                label={`${t('products.totalPoints')} · ${product1?.code ?? ''}`}
                value={comparison.totalPoints1}
              />
              <MetricCard
                label={`${t('products.commonPoints')} · ${t('products.identical')}`}
                value={comparison.common.length}
                tone="success"
              />
              <MetricCard
                label={`${t('products.totalPoints')} · ${product2?.code ?? ''}`}
                value={comparison.totalPoints2}
              />
            </div>

            {/* Detailed Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Only in Product 1 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Minus className="h-4 w-4 text-destructive" />
                    {t('products.onlyIn')} {product1?.code}
                  </CardTitle>
                  <CardDescription>
                    {comparison.onlyInProduct1.length} {t('products.pointsToAdd')} {product2?.code}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {comparison.onlyInProduct1.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('products.noExclusivePoints')}</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {comparison.onlyInProduct1.map((point) => (
                        <div key={point.id} className="p-2 bg-muted/50 rounded border border-destructive/30">
                          <p className="font-medium text-sm">{point.code} - {point.name}</p>
                          <p className="text-xs text-muted-foreground">{point.measurementType}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Only in Product 2 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Plus className="h-4 w-4 text-info" />
                    {t('products.onlyIn')} {product2?.code}
                  </CardTitle>
                  <CardDescription>
                    {comparison.onlyInProduct2.length} {t('products.pointsToAdd')} {product1?.code}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {comparison.onlyInProduct2.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('products.noExclusivePoints')}</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {comparison.onlyInProduct2.map((point) => (
                        <div key={point.id} className="p-2 bg-muted/50 rounded border border-info/30">
                          <p className="font-medium text-sm">{point.code} - {point.name}</p>
                          <p className="text-xs text-muted-foreground">{point.measurementType}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Common Points Table */}
            {comparison.common.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('products.commonPoints')}</CardTitle>
                  <CardDescription>{comparison.common.length} {t('products.identicalPoints')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('products.code')}</TableHead>
                          <TableHead>{t('products.name')}</TableHead>
                          <TableHead>{t('products.type')}</TableHead>
                          <TableHead>{t('products.unit')}</TableHead>
                          <TableHead>{t('products.lowerLimit')}</TableHead>
                          <TableHead>{t('products.upperLimit')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {comparison.common.map((point) => (
                          <TableRow key={point.id}>
                            <TableCell className="font-medium">{point.code}</TableCell>
                            <TableCell>{point.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{point.measurementType}</Badge>
                            </TableCell>
                            <TableCell>{point.unit || "-"}</TableCell>
                            <TableCell>{point.lowerLimit || "-"}</TableCell>
                            <TableCell>{point.upperLimit || "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
