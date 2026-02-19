/**
 * CustomDashboardViewer - Renders a selected custom dashboard's widgets.
 * This is the "view mode" used on the main Dashboard page.
 * For creating/managing dashboards, see EmbeddedCustomDashboard in Settings.
 */
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import DashboardWidgetRenderer from "./DashboardWidgetRenderer";
import type { WidgetConfig } from "./DashboardWidgetLibrary";
import {
  LayoutDashboard,
  Settings,
  Star,
  Globe,
  RefreshCw,
  Loader2,
  Plus,
  Maximize2,
  Minimize2,
  ChevronRight,
} from "lucide-react";

const THEME_STYLES: Record<string, { bg: string; border: string }> = {
  default: { bg: "", border: "" },
  dark: { bg: "bg-slate-900", border: "border-slate-700" },
  ocean: { bg: "bg-sky-50 dark:bg-sky-950", border: "border-sky-200 dark:border-sky-800" },
  forest: { bg: "bg-green-50 dark:bg-green-950", border: "border-green-200 dark:border-green-800" },
  sunset: { bg: "bg-orange-50 dark:bg-orange-950", border: "border-orange-200 dark:border-orange-800" },
  purple: { bg: "bg-purple-50 dark:bg-purple-950", border: "border-purple-200 dark:border-purple-800" },
};

const SIZE_CLASSES: Record<string, string> = {
  small: "col-span-1",
  medium: "col-span-2",
  large: "col-span-3",
  full: "col-span-4",
};

const SIZE_HEIGHTS: Record<string, string> = {
  small: "h-[180px]",
  medium: "h-[240px]",
  large: "h-[300px]",
  full: "h-[320px]",
};

export default function CustomDashboardViewer() {
  const { t } = useTranslation();
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fetch user's dashboards
  const myDashboardsQuery = trpc.dashboardWidget.listCustomDashboards.useQuery();
  const publicDashboardsQuery = trpc.dashboardWidget.listPublicDashboards.useQuery();

  const allDashboards = useMemo(() => {
    const mine = myDashboardsQuery.data || [];
    const pub = (publicDashboardsQuery.data || []).filter(
      (p: any) => !mine.some((m: any) => m.id === p.id)
    );
    return [...mine, ...pub];
  }, [myDashboardsQuery.data, publicDashboardsQuery.data]);

  // Favorites first, then by name
  const sortedDashboards = useMemo(() => {
    return [...allDashboards].sort((a: any, b: any) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [allDashboards]);

  // Auto-select first favorite or first dashboard on load
  useEffect(() => {
    if (!selectedDashboardId && sortedDashboards.length > 0) {
      const fav = sortedDashboards.find((d: any) => d.isFavorite);
      setSelectedDashboardId(String((fav || sortedDashboards[0]).id));
    }
  }, [sortedDashboards, selectedDashboardId]);

  const selectedDashboard = useMemo(() => {
    return allDashboards.find((d: any) => String(d.id) === selectedDashboardId);
  }, [allDashboards, selectedDashboardId]) as any;

  const widgets: WidgetConfig[] = useMemo(() => {
    if (!selectedDashboard?.widgets) return [];
    return Array.isArray(selectedDashboard.widgets) ? selectedDashboard.widgets : [];
  }, [selectedDashboard]);

  const gridCols = selectedDashboard?.gridCols || 4;
  const themePreset = selectedDashboard?.themePreset || "default";
  const autoRefreshInterval = selectedDashboard?.autoRefreshInterval || 0;
  const themeStyle = THEME_STYLES[themePreset] || THEME_STYLES.default;

  const isLoading = myDashboardsQuery.isLoading || publicDashboardsQuery.isLoading;

  // Empty state - no dashboards created
  if (!isLoading && allDashboards.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <LayoutDashboard className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">{t('dashboard.noCustomDashboard')}</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t('dashboard.createCustomDashboardHint')}
            </p>
          </div>
          <Link href="/settings?tab=custom-dashboard">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              {t('dashboard.createNewDashboard')}
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`space-y-4 ${isFullscreen ? "fixed inset-0 z-50 bg-background p-6 overflow-auto" : ""}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Dashboard selector */}
          <Select
            value={selectedDashboardId}
            onValueChange={setSelectedDashboardId}
          >
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder={t('dashboard.selectDashboard')} />
            </SelectTrigger>
            <SelectContent>
              {sortedDashboards.map((d: any) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  <span className="flex items-center gap-2">
                    {d.isFavorite && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                    {d.isPublic && <Globe className="h-3 w-3 text-blue-500" />}
                    {d.name}
                    <Badge variant="secondary" className="text-[10px] h-4 ml-1">
                      {(d.widgets as any[])?.length || 0} widgets
                    </Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Dashboard info */}
          {selectedDashboard && (
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
              {selectedDashboard.description && (
                <span className="truncate max-w-[200px]">{selectedDashboard.description}</span>
              )}
              {autoRefreshInterval > 0 && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <RefreshCw className="h-3 w-3" />
                  {autoRefreshInterval}s
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Refresh */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              myDashboardsQuery.refetch();
              publicDashboardsQuery.refetch();
            }}
            disabled={isLoading}
            className="h-9 w-9"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>

          {/* Fullscreen toggle */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="h-9 w-9"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>

          {/* Link to settings */}
          <Link href="/settings?tab=custom-dashboard">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.manage')}</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* No dashboard selected */}
      {!isLoading && !selectedDashboard && allDashboards.length > 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <LayoutDashboard className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">{t('dashboard.selectDashboardToDisplay')}</p>
          </CardContent>
        </Card>
      )}

      {/* Selected dashboard with no widgets */}
      {!isLoading && selectedDashboard && widgets.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <LayoutDashboard className="h-10 w-10 text-muted-foreground" />
            <div className="text-center space-y-1">
              <p className="font-medium">{t('dashboard.dashboardNoWidgets', { name: selectedDashboard.name })}</p>
              <p className="text-sm text-muted-foreground">{t('dashboard.addWidgetInSettings')}</p>
            </div>
            <Link href="/settings?tab=custom-dashboard">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Settings className="h-4 w-4" />
                {t('dashboard.editDashboard')}
                <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Render widgets grid */}
      {!isLoading && selectedDashboard && widgets.length > 0 && (
        <div
          className={`grid gap-4 ${themeStyle.bg} ${themeStyle.border} ${themeStyle.bg ? "p-4 rounded-lg border" : ""}`}
          style={{
            gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          }}
        >
          {widgets.map((widget) => {
            const sizeClass = SIZE_CLASSES[widget.size] || SIZE_CLASSES.medium;
            const heightClass = SIZE_HEIGHTS[widget.size] || SIZE_HEIGHTS.medium;

            return (
              <Card
                key={widget.id}
                className={`${sizeClass} overflow-hidden`}
              >
                <CardContent className={`p-3 ${heightClass}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium truncate">{widget.title}</h4>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {widget.type}
                    </Badge>
                  </div>
                  <div className="h-[calc(100%-28px)]">
                    <DashboardWidgetRenderer
                      type={widget.type}
                      config={widget.config || {}}
                      size={widget.size}
                      autoRefreshInterval={autoRefreshInterval}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Fullscreen close hint */}
      {isFullscreen && (
        <div className="fixed bottom-4 right-4 z-50">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsFullscreen(false)}
            className="gap-1.5 shadow-lg"
          >
            <Minimize2 className="h-4 w-4" />
            {t('common.exitFullscreen')}
          </Button>
        </div>
      )}
    </div>
  );
}
