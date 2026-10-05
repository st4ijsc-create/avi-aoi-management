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
// Fix round 5 (Task 5) — the roles constant moved to a React-free module so page-level gating
// helpers (client/src/lib/robotMotionLock.ts) can share it and be unit-tested; same values.
import { ACTUATION_ROLES } from "@/lib/actuationRoles";

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

/**
 * doc 81 Đợt 3 final wave (Task 0 minor 3) — MỘT hằng cho cảnh báo 2FA (trước đây chép hai lần trong file này).
 */
export const TWO_FA_BLOCKER: ActuationBlocker = {
  code: "2fa",
  severity: "error",
  defaultMessage:
    "Tài khoản đặc quyền phải bật xác thực 2 bước (2FA) để deploy/duyệt. Vào Cài đặt > Bảo mật để thiết lập.",
};

/**
 * doc 81 Đợt 3 final wave — "thiếu 2FA mà server SẼ đòi": tài khoản chưa bật 2FA VÀ triển khai bắt buộc 2FA
 * (`auth.me.twoFactorRequired` = `batBuoc2FA()` của server). Chế độ nội bộ (`AUTH_2FA_BAT_BUOC=0`, quyết định chủ dự án
 * 2026-09-26: 2FA không tiên quyết) ⇒ `false` ⇒ KHÔNG cảnh báo/khoá giả. Ô vắng (server cũ) ⇒ coi là bắt buộc (mặc định
 * của server: mọi giá trị khác `"0"`). Chỉ là tư vấn — server vẫn là bức tường.
 */
export function twoFactorSetupMissing(me: { twoFactorEnabled?: boolean | null; twoFactorRequired?: boolean | null } | null | undefined): boolean {
  if (!me) return false;
  return me.twoFactorRequired !== false && !me.twoFactorEnabled;
}

export function useActuationReadiness(): ActuationReadiness {
  const meQ = trpc.auth.me.useQuery();
  const me = meQ.data as { role?: string | null; twoFactorEnabled?: boolean; twoFactorRequired?: boolean } | null | undefined;

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
    } else if (twoFactorSetupMissing(me)) {
      // Privileged role, 2FA off AND the deployment requires it → the server will reject actuation. Warn now.
      // (Final wave: internal mode `AUTH_2FA_BAT_BUOC=0` ⇒ the server does NOT require it ⇒ no false warning.)
      blockers.push(TWO_FA_BLOCKER);
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

/** Một cổng của `programming.deployPreview` (chỉ các ô cần đọc). */
export interface DeployPreviewGateLike {
  name: string;
  ok: boolean;
  reason?: string;
}

/**
 * doc 81 Đợt 3 Task 0 (O2, browser check 2026-10-05) — cảnh báo 2FA đọc CÙNG nguồn với bản xem trước deploy.
 *
 * Hook trên không biết chính sách 2FA của triển khai (`AUTH_2FA_BAT_BUOC=0` — chế độ nội bộ, quyết định chủ dự án
 * 2026-09-26: 2FA không là điều kiện tiên quyết), nên báo "phải bật 2FA" ngay trên bản xem trước nói cổng 2FA ĐẠT.
 * `deployPreview.callerGates` mirror đúng `deployProcedure` (require2FA → step-up) ⇒ cổng `twoFactor` của nó là sự thật:
 *   · cổng ĐẠT ⇒ bỏ cảnh báo 2FA; cổng CHẶN ⇒ có cảnh báo 2FA;
 *   · không có cổng `twoFactor` (chưa có bản xem trước, hoặc lối Hộp duyệt — người duyệt ký) ⇒ giữ cảnh báo tư vấn của hook.
 * Chỉ đổi THÔNG ĐIỆP (tư vấn) — server vẫn là bức tường; không cổng nào được nới.
 */
export function reconcileBlockersWithDeployPreview(
  blockers: readonly ActuationBlocker[],
  gates: readonly DeployPreviewGateLike[] | null | undefined,
): ActuationBlocker[] {
  const tf = gates?.find((g) => g.name === "twoFactor");
  if (!tf) return [...blockers];
  const others = blockers.filter((b) => b.code !== "2fa");
  if (tf.ok) return others;
  return [...others, blockers.find((b) => b.code === "2fa") ?? TWO_FA_BLOCKER];
}
