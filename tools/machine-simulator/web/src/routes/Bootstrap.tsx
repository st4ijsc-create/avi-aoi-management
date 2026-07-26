import * as React from "react"
import { motion } from "framer-motion"
import { Loader2, ShieldAlert, ShieldPlus } from "lucide-react"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useBootstrap } from "@/lib/auth"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/FormField"

/**
 * WS-D-D6 — `App.tsx`'s `AuthGate` renders this BEFORE ever checking `useAuth().user` whenever
 * `useBootstrapStatus().data.needsBootstrap` is true (this deployment's `security.db` has zero user
 * rows, `AuthEndpoints.cs`'s `bootstrap-status` handler) — a fresh customer install, never a Demo/
 * Playwright engine (`DemoAutoLoginMiddleware` auto-provisions `demo-admin` on the very first request
 * there, so `needsBootstrap` is already false by the time this could render — see
 * `tests/17-auth.spec.ts`). Renders outside the Shell chrome, same as `Login.tsx`.
 */
export default function Bootstrap() {
  const t = useT()
  const gloss = useGloss()
  const [, navigate] = useLocation()
  const bootstrap = useBootstrap()

  const [username, setUsername] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [validationError, setValidationError] = React.useState<string | null>(null)

  const pending = bootstrap.isPending
  const error = validationError ?? (bootstrap.isError ? t("auth.bootstrap.genericError") : null)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      setValidationError(t("auth.bootstrap.requiredError"))
      return
    }
    if (password !== confirmPassword) {
      setValidationError(t("auth.bootstrap.passwordMismatch"))
      return
    }
    setValidationError(null)
    bootstrap.mutate(
      { username: trimmedUsername, password, displayName: displayName.trim() || undefined },
      { onSuccess: () => navigate("/") }
    )
  }

  return (
    <div className="flex h-svh w-full items-center justify-center bg-surface-subtle p-6">
      <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="w-full max-w-sm">
        <Sheet title={t("auth.bootstrap.title")} titleEn={gloss("auth.bootstrap.title")} className="w-full">
          <p className="mb-4 text-sm text-text-body">{t("auth.bootstrap.description")}</p>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <FormField
              label={t("auth.bootstrap.usernameLabel")}
              labelEn={gloss("auth.bootstrap.usernameLabel")}
              htmlFor="bootstrap-username"
            >
              <Input
                id="bootstrap-username"
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </FormField>
            <FormField
              label={t("auth.bootstrap.displayNameLabel")}
              labelEn={gloss("auth.bootstrap.displayNameLabel")}
              htmlFor="bootstrap-display-name"
            >
              <Input
                id="bootstrap-display-name"
                name="displayName"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </FormField>
            <FormField
              label={t("auth.bootstrap.passwordLabel")}
              labelEn={gloss("auth.bootstrap.passwordLabel")}
              htmlFor="bootstrap-password"
            >
              <Input
                id="bootstrap-password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
            <FormField
              label={t("auth.bootstrap.confirmPasswordLabel")}
              labelEn={gloss("auth.bootstrap.confirmPasswordLabel")}
              htmlFor="bootstrap-confirm-password"
            >
              <Input
                id="bootstrap-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </FormField>

            {error ? (
              <div
                role="alert"
                className="flex items-center gap-2 border border-status-fault/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
                {error}
              </div>
            ) : null}

            <Button type="submit" disabled={pending} className="mt-1">
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldPlus className="size-3.5" aria-hidden="true" />
              )}
              {pending ? t("auth.bootstrap.submitting") : t("auth.bootstrap.submit")}
            </Button>
          </form>
        </Sheet>
      </motion.div>
    </div>
  )
}
