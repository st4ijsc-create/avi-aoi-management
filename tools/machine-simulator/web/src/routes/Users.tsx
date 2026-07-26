import * as React from "react"
import { motion } from "framer-motion"
import { Ban, Inbox, KeyRound, Loader2, ShieldAlert, UserCheck, UserPlus, Users as UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import {
  useCreateUser,
  useResetUserPassword,
  useSetUserDisabled,
  useSetUserRole,
  useUsers,
  UsersApiError,
  type UserDto,
} from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormField } from "@/components/FormField"
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
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/**
 * WS-D-D7 — Admin-only account management (`/users`): list/create/role/disable-enable/reset-password
 * over the same `IUserStore` D1 already built and D3 deferred wiring an HTTP surface onto
 * (`UserEndpoints.cs`). The REAL gate is the server's own `Policies.Admin` on every `/v1/users/*`
 * route (an Operator/Engineer gets a genuine 403 no matter what this screen does) — `RequireRole`
 * below is client-side-only UX: it keeps a non-admin from ever seeing the management chrome (or
 * `Sidebar.tsx`'s nav entry — `minRole:"Admin"`) instead of flashing it then 403ing on every request.
 *
 * The last-enabled-Admin lock-out guard (`UserEndpoints.cs`'s `IsLastEnabledAdmin`) is likewise
 * mirrored here client-side (`enabledAdminCount`) so the offending Disable button/role Select is simply
 * unavailable, not "clickable then rejected" — the server still enforces it independently (a second
 * browser tab, a stale roster snapshot), this is purely a friendlier front line for the common case.
 */

const ROLE_OPTIONS = ["Operator", "Engineer", "Admin"] as const

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function formatLastLogin(iso: string | null, neverLabel: string): string {
  if (!iso) return neverLabel
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? neverLabel : dateTimeFormatter.format(d)
}

/** Generic client-side role gate — `role` is the ONLY role allowed through; everything else renders
 * `children` never (a themed "not authorized" card instead). Local to this file since Users.tsx is,
 * for now, the only screen that needs it — factored as its own component rather than an inline `if`
 * so a future second Admin-only screen can import it instead of re-deriving the same check. */
function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const t = useT()
  const { user } = useAuth()

  if (user?.role !== role) {
    return (
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeSlideUp}
        className="flex flex-1 items-center justify-center p-8"
      >
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="size-6 text-destructive" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-semibold text-text-strong">{t("users.notAuthorized.title")}</h1>
            <p className="text-sm text-text-muted">{t("users.notAuthorized.description")}</p>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  return <>{children}</>
}

function Th({ vi, en, className }: { vi: string; en: string; className?: string }) {
  return (
    <TableHead className={className}>
      <span className="flex flex-col">
        <span>{vi}</span>
        <span className="hmi-micro font-normal" aria-hidden="true">
          {en}
        </span>
      </span>
    </TableHead>
  )
}

function RowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-32" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-6 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-7 w-40" />
      </TableCell>
    </TableRow>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Create-user dialog
// ─────────────────────────────────────────────────────────────────────────

const MIN_PASSWORD_LENGTH = 8

function CreateUserDialog({
  open,
  onOpenChange,
  existingUsernames,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingUsernames: Set<string>
}) {
  const t = useT()
  const createUser = useCreateUser()

  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [role, setRole] = React.useState<string>("Operator")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setUsername("")
      setPassword("")
      setDisplayName("")
      setRole("Operator")
      setError(null)
    }
  }, [open])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedUsername = username.trim()

    if (!trimmedUsername) {
      setError(t("users.createDialog.usernameRequired"))
      return
    }
    if (existingUsernames.has(trimmedUsername.toLowerCase())) {
      setError(t("users.createDialog.usernameDuplicate", { username: trimmedUsername }))
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("users.createDialog.passwordTooShort", { count: MIN_PASSWORD_LENGTH }))
      return
    }
    setError(null)

    createUser.mutate(
      { username: trimmedUsername, password, role, displayName: displayName.trim() || undefined },
      {
        onSuccess: (created) => {
          toast.success(t("toast.userCreated", { username: created.username }))
          onOpenChange(false)
        },
        onError: () => toast.error(t("toast.userCreateFailed")),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("users.createDialog.title")}</DialogTitle>
            <DialogDescription>{t("users.createDialog.description")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <FormField label={t("users.createDialog.usernameLabel")} htmlFor="create-user-username">
              <Input
                id="create-user-username"
                autoComplete="off"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("users.createDialog.usernamePlaceholder")}
              />
            </FormField>

            <FormField label={t("users.createDialog.passwordLabel")} htmlFor="create-user-password">
              <Input
                id="create-user-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>

            <FormField label={t("users.createDialog.displayNameLabel")} htmlFor="create-user-display-name">
              <Input
                id="create-user-display-name"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </FormField>

            <FormField label={t("users.createDialog.roleLabel")} htmlFor="create-user-role">
              <Select value={role} onValueChange={(next) => next && setRole(next)}>
                <SelectTrigger id="create-user-role" aria-label={t("users.createDialog.roleLabel")}>
                  <SelectValue>{role}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectPositioner>
                    <SelectPopup>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </SelectPositioner>
                </SelectPortal>
              </Select>
            </FormField>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("users.createDialog.cancel")}
            </Button>
            <Button type="submit" disabled={createUser.isPending}>
              {createUser.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {createUser.isPending ? t("users.createDialog.submitting") : t("users.createDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Reset-password dialog
// ─────────────────────────────────────────────────────────────────────────

function ResetPasswordDialog({ target, onOpenChange }: { target: UserDto | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const resetPassword = useResetUserPassword()
  const [newPassword, setNewPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (target) {
      setNewPassword("")
      setError(null)
    }
  }, [target])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!target) return
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t("users.resetPasswordDialog.passwordTooShort", { count: MIN_PASSWORD_LENGTH }))
      return
    }
    setError(null)

    resetPassword.mutate(
      { id: target.id, newPassword },
      {
        onSuccess: () => {
          toast.success(t("toast.userPasswordReset", { username: target.username }))
          onOpenChange(false)
        },
        onError: () => toast.error(t("toast.userPasswordResetFailed")),
      }
    )
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("users.resetPasswordDialog.title", { username: target?.username ?? "" })}</DialogTitle>
            <DialogDescription>{t("users.resetPasswordDialog.description")}</DialogDescription>
          </DialogHeader>

          <FormField label={t("users.resetPasswordDialog.newPasswordLabel")} htmlFor="reset-password-new">
            <Input
              id="reset-password-new"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </FormField>

          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("users.resetPasswordDialog.cancel")}
            </Button>
            <Button type="submit" disabled={resetPassword.isPending}>
              {resetPassword.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {resetPassword.isPending ? t("users.resetPasswordDialog.submitting") : t("users.resetPasswordDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// One roster row — inline role Select + disable/enable + reset-password action.
// ─────────────────────────────────────────────────────────────────────────

function UserRow({
  user,
  isLastEnabledAdmin,
  onOpenResetPassword,
}: {
  user: UserDto
  isLastEnabledAdmin: boolean
  onOpenResetPassword: (user: UserDto) => void
}) {
  const t = useT()
  const setUserRole = useSetUserRole()
  const setUserDisabled = useSetUserDisabled()

  function handleRoleChange(nextRole: string | null) {
    if (!nextRole || nextRole === user.role) return
    setUserRole.mutate(
      { id: user.id, role: nextRole },
      {
        onSuccess: () => toast.success(t("toast.userRoleUpdated", { username: user.username })),
        onError: (err) => {
          const guarded = err instanceof UsersApiError && err.status === 400
          toast.error(guarded ? t("users.lastAdminGuard") : t("toast.userRoleUpdateFailed"))
        },
      }
    )
  }

  function handleToggleDisabled() {
    const nextDisabled = !user.disabled
    setUserDisabled.mutate(
      { id: user.id, disabled: nextDisabled },
      {
        onSuccess: () =>
          toast.success(nextDisabled ? t("toast.userDisabled", { username: user.username }) : t("toast.userEnabled", { username: user.username })),
        onError: (err) => {
          const guarded = err instanceof UsersApiError && err.status === 400
          toast.error(guarded ? t("users.lastAdminGuard") : t("toast.userStatusUpdateFailed"))
        },
      }
    )
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-text-strong">{user.username}</TableCell>
      <TableCell>
        <Select
          value={user.role}
          onValueChange={handleRoleChange}
          disabled={isLastEnabledAdmin || setUserRole.isPending}
        >
          <SelectTrigger
            aria-label={t("users.table.roleAria", { username: user.username })}
            className="h-7 w-32 text-xs"
            title={isLastEnabledAdmin ? t("users.lastAdminGuard") : undefined}
          >
            <SelectValue>{user.role}</SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectPositioner>
              <SelectPopup>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectPopup>
            </SelectPositioner>
          </SelectPortal>
        </Select>
      </TableCell>
      <TableCell className="text-text-body">{user.displayName ?? "—"}</TableCell>
      <TableCell>
        <StatusBadge status={user.disabled ? "danger" : "ok"}>
          {user.disabled ? t("users.status.disabled") : t("users.status.enabled")}
        </StatusBadge>
      </TableCell>
      <TableCell className="text-text-muted">{formatLastLogin(user.lastLoginAtUtc, t("users.never"))}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={(!user.disabled && isLastEnabledAdmin) || setUserDisabled.isPending}
            title={!user.disabled && isLastEnabledAdmin ? t("users.lastAdminGuard") : undefined}
            onClick={handleToggleDisabled}
          >
            {user.disabled ? (
              <UserCheck className="size-3.5" aria-hidden="true" />
            ) : (
              <Ban className="size-3.5" aria-hidden="true" />
            )}
            {user.disabled ? t("users.actions.enable") : t("users.actions.disable")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onOpenResetPassword(user)}>
            <KeyRound className="size-3.5" aria-hidden="true" />
            {t("users.actions.resetPassword")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

function UsersScreen() {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError } = useUsers()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [resetTarget, setResetTarget] = React.useState<UserDto | null>(null)

  const users = React.useMemo(() => data ?? [], [data])
  const existingUsernames = React.useMemo(() => new Set(users.map((u) => u.username.toLowerCase())), [users])
  const enabledAdminCount = React.useMemo(
    () => users.filter((u) => u.role === "Admin" && !u.disabled).length,
    [users]
  )

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <UsersIcon className="size-5 text-primary-text" aria-hidden="true" />
            <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
              {t("users.title")}
            </h1>
          </div>
          <p className="hmi-micro mt-1">{gloss("users.title")}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("users.description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="size-3.5" aria-hidden="true" />
          {t("users.addUser")}
        </Button>
      </div>

      {isError ? (
        <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
      ) : !isPending && users.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="min-h-0 flex-1">
          <Sheet className="h-full" bodyClassName="flex h-full flex-col items-center justify-center gap-4 px-8 py-16 text-center">
            <div className="flex size-14 items-center justify-center border border-border-strong bg-surface-card">
              <Inbox className="size-7 text-primary-text" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold text-text-strong">{t("users.empty.title")}</p>
              <p className="max-w-sm text-sm text-text-muted">{t("users.empty.description")}</p>
            </div>
          </Sheet>
        </motion.div>
      ) : (
        <Sheet className="min-h-0 flex-1" title={t("users.title")} titleEn={gloss("users.title")} bodyClassName="flex flex-1 min-h-0 flex-col p-0">
          <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-surface-card">
                <TableRow>
                  <Th vi={t("users.table.username")} en={gloss("users.table.username")} />
                  <Th vi={t("users.table.role")} en={gloss("users.table.role")} />
                  <Th vi={t("users.table.displayName")} en={gloss("users.table.displayName")} />
                  <Th vi={t("users.table.status")} en={gloss("users.table.status")} />
                  <Th vi={t("users.table.lastLogin")} en={gloss("users.table.lastLogin")} />
                  <TableHead className="w-56">
                    <span className="sr-only">{t("users.table.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending
                  ? Array.from({ length: 3 }, (_, i) => <RowSkeleton key={i} />)
                  : users.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        isLastEnabledAdmin={user.role === "Admin" && !user.disabled && enabledAdminCount <= 1}
                        onOpenResetPassword={setResetTarget}
                      />
                    ))}
              </TableBody>
            </Table>
          </div>
        </Sheet>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} existingUsernames={existingUsernames} />
      <ResetPasswordDialog target={resetTarget} onOpenChange={(open) => !open && setResetTarget(null)} />
    </motion.div>
  )
}

export default function Users() {
  return (
    <RequireRole role="Admin">
      <UsersScreen />
    </RequireRole>
  )
}
