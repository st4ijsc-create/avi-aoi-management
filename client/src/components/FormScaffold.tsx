/**
 * FormScaffold — one-import validated form primitive for dialogs & pages.
 *
 * Wraps `react-hook-form` + `zodResolver` (zod v4) + the shadcn `ui/form.tsx`
 * provider so that a schema-validated form (with error messages, submit spinner
 * and a Cancel/Save footer) becomes a ~10-line job. Field-level components
 * (`TextField`, `TextareaField`, `SelectField`, `SwitchField`) further collapse
 * the label + control + validation-message boilerplate.
 *
 * The generic `FormScaffold` stays fully type-safe: `defaultValues`, `onSubmit`
 * values and the `children(form)` render prop are all inferred from the schema.
 * The `*Field` helpers accept `UseFormReturn<any>` for ergonomic reuse.
 *
 * @example
 * ```tsx
 * import { z } from "zod";
 * import { FormScaffold, TextField, SwitchField } from "@/components/FormScaffold";
 *
 * const schema = z.object({
 *   name: z.string().min(1, "Name is required"),
 *   active: z.boolean(),
 * });
 *
 * function EditStationDialog({ onClose }: { onClose: () => void }) {
 *   return (
 *     <FormScaffold
 *       schema={schema}
 *       defaultValues={{ name: "", active: true }}
 *       submitLabel="Save"
 *       onCancel={onClose}
 *       onSubmit={async (values) => {
 *         await api.stations.create.mutate(values); // values: { name: string; active: boolean }
 *         onClose();
 *       }}
 *     >
 *       {(form) => (
 *         <>
 *           <TextField form={form} name="name" label="Station name" placeholder="e.g. AOI-01" />
 *           <SwitchField form={form} name="active" label="Active" description="Include in scheduling" />
 *         </>
 *       )}
 *     </FormScaffold>
 *   );
 * }
 * ```
 */

import * as React from "react";
import { useForm, type UseFormReturn, type DefaultValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface FormScaffoldProps<TSchema extends z.ZodType<any, any, any>> {
  /** A zod schema; drives validation and the inferred value shape. */
  schema: TSchema;
  /** Initial field values (inferred from the schema). */
  defaultValues: DefaultValues<z.infer<TSchema>>;
  /** Called with validated values on a successful submit. May be async. */
  onSubmit: (
    values: z.infer<TSchema>,
    form: UseFormReturn<z.infer<TSchema>>
  ) => void | Promise<void>;
  /** Render fields here — typically via `<TextField form={form} … />`. */
  children: (form: UseFormReturn<z.infer<TSchema>>) => React.ReactNode;
  /** Submit button label (English default "Save"). Pass a translated string. */
  submitLabel?: string;
  /** Cancel button label (English default "Cancel"). Pass a translated string. */
  cancelLabel?: string;
  /** When provided, renders a Cancel (outline) button that calls this. */
  onCancel?: () => void;
  /** External submitting state; OR-ed with `form.formState.isSubmitting`. */
  isSubmitting?: boolean;
  /** Force-disable the submit button (e.g. gated by another condition). */
  submitDisabled?: boolean;
  /** Replace the default footer entirely (Cancel/Submit row). */
  footer?: React.ReactNode;
  className?: string;
  /** Optional id on the underlying <form>. */
  id?: string;
}

export function FormScaffold<TSchema extends z.ZodType<any, any, any>>({
  schema,
  defaultValues,
  onSubmit,
  children,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  onCancel,
  isSubmitting,
  submitDisabled,
  footer,
  className,
  id,
}: FormScaffoldProps<TSchema>): React.JSX.Element {
  // The caller-facing generics above keep inference precise; internally we cast
  // to bridge the zod-v4 resolver's input/output split with a single value type.
  const form = useForm({
    resolver: zodResolver(schema as z.ZodType<any, any, any>),
    defaultValues: defaultValues as DefaultValues<any>,
  }) as unknown as UseFormReturn<z.infer<TSchema>>;

  const submitting = form.formState.isSubmitting || Boolean(isSubmitting);

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values as z.infer<TSchema>, form);
    } catch {
      // Swallow async errors so the dialog stays open; the caller is expected
      // to surface failures (toast, form.setError, etc.). Never crash the tree.
    }
  });

  return (
    <Form {...form}>
      <form
        id={id}
        onSubmit={handleSubmit}
        className={cn("space-y-4", className)}
        noValidate
      >
        {children(form)}

        {footer !== undefined ? (
          footer
        ) : (
          <div className="flex items-center justify-end gap-2 pt-2">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={submitting}
              >
                {cancelLabel}
              </Button>
            )}
            <Button type="submit" disabled={submitting || Boolean(submitDisabled)}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Field helpers — reduce label + control + <FormMessage/> boilerplate.       */
/*  Typed against UseFormReturn<any> for ergonomic reuse across schemas.       */
/* -------------------------------------------------------------------------- */

/** A single-line text/number/email/etc. input wired to an RHF field. */
export function TextField({
  form,
  name,
  label,
  placeholder,
  type = "text",
  description,
}: {
  form: UseFormReturn<any>;
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  description?: string;
}): React.JSX.Element {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} placeholder={placeholder} {...field} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** A multi-line textarea wired to an RHF field. */
export function TextareaField({
  form,
  name,
  label,
  placeholder,
  rows,
}: {
  form: UseFormReturn<any>;
  name: string;
  label: string;
  placeholder?: string;
  rows?: number;
}): React.JSX.Element {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea placeholder={placeholder} rows={rows} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** A single-select dropdown wired to an RHF field (string values). */
export function SelectField({
  form,
  name,
  label,
  options,
  placeholder,
}: {
  form: UseFormReturn<any>;
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            onValueChange={field.onChange}
            value={field.value ?? ""}
            defaultValue={field.value ?? undefined}
          >
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** A boolean toggle wired to an RHF field, with an inline label + description. */
export function SwitchField({
  form,
  name,
  label,
  description,
}: {
  form: UseFormReturn<any>;
  name: string;
  label: string;
  description?: string;
}): React.JSX.Element {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-center justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

export default FormScaffold;
