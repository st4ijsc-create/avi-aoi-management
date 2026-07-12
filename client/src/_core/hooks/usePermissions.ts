import { trpc } from "@/lib/trpc";
import { useCallback, useMemo } from "react";
import { useAuth } from "./useAuth";
// doc 40 Lan-P0/DEV-02 — resolve "permission ma" `machine_monitoring` → `machine_status`
// ở CÙNG một điểm với server (accessControl) để client ↔ server luôn khớp module.
import { resolvePermissionModule } from "@shared/permissions";

export type PermissionAction = 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canExport';

export interface UserPermission {
  id: number;
  userId: number;
  category: string;
  moduleName: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  customPermissions?: Record<string, any> | null;
  expiresAt?: Date | string | null;
}

/**
 * Hook to manage user permissions with caching.
 * Admin users automatically have all permissions.
 */
export function usePermissions() {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = user?.role === 'admin';

  const permissionsQuery = trpc.permissions.getMyPermissions.useQuery(undefined, {
    enabled: isAuthenticated && !isAdmin, // Skip for admin (they have all permissions)
    staleTime: 60_000, // Cache for 1 minute
    refetchOnWindowFocus: false,
  });

  const permissionsMap = useMemo(() => {
    const map = new Map<string, UserPermission>();
    if (permissionsQuery.data) {
      for (const perm of permissionsQuery.data) {
        map.set(perm.moduleName, perm as UserPermission);
      }
    }
    return map;
  }, [permissionsQuery.data]);

  /**
   * Check if user has a specific permission for a module.
   * Admin users always return true.
   */
  const hasPermission = useCallback(
    (moduleName: string, action: PermissionAction = 'canView'): boolean => {
      if (isAdmin) return true;
      const perm = permissionsMap.get(resolvePermissionModule(moduleName));
      if (!perm) return false;
      // Check expiration
      if (perm.expiresAt) {
        const expiresAt = typeof perm.expiresAt === 'string' ? new Date(perm.expiresAt) : perm.expiresAt;
        if (expiresAt < new Date()) return false;
      }
      return perm[action] === true;
    },
    [isAdmin, permissionsMap],
  );

  /**
   * Check if user can view any module in a category.
   * Used for group-level visibility in navigation.
   */
  const hasAnyCategoryPermission = useCallback(
    (category: string): boolean => {
      if (isAdmin) return true;
      const perms = permissionsQuery.data;
      if (!perms) return false;
      for (let i = 0; i < perms.length; i++) {
        const perm = perms[i] as UserPermission;
        if (perm.category === category && perm.canView) {
          // Check expiration
          if (perm.expiresAt) {
            const expiresAt = typeof perm.expiresAt === 'string' ? new Date(perm.expiresAt) : perm.expiresAt;
            if (expiresAt < new Date()) continue;
          }
          return true;
        }
      }
      return false;
    },
    [isAdmin, permissionsQuery.data],
  );

  /**
   * Get all permissions as flat list.
   */
  const allPermissions = useMemo(
    () => (isAdmin ? [] : (permissionsQuery.data as UserPermission[] | undefined) ?? []),
    [isAdmin, permissionsQuery.data],
  );

  return {
    /** Whether permissions are still loading */
    loading: !isAdmin && permissionsQuery.isLoading,
    /** All user permissions (empty for admin) */
    permissions: allPermissions,
    /** Map of moduleName → permission */
    permissionsMap,
    /** Check if user has a specific permission */
    hasPermission,
    /** Check if user has any canView in a category */
    hasAnyCategoryPermission,
    /** Whether current user is admin (has all permissions) */
    isAdmin,
    /** Refresh permissions from server */
    refresh: () => permissionsQuery.refetch(),
  };
}
