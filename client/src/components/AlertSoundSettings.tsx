import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Volume2, VolumeX, Play, Bell, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { alertSoundService, SoundType } from '@/lib/alertSoundService';

const SOUND_TYPES: { value: SoundType; label: string; description: string }[] = [
  { value: 'beep', label: 'Beep', description: 'Tiếng beep đơn giản' },
  { value: 'chime', label: 'Chime', description: 'Âm thanh nhẹ nhàng' },
  { value: 'warning', label: 'Warning', description: 'Cảnh báo 2 tiếng' },
  { value: 'alarm', label: 'Alarm', description: 'Báo động 2 tông' },
  { value: 'critical', label: 'Critical', description: 'Báo động khẩn cấp' },
];

export default function AlertSoundSettings() {
  const [settings, setSettings] = useState(alertSoundService.getSettings());
  const [testing, setTesting] = useState<SoundType | null>(null);

  useEffect(() => {
    setSettings(alertSoundService.getSettings());
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
                <SelectItem key={type.value} value={type.value}>
                  <div className="flex flex-col">
                    <span>{type.label}</span>
                    <span className="text-xs text-muted-foreground">{type.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Label className="text-base">Thử âm thanh</Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SOUND_TYPES.map((type) => (
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
