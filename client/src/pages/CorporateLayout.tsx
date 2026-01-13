import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { navItems } from "@/lib/navigation";
import { 
  Building2, 
  Warehouse, 
  Cpu, 
  MapPin, 
  TrendingUp, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Box,
  Globe,
  Layers
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { lazy, Suspense } from "react";

const Factory3DScene = lazy(() => import("@/components/Factory3DScene"));

import type { FactoryData, WorkshopData } from "@/types/factory";

export default function CorporateLayout() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [viewMode, setViewMode] = useState<"2D" | "3D" | "MAP">("2D");
  const [selectedFactory, setSelectedFactory] = useState<FactoryData | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  type DashboardStats = {
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    yieldRate: number;
  };
  const { data: dashboardStats } = trpc.dashboard.getStats.useQuery({});

  // Aggregate stats per factory
  const factoriesWithStats = useMemo(() => {
    if (!factories) return [];
    
    return factories.map((factory) => {
      const factoryWorkshops = workshops?.filter(w => w.factoryId === factory.id) || [];
      
      // Mock stats for visualization - in production this would come from real data
      const mockStats = {
        total: Math.floor(Math.random() * 5000) + 1000,
        ok: 0,
        ng: 0,
        ntf: 0,
        yieldRate: 0,
      };
      mockStats.ok = Math.floor(mockStats.total * (0.92 + Math.random() * 0.06));
      mockStats.ng = Math.floor((mockStats.total - mockStats.ok) * 0.7);
      mockStats.ntf = mockStats.total - mockStats.ok - mockStats.ng;
      mockStats.yieldRate = (mockStats.ok / mockStats.total) * 100;

      return {
        ...factory,
        stats: mockStats,
        workshops: factoryWorkshops.map(ws => ({
          ...ws,
          stats: {
            total: Math.floor(mockStats.total / factoryWorkshops.length),
            ok: Math.floor(mockStats.ok / factoryWorkshops.length),
            ng: Math.floor(mockStats.ng / factoryWorkshops.length),
            ntf: Math.floor(mockStats.ntf / factoryWorkshops.length),
            yieldRate: mockStats.yieldRate,
          }
        }))
      } as FactoryData;
    });
  }, [factories, workshops]);

  // Draw 2D corporate layout
  useEffect(() => {
    if (viewMode !== "2D" || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = 600;
    }

    // Clear canvas
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = "rgba(6, 182, 212, 0.1)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 50 * zoom) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50 * zoom) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw factories as regions on a map
    const regions = [
      { name: "Miền Bắc", x: canvas.width * 0.3, y: 100 * zoom },
      { name: "Miền Trung", x: canvas.width * 0.5, y: 280 * zoom },
      { name: "Miền Nam", x: canvas.width * 0.7, y: 450 * zoom },
    ];

    factoriesWithStats.forEach((factory, index) => {
      const region = regions[index % regions.length];
      const boxWidth = 280 * zoom;
      const boxHeight = 160 * zoom;
      const x = region.x - boxWidth / 2;
      const y = region.y;

      // Factory box
      const isSelected = selectedFactory?.id === factory.id;
      const gradient = ctx.createLinearGradient(x, y, x, y + boxHeight);
      gradient.addColorStop(0, isSelected ? "rgba(6, 182, 212, 0.3)" : "rgba(30, 41, 59, 0.8)");
      gradient.addColorStop(1, isSelected ? "rgba(6, 182, 212, 0.1)" : "rgba(15, 23, 42, 0.8)");
      
      ctx.fillStyle = gradient;
      ctx.strokeStyle = isSelected ? "#06b6d4" : "rgba(6, 182, 212, 0.3)";
      ctx.lineWidth = isSelected ? 2 : 1;
      
      // Rounded rectangle
      const radius = 12 * zoom;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + boxWidth - radius, y);
      ctx.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + radius);
      ctx.lineTo(x + boxWidth, y + boxHeight - radius);
      ctx.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - radius, y + boxHeight);
      ctx.lineTo(x + radius, y + boxHeight);
      ctx.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Factory icon
      ctx.fillStyle = "#06b6d4";
      ctx.font = `${24 * zoom}px sans-serif`;
      ctx.fillText("🏭", x + 15 * zoom, y + 35 * zoom);

      // Factory name
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${14 * zoom}px sans-serif`;
      ctx.fillText(factory.name, x + 50 * zoom, y + 30 * zoom);

      // Factory code
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${11 * zoom}px sans-serif`;
      ctx.fillText(factory.code, x + 50 * zoom, y + 48 * zoom);

      // Stats
      const statsY = y + 75 * zoom;
      
      // Total
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${18 * zoom}px sans-serif`;
      ctx.fillText(factory.stats.total.toLocaleString(), x + 20 * zoom, statsY);
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${10 * zoom}px sans-serif`;
      ctx.fillText("Total", x + 20 * zoom, statsY + 15 * zoom);

      // OK
      ctx.fillStyle = "#10b981";
      ctx.font = `bold ${14 * zoom}px sans-serif`;
      ctx.fillText(factory.stats.ok.toLocaleString(), x + 100 * zoom, statsY);
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${10 * zoom}px sans-serif`;
      ctx.fillText("OK", x + 100 * zoom, statsY + 15 * zoom);

      // NG
      ctx.fillStyle = "#ef4444";
      ctx.font = `bold ${14 * zoom}px sans-serif`;
      ctx.fillText(factory.stats.ng.toLocaleString(), x + 160 * zoom, statsY);
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${10 * zoom}px sans-serif`;
      ctx.fillText("NG", x + 160 * zoom, statsY + 15 * zoom);

      // Yield Rate
      const yieldColor = factory.stats.yieldRate >= 95 ? "#10b981" : factory.stats.yieldRate >= 90 ? "#f59e0b" : "#ef4444";
      ctx.fillStyle = yieldColor;
      ctx.font = `bold ${16 * zoom}px sans-serif`;
      ctx.fillText(`${factory.stats.yieldRate.toFixed(1)}%`, x + 210 * zoom, statsY);
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${10 * zoom}px sans-serif`;
      ctx.fillText("Yield", x + 210 * zoom, statsY + 15 * zoom);

      // Workshops count
      ctx.fillStyle = "#64748b";
      ctx.font = `${11 * zoom}px sans-serif`;
      ctx.fillText(`${factory.workshops.length} nhà xưởng`, x + 20 * zoom, y + boxHeight - 15 * zoom);

      // Connection lines between factories
      if (index < factoriesWithStats.length - 1) {
        const nextRegion = regions[(index + 1) % regions.length];
        ctx.strokeStyle = "rgba(6, 182, 212, 0.2)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(region.x, y + boxHeight);
        ctx.lineTo(nextRegion.x, nextRegion.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Draw title
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${20 * zoom}px sans-serif`;
    ctx.fillText("Tổng quan Tập đoàn - Bản đồ Nhà máy", 20, 30);

    ctx.fillStyle = "#94a3b8";
    ctx.font = `${12 * zoom}px sans-serif`;
    ctx.fillText(`${factoriesWithStats.length} nhà máy | ${workshops?.length || 0} nhà xưởng`, 20, 50);

  }, [viewMode, factoriesWithStats, selectedFactory, zoom, workshops?.length]);

  // Handle canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicked on a factory
    const regions = [
      { x: canvas.width * 0.3, y: 100 * zoom },
      { x: canvas.width * 0.5, y: 280 * zoom },
      { x: canvas.width * 0.7, y: 450 * zoom },
    ];

    factoriesWithStats.forEach((factory, index) => {
      const region = regions[index % regions.length];
      const boxWidth = 280 * zoom;
      const boxHeight = 160 * zoom;
      const boxX = region.x - boxWidth / 2;
      const boxY = region.y;

      if (x >= boxX && x <= boxX + boxWidth && y >= boxY && y <= boxY + boxHeight) {
        setSelectedFactory(factory);
      }
    });
  };

  if (authLoading) {
    return (
      <DashboardLayout title="Layout Tập đoàn" navItems={navItems} currentPath="/corporate-layout">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Layout Tập đoàn" navItems={navItems} currentPath="/corporate-layout">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trực quan hóa Tập đoàn</h1>
            <p className="text-muted-foreground">Bản đồ tổng quan các nhà máy và nhà xưởng</p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "2D" | "3D" | "MAP")}>
              <TabsList>
                <TabsTrigger value="2D" className="gap-1">
                  <Layers className="h-4 w-4" />
                  2D
                </TabsTrigger>
                <TabsTrigger value="MAP" className="gap-1">
                  <Globe className="h-4 w-4" />
                  Map
                </TabsTrigger>
                <TabsTrigger value="3D" className="gap-1">
                  <Box className="h-4 w-4" />
                  3D
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1 ml-2">
              <Button variant="outline" size="icon" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
              <Button variant="outline" size="icon" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setZoom(1)}>
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{factoriesWithStats.length}</p>
                  <p className="text-sm text-muted-foreground">Nhà máy</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10">
                  <Warehouse className="h-5 w-5 text-cyan-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{workshops?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">Nhà xưởng</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <TrendingUp className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {(dashboardStats as DashboardStats | undefined)?.yieldRate?.toFixed(1) || "0"}%
                  </p>
                  <p className="text-sm text-muted-foreground">Yield Rate TB</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10">
                  <Cpu className="h-5 w-5 text-violet-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {(dashboardStats as DashboardStats | undefined)?.total?.toLocaleString() || "0"}
                  </p>
                  <p className="text-sm text-muted-foreground">Tổng sản phẩm</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map View */}
          <Card className="lg:col-span-2 glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Bản đồ Nhà máy
              </CardTitle>
              <CardDescription>Click vào nhà máy để xem chi tiết</CardDescription>
            </CardHeader>
            <CardContent>
              <div ref={containerRef} className="relative border rounded-lg overflow-hidden bg-background/50">
                {viewMode === "2D" ? (
                  <canvas
                    ref={canvasRef}
                    onClick={handleCanvasClick}
                    className="cursor-pointer w-full"
                    style={{ minHeight: 600 }}
                  />
                ) : viewMode === "MAP" ? (
                  <div className="relative w-full" style={{ minHeight: 600 }}>
                    {/* World Map with Factory Markers */}
                    <div className="absolute inset-0 bg-gradient-to-b from-slate-900 to-slate-800 rounded-lg overflow-hidden">
                      {/* SVG World Map */}
                      <svg viewBox="0 0 1000 500" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                        {/* Ocean background */}
                        <rect fill="#0f172a" width="1000" height="500" />
                        
                        {/* Simplified continent shapes */}
                        <g fill="#1e293b" stroke="#334155" strokeWidth="0.5">
                          {/* North America */}
                          <path d="M50,80 L200,60 L280,100 L300,180 L250,220 L200,200 L150,220 L100,180 L50,150 Z" />
                          {/* South America */}
                          <path d="M180,250 L220,230 L260,280 L280,350 L250,420 L200,450 L160,400 L170,320 Z" />
                          {/* Europe */}
                          <path d="M420,80 L500,60 L520,100 L500,140 L450,150 L420,120 Z" />
                          {/* Africa */}
                          <path d="M420,180 L500,160 L540,200 L560,280 L520,380 L460,400 L420,350 L400,250 Z" />
                          {/* Asia */}
                          <path d="M520,60 L700,40 L850,80 L900,150 L880,220 L800,250 L700,230 L600,200 L550,150 L520,100 Z" />
                          {/* Southeast Asia */}
                          <path d="M700,250 L780,230 L820,280 L800,320 L750,340 L700,300 Z" />
                          {/* Australia */}
                          <path d="M780,350 L880,330 L920,380 L900,430 L820,450 L780,400 Z" />
                        </g>
                        
                        {/* Grid lines */}
                        <g stroke="#334155" strokeWidth="0.3" strokeDasharray="5,5">
                          {[0, 100, 200, 300, 400].map(y => (
                            <line key={`h-${y}`} x1="0" y1={y + 50} x2="1000" y2={y + 50} />
                          ))}
                          {[0, 200, 400, 600, 800].map(x => (
                            <line key={`v-${x}`} x1={x + 100} y1="0" x2={x + 100} y2="500" />
                          ))}
                        </g>
                        
                        {/* Factory Markers */}
                        {factoriesWithStats.map((factory, index) => {
                          // Position factories on the map based on region
                          const positions = [
                            { x: 750, y: 280 }, // Vietnam
                            { x: 800, y: 150 }, // China
                            { x: 480, y: 120 }, // Europe
                            { x: 200, y: 150 }, // USA
                          ];
                          const pos = positions[index % positions.length];
                          const isSelected = selectedFactory?.id === factory.id;
                          const yieldColor = factory.stats.yieldRate >= 95 ? "#10b981" : factory.stats.yieldRate >= 90 ? "#f59e0b" : "#ef4444";
                          
                          return (
                            <g key={factory.id} onClick={() => setSelectedFactory(factory)} style={{ cursor: "pointer" }}>
                              {/* Pulse animation for selected */}
                              {isSelected && (
                                <circle cx={pos.x} cy={pos.y} r="25" fill={yieldColor} opacity="0.3">
                                  <animate attributeName="r" values="20;35;20" dur="2s" repeatCount="indefinite" />
                                  <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite" />
                                </circle>
                              )}
                              {/* Marker circle */}
                              <circle 
                                cx={pos.x} cy={pos.y} r={isSelected ? 15 : 12} 
                                fill={yieldColor} 
                                stroke="#fff" 
                                strokeWidth="2"
                                className="transition-all duration-300"
                              />
                              {/* Factory icon */}
                              <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold">
                                {factory.code.substring(0, 2)}
                              </text>
                              {/* Label */}
                              <rect x={pos.x - 40} y={pos.y + 20} width="80" height="24" rx="4" fill="rgba(0,0,0,0.8)" />
                              <text x={pos.x} y={pos.y + 36} textAnchor="middle" fill="#fff" fontSize="10">
                                {factory.name.length > 12 ? factory.name.substring(0, 12) + "..." : factory.name}
                              </text>
                            </g>
                          );
                        })}
                        
                        {/* Legend */}
                        <g transform="translate(20, 420)">
                          <rect x="0" y="0" width="150" height="60" rx="4" fill="rgba(0,0,0,0.7)" />
                          <text x="10" y="18" fill="#fff" fontSize="11" fontWeight="bold">Chú thích</text>
                          <circle cx="20" cy="35" r="6" fill="#10b981" />
                          <text x="35" y="38" fill="#94a3b8" fontSize="9">≥ 95% Yield</text>
                          <circle cx="90" cy="35" r="6" fill="#f59e0b" />
                          <text x="105" y="38" fill="#94a3b8" fontSize="9">≥ 90%</text>
                          <circle cx="20" cy="52" r="6" fill="#ef4444" />
                          <text x="35" y="55" fill="#94a3b8" fontSize="9">&lt; 90%</text>
                        </g>
                      </svg>
                    </div>
                  </div>
                ) : (
                  <Suspense fallback={
                    <div className="flex items-center justify-center h-[600px] text-muted-foreground">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  }>
                    <Factory3DScene
                      factories={factoriesWithStats}
                      selectedFactory={selectedFactory}
                      onSelectFactory={setSelectedFactory}
                    />
                  </Suspense>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Factory Details */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Chi tiết Nhà máy</CardTitle>
              <CardDescription>
                {selectedFactory ? selectedFactory.name : "Chọn nhà máy từ bản đồ"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedFactory ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Building2 className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{selectedFactory.name}</h3>
                        <p className="text-sm text-muted-foreground">{selectedFactory.code}</p>
                      </div>
                    </div>
                    {selectedFactory.address && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{selectedFactory.address}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-secondary/30">
                      <p className="text-2xl font-bold text-foreground">{selectedFactory.stats.total.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Tổng sản phẩm</p>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-500/10">
                      <p className="text-2xl font-bold text-emerald-500">{selectedFactory.stats.yieldRate.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">Yield Rate</p>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-500/10">
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-lg font-bold text-emerald-500">{selectedFactory.stats.ok.toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">OK</p>
                    </div>
                    <div className="p-3 rounded-lg bg-red-500/10">
                      <div className="flex items-center gap-1">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-lg font-bold text-red-500">{selectedFactory.stats.ng.toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">NG</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">Nhà xưởng ({selectedFactory.workshops.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedFactory.workshops.map((ws) => (
                        <div
                          key={ws.id}
                          className="p-3 rounded-lg border border-border hover:border-primary/50 cursor-pointer transition-colors"
                          onClick={() => setLocation(`/layout?workshopId=${ws.id}`)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Warehouse className="h-4 w-4 text-cyan-500" />
                              <span className="font-medium text-sm">{ws.name}</span>
                            </div>
                            <Badge variant={(ws.stats?.yieldRate ?? 0) >= 95 ? "default" : "secondary"}>
                              {(ws.stats?.yieldRate ?? 0).toFixed(1)}%
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{ws.code}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => setLocation(`/layout?factoryId=${selectedFactory.id}`)}
                  >
                    Xem Layout Chi tiết
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                  <div className="text-center">
                    <Building2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Chọn một nhà máy từ bản đồ</p>
                    <p className="text-sm">để xem thông tin chi tiết</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Factory List */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Danh sách Nhà máy</CardTitle>
            <CardDescription>Tổng quan hiệu suất các nhà máy trong tập đoàn</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {factoriesWithStats.map((factory) => (
                <div
                  key={factory.id}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedFactory?.id === factory.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => setSelectedFactory(factory)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-primary" />
                      <div>
                        <h3 className="font-medium text-foreground">{factory.name}</h3>
                        <p className="text-xs text-muted-foreground">{factory.code}</p>
                      </div>
                    </div>
                    <Badge
                      variant={factory.stats.yieldRate >= 95 ? "default" : factory.stats.yieldRate >= 90 ? "secondary" : "destructive"}
                    >
                      {factory.stats.yieldRate.toFixed(1)}%
                    </Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{factory.stats.total.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-emerald-500">{factory.stats.ok.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">OK</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-red-500">{factory.stats.ng.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">NG</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-amber-500">{factory.stats.ntf.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">NTF</p>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {factory.workshops.length} nhà xưởng
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
