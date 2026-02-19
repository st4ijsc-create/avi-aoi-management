import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, Cell, PieChart, Pie } from 'recharts';
import { Calendar, ChevronRight, Home, Building2, Factory, ArrowLeft, TrendingUp, TrendingDown, Minus, Cpu } from 'lucide-react';
import { MachineAnalyticsView } from './MachineAnalyticsView';
import { ExportDashboardButton } from './ExportDashboardButton';

type DrillLevel = 'corporate' | 'factory' | 'machine';

interface BreadcrumbItem {
  level: DrillLevel;
  label: string;
  code?: string;
  id?: number;
}

// Types for yield data
interface YieldByCorporate {
  corporateCode: string;
  totalInspections: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: string;
}

interface YieldByFactory extends YieldByCorporate {
  factoryCode: string;
}

export function CorporateFactoryStats() {
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d');
  
  // Drill-down state
  const [drillLevel, setDrillLevel] = useState<DrillLevel>('corporate');
  const [selectedCorporate, setSelectedCorporate] = useState<string | undefined>();
  const [selectedFactory, setSelectedFactory] = useState<string | undefined>();
  const [selectedMachine, setSelectedMachine] = useState<{ id: number; name: string } | undefined>();

  const startDate = useMemo(() => {
    const date = new Date();
    if (dateRange === '7d') date.setDate(date.getDate() - 7);
    else if (dateRange === '30d') date.setDate(date.getDate() - 30);
    else date.setDate(date.getDate() - 90);
    return date;
  }, [dateRange]);

  const endDate = useMemo(() => new Date(), []);

  // Queries
  const { data: yieldByCorporate, isLoading: loadingCorporate } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({
    startDate,
    endDate,
  });

  const { data: yieldByFactory, isLoading: loadingFactory } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery({
    corporateCode: selectedCorporate,
    startDate,
    endDate,
  }, {
    enabled: drillLevel !== 'corporate' && !!selectedCorporate,
  });

  const { data: throughputByCorporate, isLoading: loadingThroughput } = trpc.corporateFactoryStats.throughputByCorporate.useQuery({
    startDate,
    endDate,
    interval: 'day',
  });

  const { data: throughputByFactory, isLoading: loadingFactoryThroughput } = trpc.corporateFactoryStats.throughputByFactory.useQuery({
    corporateCode: selectedCorporate,
    startDate,
    endDate,
    interval: 'day',
  }, {
    enabled: drillLevel !== 'corporate' && !!selectedCorporate,
  });

  // Get machines for factory drill-down
  const { data: machines } = trpc.machine.list.useQuery(undefined, {
    enabled: drillLevel === 'factory',
  });

  // Filter machines by factory (using factory code matching)
  const factoryMachines = useMemo(() => {
    if (!machines || !selectedFactory) return [];
    // For now, return all machines - in production, filter by factory
    return machines.slice(0, 10);
  }, [machines, selectedFactory]);

  // Transform throughput data for chart
  const throughputChartData = useMemo(() => {
    if (drillLevel === 'corporate') {
      if (!throughputByCorporate) return [];
      return throughputByCorporate.reduce((acc, item) => {
        const key = item.corporateCode;
        const existing = acc.find(x => x.date === item.timeInterval);
        if (existing) {
          existing[key] = item.count;
        } else {
          acc.push({
            date: item.timeInterval,
            [key]: item.count,
          });
        }
        return acc;
      }, [] as any[]);
    } else {
      if (!throughputByFactory) return [];
      return throughputByFactory.reduce((acc, item) => {
        const key = item.factoryCode;
        const existing = acc.find(x => x.date === item.timeInterval);
        if (existing) {
          existing[key] = item.count;
        } else {
          acc.push({
            date: item.timeInterval,
            [key]: item.count,
          });
        }
        return acc;
      }, [] as any[]);
    }
  }, [drillLevel, throughputByCorporate, throughputByFactory]);

  // Get unique codes for legend
  const chartCodes = useMemo(() => {
    if (drillLevel === 'corporate') {
      if (!throughputByCorporate) return [];
      return Array.from(new Set(throughputByCorporate.map(x => x.corporateCode)));
    } else {
      if (!throughputByFactory) return [];
      return Array.from(new Set(throughputByFactory.map(x => x.factoryCode)));
    }
  }, [drillLevel, throughputByCorporate, throughputByFactory]);

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  // Breadcrumb navigation
  const breadcrumbs: BreadcrumbItem[] = useMemo(() => {
    const items: BreadcrumbItem[] = [{ level: 'corporate', label: 'Tß╗òng quan' }];
    if (selectedCorporate && drillLevel !== 'corporate') {
      items.push({ level: 'factory', label: selectedCorporate, code: selectedCorporate });
    }
    if (selectedMachine && drillLevel === 'machine') {
      items.push({ level: 'machine', label: selectedMachine.name, id: selectedMachine.id });
    }
    return items;
  }, [drillLevel, selectedCorporate, selectedMachine]);

  // Handle drill-down click on bar chart
  const handleBarClick = (data: any) => {
    if (drillLevel === 'corporate' && data?.corporateCode) {
      setSelectedCorporate(data.corporateCode);
      setDrillLevel('factory');
    } else if (drillLevel === 'factory' && data?.factoryCode) {
      setSelectedFactory(data.factoryCode);
      // Show machine selection instead of directly going to machine view
    }
  };

  // Handle machine selection
  const handleMachineClick = (machine: { id: number; name: string }) => {
    setSelectedMachine(machine);
    setDrillLevel('machine');
  };

  // Handle breadcrumb navigation
  const handleBreadcrumbClick = (item: BreadcrumbItem) => {
    if (item.level === 'corporate') {
      setDrillLevel('corporate');
      setSelectedCorporate(undefined);
      setSelectedFactory(undefined);
      setSelectedMachine(undefined);
    } else if (item.level === 'factory') {
      setDrillLevel('factory');
      setSelectedFactory(undefined);
      setSelectedMachine(undefined);
    }
  };

  // Handle back button
  const handleBack = () => {
    if (drillLevel === 'machine') {
      setDrillLevel('factory');
      setSelectedMachine(undefined);
    } else if (drillLevel === 'factory') {
      setDrillLevel('corporate');
      setSelectedCorporate(undefined);
      setSelectedFactory(undefined);
    }
  };

  // Get current yield data based on drill level
  const currentYieldData = drillLevel === 'corporate' ? yieldByCorporate : yieldByFactory;
  const isLoading = drillLevel === 'corporate' ? loadingCorporate : loadingFactory;

  // Calculate trend indicator (yieldRate is string, convert to number)
  const getTrendIndicator = (yieldRate: string) => {
    const rate = parseFloat(yieldRate);
    if (rate >= 95) return { icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-500/10' };
    if (rate >= 85) return { icon: Minus, color: 'text-yellow-500', bg: 'bg-yellow-500/10' };
    return { icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-500/10' };
  };

  // Get status text based on yield rate
  const getStatusText = (yieldRate: string) => {
    const rate = parseFloat(yieldRate);
    if (rate >= 95) return 'Tß╗æt';
    if (rate >= 85) return 'Trung b├¼nh';
    return 'Cß║ºn cß║úi thiß╗çn';
  };

  // Get code from item based on drill level
  const getItemCode = (item: YieldByCorporate | YieldByFactory): string => {
    if (drillLevel === 'corporate') {
      return item.corporateCode;
    }
    return (item as YieldByFactory).factoryCode || item.corporateCode;
  };

  // If machine is selected, show MachineAnalyticsView
  if (drillLevel === 'machine' && selectedMachine) {
    return (
      <MachineAnalyticsView
        machineId={selectedMachine.id}
        machineName={selectedMachine.name}
        factoryCode={selectedFactory}
        onBack={handleBack}
        startDate={startDate}
        endDate={endDate}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {breadcrumbs.map((item, index) => (
            <div key={item.level} className="flex items-center gap-2">
              {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <button
                onClick={() => handleBreadcrumbClick(item)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                  index === breadcrumbs.length - 1
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.level === 'corporate' && <Home className="h-4 w-4" />}
                {item.level === 'factory' && <Building2 className="h-4 w-4" />}
                {item.level === 'machine' && <Cpu className="h-4 w-4" />}
                {item.label}
              </button>
            </div>
          ))}
        </div>

        {drillLevel !== 'corporate' && (
          <Button variant="outline" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Quay lß║íi
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as any)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 ng├áy qua</SelectItem>
                <SelectItem value="30d">30 ng├áy qua</SelectItem>
                <SelectItem value="90d">90 ng├áy qua</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {drillLevel === 'corporate' && yieldByCorporate && yieldByCorporate.length > 0 && (
            <Select value={selectedCorporate || 'all'} onValueChange={(v) => {
              if (v === 'all') {
                setSelectedCorporate(undefined);
              } else {
                setSelectedCorporate(v);
                setDrillLevel('factory');
              }
            }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Chß╗ìn c├┤ng ty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tß║Ñt cß║ú c├┤ng ty</SelectItem>
                {yieldByCorporate.map(item => (
                  <SelectItem key={item.corporateCode} value={item.corporateCode}>
                    {item.corporateCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        
        <ExportDashboardButton corporateCode={selectedCorporate} />
      </div>

      {/* Level Title */}
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${
          drillLevel === 'corporate' ? 'bg-blue-500/10' : 
          drillLevel === 'factory' ? 'bg-green-500/10' : 'bg-purple-500/10'
        }`}>
          {drillLevel === 'corporate' && <Building2 className="h-5 w-5 text-blue-500" />}
          {drillLevel === 'factory' && <Factory className="h-5 w-5 text-green-500" />}
          {drillLevel === 'machine' && <Cpu className="h-5 w-5 text-purple-500" />}
        </div>
        <div>
          <h2 className="text-lg font-semibold">
            {drillLevel === 'corporate' && 'Thß╗æng k├¬ theo C├┤ng ty'}
            {drillLevel === 'factory' && `Chi tiß║┐t Nh├á m├íy - ${selectedCorporate}`}
            {drillLevel === 'machine' && `Chi tiß║┐t M├íy - ${selectedMachine?.name}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {drillLevel === 'corporate' && 'Click v├áo cß╗Öt ─æß╗â xem chi tiß║┐t nh├á m├íy'}
            {drillLevel === 'factory' && 'Click v├áo thß║╗ m├íy ─æß╗â xem chi tiß║┐t'}
            {drillLevel === 'machine' && 'Thß╗æng k├¬ chi tiß║┐t cß╗ºa m├íy'}
          </p>
        </div>
      </div>

      {/* Yield Rate Chart */}
      <Card>
        <CardHeader>
          <CardTitle>
            {drillLevel === 'corporate' ? 'Tß╗╖ lß╗ç ─æß║ít theo C├┤ng ty' : 
             drillLevel === 'factory' ? 'Tß╗╖ lß╗ç ─æß║ít theo Nh├á m├íy' : 'Tß╗╖ lß╗ç ─æß║ít theo M├íy'}
          </CardTitle>
          <CardDescription>
            {drillLevel === 'corporate' ? 'So s├ính yield rate giß╗»a c├íc c├┤ng ty - Click ─æß╗â drill-down' : 
             drillLevel === 'factory' ? `Chi tiß║┐t yield rate cß╗ºa ${selectedCorporate}` : `Chi tiß║┐t yield rate cß╗ºa ${selectedMachine?.name}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <p className="text-muted-foreground">─Éang tß║úi...</p>
            </div>
          ) : currentYieldData && currentYieldData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart 
                data={currentYieldData.map(item => ({
                  ...item,
                  yieldRateNum: parseFloat(item.yieldRate),
                }))}
                onClick={(e) => e?.activePayload?.[0]?.payload && handleBarClick(e.activePayload[0].payload)}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={drillLevel === 'corporate' ? 'corporateCode' : 'factoryCode'} />
                <YAxis domain={[0, 100]} label={{ value: 'Yield Rate (%)', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  formatter={(value: any) => `${value}%`}
                  labelFormatter={(label) => drillLevel === 'corporate' ? `C├┤ng ty: ${label}` : `Nh├á m├íy: ${label}`}
                  cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }}
                />
                <Legend />
                <Bar 
                  dataKey="yieldRateNum" 
                  name="Tß╗╖ lß╗ç ─æß║ít (%)" 
                  cursor={drillLevel !== 'machine' ? 'pointer' : 'default'}
                >
                  {currentYieldData.map((entry, index) => {
                    const rate = parseFloat(entry.yieldRate);
                    return (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={rate >= 95 ? '#10b981' : rate >= 85 ? '#f59e0b' : '#ef4444'}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center">
              <p className="text-muted-foreground">Kh├┤ng c├│ dß╗» liß╗çu</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Machine Selection (when at factory level) */}
      {drillLevel === 'factory' && factoryMachines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Chß╗ìn m├íy ─æß╗â xem chi tiß║┐t</CardTitle>
            <CardDescription>Click v├áo m├íy ─æß╗â xem thß╗æng k├¬ chi tiß║┐t v├á lß╗ïch sß╗¡ kiß╗âm tra</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {factoryMachines.map((machine) => (
                <Card 
                  key={machine.id}
                  className="cursor-pointer hover:shadow-md hover:border-primary/50 transition-all"
                  onClick={() => handleMachineClick({ id: machine.id, name: machine.name })}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-purple-500/10">
                        <Cpu className="h-4 w-4 text-purple-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{machine.name}</p>
                        <p className="text-xs text-muted-foreground">{machine.code}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center text-xs text-primary">
                      <span>Xem chi tiß║┐t</span>
                      <ChevronRight className="h-3 w-3 ml-1" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Throughput Trends */}
      <Card>
        <CardHeader>
          <CardTitle>
            {drillLevel === 'corporate' ? 'Xu h╞░ß╗¢ng Throughput theo C├┤ng ty' : 'Xu h╞░ß╗¢ng Throughput theo Nh├á m├íy'}
          </CardTitle>
          <CardDescription>Sß╗æ l╞░ß╗úng sß║ún phß║⌐m kiß╗âm tra theo thß╗¥i gian</CardDescription>
        </CardHeader>
        <CardContent>
          {(drillLevel === 'corporate' ? loadingThroughput : loadingFactoryThroughput) ? (
            <div className="h-[400px] flex items-center justify-center">
              <p className="text-muted-foreground">─Éang tß║úi...</p>
            </div>
          ) : throughputChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={throughputChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis label={{ value: 'Sß╗æ l╞░ß╗úng', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  labelFormatter={(label) => {
                    const date = new Date(label);
                    return date.toLocaleDateString('vi-VN');
                  }}
                />
                <Legend />
                {chartCodes.map((code, index) => (
                  <Line 
                    key={code}
                    type="monotone" 
                    dataKey={code} 
                    stroke={colors[index % colors.length]} 
                    name={code}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[400px] flex items-center justify-center">
              <p className="text-muted-foreground">Kh├┤ng c├│ dß╗» liß╗çu</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {currentYieldData?.map((item, idx) => {
          const code = getItemCode(item);
          const trend = getTrendIndicator(item.yieldRate);
          const TrendIcon = trend.icon;
          
          return (
            <Card 
              key={`${code}-${idx}`} 
              className={`transition-all ${drillLevel !== 'machine' ? 'cursor-pointer hover:shadow-md hover:border-primary/50' : ''}`}
              onClick={() => drillLevel !== 'machine' && handleBarClick(item)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{code}</CardTitle>
                  <div className={`p-1.5 rounded-full ${trend.bg}`}>
                    <TrendIcon className={`h-4 w-4 ${trend.color}`} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">{item.yieldRate}%</span>
                  <span className={`text-xs ${trend.color}`}>
                    {getStatusText(item.yieldRate)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground">{item.totalInspections}</p>
                    <p>Tß╗òng</p>
                  </div>
                  <div>
                    <p className="font-medium text-green-600">{item.okCount}</p>
                    <p>OK</p>
                  </div>
                  <div>
                    <p className="font-medium text-red-600">{item.ngCount}</p>
                    <p>NG</p>
                  </div>
                </div>
                {drillLevel !== 'machine' && (
                  <div className="mt-3 flex items-center text-xs text-primary">
                    <span>Xem chi tiß║┐t</span>
                    <ChevronRight className="h-3 w-3 ml-1" />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Distribution Pie Chart */}
      {currentYieldData && currentYieldData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ph├ón bß╗æ sß║ún l╞░ß╗úng</CardTitle>
            <CardDescription>Tß╗╖ lß╗ç ─æ├│ng g├│p cß╗ºa tß╗½ng {drillLevel === 'corporate' ? 'c├┤ng ty' : 'nh├á m├íy'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col lg:flex-row items-center gap-8">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={currentYieldData.map(item => ({
                      ...item,
                      name: getItemCode(item),
                    }))}
                    dataKey="totalInspections"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  >
                    {currentYieldData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: any, name: string) => [`${value} sß║ún phß║⌐m`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              
              <div className="w-full lg:w-auto">
                <h4 className="font-medium mb-3">Chi tiß║┐t</h4>
                <div className="space-y-2">
                  {currentYieldData.map((item, index) => {
                    const code = getItemCode(item);
                    const total = currentYieldData.reduce((sum, i) => sum + i.totalInspections, 0);
                    const percent = total > 0 ? ((item.totalInspections / total) * 100).toFixed(1) : '0';
                    
                    return (
                      <div key={`${code}-${index}`} className="flex items-center gap-3">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: colors[index % colors.length] }}
                        />
                        <span className="text-sm min-w-[100px]">{code}</span>
                        <span className="text-sm text-muted-foreground">{item.totalInspections} ({percent}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
