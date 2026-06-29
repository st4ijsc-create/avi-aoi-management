/**
 * EnhancedScheduledReports — CONSOLIDATED (P1, audit G).
 *
 * The scheduled-report management surface has been unified into the canonical
 * ScheduledReports page. The previous "enhanced" UI exposed report types
 * (quality_summary / comparison / combined) that were backed by an enhanced
 * service which is never wired into the running cron scheduler, so those options
 * silently did nothing. The canonical page now drives real content via the
 * reportType field (NG_VISUAL / *_SUMMARY / OEE_REPORT / MACHINE_HEALTH / CUSTOM),
 * which the consolidated cron + sendTest actually honour.
 *
 * This module re-exports the canonical page so the existing
 * /enhanced-scheduled-reports route keeps working. The route + this file are
 * flagged for removal in Wave 2 (see route map in the consolidation report).
 */
export { default } from "./ScheduledReports";
export { ScheduledReportsContent as EnhancedScheduledReportsContent } from "./ScheduledReports";
