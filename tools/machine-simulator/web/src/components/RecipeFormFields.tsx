import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import type { RecipeStatus } from "@/lib/configApi"
import { RECIPE_MACHINE_TYPE_GROUPS } from "@/lib/machineTypes"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormField } from "@/components/FormField"

const STATUS_VALUES: RecipeStatus[] = ["draft", "active", "archived"]

/** Sentinel select value for "no machineType set" (`Recipe.machineType` is nullable) — the Base UI
 * `Select` primitive can't carry an empty string as a real option value, same reason `ProductFormFields`
 * doesn't need this (lifecycle/coordinateMode are never nullable) but `Onboarding.tsx`'s own type
 * picker doesn't either (always required there). */
const NONE_MACHINE_TYPE = "__none__"

export interface RecipeFormValues {
  name: string
  /** `""` = unset (maps to `Recipe.machineType: null` on save). */
  machineType: string
  status: RecipeStatus
}

interface RecipeFormFieldsProps {
  values: RecipeFormValues
  onChange: <K extends keyof RecipeFormValues>(key: K, value: RecipeFormValues[K]) => void
  idPrefix: string
}

/**
 * The recipe-level field set shared by the "Tạo recipe" dialog (`RecipeConfig.tsx`) and the recipe
 * editor's info section (`RecipeConfigDetail.tsx`) — one implementation so the two forms can't
 * silently drift, mirroring `ProductFormFields`'s own role for the product workspace. Deliberately
 * excludes `code` (immutable once created) and `version`/`checksum` (server-computed, display-only).
 */
export function RecipeFormFields({ values, onChange, idPrefix }: RecipeFormFieldsProps) {
  const t = useT()
  const gloss = useGloss()

  return (
    <div className="flex flex-col gap-4">
      <FormField
        label={t("recipeConfig.form.nameLabel")}
        labelEn={gloss("recipeConfig.form.nameLabel")}
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
          label={t("recipeConfig.form.machineTypeLabel")}
          labelEn={gloss("recipeConfig.form.machineTypeLabel")}
          htmlFor={`${idPrefix}-machine-type`}
        >
          <Select
            value={values.machineType || NONE_MACHINE_TYPE}
            onValueChange={(value) => value && onChange("machineType", value === NONE_MACHINE_TYPE ? "" : value)}
          >
            <SelectTrigger id={`${idPrefix}-machine-type`}>
              <SelectValue>{values.machineType || t("recipeConfig.form.machineTypeNone")}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectPositioner>
                <SelectPopup>
                  <SelectItem value={NONE_MACHINE_TYPE}>{t("recipeConfig.form.machineTypeNone")}</SelectItem>
                  {RECIPE_MACHINE_TYPE_GROUPS.map((group) => (
                    <SelectGroup key={group.id}>
                      {/* Reuses Onboarding's own group-label translations — same underlying
                          vocabulary (machine-type groups), not recipe-specific wording. */}
                      <SelectGroupLabel>{t(`onboarding.register.typeGroups.${group.id}`)}</SelectGroupLabel>
                      {group.types.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectPopup>
              </SelectPositioner>
            </SelectPortal>
          </Select>
        </FormField>

        <FormField
          label={t("recipeConfig.form.statusLabel")}
          labelEn={gloss("recipeConfig.form.statusLabel")}
          htmlFor={`${idPrefix}-status`}
        >
          <Select<RecipeStatus> value={values.status} onValueChange={(value) => value && onChange("status", value)}>
            <SelectTrigger id={`${idPrefix}-status`}>
              <SelectValue>{t(`recipeStatus.${values.status}`)}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectPositioner>
                <SelectPopup>
                  {STATUS_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`recipeStatus.${value}`)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </SelectPositioner>
            </SelectPortal>
          </Select>
        </FormField>
      </div>
    </div>
  )
}
