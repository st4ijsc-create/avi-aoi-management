/**
 * JsonSchemaForm — doc 37 Đợt-B1 (manifest-driven auto-form).
 *
 * Renders a controlled form from a JSON-Schema object (draft 2020-12) — the exact
 * shape produced by `zodToConfigForm` for OT connector manifests
 * (host/port/unitId/pollIntervalMs/timeoutMs/readOnly, port carrying a `default`).
 * This is the real "auto-form" that `SynapsePlatformPage` only advertised with a
 * Badge: add a new vendor manifest → its config UI appears here for free, no core edit.
 *
 * Presentational + controlled: parent owns the value object; `onChange` returns the
 * next value. Fail-safe — an unknown/empty schema renders nothing rather than throwing.
 */
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface JsonSchemaProp {
  type?: string | string[];
  description?: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

interface JsonSchemaFormProps {
  schema: Record<string, unknown> | null | undefined;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Disable every field (e.g. read-only view). */
  disabled?: boolean;
  className?: string;
}

/** First concrete (non-null) type from a JSON-Schema `type` field. */
function primaryType(t: string | string[] | undefined): string {
  if (Array.isArray(t)) return t.find((x) => x !== "null") ?? "string";
  return t ?? "string";
}

/** Best-effort default for a property when the value is still undefined. */
export function jsonSchemaDefaults(schema: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const s = (schema ?? {}) as JsonSchemaObject;
  const out: Record<string, unknown> = {};
  if (!s.properties) return out;
  for (const [key, prop] of Object.entries(s.properties)) {
    if (prop.default !== undefined) out[key] = prop.default;
    else if (primaryType(prop.type) === "boolean") out[key] = false;
    else if (primaryType(prop.type) === "string") out[key] = "";
  }
  return out;
}

export default function JsonSchemaForm({
  schema,
  value,
  onChange,
  disabled = false,
  className,
}: JsonSchemaFormProps) {
  const { t } = useTranslation();
  const s = (schema ?? {}) as JsonSchemaObject;
  const properties = s.properties ?? {};
  const required = new Set(s.required ?? []);
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t("jsonSchemaForm.noFields", "Manifest không khai báo trường cấu hình.")}
      </p>
    );
  }

  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  return (
    <div className={cn("space-y-3", className)}>
      {keys.map((key) => {
        const prop = properties[key];
        const type = primaryType(prop.type);
        const label = prop.description || prop.title || key;
        const isRequired = required.has(key);
        const current = value[key] !== undefined ? value[key] : prop.default;

        // ── boolean → Switch ──
        if (type === "boolean") {
          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <Label className="text-sm font-normal">
                {label}
                {isRequired && <span className="ml-0.5 text-destructive">*</span>}
              </Label>
              <Switch
                checked={current === true}
                disabled={disabled}
                onCheckedChange={(v) => set(key, v)}
              />
            </div>
          );
        }

        // ── enum → Select ──
        if (Array.isArray(prop.enum) && prop.enum.length > 0) {
          return (
            <div key={key} className="space-y-1">
              <Label className="text-sm">
                {label}
                {isRequired && <span className="ml-0.5 text-destructive">*</span>}
              </Label>
              <Select
                value={current != null ? String(current) : ""}
                disabled={disabled}
                onValueChange={(v) => set(key, v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {prop.enum.map((opt) => (
                    <SelectItem key={String(opt)} value={String(opt)}>{String(opt)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        // ── integer / number → number Input ──
        if (type === "integer" || type === "number") {
          return (
            <div key={key} className="space-y-1">
              <Label className="text-sm">
                {label}
                {isRequired && <span className="ml-0.5 text-destructive">*</span>}
              </Label>
              <Input
                type="number"
                disabled={disabled}
                min={prop.minimum}
                max={prop.maximum}
                value={current === undefined || current === null || current === "" ? "" : String(current)}
                onChange={(e) => {
                  const raw = e.target.value;
                  set(key, raw === "" ? undefined : Number(raw));
                }}
              />
            </div>
          );
        }

        // ── default → text Input ──
        return (
          <div key={key} className="space-y-1">
            <Label className="text-sm">
              {label}
              {isRequired && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            <Input
              type="text"
              disabled={disabled}
              maxLength={prop.maxLength}
              value={current == null ? "" : String(current)}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
