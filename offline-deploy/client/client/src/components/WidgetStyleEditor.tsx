import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Palette, Sparkles, RotateCcw, Check } from 'lucide-react';
import { toast } from 'sonner';

// Preset color themes
export const WIDGET_COLOR_THEMES = {
  default: {
    name: 'Mặc định',
    background: 'hsl(var(--card))',
    border: 'hsl(var(--border))',
    headerBg: 'transparent',
    headerText: 'hsl(var(--card-foreground))',
    accentColor: 'hsl(var(--primary))',
  },
  ocean: {
    name: 'Đại dương',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    border: '#667eea',
    headerBg: 'rgba(255,255,255,0.1)',
    headerText: '#ffffff',
    accentColor: '#a5b4fc',
  },
  sunset: {
    name: 'Hoàng hôn',
    background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    border: '#f5576c',
    headerBg: 'rgba(255,255,255,0.1)',
    headerText: '#ffffff',
    accentColor: '#fda4af',
  },
  forest: {
    name: 'Rừng xanh',
    background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    border: '#11998e',
    headerBg: 'rgba(255,255,255,0.1)',
    headerText: '#ffffff',
    accentColor: '#86efac',
  },
  midnight: {
    name: 'Nửa đêm',
    background: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
    border: '#414345',
    headerBg: 'rgba(255,255,255,0.05)',
    headerText: '#e5e7eb',
    accentColor: '#9ca3af',
  },
  coral: {
    name: 'San hô',
    background: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
    border: '#ff9a9e',
    headerBg: 'rgba(0,0,0,0.05)',
    headerText: '#1f2937',
    accentColor: '#fb7185',
  },
  aurora: {
    name: 'Cực quang',
    background: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    border: '#a8edea',
    headerBg: 'rgba(0,0,0,0.05)',
    headerText: '#1f2937',
    accentColor: '#5eead4',
  },
  steel: {
    name: 'Thép',
    background: 'linear-gradient(135deg, #bdc3c7 0%, #2c3e50 100%)',
    border: '#2c3e50',
    headerBg: 'rgba(255,255,255,0.1)',
    headerText: '#ffffff',
    accentColor: '#94a3b8',
  },
};

export type WidgetThemeKey = keyof typeof WIDGET_COLOR_THEMES;

export interface WidgetStyle {
  theme: WidgetThemeKey;
  borderRadius: number;
  shadow: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  opacity: number;
  showBorder: boolean;
  customBackground?: string;
  customBorder?: string;
}

export const DEFAULT_WIDGET_STYLE: WidgetStyle = {
  theme: 'default',
  borderRadius: 8,
  shadow: 'sm',
  opacity: 100,
  showBorder: true,
};

interface WidgetStyleEditorProps {
  widgetId: string;
  widgetName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStyle: WidgetStyle;
  onStyleChange: (style: WidgetStyle) => void;
}

export function WidgetStyleEditor({
  widgetId,
  widgetName,
  open,
  onOpenChange,
  currentStyle,
  onStyleChange,
}: WidgetStyleEditorProps) {
  const [style, setStyle] = useState<WidgetStyle>(currentStyle);
  const [previewStyle, setPreviewStyle] = useState<WidgetStyle>(currentStyle);
  const { t } = useTranslation();

  useEffect(() => {
    setStyle(currentStyle);
    setPreviewStyle(currentStyle);
  }, [currentStyle, open]);

  const handleThemeSelect = (theme: WidgetThemeKey) => {
    const newStyle = { ...style, theme };
    setStyle(newStyle);
    setPreviewStyle(newStyle);
  };

  const handleStyleChange = (key: keyof WidgetStyle, value: any) => {
    const newStyle = { ...style, [key]: value };
    setStyle(newStyle);
    setPreviewStyle(newStyle);
  };

  const handleApply = () => {
    onStyleChange(style);
    toast.success(t('dashboard.styleApplied'));
    onOpenChange(false);
  };

  const handleReset = () => {
    setStyle(DEFAULT_WIDGET_STYLE);
    setPreviewStyle(DEFAULT_WIDGET_STYLE);
  };

  const getPreviewStyles = (): React.CSSProperties => {
    const theme = WIDGET_COLOR_THEMES[previewStyle.theme];
    const shadowMap = {
      none: 'none',
      sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
      lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
      xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
    };

    return {
      background: previewStyle.customBackground || theme.background,
      borderRadius: `${previewStyle.borderRadius}px`,
      boxShadow: shadowMap[previewStyle.shadow],
      opacity: previewStyle.opacity / 100,
      border: previewStyle.showBorder 
        ? `1px solid ${previewStyle.customBorder || theme.border}` 
        : 'none',
    };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            {t('dashboard.customizeStyle')}: {widgetName}
          </DialogTitle>
          <DialogDescription>
            {t('dashboard.customizeStyleDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          {/* Preview */}
          <div className="space-y-4">
            <Label className="text-sm font-medium">{t('common.preview')}</Label>
            <div 
              className="h-48 p-4 transition-all duration-300"
              style={getPreviewStyles()}
            >
              <div 
                className="text-sm font-semibold mb-2"
                style={{ color: WIDGET_COLOR_THEMES[previewStyle.theme].headerText }}
              >
                {widgetName}
              </div>
              <div 
                className="text-xs opacity-70"
                style={{ color: WIDGET_COLOR_THEMES[previewStyle.theme].headerText }}
              >
                Nội dung widget sẽ hiển thị ở đây...
              </div>
              <div className="mt-4 flex gap-2">
                <div 
                  className="h-8 w-16 rounded"
                  style={{ backgroundColor: WIDGET_COLOR_THEMES[previewStyle.theme].accentColor }}
                />
                <div 
                  className="h-8 w-24 rounded opacity-50"
                  style={{ backgroundColor: WIDGET_COLOR_THEMES[previewStyle.theme].accentColor }}
                />
              </div>
            </div>
          </div>

          {/* Settings */}
          <div className="space-y-4">
            <Tabs defaultValue="themes">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="themes">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Themes
                </TabsTrigger>
                <TabsTrigger value="advanced">
                  <Palette className="h-4 w-4 mr-2" />
                  {t('dashboard.advanced')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="themes" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(WIDGET_COLOR_THEMES) as WidgetThemeKey[]).map((key) => {
                    const theme = WIDGET_COLOR_THEMES[key];
                    return (
                      <button
                        key={key}
                        onClick={() => handleThemeSelect(key)}
                        className={`relative p-3 rounded-lg border-2 transition-all ${
                          style.theme === key 
                            ? 'border-primary ring-2 ring-primary/20' 
                            : 'border-transparent hover:border-muted-foreground/20'
                        }`}
                        style={{ background: theme.background }}
                      >
                        <span 
                          className="text-xs font-medium"
                          style={{ color: theme.headerText }}
                        >
                          {theme.name}
                        </span>
                        {style.theme === key && (
                          <Check className="absolute top-1 right-1 h-4 w-4 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4 mt-4">
                {/* Border Radius */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('dashboard.borderRadius')}</Label>
                    <Badge variant="secondary">{style.borderRadius}px</Badge>
                  </div>
                  <Slider
                    value={[style.borderRadius]}
                    onValueChange={([value]) => handleStyleChange('borderRadius', value)}
                    min={0}
                    max={24}
                    step={2}
                  />
                </div>

                {/* Shadow */}
                <div className="space-y-2">
                  <Label className="text-sm">{t('dashboard.shadow')}</Label>
                  <div className="flex gap-2">
                    {(['none', 'sm', 'md', 'lg', 'xl'] as const).map((shadow) => (
                      <Button
                        key={shadow}
                        variant={style.shadow === shadow ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleStyleChange('shadow', shadow)}
                      >
                        {shadow === 'none' ? t('common.none') : shadow.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Opacity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('dashboard.opacity')}</Label>
                    <Badge variant="secondary">{style.opacity}%</Badge>
                  </div>
                  <Slider
                    value={[style.opacity]}
                    onValueChange={([value]) => handleStyleChange('opacity', value)}
                    min={50}
                    max={100}
                    step={5}
                  />
                </div>

                {/* Show Border */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm">{t('dashboard.showBorder')}</Label>
                  <Switch
                    checked={style.showBorder}
                    onCheckedChange={(checked) => handleStyleChange('showBorder', checked)}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <DialogFooter className="flex justify-between">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-2" />
            {t('common.reset')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleApply}>
              <Check className="h-4 w-4 mr-2" />
              {t('common.apply')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper function to get CSS styles from WidgetStyle
export function getWidgetCSSStyles(style: WidgetStyle): React.CSSProperties {
  const theme = WIDGET_COLOR_THEMES[style.theme];
  const shadowMap = {
    none: 'none',
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  };

  return {
    background: style.customBackground || theme.background,
    borderRadius: `${style.borderRadius}px`,
    boxShadow: shadowMap[style.shadow],
    opacity: style.opacity / 100,
    border: style.showBorder 
      ? `1px solid ${style.customBorder || theme.border}` 
      : 'none',
  };
}

// Helper function to get header text color
export function getWidgetHeaderColor(style: WidgetStyle): string {
  return WIDGET_COLOR_THEMES[style.theme].headerText;
}

// Storage key for widget styles
const WIDGET_STYLES_STORAGE_KEY = 'dashboard-widget-styles';

// Save widget styles to localStorage
export function saveWidgetStyles(styles: Record<string, WidgetStyle>) {
  localStorage.setItem(WIDGET_STYLES_STORAGE_KEY, JSON.stringify(styles));
}

// Load widget styles from localStorage
export function loadWidgetStyles(): Record<string, WidgetStyle> {
  try {
    const stored = localStorage.getItem(WIDGET_STYLES_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load widget styles:', e);
  }
  return {};
}

// Get style for a specific widget
export function getWidgetStyle(widgetId: string): WidgetStyle {
  const styles = loadWidgetStyles();
  return styles[widgetId] || DEFAULT_WIDGET_STYLE;
}

// Set style for a specific widget
export function setWidgetStyle(widgetId: string, style: WidgetStyle) {
  const styles = loadWidgetStyles();
  styles[widgetId] = style;
  saveWidgetStyles(styles);
}

export default WidgetStyleEditor;
