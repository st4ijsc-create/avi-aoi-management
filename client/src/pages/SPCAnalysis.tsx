import { useState, useMemo } from "react";
import { WorkstationAnalysis } from "@/components/WorkstationAnalysis";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle,
  BarChart3,
  LineChart,
  Target,
  Lightbulb,
  RefreshCw,
  Download,
  Wrench
} from "lucide-react";

// Date helpers
function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

export default function SPCAnalysis() {
  const [activeTab, setActiveTab] = useState("pareto");
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [selectedFactory, setSelectedFactory] = useState<string>("all");
  const [interval, setInterval] = useState<"hour" | "day" | "week" | "month">("day");

  // Fetch machines for filter
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: factories } = trpc.factory.list.useQuery();

  // Pareto analysis
  const { data: paretoData, isLoading: paretoLoading, refetch: refetchPareto } = trpc.spcAnalysis.topNGPoints.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    machineId: selectedMachine !== "all" ? Number(selectedMachine) : undefined,
    factoryCode: selectedFactory !== "all" ? selectedFactory : undefined,
    limit: 10,
  });

  // Yield trend with prediction
  const { data: trendData, isLoading: trendLoading, refetch: refetchTrend } = trpc.spcAnalysis.yieldTrend.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    machineId: selectedMachine !== "all" ? Number(selectedMachine) : undefined,
    factoryCode: selectedFactory !== "all" ? selectedFactory : undefined,
    interval,
    predictDays: 7,
  });

  // Anomaly detection
  const { data: anomalyData, isLoading: anomalyLoading, refetch: refetchAnomaly } = trpc.spcAnalysis.detectAnomalies.useQuery({
    machineId: selectedMachine !== "all" ? Number(selectedMachine) : undefined,
    factoryCode: selectedFactory !== "all" ? selectedFactory : undefined,
    days: 30,
    zScoreThreshold: 2,
  });

  // Root cause suggestions
  const { data: rootCauseData, isLoading: rootCauseLoading, refetch: refetchRootCause } = trpc.spcAnalysis.rootCauseSuggestions.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    machineId: selectedMachine !== "all" ? Number(selectedMachine) : undefined,
    factoryCode: selectedFactory !== "all" ? selectedFactory : undefined,
  });

  const handleRefresh = () => {
    refetchPareto();
    refetchTrend();
    refetchAnomaly();
    refetchRootCause();
  };

  // Calculate max NG for chart scaling
  const maxNG = useMemo(() => {
    if (!paretoData || paretoData.length === 0) return 100;
    return Math.max(...paretoData.map(d => d.ngCount));
  }, [paretoData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">SPC / AI Analysis</h1>
          <p className="text-muted-foreground">
            Statistical Process Control and AI-powered quality analysis
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Factory</Label>
              <Select value={selectedFactory} onValueChange={setSelectedFactory}>
                <SelectTrigger>
                  <SelectValue placeholder="All Factories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Factories</SelectItem>
                  {factories?.map((f) => (
                    <SelectItem key={f.id} value={f.code}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Machine</Label>
              <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                <SelectTrigger>
                  <SelectValue placeholder="All Machines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Machines</SelectItem>
                  {machines?.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Interval</Label>
              <Select value={interval} onValueChange={(v) => setInterval(v as typeof interval)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hour">Hourly</SelectItem>
                  <SelectItem value="day">Daily</SelectItem>
                  <SelectItem value="week">Weekly</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="pareto" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Pareto Analysis
          </TabsTrigger>
          <TabsTrigger value="trend" className="flex items-center gap-2">
            <LineChart className="h-4 w-4" />
            Trend & Prediction
          </TabsTrigger>
          <TabsTrigger value="anomaly" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Anomaly Detection
          </TabsTrigger>
          <TabsTrigger value="rootcause" className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Root Cause
          </TabsTrigger>
          <TabsTrigger value="workstation" className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Workstation
          </TabsTrigger>
        </TabsList>

        {/* Pareto Analysis Tab */}
        <TabsContent value="pareto" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Top NG Measurement Points (Pareto Chart)
              </CardTitle>
              <CardDescription>
                Identify the vital few measurement points causing the majority of defects
              </CardDescription>
            </CardHeader>
            <CardContent>
              {paretoLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : paretoData && paretoData.length > 0 ? (
                <div className="space-y-4">
                  {/* Pareto Chart Visualization */}
                  <div className="relative h-64 border rounded-lg p-4 bg-muted/20">
                    <div className="flex items-end justify-between h-full gap-2">
                      {paretoData.map((item, index) => (
                        <div key={index} className="flex flex-col items-center flex-1">
                          <div className="relative w-full flex flex-col items-center">
                            {/* Cumulative line point */}
                            <div 
                              className="absolute w-3 h-3 bg-orange-500 rounded-full z-10"
                              style={{ 
                                bottom: `${(Number(item.cumulativePercent) / 100) * 100}%`,
                                transform: 'translateY(50%)'
                              }}
                            />
                            {/* Bar */}
                            <div 
                              className="w-full bg-blue-500 rounded-t transition-all duration-300"
                              style={{ 
                                height: `${(item.ngCount / maxNG) * 100}%`,
                                minHeight: '4px'
                              }}
                            />
                          </div>
                          <span className="text-xs mt-2 text-center truncate w-full" title={item.pointName}>
                            {item.pointCode}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Y-axis labels */}
                    <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-muted-foreground">
                      <span>100%</span>
                      <span>50%</span>
                      <span>0%</span>
                    </div>
                  </div>

                  {/* Data Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2">Rank</th>
                          <th className="text-left py-2 px-2">Point Code</th>
                          <th className="text-left py-2 px-2">Point Name</th>
                          <th className="text-left py-2 px-2">Type</th>
                          <th className="text-right py-2 px-2">NG Count</th>
                          <th className="text-right py-2 px-2">NG Rate</th>
                          <th className="text-right py-2 px-2">Cumulative %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paretoData.map((item) => (
                          <tr key={item.rank} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-2">
                              <Badge variant={item.rank <= 3 ? "destructive" : "secondary"}>
                                #{item.rank}
                              </Badge>
                            </td>
                            <td className="py-2 px-2 font-mono">{item.pointCode}</td>
                            <td className="py-2 px-2">{item.pointName}</td>
                            <td className="py-2 px-2">
                              <Badge variant="outline">{item.measurementType}</Badge>
                            </td>
                            <td className="py-2 px-2 text-right font-medium">{item.ngCount}</td>
                            <td className="py-2 px-2 text-right">{item.ngRate}%</td>
                            <td className="py-2 px-2 text-right">
                              <span className={Number(item.cumulativePercent) >= 80 ? "text-orange-500 font-medium" : ""}>
                                {item.cumulativePercent}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No NG data found for the selected period
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trend & Prediction Tab */}
        <TabsContent value="trend" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Trend Direction Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Trend Direction</CardTitle>
              </CardHeader>
              <CardContent>
                {trendLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : trendData ? (
                  <div className="flex items-center gap-3">
                    {trendData.trend.direction === 'improving' ? (
                      <TrendingUp className="h-8 w-8 text-green-500" />
                    ) : trendData.trend.direction === 'declining' ? (
                      <TrendingDown className="h-8 w-8 text-red-500" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-yellow-100 flex items-center justify-center">
                        <span className="text-yellow-600">—</span>
                      </div>
                    )}
                    <div>
                      <p className="text-2xl font-bold capitalize">{trendData.trend.direction}</p>
                      <p className="text-xs text-muted-foreground">
                        Slope: {trendData.trend.slope.toFixed(3)}
                      </p>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* R² Score Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Model Fit (R²)</CardTitle>
              </CardHeader>
              <CardContent>
                {trendLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : trendData ? (
                  <div>
                    <p className="text-2xl font-bold">{(trendData.trend.r2 * 100).toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">
                      {trendData.trend.r2 > 0.7 ? "Strong fit" : trendData.trend.r2 > 0.4 ? "Moderate fit" : "Weak fit"}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Prediction Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">7-Day Prediction</CardTitle>
              </CardHeader>
              <CardContent>
                {trendLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : trendData && trendData.prediction.length > 0 ? (
                  <div>
                    <p className="text-2xl font-bold">
                      {trendData.prediction[trendData.prediction.length - 1].predictedYield.toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Confidence: {(trendData.prediction[trendData.prediction.length - 1].confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Yield Trend with Moving Average</CardTitle>
              <CardDescription>
                Historical yield data with 5-point moving average and trend line
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trendLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : trendData && trendData.historical.length > 0 ? (
                <div className="space-y-4">
                  {/* Simple line chart visualization */}
                  <div className="relative h-64 border rounded-lg p-4 bg-muted/20">
                    <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
                      {/* Yield line */}
                      <polyline
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth="0.5"
                        points={trendData.historical.map((d, i) => 
                          `${(i / (trendData.historical.length - 1)) * 100},${50 - (d.yieldRate / 2)}`
                        ).join(' ')}
                      />
                      {/* Moving average line */}
                      <polyline
                        fill="none"
                        stroke="#f97316"
                        strokeWidth="0.5"
                        strokeDasharray="2,1"
                        points={trendData.historical.map((d, i) => 
                          `${(i / (trendData.historical.length - 1)) * 100},${50 - (((d as any).movingAverage || d.yieldRate) / 2)}`
                        ).join(' ')}
                      />
                    </svg>
                    {/* Legend */}
                    <div className="absolute bottom-2 right-2 flex gap-4 text-xs">
                      <span className="flex items-center gap-1">
                        <div className="w-3 h-0.5 bg-blue-500" />
                        Yield
                      </span>
                      <span className="flex items-center gap-1">
                        <div className="w-3 h-0.5 bg-orange-500" style={{ borderStyle: 'dashed' }} />
                        MA(5)
                      </span>
                    </div>
                  </div>

                  {/* Prediction table */}
                  {trendData.prediction.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Yield Predictions</h4>
                      <div className="grid grid-cols-7 gap-2">
                        {trendData.prediction.map((p, i) => (
                          <div key={i} className="text-center p-2 border rounded bg-muted/20">
                            <p className="text-xs text-muted-foreground">{p.timeInterval}</p>
                            <p className="font-medium">{p.predictedYield.toFixed(1)}%</p>
                            <p className="text-xs text-muted-foreground">
                              ±{((1 - p.confidence) * 10).toFixed(1)}%
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No trend data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Anomaly Detection Tab */}
        <TabsContent value="anomaly" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Mean Yield</CardTitle>
              </CardHeader>
              <CardContent>
                {anomalyLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : (
                  <p className="text-2xl font-bold">
                    {anomalyData?.statistics.mean.toFixed(2)}%
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Std Deviation</CardTitle>
              </CardHeader>
              <CardContent>
                {anomalyLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : (
                  <p className="text-2xl font-bold">
                    {anomalyData?.statistics.stdDev.toFixed(2)}%
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Control Limits</CardTitle>
              </CardHeader>
              <CardContent>
                {anomalyLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : (
                  <p className="text-sm">
                    UCL: {anomalyData?.statistics.upperBound?.toFixed(2)}%<br />
                    LCL: {anomalyData?.statistics.lowerBound?.toFixed(2)}%
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Anomalies Detected</CardTitle>
              </CardHeader>
              <CardContent>
                {anomalyLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : (
                  <p className="text-2xl font-bold text-red-500">
                    {anomalyData?.statistics.anomalyCount || 0}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Anomaly Detection Results</CardTitle>
              <CardDescription>
                Data points with Z-score beyond ±2 standard deviations are flagged as anomalies
              </CardDescription>
            </CardHeader>
            <CardContent>
              {anomalyLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : anomalyData && anomalyData.anomalies.length > 0 ? (
                <div className="space-y-4">
                  {anomalyData.anomalies.map((anomaly, index) => (
                    <Alert key={index} variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Anomaly Detected - {String(anomaly.date)}</AlertTitle>
                      <AlertDescription>
                        Yield: {anomaly.yieldRate.toFixed(2)}% (Z-score: {anomaly.zScore.toFixed(2)})
                        <br />
                        Total: {anomaly.totalCount} | OK: {anomaly.okCount} | NG: {anomaly.ngCount}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
                  <p className="text-muted-foreground">No anomalies detected in the selected period</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Workstation Analysis Tab */}
        <TabsContent value="workstation" className="space-y-4">
          <WorkstationAnalysis 
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            machineId={selectedMachine !== "all" ? Number(selectedMachine) : undefined}
            factoryCode={selectedFactory !== "all" ? selectedFactory : undefined}
          />
        </TabsContent>

        {/* Root Cause Tab */}
        <TabsContent value="rootcause" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5" />
                AI-Powered Root Cause Suggestions
              </CardTitle>
              <CardDescription>
                Analysis and recommendations based on defect patterns
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rootCauseLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : rootCauseData ? (
                <div className="space-y-4">
                  {rootCauseData.suggestions.map((suggestion, index) => (
                    <Alert 
                      key={index} 
                      variant={suggestion.severity === 'high' ? 'destructive' : 'default'}
                    >
                      <div className="flex items-start gap-3">
                        {suggestion.severity === 'high' ? (
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                        ) : suggestion.severity === 'medium' ? (
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                        <div className="flex-1">
                          <AlertTitle className="flex items-center gap-2">
                            {suggestion.title}
                            <Badge variant={
                              suggestion.severity === 'high' ? 'destructive' : 
                              suggestion.severity === 'medium' ? 'secondary' : 'outline'
                            }>
                              {suggestion.severity}
                            </Badge>
                            <Badge variant="outline">{suggestion.type}</Badge>
                          </AlertTitle>
                          <AlertDescription className="mt-2">
                            <p className="mb-2">{suggestion.description}</p>
                            <p className="font-medium text-sm">
                              💡 Recommendation: {suggestion.recommendation}
                            </p>
                          </AlertDescription>
                        </div>
                      </div>
                    </Alert>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No analysis data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
