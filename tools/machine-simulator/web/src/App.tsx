import { Route, Switch } from "wouter"

import TokensShowcase from "@/routes/_tokens"

// Pre-dashboard scaffold state (Task 2 of the web-UI rebuild, doc 65): the
// design-token showcase IS the app entry for now. Real routes (dashboard,
// machine detail, inspector, …) land in later tasks and will replace this
// Switch with the actual app shell.
function App() {
  return (
    <Switch>
      <Route path="/tokens" component={TokensShowcase} />
      <Route component={TokensShowcase} />
    </Switch>
  )
}

export default App
