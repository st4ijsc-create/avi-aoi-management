import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Route, Switch } from "wouter"

import { FleetRuntimeProvider } from "@/lib/api"
import TokensShowcase from "@/routes/_tokens"
import { Shell } from "@/shell/Shell"

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
    <QueryClientProvider client={queryClient}>
      <FleetRuntimeProvider>
        <Switch>
          <Route path="/tokens" component={TokensShowcase} />
          <Route>
            <Shell />
          </Route>
        </Switch>
      </FleetRuntimeProvider>
    </QueryClientProvider>
  )
}

export default App
