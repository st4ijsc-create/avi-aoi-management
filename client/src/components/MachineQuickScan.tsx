/**
 * MachineQuickScan — "Quét máy" (scan a machine) entry for shop-floor users.
 *
 * Minimum-effort flow (docs 05 §0 "Ngữ cảnh tự nhận" + §3 ①):
 *   scan a QR/barcode on the machine → open the AI assistant ALREADY scoped to
 *   that machine ( /ai-chat?machine=<code> ). Hands-free friendly; pairs with
 *   the chat's existing voice input.
 *
 * Works on EVERY browser via a two-tier camera decoder:
 *   - TIER 1 (fast, native): the BarcodeDetector API over a getUserMedia camera
 *     stream — used when it exists AND advertises qr_code support (Chromium /
 *     Android Chrome / Edge). Both QR and common 1D formats requested.
 *   - TIER 2 (fallback): @zxing/browser's BrowserMultiFormatReader on the same
 *     single <video> element — used on Safari / Firefox / desktop where
 *     BarcodeDetector is missing or lacks qr_code. zxing owns the device and
 *     prefers the environment/back camera.
 *   Exactly one tier runs at a time (picked per capability) — never both.
 *   - Optional Web NFC via NDEFReader (Android Chrome only).
 *   - Everything is feature-detected. When no camera / NFC is available or
 *     permission is denied — or a decoder fails to init — we fall back to a
 *     manual code input + a machine picker (from the existing trpc.machine.list
 *     query) so the flow always works.
 *
 * The QR payload may be the raw machine code OR a URL that embeds the code
 * (e.g. https://host/ai-chat?machine=AVI-001  or  .../machine/AVI-001) — both
 * are parsed by extractMachineCode().
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ScanLine, Camera, Nfc, AlertCircle, Loader2, Search } from "lucide-react";

interface MachineLite {
  id: number;
  code: string;
  name: string;
}

interface MachineQuickScanProps {
  /** Optional trigger override. When omitted a default "Quét máy" button renders. */
  className?: string;
  /** Visual variant for the default trigger button. */
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  /** Render only the dialog, controlled externally (no built-in trigger). */
  trigger?: React.ReactNode;
}

/**
 * Extract a machine code from a scanned/typed payload. Accepts:
 *   - a raw code:                       "AVI-001"
 *   - a URL with ?machine= / ?code=:    "https://h/ai-chat?machine=AVI-001"
 *   - a URL path ".../machine/<code>":  "https://h/machine/AVI-001"
 * Returns a trimmed code or "" when nothing usable is found.
 */
export function extractMachineCode(raw: string): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  // Try URL parsing first.
  try {
    const url = new URL(value);
    const q =
      url.searchParams.get("machine") ||
      url.searchParams.get("code") ||
      url.searchParams.get("machineCode");
    if (q) return q.trim();
    const segs = url.pathname.split("/").filter(Boolean);
    const mi = segs.findIndex((s) => s.toLowerCase() === "machine" || s.toLowerCase() === "machines");
    if (mi >= 0 && segs[mi + 1]) return decodeURIComponent(segs[mi + 1]).trim();
    // URL but no recognizable param → fall back to last path segment.
    if (segs.length > 0) return decodeURIComponent(segs[segs.length - 1]).trim();
  } catch {
    // Not a URL — treat as a raw code (strip an accidental "machine:" prefix).
  }
  return value.replace(/^machine[:=]/i, "").trim();
}

export default function MachineQuickScan({
  className,
  variant = "outline",
  size = "default",
  trigger,
}: MachineQuickScanProps) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  // Camera / scanning state
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null); // TIER 1 (BarcodeDetector) stream
  const rafRef = useRef<number | null>(null); // TIER 1 decode loop
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const zxingControlsRef = useRef<IScannerControls | null>(null); // TIER 2 (zxing) controls
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const nfcAbortRef = useRef<AbortController | null>(null);
  const resolvedRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");
  const [nfcActive, setNfcActive] = useState(false);

  // Capability: a camera is needed for either decoder tier. The choice between
  // the native BarcodeDetector (tier 1) and @zxing/browser (tier 2) is resolved
  // asynchronously at scan-start (we must await getSupportedFormats()).
  const hasCamera =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const hasNfc = typeof window !== "undefined" && "NDEFReader" in window;

  // Machine list — powers the picker AND code resolution (no getByCode query exists).
  const { data: machines } = trpc.machine.list.useQuery(undefined, { enabled: open });
  const machineList = (machines ?? []) as MachineLite[];

  // ─── Resolve a scanned/typed code → navigate to the scoped assistant ──────────
  const resolveAndGo = useCallback(
    (rawValue: string) => {
      if (resolvedRef.current) return;
      const code = extractMachineCode(rawValue);
      if (!code) {
        setErrorKey("machineScan.errorNoCode");
        return;
      }
      // Best-effort validation against the known machine list (case-insensitive).
      // If the list isn't loaded yet we still navigate — AIChatPage re-validates.
      const match = machineList.find((m) => m.code.toLowerCase() === code.toLowerCase());
      const finalCode = match?.code ?? code;
      resolvedRef.current = true;
      const q = t("machineScan.statusQuestion", "Tình trạng máy {{code}}?", { code: finalCode });
      setOpen(false);
      navigate(`/ai-chat?machine=${encodeURIComponent(finalCode)}&q=${encodeURIComponent(q)}`);
    },
    [machineList, navigate, t],
  );

  // ─── Camera teardown (stops BOTH tiers + releases tracks) ─────────────────────
  const stopCamera = useCallback(() => {
    // TIER 1: cancel the RAF decode loop + stop the getUserMedia stream.
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    // TIER 2: zxing owns its own stream — stop() ends the loop AND releases it.
    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        /* ignore */
      }
      zxingControlsRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  // ─── Capability tier: native BarcodeDetector w/ qr_code support? ───────────────
  // Returns the format list to use, or null when the native API is unusable
  // (missing, or no qr_code) → caller falls back to the zxing tier.
  const resolveNativeFormats = useCallback(async (): Promise<string[] | null> => {
    if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      if (!supported.includes("qr_code")) return null; // tier 2 instead
      return ["qr_code", "code_128", "code_39", "ean_13", "data_matrix"].filter(
        (f) => supported.includes(f),
      );
    } catch {
      return null;
    }
  }, []);

  // ─── TIER 2: @zxing/browser continuous decode on the shared <video> ───────────
  const startZxing = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (!zxingReaderRef.current) {
        // BrowserMultiFormatReader covers QR + common 1D, matching tier 1.
        zxingReaderRef.current = new BrowserMultiFormatReader();
      }
      // deviceId undefined → zxing picks a device, preferring the environment
      // (back) camera when available, and manages the stream on `video`.
      const controls = await zxingReaderRef.current.decodeFromVideoDevice(
        undefined,
        video,
        (result, _err, ctrl) => {
          if (resolvedRef.current) return;
          const text = result?.getText()?.trim();
          if (text) {
            ctrl.stop();
            zxingControlsRef.current = null;
            stopCamera();
            resolveAndGo(text);
          }
          // decode errors are reported every frame while searching — ignore them.
        },
      );
      zxingControlsRef.current = controls;
      setScanning(true);
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setErrorKey("machineScan.errorPermission");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setErrorKey("machineScan.errorNoCamera");
      } else {
        setErrorKey("machineScan.errorCamera");
      }
      stopCamera();
    }
  }, [resolveAndGo, stopCamera]);

  // ─── TIER 1: native BarcodeDetector over a getUserMedia stream + RAF loop ─────
  const startBarcodeDetector = useCallback(
    async (formats: string[]) => {
      try {
        if (!detectorRef.current) {
          detectorRef.current = new BarcodeDetector(
            formats.length > 0 ? { formats } : undefined,
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((tk) => tk.stop());
          streamRef.current = null;
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        setScanning(true);

        const tick = async () => {
          const det = detectorRef.current;
          const v = videoRef.current;
          if (!det || !v || v.readyState < 2) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          try {
            const codes = await det.detect(v);
            const hit = codes.find((c) => c.rawValue && c.rawValue.trim());
            if (hit) {
              stopCamera();
              resolveAndGo(hit.rawValue);
              return;
            }
          } catch {
            // transient decode error — keep scanning
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setErrorKey("machineScan.errorPermission");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setErrorKey("machineScan.errorNoCamera");
        } else {
          setErrorKey("machineScan.errorCamera");
        }
        stopCamera();
      }
    },
    [resolveAndGo, stopCamera],
  );

  // ─── Camera entry point: pick a tier, then start exactly one ──────────────────
  const startCamera = useCallback(async () => {
    setErrorKey(null);
    if (!hasCamera) {
      setErrorKey("machineScan.errorNoCamera");
      return;
    }
    // Make sure no prior tier is still running before (re)starting.
    stopCamera();
    const nativeFormats = await resolveNativeFormats();
    if (nativeFormats) {
      await startBarcodeDetector(nativeFormats);
    } else {
      await startZxing();
    }
  }, [hasCamera, resolveNativeFormats, startBarcodeDetector, startZxing, stopCamera]);

  // ─── Optional Web NFC ─────────────────────────────────────────────────────────
  const startNfc = useCallback(async () => {
    if (!hasNfc || !window.NDEFReader) return;
    setErrorKey(null);
    try {
      const reader = new window.NDEFReader();
      const abort = new AbortController();
      nfcAbortRef.current = abort;
      reader.addEventListener("reading", (ev: NDEFReadingEvent) => {
        // Prefer a text/url record; fall back to the tag serial number.
        let payload = "";
        for (const rec of ev.message.records) {
          if (rec.data) {
            try {
              const decoder = new TextDecoder(rec.encoding || "utf-8");
              payload = decoder.decode(rec.data).trim();
            } catch {
              /* ignore */
            }
          }
          if (payload) break;
        }
        if (!payload) payload = ev.serialNumber || "";
        if (payload) {
          stopNfc();
          resolveAndGo(payload);
        }
      });
      reader.addEventListener("readingerror", () => {
        setErrorKey("machineScan.errorNfc");
      });
      await reader.scan({ signal: abort.signal });
      setNfcActive(true);
    } catch {
      setErrorKey("machineScan.errorNfc");
      setNfcActive(false);
    }
  }, [hasNfc, resolveAndGo]);

  const stopNfc = useCallback(() => {
    nfcAbortRef.current?.abort();
    nfcAbortRef.current = null;
    setNfcActive(false);
  }, []);

  // ─── Open / close lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      resolvedRef.current = false;
      setErrorKey(null);
      setManualCode("");
      setPickerQuery("");
      // Auto-start the camera when one is available; otherwise show fallback.
      // startCamera() resolves the decoder tier (native vs zxing) internally.
      if (hasCamera) void startCamera();
    } else {
      stopCamera();
      stopNfc();
    }
    return () => {
      stopCamera();
      stopNfc();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filteredMachines = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const base = machineList;
    if (!q) return base.slice(0, 50);
    return base
      .filter((m) => m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [machineList, pickerQuery]);

  const showCameraFallback = !hasCamera || errorKey != null;

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button
          type="button"
          variant={variant}
          size={size}
          className={className}
          onClick={() => setOpen(true)}
        >
          <ScanLine className="h-4 w-4 mr-1.5" />
          {t("machineScan.scanButton", "Quét máy")}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-primary" />
              {t("machineScan.title", "Quét máy để hỏi AI")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "machineScan.description",
                "Quét mã QR trên máy để mở trợ lý đã gắn đúng máy đó. Bạn cũng có thể nhập mã hoặc chọn từ danh sách.",
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Camera viewport (shown whenever a camera is available — the decoder
              tier, native BarcodeDetector or zxing, is chosen at scan-start). */}
          {hasCamera && (
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                muted
                playsInline
              />
              {/* Scan frame overlay */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-40 w-40 rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
              {scanning && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("machineScan.scanning", "Đang quét...")}
                </div>
              )}
              {!scanning && !errorKey && (
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90"
                >
                  <Camera className="h-8 w-8" />
                  <span className="text-sm">{t("machineScan.tapToScan", "Chạm để bật camera")}</span>
                </button>
              )}
            </div>
          )}

          {/* Error / permission messaging */}
          {errorKey && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{t(errorKey, t("machineScan.errorCamera", "Không thể quét. Vui lòng nhập mã máy bên dưới."))}</span>
            </div>
          )}

          {/* Optional NFC (Android Chrome only) */}
          {hasNfc && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => (nfcActive ? stopNfc() : void startNfc())}
            >
              <Nfc className={cn("h-4 w-4 mr-1.5", nfcActive && "animate-pulse text-primary")} />
              {nfcActive
                ? t("machineScan.nfcWaiting", "Đang chờ chạm thẻ NFC...")
                : t("machineScan.nfcButton", "Chạm NFC")}
            </Button>
          )}

          {/* Manual code entry — always available as a fallback */}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (manualCode.trim()) resolveAndGo(manualCode);
            }}
          >
            <Input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder={t("machineScan.manualPlaceholder", "Nhập mã máy (vd: AVI-001)")}
              aria-label={t("machineScan.manualPlaceholder", "Nhập mã máy (vd: AVI-001)")}
            />
            <Button type="submit" disabled={!manualCode.trim()}>
              {t("machineScan.go", "Mở")}
            </Button>
          </form>

          {/* Machine picker fallback (search the existing list) */}
          {(showCameraFallback || machineList.length > 0) && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder={t("machineScan.pickerPlaceholder", "Tìm máy theo mã hoặc tên...")}
                  className="pl-8"
                  aria-label={t("machineScan.pickerPlaceholder", "Tìm máy theo mã hoặc tên...")}
                />
              </div>
              {filteredMachines.length > 0 && (
                <ScrollArea className="h-40 rounded-md border">
                  <div className="p-1">
                    {filteredMachines.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => resolveAndGo(m.code)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                      >
                        <span className="font-medium truncate">{m.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{m.code}</span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
