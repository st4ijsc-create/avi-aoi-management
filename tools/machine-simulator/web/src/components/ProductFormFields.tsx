import * as React from "react"
import { Upload, X } from "lucide-react"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import type { CoordinateMode, ProductLifecycleStatus } from "@/lib/configApi"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormField } from "@/components/FormField"
import { ProductImageThumb } from "@/components/ProductImageThumb"

const LIFECYCLE_VALUES: ProductLifecycleStatus[] = ["development", "active", "eol", "archived"]
const COORDINATE_MODE_VALUES: CoordinateMode[] = ["pixel", "mm"]
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface ProductFormValues {
  name: string
  lifecycleStatus: ProductLifecycleStatus
  coordinateMode: CoordinateMode
  imageWidth: string
  imageHeight: string
  referenceImageUrl: string
}

interface ProductFormFieldsProps {
  values: ProductFormValues
  onChange: <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => void
  idPrefix: string
}

/**
 * The product-level field set shared by the "Tạo sản phẩm" dialog (`ProductConfig.tsx`) and the
 * product editor's "Thông tin sản phẩm" tab (`ProductConfigDetail.tsx`) — one implementation so the
 * two forms can't silently drift (same fields, same validation, same image-upload behavior).
 * Deliberately excludes `code` (immutable once created — the create dialog renders its own code field
 * separately, the editor shows it read-only next to the page title) and `pointsConfigVersion`
 * (server-computed, display-only).
 */
export function ProductFormFields({ values, onChange, idPrefix }: ProductFormFieldsProps) {
  const t = useT()
  const gloss = useGloss()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = React.useState<string | null>(null)

  const isUploadedImage = values.referenceImageUrl.startsWith("data:")

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = "" // allow re-selecting the same file later
    if (!file) return

    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(t("productConfig.form.imageTooLarge"))
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImageError(null)
        onChange("referenceImageUrl", reader.result)
      }
    }
    reader.onerror = () => setImageError(t("productConfig.form.imageReadFailed"))
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex flex-col gap-4">
      <FormField
        label={t("productConfig.form.nameLabel")}
        labelEn={gloss("productConfig.form.nameLabel")}
        htmlFor={`${idPrefix}-name`}
      >
        <Input
          id={`${idPrefix}-name`}
          value={values.name}
          onChange={(e) => onChange("name", e.target.value)}
          maxLength={120}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={t("productConfig.form.lifecycleLabel")}
          labelEn={gloss("productConfig.form.lifecycleLabel")}
          htmlFor={`${idPrefix}-lifecycle`}
        >
          <Select<ProductLifecycleStatus>
            value={values.lifecycleStatus}
            onValueChange={(value) => value && onChange("lifecycleStatus", value)}
          >
            <SelectTrigger id={`${idPrefix}-lifecycle`}>
              <SelectValue>{t(`lifecycleStatus.${values.lifecycleStatus}`)}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectPositioner>
                <SelectPopup>
                  {LIFECYCLE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`lifecycleStatus.${value}`)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </SelectPositioner>
            </SelectPortal>
          </Select>
        </FormField>

        <FormField
          label={t("productConfig.form.coordinateModeLabel")}
          labelEn={gloss("productConfig.form.coordinateModeLabel")}
          htmlFor={`${idPrefix}-coordinate-mode`}
        >
          <Select<CoordinateMode>
            value={values.coordinateMode}
            onValueChange={(value) => value && onChange("coordinateMode", value)}
          >
            <SelectTrigger id={`${idPrefix}-coordinate-mode`}>
              <SelectValue>{t(`coordinateMode.${values.coordinateMode}`)}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectPositioner>
                <SelectPopup>
                  {COORDINATE_MODE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`coordinateMode.${value}`)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </SelectPositioner>
            </SelectPortal>
          </Select>
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={t("productConfig.form.imageWidthLabel")}
          labelEn={gloss("productConfig.form.imageWidthLabel")}
          htmlFor={`${idPrefix}-image-width`}
        >
          <Input
            id={`${idPrefix}-image-width`}
            type="number"
            inputMode="numeric"
            min={0}
            value={values.imageWidth}
            onChange={(e) => onChange("imageWidth", e.target.value)}
          />
        </FormField>
        <FormField
          label={t("productConfig.form.imageHeightLabel")}
          labelEn={gloss("productConfig.form.imageHeightLabel")}
          htmlFor={`${idPrefix}-image-height`}
        >
          <Input
            id={`${idPrefix}-image-height`}
            type="number"
            inputMode="numeric"
            min={0}
            value={values.imageHeight}
            onChange={(e) => onChange("imageHeight", e.target.value)}
          />
        </FormField>
      </div>

      <FormField
        label={t("productConfig.form.referenceImageLabel")}
        labelEn={gloss("productConfig.form.referenceImageLabel")}
        htmlFor={`${idPrefix}-image-url`}
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <ProductImageThumb
              url={values.referenceImageUrl}
              alt={t("productConfig.form.previewAlt")}
              className="size-14 border border-border-strong"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {isUploadedImage ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onChange("referenceImageUrl", "")} className="w-fit">
                  <X className="size-3.5" aria-hidden="true" />
                  {t("productConfig.form.removeImageBtn")}
                </Button>
              ) : (
                <Input
                  id={`${idPrefix}-image-url`}
                  value={values.referenceImageUrl}
                  onChange={(e) => onChange("referenceImageUrl", e.target.value)}
                  placeholder={t("productConfig.form.referenceImageUrlPlaceholder")}
                />
              )}
            </div>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleFileChange}
              aria-label={t("productConfig.form.uploadBtn")}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden="true" />
              {t("productConfig.form.uploadBtn")}
            </Button>
          </div>
          {imageError ? (
            <p role="alert" className="text-xs text-danger-text">
              {imageError}
            </p>
          ) : null}
        </div>
      </FormField>
    </div>
  )
}
