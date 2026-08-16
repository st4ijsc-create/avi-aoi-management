/**
 * Doc 09 / Phase D5+ (UI) — Visual LADDER editor (dependency-free).
 *
 * A rung-grid editor for the IEC 61131-3 ladder DSL the server adapter already parses
 * (`iec61131-ld`): each rung is `OUTPUT := <boolean expr>`. It reads/writes the SAME text
 * buffer as the code editor, so the two stay in sync and the existing validate/build/
 * simulate (real one-scan eval) work unchanged. A Blockly/graph canvas can replace this
 * later; this avoids the blocked monaco/blockly dependency while delivering visual editing.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ArrowRight } from "lucide-react";

interface Rung { out: string; expr: string }

function parse(text: string): Rung[] {
  const rungs: Rung[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const code = raw.replace(/\(\*.*?\*\)/g, "").replace(/\/\/.*$/, "").trim();
    if (!code) continue;
    const m = code.match(/^([A-Za-z_]\w*)\s*:?=\s*(.+?)\s*;?$/);
    if (m) rungs.push({ out: m[1], expr: m[2] });
  }
  return rungs.length ? rungs : [{ out: "Y0", expr: "X0 AND NOT X1" }];
}

function serialize(rungs: Rung[]): string {
  return rungs.map((r) => `${r.out} := ${r.expr}`).join("\n");
}

const PALETTE = ["AND", "OR", "NOT", "XOR", "( )"];

export function LadderEditor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  const rungs = useMemo(() => parse(value), [value]);

  const update = (next: Rung[]) => onChange(serialize(next));
  const setRung = (i: number, patch: Partial<Rung>) =>
    update(rungs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRung = () => update([...rungs, { out: `Y${rungs.length}`, expr: "X0" }]);
  const removeRung = (i: number) => update(rungs.filter((_, idx) => idx !== i));
  const insertToken = (i: number, tok: string) =>
    setRung(i, { expr: `${rungs[i].expr} ${tok === "( )" ? "( )" : tok} `.replace(/\s+/g, " ").trim() });

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">
        Mỗi dòng = 1 rung: <code>{t("ladderEditor.outBieuThucBool", "OUT := biểu thức bool")}</code>. Mô phỏng chạy 1 scan thật (AND/OR/NOT/XOR).
      </div>
      {rungs.map((r, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border bg-background p-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{i + 1}</span>
            <Input
              className="h-8 w-24 font-mono"
              value={r.out}
              onChange={(e) => setRung(i, { out: e.target.value })}
              aria-label={`rung-${i}-out`}
            />
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              className="h-8 flex-1 font-mono"
              value={r.expr}
              onChange={(e) => setRung(i, { expr: e.target.value })}
              aria-label={`rung-${i}-expr`}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeRung(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 pl-6">
            {PALETTE.map((tok) => (
              <button
                key={tok}
                onClick={() => insertToken(i, tok)}
                className="rounded border px-1.5 py-0.5 text-[10px] font-mono hover:bg-muted"
              >
                {tok}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={addRung}>
        <Plus className="mr-1 h-4 w-4" /> Thêm rung
      </Button>
    </div>
  );
}

export default LadderEditor;
