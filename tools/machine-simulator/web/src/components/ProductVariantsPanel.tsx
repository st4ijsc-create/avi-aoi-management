import * as React from "react"
import { GitBranch, Loader2, Plus, Save } from "lucide-react"
import { toast } from "sonner"

import { useT } from "@/i18n"
import { useSaveProduct, type ProductModel, type ProductVariant } from "@/lib/configApi"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FormField } from "@/components/FormField"

function AddVariantDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (open: boolean) => void; product: ProductModel }) {
  const t = useT()
  const saveProduct = useSaveProduct()
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setCode("")
      setName("")
      setError(null)
    }
  }, [open])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setError(t("pointsEditor.variants.dialog.codeRequired"))
      return
    }
    if (product.variants.some((v) => v.code.toLowerCase() === trimmedCode.toLowerCase())) {
      setError(t("pointsEditor.variants.dialog.codeDuplicate", { code: trimmedCode }))
      return
    }
    setError(null)

    const nextVariant: ProductVariant = {
      code: trimmedCode,
      name: name.trim() || null,
      isBase: false,
      pointsConfigVersion: product.pointsConfigVersion,
      referenceImageUrl: null,
      coordinateMode: null,
      overrides: [],
    }

    saveProduct.mutate(
      { code: product.code, product: { ...product, variants: [...product.variants, nextVariant] } },
      {
        onSuccess: () => {
          toast.success(t("toast.variantSaved"))
          onOpenChange(false)
        },
        onError: () => toast.error(t("toast.variantSaveFailed")),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("pointsEditor.variants.dialog.addTitle")}</DialogTitle>
            <DialogDescription>{t("pointsEditor.variants.description")}</DialogDescription>
          </DialogHeader>
          <FormField label={t("pointsEditor.variants.dialog.codeLabel")} htmlFor="variant-code">
            <Input id="variant-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="REV-C" maxLength={40} autoFocus />
          </FormField>
          <FormField label={t("pointsEditor.variants.dialog.nameLabel")} htmlFor="variant-name">
            <Input id="variant-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </FormField>
          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("pointsEditor.variants.dialog.cancel")}
            </Button>
            <Button type="submit" disabled={saveProduct.isPending}>
              {saveProduct.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
              {saveProduct.isPending ? t("pointsEditor.variants.dialog.submitting") : t("pointsEditor.variants.dialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Basic variant visibility — lists each variant (BASE + revisions like `REV-B`) with its
 * points-config version and override count, plus a lightweight "add a variant shell" dialog.
 * Per-point override editing (`variant_point_overrides`' `exclude|override` actions) is deliberately
 * OUT of scope here (Task C5's plan calls this "minimal" on purpose) — this panel exists so variants
 * aren't invisible/unmanaged from the web UI, not to replace a dedicated variant-override editor. */
export function ProductVariantsPanel({ product }: { product: ProductModel }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-navy-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-strong">{t("pointsEditor.variants.title")}</h2>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("pointsEditor.variants.addBtn")}
          </Button>
        </div>
        <p className="text-sm text-text-muted">{t("pointsEditor.variants.description")}</p>

        {product.variants.length === 0 ? (
          <p className="text-sm text-text-muted">{t("pointsEditor.variants.empty")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pointsEditor.variants.table.code")}</TableHead>
                  <TableHead>{t("pointsEditor.variants.table.name")}</TableHead>
                  <TableHead>{t("pointsEditor.variants.table.base")}</TableHead>
                  <TableHead className="text-right">{t("pointsEditor.variants.table.version")}</TableHead>
                  <TableHead className="text-right">{t("pointsEditor.variants.table.overrides")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.variants.map((v) => (
                  <TableRow key={v.code}>
                    <TableCell className="font-medium text-text-strong">{v.code}</TableCell>
                    <TableCell className="text-text-body">{v.name ?? "—"}</TableCell>
                    <TableCell>
                      {v.isBase ? (
                        <StatusBadge status="info">{t("pointsEditor.variants.baseYes")}</StatusBadge>
                      ) : (
                        <span className="text-text-muted">{t("pointsEditor.variants.baseNo")}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-numeric text-right text-text-muted">v{v.pointsConfigVersion}</TableCell>
                    <TableCell className="font-numeric text-right text-text-muted">{v.overrides.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <AddVariantDialog open={open} onOpenChange={setOpen} product={product} />
    </Card>
  )
}
