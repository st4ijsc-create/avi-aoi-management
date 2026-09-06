import * as React from "react"
import { motion } from "framer-motion"
import { Cable, Loader2, PlugZap, Save, Upload } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import { meetsMinRole } from "@/lib/roleRank"
import {
  ConnectorConfigApiError,
  effectiveInstanceId,
  useConfiguredConnectors,
  useConnectorIssues,
  useCreateConnector,
  useDeleteConnector,
  useFleet,
  useTestConnector,
  type ConnectorConfigSummary,
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

/** 🔴 Task D-7b — how the list is ORGANISED, which is the decision this screen had to make.
 *
 * A multidrop bus arrives as N rows sharing one `busInstanceId`. Rendering them flat produces eight rows
 * that differ only by a `:unitN` suffix, and the brief is right that that is not intelligible: it makes the
 * operator do the grouping in their head, every time, and it gives the Remove button nothing to say about
 * WHICH device it is about to take off the line.
 *
 * So a bus is ONE group with its own header — the line it runs on, named once, because the line is a
 * property of the segment and repeating `COM3` eight times says nothing eight times — and the devices under
 * it are addressed by their slave position, which is the thing an operator can point at on the physical
 * wire. Non-bus connectors (Modbus TCP, OPC-UA) are one group of their own with no header, i.e. exactly the
 * list this screen has always shown; a site with no RS-485 sees no change at all.
 *
 * Groups are keyed by `busInstanceId` (a server field), never by parsing `instanceId` — an id is a label,
 * not a schema. The unit LABEL under a bus header is derived from the id by stripping the bus prefix, and
 * that is a display transformation on a string the server minted from that same bus id; the identity used
 * for the React key and the DELETE call is always `effectiveInstanceId`, never this label. */
interface ConnectorGroup {
  busInstanceId: string | null
  connectors: ConnectorConfigSummary[]
}

function groupConnectors(items: ConnectorConfigSummary[]): ConnectorGroup[] {
  const groups: ConnectorGroup[] = []
  const byBus = new Map<string, ConnectorGroup>()

  for (const connector of items) {
    const bus = connector.busInstanceId
    if (bus === null || bus === undefined || bus.trim() === "") {
      let standalone = groups.find((g) => g.busInstanceId === null)
      if (!standalone) {
        standalone = { busInstanceId: null, connectors: [] }
        groups.push(standalone)
      }
      standalone.connectors.push(connector)
      continue
    }

    let group = byBus.get(bus)
    if (!group) {
      group = { busInstanceId: bus, connectors: [] }
      byBus.set(bus, group)
      groups.push(group)
    }
    group.connectors.push(connector)
  }

  return groups
}

/** The device's position on its bus, for display only — `line1:unit3` under bus `line1` reads as `unit3`.
 * Falls back to the whole id when the prefix does not match, which is the honest answer for a row whose id
 * the server minted some other way: showing the full id is never wrong, only longer. */
function devicePositionLabel(instanceId: string, busInstanceId: string): string {
  const prefix = `${busInstanceId}:`
  return instanceId.toLowerCase().startsWith(prefix.toLowerCase()) ? instanceId.slice(prefix.length) : instanceId
}

/** 🔴 Task D-7b — what an operator can actually be told about ONE device, from what this product publishes.
 *
 * Two sources, neither of which this screen used before:
 * - `GET /v1/connectors` (`useConnectorIssues`) is keyed by connector INSTANCE id, and has been since D-1 —
 *   so on a bus of eight it names the exact device whose factory refused its configuration, not "the Modbus
 *   connector". That is the difference between "this device did not start" and "something is wrong".
 * - the fleet snapshot's tile for this device's machine code — present means the machine is in the roster
 *   and its `statusText` is what every other screen shows for it; absent means the row is configured but
 *   the machine is not in the roster this session (which is what a refused registration looks like from
 *   here).
 *
 * 🔴 **What is deliberately NOT claimed here: whether this device is BACKED OFF or merely quiet.** D-7a
 * built that distinction and publishes it on exactly one channel — the application log, where a failed poll
 * says how many consecutive polls have failed and how long this device is now waiting, and where recovery
 * says so once with the cadence being restored. It is not on any HTTP projection, and the reason is
 * recorded on `ModbusRtuReadBackoff` itself: `IDeviceDriver` has no such member, and inventing one would put
 * a Modbus concept on the seam every driver in the product implements. This card therefore SAYS where the
 * distinction is published rather than inventing a badge for it — a badge that guessed would be worse than
 * the sentence, because "backed off" and "not answering" have different remedies. */
type DeviceLiveState = { kind: "issue"; detail: string } | { kind: "roster"; detail: string } | { kind: "absent" }

function ConfiguredConnectorsCard() {
  const t = useT()
  const gloss = useGloss()
  const { user } = useAuth()
  const { data, isPending, isError } = useConfiguredConnectors()
  const { data: issues } = useConnectorIssues()
  const { data: fleet } = useFleet()
  const remove = useDeleteConnector()
  // 🔴 Task D-7b — the WHOLE row, not a kind. The dialog has to be able to name exactly what it is about to
  // remove (which device, on which line, serving which machine), and the mutation has to send that row's
  // instance id. Holding a bare string was what made both impossible: `kind` identifies a protocol, and N
  // devices on one bus all have the same one.
  const [pendingRemove, setPendingRemove] = React.useState<ConnectorConfigSummary | null>(null)

  const canRemove = meetsMinRole("Engineer", user?.role)
  // Memoized on `data` itself (not on a fresh `?? []` literal, which is a new array identity every render
  // and would defeat the grouping memo below — oxlint's exhaustive-deps caught exactly that).
  const items = React.useMemo(() => data ?? [], [data])
  const groups = React.useMemo(() => groupConnectors(items), [items])

  function liveStateOf(connector: ConnectorConfigSummary): DeviceLiveState {
    const id = effectiveInstanceId(connector)
    const issue = (issues ?? []).find((i) => i.id.toLowerCase() === id.toLowerCase())
    if (issue) return { kind: "issue", detail: issue.error }

    const tile = (fleet?.machines ?? []).find(
      (m) => m.code.toLowerCase() === connector.machineCode.toLowerCase(),
    )
    return tile ? { kind: "roster", detail: tile.statusText } : { kind: "absent" }
  }

  function handleConfirmRemove() {
    if (!pendingRemove) return
    remove.mutate(effectiveInstanceId(pendingRemove), {
      onSuccess: () => {
        toast.success(t("toast.connectorRemoved"))
        setPendingRemove(null)
      },
      onError: () => {
        toast.error(t("toast.connectorRemoveFailed"))
        setPendingRemove(null)
      },
    })
  }

  const columnCount = canRemove ? 7 : 6

  function renderRow(connector: ConnectorConfigSummary, busInstanceId: string | null) {
    const id = effectiveInstanceId(connector)
    const live = liveStateOf(connector)
    const label = busInstanceId === null ? id : devicePositionLabel(id, busInstanceId)

    return (
      // 🔴 Task D-7b — keyed on the connector INSTANCE, not on `kind`. Eight devices on one bus are eight
      // rows of kind "Modbus", so the old key collided and React reconciled them as one.
      <TableRow key={id} data-connector-instance={id}>
        <TableCell className="font-mono text-xs text-text-strong">{label}</TableCell>
        <TableCell>
          <StatusBadge status="ok">{driverKindLabel(t, connector.kind)}</StatusBadge>
        </TableCell>
        <TableCell className="font-medium text-text-strong">{connector.machineCode}</TableCell>
        {/* The line, on every row and not only on the bus header: a row that has scrolled away from its
            header must still say which physical wire it is on. */}
        <TableCell className="font-mono text-xs text-text-muted">{formatLine(connector)}</TableCell>
        <TableCell className="text-xs">
          {live.kind === "issue" ? (
            <span className="text-danger-text">{t("connectorConfig.list.state.failedToStart")}</span>
          ) : live.kind === "absent" ? (
            <span className="text-warn-text">{t("connectorConfig.list.state.notInRoster")}</span>
          ) : (
            <span className="text-text-muted">{live.detail}</span>
          )}
        </TableCell>
        <TableCell className="font-numeric whitespace-nowrap text-text-muted">
          {formatUpdatedTime(connector.updatedAtUtc)}
        </TableCell>
        {canRemove ? (
          <TableCell className="text-right">
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={t("connectorConfig.list.table.removeAria", { id, machineCode: connector.machineCode })}
              onClick={() => setPendingRemove(connector)}
            >
              {t("connectorConfig.list.table.remove")}
            </Button>
          </TableCell>
        ) : null}
      </TableRow>
    )
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
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("connectorConfig.list.table.instanceId")}</TableHead>
                <TableHead>{t("connectorConfig.list.table.kind")}</TableHead>
                <TableHead>{t("connectorConfig.list.table.machineCode")}</TableHead>
                <TableHead>{t("connectorConfig.list.table.hostPort")}</TableHead>
                <TableHead>{t("connectorConfig.list.table.state")}</TableHead>
                <TableHead>{t("connectorConfig.list.table.updated")}</TableHead>
                {canRemove ? <TableHead className="text-right">{t("connectorConfig.list.table.remove")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) =>
                group.busInstanceId === null ? (
                  <React.Fragment key="__standalone">{group.connectors.map((c) => renderRow(c, null))}</React.Fragment>
                ) : (
                  <React.Fragment key={group.busInstanceId}>
                    {/* The bus header: the LINE, named once, because it is a property of the segment. The
                        first device's host/port is the whole bus's — every row of one bus carries the same
                        line (see ConnectorConfigRecord.Host server-side), so reading it off any of them is
                        reading the bus's own, not picking between candidates. */}
                    <TableRow className="bg-surface-subtle" data-connector-bus={group.busInstanceId}>
                      <TableCell colSpan={columnCount} className="text-xs">
                        <span className="font-medium text-text-strong">
                          {t("connectorConfig.list.bus.title", { bus: group.busInstanceId })}
                        </span>{" "}
                        <span className="font-mono text-text-muted">
                          {formatLine(group.connectors[0])}
                        </span>{" "}
                        <span className="text-text-muted">
                          {t("connectorConfig.list.bus.deviceCount", { count: group.connectors.length })}
                        </span>
                      </TableCell>
                    </TableRow>
                    {group.connectors.map((c) => renderRow(c, group.busInstanceId))}
                  </React.Fragment>
                ),
              )}
            </TableBody>
          </Table>

          {/* 🔴 Blueprint §9 + D-7a's backoff reporting, said where an operator configuring a line will
              read it rather than only in a plan document. See DeviceLiveState's own comment for why the
              backed-off/quiet distinction is a sentence here and not a badge. */}
          {groups.some((g) => g.busInstanceId !== null) ? (
            <p className="text-xs text-text-muted">{t("connectorConfig.list.bus.quietVersusBackedOff")}</p>
          ) : null}
        </>
      )}

      <Dialog open={pendingRemove !== null} onOpenChange={(open) => !open && setPendingRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("connectorConfig.removeConfirm.title")}</DialogTitle>
            {/* 🔴 Task D-7b — the dialog NAMES the connector instance and its machine. Before this task it
                could not: the flow carried a protocol kind, so on a bus of eight it could neither say which
                device was about to go nor guarantee the server removed the one meant. */}
            <DialogDescription>
              {pendingRemove
                ? pendingRemove.busInstanceId
                  ? t("connectorConfig.removeConfirm.deviceTarget", {
                      id: effectiveInstanceId(pendingRemove),
                      machineCode: pendingRemove.machineCode,
                      bus: pendingRemove.busInstanceId,
                    })
                  : t("connectorConfig.removeConfirm.target", {
                      id: effectiveInstanceId(pendingRemove),
                      machineCode: pendingRemove.machineCode,
                    })
                : null}
            </DialogDescription>
            <DialogDescription>{t("connectorConfig.removeConfirm.description")}</DialogDescription>
            {/* 🔴 Whole-branch review I-1 — a Seeded row is a visibility artifact of this machine's own
                connectors.json/env configuration and is re-created on every start, so "removed" is true of
                the row and false of the line behind it. The server's DELETE response says this; the dialog
                has to say it BEFORE the click, which is the only moment it can change what the operator
                does. */}
            {pendingRemove?.source === "Seeded" ? (
              <DialogDescription className="text-warn-text">
                {t("connectorConfig.removeConfirm.seededNote")}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRemove(null)} disabled={remove.isPending}>
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

/** The physical line a connector runs on, as the server projected it into `host`/`port`. A serial RS-485
 * bus has a port NAME and no port number, and the server writes `null` there deliberately so this never
 * renders `COM3:0` — a string that reads as an address that could be dialled. */
function formatLine(connector: ConnectorConfigSummary | undefined): string {
  if (!connector?.host) return "—"
  return connector.port === null || connector.port === undefined ? connector.host : `${connector.host}:${connector.port}`
}

// ─────────────────────────────────────────────────────────────────────────
// Add a connector — Engineer+ only (the whole card; see ConnectorsScreen's own RequireRole wrap).
// ─────────────────────────────────────────────────────────────────────────

/** 🔴 Task D-7b — the three things this form can create, which is NOT the same list as the two protocols
 * the product drives. `ModbusRtu` is not a fourth `DriverKinds` value and never was (see
 * `ModbusRtuBusSettings.TransportProperty` server-side: the thing that makes a Modbus document a BUS is that
 * it declares a transport, not a different kind) — it is a different SHAPE of the same kind, and it needs a
 * different form because a bus has a name and N devices and no single host/port of its own. Keeping it a tab
 * rather than "paste a bus document into the Modbus tab and hope" is what lets the form ask for the one field
 * a bus cannot do without: its id. */
type FormMode = "Modbus" | "OpcUa" | "ModbusRtu"

function AddConnectorCard() {
  const t = useT()
  const gloss = useGloss()
  const [mode, setMode] = React.useState<FormMode>("Modbus")
  const [busInstanceId, setBusInstanceId] = React.useState("")
  const [host, setHost] = React.useState("")
  const [port, setPort] = React.useState(502)
  const [mapJson, setMapJson] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)
  const [testResult, setTestResult] = React.useState<{ ok: boolean; error: string | null } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const create = useCreateConnector()
  const test = useTestConnector()

  function buildInput(): ConnectorRequestInput {
    if (mode === "OpcUa") return { kind: "OpcUa" as ConnectorKind, mapJson }
    if (mode === "Modbus") return { kind: "Modbus" as ConnectorKind, host: host.trim(), port, mapJson }
    // An RS-485 bus: the KIND is still Modbus (see FormMode) and there is no host/port at this level —
    // the line lives inside the document, as a port name or a gateway address, and the server projects it
    // into the store's own host/port columns from there. What the request must carry is the bus's id.
    return { kind: "Modbus" as ConnectorKind, mapJson, instanceId: busInstanceId.trim() }
  }

  function handleKindChange(value: string) {
    setMode(value as FormMode)
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
        //
        // 🔴 Task D-7b — a bus save created N connectors, and saying "connector saved" for eight devices
        // would understate by a factor of eight exactly where the operator most needs to know the count
        // matched the file they pasted. `devices` is the server's own count, never this form's.
        const devices = result.devices
        if (devices && devices.length > 0) {
          toast.success(
            t(
              result.appliedLive ? "connectorConfig.form.busAppliedLive" : "connectorConfig.form.busSavedRestartNeeded",
              { count: devices.length },
            ),
          )
          setBusInstanceId("")
        } else {
          toast.success(result.appliedLive ? t("connectorConfig.form.appliedLive") : t("connectorConfig.form.savedRestartNeeded"))
        }
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

  const missingRequiredField =
    !mapJson.trim() || (mode === "Modbus" && !host.trim()) || (mode === "ModbusRtu" && !busInstanceId.trim())
  const busy = create.isPending || test.isPending
  // 🔴 The connectivity probe builds ONE throwaway driver from ONE single-device map
  // (ConnectorEndpoints.TestConnectorAsync) — it has no concept of a bus, and handing it a bus document
  // would report the fan-out's own parse refusal as "cannot reach the device", which is a different
  // problem with a different remedy. Disabled rather than silently misleading; the form says why.
  const canTest = mode !== "ModbusRtu"

  return (
    <Sheet title={t("connectorConfig.form.title")} titleEn={gloss("connectorConfig.form.title")} bodyClassName="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{t("connectorConfig.form.description")}</p>

      <Tabs value={mode} onValueChange={handleKindChange}>
        <TabsList>
          <TabsTrigger value="Modbus">{t("connectorConfig.form.kindModbus")}</TabsTrigger>
          <TabsTrigger value="ModbusRtu">{t("connectorConfig.form.kindModbusRtu")}</TabsTrigger>
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

        <TabsContent value="ModbusRtu" className="pt-4">
          <div className="flex flex-col gap-3">
            <FormField
              label={t("connectorConfig.form.busIdLabel")}
              labelEn={gloss("connectorConfig.form.busIdLabel")}
              htmlFor="conn-bus-id"
              hint={t("connectorConfig.form.busIdHint")}
            >
              <Input
                id="conn-bus-id"
                value={busInstanceId}
                onChange={(e) => setBusInstanceId(e.target.value)}
                placeholder={t("connectorConfig.form.busIdPlaceholder")}
                className="font-mono"
              />
            </FormField>
            <p className="text-xs text-text-muted">{t("connectorConfig.form.rtuNote")}</p>
            {/* 🔴 Blueprint §9, at the point of configuration rather than only in a plan document: the
                failure an automatic-DE-only product has with a manual-DE adapter is SILENT. */}
            <p className="text-xs text-warn-text" role="note">
              {t("connectorConfig.form.rtuHardwareLimit")}
            </p>
            {/* 🔴 Blueprint §10 item 3: `Applied` is an acknowledgement, not an observation. Said where the
                capability is granted, because that is where the operator forms the belief. */}
            <p className="text-xs text-text-muted">{t("connectorConfig.form.appliedIsNotProof")}</p>
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
        <Button type="button" variant="outline" onClick={handleTest} disabled={busy || missingRequiredField || !canTest}>
          {test.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <PlugZap className="size-3.5" aria-hidden="true" />
          )}
          {test.isPending ? t("connectorConfig.form.testing") : t("connectorConfig.form.test")}
        </Button>
        {canTest ? null : <span className="text-xs text-text-muted">{t("connectorConfig.form.testUnavailableForBus")}</span>}
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
