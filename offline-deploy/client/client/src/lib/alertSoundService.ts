// Alert Sound Service - Web Audio API based sound notifications
// Supports multiple sound types for different alert severities
// Includes custom sound upload support

export type SoundType = 'beep' | 'alarm' | 'chime' | 'warning' | 'critical' | 'custom';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

interface CustomSound {
  name: string;
  data: string; // base64 encoded audio data
  mimeType: string;
}

interface SoundSettings {
  enabled: boolean;
  volume: number; // 0-1
  soundType: SoundType;
  repeatCount: number;
  repeatInterval: number; // ms
  customSounds: CustomSound[];
  activeCustomSoundIndex: number;
}

const DEFAULT_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.7,
  soundType: 'beep',
  repeatCount: 1,
  repeatInterval: 500,
  customSounds: [],
  activeCustomSoundIndex: 0,
};

const MAX_CUSTOM_SOUNDS = 5;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const ALLOWED_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3'];

class AlertSoundService {
  private audioContext: AudioContext | null = null;
  private settings: SoundSettings = DEFAULT_SETTINGS;
  private isPlaying = false;
  private customAudioElements: Map<number, HTMLAudioElement> = new Map();

  constructor() {
    this.loadSettings();
    this.preloadCustomSounds();
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return this.audioContext;
  }

  private loadSettings(): void {
    try {
      const saved = localStorage.getItem('alertSoundSettings');
      if (saved) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {
      this.settings = DEFAULT_SETTINGS;
    }
  }

  private preloadCustomSounds(): void {
    this.customAudioElements.clear();
    this.settings.customSounds.forEach((sound, index) => {
      try {
        const audio = new Audio(sound.data);
        audio.preload = 'auto';
        this.customAudioElements.set(index, audio);
      } catch (e) {
        console.error('Failed to preload custom sound:', e);
      }
    });
  }

  saveSettings(settings: Partial<SoundSettings>): void {
    this.settings = { ...this.settings, ...settings };
    localStorage.setItem('alertSoundSettings', JSON.stringify(this.settings));
    if (settings.customSounds) {
      this.preloadCustomSounds();
    }
  }

  getSettings(): SoundSettings {
    return { ...this.settings };
  }

  // Custom sound management
  async addCustomSound(file: File): Promise<{ success: boolean; error?: string }> {
    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return { success: false, error: 'Định dạng file không hỗ trợ. Chỉ chấp nhận MP3, WAV, OGG.' };
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: 'File quá lớn. Kích thước tối đa là 1MB.' };
    }

    // Check max custom sounds
    if (this.settings.customSounds.length >= MAX_CUSTOM_SOUNDS) {
      return { success: false, error: `Đã đạt giới hạn ${MAX_CUSTOM_SOUNDS} âm thanh tùy chỉnh.` };
    }

    try {
      const base64 = await this.fileToBase64(file);
      const customSound: CustomSound = {
        name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
        data: base64,
        mimeType: file.type,
      };

      const newCustomSounds = [...this.settings.customSounds, customSound];
      this.saveSettings({ customSounds: newCustomSounds });

      return { success: true };
    } catch (e) {
      console.error('Failed to add custom sound:', e);
      return { success: false, error: 'Không thể đọc file âm thanh.' };
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  removeCustomSound(index: number): void {
    const newCustomSounds = this.settings.customSounds.filter((_, i) => i !== index);
    let newActiveIndex = this.settings.activeCustomSoundIndex;
    
    if (index === this.settings.activeCustomSoundIndex) {
      newActiveIndex = 0;
    } else if (index < this.settings.activeCustomSoundIndex) {
      newActiveIndex = this.settings.activeCustomSoundIndex - 1;
    }

    this.saveSettings({ 
      customSounds: newCustomSounds,
      activeCustomSoundIndex: Math.max(0, newActiveIndex),
    });
  }

  setActiveCustomSound(index: number): void {
    if (index >= 0 && index < this.settings.customSounds.length) {
      this.saveSettings({ activeCustomSoundIndex: index });
    }
  }

  getCustomSounds(): CustomSound[] {
    return [...this.settings.customSounds];
  }

  // Generate beep sound
  private playBeep(frequency: number, duration: number, volume: number): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.getAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gainNode.gain.value = volume;

      // Fade out
      gainNode.gain.setValueAtTime(volume, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration);

      setTimeout(resolve, duration * 1000);
    });
  }

  // Generate alarm sound (two-tone)
  private async playAlarm(volume: number): Promise<void> {
    await this.playBeep(880, 0.15, volume);
    await this.playBeep(660, 0.15, volume);
    await this.playBeep(880, 0.15, volume);
    await this.playBeep(660, 0.15, volume);
  }

  // Generate chime sound (pleasant notification)
  private async playChime(volume: number): Promise<void> {
    await this.playBeep(523, 0.1, volume); // C5
    await this.playBeep(659, 0.1, volume); // E5
    await this.playBeep(784, 0.2, volume); // G5
  }

  // Generate warning sound
  private async playWarning(volume: number): Promise<void> {
    await this.playBeep(440, 0.2, volume);
    await new Promise(r => setTimeout(r, 100));
    await this.playBeep(440, 0.2, volume);
  }

  // Generate critical alarm sound
  private async playCritical(volume: number): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await this.playBeep(1000, 0.1, volume);
      await this.playBeep(800, 0.1, volume);
    }
  }

  // Play custom sound
  private playCustomSound(volume: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const customSound = this.settings.customSounds[this.settings.activeCustomSoundIndex];
      if (!customSound) {
        // Fallback to beep if no custom sound
        this.playBeep(800, 0.3, volume).then(resolve);
        return;
      }

      try {
        const audio = new Audio(customSound.data);
        audio.volume = volume;
        audio.onended = () => resolve();
        audio.onerror = () => {
          console.error('Failed to play custom sound, falling back to beep');
          this.playBeep(800, 0.3, volume).then(resolve);
        };
        audio.play().catch(() => {
          this.playBeep(800, 0.3, volume).then(resolve);
        });
      } catch {
        this.playBeep(800, 0.3, volume).then(resolve);
      }
    });
  }

  async playSound(type?: SoundType): Promise<void> {
    if (!this.settings.enabled || this.isPlaying) return;

    this.isPlaying = true;
    const soundType = type || this.settings.soundType;
    const volume = this.settings.volume;

    try {
      // Resume audio context if suspended (browser autoplay policy)
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      for (let i = 0; i < this.settings.repeatCount; i++) {
        switch (soundType) {
          case 'beep':
            await this.playBeep(800, 0.3, volume);
            break;
          case 'alarm':
            await this.playAlarm(volume);
            break;
          case 'chime':
            await this.playChime(volume);
            break;
          case 'warning':
            await this.playWarning(volume);
            break;
          case 'critical':
            await this.playCritical(volume);
            break;
          case 'custom':
            await this.playCustomSound(volume);
            break;
        }

        if (i < this.settings.repeatCount - 1) {
          await new Promise(r => setTimeout(r, this.settings.repeatInterval));
        }
      }
    } finally {
      this.isPlaying = false;
    }
  }

  // Play sound based on severity
  async playAlertSound(severity: AlertSeverity): Promise<void> {
    const soundMap: Record<AlertSeverity, SoundType> = {
      info: 'chime',
      warning: 'warning',
      error: 'alarm',
      critical: 'critical',
    };
    await this.playSound(soundMap[severity]);
  }

  // Play NG alert sound
  async playNGAlert(): Promise<void> {
    await this.playSound('alarm');
  }

  // Test sound
  async testSound(type?: SoundType): Promise<void> {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = true;
    await this.playSound(type);
    this.settings.enabled = wasEnabled;
  }

  // Test custom sound by index
  async testCustomSound(index: number): Promise<void> {
    const customSound = this.settings.customSounds[index];
    if (!customSound) return;

    const wasEnabled = this.settings.enabled;
    this.settings.enabled = true;
    
    try {
      const audio = new Audio(customSound.data);
      audio.volume = this.settings.volume;
      await audio.play();
    } catch (e) {
      console.error('Failed to test custom sound:', e);
    }

    this.settings.enabled = wasEnabled;
  }

  // Mute/unmute
  setMuted(muted: boolean): void {
    this.settings.enabled = !muted;
    this.saveSettings({ enabled: !muted });
  }

  isMuted(): boolean {
    return !this.settings.enabled;
  }
}

// Singleton instance
export const alertSoundService = new AlertSoundService();
