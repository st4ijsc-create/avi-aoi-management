/**
 * doc 67 W3 (việc 1+2a+3+4+5) — thẻ NHÓM cảnh báo đã coalesce cho War Room.
 *
 *  - Việc 1: 1 thẻ / nhóm (source+title+vị trí) + badge "×N lần" + "mới nhất
 *    Xs trước" (bản ghi MỚI NHẤT) + Collapsible xem từng bản ghi con.
 *  - Việc 2a: "Xác nhận cả nhóm (N)" cho nguồn có ack; nhóm interlock/mqtt là
 *    "Xử lý cả nhóm (N)" đi qua AlertDialog confirm ở trang (ngữ nghĩa W1:
 *    resolve = đóng vĩnh viễn).
 *  - Việc 3: quá hạn → ring destructive + badge "QUÁ HẠN Xm"; hết hạn dự báo
 *    → badge "HẾT HẠN DỰ BÁO" + mờ (không xóa).
 *  - Việc 4: React.memo — gõ search/chọn checkbox ở trang không re-render 85 thẻ.
 *  - Việc 5: disable theo pendingKeys per-alert, không khóa cả trang.
 *
 * Touch target: nút hành động chính h-11 (44px) — persona đeo găng, panel 10.1".
 */
import { memo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import AgeLabel from "./AgeLabel";
import {
  type AlertGroup, type DecoratedAlert,
  SEVERITY_TILE, SOURCE_ICON, isAckOnly, isResolveOnly,
} from "./model";

function EscalationBadges({ a }: { a: { overdue: boolean; overdueMin: number; expired: boolean } }) {
  return (
    <>
      {a.overdue && (
        <Badge className="animate-pulse border-transparent bg-background font-bold text-destructive">
          QUÁ HẠN {a.overdueMin}m
        </Badge>
      )}
      {a.expired && (
        <Badge variant="outline" className="border-current text-current opacity-90">
          HẾT HẠN DỰ BÁO
        </Badge>
      )}
    </>
  );
}

/** Cặp nút hành động cho MỘT bản ghi — đúng ngữ nghĩa W1 theo nguồn. */
function ItemActions({
  a, pendingKeys, onAck, onRequestResolve, size = "lg",
}: {
  a: DecoratedAlert;
  pendingKeys: Set<string>;
  onAck: (a: DecoratedAlert) => void;
  onRequestResolve: (a: DecoratedAlert) => void;
  size?: "lg" | "sm";
}) {
  const pending = pendingKeys.has(a.key);
  const h = size === "lg" ? "h-11" : "h-9";
  return (
    <div className="flex shrink-0 flex-col gap-1">
      {!isResolveOnly(a.source) && !a.acknowledged && (
        <Button size="sm" variant="secondary" className={h} disabled={pending} onClick={() => onAck(a)}>
          Xác nhận
        </Button>
      )}
      {!isAckOnly(a.source) && (
        <Button size="sm" variant="outline" className={h} disabled={pending} onClick={() => onRequestResolve(a)}>
          Xử lý xong
        </Button>
      )}
    </div>
  );
}

export const AlertGroupCard = memo(function AlertGroupCard({
  group: g,
  pendingKeys,
  onAck,
  onRequestResolve,
  onBulkAck,
  onBulkResolveRequest,
}: {
  group: AlertGroup;
  pendingKeys: Set<string>;
  onAck: (a: DecoratedAlert) => void;
  onRequestResolve: (a: DecoratedAlert) => void;
  onBulkAck: (g: AlertGroup) => void;
  onBulkResolveRequest: (g: AlertGroup) => void;
}) {
  const [open, setOpen] = useState(false);
  const anyPending = g.items.some((i) => pendingKeys.has(i.key));
  const single = g.count === 1;

  return (
    <div
      className={cn(
        "rounded-md border-2 p-3",
        SEVERITY_TILE[g.severity],
        g.severity === "critical" && g.unackedCount > 0 && "animate-pulse",
        // Việc 3: critical chưa ack quá 10' → viền/ring destructive nổi bật hơn nền tile.
        g.overdue && "ring-2 ring-destructive ring-offset-2 ring-offset-background",
        // Việc 3: quá cửa sổ dự báo → mờ đi nhưng KHÔNG xóa (trung thực).
        g.expired && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {SOURCE_ICON[g.source]}
            <span className="truncate">{g.title}</span>
            {!single && (
              <Badge variant="outline" className="shrink-0 border-current font-bold text-current">
                ×{g.count} lần
              </Badge>
            )}
            <EscalationBadges a={g} />
          </div>
          <p className="mt-1 line-clamp-2 text-xs opacity-90">{g.latest.message}</p>
          <div className="mt-1 text-xs opacity-80">
            {single ? "Tuổi: " : "Mới nhất: "}
            <AgeLabel raisedAt={g.latest.raisedAt} /> trước
            {g.unackedCount === 0 && " · ACK"}
            {!single && g.unackedCount > 0 && g.unackedCount < g.count && ` · còn ${g.unackedCount} chưa ACK`}
          </div>
        </div>

        {single ? (
          <ItemActions a={g.items[0]} pendingKeys={pendingKeys} onAck={onAck} onRequestResolve={onRequestResolve} />
        ) : (
          <div className="flex shrink-0 flex-col gap-1">
            {isResolveOnly(g.source) ? (
              <Button size="sm" variant="outline" className="h-11" disabled={anyPending} onClick={() => onBulkResolveRequest(g)}>
                Xử lý cả nhóm ({g.count})
              </Button>
            ) : g.unackedCount > 0 ? (
              <Button size="sm" variant="secondary" className="h-11" disabled={anyPending} onClick={() => onBulkAck(g)}>
                Xác nhận cả nhóm ({g.unackedCount})
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {/* Việc 1: mở rộng xem từng bản ghi con khi cần. */}
      {!single && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-9 w-full justify-start gap-1 px-1 text-xs font-semibold text-current hover:bg-background/20">
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
              {open ? "Thu gọn" : `Xem ${g.count} bản ghi`}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-1 space-y-1 border-t border-current/30 pt-2">
              {g.items.map((a) => (
                <li key={a.key} className="flex items-start justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="line-clamp-1 opacity-90">{a.message || a.title}</p>
                    <span className="opacity-75">
                      <AgeLabel raisedAt={a.raisedAt} /> trước{a.acknowledged && " · ACK"}
                    </span>
                  </div>
                  <ItemActions a={a} pendingKeys={pendingKeys} onAck={onAck} onRequestResolve={onRequestResolve} size="sm" />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
});

export default AlertGroupCard;
