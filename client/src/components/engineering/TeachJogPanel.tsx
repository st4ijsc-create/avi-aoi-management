/**
 * Doc 09 / Phase D4+ (UI) — Robot TEACH / JOG panel (dependency-free).
 *
 * Lets an engineer jog a (simulated) TCP pose, CAPTURE points, and append job steps —
 * generating the `robot-tm` tmscript DSL the server adapter already parses (POINT defs +
 * HOME/MOVE/MOVEL/GRIP/RELEASE/WAIT). It reads/writes the SAME text buffer as the code
 * editor.
 *
 * HONEST: jog here moves a LOCAL preview pose only. Jogging a REAL robot (and downloading
 * the job) needs the TMflow Listen-Node path wired through robotCommandDispatcher with
 * ROBOT_CONTROL_ENABLED + HITL — that is the hardware-validation step, not done here.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Crosshair, Home, Hand, Grip, Timer, Plus } from "lucide-react";

type Pose = [number, number, number, number, number, number]; // x y z rx ry rz
const AXES = ["X", "Y", "Z", "RX", "RY", "RZ"] as const;

function definedPoints(text: string): string[] {
  const pts: string[] = [];
  for (const ln of text.split(/\r?\n/)) {
    const m = ln.match(/^\s*POINT\s+([A-Za-z_]\w*)/i);
    if (m) pts.push(m[1].toUpperCase());
  }
  return pts;
}

export function TeachJogPanel({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [pose, setPose] = useState<Pose>([0, 0, 200, 180, 0, 0]);
  const [step, setStep] = useState(5);
  const points = useMemo(() => definedPoints(value), [value]);

  const append = (line: string) => onChange(`${value.replace(/\s*$/, "")}\n${line}`.trim());
  const jog = (axis: number, dir: 1 | -1) =>
    setPose((p) => p.map((v, i) => (i === axis ? +(v + dir * step).toFixed(2) : v)) as Pose);

  const capture = () => {
    const name = `P${points.length + 1}`;
    append(`POINT ${name} = (${pose.join(",")})`);
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Jog (preview cục bộ) → Capture point → thêm job step.</span>
        <Badge variant="secondary" className="text-[10px]">no-HW preview</Badge>
      </div>

      {/* Jog grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {AXES.map((ax, i) => (
          <div key={ax} className="flex items-center gap-1 rounded border bg-background p-1.5">
            <span className="w-8 text-xs font-medium">{ax}</span>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => jog(i, -1)}>−</Button>
            <span className="w-14 text-center font-mono text-xs">{pose[i]}</span>
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => jog(i, 1)}>+</Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-xs">Bước</Label>
        <Input type="number" className="h-7 w-20" value={step} onChange={(e) => setStep(Number(e.target.value) || 1)} />
        <Button size="sm" onClick={capture}><Crosshair className="mr-1 h-4 w-4" /> Capture point</Button>
      </div>

      {/* Job-step palette */}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={() => append("HOME")}><Home className="mr-1 h-3 w-3" /> HOME</Button>
        {points.map((p) => (
          <Button key={`m${p}`} size="sm" variant="outline" onClick={() => append(`MOVE ${p}`)}>MOVE {p}</Button>
        ))}
        {points.map((p) => (
          <Button key={`l${p}`} size="sm" variant="ghost" onClick={() => append(`MOVEL ${p}`)}>MOVEL {p}</Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => append("GRIP")}><Grip className="mr-1 h-3 w-3" /> GRIP</Button>
        <Button size="sm" variant="outline" onClick={() => append("RELEASE")}><Hand className="mr-1 h-3 w-3" /> RELEASE</Button>
        <Button size="sm" variant="outline" onClick={() => append("WAIT t=500")}><Timer className="mr-1 h-3 w-3" /> WAIT</Button>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {points.length === 0 ? "Chưa có point — Capture để thêm." : `${points.length} point: ${points.join(", ")}`}
      </div>
    </div>
  );
}

export default TeachJogPanel;
