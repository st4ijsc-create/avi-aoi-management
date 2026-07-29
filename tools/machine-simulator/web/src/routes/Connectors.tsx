import * as React from "react"
import { motion } from "framer-motion"
import { Cable, Loader2, PlugZap, Save, Upload } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import {
  ConnectorConfigApiError,
  useConfiguredConnectors,
  useCreateConnector,
  useDeleteConnector,
  useTestConnector,
  type ConnectorKind,
  type ConnectorRequestInput,
} from "@/lib/api"
import { driverKindLabel } from "@/lib/driverKind"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormField } from "@/components/FormField"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — the write
 * path `/onboarding` never was: SM-1 made a zero-machine roster the honest product default, but there was
 * no way in the product to add a REAL machine — an operator had to set environment variables and
 * hand-author a register-map JSON file next to the exe. This screen closes that loop over the new
 * `POST/DELETE /v1/connectors`, `GET /v1/connectors/configured`, `POST /v1/connectors/test` endpoints
 * (`ConnectorEndpoints.cs`): pick the protocol (only the two this build can actually drive — Modbus TCP,
 * OPC-UA; never a stub for one with no driver), enter the connection settings, paste/upload the register/
 * node-map JSON (a graphical mapper is deliberately out of scope — see the form's own hint text), test the
 * connection, save, and see the machine appear in the fleet roster.
 *
 * Same "reads are Operator, mutations are Engineer+" shape `Site.tsx`/`AssetRegistry.tsx` already
 * established: the configured-connectors list is visible to every authenticated role; the add-connector
 * form and the per-row Remove button are Engineer+-gated client-side (`RequireRole`, a UX gate only — the
 * server's own `Policies.Engineer` on the mutating routes is the real enforcement).
 *
 * "Remove" is deliberately NOT "unregister a live machine" — `FleetHost.RegisterMachine` only ever ADDS
 * (see `ConnectorEndpoints.DeleteConnectorAsync`'s own doc comment); the confirmation dialog below says so
 * plainly rather than implying the roster tile disappears immediately.
 */

type TFunc = ReturnType<typeof useT>

/** Rank order for the Engineer+ gates below — same hierarchy `Site.tsx`/`AssetRegistry.tsx`'s own local
 * `ROLE_RANK`/`meetsMinRole` already encode (duplicated per-file in this codebase rather than shared). */
const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

function meetsMinRole(minRole: string, userRole: string | undefined): boolean {
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!meetsMinRole(role, user?.role)) return null
  return <>{children}</>
}

// Same native-`<textarea>` styling `Site.tsx`'s own `TEXTAREA_CLASS` uses (no shared `Textarea` primitive
// exists yet in `components/ui`) — `font-mono` since a register/node-map JSON blob reads far more legibly
// in a monospace face than the prose default.
const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-text-body transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]/40 disabled:cursor-not-allowed disabled:opacity-50"

const updatedTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function formatUpdatedTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : updatedTimeFormatter.format(d)
}

// ─────────────────────────────────────────────────────────────────────────
// Configured connectors — Operator-visible list (GET /v1/connectors/configured), Engineer+ Remove.
// ─────────────────────────────────────────────────────────────────────────

function ConfiguredConnectorsCard() {
  const t = useT()
  const gloss = useGloss()
  const { user } = useAuth()
  const { data, isPending, isError } = useConfiguredConnectors()
  const remove = useDeleteConnector()
  const [pendingRemoveKind, setPendingRemoveKind] = React.useState<string | null>(null)

  const canRemove = meetsMinRole("Engineer", user?.role)
  const items = data ?? []

  function handleConfirmRemove() {
    if (!pendingRemoveKind) return
    remove.mutate(pendingRemoveKind, {
      onSuccess: () => {
        toast.success(t("toast.connectorRemoved"))
        setPendingRemoveKind(null)
      },
      onError: () => {
        toast.error(t("toast.connectorRemoveFailed"))
        setPendingRemoveKind(null)
      },
    })
  }

  return (
    <Sheet title={t("connectorConfig.list.title")} titleEn={gloss("connectorConfig.list.title")} bodyClassName="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t("connectorConfig.list.description")}</p>

      {isError ? (
        <p className="text-sm text-danger-text">{t("connectorConfig.list.loadFailed")}</p>
      ) : isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-32 items-center justify-center border border-border bg-surface-subtle text-sm text-text-muted">
          {t("connectorConfig.list.empty")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("connectorConfig.list.table.kind")}</TableHead>
              <TableHead>{t("connectorConfig.list.table.machineCode")}</TableHead>
              <TableHead>{t("connectorConfig.list.table.hostPort")}</TableHead>
              <TableHead>{t("connectorConfig.list.table.updated")}</TableHead>
              {canRemove ? <TableHead className="text-right">{t("connectorConfig.list.table.remove")}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((connector) => (
              <TableRow key={connector.kind}>
                <TableCell>
                  <StatusBadge status="ok">{driverKindLabel(t, connector.kind)}</StatusBadge>
                </TableCell>
                <TableCell className="font-medium text-text-strong">{connector.machineCode}</TableCell>
                <TableCell className="font-mono text-xs text-text-muted">
                  {connector.host ? `${connector.host}:${connector.port}` : "—"}
                </TableCell>
                <TableCell className="font-numeric whitespace-nowrap text-text-muted">
                  {formatUpdatedTime(connector.updatedAtUtc)}
                </TableCell>
                {canRemove ? (
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" size="xs" onClick={() => setPendingRemoveKind(connector.kind)}>
                      {t("connectorConfig.list.table.remove")}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={pendingRemoveKind !== null} onOpenChange={(open) => !open && setPendingRemoveKind(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("connectorConfig.removeConfirm.title")}</DialogTitle>
            <DialogDescription>{t("connectorConfig.removeConfirm.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRemoveKind(null)} disabled={remove.isPending}>
              {t("connectorConfig.removeConfirm.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmRemove} disabled={remove.isPending}>
              {remove.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {remove.isPending ? t("connectorConfig.removeConfirm.removing") : t("connectorConfig.removeConfirm.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Add a connector — Engineer+ only (the whole card; see ConnectorsScreen's own RequireRole wrap).
// ─────────────────────────────────────────────────────────────────────────

function AddConnectorCard() {
  const t = useT()
  const gloss = useGloss()
  const [kind, setKind] = React.useState<ConnectorKind>("Modbus")
  const [host, setHost] = React.useState("")
  const [port, setPort] = React.useState(502)
  const [mapJson, setMapJson] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)
  const [testResult, setTestResult] = React.useState<{ ok: boolean; error: string | null } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const create = useCreateConnector()
  const test = useTestConnector()

  function buildInput(): ConnectorRequestInput {
    return kind === "Modbus" ? { kind, host: host.trim(), port, mapJson } : { kind, mapJson }
  }

  function handleKindChange(value: string) {
    setKind(value as ConnectorKind)
    setTestResult(null)
    setFormError(null)
  }

  function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setMapJson(String(reader.result ?? ""))
    reader.readAsText(file)
    event.target.value = "" // allow re-selecting the same file later
  }

  function readServerMessage(err: unknown, fallbackKey: string): string {
    if (err instanceof ConnectorConfigApiError && err.serverMessage) return err.serverMessage
    return t(fallbackKey)
  }

  function handleTest() {
    setFormError(null)
    setTestResult(null)
    test.mutate(buildInput(), {
      onSuccess: (result) => setTestResult(result),
      onError: (err) => setFormError(readServerMessage(err, "connectorConfig.errors.generic")),
    })
  }

  function handleSave() {
    setFormError(null)
    create.mutate(buildInput(), {
      onSuccess: (result) => {
        setMapJson("")
        setTestResult(null)
        // One toast, not two — its own text already carries whether this applied live or needs a
        // restart (see ConnectorCreateResult.appliedLive's own doc comment in lib/api.ts), so a separate
        // generic "connector saved" toast right before it would just be noise.
        toast.success(result.appliedLive ? t("connectorConfig.form.appliedLive") : t("connectorConfig.form.savedRestartNeeded"))
      },
      onError: (err) => {
        let key = "connectorConfig.errors.generic"
        if (err instanceof ConnectorConfigApiError) {
          if (err.status === 409) key = "connectorConfig.errors.conflict"
          else if (err.status === 403) key = "connectorConfig.errors.forbidden"
        }
        setFormError(readServerMessage(err, key))
        toast.error(t("toast.connectorSaveFailed"))
      },
    })
  }

  const missingRequiredField = !mapJson.trim() || (kind === "Modbus" && !host.trim())
  const busy = create.isPending || test.isPending

  return (
    <Sheet title={t("connectorConfig.form.title")} titleEn={gloss("connectorConfig.form.title")} bodyClassName="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{t("connectorConfig.form.description")}</p>

      <Tabs value={kind} onValueChange={handleKindChange}>
        <TabsList>
          <TabsTrigger value="Modbus">{t("connectorConfig.form.kindModbus")}</TabsTrigger>
          <TabsTrigger value="OpcUa">{t("connectorConfig.form.kindOpcUa")}</TabsTrigger>
        </TabsList>

        <TabsContent value="Modbus" className="pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t("connectorConfig.form.hostLabel")} labelEn={gloss("connectorConfig.form.hostLabel")} htmlFor="conn-host">
              <Input
                id="conn-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder={t("connectorConfig.form.hostPlaceholder")}
                className="font-mono"
              />
            </FormField>
            <FormField label={t("connectorConfig.form.portLabel")} labelEn={gloss("connectorConfig.form.portLabel")} htmlFor="conn-port">
              <Input
                id="conn-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="font-numeric"
              />
            </FormField>
          </div>
        </TabsContent>

        <TabsContent value="OpcUa" className="pt-4">
          <p className="text-xs text-text-muted">{t("connectorConfig.form.opcUaNote")}</p>
        </TabsContent>
      </Tabs>

      <FormField
        label={t("connectorConfig.form.mapJsonLabel")}
        labelEn={gloss("connectorConfig.form.mapJsonLabel")}
        htmlFor="conn-map-json"
        hint={t("connectorConfig.form.mapJsonHint")}
      >
        <div className="flex flex-col gap-1.5">
          <textarea
            id="conn-map-json"
            value={mapJson}
            onChange={(e) => setMapJson(e.target.value)}
            placeholder={t("connectorConfig.form.mapJsonPlaceholder")}
            rows={10}
            className={TEXTAREA_CLASS}
          />
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChosen} />
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-3.5" aria-hidden="true" />
            {t("connectorConfig.form.uploadButton")}
          </Button>
        </div>
      </FormField>

      {testResult ? (
        testResult.ok ? (
          <p className="text-xs text-ok-text">{t("connectorConfig.form.testResultOk")}</p>
        ) : (
          <p className="text-xs text-danger-text" role="alert">
            {testResult.error ?? t("connectorConfig.errors.generic")}
          </p>
        )
      ) : null}

      {formError ? (
        <p className="text-xs text-danger-text" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={handleTest} disabled={busy || missingRequiredField}>
          {test.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <PlugZap className="size-3.5" aria-hidden="true" />
          )}
          {test.isPending ? t("connectorConfig.form.testing") : t("connectorConfig.form.test")}
        </Button>
        <Button type="button" onClick={handleSave} disabled={busy || missingRequiredField}>
          {create.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          {create.isPending ? t("connectorConfig.form.saving") : t("connectorConfig.form.save")}
        </Button>
      </div>
    </Sheet>
  )
}

function ReadOnlyFormNote({ t, gloss }: { t: TFunc; gloss: (key: string) => string }) {
  return (
    <Sheet title={t("connectorConfig.form.title")} titleEn={gloss("connectorConfig.form.title")}>
      <p className="text-sm text-text-muted">{t("connectorConfig.form.readOnlyNote")}</p>
    </Sheet>
  )
}

function ConnectorsScreen() {
  const t = useT()
  const gloss = useGloss()

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Cable className="size-5 text-primary-text" aria-hidden="true" />
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("connectorConfig.title")}
          </h1>
        </div>
        <p className="hmi-micro mt-1">{gloss("connectorConfig.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("connectorConfig.description")}</p>
      </div>

      <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ConfiguredConnectorsCard />
          <RequireRole role="Engineer">
            <AddConnectorCard />
          </RequireRole>
          {/* RequireRole renders nothing for a below-Engineer user — the read-only note fills that slot
              instead, rendered OUTSIDE RequireRole itself (a second gate would just return null again). */}
          <NonEngineerFormNoteSlot t={t} gloss={gloss} />
        </div>
      </div>
    </motion.div>
  )
}

/** Renders the read-only note in place of the Add-connector card for anyone below Engineer — reads
 * `useAuth()` directly (rather than nesting a second `RequireRole`, which has no "else" branch) so exactly
 * one of `AddConnectorCard`/this note ever renders. */
function NonEngineerFormNoteSlot({ t, gloss }: { t: TFunc; gloss: (key: string) => string }) {
  const { user } = useAuth()
  if (meetsMinRole("Engineer", user?.role)) return null
  return <ReadOnlyFormNote t={t} gloss={gloss} />
}

export default function Connectors() {
  return <ConnectorsScreen />
}
