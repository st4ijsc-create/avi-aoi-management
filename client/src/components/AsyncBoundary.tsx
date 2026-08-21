import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  TableSkeleton,
  ListSkeleton,
  ChartSkeleton,
  DashboardStatsSkeleton,
  MachineGridSkeleton,
} from "@/components/AnalyticsSkeleton";
import { cn } from "@/lib/utils";

/**
 * AsyncBoundary — one primitive for the loading / error / empty / loaded lifecycle
 * of an async data section, so every page renders these states identically.
 *
 * Precedence (highest first): error → loading → empty → children.
 *
 * @example Manual flags
 * ```tsx
 * <AsyncBoundary
 *   isLoading={q.isLoading}
 *   isError={q.isError}
 *   error={q.error}
 *   isEmpty={!q.data?.length}
 *   onRetry={q.refetch}
 *   preset="table"
 * >
 *   <MyTable rows={q.data!} />
 * </AsyncBoundary>
 * ```
 *
 * @example QueryBoundary — pass a react-query result, get the flags wired for you
 * ```tsx
 * <QueryBoundary query={q} preset="table" errorTitle="Couldn't load machines">
 *   {(machines) => <MyTable rows={machines} />}
 * </QueryBoundary>
 * ```
 */

export type AsyncSkeletonPreset =
  | "table"
  | "cards"
  | "stats"
  | "chart"
  | "list"
  | "none";

/**
 * Extract a human-readable message from an unknown error value.
 * Never returns "[object Object]".
 */
function getErrorMessage(error: unknown): string {
  if (error == null) return "";
  if (error instanceof Error) return mapTrpcError(error);
  if (
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (typeof error === "string") return error;
  const asString = String(error);
  return asString === "[object Object]" ? "" : asString;
}

/** Map a preset name to a built-in AnalyticsSkeleton. `none` renders nothing. */
function renderPreset(preset: AsyncSkeletonPreset): React.ReactNode {
  switch (preset) {
    case "table":
      return <TableSkeleton />;
    case "cards":
      return <MachineGridSkeleton />;
    case "stats":
      return <DashboardStatsSkeleton />;
    case "chart":
      return <ChartSkeleton />;
    case "list":
      return <ListSkeleton />;
    case "none":
      return null;
    default:
      return <ListSkeleton />;
  }
}

interface AsyncErrorCardProps {
  title: string;
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/** Calm, inline error card — not a full-screen takeover. */
function AsyncErrorCard({
  title,
  error,
  onRetry,
  retryLabel = "Retry",
  className,
}: AsyncErrorCardProps) {
  const message = getErrorMessage(error);
  return (
    <Alert
      variant="destructive"
      className={cn("border-destructive/30", className)}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      {(message || onRetry) && (
        <AlertDescription>
          {message && <p className="text-destructive/90">{message}</p>}
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              aria-label={retryLabel}
              className="mt-2 gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {retryLabel}
            </Button>
          )}
        </AlertDescription>
      )}
    </Alert>
  );
}

export interface AsyncBoundaryProps {
  /** Whether the async data is currently loading. */
  isLoading: boolean;
  /** Whether the async request failed. */
  isError?: boolean;
  /** The error value — rendered as a readable message (Error.message or String). */
  error?: unknown;
  /** Caller decides emptiness (e.g. `data.length === 0`). */
  isEmpty?: boolean;
  /** Shows a Retry button in the error state when provided. */
  onRetry?: () => void;
  /** Custom loading node; overrides `preset`. */
  skeleton?: React.ReactNode;
  /** Which built-in skeleton to show while loading. Default `"list"`. */
  preset?: AsyncSkeletonPreset;
  /** Custom empty node; defaults to `<EmptyState/>`. */
  emptyState?: React.ReactNode;
  /** English default error title, e.g. "Couldn’t load data". */
  errorTitle?: string;
  /** Accessible label for the Retry button. Default `"Retry"`. */
  retryLabel?: string;
  /** The loaded content. */
  children: React.ReactNode;
  className?: string;
}

export function AsyncBoundary({
  isLoading,
  isError = false,
  error,
  isEmpty = false,
  onRetry,
  skeleton,
  preset = "list",
  emptyState,
  errorTitle = "Couldn’t load data",
  retryLabel = "Retry",
  children,
  className,
}: AsyncBoundaryProps): React.JSX.Element {
  // 1. Error takes precedence over everything.
  if (isError) {
    return (
      <AsyncErrorCard
        title={errorTitle}
        error={error}
        onRetry={onRetry}
        retryLabel={retryLabel}
        className={className}
      />
    );
  }

  // 2. Loading.
  if (isLoading) {
    const loadingNode = skeleton ?? renderPreset(preset);
    return <div className={className}>{loadingNode}</div>;
  }

  // 3. Empty.
  if (isEmpty) {
    return (
      <div className={className}>{emptyState ?? <EmptyState variant="default" />}</div>
    );
  }

  // 4. Loaded content.
  return <div className={className}>{children}</div>;
}

/** Minimal structural shape of a react-query result — avoids a hard type import. */
interface QueryLike<T> {
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  data?: T;
  refetch?: () => void;
}

export interface QueryBoundaryProps<T> {
  /** A react-query result (or any object with the matching shape). */
  query: QueryLike<T>;
  /** Emptiness test. Default: `data == null`, or an empty array. */
  isEmpty?: (data: T) => boolean;
  /** Which built-in skeleton to show while loading. Default `"list"`. */
  preset?: AsyncSkeletonPreset;
  /** Custom loading node; overrides `preset`. */
  skeleton?: React.ReactNode;
  /** Custom empty node; defaults to `<EmptyState/>`. */
  emptyState?: React.ReactNode;
  /** English default error title, e.g. "Couldn’t load data". */
  errorTitle?: string;
  /** Accessible label for the Retry button. Default `"Retry"`. */
  retryLabel?: string;
  /** Render the loaded content. Only called when data is present. */
  children: (data: T) => React.ReactNode;
  className?: string;
}

/** Default emptiness check: null/undefined data, or an empty array. */
function defaultIsEmpty<T>(data: T): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * QueryBoundary — convenience wrapper around a react-query result. Derives
 * `isLoading` from `isLoading ?? isPending`, wires `refetch` as `onRetry`, and
 * only invokes `children(data)` once data is present.
 */
export function QueryBoundary<T>({
  query,
  isEmpty,
  preset = "list",
  skeleton,
  emptyState,
  errorTitle = "Couldn’t load data",
  retryLabel = "Retry",
  children,
  className,
}: QueryBoundaryProps<T>): React.JSX.Element {
  const loading = query.isLoading ?? query.isPending ?? false;
  const hasData = query.data != null;
  const emptyCheck = isEmpty ?? defaultIsEmpty;
  const empty = !hasData || emptyCheck(query.data as T);

  return (
    <AsyncBoundary
      isLoading={loading}
      isError={query.isError ?? false}
      error={query.error}
      isEmpty={empty}
      onRetry={query.refetch}
      preset={preset}
      skeleton={skeleton}
      emptyState={emptyState}
      errorTitle={errorTitle}
      retryLabel={retryLabel}
      className={className}
    >
      {hasData ? children(query.data as T) : null}
    </AsyncBoundary>
  );
}

export default AsyncBoundary;
