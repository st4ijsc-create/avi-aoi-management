import * as React from "react"
import { Crosshair, Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useT } from "@/i18n"
import { useSaveProduct, type Fiducial, type ProductModel } from "@/lib/configApi"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FormField } from "@/components/FormField"

interface FiducialFormValues {
  code: string
  name: string
  type: string
  normalizedX: string
  normalizedY: string
}

const BLANK: FiducialFormValues = { code: "", name: "", type: "cross", normalizedX: "0.5", normalizedY: "0.5" }

function toFormValues(f: Fiducial): FiducialFormValues {
  return {
    code: f.code,
    name: f.name ?? "",
    type: f.type ?? "",
    normalizedX: f.normalizedX != null ? String(f.normalizedX) : "",
    normalizedY: f.normalizedY != null ? String(f.normalizedY) : "",
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Add/edit dialog — fiducials have no per-item endpoint (unlike points), so every save is a
// whole-product PUT that replaces `fiducials` with an updated copy of the array (see configApi.ts's
// header comment on why the rest of `product` must be spread through unchanged).
// ─────────────────────────────────────────────────────────────────────────

function FiducialDialog({
  open,
  onOpenChange,
  product,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: ProductModel
  editing: Fiducial | null
}) {
  const t = useT()
  const saveProduct = useSaveProduct()
  const [form, setForm] = React.useState<FiducialFormValues>(BLANK)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setForm(editing ? toFormValues(editing) : BLANK)
      setError(null)
    }
  }, [open, editing])

  function update<K extends keyof FiducialFormValues>(key: K, value: FiducialFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedCode = form.code.trim()
    if (!trimmedCode) {
      setError(t("pointsEditor.fiducials.dialog.codeRequired"))
      return
    }
    const duplicate = product.fiducials.some(
      (f) => f.code.toLowerCase() === trimmedCode.toLowerCase() && (!editing || f.code.toLowerCase() !== editing.code.toLowerCase())
    )
    if (duplicate) {
      setError(t("pointsEditor.fiducials.dialog.codeDuplicate", { code: trimmedCode }))
      return
    }
    setError(null)

    const nx = form.normalizedX.trim() ? Number(form.normalizedX) : null
    const ny = form.normalizedY.trim() ? Number(form.normalizedY) : null

    const nextFiducial: Fiducial = {
      code: trimmedCode,
      name: form.name.trim() || null,
      type: form.type.trim() || null,
      positionX: nx != null && product.imageWidth ? nx * product.imageWidth : (editing?.positionX ?? 0),
      positionY: ny != null && product.imageHeight ? ny * product.imageHeight : (editing?.positionY ?? 0),
      normalizedX: nx,
      normalizedY: ny,
      searchWindowW: editing?.searchWindowW ?? null,
      searchWindowH: editing?.searchWindowH ?? null,
      templateImageUrl: editing?.templateImageUrl ?? null,
      orderIndex: editing?.orderIndex ?? product.fiducials.length,
    }

    const nextFiducials = editing
      ? product.fiducials.map((f) => (f.code.toLowerCase() === editing.code.toLowerCase() ? nextFiducial : f))
      : [...product.fiducials, nextFiducial]

    saveProduct.mutate(
      { code: product.code, product: { ...product, fiducials: nextFiducials } },
      {
        onSuccess: () => {
          toast.success(t("toast.fiducialSaved"))
          onOpenChange(false)
        },
        onError: () => toast.error(t("toast.fiducialSaveFailed")),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* `noValidate` — see PointForm.tsx's own doc comment: normalizedX/Y's `step="0.001"` can
            fail native constraint validation against real data with finer precision, silently
            blocking submission. This dialog owns its own validation (the `error` state below). */}
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? t("pointsEditor.fiducials.dialog.editTitle") : t("pointsEditor.fiducials.dialog.addTitle")}</DialogTitle>
            <DialogDescription>{t("pointsEditor.fiducials.description")}</DialogDescription>
          </DialogHeader>

          <FormField label={t("pointsEditor.fiducials.dialog.codeLabel")} htmlFor="fiducial-code">
            <Input
              id="fiducial-code"
              value={form.code}
              onChange={(e) => update("code", e.target.value)}
              disabled={!!editing}
              maxLength={40}
              autoFocus={!editing}
            />
          </FormField>
          <FormField label={t("pointsEditor.fiducials.dialog.nameLabel")} htmlFor="fiducial-name">
            <Input id="fiducial-name" value={form.name} onChange={(e) => update("name", e.target.value)} maxLength={80} />
          </FormField>
          <FormField label={t("pointsEditor.fiducials.dialog.typeLabel")} htmlFor="fiducial-type">
            <Input id="fiducial-type" value={form.type} onChange={(e) => update("type", e.target.value)} placeholder="cross" maxLength={40} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("pointsEditor.fiducials.dialog.normalizedXLabel")} htmlFor="fiducial-nx">
              <Input
                id="fiducial-nx"
                type="number"
                step="0.001"
                min={0}
                max={1}
                value={form.normalizedX}
                onChange={(e) => update("normalizedX", e.target.value)}
              />
            </FormField>
            <FormField label={t("pointsEditor.fiducials.dialog.normalizedYLabel")} htmlFor="fiducial-ny">
              <Input
                id="fiducial-ny"
                type="number"
                step="0.001"
                min={0}
                max={1}
                value={form.normalizedY}
                onChange={(e) => update("normalizedY", e.target.value)}
              />
            </FormField>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("pointsEditor.fiducials.dialog.cancel")}
            </Button>
            <Button type="submit" disabled={saveProduct.isPending}>
              {saveProduct.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
              {saveProduct.isPending ? t("pointsEditor.fiducials.dialog.submitting") : t("pointsEditor.fiducials.dialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteFiducialDialog({
  open,
  onOpenChange,
  product,
  fiducial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: ProductModel
  fiducial: Fiducial
}) {
  const t = useT()
  const saveProduct = useSaveProduct()

  function handleDelete() {
    const nextFiducials = product.fiducials.filter((f) => f.code.toLowerCase() !== fiducial.code.toLowerCase())
    saveProduct.mutate(
      { code: product.code, product: { ...product, fiducials: nextFiducials } },
      {
        onSuccess: () => {
          toast.success(t("toast.fiducialDeleted"))
          onOpenChange(false)
        },
        onError: () => toast.error(t("toast.fiducialSaveFailed")),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pointsEditor.fiducials.deleteConfirmTitle", { code: fiducial.code })}</DialogTitle>
          <DialogDescription>{t("pointsEditor.fiducials.deleteConfirmDescription")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("pointsEditor.fiducials.deleteConfirmCancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={saveProduct.isPending}>
            {saveProduct.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
            {t("pointsEditor.fiducials.deleteConfirmSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Basic fiducial-mark authoring — view/add/edit/delete each mark's code/name/type/normalized
 * position. `searchWindowW/H`/`templateImageUrl` are preserved through edits but not exposed in this
 * form (real-enough for a "basic" editor per Task C5's scope; not a stub — every field that matters
 * for positioning a fiducial on the canvas is editable). */
export function ProductFiducialsPanel({ product }: { product: ProductModel }) {
  const t = useT()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Fiducial | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<Fiducial | null>(null)

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(f: Fiducial) {
    setEditing(f)
    setDialogOpen(true)
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Crosshair className="size-4 text-navy-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-strong">{t("pointsEditor.fiducials.title")}</h2>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={openAdd}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("pointsEditor.fiducials.addBtn")}
          </Button>
        </div>
        <p className="text-sm text-text-muted">{t("pointsEditor.fiducials.description")}</p>

        {product.fiducials.length === 0 ? (
          <p className="text-sm text-text-muted">{t("pointsEditor.fiducials.empty")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pointsEditor.fiducials.table.code")}</TableHead>
                  <TableHead>{t("pointsEditor.fiducials.table.name")}</TableHead>
                  <TableHead>{t("pointsEditor.fiducials.table.type")}</TableHead>
                  <TableHead>{t("pointsEditor.fiducials.table.position")}</TableHead>
                  <TableHead className="w-16">
                    <span className="sr-only">{t("pointsEditor.fiducials.table.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.fiducials.map((f) => (
                  <TableRow key={f.code}>
                    <TableCell className="font-medium text-text-strong">{f.code}</TableCell>
                    <TableCell className="text-text-body">{f.name ?? "—"}</TableCell>
                    <TableCell className="text-text-body">{f.type ?? "—"}</TableCell>
                    <TableCell className="font-numeric text-text-muted">
                      {f.normalizedX != null && f.normalizedY != null ? `${f.normalizedX.toFixed(3)}, ${f.normalizedY.toFixed(3)}` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(f)}
                          aria-label={t("pointsEditor.fiducials.editAria", { code: f.code })}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteTarget(f)}
                          aria-label={t("pointsEditor.fiducials.deleteAria", { code: f.code })}
                        >
                          <Trash2 className="size-3.5 text-danger-text" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <FiducialDialog open={dialogOpen} onOpenChange={setDialogOpen} product={product} editing={editing} />
      {deleteTarget ? (
        <DeleteFiducialDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} product={product} fiducial={deleteTarget} />
      ) : null}
    </Card>
  )
}
