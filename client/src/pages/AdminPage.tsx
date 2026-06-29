/**
 * DEAD ROUTE — kept only as a redirect shim.
 *
 * AdminPage was a ~521-line admin mega-hub that is NO LONGER routed anywhere in
 * App.tsx (the `/admin` route redirects to `/admin-setting`, and the governance
 * launcher is now AdminHome at `/admin-home`). Its tabbed content has been fully
 * superseded by AdminHome (launcher) + AdminSettings (settings tabs) + the unified
 * Audit page. This shim exists so any stale import resolves and the build stays
 * green; it renders the canonical AdminHome.
 *
 * Wave 2: delete this file and remove the (unused) import once confirmed orphan.
 */
export { default } from "@/pages/AdminHome";
