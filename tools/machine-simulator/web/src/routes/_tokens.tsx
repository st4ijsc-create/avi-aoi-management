import * as React from "react"
import { motion } from "framer-motion"
import {
  Activity,
  Eye,
  Gauge,
  Info,
  Moon,
  Radio,
  Sun,
  Timer,
} from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"
import { accent, border, navy, status, surface, text } from "@/theme/tokens"
import { fadeSlideUp, staggerContainer, staggerItem } from "@/theme/motion"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// Mock domain data — deterministic, no Math.random(), so screenshots reproduce.
// ---------------------------------------------------------------------------

const throughputSpark = [120, 132, 128, 145, 150, 148, 162, 158, 171, 168, 182, 190].map(
  (v, i) => ({ i, v })
)

const telemetryData = [
  { t: "09:00", cycle: 5.1, target: 4.8 },
  { t: "09:05", cycle: 4.9, target: 4.8 },
  { t: "09:10", cycle: 5.3, target: 4.8 },
  { t: "09:15", cycle: 4.7, target: 4.8 },
  { t: "09:20", cycle: 4.6, target: 4.8 },
  { t: "09:25", cycle: 4.8, target: 4.8 },
  { t: "09:30", cycle: 5.0, target: 4.8 },
  { t: "09:35", cycle: 4.5, target: 4.8 },
  { t: "09:40", cycle: 4.4, target: 4.8 },
  { t: "09:45", cycle: 4.6, target: 4.8 },
  { t: "09:50", cycle: 4.3, target: 4.8 },
  { t: "09:55", cycle: 4.2, target: 4.8 },
]

const cycleLog = [
  { machine: "AOI-07", cycle: 18422, result: "ok" as const, duration: "4.6s", ts: "09:58:12" },
  { machine: "SCR-12", cycle: 9130, result: "ntf" as const, duration: "3.1s", ts: "09:58:05" },
  { machine: "DISP-03", cycle: 15208, result: "ok" as const, duration: "5.2s", ts: "09:57:59" },
  { machine: "AOI-07", cycle: 18421, result: "ng" as const, duration: "4.8s", ts: "09:57:44" },
  { machine: "MTR-05", cycle: 7745, result: "ok" as const, duration: "6.0s", ts: "09:57:38" },
  { machine: "SCR-12", cycle: 9129, result: "ok" as const, duration: "3.0s", ts: "09:57:20" },
]

const resultMeta = {
  ok: { status: "ok" as const, label: "OK" },
  ntf: { status: "warn" as const, label: "NTF" },
  ng: { status: "danger" as const, label: "NG" },
}

const typeScale = [
  { px: 12, cls: "text-xs", sample: "Caption / meta" },
  { px: 13, cls: "text-[13px]", sample: "Dense UI label" },
  { px: 14, cls: "text-sm", sample: "Body (default)" },
  { px: 16, cls: "text-base", sample: "Body — comfortable" },
  { px: 18, cls: "text-lg", sample: "Section lead-in" },
  { px: 20, cls: "text-xl", sample: "Card title" },
  { px: 24, cls: "text-2xl", sample: "Panel heading" },
  { px: 30, cls: "text-3xl", sample: "Page title" },
  { px: 36, cls: "text-4xl", sample: "Hero metric" },
]

type Swatch = { name: string; hex: string; className: string }

const surfaceSwatches: Swatch[] = [
  { name: "surface-base", hex: surface.base, className: "bg-surface-base border border-border" },
  { name: "surface-subtle", hex: surface.subtle, className: "bg-surface-subtle border border-border" },
  { name: "surface-muted", hex: surface.muted, className: "bg-surface-muted border border-border" },
  { name: "border", hex: border.DEFAULT, className: "bg-border" },
  { name: "border-strong", hex: border.strong, className: "bg-border-strong" },
]

const navySwatches: Swatch[] = [
  { name: "navy-50", hex: navy[50], className: "bg-navy-50 border border-border" },
  { name: "navy-100", hex: navy[100], className: "bg-navy-100 border border-border" },
  { name: "navy-500", hex: navy[500], className: "bg-navy-500" },
  { name: "navy-600 (primary)", hex: navy[600], className: "bg-navy-600" },
  { name: "navy-700", hex: navy[700], className: "bg-navy-700" },
  { name: "navy-800", hex: navy[800], className: "bg-navy-800" },
  { name: "navy-900", hex: navy[900], className: "bg-navy-900" },
]

const accentSwatches: Swatch[] = [
  { name: "accent-100", hex: accent[100], className: "bg-accent-100 border border-border" },
  { name: "accent-500", hex: accent[500], className: "bg-accent-500" },
  { name: "accent-600", hex: accent[600], className: "bg-accent-600" },
]

const statusSwatches: Swatch[] = [
  { name: "ok", hex: status.ok, className: "bg-ok" },
  { name: "warn", hex: status.warn, className: "bg-warn" },
  { name: "danger", hex: status.danger, className: "bg-danger" },
  { name: "info", hex: status.info, className: "bg-info" },
  { name: "neutral", hex: status.neutral, className: "bg-neutral" },
]

// ---------------------------------------------------------------------------
// Small building blocks local to this showcase
// ---------------------------------------------------------------------------

function useThemeToggle() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  )
  React.useEffect(() => {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark")
    } else {
      document.documentElement.removeAttribute("data-theme")
    }
  }, [theme])
  return [theme, setTheme] as const
}

function SwatchCard({ name, hex, className }: Swatch) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("h-16 rounded-lg ring-1 ring-inset ring-navy-900/5", className)} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-text-strong">{name}</span>
        <span className="font-numeric text-xs text-text-muted">{hex}</span>
      </div>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-[0.14em] text-primary-text uppercase">
        {eyebrow}
      </span>
      <h2 className="text-2xl font-semibold text-text-strong">{title}</h2>
      {description ? (
        <p className="max-w-2xl text-sm text-text-muted">{description}</p>
      ) : null}
    </div>
  )
}

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <motion.section variants={fadeSlideUp} className="flex flex-col gap-5">
      <SectionHeading eyebrow={eyebrow} title={title} description={description} />
      {children}
    </motion.section>
  )
}

function KpiTile({
  icon: Icon,
  label,
  value,
  unit,
  delta,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  unit?: string
  delta?: { label: string; status: "ok" | "warn" | "danger" | "info" | "neutral" }
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <motion.div variants={staggerItem} whileHover={{ scale: 1.01 }}>
      <Card className="h-full">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              {label}
            </span>
            <div className="flex items-center gap-1">
              {hint ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="rounded-full text-text-muted transition-colors hover:text-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
                        aria-label={`About ${label}`}
                      />
                    }
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>{hint}</TooltipContent>
                </Tooltip>
              ) : null}
              <Icon className="size-4 text-navy-500" aria-hidden="true" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-numeric text-3xl font-semibold text-text-strong">
              {value}
            </span>
            {unit ? <span className="text-sm text-text-muted">{unit}</span> : null}
          </div>
          {delta ? (
            <StatusBadge status={delta.status} className="w-fit">
              {delta.label}
            </StatusBadge>
          ) : null}
          {children}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TokensShowcase() {
  const [theme, setTheme] = useThemeToggle()

  return (
    <TooltipProvider>
      <div className="min-h-svh bg-surface-subtle text-text-body">
        <header className="sticky top-0 z-40 border-t-2 border-navy-600 bg-surface-base/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-md bg-navy-600 text-sm font-bold text-white">
                S4
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold text-text-strong">
                  ST4I Design System
                </span>
                <span className="text-xs text-text-muted">
                  Machine Simulator Web UI — white / navy
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="size-3.5" aria-hidden="true" />
              ) : (
                <Moon className="size-3.5" aria-hidden="true" />
              )}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </Button>
          </div>
        </header>

        <motion.main
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-10"
        >
          <motion.div variants={fadeSlideUp} className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold text-text-strong">
              Tokens &amp; components
            </h1>
            <p className="max-w-2xl text-sm text-text-muted">
              Single source of truth for the simulator UI: white-dominant surfaces, a
              navy brand scale, one teal accent, and a semiconductor-style status set.
              Every color and radius below is a token — no hex is hardcoded in a
              component.
            </p>
          </motion.div>

          {/* KPI tiles — the "live control room" read that this system exists to serve */}
          <motion.div
            variants={staggerContainer}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <KpiTile
              icon={Radio}
              label="Machines online"
              value="18"
              unit="/ 20"
              delta={{ label: "+2 since shift start", status: "ok" }}
            />
            <KpiTile
              icon={Activity}
              label="Total cycles"
              value="128,430"
              hint="Completed cycles across the fleet, current shift."
            >
              <div className="-mx-1 h-10">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={throughputSpark} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <Line
                      type="monotone"
                      dataKey="v"
                      stroke={navy[600]}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </KpiTile>
            <KpiTile
              icon={Gauge}
              label="First pass yield"
              value="98.4"
              unit="%"
              delta={{ label: "-0.3% vs yesterday", status: "warn" }}
              hint="Passed boards ÷ total boards, current shift."
            />
            <KpiTile
              icon={Timer}
              label="Avg cycle time"
              value="4.82"
              unit="s"
              delta={{ label: "-0.12s vs yesterday", status: "ok" }}
            />
          </motion.div>

          <Separator />

          <Section
            eyebrow="Palette"
            title="Surfaces, navy, accent, status"
            description="White-dominant surfaces carry the page; navy is the brand + primary-action color; teal is a single restrained accent; status colors are semiconductor-style (never the only signal — always paired with a label)."
          >
            <div className="flex flex-col gap-8">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-text-strong">Surfaces &amp; border</h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
                  {surfaceSwatches.map((s) => (
                    <SwatchCard key={s.name} {...s} />
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-text-strong">Navy scale</h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-7">
                  {navySwatches.map((s) => (
                    <SwatchCard key={s.name} {...s} />
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-text-strong">Accent (teal)</h3>
                <div className="grid grid-cols-3 gap-4 sm:max-w-md">
                  {accentSwatches.map((s) => (
                    <SwatchCard key={s.name} {...s} />
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-text-strong">Status</h3>
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
                  {statusSwatches.map((s) => (
                    <SwatchCard key={s.name} {...s} />
                  ))}
                </div>
                <p className="mt-3 text-xs text-text-muted">
                  These solid hues read fine as dots, borders and 10% tint fills (≥3:1), but a
                  same-hue tint background lowers effective contrast enough that even{" "}
                  <code className="rounded bg-surface-muted px-1 py-0.5 font-numeric">danger</code>{" "}
                  and <code className="rounded bg-surface-muted px-1 py-0.5 font-numeric">info</code>{" "}
                  fall under 4.5:1 as small text on their own tint —{" "}
                  <code className="rounded bg-surface-muted px-1 py-0.5 font-numeric">StatusBadge</code>{" "}
                  labels always route through a darkened{" "}
                  <code className="rounded bg-surface-muted px-1 py-0.5 font-numeric">*-text</code>{" "}
                  token instead, axe-verified against the actual composited tint.
                </p>
              </div>
            </div>
          </Section>

          <Separator />

          <Section eyebrow="Type" title="Scale &amp; numerics">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-card p-5 shadow-sm">
                {typeScale.map((row) => (
                  <div
                    key={row.px}
                    className="flex items-baseline gap-4 border-b border-border py-2.5 last:border-0"
                  >
                    <span className="w-8 shrink-0 font-numeric text-xs text-text-muted">
                      {row.px}
                    </span>
                    <span className={cn(row.cls, "font-medium text-text-strong")}>
                      {row.sample}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-card p-5 shadow-sm">
                <div>
                  <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
                    Tabular numerals
                  </span>
                  <p className="font-numeric text-3xl font-semibold text-text-strong">
                    0123456789
                  </p>
                  <p className="text-xs text-text-muted">
                    All KPI values, table cells and chart axes use{" "}
                    <code className="rounded bg-surface-muted px-1 py-0.5">tabular-nums</code> so
                    digits never jitter as they update.
                  </p>
                </div>
                <div>
                  <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
                    Weights
                  </span>
                  <p className="text-lg text-text-strong">
                    <span className="font-normal">Regular </span>
                    <span className="font-medium">Medium </span>
                    <span className="font-semibold">Semibold </span>
                    <span className="font-bold">Bold</span>
                  </p>
                </div>
              </div>
            </div>
          </Section>

          <Separator />

          <Section
            eyebrow="Components"
            title="Themed shadcn primitives"
            description="Same components as the platform's client/, repointed onto these tokens — primary = navy-600, focus ring = navy, cards = white + border + shadow-sm."
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Buttons</CardTitle>
                  <CardDescription>All variants, default size.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button>Primary</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="destructive">Destructive</Button>
                  <Button variant="link">Link</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Badges &amp; status</CardTitle>
                  <CardDescription>Neutral badge + semantic status chips.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge>Default</Badge>
                  <Badge variant="secondary">Secondary</Badge>
                  <Badge variant="outline">Outline</Badge>
                  <StatusBadge status="ok">OK</StatusBadge>
                  <StatusBadge status="warn">NTF</StatusBadge>
                  <StatusBadge status="danger">NG</StatusBadge>
                  <StatusBadge status="info">Queued</StatusBadge>
                  <StatusBadge status="neutral">Idle</StatusBadge>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Inputs</CardTitle>
                  <CardDescription>Default, disabled and invalid states.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Input placeholder="Station ID (e.g. AOI-07)" />
                  <Input placeholder="Disabled" disabled />
                  <Input placeholder="Invalid" aria-invalid="true" defaultValue="mk_bad-key" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Loading state</CardTitle>
                  <CardDescription>Skeleton placeholders for an unresolved tile.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </CardContent>
              </Card>
            </div>
          </Section>

          <Separator />

          <Section
            eyebrow="Machine detail"
            title="Tabs, table &amp; chart"
            description="The same tab shape (Overview / Telemetry / Log) planned for the real machine-detail screen, with mock data."
          >
            <Card className="p-1">
              <CardContent className="pt-3">
                <Tabs defaultValue="overview">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
                    <TabsTrigger value="log">Log</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="pt-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div className="rounded-lg bg-surface-subtle p-4">
                        <p className="text-xs text-text-muted">Station</p>
                        <p className="text-lg font-semibold text-text-strong">AOI-07</p>
                      </div>
                      <div className="rounded-lg bg-surface-subtle p-4">
                        <p className="text-xs text-text-muted">Driver</p>
                        <p className="text-lg font-semibold text-text-strong">Live</p>
                      </div>
                      <div className="rounded-lg bg-surface-subtle p-4">
                        <p className="text-xs text-text-muted">State</p>
                        <StatusBadge status="ok" className="mt-1">
                          Running
                        </StatusBadge>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="telemetry" className="pt-4">
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={telemetryData} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
                          <CartesianGrid vertical={false} stroke={border.DEFAULT} strokeDasharray="3 3" />
                          <XAxis
                            dataKey="t"
                            tick={{ fill: text.muted, fontSize: 11 }}
                            axisLine={{ stroke: border.DEFAULT }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: text.muted, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            width={32}
                          />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: surface.card,
                              border: `1px solid ${border.DEFAULT}`,
                              borderRadius: 8,
                              boxShadow: "var(--shadow-md)",
                              fontSize: 12,
                              color: text.body,
                            }}
                            labelStyle={{ color: text.strong, fontWeight: 600 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="cycle"
                            name="Cycle time (s)"
                            stroke={navy[600]}
                            strokeWidth={2.5}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="target"
                            name="Target (s)"
                            stroke={accent[600]}
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs text-text-muted">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-navy-600" aria-hidden="true" />
                        Cycle time (s)
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-accent-600" aria-hidden="true" />
                        Target (s)
                      </span>
                    </div>
                  </TabsContent>

                  <TabsContent value="log" className="pt-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm text-text-muted">Last 6 cycles</p>
                      <Dialog>
                        <DialogTrigger render={<Button variant="outline" size="sm" />}>
                          <Eye className="size-3.5" aria-hidden="true" />
                          View sample detail
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Cycle #18422 — AOI-07</DialogTitle>
                            <DialogDescription>
                              Board serial mk_7f2a19 · 3 measurement points · 0 defects.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="flex flex-col gap-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-text-muted">Result</span>
                              <StatusBadge status="ok">OK</StatusBadge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-muted">Duration</span>
                              <span className="font-numeric text-text-strong">4.6s</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-muted">Completed</span>
                              <span className="font-numeric text-text-strong">09:58:12</span>
                            </div>
                          </div>
                          <DialogFooter showCloseButton>
                            <DialogClose render={<Button variant="secondary" />}>
                              Export JSON
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Machine</TableHead>
                          <TableHead>Cycle #</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cycleLog.map((row) => {
                          const meta = resultMeta[row.result]
                          return (
                            <TableRow key={`${row.machine}-${row.cycle}`}>
                              <TableCell className="font-medium text-text-strong">
                                {row.machine}
                              </TableCell>
                              <TableCell className="font-numeric">{row.cycle}</TableCell>
                              <TableCell>
                                <StatusBadge status={meta.status}>{meta.label}</StatusBadge>
                              </TableCell>
                              <TableCell className="font-numeric">{row.duration}</TableCell>
                              <TableCell className="font-numeric text-text-muted">
                                {row.ts}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </Section>

          <Separator />

          <motion.footer
            variants={fadeSlideUp}
            className="flex flex-col gap-1 pb-6 text-xs text-text-muted"
          >
            <p>
              Doc 65 §2 · tokens defined once in <code className="font-numeric">src/index.css</code>,
              mirrored for JS consumers in <code className="font-numeric">src/theme/tokens.ts</code>.
            </p>
            <p>Entrance motion respects the OS “reduce motion” setting.</p>
          </motion.footer>
        </motion.main>
      </div>
    </TooltipProvider>
  )
}
