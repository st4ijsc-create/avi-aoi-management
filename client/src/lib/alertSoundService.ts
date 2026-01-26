// Alert Sound Service - Web Audio API based sound notifications
// Supports multiple sound types for different alert severities

export type SoundType = 'beep' | 'alarm' | 'chime' | 'warning' | 'critical';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

interface SoundSettings {
  enabled: boolean;
  volume: number; // 0-1
  soundType: SoundType;
  repeatCount: number;
  repeatInterval: number; // ms
}

const DEFAULT_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.7,
  soundType: 'beep',
  repeatCount: 1,
  repeatInterval: 500,
};

class AlertSoundService {
  private audioContext: AudioContext | null = null;
  private settings: SoundSettings = DEFAULT_SETTINGS;
  private isPlaying = false;

  constructor() {
    this.loadSettings();
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

  saveSettings(settings: Partial<SoundSettings>): void {
    this.settings = { ...this.settings, ...settings };
    localStorage.setItem('alertSoundSettings', JSON.stringify(this.settings));
  }

  getSettings(): SoundSettings {
    return { ...this.settings };
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
