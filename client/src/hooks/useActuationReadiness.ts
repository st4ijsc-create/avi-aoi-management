/**
 * doc 40 ENG-F13 — PRE-FLIGHT ACTUATION READINESS.
 *
 * A control/deploy path is an ACTUATION: the server enforces a role-floor
 * (admin/supervisor/engineer) + 2FA (actuationProcedure) BEFORE any device write. Today
 * the user only discovers a missing prerequisite when they click Deploy and get a raw
 * FORBIDDEN. This hook reads `auth.me` and reports the blockers UP-FRONT so a card can warn
 * the user (e.g. "bật 2FA trước") instead of letting them hit the wall.
 *
 * READ-ONLY + advisory: it mirrors the server's rule (server stays the wall) and never
 * relaxes anything. It returns blockers as { code, defaultMessage } so callers translate
 * via t(`actuationReadiness.${code}`, defaultMessage).
 */
import { trpc } from "@/lib/trpc";

/** Roles allowed to actuate (mirror of server ACTUATION_ROLES). */
const ACTUATION_ROLES = ["admin", "supervisor", "engineer"] as const;

export interface ActuationBlocker {
  /** Stable code for i18n + testing: "role" | "2fa". */
  code: "role" | "2fa";
  severity: "error" | "warning";
  /** Vietnamese default; callers may translate by code. */
  defaultMessage: string;
}

export interface ActuationReadiness {
  /** True only when there are NO blockers (the user could pass the server gate). */
  ready: boolean;
  blockers: ActuationBlocker[];
  role: string | null;
  isPrivileged: boolean;
  twoFactorEnabled: boolean;
  isLoading: boolean;
}

export function useActuationReadiness(): ActuationReadiness {
  const meQ = trpc.auth.me.useQuery();
  const me = meQ.data as { role?: string | null; twoFactorEnabled?: boolean } | null | undefined;

  const role = me?.role ?? null;
  const isPrivileged = role != null && (ACTUATION_ROLES as readonly string[]).includes(role);
  const twoFactorEnabled = Boolean(me?.twoFactorEnabled);

  const blockers: ActuationBlocker[] = [];
  // Only compute blockers once we actually know who the user is (avoid false warnings while loading).
  if (me) {
    if (!isPrivileged) {
      blockers.push({
        code: "role",
        severity: "error",
        defaultMessage:
          "Vai trò hiện tại không đủ quyền để deploy/duyệt (cần admin, supervisor hoặc engineer).",
      });
    } else if (!twoFactorEnabled) {
      // Privileged role but 2FA off → the server will reject actuation. Warn now.
      blockers.push({
        code: "2fa",
        severity: "error",
        defaultMessage:
          "Tài khoản đặc quyền phải bật xác thực 2 bước (2FA) để deploy/duyệt. Vào Cài đặt > Bảo mật để thiết lập.",
      });
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    role,
    isPrivileged,
    twoFactorEnabled,
    isLoading: meQ.isLoading,
  };
}
