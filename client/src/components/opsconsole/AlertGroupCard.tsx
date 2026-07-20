/**
 * doc 67 W3 (việc 1+2a+3+4+5) — thẻ NHÓM cảnh báo đã coalesce cho War Room.
 *
 *  - Việc 1: 1 thẻ / nhóm (source+title+vị trí) + badge "×N lần" + "mới nhất
 *    Xs trước" (bản ghi MỚI NHẤT).
 *  - Việc 2a: "Xác nhận cả nhóm (N)" cho nguồn có ack; nhóm interlock/mqtt là
 *    "Xử lý cả nhóm (N)" đi qua AlertDialog confirm ở trang (ngữ nghĩa W1:
 *    resolve = đóng vĩnh viễn).
 *  - Việc 3: quá hạn → ring destructive + badge "QUÁ HẠN Xm"; hết hạn dự báo
 *    → badge "HẾT HẠN DỰ BÁO" + mờ (không xóa).
 *  - Việc 4: React.memo — gõ search/chọn checkbox ở trang không re-render 85 thẻ.
 *  - Việc 5: disable theo pendingKeys per-alert, không khóa cả trang.
 *
 * doc 68 §3.4 (P1/P2) — thị giác:
 *  - Chi tiết nhóm / từng bản ghi + hành động cả-nhóm chuyển sang ContextDrawer
 *    phải (do trang sở hữu qua `onOpenDetail`), thay Collapsible bung in-place
 *    đẩy layout. Thẻ đơn cũng mở drawer khi bấm.
 *  - Tiêu đề nhóm line-clamp-2 (bỏ truncate cắt cụt "MA…/Throug…").
 *  - Nút hành động xếp NGANG (flex-row flex-wrap) thay dọc.
 *  - Badge "×N lần" hạ tông muted (bỏ font-bold border-current).
 *
 * Touch target: nút hành động chính h-11 (44px) — persona đeo găng, panel 10.1".
 */
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    // doc 68 §3.4 (P2): nút hành động xếp NGANG (wrap khi hẹp) thay dọc.
    <div className="flex shrink-0 flex-row flex-wrap justify-end gap-1">
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
  onOpenDetail,
}: {
  group: AlertGroup;
  pendingKeys: Set<string>;
  onAck: (a: DecoratedAlert) => void;
  onRequestResolve: (a: DecoratedAlert) => void;
  onBulkAck: (g: AlertGroup) => void;
  onBulkResolveRequest: (g: AlertGroup) => void;
  /** doc 68 §3.4: mở chi tiết nhóm/bản-ghi trong ContextDrawer phải do trang sở hữu. */
  onOpenDetail: (g: AlertGroup) => void;
}) {
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
        {/* doc 68 §3.4: cả khối thông tin bấm được → mở drawer chi tiết (thẻ đơn lẫn nhóm). */}
        <button
          type="button"
          onClick={() => onOpenDetail(g)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {SOURCE_ICON[g.source]}
            {/* doc 68 §3.4: bỏ truncate → line-clamp-2 (hết cắt cụt tiêu đề). */}
            <span className="line-clamp-2">{g.title}</span>
            {!single && (
              // doc 68 §3.4: hạ tông badge "×N lần" (muted, không font-bold/border-current).
              <Badge variant="secondary" className="shrink-0 font-normal">
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
        </button>

        {single ? (
          <ItemActions a={g.items[0]} pendingKeys={pendingKeys} onAck={onAck} onRequestResolve={onRequestResolve} />
        ) : (
          <div className="flex shrink-0 flex-row flex-wrap justify-end gap-1">
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

      {/* doc 68 §3.4: "Xem N bản ghi" → mở ContextDrawer phải (thay Collapsible in-place). */}
      {!single && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-9 w-full justify-start px-1 text-xs font-semibold text-current hover:bg-background/20"
          onClick={() => onOpenDetail(g)}
        >
          Xem {g.count} bản ghi
        </Button>
      )}
    </div>
  );
});

export default AlertGroupCard;
