import * as React from "react"

import { LogTag, Sheet, type LogLevel } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { useLanguage, useT } from "@/i18n"
import { traceStatusTone, useInspectorStream, type StatusTone } from "@/lib/inspector"

/** A locally-originated log row (control actions — Start/Pause/E-STOP/Reset) — these carry a REAL
 * bilingual message pair (unlike the trace rows below, which mirror raw HTTP method/path/status —
 * language-agnostic wire data, not prose). */
export interface HmiLocalLogEvent {
  id: string
  /** Epoch ms. */
  at: number
  level: LogLevel
  vi: string
  en: string
}

const TONE_TO_LEVEL: Record<StatusTone, LogLevel> = {
  ok: "ok",
  warn: "warn",
  danger: "error",
  neutral: "info",
}

interface LogRow {
  id: string
  at: number
  level: LogLevel
  primary: string
  gloss?: string
}

function formatClock(at: number): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString(undefined, { hour12: false })
}

interface SystemLogProps {
  machineCode: string
  localEvents: HmiLocalLogEvent[]
  className?: string
}

/**
 * System log (spec §5): monospace, `LogTag` level column, newest-first, fed live by the WS trace
 * stream (`useInspectorStream`, filtered to this machine's own events) merged with local
 * control-action events (E-STOP/Reset/Start/Pause). Panel scrolls internally (`hmi-scroll`) — newest
 * rows land at the top, so no explicit "scroll to bottom" logic is needed to keep the latest event in
 * view.
 */
export function SystemLog({ machineCode, localEvents, className }: SystemLogProps) {
  const t = useT()
  const gloss = useGloss()
  const { language } = useLanguage()
  const { events, connectionState } = useInspectorStream()

  const rows = React.useMemo<LogRow[]>(() => {
    const traceRows: LogRow[] = events
      .filter((e) => e.machineCode === machineCode)
      .slice(0, 150)
      .map((e) => ({
        id: `trace-${e.id}`,
        at: Date.parse(e.at) || Date.now(),
        level: TONE_TO_LEVEL[traceStatusTone(e)],
        // Path only in the primary column (the endpoint is the identifying detail on a local exhibit
        // engine where almost every call is a POST) — method/status/latency move to the gloss column
        // so the truncated primary text doesn't drown the one field that actually varies.
        primary: e.path,
        gloss: `${e.method} · ${e.status === 0 ? "QUEUED" : e.status} · ${e.latencyMs}ms${e.duplicate ? " · DUP" : ""}${e.error ? ` · ${e.error}` : ""}`,
      }))

    const localRows: LogRow[] = localEvents.map((ev) => ({
      id: ev.id,
      at: ev.at,
      level: ev.level,
      primary: language === "vi" ? ev.vi : ev.en,
      gloss: language === "vi" ? ev.en : ev.vi,
    }))

    return [...localRows, ...traceRows].sort((a, b) => b.at - a.at).slice(0, 200)
  }, [events, localEvents, machineCode, language])

  return (
    <Sheet
      className={className}
      title={t("hmi.log.title")}
      titleEn={gloss("hmi.log.title")}
      headerRight={
        <span className="hmi-micro">
          {connectionState === "open" ? "WS" : connectionState === "connecting" ? "…" : "OFF"}
        </span>
      }
      bodyClassName="flex flex-1 min-h-0 flex-col p-0"
    >
      <div
        tabIndex={0}
        role="log"
        aria-label={t("hmi.log.title")}
        className="hmi-scroll flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
      >
        {rows.length === 0 ? (
          <p className="p-4 text-center text-xs text-text-muted">{t("hmi.log.empty")}</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-0.5 border-b border-border/60 px-3 py-1.5 text-[11px]">
                <span className="flex items-center gap-2">
                  <span className="w-[64px] shrink-0 font-mono tabular-nums text-text-muted">{formatClock(row.at)}</span>
                  <LogTag level={row.level} />
                  <span className="min-w-0 flex-1 truncate font-mono text-text-body">{row.primary}</span>
                </span>
                {row.gloss ? <span className="hmi-micro truncate pl-[86px] normal-case">{row.gloss}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
