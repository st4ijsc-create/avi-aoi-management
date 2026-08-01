/**
 * SYNAPSE cockpit tool-widget (doc 33 §11) — a JSON-in → JSON-out dry-run card.
 *
 * Seeds a valid example payload, sends it to a READ-ONLY preview/dry-run endpoint, and pretty-prints
 * the result (or the validation/engine error). No mutations, no new control path — these turn the
 * platform cockpit from "visible" into "usable/demoable" for a platform admin/engineer.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ToolCard({
  title,
  description,
  seed,
  run,
}: {
  title: string;
  description: string;
  seed: unknown;
  run: (input: unknown) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const initial = JSON.stringify(seed, null, 2);
  const [text, setText] = useState(initial);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onRun = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`JSON: ${(e as Error).message}`);
      setBusy(false);
      return;
    }
    try {
      setResult(JSON.stringify(await run(parsed), null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{description}</p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          className="font-mono text-xs"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onRun} disabled={busy}>
            {busy ? "…" : t("synapse.tools.run", "Chạy thử")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText(initial);
              setResult(null);
              setError(null);
            }}
          >
            {t("synapse.tools.reset", "Đặt lại")}
          </Button>
        </div>
        {error && <pre className="whitespace-pre-wrap rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</pre>}
        {result && <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{result}</pre>}
      </CardContent>
    </Card>
  );
}
