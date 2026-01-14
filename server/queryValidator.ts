/**
 * Query Validation Layer
 * Validates SQL queries for common issues like GROUP BY completeness
 * Helps catch errors early before execution
 */

export interface QueryValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates GROUP BY completeness in a SQL query
 * Ensures all non-aggregate columns in SELECT are in GROUP BY clause
 */
export function validateGroupByCompleteness(
  selectColumns: string[],
  groupByColumns: string[],
  aggregateFunctions: string[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT']
): QueryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract column names from SELECT (handle aliases like "COUNT(*) as total")
  const selectColumnNames = selectColumns
    .map(col => {
      // Remove aggregate functions and their arguments
      const withoutAgg = col.replace(
        new RegExp(`(${aggregateFunctions.join('|')})\\s*\\([^)]*\\)`, 'gi'),
        ''
      ).trim();
      
      // Extract column name before 'as' or 'AS'
      const match = withoutAgg.match(/^([a-zA-Z0-9_\.]+)(\s+as\s+)?/i);
      return match ? match[1].trim() : null;
    })
    .filter((col): col is string => col !== null && col !== '' && col !== '*');

  // Normalize column names for comparison
  const normalizedSelectCols = new Set(selectColumnNames.map(c => c.toLowerCase()));
  const normalizedGroupByCols = new Set(groupByColumns.map(c => c.toLowerCase()));

  // Check for columns in SELECT that are not in GROUP BY and not aggregates
  const missingFromGroupBy: string[] = [];
  normalizedSelectCols.forEach(col => {
    if (!normalizedGroupByCols.has(col) && col !== '*') {
      missingFromGroupBy.push(col);
    }
  });

  if (missingFromGroupBy.length > 0) {
    errors.push(
      `Columns not in GROUP BY: ${missingFromGroupBy.join(', ')}. ` +
      `These columns must either be in GROUP BY or wrapped in an aggregate function.`
    );
  }

  // Warn if GROUP BY is used but no aggregate functions found
  if (groupByColumns.length > 0 && selectColumns.every(col => !aggregateFunctions.some(agg => col.toUpperCase().includes(agg)))) {
    warnings.push('GROUP BY clause found but no aggregate functions detected in SELECT. This may indicate a logic error.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates that all columns in ORDER BY are either in SELECT or are aggregate functions
 */
export function validateOrderByColumns(
  selectColumns: string[],
  orderByColumns: string[],
  aggregateFunctions: string[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT']
): QueryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const selectColumnNames = selectColumns
    .map(col => {
      const withoutAgg = col.replace(
        new RegExp(`(${aggregateFunctions.join('|')})\\s*\\([^)]*\\)`, 'gi'),
        ''
      ).trim();
      const match = withoutAgg.match(/^([a-zA-Z0-9_\.]+)(\s+as\s+)?/i);
      return match ? match[1].trim() : null;
    })
    .filter((col): col is string => col !== null && col !== '');

  const normalizedSelectCols = new Set(selectColumnNames.map(c => c.toLowerCase()));

  for (const orderCol of orderByColumns) {
    const colName = orderCol.split(/\s+(ASC|DESC)/i)[0].trim().toLowerCase();
    
    // Check if it's an aggregate function
    const isAggregate = aggregateFunctions.some(agg => colName.toUpperCase().includes(agg));
    
    if (!isAggregate && !normalizedSelectCols.has(colName)) {
      errors.push(
        `ORDER BY column '${colName}' not found in SELECT clause. ` +
        `Either add it to SELECT or use an aggregate function.`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates LEFT JOIN + COUNT(*) pattern which often causes issues
 */
export function validateLeftJoinCount(
  joins: string[],
  selectColumns: string[]
): QueryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasLeftJoin = joins.some(j => j.toUpperCase().includes('LEFT JOIN'));
  const hasCountAll = selectColumns.some(col => col.toUpperCase().includes('COUNT(*)'));

  if (hasLeftJoin && hasCountAll) {
    warnings.push(
      'LEFT JOIN detected with COUNT(*). This can produce incorrect results due to NULL handling. ' +
      'Consider using COUNT(DISTINCT column_id) or COUNT(column_id) instead.'
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Comprehensive query validation
 */
export function validateQuery(
  selectColumns: string[],
  groupByColumns: string[],
  orderByColumns: string[] = [],
  joins: string[] = [],
  aggregateFunctions?: string[]
): QueryValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Validate GROUP BY completeness
  const groupByValidation = validateGroupByCompleteness(selectColumns, groupByColumns, aggregateFunctions);
  allErrors.push(...groupByValidation.errors);
  allWarnings.push(...groupByValidation.warnings);

  // Validate ORDER BY columns
  if (orderByColumns.length > 0) {
    const orderByValidation = validateOrderByColumns(selectColumns, orderByColumns, aggregateFunctions);
    allErrors.push(...orderByValidation.errors);
    allWarnings.push(...orderByValidation.warnings);
  }

  // Validate LEFT JOIN + COUNT
  const joinValidation = validateLeftJoinCount(joins, selectColumns);
  allWarnings.push(...joinValidation.warnings);

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
