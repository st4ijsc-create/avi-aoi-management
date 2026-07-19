import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

function App() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          ST4I Machine Simulator
        </h1>
        <p className="text-sm text-muted-foreground">
          Web UI scaffold — Vite + React + Tailwind 4 + shadcn/ui + Tauri 2
        </p>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Scaffold check
            <Badge variant="secondary">v0.0.0</Badge>
          </CardTitle>
          <CardDescription>
            Confirms Tailwind CSS 4 + shadcn/ui primitives render correctly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input placeholder="Station ID" />
          <Button>Connect to EdgeCore</Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default App
