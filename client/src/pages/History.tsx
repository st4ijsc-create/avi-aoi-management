import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
  Search, 
  Filter, 
  ChevronLeft, 
  ChevronRight,
  Eye,
  Calendar,
  Cpu,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  History as HistoryIcon
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { format } from "date-fns";



export default function History() {
  const [filters, setFilters] = useState({
    factoryCode: "",
    workshopCode: "",
    lineCode: "",
    stationCode: "",
    machineCode: "",
    serialNumber: "",
    result: "all" as "all" | "OK" | "NG" | "NTF",
  });
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, refetch } = trpc.inspection.search.useQuery({
    factoryCode: filters.factoryCode || undefined,
    workshopCode: filters.workshopCode || undefined,
    lineCode: filters.lineCode || undefined,
    stationCode: filters.stationCode || undefined,
    machineCode: filters.machineCode || undefined,
    serialNumber: filters.serialNumber || undefined,
    result: filters.result !== "all" ? filters.result : undefined,
    limit,
    offset: (page - 1) * limit,
  });

  const { data: machines } = trpc.machine.list.useQuery();

  const totalPages = useMemo(() => {
    if (!data?.total) return 1;
    return Math.ceil(data.total / limit);
  }, [data?.total]);

  const handleSearch = () => {
    setPage(1);
    refetch();
  };

  const handleClearFilters = () => {
    setFilters({
      factoryCode: "",
      workshopCode: "",
      lineCode: "",
      stationCode: "",
      machineCode: "",
      serialNumber: "",
      result: "all",
    });
    setPage(1);
  };

  const getResultBadge = (result: string) => {
    switch (result) {
      case "OK":
        return (
          <Badge className="status-ok gap-1">
            <CheckCircle2 className="h-3 w-3" />
            OK
          </Badge>
        );
      case "NG":
        return (
          <Badge className="status-ng gap-1">
            <XCircle className="h-3 w-3" />
            NG
          </Badge>
        );
      case "NTF":
        return (
          <Badge className="status-ntf gap-1">
            <AlertTriangle className="h-3 w-3" />
            NTF
          </Badge>
        );
      default:
        return <Badge variant="secondary">{result}</Badge>;
    }
  };

  const getMachineName = (machineId: number) => {
    const machine = machines?.find(m => m.id === machineId);
    return machine?.name || `Machine #${machineId}`;
  };

  return (
    <DashboardLayout 
      title="AVI/AOI Management" 
      navItems={navItems}
      currentPath="/history"
    >
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lịch sử kiểm tra</h1>
          <p className="text-muted-foreground">Tìm kiếm và xem chi tiết kết quả kiểm tra từ tất cả máy</p>
        </div>

        {/* Search Filters */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary" />
              Bộ lọc tìm kiếm
            </CardTitle>
            <CardDescription>Lọc theo mã nhà máy, nhà xưởng, SN sản phẩm, dây chuyền, công trạm, máy</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã nhà máy</label>
                <Input
                  placeholder="VD: FAC001"
                  value={filters.factoryCode}
                  onChange={(e) => setFilters({ ...filters, factoryCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã nhà xưởng</label>
                <Input
                  placeholder="VD: WS001"
                  value={filters.workshopCode}
                  onChange={(e) => setFilters({ ...filters, workshopCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã dây chuyền</label>
                <Input
                  placeholder="VD: LINE01"
                  value={filters.lineCode}
                  onChange={(e) => setFilters({ ...filters, lineCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã công trạm</label>
                <Input
                  placeholder="VD: ST001"
                  value={filters.stationCode}
                  onChange={(e) => setFilters({ ...filters, stationCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã máy</label>
                <Input
                  placeholder="VD: AVI001"
                  value={filters.machineCode}
                  onChange={(e) => setFilters({ ...filters, machineCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Serial Number</label>
                <Input
                  placeholder="VD: SN123456789"
                  value={filters.serialNumber}
                  onChange={(e) => setFilters({ ...filters, serialNumber: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Kết quả</label>
                <Select 
                  value={filters.result} 
                  onValueChange={(value) => setFilters({ ...filters, result: value as typeof filters.result })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    <SelectItem value="OK">OK</SelectItem>
                    <SelectItem value="NG">NG</SelectItem>
                    <SelectItem value="NTF">NTF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={handleSearch} className="gap-2">
                  <Search className="h-4 w-4" />
                  Tìm kiếm
                </Button>
                <Button variant="outline" onClick={handleClearFilters}>
                  Xóa bộ lọc
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Kết quả tìm kiếm</CardTitle>
                <CardDescription>
                  {data?.total ? `Tìm thấy ${data.total} kết quả` : "Chưa có dữ liệu"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-20 bg-muted/50 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : data?.data && data.data.length > 0 ? (
              <div className="space-y-3">
                {data.data.map((inspection) => (
                  <div 
                    key={inspection.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Cpu className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <p className="font-semibold text-foreground">{inspection.serialNumber}</p>
                          {getResultBadge(inspection.overallResult)}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Cpu className="h-3 w-3" />
                            {getMachineName(inspection.machineId)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(inspection.inspectionTime), "dd/MM/yyyy HH:mm:ss")}
                          </span>
                          {inspection.productModel && (
                            <span>Model: {inspection.productModel}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Link href={`/inspection/${inspection.id}`}>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Eye className="h-4 w-4" />
                        Chi tiết
                      </Button>
                    </Link>
                  </div>
                ))}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                      Trang {page} / {totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center">
                <HistoryIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Không tìm thấy kết quả nào</p>
                <p className="text-sm text-muted-foreground mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
