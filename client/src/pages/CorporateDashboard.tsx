import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { 
  Building2, 
  Factory, 
  TrendingUp, 
  TrendingDown,
  BarChart3,
  PieChart as PieChartIcon,
  Globe,
  Users,
  Activity,
  Target,
  Award,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  FileDown
} from "lucide-react";
import { CorporateFactoryStats } from "@/components/CorporateFactoryStats";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
  LineChart,
  Line
} from "recharts";

// Mock data for corporate overview
const corporateOverview = {
  totalCorporations: 3,
  totalCompanies: 12,
  totalFactories: 45,
  totalLines: 180,
  totalMachines: 1250,
  totalEmployees: 5600,
  avgYield: 94.5,
  avgOEE: 87.2
};

const corporationData = [
  { name: "Tập đoàn A", companies: 5, factories: 18, yield: 95.2, oee: 88.5, trend: 2.3 },
  { name: "Tập đoàn B", companies: 4, factories: 15, yield: 93.8, oee: 86.1, trend: -1.2 },
  { name: "Tập đoàn C", companies: 3, factories: 12, yield: 94.5, oee: 87.0, trend: 0.8 }
];

const monthlyTrend = [
  { month: "T1", yield: 92.5, oee: 85.2, output: 125000 },
  { month: "T2", yield: 93.1, oee: 85.8, output: 128000 },
  { month: "T3", yield: 93.8, oee: 86.5, output: 132000 },
  { month: "T4", yield: 94.2, oee: 87.0, output: 135000 },
  { month: "T5", yield: 94.5, oee: 87.2, output: 138000 },
  { month: "T6", yield: 94.8, oee: 87.5, output: 140000 }
];

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function CorporateDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState("month");
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              Dashboard Tập đoàn
            </h1>
            <p className="text-muted-foreground">
              Tổng quan hiệu suất toàn bộ tập đoàn, công ty và nhà máy
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[150px]">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Tuần này</SelectItem>
                <SelectItem value="month">Tháng này</SelectItem>
                <SelectItem value="quarter">Quý này</SelectItem>
                <SelectItem value="year">Năm nay</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm">
              <FileDown className="h-4 w-4 mr-2" />
              Xuất báo cáo
            </Button>
          </div>
        </div>

        {/* KPI Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Tập đoàn</span>
                <span className="text-2xl font-bold">{corporateOverview.totalCorporations}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Công ty</span>
                <span className="text-2xl font-bold">{corporateOverview.totalCompanies}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Nhà máy</span>
                <span className="text-2xl font-bold">{corporateOverview.totalFactories}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Dây chuyền</span>
                <span className="text-2xl font-bold">{corporateOverview.totalLines}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Máy móc</span>
                <span className="text-2xl font-bold">{corporateOverview.totalMachines}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Nhân viên</span>
                <span className="text-2xl font-bold">{corporateOverview.totalEmployees.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card bg-success/10">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Yield TB</span>
                <span className="text-2xl font-bold text-success">{corporateOverview.avgYield}%</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card bg-primary/10">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">OEE TB</span>
                <span className="text-2xl font-bold text-primary">{corporateOverview.avgOEE}%</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-xl grid-cols-3">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Tổng quan
            </TabsTrigger>
            <TabsTrigger value="comparison" className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4" />
              So sánh
            </TabsTrigger>
            <TabsTrigger value="details" className="flex items-center gap-2">
              <Factory className="h-4 w-4" />
              Chi tiết
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Corporation Performance */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    Hiệu suất theo Tập đoàn
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {corporationData.map((corp, index) => (
                      <div key={corp.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${COLORS[index]}20` }}>
                            <Building2 className="h-5 w-5" style={{ color: COLORS[index] }} />
                          </div>
                          <div>
                            <p className="font-medium">{corp.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {corp.companies} công ty • {corp.factories} nhà máy
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-bold text-success">{corp.yield}%</p>
                            <p className="text-xs text-muted-foreground">Yield</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-primary">{corp.oee}%</p>
                            <p className="text-xs text-muted-foreground">OEE</p>
                          </div>
                          <Badge variant={corp.trend > 0 ? "default" : "destructive"} className="flex items-center gap-1">
                            {corp.trend > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(corp.trend)}%
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Monthly Trend Chart */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Xu hướng theo tháng
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyTrend}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" className="text-xs" />
                        <YAxis domain={[80, 100]} className="text-xs" />
                        <RechartsTooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="yield" name="Yield %" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} />
                        <Line type="monotone" dataKey="oee" name="OEE %" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Output Trend */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Sản lượng theo tháng
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" />
                      <YAxis className="text-xs" />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [value.toLocaleString(), 'Sản lượng']}
                      />
                      <Bar dataKey="output" name="Sản lượng" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Comparison Tab */}
          <TabsContent value="comparison" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Yield Distribution */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-success" />
                    Phân bố Yield theo Tập đoàn
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={corporationData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="yield"
                          nameKey="name"
                          label={({ name, yield: y }) => `${name}: ${y}%`}
                        >
                          {corporationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* OEE Distribution */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-primary" />
                    Phân bố OEE theo Tập đoàn
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={corporationData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="oee"
                          nameKey="name"
                          label={({ name, oee }) => `${name}: ${oee}%`}
                        >
                          {corporationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Comparison Bar Chart */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  So sánh hiệu suất giữa các Tập đoàn
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={corporationData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" domain={[0, 100]} className="text-xs" />
                      <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Bar dataKey="yield" name="Yield %" fill="#10b981" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="oee" name="OEE %" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Details Tab - Use existing CorporateFactoryStats */}
          <TabsContent value="details" className="space-y-6 mt-6">
            <CorporateFactoryStats />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
