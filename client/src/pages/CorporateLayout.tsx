import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  Minimize2,
  Box,
  Globe,
  Layers,
  Hand,
  Move,
  LocateFixed,
  GripVertical
} from "lucide-react";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { lazy, Suspense } from "react";

const Factory3DScene = lazy(() => import("@/components/Factory3DScene"));

import type { FactoryData, WorkshopData } from "@/types/factory";

export default function CorporateLayout() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [viewMode, setViewMode] = useState<"2D" | "3D" | "MAP">("2D");
  const [selectedFactory, setSelectedFactory] = useState<FactoryData | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Viewport pan state (for moving the entire view)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panStartOffset, setPanStartOffset] = useState({ x: 0, y: 0 });
  
  // Factory drag state (for moving individual factories)
  const [isDraggingFactory, setIsDraggingFactory] = useState(false);
  const [draggedFactoryId, setDraggedFactoryId] = useState<number | null>(null);
  const [factoryPositions, setFactoryPositions] = useState<Record<number, { x: number; y: number }>>({});
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [positionsInitialized, setPositionsInitialized] = useState(false);
  
  // SVG map pan/zoom state
  const [svgViewBox, setSvgViewBox] = useState({ x: 0, y: 0, w: 1000, h: 500 });
  const [isSvgPanning, setIsSvgPanning] = useState(false);
  const [svgPanStart, setSvgPanStart] = useState({ x: 0, y: 0 });
  const [svgPanStartViewBox, setSvgPanStartViewBox] = useState({ x: 0, y: 0, w: 1000, h: 500 });
  const svgRef = useRef<SVGSVGElement>(null);

  // Canvas dimensions
  const CANVAS_WIDTH = 2000;
  const CANVAS_HEIGHT = 1500;

  // Zoom with mouse wheel
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => {
      const newZoom = Math.max(0.3, Math.min(3, prev + delta));
      // Zoom toward cursor position
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const scale = newZoom / prev;
        setPanOffset(pan => ({
          x: mouseX - (mouseX - pan.x) * scale,
          y: mouseY - (mouseY - pan.y) * scale,
        }));
      }
      return newZoom;
    });
  }, []);

  // SVG wheel zoom
  const handleSvgWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const svg = svgRef.current;
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    setSvgViewBox(prev => {
      const svgMouseX = prev.x + (mouseX / rect.width) * prev.w;
      const svgMouseY = prev.y + (mouseY / rect.height) * prev.h;
      
      const newW = Math.max(200, Math.min(3000, prev.w * scaleFactor));
      const newH = Math.max(100, Math.min(1500, prev.h * scaleFactor));
      
      const newX = svgMouseX - (mouseX / rect.width) * newW;
      const newY = svgMouseY - (mouseY / rect.height) * newH;
      
      return { x: newX, y: newY, w: newW, h: newH };
    });
  }, []);

  // Attach wheel listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && viewMode === "2D") {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel, viewMode]);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg && viewMode === "MAP") {
      svg.addEventListener('wheel', handleSvgWheel, { passive: false });
      return () => svg.removeEventListener('wheel', handleSvgWheel);
    }
  }, [handleSvgWheel, viewMode]);

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };

  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const updateMapPositionMutation = trpc.factory.updateMapPosition.useMutation();

  // Initialize positions from database or default grid layout
  useEffect(() => {
    if (factories && !positionsInitialized) {
      const positions: Record<number, { x: number; y: number }> = {};
      const cols = Math.ceil(Math.sqrt(factories.length));
      
      factories.forEach((factory, index) => {
        const dbX = factory.mapPositionX ? parseFloat(factory.mapPositionX) : null;
        const dbY = factory.mapPositionY ? parseFloat(factory.mapPositionY) : null;
        
        if (dbX !== null && dbY !== null) {
          positions[factory.id] = { x: dbX * CANVAS_WIDTH, y: dbY * CANVAS_HEIGHT };
        } else {
          // Auto-arrange in grid
          const col = index % cols;
          const row = Math.floor(index / cols);
          positions[factory.id] = { 
            x: 150 + col * 350,
            y: 100 + row * 250 
          };
        }
      });
      setFactoryPositions(positions);
      setPositionsInitialized(true);
      
      // Auto-fit view to show all factories
      if (factories.length > 0) {
        setTimeout(() => fitAllInView(positions), 100);
      }
    }
  }, [factories, positionsInitialized]);

  type DashboardStats = {
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    yieldRate: number;
  };
  const { data: dashboardStats } = trpc.dashboard.getStats.useQuery({});
  const { data: yieldByFactory, isLoading: yieldLoading } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery({});

  // Aggregate stats per factory
  const factoriesWithStats = useMemo(() => {
    if (!factories) return [];
    
    return factories.map((factory) => {
      const factoryWorkshops = workshops?.filter(w => w.factoryId === factory.id) || [];
      const realStats = yieldByFactory?.find(s => s.factoryCode === factory.code);
      const stats = {
        total: realStats?.totalInspections ?? 0,
        ok: realStats?.okCount ?? 0,
        ng: realStats?.ngCount ?? 0,
        ntf: realStats?.ntfCount ?? 0,
        yieldRate: realStats ? parseFloat(realStats.yieldRate) : 0,
      };

      return {
        ...factory,
        stats,
        workshops: factoryWorkshops.map(ws => ({
          ...ws,
          stats: {
            total: factoryWorkshops.length > 0 ? Math.floor(stats.total / factoryWorkshops.length) : 0,
            ok: factoryWorkshops.length > 0 ? Math.floor(stats.ok / factoryWorkshops.length) : 0,
            ng: factoryWorkshops.length > 0 ? Math.floor(stats.ng / factoryWorkshops.length) : 0,
            ntf: factoryWorkshops.length > 0 ? Math.floor(stats.ntf / factoryWorkshops.length) : 0,
            yieldRate: stats.yieldRate,
          }
        }))
      } as FactoryData;
    });
  }, [factories, workshops, yieldByFactory]);

  // Fit all factories in view
  const fitAllInView = useCallback((positions?: Record<number, { x: number; y: number }>) => {
    const pos = positions || factoryPositions;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || Object.keys(pos).length === 0) return;
    
    const values = Object.values(pos);
    const minX = Math.min(...values.map(p => p.x)) - 200;
    const maxX = Math.max(...values.map(p => p.x)) + 400;
    const minY = Math.min(...values.map(p => p.y)) - 100;
    const maxY = Math.max(...values.map(p => p.y)) + 280;
    
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const viewWidth = container.clientWidth;
    const viewHeight = isFullscreen ? window.innerHeight - 200 : 600;
    
    const scaleX = viewWidth / contentWidth;
    const scaleY = viewHeight / contentHeight;
    const newZoom = Math.max(0.3, Math.min(2, Math.min(scaleX, scaleY) * 0.85));
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    setZoom(newZoom);
    setPanOffset({
      x: viewWidth / 2 - centerX * newZoom,
      y: viewHeight / 2 - centerY * newZoom,
    });
  }, [factoryPositions, isFullscreen]);

  // Draw 2D canvas
  useEffect(() => {
    if (viewMode !== "2D" || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = isFullscreen ? window.innerHeight - 120 : 600;
    }

    // Clear canvas
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(zoom, zoom);

    // Draw grid
    const gridSize = 50;
    ctx.strokeStyle = "rgba(6, 182, 212, 0.08)";
    ctx.lineWidth = 0.5;
    const startGridX = Math.floor(-panOffset.x / zoom / gridSize) * gridSize - gridSize;
    const startGridY = Math.floor(-panOffset.y / zoom / gridSize) * gridSize - gridSize;
    const endGridX = startGridX + (canvas.width / zoom) + gridSize * 2;
    const endGridY = startGridY + (canvas.height / zoom) + gridSize * 2;
    
    for (let x = startGridX; x < endGridX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, startGridY);
      ctx.lineTo(x, endGridY);
      ctx.stroke();
    }
    for (let y = startGridY; y < endGridY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(startGridX, y);
      ctx.lineTo(endGridX, y);
      ctx.stroke();
    }

    // Draw connection lines between factories (hub-spoke pattern)
    if (factoriesWithStats.length > 1) {
      const allPositions = factoriesWithStats.map(f => factoryPositions[f.id]).filter(Boolean);
      if (allPositions.length > 0) {
        const centerX = allPositions.reduce((sum, p) => sum + p.x + 140, 0) / allPositions.length;
        const centerY = allPositions.reduce((sum, p) => sum + p.y + 80, 0) / allPositions.length;
        
        factoriesWithStats.forEach((factory) => {
          const pos = factoryPositions[factory.id];
          if (!pos) return;
          
          ctx.strokeStyle = "rgba(6, 182, 212, 0.15)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(pos.x + 140, pos.y + 80);
          ctx.stroke();
          ctx.setLineDash([]);
        });
        
        // Corporate center node
        ctx.beginPath();
        ctx.arc(centerX, centerY, 20, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(6, 182, 212, 0.2)";
        ctx.fill();
        ctx.strokeStyle = "#06b6d4";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#06b6d4";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("HQ", centerX, centerY + 4);
        ctx.textAlign = "start";
      }
    }

    // Draw factory cards
    factoriesWithStats.forEach((factory) => {
      const pos = factoryPositions[factory.id];
      if (!pos) return;
      
      const boxWidth = 280;
      const boxHeight = 160;
      const x = pos.x;
      const y = pos.y;
      const isSelected = selectedFactory?.id === factory.id;
      const isBeingDragged = draggedFactoryId === factory.id;

      // Shadow
      if (isSelected || isBeingDragged) {
        ctx.shadowColor = "rgba(6, 182, 212, 0.4)";
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
      }

      // Factory box background
      const gradient = ctx.createLinearGradient(x, y, x, y + boxHeight);
      gradient.addColorStop(0, isSelected ? "rgba(6, 182, 212, 0.3)" : "rgba(30, 41, 59, 0.9)");
      gradient.addColorStop(1, isSelected ? "rgba(6, 182, 212, 0.1)" : "rgba(15, 23, 42, 0.9)");
      
      ctx.fillStyle = gradient;
      ctx.strokeStyle = isSelected ? "#06b6d4" : isBeingDragged ? "#f59e0b" : "rgba(6, 182, 212, 0.3)";
      ctx.lineWidth = isSelected ? 2 : 1;
      
      // Rounded rectangle
      const radius = 12;
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

      // Reset shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Drag handle dots
      ctx.fillStyle = "rgba(100, 116, 139, 0.5)";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x + boxWidth - 20 + i * 6, y + 12, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + boxWidth - 20 + i * 6, y + 19, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Factory icon
      ctx.fillStyle = "#06b6d4";
      ctx.font = "24px sans-serif";
      ctx.fillText("🏭", x + 15, y + 35);

      // Factory name
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(factory.name, x + 50, y + 30);

      // Factory code & location
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px sans-serif";
      const locationText = [factory.code, factory.region, factory.country].filter(Boolean).join(" · ");
      ctx.fillText(locationText, x + 50, y + 48);

      // Divider
      ctx.strokeStyle = "rgba(100, 116, 139, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 15, y + 60);
      ctx.lineTo(x + boxWidth - 15, y + 60);
      ctx.stroke();

      // Stats row
      const statsY = y + 85;
      
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(factory.stats.total.toLocaleString(), x + 20, statsY);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px sans-serif";
      ctx.fillText("Total", x + 20, statsY + 15);

      ctx.fillStyle = "#10b981";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(factory.stats.ok.toLocaleString(), x + 100, statsY);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px sans-serif";
      ctx.fillText("OK", x + 100, statsY + 15);

      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(factory.stats.ng.toLocaleString(), x + 160, statsY);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px sans-serif";
      ctx.fillText("NG", x + 160, statsY + 15);

      const yieldColor = factory.stats.yieldRate >= 95 ? "#10b981" : factory.stats.yieldRate >= 90 ? "#f59e0b" : "#ef4444";
      ctx.fillStyle = yieldColor;
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(`${factory.stats.yieldRate.toFixed(1)}%`, x + 210, statsY);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px sans-serif";
      ctx.fillText("Yield", x + 210, statsY + 15);

      // Yield indicator bar
      const barY = y + boxHeight - 30;
      const barWidth = boxWidth - 30;
      ctx.fillStyle = "rgba(100, 116, 139, 0.2)";
      ctx.beginPath();
      ctx.roundRect(x + 15, barY, barWidth, 6, 3);
      ctx.fill();
      ctx.fillStyle = yieldColor;
      ctx.beginPath();
      ctx.roundRect(x + 15, barY, barWidth * (factory.stats.yieldRate / 100), 6, 3);
      ctx.fill();

      // Workshop count
      ctx.fillStyle = "#64748b";
      ctx.font = "11px sans-serif";
      ctx.fillText(`${factory.workshops.length} ${t('corporate.workshops')}`, x + 20, y + boxHeight - 8);
    });

    ctx.restore();
    
    // HUD overlay (fixed position)
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    const hudRect = { x: 10, y: 10, w: 280, h: 48 };
    ctx.beginPath();
    ctx.roundRect(hudRect.x, hudRect.y, hudRect.w, hudRect.h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(6, 182, 212, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(t('corporate.corporateMapTitle'), 20, 33);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px sans-serif";
    ctx.fillText(`${factoriesWithStats.length} ${t('corporate.factories')} | ${workshops?.length || 0} ${t('corporate.workshops')}`, 20, 50);

    // Mini-map
    if (factoriesWithStats.length > 0) {
      const mmWidth = 150;
      const mmHeight = 80;
      const mmX = canvas.width - mmWidth - 15;
      const mmY = canvas.height - mmHeight - 15;
      
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.beginPath();
      ctx.roundRect(mmX, mmY, mmWidth, mmHeight, 6);
      ctx.fill();
      ctx.strokeStyle = "rgba(6, 182, 212, 0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      
      const allPos = Object.values(factoryPositions);
      if (allPos.length > 0) {
        const minFX = Math.min(...allPos.map(p => p.x)) - 100;
        const maxFX = Math.max(...allPos.map(p => p.x)) + 400;
        const minFY = Math.min(...allPos.map(p => p.y)) - 50;
        const maxFY = Math.max(...allPos.map(p => p.y)) + 250;
        
        const contentW = maxFX - minFX || 1;
        const contentH = maxFY - minFY || 1;
        const mmScale = Math.min((mmWidth - 10) / contentW, (mmHeight - 10) / contentH);
        
        factoriesWithStats.forEach(f => {
          const pos = factoryPositions[f.id];
          if (!pos) return;
          const dotX = mmX + 5 + (pos.x - minFX) * mmScale;
          const dotY = mmY + 5 + (pos.y - minFY) * mmScale;
          const yColor = f.stats.yieldRate >= 95 ? "#10b981" : f.stats.yieldRate >= 90 ? "#f59e0b" : "#ef4444";
          ctx.beginPath();
          ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
          ctx.fillStyle = yColor;
          ctx.fill();
        });
        
        // Viewport rectangle
        const vpX = mmX + 5 + (-panOffset.x / zoom - minFX) * mmScale;
        const vpY = mmY + 5 + (-panOffset.y / zoom - minFY) * mmScale;
        const vpW = (canvas.width / zoom) * mmScale;
        const vpH = (canvas.height / zoom) * mmScale;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(vpX, vpY, vpW, vpH);
      }
    }

  }, [viewMode, factoriesWithStats, selectedFactory, zoom, workshops?.length, factoryPositions, panOffset, t, isFullscreen, draggedFactoryId]);

  // Get factory at canvas mouse position (accounting for pan/zoom)
  const getFactoryAtPosition = useCallback((mouseX: number, mouseY: number) => {
    const worldX = (mouseX - panOffset.x) / zoom;
    const worldY = (mouseY - panOffset.y) / zoom;

    for (const factory of factoriesWithStats) {
      const pos = factoryPositions[factory.id];
      if (!pos) continue;
      const boxWidth = 280;
      const boxHeight = 160;
      if (worldX >= pos.x && worldX <= pos.x + boxWidth && worldY >= pos.y && worldY <= pos.y + boxHeight) {
        return factory;
      }
    }
    return null;
  }, [factoriesWithStats, factoryPositions, panOffset, zoom]);

  // Mouse down: start dragging factory or panning viewport
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factory = getFactoryAtPosition(mouseX, mouseY);
    
    if (factory) {
      setIsDraggingFactory(true);
      setDraggedFactoryId(factory.id);
      setSelectedFactory(factory);
      const pos = factoryPositions[factory.id];
      if (pos) {
        setDragOffset({
          x: (mouseX - panOffset.x) / zoom - pos.x,
          y: (mouseY - panOffset.y) / zoom - pos.y,
        });
      }
    } else {
      setIsPanning(true);
      setPanStart({ x: mouseX, y: mouseY });
      setPanStartOffset({ ...panOffset });
    }
  };

  // Mouse move: drag factory or pan viewport
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDraggingFactory && draggedFactoryId !== null) {
      const worldX = (mouseX - panOffset.x) / zoom - dragOffset.x;
      const worldY = (mouseY - panOffset.y) / zoom - dragOffset.y;
      setFactoryPositions(prev => ({
        ...prev,
        [draggedFactoryId]: { x: worldX, y: worldY }
      }));
    } else if (isPanning) {
      const dx = mouseX - panStart.x;
      const dy = mouseY - panStart.y;
      setPanOffset({
        x: panStartOffset.x + dx,
        y: panStartOffset.y + dy,
      });
    } else {
      const factory = getFactoryAtPosition(mouseX, mouseY);
      canvas.style.cursor = factory ? 'grab' : 'move';
    }
  };

  // Mouse up: stop dragging/panning
  const handleMouseUp = () => {
    if (isDraggingFactory && draggedFactoryId !== null) {
      const pos = factoryPositions[draggedFactoryId];
      if (pos) {
        updateMapPositionMutation.mutate({
          id: draggedFactoryId,
          mapPositionX: pos.x / CANVAS_WIDTH,
          mapPositionY: pos.y / CANVAS_HEIGHT,
        });
      }
    }
    setIsDraggingFactory(false);
    setDraggedFactoryId(null);
    setIsPanning(false);
  };

  // SVG map mouse handlers  
  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    setIsSvgPanning(true);
    setSvgPanStart({ x: e.clientX, y: e.clientY });
    setSvgPanStartViewBox({ ...svgViewBox });
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isSvgPanning || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = (e.clientX - svgPanStart.x) / rect.width * svgPanStartViewBox.w;
    const dy = (e.clientY - svgPanStart.y) / rect.height * svgPanStartViewBox.h;
    setSvgViewBox({
      ...svgPanStartViewBox,
      x: svgPanStartViewBox.x - dx,
      y: svgPanStartViewBox.y - dy,
    });
  };

  const handleSvgMouseUp = () => {
    setIsSvgPanning(false);
  };

  const resetSvgView = () => {
    setSvgViewBox({ x: 0, y: 0, w: 1000, h: 500 });
  };

  // Double-click to navigate to factory layout
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factory = getFactoryAtPosition(mouseX, mouseY);
    if (factory) {
      setSelectedFactory(factory);
      setLocation(`/layout?factoryId=${factory.id}`);
    } else {
      // Zoom in on double-click position
      const newZoom = Math.min(3, zoom * 1.5);
      const scale = newZoom / zoom;
      setPanOffset({
        x: mouseX - (mouseX - panOffset.x) * scale,
        y: mouseY - (mouseY - panOffset.y) * scale,
      });
      setZoom(newZoom);
    }
  };

  if (authLoading) {
    return (
      <DashboardLayout title={t('corporate.corporateLayout')} navItems={navItems} currentPath="/corporate-layout">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('corporate.corporateLayout')} navItems={navItems} currentPath="/corporate-layout">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('corporate.corporateVisualization')}</h1>
            <p className="text-muted-foreground">{t('corporate.mapOverview')}</p>
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
                  <p className="text-sm text-muted-foreground">{t('corporate.factory')}</p>
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
                  <p className="text-sm text-muted-foreground">{t('corporate.workshop')}</p>
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
                  <p className="text-sm text-muted-foreground">{t('corporate.avgYieldRate')}</p>
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
                  <p className="text-sm text-muted-foreground">{t('corporate.totalProducts')}</p>
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
                {t('corporate.factoryMap')}
              </CardTitle>
              <CardDescription>{t('corporate.clickFactoryForDetails')}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Map Controls Toolbar */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1 border rounded-lg p-1 bg-background/80">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => setZoom(z => Math.max(0.3, z - 0.15))} className="h-8 w-8 p-0">
                        <ZoomOut className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Zoom out</TooltipContent>
                  </Tooltip>
                  <span className="text-xs font-mono text-muted-foreground w-12 text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => setZoom(z => Math.min(3, z + 0.15))} className="h-8 w-8 p-0">
                        <ZoomIn className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Zoom in</TooltipContent>
                  </Tooltip>
                  <div className="w-px h-5 bg-border mx-1" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => fitAllInView()} className="h-8 w-8 p-0">
                        <LocateFixed className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('corporate.fitAll', 'Fit all factories')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} className="h-8 w-8 p-0">
                        <Maximize2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('corporate.resetView', 'Reset view')}</TooltipContent>
                  </Tooltip>
                </div>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={isFullscreen ? "default" : "outline"}
                      size="sm"
                      onClick={toggleFullscreen}
                      className="h-8 w-8 p-0"
                    >
                      {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</TooltipContent>
                </Tooltip>
              </div>

              {/* Help text */}
              <div className="flex items-center gap-4 mb-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Hand className="h-3 w-3" /> {t('corporate.dragToPan', 'Drag to pan')}</span>
                <span className="flex items-center gap-1"><Move className="h-3 w-3" /> {t('corporate.dragFactoryToMove', 'Drag factory to move')}</span>
                <span className="flex items-center gap-1"><ZoomIn className="h-3 w-3" /> {t('corporate.scrollToZoom', 'Scroll to zoom')}</span>
              </div>

              <div ref={containerRef} className={`relative border rounded-lg overflow-hidden bg-background/50 transition-all ${isFullscreen ? 'fixed inset-4 z-50 bg-background' : ''}`}>
                {isFullscreen && (
                  <Button variant="outline" size="sm" onClick={toggleFullscreen} className="absolute top-2 right-2 z-10">
                    <Minimize2 className="h-4 w-4 mr-1" /> ESC
                  </Button>
                )}
                
                {viewMode === "2D" ? (
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onDoubleClick={handleDoubleClick}
                    className="w-full select-none"
                    style={{ 
                      minHeight: isFullscreen ? 'calc(100vh - 140px)' : 600,
                      cursor: isDraggingFactory ? 'grabbing' : isPanning ? 'grabbing' : 'default'
                    }}
                  />
                ) : viewMode === "MAP" ? (
                  <div className="relative w-full" style={{ minHeight: isFullscreen ? 'calc(100vh - 140px)' : 600 }}>
                    <div className="absolute inset-0 bg-gradient-to-b from-slate-900 to-slate-800 rounded-lg overflow-hidden">
                      {/* SVG Map Controls */}
                      <div className="absolute top-3 left-3 z-10 flex gap-1">
                        <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => {
                          setSvgViewBox(prev => ({ ...prev, w: prev.w * 0.8, h: prev.h * 0.8 }));
                        }}>
                          <ZoomIn className="h-3 w-3" />
                        </Button>
                        <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => {
                          setSvgViewBox(prev => ({ ...prev, w: prev.w * 1.2, h: prev.h * 1.2 }));
                        }}>
                          <ZoomOut className="h-3 w-3" />
                        </Button>
                        <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={resetSvgView}>
                          <LocateFixed className="h-3 w-3" />
                        </Button>
                      </div>

                      <svg 
                        ref={svgRef}
                        viewBox={`${svgViewBox.x} ${svgViewBox.y} ${svgViewBox.w} ${svgViewBox.h}`} 
                        className="w-full h-full select-none" 
                        preserveAspectRatio="xMidYMid meet"
                        onMouseDown={handleSvgMouseDown}
                        onMouseMove={handleSvgMouseMove}
                        onMouseUp={handleSvgMouseUp}
                        onMouseLeave={handleSvgMouseUp}
                        style={{ cursor: isSvgPanning ? 'grabbing' : 'grab' }}
                      >
                        <rect fill="#0f172a" x={svgViewBox.x - 500} y={svgViewBox.y - 500} width={svgViewBox.w + 1000} height={svgViewBox.h + 1000} />
                        
                        {/* Continents */}
                        <g fill="#1e293b" stroke="#334155" strokeWidth="0.5">
                          <path d="M50,80 L200,60 L280,100 L300,180 L250,220 L200,200 L150,220 L100,180 L50,150 Z" />
                          <path d="M180,250 L220,230 L260,280 L280,350 L250,420 L200,450 L160,400 L170,320 Z" />
                          <path d="M420,80 L500,60 L520,100 L500,140 L450,150 L420,120 Z" />
                          <path d="M420,180 L500,160 L540,200 L560,280 L520,380 L460,400 L420,350 L400,250 Z" />
                          <path d="M520,60 L700,40 L850,80 L900,150 L880,220 L800,250 L700,230 L600,200 L550,150 L520,100 Z" />
                          <path d="M700,250 L780,230 L820,280 L800,320 L750,340 L700,300 Z" />
                          <path d="M780,350 L880,330 L920,380 L900,430 L820,450 L780,400 Z" />
                        </g>
                        
                        {/* Grid */}
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
                          const defaultPositions = [
                            { x: 750, y: 280 },
                            { x: 800, y: 150 },
                            { x: 480, y: 120 },
                            { x: 200, y: 150 },
                            { x: 700, y: 200 },
                            { x: 600, y: 100 },
                          ];
                          const pos = defaultPositions[index % defaultPositions.length];
                          const isSelected = selectedFactory?.id === factory.id;
                          const yieldColor = factory.stats.yieldRate >= 95 ? "#10b981" : factory.stats.yieldRate >= 90 ? "#f59e0b" : "#ef4444";
                          
                          return (
                            <g key={factory.id} onClick={(e) => { e.stopPropagation(); setSelectedFactory(factory); }} style={{ cursor: "pointer" }}>
                              {isSelected && (
                                <circle cx={pos.x} cy={pos.y} r="25" fill={yieldColor} opacity="0.3">
                                  <animate attributeName="r" values="20;35;20" dur="2s" repeatCount="indefinite" />
                                  <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite" />
                                </circle>
                              )}
                              <circle cx={pos.x} cy={pos.y} r={isSelected ? 15 : 12} fill={yieldColor} stroke="#fff" strokeWidth="2" />
                              <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold">
                                {factory.code.substring(0, 2)}
                              </text>
                              <rect x={pos.x - 55} y={pos.y + 20} width="110" height="40" rx="6" fill="rgba(0,0,0,0.85)" stroke={yieldColor} strokeWidth="0.5" />
                              <text x={pos.x} y={pos.y + 35} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">
                                {factory.name.length > 14 ? factory.name.substring(0, 14) + "..." : factory.name}
                              </text>
                              <text x={pos.x} y={pos.y + 50} textAnchor="middle" fill={yieldColor} fontSize="9">
                                Yield: {factory.stats.yieldRate.toFixed(1)}%
                              </text>
                            </g>
                          );
                        })}
                        
                        {/* Legend */}
                        <g transform="translate(20, 420)">
                          <rect x="0" y="0" width="150" height="60" rx="4" fill="rgba(0,0,0,0.7)" />
                          <text x="10" y="18" fill="#fff" fontSize="11" fontWeight="bold">{t('corporate.legend')}</text>
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

          {/* Factory Details Panel */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{t('corporate.factoryDetails')}</CardTitle>
              <CardDescription>
                {selectedFactory ? selectedFactory.name : t('corporate.selectFactoryFromMap')}
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
                    {(selectedFactory.region || selectedFactory.country) && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                        <Globe className="h-4 w-4 shrink-0" />
                        <span>{[selectedFactory.region, selectedFactory.country].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-secondary/30">
                      <p className="text-2xl font-bold text-foreground">{selectedFactory.stats.total.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{t('corporate.totalProducts')}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-500/10">
                      <p className="text-2xl font-bold text-emerald-500">{selectedFactory.stats.yieldRate.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">{t('corporate.yieldRate')}</p>
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

                  {/* Yield bar */}
                  <div className="px-1">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t('corporate.yieldRate')}</span>
                      <span className={
                        selectedFactory.stats.yieldRate >= 95 ? "text-emerald-500" : 
                        selectedFactory.stats.yieldRate >= 90 ? "text-amber-500" : "text-red-500"
                      }>
                        {selectedFactory.stats.yieldRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${
                          selectedFactory.stats.yieldRate >= 95 ? "bg-emerald-500" : 
                          selectedFactory.stats.yieldRate >= 90 ? "bg-amber-500" : "bg-red-500"
                        }`}
                        style={{ width: `${selectedFactory.stats.yieldRate}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">{t('corporate.workshops')} ({selectedFactory.workshops.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedFactory.workshops.map((ws) => (
                        <div
                          key={ws.id}
                          className="p-3 rounded-lg border border-border hover:border-primary/50 cursor-pointer transition-colors group"
                          onClick={() => setLocation(`/layout?workshopId=${ws.id}`)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Warehouse className="h-4 w-4 text-cyan-500" />
                              <span className="font-medium text-sm group-hover:text-primary transition-colors">{ws.name}</span>
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
                    {t('corporate.viewDetailedLayout')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                  <div className="text-center">
                    <Building2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{t('corporate.selectAFactoryFromMap')}</p>
                    <p className="text-sm">{t('corporate.toViewDetails')}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Factory List */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">{t('corporate.factoryList')}</CardTitle>
            <CardDescription>{t('corporate.factoryListDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {factoriesWithStats.map((factory) => (
                <div
                  key={factory.id}
                  className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                    selectedFactory?.id === factory.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => {
                    setSelectedFactory(factory);
                    if (viewMode === "2D") {
                      const pos = factoryPositions[factory.id];
                      const container = containerRef.current;
                      if (pos && container) {
                        setPanOffset({
                          x: container.clientWidth / 2 - pos.x * zoom - 140 * zoom,
                          y: 300 - pos.y * zoom - 80 * zoom,
                        });
                      }
                    }
                  }}
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
                  {/* Yield mini bar */}
                  <div className="mt-3">
                    <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          factory.stats.yieldRate >= 95 ? "bg-emerald-500" : 
                          factory.stats.yieldRate >= 90 ? "bg-amber-500" : "bg-red-500"
                        }`}
                        style={{ width: `${factory.stats.yieldRate}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground flex justify-between">
                    <span>{factory.workshops.length} {t('corporate.workshops')}</span>
                    {factory.address && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {factory.address.length > 20 ? factory.address.substring(0, 20) + "..." : factory.address}
                      </span>
                    )}
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
