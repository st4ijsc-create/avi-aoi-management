/**
 * doc 59 P0 — WorkspaceShell: the master-detail primitive that turns "sibling pages"
 * into a professional-ecosystem workspace (Grafana/Opcenter style): a persistent
 * LEFT list rail ⇄ MAIN detail ⇄ optional RIGHT ContextDrawer, with a header slot
 * for a scope/filter bar. Built on ui/resizable (draggable split) + ui/sheet (drawer).
 *
 * Renders INSIDE a page's DashboardLayout (compose as its children) — it does not own
 * the app chrome. Height is viewport-relative so the rail/main can scroll independently.
 */
import { type ReactNode } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

export interface WorkspaceShellProps {
  /** Left list rail (fleet list, entity tree, work-order queue…). */
  rail: ReactNode;
  /** Main detail pane (cockpit tabs, editor…). */
  main: ReactNode;
  /** Optional header above the split (e.g. ScopeFilterBar). */
  header?: ReactNode;
  /** Optional right drawer — pass a <ContextDrawer/> (self-manages open state). */
  drawer?: ReactNode;
  /** Rail width as a percent of the split (default 24, min 16). */
  railDefaultSize?: number;
  railMinSize?: number;
  /** Override the viewport-relative height (default leaves room for the app header). */
  heightClass?: string;
  className?: string;
}

export function WorkspaceShell({
  rail,
  main,
  header,
  drawer,
  railDefaultSize = 24,
  railMinSize = 16,
  heightClass = "h-[calc(100vh-8.5rem)]",
  className,
}: WorkspaceShellProps) {
  return (
    <div className={cn("flex flex-col", heightClass, className)}>
      {header && <div className="shrink-0 pb-2">{header}</div>}
      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden rounded-lg border">
        <ResizablePanel defaultSize={railDefaultSize} minSize={railMinSize} className="min-w-0">
          <div className="h-full overflow-y-auto bg-muted/20">{rail}</div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={100 - railDefaultSize} className="min-w-0">
          <div className="h-full overflow-y-auto p-3">{main}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
      {drawer}
    </div>
  );
}

export default WorkspaceShell;
