import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Palette,
  Save,
  Trash2,
  Lock,
  Users,
  Eye,
  Check,
  Copy,
  Download,
  Upload,
  FileJson,
  Share2,
  UserPlus,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Widget style interface
export interface WidgetStyle {
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  accentColor: string;
  borderRadius: string;
  shadow: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  opacity: string;
  /**
   * 'theme' (default) → cards follow the app's dark/light theme via tokens (no forced
   * bg/text/border colours). 'custom' → the user explicitly picked colours, which
   * override the theme. Legacy saved styles (no mode) are treated as 'theme'.
   */
  mode?: 'theme' | 'custom';
}

// Default style
export const DEFAULT_WIDGET_STYLE: WidgetStyle = {
  backgroundColor: '#ffffff',
  textColor: '#1f2937',
  borderColor: '#e5e7eb',
  accentColor: '#3b82f6',
  borderRadius: '0.5rem',
  shadow: 'sm',
  opacity: '1.00',
  mode: 'theme', // default follows the app theme (light/dark), not a forced white
};

// Shadow options
const SHADOW_OPTIONS = [
  { value: 'none', label: 'None', class: 'shadow-none' },
  { value: 'sm', label: 'Small', class: 'shadow-sm' },
  { value: 'md', label: 'Medium', class: 'shadow-md' },
  { value: 'lg', label: 'Large', class: 'shadow-lg' },
  { value: 'xl', label: 'Extra Large', class: 'shadow-xl' },
];

// Border radius options
const BORDER_RADIUS_OPTIONS = [
  { value: '0', label: 'None' },
  { value: '0.25rem', label: 'Small' },
  { value: '0.5rem', label: 'Medium' },
  { value: '0.75rem', label: 'Large' },
  { value: '1rem', label: 'Extra Large' },
  { value: '1.5rem', label: 'Full' },
];

// Built-in preset themes
const BUILT_IN_THEMES: Array<{ name: string; style: WidgetStyle }> = [
  {
    name: 'Light Default',
    style: DEFAULT_WIDGET_STYLE,
  },
  {
    name: 'Dark Mode',
    style: {
      backgroundColor: '#1f2937',
      textColor: '#f9fafb',
      borderColor: '#374151',
      accentColor: '#60a5fa',
      borderRadius: '0.5rem',
      shadow: 'md',
      opacity: '1.00',
    },
  },
  {
    name: 'Ocean Blue',
    style: {
      backgroundColor: '#eff6ff',
      textColor: '#1e40af',
      borderColor: '#bfdbfe',
      accentColor: '#2563eb',
      borderRadius: '0.75rem',
      shadow: 'sm',
      opacity: '1.00',
    },
  },
  {
    name: 'Forest Green',
    style: {
      backgroundColor: '#f0fdf4',
      textColor: '#166534',
      borderColor: '#bbf7d0',
      accentColor: '#16a34a',
      borderRadius: '0.5rem',
      shadow: 'sm',
      opacity: '1.00',
    },
  },
  {
    name: 'Sunset Orange',
    style: {
      backgroundColor: '#fff7ed',
      textColor: '#9a3412',
      borderColor: '#fed7aa',
      accentColor: '#ea580c',
      borderRadius: '0.75rem',
      shadow: 'md',
      opacity: '1.00',
    },
  },
  {
    name: 'Purple Dream',
    style: {
      backgroundColor: '#faf5ff',
      textColor: '#6b21a8',
      borderColor: '#e9d5ff',
      accentColor: '#9333ea',
      borderRadius: '1rem',
      shadow: 'lg',
      opacity: '1.00',
    },
  },
];

// Style preview component
function StylePreview({ style, className }: { style: WidgetStyle; className?: string }) {
  const shadowClass = SHADOW_OPTIONS.find(s => s.value === style.shadow)?.class || '';
  
  return (
    <div
      className={cn('p-4 border transition-all', shadowClass, className)}
      style={{
        backgroundColor: style.backgroundColor,
        color: style.textColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        opacity: parseFloat(style.opacity),
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: style.accentColor }} />
        <span className="font-semibold text-sm">Widget Title</span>
      </div>
      <div className="text-xs opacity-70">Sample content preview</div>
      <div className="mt-2 flex gap-1">
        <div className="h-1 flex-1 rounded" style={{ backgroundColor: style.accentColor, opacity: 0.3 }} />
        <div className="h-1 w-1/3 rounded" style={{ backgroundColor: style.accentColor }} />
      </div>
    </div>
  );
}

// Color picker component
function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <Label className="w-28 text-sm">{label}</Label>
      <div className="flex items-center gap-2 flex-1">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded cursor-pointer border" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 font-mono text-sm" placeholder="#000000" />
      </div>
    </div>
  );
}

// Main component
export function WidgetStylePresetManager({ currentStyle, onStyleChange }: { currentStyle?: WidgetStyle; onStyleChange?: (style: WidgetStyle) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('presets');
  const [editingStyle, setEditingStyle] = useState<WidgetStyle>(currentStyle || DEFAULT_WIDGET_STYLE);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  const { data: savedPresets, refetch: refetchPresets } = trpc.dashboardWidget.getStylePresets.useQuery(undefined, { enabled: !!user });

  const createPresetMutation = trpc.dashboardWidget.createStylePreset.useMutation({
    onSuccess: () => {
      toast.success('Preset saved successfully');
      setSaveDialogOpen(false);
      setPresetName('');
      setPresetDescription('');
      refetchPresets();
    },
    onError: (error) => toast.error(error.message || 'Failed to save preset'),
  });

  const deletePresetMutation = trpc.dashboardWidget.deleteStylePreset.useMutation({
    onSuccess: () => { toast.success('Preset deleted'); refetchPresets(); },
    onError: (error) => toast.error(error.message || 'Failed to delete preset'),
  });

  const applyPresetMutation = trpc.dashboardWidget.applyStylePreset.useMutation();

  // Import/Export state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importPresetMutation = trpc.dashboardWidget.importStylePreset.useMutation({
    onSuccess: () => {
      toast.success('Preset imported successfully');
      setImportDialogOpen(false);
      setImportJson('');
      refetchPresets();
    },
    onError: (error) => toast.error(error.message || 'Failed to import preset'),
  });

  const importMultipleMutation = trpc.dashboardWidget.importMultiplePresets.useMutation({
    onSuccess: (data) => {
      toast.success(`Imported ${data.imported} presets${data.failed > 0 ? `, ${data.failed} failed` : ''}`);
      setImportDialogOpen(false);
      setImportJson('');
      refetchPresets();
    },
    onError: (error) => toast.error(error.message || 'Failed to import presets'),
  });

  // Shared presets query
  const { data: sharedPresets, refetch: refetchSharedPresets } = trpc.dashboardWidget.getSharedStylePresets.useQuery(undefined, { enabled: !!user });

  // Share/Unshare mutations (admin only)
  const sharePresetMutation = trpc.dashboardWidget.sharePreset.useMutation({
    onSuccess: () => {
      toast.success('Preset shared with team');
      refetchPresets();
      refetchSharedPresets();
    },
    onError: (error) => toast.error(error.message || 'Failed to share preset'),
  });

  const unsharePresetMutation = trpc.dashboardWidget.unsharePreset.useMutation({
    onSuccess: () => {
      toast.success('Preset is now private');
      refetchPresets();
      refetchSharedPresets();
    },
    onError: (error) => toast.error(error.message || 'Failed to unshare preset'),
  });

  // Clone shared preset
  const clonePresetMutation = trpc.dashboardWidget.cloneSharedPreset.useMutation({
    onSuccess: () => {
      toast.success('Preset cloned to your collection');
      refetchPresets();
    },
    onError: (error) => toast.error(error.message || 'Failed to clone preset'),
  });

  useEffect(() => { if (currentStyle) setEditingStyle(currentStyle); }, [currentStyle]);

  const handleApplyStyle = (style: WidgetStyle, presetId?: number) => {
    // Applying a style via the manager is a DELIBERATE custom choice → mode 'custom'
    // (so the picked colours override the theme). The only exception is a style that
    // explicitly carries mode:'theme' (e.g. the built-in "Default/Theme" preset), which
    // keeps cards following the app's dark/light theme.
    const applied: WidgetStyle = { ...style, mode: style.mode ?? 'custom' };
    setEditingStyle(applied);
    if (onStyleChange) onStyleChange(applied);
    if (presetId) applyPresetMutation.mutate({ id: presetId });
    toast.success('Style applied');
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) { toast.error('Please enter a preset name'); return; }
    createPresetMutation.mutate({ name: presetName, description: presetDescription || undefined, ...editingStyle, isPublic });
  };

  const handleDeletePreset = (id: number) => {
    if (confirm('Are you sure you want to delete this preset?')) deletePresetMutation.mutate({ id });
  };

  const handleCopyStyle = () => {
    navigator.clipboard.writeText(JSON.stringify(editingStyle, null, 2));
    toast.success('Style copied to clipboard');
  };

  // Export single preset
  const handleExportPreset = (preset: any) => {
    const exportData = {
      name: preset.name,
      description: preset.description,
      backgroundColor: preset.backgroundColor,
      textColor: preset.textColor,
      borderColor: preset.borderColor,
      accentColor: preset.accentColor,
      borderRadius: preset.borderRadius,
      shadow: preset.shadow,
      opacity: preset.opacity,
      exportedAt: new Date().toISOString(),
      version: '1.0',
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `widget-style-${preset.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Preset exported');
  };

  // Export all user presets
  const handleExportAllPresets = () => {
    if (!savedPresets || savedPresets.length === 0) {
      toast.error('No presets to export');
      return;
    }
    const userPresets = savedPresets.filter(p => p.createdBy === user?.id);
    if (userPresets.length === 0) {
      toast.error('No user presets to export');
      return;
    }
    const exportData = {
      presets: userPresets.map(p => ({
        name: p.name,
        description: p.description,
        backgroundColor: p.backgroundColor,
        textColor: p.textColor,
        borderColor: p.borderColor,
        accentColor: p.accentColor,
        borderRadius: p.borderRadius,
        shadow: p.shadow,
        opacity: p.opacity,
      })),
      exportedAt: new Date().toISOString(),
      version: '1.0',
      count: userPresets.length,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `widget-styles-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${userPresets.length} presets`);
  };

  // Handle file import
  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportJson(content);
    };
    reader.readAsText(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Process import
  const handleImport = () => {
    if (!importJson.trim()) {
      toast.error('Please paste or upload JSON data');
      return;
    }
    try {
      const data = JSON.parse(importJson);
      // Check if it's a bulk export (has presets array)
      if (data.presets && Array.isArray(data.presets)) {
        importMultipleMutation.mutate({ presets: data.presets });
      } else if (data.name && data.backgroundColor) {
        // Single preset import
        importPresetMutation.mutate({
          name: data.name,
          description: data.description,
          backgroundColor: data.backgroundColor,
          textColor: data.textColor,
          borderColor: data.borderColor,
          accentColor: data.accentColor,
          borderRadius: data.borderRadius,
          shadow: data.shadow,
          opacity: data.opacity,
          isPublic: false,
        });
      } else {
        toast.error('Invalid preset format');
      }
    } catch (error) {
      toast.error('Invalid JSON format');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Palette className="h-4 w-4" />
            {`Kiểu thẻ`}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />Widget Style Presets</DialogTitle>
            <DialogDescription>Customize and save widget appearance styles</DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="presets">Presets</TabsTrigger>
              <TabsTrigger value="shared">Shared</TabsTrigger>
              <TabsTrigger value="customize">Customize</TabsTrigger>
              <TabsTrigger value="saved">My Presets</TabsTrigger>
            </TabsList>

            <TabsContent value="presets" className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-2">
                {BUILT_IN_THEMES.map((theme, index) => (
                  <Card key={index} className="cursor-pointer hover:ring-2 hover:ring-primary transition-all" onClick={() => handleApplyStyle(theme.style)}>
                    <CardHeader className="p-3 pb-2"><CardTitle className="text-sm">{theme.name}</CardTitle></CardHeader>
                    <CardContent className="p-3 pt-0"><StylePreview style={theme.style} className="h-20" /></CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="customize" className="flex-1 overflow-y-auto">
              <div className="grid md:grid-cols-2 gap-6 p-2">
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm mb-3">Colors</h3>
                  <ColorPicker label="Background" value={editingStyle.backgroundColor} onChange={(v) => setEditingStyle({ ...editingStyle, backgroundColor: v })} />
                  <ColorPicker label="Text" value={editingStyle.textColor} onChange={(v) => setEditingStyle({ ...editingStyle, textColor: v })} />
                  <ColorPicker label="Border" value={editingStyle.borderColor} onChange={(v) => setEditingStyle({ ...editingStyle, borderColor: v })} />
                  <ColorPicker label="Accent" value={editingStyle.accentColor} onChange={(v) => setEditingStyle({ ...editingStyle, accentColor: v })} />

                  <div className="pt-4 space-y-4">
                    <h3 className="font-semibold text-sm">Effects</h3>
                    <div className="flex items-center gap-3">
                      <Label className="w-28 text-sm">Border Radius</Label>
                      <Select value={editingStyle.borderRadius} onValueChange={(v) => setEditingStyle({ ...editingStyle, borderRadius: v })}>
                        <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>{BORDER_RADIUS_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-28 text-sm">Shadow</Label>
                      <Select value={editingStyle.shadow} onValueChange={(v) => setEditingStyle({ ...editingStyle, shadow: v as WidgetStyle['shadow'] })}>
                        <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>{SHADOW_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-28 text-sm">Opacity</Label>
                      <div className="flex-1 flex items-center gap-3">
                        <Slider value={[parseFloat(editingStyle.opacity) * 100]} onValueChange={([v]) => setEditingStyle({ ...editingStyle, opacity: (v / 100).toFixed(2) })} max={100} min={50} step={5} className="flex-1" />
                        <span className="text-sm w-12 text-right">{Math.round(parseFloat(editingStyle.opacity) * 100)}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold text-sm mb-3">Preview</h3>
                  <div className="bg-muted/50 rounded-lg p-4"><StylePreview style={editingStyle} className="h-40" /></div>
                  <div className="flex gap-2 pt-4">
                    <Button variant="outline" className="flex-1" onClick={handleCopyStyle}><Copy className="h-4 w-4 mr-2" />Copy Style</Button>
                    <Button className="flex-1" onClick={() => handleApplyStyle(editingStyle)}><Check className="h-4 w-4 mr-2" />Apply</Button>
                  </div>
                  <Button variant="secondary" className="w-full" onClick={() => setSaveDialogOpen(true)}><Save className="h-4 w-4 mr-2" />Save as Preset</Button>
                </div>
              </div>
            </TabsContent>

            {/* Shared Presets Tab */}
            <TabsContent value="shared" className="flex-1 overflow-y-auto">
              <div className="p-2 mb-2 border-b">
                <p className="text-sm text-muted-foreground">
                  <Globe className="h-4 w-4 inline mr-1" />
                  Team shared presets - available to all users
                </p>
              </div>
              {sharedPresets && sharedPresets.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-2">
                  {sharedPresets.map((preset) => (
                    <Card key={preset.id} className="relative group">
                      <CardHeader className="p-3 pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm truncate">{preset.name}</CardTitle>
                          <div className="flex items-center gap-1">
                            {preset.presetType === 'system' && <Lock className="h-3 w-3 text-muted-foreground" />}
                            {preset.presetType === 'shared' && <Share2 className="h-3 w-3 text-blue-500" />}
                            {preset.isPublic && <Globe className="h-3 w-3 text-green-500" />}
                          </div>
                        </div>
                        {preset.description && <CardDescription className="text-xs truncate">{preset.description}</CardDescription>}
                      </CardHeader>
                      <CardContent className="p-3 pt-0">
                        <StylePreview style={{ backgroundColor: preset.backgroundColor, textColor: preset.textColor, borderColor: preset.borderColor, accentColor: preset.accentColor, borderRadius: preset.borderRadius, shadow: preset.shadow, opacity: preset.opacity }} className="h-16" />
                        <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="sm" variant="secondary" className="flex-1 h-7 text-xs" onClick={() => handleApplyStyle({ backgroundColor: preset.backgroundColor, textColor: preset.textColor, borderColor: preset.borderColor, accentColor: preset.accentColor, borderRadius: preset.borderRadius, shadow: preset.shadow, opacity: preset.opacity }, preset.id)}>
                            <Eye className="h-3 w-3 mr-1" />Apply
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => clonePresetMutation.mutate({ id: preset.id })} title="Clone to My Presets">
                            <UserPlus className="h-3 w-3" />
                          </Button>
                          {user?.role === 'admin' && preset.presetType !== 'system' && (
                            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => unsharePresetMutation.mutate({ id: preset.id })} title="Make Private">
                              <Lock className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                      <div className="absolute top-2 right-2 text-xs text-muted-foreground">{preset.usageCount} uses</div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Share2 className="h-12 w-12 mb-4 opacity-50" />
                  <p>No shared presets yet</p>
                  <p className="text-sm">Admin can share presets with the team</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="saved" className="flex-1 overflow-y-auto">
              {/* Export/Import toolbar */}
              <div className="flex items-center justify-between p-2 border-b mb-2">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleExportAllPresets} disabled={!savedPresets || savedPresets.filter(p => p.createdBy === user?.id).length === 0}>
                    <Download className="h-4 w-4 mr-2" />Export All
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
                    <Upload className="h-4 w-4 mr-2" />Import
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  {savedPresets?.filter(p => p.createdBy === user?.id).length || 0} user presets
                </span>
              </div>
              
              {savedPresets && savedPresets.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-2">
                  {savedPresets.map((preset) => (
                    <Card key={preset.id} className="relative group">
                      <CardHeader className="p-3 pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm truncate">{preset.name}</CardTitle>
                          <div className="flex items-center gap-1">
                            {preset.presetType === 'system' && <Lock className="h-3 w-3 text-muted-foreground" />}
                            {preset.isPublic && <Users className="h-3 w-3 text-muted-foreground" />}
                          </div>
                        </div>
                        {preset.description && <CardDescription className="text-xs truncate">{preset.description}</CardDescription>}
                      </CardHeader>
                      <CardContent className="p-3 pt-0">
                        <StylePreview style={{ backgroundColor: preset.backgroundColor, textColor: preset.textColor, borderColor: preset.borderColor, accentColor: preset.accentColor, borderRadius: preset.borderRadius, shadow: preset.shadow, opacity: preset.opacity }} className="h-16" />
                        <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="sm" variant="secondary" className="flex-1 h-7 text-xs" onClick={() => handleApplyStyle({ backgroundColor: preset.backgroundColor, textColor: preset.textColor, borderColor: preset.borderColor, accentColor: preset.accentColor, borderRadius: preset.borderRadius, shadow: preset.shadow, opacity: preset.opacity }, preset.id)}>
                            <Eye className="h-3 w-3 mr-1" />Apply
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleExportPreset(preset)}>
                            <Download className="h-3 w-3" />
                          </Button>
                          {user?.role === 'admin' && preset.presetType !== 'system' && !preset.isPublic && preset.createdBy === user?.id && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-blue-500 hover:text-blue-600" onClick={() => sharePresetMutation.mutate({ id: preset.id })}>
                              <Share2 className="h-3 w-3" />
                            </Button>
                          )}
                          {preset.presetType !== 'system' && preset.createdBy === user?.id && (
                            <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => handleDeletePreset(preset.id)}><Trash2 className="h-3 w-3" /></Button>
                          )}
                        </div>
                      </CardContent>
                      <div className="absolute top-2 right-2 text-xs text-muted-foreground">{preset.usageCount} uses</div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Palette className="h-12 w-12 mb-4 opacity-50" />
                  <p>No saved presets yet</p>
                  <p className="text-sm">Create one from the Customize tab</p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="pt-4 border-t"><Button variant="outline" onClick={() => setOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save Style Preset</DialogTitle>
            <DialogDescription>Save your current style as a reusable preset</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label htmlFor="preset-name">Preset Name *</Label><Input id="preset-name" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="My Custom Style" /></div>
            <div className="space-y-2"><Label htmlFor="preset-desc">Description</Label><Textarea id="preset-desc" value={presetDescription} onChange={(e) => setPresetDescription(e.target.value)} placeholder="Optional description..." rows={2} /></div>
            {user?.role === 'admin' && (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5"><Label>Share with team</Label><p className="text-xs text-muted-foreground">Make this preset available to all users</p></div>
                <Switch checked={isPublic} onCheckedChange={setIsPublic} />
              </div>
            )}
            <div className="pt-2"><p className="text-sm text-muted-foreground mb-2">Preview:</p><StylePreview style={editingStyle} className="h-20" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePreset} disabled={createPresetMutation.isPending}>{createPresetMutation.isPending ? 'Saving...' : 'Save Preset'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileJson className="h-5 w-5" />Import Style Presets</DialogTitle>
            <DialogDescription>Import presets from a JSON file or paste JSON data</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Upload JSON File</Label>
              <div className="flex gap-2">
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileImport}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">or paste JSON</span></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-json">JSON Data</Label>
              <Textarea
                id="import-json"
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='{"name": "My Style", "backgroundColor": "#ffffff", ...}'
                rows={8}
                className="font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">Supports single preset or bulk export format (with presets array)</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportJson(''); }}>Cancel</Button>
            <Button onClick={handleImport} disabled={importPresetMutation.isPending || importMultipleMutation.isPending}>
              {(importPresetMutation.isPending || importMultipleMutation.isPending) ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function useWidgetStyle() {
  const [style, setStyle] = useState<WidgetStyle>(DEFAULT_WIDGET_STYLE);
  const getStyleProps = () => {
    const shadowClass = SHADOW_OPTIONS.find(s => s.value === style.shadow)?.class || '';
    return { style: { backgroundColor: style.backgroundColor, color: style.textColor, borderColor: style.borderColor, borderRadius: style.borderRadius, opacity: parseFloat(style.opacity) }, className: cn('border', shadowClass), accentColor: style.accentColor };
  };
  return { style, setStyle, getStyleProps };
}
