/**
 * doc 38 Đợt T-2 — Zmotion ZAux (zauxdll.dll) FFI BINDING (code-now, HW-gated).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Binds the four zauxdll.dll exports the DPC deploy path needs, transcribed from
 * Zmcaux.cs (D:/SOURCES/AI Local/Manual/Zmotion/Zmotion DLL/Zmcaux.cs) — all __stdcall,
 * CharSet.Ansi, returning Int32 (0 = ERR_OK):
 *     ZAux_OpenEth(const char* ipaddr, _Out_ void** phandle)
 *     ZAux_BasDown(void* handle, const char* Filename, uint32 run_mode)   // .bas → ZAR → download+run
 *     ZAux_ZarDown(void* handle, const char* Filename, uint32 run_mode)   // precompiled .zar
 *     ZAux_Close(void* handle)
 *
 * LAZY / OPTIONAL koffi (NO package.json dependency): koffi is imported at CALL time via a
 * VARIABLE specifier so neither `tsc` nor the bundler statically resolves it — the app builds
 * and runs on machines WITHOUT koffi. When koffi is absent this throws a precise error and the
 * adapter degrades to an HONEST dry-run (deploy → ok:false with the reason), NEVER a fake
 * success. zmotionBasicAdapter loads THIS module via `import("./zauxFfi")` (also a variable
 * specifier), so its own build never depends on koffi either.
 *
 * OWNER INSTALL (only on the machine physically wired to a Zmotion controller):
 *     1. npm i koffi            # native FFI; prebuilt binaries, no compiler needed
 *     2. copy zauxdll.dll (+ its runtime DLLs) onto the host — 64-bit DLL for 64-bit Node.
 *     3. set ZAUXDLL_PATH=C:\absolute\path\to\zauxdll.dll   (read by the adapter)
 *     4. set DPC_DEPLOY_ENABLED=true and deploy WITH HITL sign-off (four-eyes) to arm the path.
 * Until then everything stays flag-OFF and dry-run.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { ZauxBinding, ZmcRunMode } from "./zmotionBasicAdapter";

// koffi is untyped here (optional peer). Keep the surface we use as a loose shape.
interface KoffiLib {
  func(prototype: string): (...args: unknown[]) => number;
}
interface KoffiModule {
  load(dllPath: string): KoffiLib;
}

/** Lazily import koffi via a variable specifier so it is never statically resolved. */
async function loadKoffi(): Promise<KoffiModule | null> {
  const spec = "koffi";
  const mod = await import(spec).catch(() => null);
  if (!mod) return null;
  // koffi is exported as the module default in CJS interop, or as the namespace itself.
  const candidate = (mod as { default?: unknown }).default ?? mod;
  return (candidate as KoffiModule) ?? null;
}

/**
 * Build a ZauxBinding over the real zauxdll.dll at `dllPath`. Async because koffi is loaded
 * lazily. Throws a precise Error when koffi is not installed (→ adapter honest dry-run) or the
 * DLL cannot be loaded. Every ZAux_* export returns Int32 (0 = ERR_OK); we surface it verbatim.
 */
export async function loadZauxBinding(dllPath: string): Promise<ZauxBinding> {
  const koffi = await loadKoffi();
  if (!koffi) {
    throw new Error(
      "koffi is not installed — run `npm i koffi` on the HW-wired host to enable real ZAux deploy (kept out of package.json on purpose; adapter stays dry-run until installed).",
    );
  }

  const lib = koffi.load(dllPath);
  // Prototype-string form (koffi) — `_Out_ void**` marshals the handle into a JS array holder.
  const OpenEth = lib.func("int __stdcall ZAux_OpenEth(const char* ipaddr, _Out_ void** phandle)");
  const BasDown = lib.func("int __stdcall ZAux_BasDown(void* handle, const char* Filename, uint32_t run_mode)");
  const ZarDown = lib.func("int __stdcall ZAux_ZarDown(void* handle, const char* Filename, uint32_t run_mode)");
  const Close = lib.func("int __stdcall ZAux_Close(void* handle)");

  return {
    openEth(ip: string): { code: number; handle: unknown } {
      const out: unknown[] = [null];
      const code = OpenEth(ip, out);
      return { code, handle: out[0] };
    },
    basDown(handle: unknown, file: string, runMode: ZmcRunMode): number {
      return BasDown(handle, file, runMode);
    },
    zarDown(handle: unknown, file: string, runMode: ZmcRunMode): number {
      return ZarDown(handle, file, runMode);
    },
    close(handle: unknown): number {
      return Close(handle);
    },
  };
}
