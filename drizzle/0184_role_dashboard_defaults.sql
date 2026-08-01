-- 0184 — doc 27 Đợt 5 / W5-C — gap A12: role → default dashboard binding.
--
-- Until now the only "default dashboard" notion was the per-user
-- userSettings.defaultDashboardTab (a schema field nothing reads). This table
-- binds a ROLE to a default dashboard surface, resolved ONLY when the user has
-- no personal dashboards of their own (personal ALWAYS wins — see
-- dashboardWidget.getMyEffectiveDashboard):
--   • dashboardTemplateId → a shared dashboard_templates row whose widgets/layout
--     are materialized read-only on the main Dashboard "custom" tab (with a
--     one-tap "save as mine" that uses the existing template-apply mechanism);
--   • customDashboardId   → a (public) user_custom_dashboards row to auto-select;
--   • landingPath         → optional per-role landing override consulted by the
--     "/" front door (falls back to the static roleLanding map).
-- At most one of dashboardTemplateId/customDashboardId is expected to be set;
-- the application layer enforces this (CHECK omitted so an admin fixing data by
-- hand can never be locked out).
--
-- role is a plain varchar (NOT roleenum) on purpose: it survives future role
-- additions and matches users.role storage semantics used across the app.

CREATE TABLE IF NOT EXISTS "role_dashboard_defaults" (
  "id" SERIAL PRIMARY KEY,
  "role" VARCHAR(50) NOT NULL,
  "dashboardTemplateId" INTEGER REFERENCES "dashboard_templates"("id") ON DELETE SET NULL,
  "customDashboardId" INTEGER REFERENCES "user_custom_dashboards"("id") ON DELETE SET NULL,
  "landingPath" VARCHAR(255),
  "updatedBy" INTEGER,
  "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT "uq_role_dashboard_defaults_role" UNIQUE ("role")
);
