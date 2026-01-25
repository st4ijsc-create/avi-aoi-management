import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { 
  Building2, 
  Factory, 
  GitBranch, 
  Cpu, 
  ChevronRight, 
  Home,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Activity
} from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";

// Drill-down levels
type DrillLevel = "corporate" | "factory" | "line" | "machine";

interface DrillDownState {
  level: DrillLevel;
  corporateCode?: string;
  corporateName?: string;
  factoryId?: number;
  factoryName?: string;
  lineId?: number;
  lineName?: string;
  machineId?: number;
  machineName?: string;
}

const COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899"];

// Breadcrumb component
function Breadcrumb({ 
  state, 
  onNavigate 
}: { 
  state: DrillDownState; 
  onNavigate: (level: DrillLevel, data?: Partial<DrillDownState>) => void;
}) {
  const items = [
    { level: "corporate" as DrillLevel, label: "Tổng quan", icon: Building2 },
  ];

  if (state.corporateCode) {
    items.push({ 
      level: "factory" as DrillLevel, 
      label: state.corporateName || state.corporateCode, 
      icon: Factory 
    });
  }

  if (state.factoryId) {
    items.push({ 
      level: "line" as DrillLevel, 
      label: state.factoryName || `Factory ${state.factoryId}`, 
      icon: GitBranch 
    });
  }

  if (state.lineId) {
    items.push({ 
      level: "machine" as DrillLevel, 
      label: state.lineName || `Line ${state.lineId}`, 
      icon: Cpu 
    });
  }

  return (
    <nav className="flex items-center gap-2 text-sm mb-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onNavigate("corporate")}
        className="gap-1"
      >
        <Home className="h-4 w-4" />
      </Button>
      {items.map((item, index) => (
        <div key={item.level} className="flex items-center gap-2">
          {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Button
            variant={index === items.length - 1 ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              if (item.level === "corporate") {
                onNavigate("corporate");
              } else if (item.level === "factory" && state.corporateCode) {
                onNavigate("factory", { corporateCode: state.corporateCode, corporateName: state.corporateName });
              } else if (item.level === "line" && state.factoryId) {
                onNavigate("line", { 
                  corporateCode: state.corporateCode, 
                  corporateName: state.corporateName,
                  factoryId: state.factoryId, 
                  factoryName: state.factoryName 
                });
              }
            }}
            className="gap-1"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Button>
        </div>
      ))}
    </nav>
  );
}

// Stats card component
function StatsCard({ 
  title, 
  value, 
  subtitle, 
  trend, 
  icon: Icon,
  color = "blue"
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  icon: React.ComponentType<{ className?: string }>;
  color?: "blue" | "green" | "red" | "yellow";
}) {
  const colorClasses = {
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-green-500/10 text-green-500",
    red: "bg-red-500/10 text-red-500",
    yellow: "bg-yellow-500/10 text-yellow-500",
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-2 text-sm ${trend >= 0 ? "text-green-500" : "text-red-500"}`}>
            {trend >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            <span>{Math.abs(trend).toFixed(1)}%</span>
            <span className="text-muted-foreground">so với hôm qua</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Clickable bar chart item
function ClickableBarItem({ 
  data, 
  onClick, 
  maxValue 
}: { 
  data: { name: string; code?: string; total: number; ok: number; ng: number; yieldRate: number }; 
  onClick: () => void;
  maxValue: number;
}) {
  return (
    <div 
      className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-medium">{data.name}</span>
          {data.code && (
            <Badge variant="outline" className="ml-2 text-xs">{data.code}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={data.yieldRate >= 95 ? "default" : data.yieldRate >= 90 ? "secondary" : "destructive"}>
            {data.yieldRate.toFixed(1)}%
          </Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-12">OK</span>
          <Progress value={(data.ok / maxValue) * 100} className="h-2 flex-1" />
          <span className="text-xs font-medium w-16 text-right">{data.ok.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-12">NG</span>
          <Progress value={(data.ng / maxValue) * 100} className="h-2 flex-1 [&>div]:bg-red-500" />
          <span className="text-xs font-medium w-16 text-right">{data.ng.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export default function DrillDownDashboard() {
  const [drillState, setDrillState] = useState<DrillDownState>({ level: "corporate" });

  // Queries based on drill level
  const { data: corporateStats, isLoading: corporateLoading } = trpc.drillDown.corporateStats.useQuery(
    undefined,
    { enabled: drillState.level === "corporate" }
  );

  const { data: factoryStats, isLoading: factoryLoading } = trpc.drillDown.factoriesByCorporate.useQuery(
    { corporateCode: drillState.corporateCode! },
    { enabled: drillState.level === "factory" && !!drillState.corporateCode }
  );

  const { data: lineStats, isLoading: lineLoading } = trpc.drillDown.linesByFactory.useQuery(
    { factoryId: drillState.factoryId! },
    { enabled: drillState.level === "line" && !!drillState.factoryId }
  );

  const { data: machineStats, isLoading: machineLoading } = trpc.drillDown.machinesByLine.useQuery(
    { lineId: drillState.lineId! },
    { enabled: drillState.level === "machine" && !!drillState.lineId }
  );

  // Navigation handler
  const handleNavigate = (level: DrillLevel, data?: Partial<DrillDownState>) => {
    if (level === "corporate") {
      setDrillState({ level: "corporate" });
    } else {
      setDrillState({ level, ...data } as DrillDownState);
    }
  };

  // Click handlers for drill-down
  const handleCorporateClick = (corporateCode: string, corporateName: string) => {
    setDrillState({
      level: "factory",
      corporateCode,
      corporateName,
    });
  };

  const handleFactoryClick = (factoryId: number, factoryName: string) => {
    setDrillState({
      ...drillState,
      level: "line",
      factoryId,
      factoryName,
    });
  };

  const handleLineClick = (lineId: number, lineName: string) => {
    setDrillState({
      ...drillState,
      level: "machine",
      lineId,
      lineName,
    });
  };

  // Calculate totals for current level
  const currentStats = useMemo(() => {
    let data: any[] = [];
    let total = 0, ok = 0, ng = 0, ntf = 0;

    if (drillState.level === "corporate" && corporateStats) {
      data = corporateStats;
    } else if (drillState.level === "factory" && factoryStats) {
      data = factoryStats;
    } else if (drillState.level === "line" && lineStats) {
      data = lineStats;
    } else if (drillState.level === "machine" && machineStats) {
      data = machineStats;
    }

    data.forEach((item: any) => {
      total += item.total || 0;
      ok += item.ok || 0;
      ng += item.ng || 0;
      ntf += item.ntf || 0;
    });

    return {
      data,
      total,
      ok,
      ng,
      ntf,
      yieldRate: total > 0 ? (ok / total) * 100 : 0,
    };
  }, [drillState.level, corporateStats, factoryStats, lineStats, machineStats]);

  const isLoading = corporateLoading || factoryLoading || lineLoading || machineLoading;

  // Pie chart data
  const pieData = [
    { name: "OK", value: currentStats.ok, color: "#22c55e" },
    { name: "NG", value: currentStats.ng, color: "#ef4444" },
    { name: "NTF", value: currentStats.ntf, color: "#f59e0b" },
  ].filter(d => d.value > 0);

  // Get level title
  const getLevelTitle = () => {
    switch (drillState.level) {
      case "corporate": return "Tổng quan theo Corporate";
      case "factory": return `Nhà máy thuộc ${drillState.corporateName || drillState.corporateCode}`;
      case "line": return `Dây chuyền thuộc ${drillState.factoryName}`;
      case "machine": return `Máy thuộc ${drillState.lineName}`;
    }
  };

  const maxValue = Math.max(...currentStats.data.map((d: any) => d.total || 0), 1);

  return (
    <DashboardLayout title="Drill-Down Dashboard">
      <div className="space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb state={drillState} onNavigate={handleNavigate} />

        {/* Back button */}
        {drillState.level !== "corporate" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (drillState.level === "factory") {
                handleNavigate("corporate");
              } else if (drillState.level === "line") {
                handleNavigate("factory", { 
                  corporateCode: drillState.corporateCode, 
                  corporateName: drillState.corporateName 
                });
              } else if (drillState.level === "machine") {
                handleNavigate("line", { 
                  corporateCode: drillState.corporateCode,
                  corporateName: drillState.corporateName,
                  factoryId: drillState.factoryId,
                  factoryName: drillState.factoryName
                });
              }
            }}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay lại
          </Button>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Tổng sản lượng"
            value={currentStats.total.toLocaleString()}
            icon={Activity}
            color="blue"
          />
          <StatsCard
            title="Sản phẩm OK"
            value={currentStats.ok.toLocaleString()}
            subtitle={`${((currentStats.ok / currentStats.total) * 100 || 0).toFixed(1)}%`}
            icon={CheckCircle2}
            color="green"
          />
          <StatsCard
            title="Sản phẩm NG"
            value={currentStats.ng.toLocaleString()}
            subtitle={`${((currentStats.ng / currentStats.total) * 100 || 0).toFixed(1)}%`}
            icon={XCircle}
            color="red"
          />
          <StatsCard
            title="Yield Rate"
            value={`${currentStats.yieldRate.toFixed(2)}%`}
            icon={TrendingUp}
            color={currentStats.yieldRate >= 95 ? "green" : currentStats.yieldRate >= 90 ? "yellow" : "red"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main drill-down list */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  {getLevelTitle()}
                </CardTitle>
                <CardDescription>
                  Click vào mục để xem chi tiết
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3, 4].map(i => (
                      <Skeleton key={i} className="h-24 w-full" />
                    ))}
                  </div>
                ) : currentStats.data.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertTriangle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Không có dữ liệu</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {currentStats.data.map((item: any) => (
                      <ClickableBarItem
                        key={item.id || item.code || item.name}
                        data={{
                          name: item.name,
                          code: item.code,
                          total: item.total || 0,
                          ok: item.ok || 0,
                          ng: item.ng || 0,
                          yieldRate: item.yieldRate || (item.total > 0 ? (item.ok / item.total) * 100 : 0),
                        }}
                        maxValue={maxValue}
                        onClick={() => {
                          if (drillState.level === "corporate") {
                            handleCorporateClick(item.code, item.name);
                          } else if (drillState.level === "factory") {
                            handleFactoryClick(item.id, item.name);
                          } else if (drillState.level === "line") {
                            handleLineClick(item.id, item.name);
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pie chart */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Phân bố kết quả</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : pieData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    Không có dữ liệu
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value: number) => value.toLocaleString()}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Quick stats */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-sm">Thống kê nhanh</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Số lượng</span>
                  <Badge variant="outline">{currentStats.data.length}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Yield cao nhất</span>
                  <Badge variant="default">
                    {Math.max(...currentStats.data.map((d: any) => d.yieldRate || 0), 0).toFixed(1)}%
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Yield thấp nhất</span>
                  <Badge variant="destructive">
                    {currentStats.data.length > 0 
                      ? Math.min(...currentStats.data.map((d: any) => d.yieldRate || 100)).toFixed(1) 
                      : 0}%
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Bar chart comparison */}
        <Card>
          <CardHeader>
            <CardTitle>So sánh sản lượng</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-80 w-full" />
            ) : currentStats.data.length === 0 ? (
              <div className="h-80 flex items-center justify-center text-muted-foreground">
                Không có dữ liệu
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={currentStats.data.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 12 }}
                    interval={0}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis />
                  <Tooltip 
                    formatter={(value: number) => value.toLocaleString()}
                  />
                  <Legend />
                  <Bar dataKey="ok" name="OK" fill="#22c55e" />
                  <Bar dataKey="ng" name="NG" fill="#ef4444" />
                  <Bar dataKey="ntf" name="NTF" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
