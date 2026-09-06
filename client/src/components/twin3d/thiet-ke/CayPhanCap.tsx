/**
 * CayPhanCap.tsx — cây phân cấp bên trái của màn Thiết kế (§7.1).
 *
 * ★ Toàn bộ LOGIC nằm ở `trangThaiThietKe.ts` (dựng cây, lọc, đường tới node) và
 *   đã có 69 test. Tệp này CHỈ vẽ — nếu có gì đáng đo lọt vào đây thì nó không
 *   đo được nữa (`.tsx` không nằm trong `include` của vitest).
 *
 * ★★★ §7.1 — "KHU CHỜ XẾP CHỖ" là nhánh riêng, mờ + viền NÉT ĐỨT.
 *   Spec nói thẳng lý do: *"nếu ẩn chúng đi, người dùng không bao giờ biết mình
 *   thiếu N máy"*. Nên nhánh này hiện cả khi RỖNG (với câu "0 máy chờ") — một
 *   nhánh biến mất khi rỗng không phân biệt được "không thiếu máy nào" với
 *   "tính năng này không tồn tại".
 *
 * ★ §7.3 — ĐỒNG BỘ HAI CHIỀU BẮT BUỘC: `chon` vào từ ngoài (click trong 3D) và
 *   `onChon` đi ra (click trong cây). Component KHÔNG giữ state chọn của riêng
 *   nó; giữ một bản sao là cách chắc chắn để hai bên lệch nhau.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  duongToiNode,
  locCay,
  type CayThietKe,
  type KhoaNode,
  type NodeCay,
  type TapChon,
} from "./trangThaiThietKe";

export interface CayPhanCapProps {
  cay: CayThietKe;
  chon: TapChon;
  onChon: (khoa: KhoaNode | null, giuShift: boolean) => void;
  /** Số máy chờ xếp chỗ — truyền riêng để hiện được cả khi nhánh bị lọc trống. */
  soChoXepCho: number;
}

const THUT_PX = 12;

function IconMo({ mo }: { mo: boolean }) {
  return mo ? (
    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
  );
}

function Hang({
  node,
  bac,
  mo,
  daChon,
  onBamMo,
  onBamChon,
}: {
  node: NodeCay;
  bac: number;
  mo: boolean;
  daChon: boolean;
  onBamMo: (khoa: KhoaNode) => void;
  onBamChon: (khoa: KhoaNode, giuShift: boolean) => void;
}) {
  const coCon = node.con.length > 0;
  return (
    <div
      role="treeitem"
      aria-selected={daChon}
      aria-expanded={coCon ? mo : undefined}
      data-testid={`node-cay-${node.khoa}`}
      data-cho-xep-cho={node.choXepCho ? "1" : "0"}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs",
        daChon ? "bg-primary/15 text-foreground" : "hover:bg-muted/60",
        // ★ §7.1 — mờ + viền NÉT ĐỨT cho máy chưa xếp chỗ.
        node.choXepCho && "border border-dashed border-muted-foreground/50 opacity-60",
      )}
      style={{ paddingLeft: 6 + bac * THUT_PX }}
      onClick={(e) => onBamChon(node.khoa, e.shiftKey)}
    >
      {coCon ? (
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onBamMo(node.khoa);
          }}
          aria-label={node.nhan}
        >
          <IconMo mo={mo} />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span className="truncate">{node.nhan}</span>
    </div>
  );
}

export function CayPhanCap({ cay, chon, onChon, soChoXepCho }: CayPhanCapProps) {
  const { t } = useTranslation();
  const [tim, setTim] = useState("");
  const [mo, setMo] = useState<Set<KhoaNode>>(new Set());

  const daLoc = useMemo(() => locCay(cay.goc, tim), [cay, tim]);
  const khuChoLoc = useMemo(() => locCay(cay.khuCho, tim), [cay, tim]);

  /**
   * ★ §7.3 — cây TỰ MỞ đúng nhánh khi vật thể được chọn từ 3D. Không có hiệu
   *   ứng này thì "đồng bộ hai chiều" chỉ đúng một nửa: chọn trong 3D làm cây
   *   đánh dấu một hàng đang bị gập lại, tức là người dùng không thấy gì.
   */
  useEffect(() => {
    if (chon.length === 0) return;
    const canMo = new Set(mo);
    let doi = false;
    for (const k of chon) {
      for (const to of duongToiNode(cay, k)) {
        if (!canMo.has(to)) {
          canMo.add(to);
          doi = true;
        }
      }
    }
    if (doi) setMo(canMo);
    // `mo` cố tình KHÔNG trong deps: thêm vào sẽ tạo vòng lặp set → render → set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chon, cay]);

  // Khi đang lọc, mở hết để kết quả không nằm sau một mũi tên gập.
  const dangLoc = tim.trim() !== "";

  function ve(nodes: readonly NodeCay[], bac: number): React.ReactNode[] {
    const ra: React.ReactNode[] = [];
    for (const n of nodes) {
      const dangMo = dangLoc || mo.has(n.khoa);
      ra.push(
        <Hang
          key={n.khoa}
          node={n}
          bac={bac}
          mo={dangMo}
          daChon={chon.includes(n.khoa)}
          onBamMo={(k) =>
            setMo((cu) => {
              const s = new Set(cu);
              if (s.has(k)) s.delete(k);
              else s.add(k);
              return s;
            })
          }
          onBamChon={(k, shift) => onChon(k, shift)}
        />,
      );
      if (dangMo && n.con.length > 0) ra.push(...ve(n.con, bac + 1));
    }
    return ra;
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="cay-phan-cap-twin">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={tim}
            onChange={(e) => setTim(e.target.value)}
            placeholder={t("twin3d.cay.loc")}
            className="h-8 pl-7 text-xs"
            data-testid="loc-cay"
          />
        </div>
      </div>

      <div
        role="tree"
        className="min-h-0 flex-1 overflow-auto p-1"
        // Click nền cây = bỏ chọn (ngữ nghĩa chuẩn của mọi trình sửa).
        onClick={(e) => {
          if (e.target === e.currentTarget) onChon(null, false);
        }}
      >
        {daLoc.length === 0 && khuChoLoc.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">{t("twin3d.cay.khongKhop")}</p>
        ) : null}

        {ve(daLoc, 0)}

        {/* ★★★ §7.1 — KHU CHỜ XẾP CHỖ. Hiện CẢ KHI RỖNG (xem docblock đầu tệp). */}
        <div className="mt-3 border-t pt-2" data-testid="khu-cho-xep-cho">
          <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("twin3d.khuChoXepCho")} ({soChoXepCho})
          </p>
          {khuChoLoc.length === 0 ? (
            <p className="px-1.5 text-[11px] text-muted-foreground">
              {soChoXepCho === 0 ? "—" : t("twin3d.cay.khongKhop")}
            </p>
          ) : (
            ve(khuChoLoc, 0)
          )}
          <p className="px-1.5 pt-1 text-[10px] leading-tight text-muted-foreground">
            {t("twin3d.khuChoXepChoMoTa")}
          </p>
        </div>
      </div>
    </div>
  );
}

export default CayPhanCap;
