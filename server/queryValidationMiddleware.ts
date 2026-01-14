/**
 * Query Validation Middleware for tRPC
 * Automatically validates queries before execution
 */

import { TRPCError } from "@trpc/server";
import { validateQuery } from "./queryValidator";
import { logQueryMetrics } from "./queryMonitor";

export interface QueryInfo {
  selectColumns: string[];
  groupByColumns: string[];
  orderByColumns: string[];
  joins: string[];
}

/**
 * Middleware to validate queries before execution
 * Usage: Add to tRPC procedure chain
 */
export function withQueryValidation(queryInfo: QueryInfo) {
  return async ({ ctx, next }: any) => {
    const validation = validateQuery(
      queryInfo.selectColumns,
      queryInfo.groupByColumns,
      queryInfo.orderByColumns,
      queryInfo.joins
    );

    if (!validation.isValid) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Query validation failed: ${validation.errors.join("; ")}`,
      });
    }

    // Log warnings to console
    if (validation.warnings.length > 0) {
      console.warn(`[Query Warnings] ${validation.warnings.join("; ")}`);
    }

    return next({ ctx });
  };
}

/**
 * Wrapper to measure query execution time and validate
 */
export async function executeValidatedQuery<T>(
  queryName: string,
  queryInfo: QueryInfo,
  executeFn: () => Promise<T>
): Promise<T> {
  // Validate query structure first
  const validation = validateQuery(
    queryInfo.selectColumns,
    queryInfo.groupByColumns,
    queryInfo.orderByColumns,
    queryInfo.joins
  );

  if (!validation.isValid) {
    throw new Error(`Query validation failed: ${validation.errors.join("; ")}`);
  }

  // Log warnings
  if (validation.warnings.length > 0) {
    console.warn(`[Query Warnings for ${queryName}] ${validation.warnings.join("; ")}`);
  }

  // Execute and measure time
  const startTime = performance.now();
  try {
    const result = await executeFn();
    const executionTime = performance.now() - startTime;
    
    logQueryMetrics(queryName, executionTime);
    
    return result;
  } catch (error) {
    const executionTime = performance.now() - startTime;
    logQueryMetrics(`${queryName} [ERROR]`, executionTime);
    throw error;
  }
}

/**
 * Validate common query patterns
 */
export const COMMON_QUERY_PATTERNS = {
  // Workstation analytics queries
  workstationDefects: {
    selectColumns: [
      "w.id",
      "w.code",
      "w.name",
      "w.processType",
      "mpd.id",
      "mpd.code",
      "mpd.name",
      "COUNT(mr.id)",
      "SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END)",
      "SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END)",
      "SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END)",
    ],
    groupByColumns: ["w.id", "w.code", "w.name", "w.processType", "mpd.id", "mpd.code", "mpd.name"],
    orderByColumns: ["SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) DESC"],
    joins: ["INNER JOIN", "INNER JOIN", "INNER JOIN"],
  },

  // Top NG measurement points
  topNGPoints: {
    selectColumns: [
      "w.id",
      "w.code",
      "w.name",
      "mpd.id",
      "mpd.code",
      "mpd.name",
      "COUNT(mr.id)",
      "SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END)",
      "SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END)",
    ],
    groupByColumns: ["w.id", "w.code", "w.name", "mpd.id", "mpd.code", "mpd.name"],
    orderByColumns: ["SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) DESC"],
    joins: ["INNER JOIN", "INNER JOIN", "INNER JOIN"],
  },

  // Workstation summary
  workstationSummary: {
    selectColumns: [
      "w.id",
      "w.code",
      "w.name",
      "w.processType",
      "COUNT(DISTINCT mpd.id)",
      "COUNT(DISTINCT mr.id)",
      "SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END)",
      "SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END)",
      "SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END)",
      "ROUND(...)",
    ],
    groupByColumns: ["w.id", "w.code", "w.name", "w.processType"],
    orderByColumns: ["SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) DESC"],
    joins: ["LEFT JOIN", "LEFT JOIN", "LEFT JOIN"],
  },
};
