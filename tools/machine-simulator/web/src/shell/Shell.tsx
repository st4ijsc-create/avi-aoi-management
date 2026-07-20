import * as React from "react"
import { Route, Switch } from "wouter"

import Dashboard from "@/routes/Dashboard"
import Machines from "@/routes/Machines"
import MachineDetail from "@/routes/MachineDetail"
import ProductConfig from "@/routes/ProductConfig"
import ProductConfigDetail from "@/routes/ProductConfigDetail"
import Onboarding from "@/routes/Onboarding"
import ApiInspector from "@/routes/ApiInspector"
import Scenario from "@/routes/Scenario"
import Settings from "@/routes/Settings"
import NotFound from "@/routes/NotFound"
import { Sidebar } from "@/shell/Sidebar"
import { TopBar } from "@/shell/TopBar"
import { CommandPalette } from "@/shell/CommandPalette"

export function Shell() {
  const [paletteOpen, setPaletteOpen] = React.useState(false)

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isModK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"
      if (!isModK) return
      event.preventDefault()
      setPaletteOpen((open) => !open)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="flex h-svh overflow-hidden bg-surface-subtle text-text-body">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        <main className="flex flex-1 flex-col overflow-y-auto">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/machines" component={Machines} />
            <Route path="/machines/:code" component={MachineDetail} />
            <Route path="/products" component={ProductConfig} />
            <Route path="/products/:code" component={ProductConfigDetail} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/inspector" component={ApiInspector} />
            <Route path="/scenario" component={Scenario} />
            <Route path="/settings" component={Settings} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}
