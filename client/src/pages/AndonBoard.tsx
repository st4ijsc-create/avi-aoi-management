/**
 * Sprint F5a — Andon Board (ALERT-ONLY, read-mostly).
 *
 * Shows active Andon events in real time (subscribes to the `andon:event` socket
 * event) with Acknowledge / Resolve actions. Andon is a SIGNAL only — nothing
 * here writes a command to a machine.
 */
import { useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { getSharedSocket } from "@/lib/socketManager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATE_COLOR: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-600",
  call: "bg-blue-500",
};

export default function AndonBoard() {
  const utils = trpc.useUtils();
  const activeQuery = trpc.andon.active.useQuery(undefined, { refetchInterval: 30_000 });
  const metricsQuery = trpc.andon.metrics.useQuery({ sinceHours: 24 });

  const ackMutation = trpc.andon.acknowledge.useMutation({
    onSuccess: () => {
      void utils.andon.active.invalidate();
      void utils.andon.metrics.invalidate();
    },
  });
  const resolveMutation = trpc.andon.resolve.useMutation({
    onSuccess: () => {
      void utils.andon.active.invalidate();
      void utils.andon.metrics.invalidate();
    },
  });

  // Realtime: refresh on any andon:event broadcast.
  useEffect(() => {
    const socket = getSharedSocket();
    const handler = () => {
      void utils.andon.active.invalidate();
      void utils.andon.metrics.invalidate();
    };
    socket.on("andon:event", handler);
    socket.emit("subscribe", {});
    return () => {
      socket.off("andon:event", handler);
    };
  }, [utils]);

  const events = activeQuery.data ?? [];
  const metrics = metricsQuery.data;

  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime()),
    [events],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Andon Board</h1>
        <span className="text-sm text-muted-foreground">Tín hiệu cảnh báo — KHÔNG điều khiển máy (ALERT-ONLY)</span>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Metric label="Tổng (24h)" value={metrics.total} />
          <Metric label="Đang mở" value={metrics.active} />
          <Metric label="Đã xử lý" value={metrics.resolved} />
          <Metric label="MTTA (s)" value={metrics.avgMttaSeconds} />
          <Metric label="MTTR (s)" value={metrics.avgMttrSeconds} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Andon đang hoạt động ({sorted.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sorted.length === 0 && <p className="text-muted-foreground">Không có Andon đang mở.</p>}
          {sorted.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <span className={`inline-block h-4 w-4 rounded-full ${STATE_COLOR[e.state] ?? "bg-gray-400"}`} />
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-sm text-muted-foreground">{e.message}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.reason} · {e.raisedBySystem ? "system" : "manual"} ·{" "}
                    {new Date(e.raisedAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={e.status === "raised" ? "destructive" : "secondary"}>{e.status}</Badge>
                {e.status === "raised" && (
                  <Button size="sm" variant="outline" disabled={ackMutation.isPending} onClick={() => ackMutation.mutate({ id: e.id })}>
                    Acknowledge
                  </Button>
                )}
                {e.status !== "resolved" && (
                  <Button size="sm" disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate({ id: e.id })}>
                    Resolve
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
