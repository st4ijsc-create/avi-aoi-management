/**
 * Minimal ambient declarations for the browser APIs used by MachineQuickScan:
 *   - BarcodeDetector  (QR / barcode reading from a camera frame)  — Chromium
 *   - NDEFReader       (Web NFC tag reading)                        — Android Chrome
 *
 * The standard TS DOM lib does not ship these yet, so we declare only the small
 * surface we actually use. All call sites still feature-detect at runtime
 * (`"BarcodeDetector" in window`, `"NDEFReader" in window`) and degrade
 * gracefully when the API is missing — these types just keep `tsc` GREEN.
 */

export {};

declare global {
  // ─── BarcodeDetector ────────────────────────────────────────────────────────
  interface DetectedBarcode {
    rawValue: string;
    format: string;
    boundingBox?: DOMRectReadOnly;
  }

  interface BarcodeDetectorOptions {
    formats?: string[];
  }

  class BarcodeDetector {
    constructor(options?: BarcodeDetectorOptions);
    static getSupportedFormats(): Promise<string[]>;
    detect(
      source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap | Blob,
    ): Promise<DetectedBarcode[]>;
  }

  // ─── Web NFC (NDEFReader) ────────────────────────────────────────────────────
  interface NDEFRecord {
    recordType: string;
    mediaType?: string;
    id?: string;
    data?: DataView;
    encoding?: string;
    lang?: string;
  }

  interface NDEFMessage {
    records: ReadonlyArray<NDEFRecord>;
  }

  interface NDEFReadingEvent extends Event {
    serialNumber: string;
    message: NDEFMessage;
  }

  interface NDEFReaderEventMap {
    reading: NDEFReadingEvent;
    readingerror: Event;
  }

  class NDEFReader extends EventTarget {
    constructor();
    scan(options?: { signal?: AbortSignal }): Promise<void>;
    addEventListener<K extends keyof NDEFReaderEventMap>(
      type: K,
      listener: (this: NDEFReader, ev: NDEFReaderEventMap[K]) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void;
  }

  interface Window {
    BarcodeDetector?: typeof BarcodeDetector;
    NDEFReader?: typeof NDEFReader;
  }
}
