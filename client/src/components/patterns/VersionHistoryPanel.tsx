/**
 * Doc 81 Đợt 2 Task 3 — <VersionHistoryPanel>: danh sách phiên bản + so sánh hai bản + hành động
 * mỗi hàng. Thay 4 bản viết lại (Workspace, Recipes, Orchestration, EqIntegration — FE2 §4.4);
 * mỗi trang chuyển sang ở task của trang đó.
 *
 * - Bốn trạng thái, không gộp: `loading` (chữ đang tải) / `error` (role=alert — KHÔNG nói "chưa
 *   có phiên bản") / trống (`EmptyState`) / có dữ liệu (bảng).
 * - Chọn bản Gốc và bản So với bằng hai nhóm radio (bàn phím mũi tên chạy trong từng nhóm). Mặc
 *   định: gốc = `defaultBaseId` (vd bản Golden của Recipes) hoặc bản thứ hai; so với =
 *   `defaultCompareId` hoặc bản đầu (caller xếp mới nhất trước).
 * - Hành động mỗi hàng do trang cấp qua `renderRowActions` — thường là `<RollbackConfirm>` với
 *   `requireOtp`/`minReasonLength` của chính trang (nghiệp vụ khôi phục mỗi trang khác nhau).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { JsonDiffView } from "./JsonDiffView";

export interface VersionRow {
  id: string | number;
  /** Nhãn ngắn, vd "v3". */
  label: string;
  createdAt?: string | Date | null;
  author?: React.ReactNode;
  note?: React.ReactNode;
  /** Bản đang chạy/đang dùng. */
  current?: boolean;
  /** Nội dung để diff (JSON hoặc văn bản). */
  content: unknown;
}

export interface VersionHistoryPanelProps {
  versions: readonly VersionRow[] | undefined;
  status: "loading" | "error" | "ready";
  diffMode?: "json" | "text";
  defaultBaseId?: string | number | null;
  defaultCompareId?: string | number | null;
  renderRowActions?: (v: VersionRow) => React.ReactNode;
  /** Tiêu đề nhỏ (h3) — bỏ qua khi panel nằm trong flyout đã có tiêu đề. */
  title?: React.ReactNode;
  diffMaxHeightClass?: string;
  className?: string;
}

function fmt(v: VersionRow["createdAt"]): string {
  if (v == null) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

export function VersionHistoryPanel({
  versions,
  status,
  diffMode = "json",
  defaultBaseId,
  defaultCompareId,
  renderRowActions,
  title,
  diffMaxHeightClass = "max-h-[320px]",
  className,
}: VersionHistoryPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const group = React.useId();
  const list = versions ?? [];
  const has = (id: unknown) => id != null && list.some((v) => v.id === id);

  const [baseId, setBaseId] = React.useState<string | number | null>(null);
  const [compareId, setCompareId] = React.useState<string | number | null>(null);
  const effBase = has(baseId) ? baseId : has(defaultBaseId) ? defaultBaseId! : (list[1]?.id ?? null);
  const effCompare = has(compareId) ? compareId : has(defaultCompareId) ? defaultCompareId! : (list[0]?.id ?? null);
  const base = list.find((v) => v.id === effBase) ?? null;
  const compare = list.find((v) => v.id === effCompare) ?? null;

  let body: React.ReactNode;
  if (status === "loading") {
    body = <p className="py-3 text-center text-sm text-muted-foreground">{t("layoutKit.versions.loading", "Loading versions…")}</p>;
  } else if (status === "error") {
    body = (
      <p role="alert" className="py-3 text-center text-sm text-destructive">
        {t("layoutKit.versions.error", "Could not load the version history.")}
      </p>
    );
  } else if (list.length === 0) {
    body = <EmptyState variant="no-data" compact title={t("layoutKit.versions.empty", "No versions yet.")} />;
  } else {
    body = (
      <div className="space-y-3">
        <div className="max-h-[240px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">{t("layoutKit.versions.colBase", "Base")}</TableHead>
                <TableHead className="w-12 text-center">{t("layoutKit.versions.colCompare", "Compare")}</TableHead>
                <TableHead>{t("layoutKit.versions.colVersion", "Version")}</TableHead>
                <TableHead>{t("layoutKit.versions.colCreated", "Created")}</TableHead>
                <TableHead>{t("layoutKit.versions.colAuthor", "Author")}</TableHead>
                <TableHead>{t("layoutKit.versions.colNote", "Note")}</TableHead>
                {renderRowActions && <TableHead className="text-right">{t("layoutKit.versions.colActions", "Actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((v) => (
                <TableRow key={String(v.id)} data-version-id={String(v.id)}>
                  <TableCell className="text-center">
                    <input
                      type="radio"
                      name={`${group}-base`}
                      checked={v.id === effBase}
                      onChange={() => setBaseId(v.id)}
                      aria-label={t("layoutKit.versions.pickBase", "Use {{version}} as the base", { version: v.label })}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <input
                      type="radio"
                      name={`${group}-compare`}
                      checked={v.id === effCompare}
                      onChange={() => setCompareId(v.id)}
                      aria-label={t("layoutKit.versions.pickCompare", "Compare with {{version}}", { version: v.label })}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {v.label}
                    {v.current && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        {t("layoutKit.versions.current", "current")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmt(v.createdAt)}</TableCell>
                  <TableCell className="text-xs">{v.author ?? "—"}</TableCell>
                  <TableCell className="max-w-[16rem] truncate text-xs">{v.note ?? ""}</TableCell>
                  {renderRowActions && <TableCell className="text-right">{renderRowActions(v)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {list.length < 2 || !base || !compare ? (
          <p className="text-center text-xs text-muted-foreground">{t("layoutKit.versions.pickTwo", "Pick two versions to see the differences.")}</p>
        ) : base.id === compare.id ? (
          <p className="text-center text-xs text-muted-foreground">
            {t("layoutKit.versions.sameVersion", "The same version is selected in both columns.")}
          </p>
        ) : (
          <JsonDiffView
            left={base.content}
            right={compare.content}
            leftLabel={base.label}
            rightLabel={compare.label}
            mode={diffMode}
            maxHeightClass={diffMaxHeightClass}
          />
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)} data-version-history="">
      {title != null && <h3 className="text-sm font-semibold">{title}</h3>}
      {body}
    </div>
  );
}

export default VersionHistoryPanel;
