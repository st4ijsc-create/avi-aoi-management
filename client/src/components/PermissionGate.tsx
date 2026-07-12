/**
 * Doc 10 / U2 — VISUAL read-only enforcement.
 *
 * The backend already rejects unauthorized writes, but the UI used to still SHOW
 * create/edit/delete controls — confusing for viewer/supervisor (read-only) users. These
 * primitives make read-only VISIBLE and consistent:
 *
 *   • useCanWrite(module)        → { canCreate, canEdit, canDelete, readOnly }
 *   • <PermissionGate module action> → render an action control only when allowed; else
 *     hide it (mode="hide", default) or render it disabled (mode="disable").
 *   • <ViewOnlyBadge/>           → a small "Chỉ xem / View Only" pill for page headers.
 *
 * These are presentation helpers — they do NOT replace server-side checks (defense in
 * depth). Admins always pass (usePermissions handles the bypass).
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Eye } from "lucide-react";

export type WriteAction = "canCreate" | "canEdit" | "canDelete" | "canExport";

/** Roles that are intrinsically read-only platform-wide (doc 12 §7). */
export const READ_ONLY_ROLES = ["viewer", "user"] as const;

/**
 * Role-based read-only check (doc 12 §7). viewer/user are read-only EVERYWHERE;
 * admin is never read-only. Use this when a page has no single "module" to key a
 * permission off (or to show a page-level "View Only" banner). For per-module
 * write capability use `useCanWrite(module)`.
 */
export function useIsReadOnly(): boolean {
  const { user } = useAuth();
  const role = user?.role;
  if (role === "admin") return false;
  return role != null && (READ_ONLY_ROLES as readonly string[]).includes(role);
}

/** Convenience: the write capabilities a user has on a module (admin → all true). */
export function useCanWrite(module: string) {
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  // viewer/user are intrinsically read-only regardless of any stray module grant.
  const roleReadOnly = user?.role != null && (READ_ONLY_ROLES as readonly string[]).includes(user.role);
  const canCreate = !roleReadOnly && hasPermission(module, "canCreate");
  const canEdit = !roleReadOnly && hasPermission(module, "canEdit");
  const canDelete = !roleReadOnly && hasPermission(module, "canDelete");
  const canExport = hasPermission(module, "canExport");
  return { canCreate, canEdit, canDelete, canExport, readOnly: !(canCreate || canEdit || canDelete) };
}

interface PermissionGateProps {
  module: string;
  action: WriteAction;
  /** "hide" (default) removes the control; "disable" renders it greyed + non-interactive. */
  mode?: "hide" | "disable";
  children: ReactNode;
  /** Optional node shown instead when access is denied (only in "hide" mode). */
  fallback?: ReactNode;
}

/**
 * Merge props injected by a Radix `*Trigger asChild` Slot onto the gated child
 * (same semantics as Radix Slot: compose event handlers child-first, merge
 * className/style, slot props win otherwise). Without this, wrapping
 * `<PermissionGate>` inside e.g. `<DialogTrigger asChild>` used to swallow the
 * trigger's onClick/aria props → the button rendered but did nothing (doc 42 P0-1).
 */
function mergeSlotProps(childProps: Record<string, any>, slotProps: Record<string, any>) {
  const merged: Record<string, any> = { ...slotProps };
  for (const key of Object.keys(slotProps)) {
    const slotValue = slotProps[key];
    const childValue = childProps?.[key];
    if (/^on[A-Z]/.test(key)) {
      if (typeof slotValue === "function" && typeof childValue === "function") {
        merged[key] = (...args: unknown[]) => {
          childValue(...args);
          slotValue(...args);
        };
      } else if (typeof childValue === "function" && slotValue == null) {
        merged[key] = childValue;
      }
    } else if (key === "className") {
      merged[key] = [childValue, slotValue].filter(Boolean).join(" ") || undefined;
    } else if (key === "style") {
      merged[key] = { ...(childValue ?? {}), ...(slotValue ?? {}) };
    }
  }
  return merged;
}

/**
 * Gate a single action control (button/menu item) by a module permission. When denied:
 *   mode="hide"    → render `fallback` (or nothing).
 *   mode="disable" → clone the child with `disabled` + muted styling (keeps layout).
 *
 * Slot-transparent: any extra props (onClick, aria-*, data-state, ref… injected by a
 * Radix `*Trigger asChild`) are forwarded onto the single child element.
 */
export function PermissionGate({
  module,
  action,
  mode = "hide",
  children,
  fallback = null,
  ...slotProps
}: PermissionGateProps & Record<string, unknown>) {
  const { hasPermission } = usePermissions();
  const hasSlotProps = Object.keys(slotProps).length > 0;

  if (hasPermission(module, action)) {
    if (hasSlotProps && isValidElement(children)) {
      const el = children as ReactElement<any>;
      return cloneElement(el, mergeSlotProps(el.props ?? {}, slotProps));
    }
    return <>{children}</>;
  }

  if (mode === "disable" && isValidElement(children)) {
    const el = children as ReactElement<any>;
    return cloneElement(el, {
      ...(hasSlotProps ? mergeSlotProps(el.props ?? {}, slotProps) : {}),
      disabled: true,
      "aria-disabled": true,
      title: el.props?.title ?? "Bạn không có quyền thực hiện",
      className: [el.props?.className, "pointer-events-none opacity-50"].filter(Boolean).join(" "),
    });
  }
  return <>{fallback}</>;
}

/**
 * A compact "View Only" indicator for page headers when the user can't write.
 * Pass `module` to key it off per-module write capability; omit `module` to fall
 * back to the role-based read-only check (viewer/user). Renders nothing when the
 * user can write.
 */
export function ViewOnlyBadge({ module, className }: { module?: string; className?: string }) {
  const { t } = useTranslation();
  const moduleReadOnly = useCanWrite(module ?? "__none__").readOnly;
  const roleReadOnly = useIsReadOnly();
  const readOnly = module ? moduleReadOnly : roleReadOnly;
  if (!readOnly) return null;
  return (
    <Badge variant="secondary" className={["gap-1", className].filter(Boolean).join(" ")}>
      <Eye className="h-3 w-3" />
      {t("common.viewOnly", "Chỉ xem")}
    </Badge>
  );
}

export default PermissionGate;
