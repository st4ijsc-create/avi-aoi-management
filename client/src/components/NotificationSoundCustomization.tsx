import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { 
  Volume2, VolumeX, Play, Bell, AlertTriangle, AlertCircle, Info,
  Upload, Trash2, Music, Check, Settings2, Zap
} from 'lucide-react';

// Sound types
export type SoundType = 'beep' | 'alarm' | 'chime' | 'warning' | 'critical' | 'custom' | 'none';
export type AlertType = 'ng' | 'yield_warning' | 'yield_critical' | 'machine_offline' | 'mqtt_disconnect' | 'system';

interface CustomSound {
  name: string;
  data: string; // base64 encoded audio data
  mimeType: string;
}

interface AlertSoundMapping {
  alertType: AlertType;
  soundType: SoundType;
  customSoundIndex?: number;
  enabled: boolean;
}

interface NotificationSoundSettings {
  globalEnabled: boolean;
  volume: number;
  repeatCount: number;
  repeatInterval: number;
  customSounds: CustomSound[];
  alertMappings: AlertSoundMapping[];
}

const ALERT_TYPES: { value: AlertType; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'ng', label: 'NG Detection', description: 'Khi phát hiện sản phẩm lỗi NG', icon: <AlertCircle className="h-4 w-4 text-destructive" /> },
  { value: 'yield_warning', label: 'Yield Warning', description: 'Khi FPY dưới ngưỡng cảnh báo', icon: <AlertTriangle className="h-4 w-4 text-warning" /> },
  { value: 'yield_critical', label: 'Yield Critical', description: 'Khi FPY dưới ngưỡng nguy hiểm', icon: <AlertCircle className="h-4 w-4 text-destructive" /> },
  { value: 'machine_offline', label: 'Machine Offline', description: 'Khi máy mất kết nối', icon: <Zap className="h-4 w-4 text-muted-foreground" /> },
  { value: 'mqtt_disconnect', label: 'MQTT Disconnect', description: 'Khi mất kết nối MQTT broker', icon: <AlertTriangle className="h-4 w-4 text-warning" /> },
  { value: 'system', label: 'System Alert', description: 'Thông báo hệ thống chung', icon: <Info className="h-4 w-4 text-blue-500" /> },
];

const SOUND_TYPES: { value: SoundType; label: string; description: string }[] = [
  { value: 'none', label: 'Không âm thanh', description: 'Tắt âm thanh cho loại cảnh báo này' },
  { value: 'beep', label: 'Beep', description: 'Tiếng beep đơn giản' },
  { value: 'chime', label: 'Chime', description: 'Âm thanh nhẹ nhàng' },
  { value: 'warning', label: 'Warning', description: 'Cảnh báo 2 tiếng' },
  { value: 'alarm', label: 'Alarm', description: 'Báo động 2 tông' },
  { value: 'critical', label: 'Critical', description: 'Báo động khẩn cấp' },
  { value: 'custom', label: 'Tùy chỉnh', description: 'Âm thanh do bạn upload' },
];

const DEFAULT_MAPPINGS: AlertSoundMapping[] = [
  { alertType: 'ng', soundType: 'alarm', enabled: true },
  { alertType: 'yield_warning', soundType: 'warning', enabled: true },
  { alertType: 'yield_critical', soundType: 'critical', enabled: true },
  { alertType: 'machine_offline', soundType: 'beep', enabled: true },
  { alertType: 'mqtt_disconnect', soundType: 'warning', enabled: true },
  { alertType: 'system', soundType: 'chime', enabled: true },
];

const DEFAULT_SETTINGS: NotificationSoundSettings = {
  globalEnabled: true,
  volume: 0.7,
  repeatCount: 1,
  repeatInterval: 500,
  customSounds: [],
  alertMappings: DEFAULT_MAPPINGS,
};

const STORAGE_KEY = 'notification-sound-settings';
const MAX_CUSTOM_SOUNDS = 10;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const ALLOWED_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3'];

// Audio context for generating sounds
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

// Sound generation functions
async function playBeep(frequency: number, duration: number, volume: number): Promise<void> {
  return new Promise((resolve) => {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.value = volume;

    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);

    setTimeout(resolve, duration * 1000);
  });
}

async function playAlarm(volume: number): Promise<void> {
  await playBeep(880, 0.15, volume);
  await playBeep(660, 0.15, volume);
  await playBeep(880, 0.15, volume);
  await playBeep(660, 0.15, volume);
}

async function playChime(volume: number): Promise<void> {
  await playBeep(523, 0.1, volume);
  await playBeep(659, 0.1, volume);
  await playBeep(784, 0.2, volume);
}

async function playWarning(volume: number): Promise<void> {
  await playBeep(440, 0.2, volume);
  await new Promise(r => setTimeout(r, 100));
  await playBeep(440, 0.2, volume);
}

async function playCritical(volume: number): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await playBeep(1000, 0.1, volume);
    await playBeep(800, 0.1, volume);
  }
}

async function playCustomSound(data: string, volume: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      const audio = new Audio(data);
      audio.volume = volume;
      audio.onended = () => resolve();
      audio.onerror = () => {
        playBeep(800, 0.3, volume).then(resolve);
      };
      audio.play().catch(() => {
        playBeep(800, 0.3, volume).then(resolve);
      });
    } catch {
      playBeep(800, 0.3, volume).then(resolve);
    }
  });
}

export default function NotificationSoundCustomization() {
  const [settings, setSettings] = useState<NotificationSoundSettings>(DEFAULT_SETTINGS);
  const [testing, setTesting] = useState<AlertType | SoundType | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all alert types have mappings
        const mergedMappings = DEFAULT_MAPPINGS.map(defaultMapping => {
          const savedMapping = parsed.alertMappings?.find((m: AlertSoundMapping) => m.alertType === defaultMapping.alertType);
          return savedMapping || defaultMapping;
        });
        setSettings({ ...DEFAULT_SETTINGS, ...parsed, alertMappings: mergedMappings });
      }
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  // Save settings to localStorage
  const saveSettings = (updates: Partial<NotificationSoundSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  // Update alert mapping
  const updateAlertMapping = (alertType: AlertType, updates: Partial<AlertSoundMapping>) => {
    const newMappings = settings.alertMappings.map(mapping => 
      mapping.alertType === alertType ? { ...mapping, ...updates } : mapping
    );
    saveSettings({ alertMappings: newMappings });
  };

  // Get mapping for alert type
  const getMapping = (alertType: AlertType): AlertSoundMapping => {
    return settings.alertMappings.find(m => m.alertType === alertType) || DEFAULT_MAPPINGS.find(m => m.alertType === alertType)!;
  };

  // Play sound by type
  const playSoundByType = async (soundType: SoundType, customSoundIndex?: number) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const volume = settings.volume;

    switch (soundType) {
      case 'beep':
        await playBeep(800, 0.3, volume);
        break;
      case 'alarm':
        await playAlarm(volume);
        break;
      case 'chime':
        await playChime(volume);
        break;
      case 'warning':
        await playWarning(volume);
        break;
      case 'critical':
        await playCritical(volume);
        break;
      case 'custom':
        if (customSoundIndex !== undefined && settings.customSounds[customSoundIndex]) {
          await playCustomSound(settings.customSounds[customSoundIndex].data, volume);
        } else if (settings.customSounds.length > 0) {
          await playCustomSound(settings.customSounds[0].data, volume);
        } else {
          await playBeep(800, 0.3, volume);
        }
        break;
      case 'none':
        // No sound
        break;
    }
  };

  // Test alert sound
  const testAlertSound = async (alertType: AlertType) => {
    if (testing) return;
    setTesting(alertType);
    
    const mapping = getMapping(alertType);
    if (mapping.enabled && mapping.soundType !== 'none') {
      await playSoundByType(mapping.soundType, mapping.customSoundIndex);
    }
    
    setTesting(null);
  };

  // Test preset sound
  const testPresetSound = async (soundType: SoundType) => {
    if (testing || soundType === 'none') return;
    setTesting(soundType);
    await playSoundByType(soundType);
    setTesting(null);
  };

  // File upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error('Định dạng file không hỗ trợ. Chỉ chấp nhận MP3, WAV, OGG.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error('File quá lớn. Kích thước tối đa là 1MB.');
      return;
    }

    if (settings.customSounds.length >= MAX_CUSTOM_SOUNDS) {
      toast.error(`Đã đạt giới hạn ${MAX_CUSTOM_SOUNDS} âm thanh tùy chỉnh.`);
      return;
    }

    setUploading(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const customSound: CustomSound = {
        name: file.name.replace(/\.[^/.]+$/, ''),
        data: base64,
        mimeType: file.type,
      };

      saveSettings({ customSounds: [...settings.customSounds, customSound] });
      toast.success('Đã thêm âm thanh tùy chỉnh');
    } catch {
      toast.error('Không thể đọc file âm thanh.');
    }

    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove custom sound
  const removeCustomSound = (index: number) => {
    const newCustomSounds = settings.customSounds.filter((_, i) => i !== index);
    
    // Update mappings that reference this sound
    const newMappings = settings.alertMappings.map(mapping => {
      if (mapping.soundType === 'custom' && mapping.customSoundIndex === index) {
        return { ...mapping, customSoundIndex: 0 };
      }
      if (mapping.soundType === 'custom' && mapping.customSoundIndex !== undefined && mapping.customSoundIndex > index) {
        return { ...mapping, customSoundIndex: mapping.customSoundIndex - 1 };
      }
      return mapping;
    });

    saveSettings({ customSounds: newCustomSounds, alertMappings: newMappings });
    toast.success('Đã xóa âm thanh tùy chỉnh');
  };

  // Test custom sound
  const testCustomSound = async (index: number) => {
    if (testing) return;
    setTesting('custom');
    await playCustomSound(settings.customSounds[index].data, settings.volume);
    setTesting(null);
  };

  // Reset to defaults
  const resetToDefaults = () => {
    saveSettings(DEFAULT_SETTINGS);
    toast.success('Đã khôi phục cài đặt mặc định');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Tùy chỉnh âm thanh thông báo
        </CardTitle>
        <CardDescription>
          Cấu hình âm thanh riêng cho từng loại cảnh báo
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="mappings" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="mappings">Ánh xạ cảnh báo</TabsTrigger>
            <TabsTrigger value="custom">Âm thanh tùy chỉnh</TabsTrigger>
            <TabsTrigger value="settings">Cài đặt chung</TabsTrigger>
          </TabsList>

          {/* Alert Mappings Tab */}
          <TabsContent value="mappings" className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-0.5">
                <Label className="text-base">Bật âm thanh cảnh báo</Label>
                <p className="text-sm text-muted-foreground">
                  Bật/tắt tất cả âm thanh thông báo
                </p>
              </div>
              <Switch
                checked={settings.globalEnabled}
                onCheckedChange={(globalEnabled) => saveSettings({ globalEnabled })}
              />
            </div>

            <div className="space-y-3">
              {ALERT_TYPES.map(alertType => {
                const mapping = getMapping(alertType.value);
                return (
                  <div 
                    key={alertType.value}
                    className={`p-4 rounded-lg border ${
                      mapping.enabled && settings.globalEnabled 
                        ? 'border-border' 
                        : 'border-border/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {alertType.icon}
                        <div>
                          <div className="flex items-center gap-2">
                            <Label className="font-medium">{alertType.label}</Label>
                            <Switch
                              checked={mapping.enabled}
                              onCheckedChange={(enabled) => updateAlertMapping(alertType.value, { enabled })}
                              disabled={!settings.globalEnabled}
                            />
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {alertType.description}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Select
                          value={mapping.soundType}
                          onValueChange={(soundType: SoundType) => updateAlertMapping(alertType.value, { soundType })}
                          disabled={!mapping.enabled || !settings.globalEnabled}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SOUND_TYPES.map(sound => (
                              <SelectItem 
                                key={sound.value} 
                                value={sound.value}
                                disabled={sound.value === 'custom' && settings.customSounds.length === 0}
                              >
                                {sound.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {mapping.soundType === 'custom' && settings.customSounds.length > 0 && (
                          <Select
                            value={String(mapping.customSoundIndex || 0)}
                            onValueChange={(v) => updateAlertMapping(alertType.value, { customSoundIndex: parseInt(v) })}
                            disabled={!mapping.enabled || !settings.globalEnabled}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {settings.customSounds.map((sound, index) => (
                                <SelectItem key={index} value={String(index)}>
                                  {sound.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => testAlertSound(alertType.value)}
                          disabled={testing !== null || !mapping.enabled || !settings.globalEnabled || mapping.soundType === 'none'}
                        >
                          {testing === alertType.value ? (
                            <span className="animate-pulse">🔊</span>
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* Custom Sounds Tab */}
          <TabsContent value="custom" className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base">Âm thanh tùy chỉnh</Label>
              <Badge variant="outline">{settings.customSounds.length}/{MAX_CUSTOM_SOUNDS}</Badge>
            </div>

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
                disabled={uploading || settings.customSounds.length >= MAX_CUSTOM_SOUNDS}
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? 'Đang tải...' : 'Tải lên âm thanh'}
              </Button>
              <span className="text-xs text-muted-foreground">
                MP3, WAV, OGG (tối đa 1MB)
              </span>
            </div>

            {settings.customSounds.length > 0 ? (
              <div className="space-y-2">
                {settings.customSounds.map((sound, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-3 rounded-lg border"
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => testCustomSound(index)}
                        disabled={testing !== null}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCustomSound(index)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg border-dashed">
                Chưa có âm thanh tùy chỉnh. Tải lên file âm thanh để sử dụng.
              </p>
            )}

            {/* Preset Sounds Preview */}
            <div className="space-y-3 pt-4 border-t">
              <Label className="text-base">Thử âm thanh preset</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SOUND_TYPES.filter(t => t.value !== 'custom' && t.value !== 'none').map((type) => (
                  <Button
                    key={type.value}
                    variant="outline"
                    size="sm"
                    onClick={() => testPresetSound(type.value)}
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
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
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
                  onValueChange={([volume]) => saveSettings({ volume })}
                  className="flex-1"
                />
                <Volume2 className="h-4 w-4 text-muted-foreground" />
              </div>
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
                onValueChange={([repeatCount]) => saveSettings({ repeatCount })}
              />
            </div>

            {/* Repeat Interval */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base">Khoảng cách lặp</Label>
                <span className="text-sm text-muted-foreground">
                  {settings.repeatInterval}ms
                </span>
              </div>
              <Slider
                value={[settings.repeatInterval]}
                min={200}
                max={2000}
                step={100}
                onValueChange={([repeatInterval]) => saveSettings({ repeatInterval })}
              />
            </div>

            {/* Reset Button */}
            <div className="pt-4 border-t">
              <Button variant="outline" onClick={resetToDefaults}>
                <Settings2 className="h-4 w-4 mr-2" />
                Khôi phục mặc định
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// Export service for use in other components
export class NotificationSoundService {
  private static instance: NotificationSoundService;
  
  static getInstance(): NotificationSoundService {
    if (!NotificationSoundService.instance) {
      NotificationSoundService.instance = new NotificationSoundService();
    }
    return NotificationSoundService.instance;
  }

  private getSettings(): NotificationSoundSettings {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const mergedMappings = DEFAULT_MAPPINGS.map(defaultMapping => {
          const savedMapping = parsed.alertMappings?.find((m: AlertSoundMapping) => m.alertType === defaultMapping.alertType);
          return savedMapping || defaultMapping;
        });
        return { ...DEFAULT_SETTINGS, ...parsed, alertMappings: mergedMappings };
      }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  }

  async playAlertSound(alertType: AlertType): Promise<void> {
    const settings = this.getSettings();
    if (!settings.globalEnabled) return;

    const mapping = settings.alertMappings.find(m => m.alertType === alertType);
    if (!mapping || !mapping.enabled || mapping.soundType === 'none') return;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const volume = settings.volume;

    for (let i = 0; i < settings.repeatCount; i++) {
      switch (mapping.soundType) {
        case 'beep':
          await playBeep(800, 0.3, volume);
          break;
        case 'alarm':
          await playAlarm(volume);
          break;
        case 'chime':
          await playChime(volume);
          break;
        case 'warning':
          await playWarning(volume);
          break;
        case 'critical':
          await playCritical(volume);
          break;
        case 'custom':
          if (mapping.customSoundIndex !== undefined && settings.customSounds[mapping.customSoundIndex]) {
            await playCustomSound(settings.customSounds[mapping.customSoundIndex].data, volume);
          } else if (settings.customSounds.length > 0) {
            await playCustomSound(settings.customSounds[0].data, volume);
          }
          break;
      }

      if (i < settings.repeatCount - 1) {
        await new Promise(r => setTimeout(r, settings.repeatInterval));
      }
    }
  }
}

export const notificationSoundService = NotificationSoundService.getInstance();
