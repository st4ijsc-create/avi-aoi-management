/**
 * Pinned TLS socket — JS side of android/.../PinnedTlsSocketModule.kt (doc 81 Đợt 7 task J2).
 *
 * MQTT over TLS to the built-in broker, whose site certificate is self-signed: the ONLY trust decision is the
 * certificate's SHA-256 fingerprint, entered by the technician (admin screen → tablet Settings). The native side
 * refuses the handshake for any other certificate (error code CERT_CHANGED) and refuses writes until the pinned
 * handshake completed, so the CONNECT carrying the device password can never leave before the certificate is
 * verified. There is deliberately NO option to skip verification.
 *
 * The object mimics the parts of a react-native-tcp-socket Socket that mqttService's stream wrapper uses
 * (on/once/emit/write/end/destroy; events connect/data/error/close), so the same wrapper (write buffering until
 * 'connect', error/close handling) drives both the plaintext and the pinned TLS transport.
 */
import { DeviceEventEmitter, EmitterSubscription, NativeModules } from 'react-native';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

export const PINNED_TLS_EVENT = 'PinnedTlsSocketEvent';

/** Error code of a refused handshake: the broker presented a certificate other than the pinned one. */
export const CERT_CHANGED = 'CERT_CHANGED';

interface PinnedTlsNative {
  connect(id: number, host: string, port: number, pinSha256: string, timeoutMs: number): void;
  write(id: number, base64: string): void;
  close(id: number): void;
}

function nativeModule(): PinnedTlsNative | null {
  const m = (NativeModules as Record<string, unknown>).PinnedTlsSocket as Partial<PinnedTlsNative> | undefined;
  if (m && typeof m.connect === 'function' && typeof m.write === 'function' && typeof m.close === 'function') {
    return m as PinnedTlsNative;
  }
  return null;
}

/** Is the pinned TLS transport available in this build (Android native module present)? */
export function isPinnedTlsAvailable(): boolean {
  return nativeModule() !== null;
}

/**
 * What the technician typed/pasted ("AB:CD:…", "ab cd …", "abcd…") ⇒ 64 lowercase hex digits; anything that is not
 * exactly one SHA-256 fingerprint ⇒ null. Same rule as PinnedTlsCore.normalizeFingerprint (Kotlin).
 */
export function normalizeCertFingerprint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const hex = raw.replace(/[\s:]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** Display form `AB:CD:…` (what the admin screen shows). */
export function formatCertFingerprint(hex: string): string {
  return (hex.toUpperCase().match(/../g) ?? []).join(':');
}

type NativeEvent = { id: number; type: 'connect' | 'data' | 'error' | 'close'; data?: string; code?: string; message?: string; hadError?: boolean };

const live = new Map<number, PinnedTlsSocket>();
let subscription: EmitterSubscription | null = null;
let nextId = 1;

function ensureSubscribed(): void {
  if (subscription) return;
  subscription = DeviceEventEmitter.addListener(PINNED_TLS_EVENT, (ev: NativeEvent) => {
    const s = ev && live.get(ev.id);
    if (s) s._onNative(ev);
  });
}

export interface PinnedTlsConnectOptions {
  host: string;
  port: number;
  /** SHA-256 fingerprint of the broker certificate (any accepted form; normalised here). */
  pinSha256: string;
  timeout?: number;
}

export class PinnedTlsSocket extends EventEmitter {
  readonly _id: number;
  private native: PinnedTlsNative;
  private ended = false;
  private closeSeen = false;

  constructor(opts: PinnedTlsConnectOptions, onConnect?: () => void) {
    super();
    const native = nativeModule();
    if (!native) throw Object.assign(new Error('TLS_PIN_UNSUPPORTED: pinned TLS is not available on this device'), { code: 'TLS_PIN_UNSUPPORTED' });
    const pin = normalizeCertFingerprint(opts.pinSha256);
    if (!pin) throw Object.assign(new Error('BAD_PIN: the certificate fingerprint must be 64 hex digits (SHA-256)'), { code: 'BAD_PIN' });
    this.native = native;
    this._id = nextId++;
    if (onConnect) this.once('connect', onConnect);
    ensureSubscribed();
    live.set(this._id, this);
    native.connect(this._id, String(opts.host), Number(opts.port), pin, Number(opts.timeout ?? 30000));
  }

  /** @internal — native event for this socket. */
  _onNative(ev: NativeEvent): void {
    switch (ev.type) {
      case 'connect':
        this.emit('connect');
        break;
      case 'data':
        if (typeof ev.data === 'string') this.emit('data', Buffer.from(ev.data, 'base64'));
        break;
      case 'error': {
        const code = ev.code || 'TLS_ERROR';
        const msg = code === CERT_CHANGED ? 'broker certificate changed (fingerprint mismatch)' : (ev.message || code);
        this.emit('error', Object.assign(new Error(`${code}: ${msg}`), { code }));
        break;
      }
      case 'close':
        if (this.closeSeen) return;
        this.closeSeen = true;
        live.delete(this._id);
        this.emit('close', !!ev.hadError);
        break;
    }
  }

  write(chunk: unknown, encoding?: unknown, cb?: unknown): boolean {
    const done = typeof encoding === 'function' ? encoding : cb;
    if (this.ended) {
      if (typeof done === 'function') (done as (e?: Error) => void)(new Error('socket closed'));
      return false;
    }
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : Buffer.from(String(chunk), typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
    this.native.write(this._id, buf.toString('base64'));
    if (typeof done === 'function') (done as () => void)();
    return true;
  }

  end(data?: unknown): this {
    if (data !== undefined && data !== null) this.write(data);
    this.destroy();
    return this;
  }

  destroy(): this {
    if (!this.ended) {
      this.ended = true;
      this.native.close(this._id);
    }
    return this;
  }
}

/** Same call shape as TcpSocket.createConnection(options, onConnect). */
export function createPinnedTlsConnection(opts: PinnedTlsConnectOptions, onConnect?: () => void): PinnedTlsSocket {
  return new PinnedTlsSocket(opts, onConnect);
}
