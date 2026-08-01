import * as React from "react"
import { motion } from "framer-motion"
import { LogIn, Loader2, ShieldAlert } from "lucide-react"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useAuth } from "@/lib/auth"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/FormField"

/**
 * WS-D-D6 — the login gate `App.tsx` renders instead of the Shell whenever `useAuth().user` is
 * `null` (and this deployment is already bootstrapped — see `App.tsx`'s `AuthGate`). Renders OUTSIDE
 * the Shell's sidebar/topbar chrome, same reasoning as `/hmi/:code`/`/tokens` (App.tsx's own doc
 * comment): there's no fleet-aware nav to show someone who isn't authenticated yet.
 *
 * On a Demo-flagged deployment (`ST4I_DEMO_ENABLED=true` — the Playwright engine, an exhibition
 * `.exe`) `DemoAutoLoginMiddleware` signs a real `demo-admin` in on the very first request, so
 * `useAuth().user` is never actually `null` there and this screen never renders — see
 * `tests/17-auth.spec.ts` for how that reality is asserted instead of exercised end-to-end.
 */
export default function Login() {
  const t = useT()
  const gloss = useGloss()
  const { login } = useAuth()
  const [, navigate] = useLocation()

  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const trimmedUsername = username.trim()
  const canSubmit = trimmedUsername.length > 0 && password.length > 0 && !pending

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setError(null)
    try {
      await login(trimmedUsername, password)
      navigate("/")
    } catch {
      // `postLogin` throws `EngineApiError` on ANY non-2xx — 401 (wrong credentials) is by far the
      // common case, but a locked-down deployment has no other distinguishing signal to show
      // separately anyway (never reveal "wrong password" vs. "no such user" — see `AuthEndpoints.cs`'s
      // own username-enumeration hardening, which this message mirrors).
      setError(t("auth.login.invalidCredentials"))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex h-svh w-full items-center justify-center bg-surface-subtle p-6">
      <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="w-full max-w-sm">
        <Sheet title={t("auth.login.title")} titleEn={gloss("auth.login.title")} className="w-full">
          <p className="mb-4 text-sm text-text-body">{t("auth.login.subtitle")}</p>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <FormField
              label={t("auth.login.usernameLabel")}
              labelEn={gloss("auth.login.usernameLabel")}
              htmlFor="login-username"
            >
              <Input
                id="login-username"
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t("auth.login.usernamePlaceholder")}
              />
            </FormField>
            <FormField
              label={t("auth.login.passwordLabel")}
              labelEn={gloss("auth.login.passwordLabel")}
              htmlFor="login-password"
            >
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth.login.passwordPlaceholder")}
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

            <Button type="submit" disabled={!canSubmit} className="mt-1">
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn className="size-3.5" aria-hidden="true" />
              )}
              {pending ? t("auth.login.submitting") : t("auth.login.submit")}
            </Button>
          </form>
        </Sheet>
      </motion.div>
    </div>
  )
}
