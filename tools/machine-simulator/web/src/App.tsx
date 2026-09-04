import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Route, Switch } from "wouter"

import { LanguageProvider, useT } from "@/i18n"
import { FleetRuntimeProvider } from "@/lib/api"
import { AuthProvider, useAuth, useBootstrapStatus } from "@/lib/auth"
import Bootstrap from "@/routes/Bootstrap"
import Hmi from "@/routes/Hmi"
import Login from "@/routes/Login"
import TokensShowcase from "@/routes/_tokens"
import { Shell } from "@/shell/Shell"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/theme/ThemeToggle"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Local engine on the same machine — a failed request is almost always "not running yet",
      // not a flaky network. Retrying a few times with backoff avoids a false-negative "offline"
      // flash right as the app boots before the engine has finished starting.
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

function AuthSplash() {
  const t = useT()
  return (
    <div className="flex h-svh w-full items-center justify-center bg-surface-subtle">
      <div className="hmi-micro">{t("auth.splash")}</div>
    </div>
  )
}

/**
 * WS-D-D6 — the top-level login/bootstrap gate. Order matters and mirrors the task brief exactly:
 * loading splash first (neither query has answered yet — showing either screen prematurely would
 * flash-then-correct), THEN bootstrap-status (a never-provisioned deployment needs an Admin account
 * before "log in" even makes sense), THEN the actual session check, THEN — only once all three have
 * cleared — the real app.
 *
 * On a Demo-flagged deployment (`ST4I_DEMO_ENABLED=true` — the Playwright engine, an exhibition
 * `.exe`) `DemoAutoLoginMiddleware` (`St4i.EngineApi`) signs a real `demo-admin` Admin account in on
 * the very FIRST request that hits the pipeline, before either query above even resolves — so
 * `bootstrapStatus.needsBootstrap` is already `false` and `auth.user` is already the demo-admin by
 * the time this gate can render anything, and `children` (the normal Shell/routes tree) renders
 * immediately with zero manual login. See `tests/17-auth.spec.ts` for how that's asserted.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const bootstrapStatus = useBootstrapStatus()

  if (auth.isLoading || bootstrapStatus.isLoading) return <AuthSplash />
  if (bootstrapStatus.data?.needsBootstrap) return <Bootstrap />
  if (auth.user == null) return <Login />
  return <>{children}</>
}

// Task 4 (doc 65): the real app shell (sidebar/topbar/⌘K + live dashboard) replaces the Task 2
// design-token showcase as the app's entry point. `/tokens` stays reachable standalone — it's a
// living style reference, not a shell screen — everything else routes through <Shell>. WS-D-D6 wraps
// all of it in `<AuthGate>` (inside `AuthProvider`, above `FleetRuntimeProvider`) — `/tokens` and
// `/hmi/:code` render outside the Shell's own chrome (unchanged reasoning below) but are STILL behind
// login now, same as every other route: the backend's default-deny fallback policy (D1) requires an
// authenticated session for every `/v1/*` call `FleetRuntimeProvider`/`Hmi.tsx` make regardless of
// which of these three trees is on screen.
function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AuthGate>
              <FleetRuntimeProvider>
                <Switch>
                  <Route path="/tokens" component={TokensShowcase} />
                  {/* H2 — the HMI operator panel renders as a genuine full-screen kiosk, OUTSIDE
                      <Shell>'s sidebar/topbar chrome (docs/HMI_DESIGN_SPEC.md §8), same reasoning as
                      /tokens above. */}
                  {/* WS-HMI-2 Task 5 — the ENGINEERING demo route, ahead of `/hmi/:code` because it is
                      the more specific pattern (three segments, a literal middle one). It renders a
                      named screen DOCUMENT (`lib/hmiScreens.ts`) instead of the document a machine's
                      own `DeviceClass` selects, against `DEMO_MACHINE_CODE`'s live data. It is NOT part
                      of any machine's operator panel and nothing links to it — plan §5-bis: the default
                      fleet's panels stay exactly as they were. It exists because `{component}` indirect
                      binding and (WS-HMI-2 Task 6) twelve widget kinds have no shipped screen that uses
                      them, and adding them to one of the three that ARE shipped would move a pinned
                      visual baseline. Same `Hmi` component either way — the kiosk chrome, the machine
                      poll and the control rail are identical; only which document the renderer is
                      handed differs. */}
                  <Route path="/hmi/demo/:screenId" component={Hmi} />
                  <Route path="/hmi/:code" component={Hmi} />
                  <Route>
                    <Shell />
                  </Route>
                </Switch>
              </FleetRuntimeProvider>
            </AuthGate>
            <Toaster />
          </AuthProvider>
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

export default App
