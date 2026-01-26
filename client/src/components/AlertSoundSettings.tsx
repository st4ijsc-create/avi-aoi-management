import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { 
  Volume2, VolumeX, Play, Bell, AlertTriangle, AlertCircle, Info,
  Upload, Trash2, Music, Check
} from 'lucide-react';
import { alertSoundService, SoundType } from '@/lib/alertSoundService';

const SOUND_TYPES: { value: SoundType; label: string; description: string }[] = [
  { value: 'beep', label: 'Beep', description: 'Tiếng beep đơn giản' },
  { value: 'chime', label: 'Chime', description: 'Âm thanh nhẹ nhàng' },
  { value: 'warning', label: 'Warning', description: 'Cảnh báo 2 tiếng' },
  { value: 'alarm', label: 'Alarm', description: 'Báo động 2 tông' },
  { value: 'critical', label: 'Critical', description: 'Báo động khẩn cấp' },
  { value: 'custom', label: 'Tùy chỉnh', description: 'Âm thanh do bạn upload' },
];

export default function AlertSoundSettings() {
  const [settings, setSettings] = useState(alertSoundService.getSettings());
  const [testing, setTesting] = useState<SoundType | null>(null);
  const [customSounds, setCustomSounds] = useState(alertSoundService.getCustomSounds());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSettings(alertSoundService.getSettings());
    setCustomSounds(alertSoundService.getCustomSounds());
  }, []);

  const updateSettings = (updates: Partial<typeof settings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    alertSoundService.saveSettings(updates);
  };

  const testSound = async (type: SoundType) => {
    setTesting(type);
    await alertSoundService.testSound(type);
    setTesting(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const result = await alertSoundService.addCustomSound(file);
    setUploading(false);

    if (result.success) {
      toast.success('Đã thêm âm thanh tùy chỉnh');
      setCustomSounds(alertSoundService.getCustomSounds());
      setSettings(alertSoundService.getSettings());
    } else {
      toast.error(result.error || 'Không thể thêm âm thanh');
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveCustomSound = (index: number) => {
    alertSoundService.removeCustomSound(index);
    setCustomSounds(alertSoundService.getCustomSounds());
    setSettings(alertSoundService.getSettings());
    toast.success('Đã xóa âm thanh tùy chỉnh');
  };

  const handleSetActiveCustomSound = (index: number) => {
    alertSoundService.setActiveCustomSound(index);
    setSettings(alertSoundService.getSettings());
  };

  const handleTestCustomSound = async (index: number) => {
    await alertSoundService.testCustomSound(index);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Cài đặt âm thanh cảnh báo
        </CardTitle>
        <CardDescription>
          Cấu hình âm thanh thông báo khi có lỗi NG từ MQTT
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">Bật âm thanh cảnh báo</Label>
            <p className="text-sm text-muted-foreground">
              Phát âm thanh khi nhận được thông báo lỗi NG
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => updateSettings({ enabled })}
          />
        </div>

        {/* Volume */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base">Âm lượng</Label>
            <span className="text-sm text-muted-foreground">
              {Math.round(settings.volume * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <VolumeX className="h-4 w-4 text-muted-foreground" />
            <Slider
              value={[settings.volume]}
              min={0}
              max={1}
              step={0.1}
              onValueChange={([volume]) => updateSettings({ volume })}
              disabled={!settings.enabled}
              className="flex-1"
            />
            <Volume2 className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Sound Type */}
        <div className="space-y-3">
          <Label className="text-base">Loại âm thanh mặc định</Label>
          <Select
            value={settings.soundType}
            onValueChange={(soundType: SoundType) => updateSettings({ soundType })}
            disabled={!settings.enabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Chọn loại âm thanh" />
            </SelectTrigger>
            <SelectContent>
              {SOUND_TYPES.map((type) => (
                <SelectItem 
                  key={type.value} 
                  value={type.value}
                  disabled={type.value === 'custom' && customSounds.length === 0}
                >
                  <div className="flex flex-col">
                    <span>{type.label}</span>
                    <span className="text-xs text-muted-foreground">{type.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Custom Sounds Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base">Âm thanh tùy chỉnh</Label>
            <Badge variant="outline">{customSounds.length}/5</Badge>
          </div>
          
          {/* Upload Button */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || customSounds.length >= 5}
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? 'Đang tải...' : 'Tải lên âm thanh'}
            </Button>
            <span className="text-xs text-muted-foreground">
              MP3, WAV, OGG (tối đa 1MB)
            </span>
          </div>

          {/* Custom Sounds List */}
          {customSounds.length > 0 && (
            <div className="space-y-2">
              {customSounds.map((sound, index) => (
                <div 
                  key={index}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    settings.activeCustomSoundIndex === index && settings.soundType === 'custom'
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Music className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{sound.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {sound.mimeType.replace('audio/', '').toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {settings.activeCustomSoundIndex === index && settings.soundType === 'custom' && (
                      <Badge variant="default" className="text-xs">
                        <Check className="h-3 w-3 mr-1" />
                        Đang dùng
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleTestCustomSound(index)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    {settings.soundType === 'custom' && settings.activeCustomSoundIndex !== index && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetActiveCustomSound(index)}
                      >
                        Chọn
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveCustomSound(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {customSounds.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
              Chưa có âm thanh tùy chỉnh. Tải lên file âm thanh để sử dụng.
            </p>
          )}
        </div>

        {/* Repeat Count */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base">Số lần lặp</Label>
            <span className="text-sm text-muted-foreground">
              {settings.repeatCount} lần
            </span>
          </div>
          <Slider
            value={[settings.repeatCount]}
            min={1}
            max={5}
            step={1}
            onValueChange={([repeatCount]) => updateSettings({ repeatCount })}
            disabled={!settings.enabled}
          />
        </div>

        {/* Test Sounds */}
        <div className="space-y-3">
          <Label className="text-base">Thử âm thanh preset</Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SOUND_TYPES.filter(t => t.value !== 'custom').map((type) => (
              <Button
                key={type.value}
                variant="outline"
                size="sm"
                onClick={() => testSound(type.value)}
                disabled={testing !== null}
                className="flex items-center gap-2"
              >
                {testing === type.value ? (
                  <span className="animate-pulse">🔊</span>
                ) : (
                  <Play className="h-3 w-3" />
                )}
                {type.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Severity Mapping Info */}
        <div className="rounded-lg border p-4 space-y-2">
          <Label className="text-base">Ánh xạ mức độ nghiêm trọng</Label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              <span>Info → Chime</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span>Warning → Warning</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span>Error → Alarm</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-700" />
              <span>Critical → Critical</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
