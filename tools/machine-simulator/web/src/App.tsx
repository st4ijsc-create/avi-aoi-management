import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Route, Switch } from "wouter"

import { LanguageProvider } from "@/i18n"
import { FleetRuntimeProvider } from "@/lib/api"
import Hmi from "@/routes/Hmi"
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

// Task 4 (doc 65): the real app shell (sidebar/topbar/⌘K + live dashboard) replaces the Task 2
// design-token showcase as the app's entry point. `/tokens` stays reachable standalone — it's a
// living style reference, not a shell screen — everything else routes through <Shell>.
function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <FleetRuntimeProvider>
            <Switch>
              <Route path="/tokens" component={TokensShowcase} />
              {/* H2 — the HMI operator panel renders as a genuine full-screen kiosk, OUTSIDE <Shell>'s
                  sidebar/topbar chrome (docs/HMI_DESIGN_SPEC.md §8), same reasoning as /tokens above. */}
              <Route path="/hmi/:code" component={Hmi} />
              <Route>
                <Shell />
              </Route>
            </Switch>
            <Toaster />
          </FleetRuntimeProvider>
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

export default App
