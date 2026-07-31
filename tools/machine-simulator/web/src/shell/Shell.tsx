import * as React from "react"
import { Route, Switch } from "wouter"

import Dashboard from "@/routes/Dashboard"
import Machines from "@/routes/Machines"
import MachineDetail from "@/routes/MachineDetail"
import ProductConfig from "@/routes/ProductConfig"
import ProductConfigDetail from "@/routes/ProductConfigDetail"
import RecipeConfig from "@/routes/RecipeConfig"
import RecipeConfigDetail from "@/routes/RecipeConfigDetail"
import Onboarding from "@/routes/Onboarding"
import ApiInspector from "@/routes/ApiInspector"
import Scenario from "@/routes/Scenario"
import Historian from "@/routes/Historian"
import Reports from "@/routes/Reports"
import Settings from "@/routes/Settings"
import Users from "@/routes/Users"
import Audit from "@/routes/Audit"
import AssetRegistry from "@/routes/AssetRegistry"
import Connectors from "@/routes/Connectors"
import Site from "@/routes/Site"
import AlarmCenter from "@/routes/AlarmCenter"
import LineControl from "@/routes/LineControl"
import NotFound from "@/routes/NotFound"
import { Sidebar } from "@/shell/Sidebar"
import { TopBar } from "@/shell/TopBar"
import { CommandPalette } from "@/shell/CommandPalette"
import { AlarmAnnunciatorOverlay } from "@/components/AlarmAnnunciator"
import { AnnunciatorProvider } from "@/lib/annunciator"

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

  // Task C-5 — the local-annunciation surface wraps the WHOLE shell, not just /alarms: an
  // annunciator that only reaches somebody already looking at the Alarm Center annunciates nothing.
  // One SSE connection for the session, opened here and shared by the overlay below and by
  // /alarms' own status strip. It renders nothing at all until an alarm edge actually arrives, so a
  // quiet engine costs one idle HTTP connection and no pixels. `/hmi/:code` and `/tokens` render
  // OUTSIDE this tree (see App.tsx) and are therefore NOT annunciated — see the C-5 report.
  return (
    <AnnunciatorProvider>
    <div className="flex h-svh overflow-hidden bg-surface-subtle text-text-body">
      <Sidebar />
      <AlarmAnnunciatorOverlay />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        <main className="flex flex-1 flex-col overflow-y-auto">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/machines" component={Machines} />
            <Route path="/machines/:code" component={MachineDetail} />
            <Route path="/products" component={ProductConfig} />
            <Route path="/products/:code" component={ProductConfigDetail} />
            <Route path="/recipes" component={RecipeConfig} />
            <Route path="/recipes/:code" component={RecipeConfigDetail} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/inspector" component={ApiInspector} />
            <Route path="/scenario" component={Scenario} />
            <Route path="/historian" component={Historian} />
            <Route path="/reports" component={Reports} />
            <Route path="/settings" component={Settings} />
            <Route path="/users" component={Users} />
            <Route path="/audit" component={Audit} />
            <Route path="/assets" component={AssetRegistry} />
            <Route path="/connectors" component={Connectors} />
            <Route path="/site" component={Site} />
            <Route path="/alarms" component={AlarmCenter} />
            <Route path="/line" component={LineControl} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
    </AnnunciatorProvider>
  )
}
