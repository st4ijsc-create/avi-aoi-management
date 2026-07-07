/**
 * DS F1c — <EntityPicker> + preset entity selects (UI-upgrade wave).
 *
 * The flagship shared primitive that retires the single biggest daily-friction /
 * bug source in the app: users typing raw numeric DB ids or free-text codes into
 * inputs. Instead of an `<input type="number">` bound to `machineId`, drop in a
 * searchable, keyboard-navigable combobox that shows human labels (+ a dim code)
 * and hands back the real id.
 *
 * Built on the shadcn "Combobox" idiom: <Popover> + cmdk <Command>. Typing filters
 * the list (cmdk), selecting fires `onChange(value, option)` and closes, the active
 * row shows a ✓, and an optional ✕ clears back to null without opening the popover.
 *
 * ── Generic usage (inline options) ─────────────────────────────────────────────
 *   const [status, setStatus] = React.useState<string | number | null>(null);
 *   <EntityPicker
 *     options={[
 *       { value: "pass", label: "Pass" },
 *       { value: "fail", label: "Fail", sublabel: "NG" },
 *     ]}
 *     value={status}
 *     onChange={(v) => setStatus(v)}
 *     placeholder="Select verdict…"
 *   />
 *
 * ── Preset usage (real endpoint, value = entity id) ─────────────────────────────
 *   const [machineId, setMachineId] = React.useState<number | null>(null);
 *   <MachineSelect
 *     value={machineId}
 *     onChange={(v) => setMachineId(v as number | null)}
 *     placeholder="Select machine…"
 *   />
 *
 * Styling uses semantic tokens only (bg-popover, text-muted-foreground, border, …)
 * so it is light/dark safe and matches shadcn Select/Button sizing. All strings are
 * English-default and overridable via props — no hardcoded i18n.
 */
import * as React from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";

/** One selectable row. `value` is the real id (kept as-is; numeric ids stay numbers). */
export interface EntityOption {
  value: string | number;
  label: string;
  /** A secondary string shown dim next to the label — typically an entity code. */
  sublabel?: string;
  disabled?: boolean;
}

export interface EntityPickerProps {
  options: EntityOption[];
  value: string | number | null | undefined;
  onChange: (value: string | number | null, option: EntityOption | null) => void;
  loading?: boolean;
  /** Trigger text when nothing is selected. English default "Select…". */
  placeholder?: string;
  /** Search box placeholder. Default "Search…". */
  searchPlaceholder?: string;
  /** Shown when the filter matches nothing. Default "No results". */
  emptyText?: string;
  /** Show an ✕ to reset to null when a value is set. Default true. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function EntityPicker({
  options,
  value,
  onChange,
  loading = false,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results",
  clearable = true,
  disabled = false,
  className,
  id,
  "aria-label": ariaLabel,
}: EntityPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );
  const hasValue = value !== null && value !== undefined && selected !== null;

  const handleSelect = React.useCallback(
    (option: EntityOption) => {
      if (option.disabled) return;
      // Toggle off if the same row is picked again.
      if (option.value === value) {
        onChange(null, null);
      } else {
        onChange(option.value, option);
      }
      setOpen(false);
    },
    [onChange, value],
  );

  const handleClear = React.useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onChange(null, null);
    },
    [onChange],
  );

  const showClear = clearable && hasValue && !disabled && !loading;

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={disabled || loading}
            className={cn(
              "w-full justify-between font-normal",
              // Reserve room for the chevron (+ clear ✕ when present) so long
              // labels never slide under the trailing icons.
              showClear ? "pr-14" : "pr-8",
              !hasValue && "text-muted-foreground",
            )}
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              {loading && <Loader2 className="size-4 shrink-0 animate-spin opacity-70" aria-hidden="true" />}
              <span className="truncate">
                {selected ? selected.label : placeholder}
              </span>
              {selected?.sublabel != null && selected.sublabel !== "" && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {selected.sublabel}
                </span>
              )}
            </span>
            <ChevronsUpDown className="absolute right-2 size-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-[12rem] p-0"
          align="start"
        >
          <Command
            // Filter on the visible label + sublabel (see each item's `value`).
            filter={(itemValue, search) =>
              itemValue.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
            }
          >
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading…
                </div>
              ) : (
                <>
                  <CommandEmpty>{emptyText}</CommandEmpty>
                  <CommandGroup>
                    {options.map((option) => {
                      const isSelected = option.value === value;
                      // Keep the cmdk value unique (id) AND searchable (label + code).
                      const searchValue = `${option.label} ${option.sublabel ?? ""} ${option.value}`;
                      return (
                        <CommandItem
                          key={String(option.value)}
                          value={searchValue}
                          disabled={option.disabled}
                          onSelect={() => handleSelect(option)}
                        >
                          <Check
                            className={cn(
                              "size-4 shrink-0",
                              isSelected ? "opacity-100" : "opacity-0",
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate">{option.label}</span>
                          {option.sublabel != null && option.sublabel !== "" && (
                            <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                              {option.sublabel}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showClear && (
        <button
          type="button"
          // Sibling (not nested in the trigger) so it never opens the popover and
          // stays valid HTML (no button-in-button).
          tabIndex={-1}
          aria-label="Clear selection"
          onClick={handleClear}
          className="absolute right-8 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Preset selects — wire the REAL tRPC list endpoints. Value is the entity id.
// ────────────────────────────────────────────────────────────────────────────

/** Shared prop shape for every preset select. `value` is the entity id. */
export interface EntitySelectProps {
  value: string | number | null | undefined;
  onChange: (value: string | number | null) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

/** Rows shared by the id/code/name hierarchy tables (factory/workshop/line/machine/workstation)
 *  and product models. Fields verified against drizzle/schema/{hierarchy,product}.ts. */
interface CodeNameRow {
  id: number;
  name: string;
  code: string | null;
}

/** Map a spread of props through to <EntityPicker>, dropping the mapper-only bits. */
function usePresetSelect(
  { value, onChange, placeholder, clearable, disabled, className, id, "aria-label": ariaLabel }: EntitySelectProps,
  options: EntityOption[],
  loading: boolean,
): React.JSX.Element {
  return (
    <EntityPicker
      options={options}
      value={value}
      onChange={(v) => onChange(v)}
      loading={loading}
      placeholder={placeholder}
      clearable={clearable}
      disabled={disabled}
      className={className}
      id={id}
      aria-label={ariaLabel}
    />
  );
}

/** Map an id/code/name row → EntityOption (label = name, sublabel = code). */
function codeNameOption(row: CodeNameRow): EntityOption {
  return {
    value: row.id,
    label: row.name,
    sublabel: row.code ?? undefined,
  };
}

export function MachineSelect(props: EntitySelectProps): React.JSX.Element {
  const { data, isLoading } = trpc.machine.list.useQuery();
  const options = React.useMemo(
    () => (data ?? []).map((r) => codeNameOption(r as CodeNameRow)),
    [data],
  );
  return usePresetSelect(props, options, isLoading);
}

export function LineSelect(props: EntitySelectProps): React.JSX.Element {
  const { data, isLoading } = trpc.line.list.useQuery();
  const options = React.useMemo(
    () => (data ?? []).map((r) => codeNameOption(r as CodeNameRow)),
    [data],
  );
  return usePresetSelect(props, options, isLoading);
}

export function FactorySelect(props: EntitySelectProps): React.JSX.Element {
  const { data, isLoading } = trpc.factory.list.useQuery();
  const options = React.useMemo(
    () => (data ?? []).map((r) => codeNameOption(r as CodeNameRow)),
    [data],
  );
  return usePresetSelect(props, options, isLoading);
}

export function WorkshopSelect(props: EntitySelectProps): React.JSX.Element {
  const { data, isLoading } = trpc.workshop.list.useQuery();
  const options = React.useMemo(
    () => (data ?? []).map((r) => codeNameOption(r as CodeNameRow)),
    [data],
  );
  return usePresetSelect(props, options, isLoading);
}

export function ProductModelSelect(props: EntitySelectProps): React.JSX.Element {
  const { data, isLoading } = trpc.productModel.list.useQuery();
  const options = React.useMemo(
    () => (data ?? []).map((r) => codeNameOption(r as CodeNameRow)),
    [data],
  );
  return usePresetSelect(props, options, isLoading);
}

export function WorkstationSelect(props: EntitySelectProps): React.JSX.Element {
  // workstation.list input is fully optional — pass no args to list all.
  const { data, isLoading } = trpc.workstation.list.useQuery();
  const options = React.useMemo(
    () => (data ?? []).map((r) => codeNameOption(r as CodeNameRow)),
    [data],
  );
  return usePresetSelect(props, options, isLoading);
}

/** User rows (drizzle/schema/auth.ts): id + nullable username/name/email. */
interface UserRow {
  id: number;
  username: string | null;
  name: string | null;
  email: string | null;
}

export function UserSelect(props: EntitySelectProps): React.JSX.Element {
  // user.list is admin-only server-side; the query still returns [] for non-admins.
  const { data, isLoading } = trpc.user.list.useQuery();
  const options = React.useMemo<EntityOption[]>(
    () =>
      ((data ?? []) as UserRow[]).map((u) => {
        const label = u.name ?? u.username ?? u.email ?? `User #${u.id}`;
        const code = u.username ?? u.email ?? undefined;
        // Only surface the sublabel when it differs from the label.
        return {
          value: u.id,
          label,
          sublabel: code && code !== label ? code : undefined,
        };
      }),
    [data],
  );
  return usePresetSelect(props, options, isLoading);
}

export default EntityPicker;
