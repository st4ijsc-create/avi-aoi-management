import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowRight, Plus, Minus } from "lucide-react";

export function ProductComparison() {
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">So sánh Sản phẩm</h1>
          <p className="text-muted-foreground mt-2">
            So sánh điểm đo giữa hai sản phẩm để xác định điểm đo cần bổ sung
          </p>
        </div>

        {/* Product Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Chọn Sản phẩm</CardTitle>
            <CardDescription>Chọn 2 sản phẩm để so sánh</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium">Sản phẩm 1</label>
                <Select value={product1Id?.toString() || ""} onValueChange={(val) => setProduct1Id(parseInt(val))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn sản phẩm" />
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
                <label className="text-sm font-medium">Sản phẩm 2</label>
                <Select value={product2Id?.toString() || ""} onValueChange={(val) => setProduct2Id(parseInt(val))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn sản phẩm" />
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
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Tổng điểm đo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{comparison.totalPoints1}</div>
                  <p className="text-xs text-muted-foreground">{product1?.code}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Điểm đo chung</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{comparison.common.length}</div>
                  <p className="text-xs text-muted-foreground">Giống nhau</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Tổng điểm đo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{comparison.totalPoints2}</div>
                  <p className="text-xs text-muted-foreground">{product2?.code}</p>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Only in Product 1 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Minus className="h-4 w-4 text-red-500" />
                    Chỉ có trong {product1?.code}
                  </CardTitle>
                  <CardDescription>
                    {comparison.onlyInProduct1.length} điểm đo cần bổ sung vào {product2?.code}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {comparison.onlyInProduct1.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Không có điểm đo riêng</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {comparison.onlyInProduct1.map((point) => (
                        <div key={point.id} className="p-2 bg-muted/50 rounded border border-red-200">
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
                    <Plus className="h-4 w-4 text-blue-500" />
                    Chỉ có trong {product2?.code}
                  </CardTitle>
                  <CardDescription>
                    {comparison.onlyInProduct2.length} điểm đo cần bổ sung vào {product1?.code}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {comparison.onlyInProduct2.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Không có điểm đo riêng</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {comparison.onlyInProduct2.map((point) => (
                        <div key={point.id} className="p-2 bg-muted/50 rounded border border-blue-200">
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
                  <CardTitle className="text-base">Điểm đo chung</CardTitle>
                  <CardDescription>{comparison.common.length} điểm đo giống nhau</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Mã</TableHead>
                          <TableHead>Tên</TableHead>
                          <TableHead>Loại</TableHead>
                          <TableHead>Đơn vị</TableHead>
                          <TableHead>Giới hạn dưới</TableHead>
                          <TableHead>Giới hạn trên</TableHead>
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
