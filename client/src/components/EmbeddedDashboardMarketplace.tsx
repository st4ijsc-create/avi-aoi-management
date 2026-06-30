/**
 * EmbeddedDashboardMarketplace
 *
 * Thin wrapper used by DashboardCenter's "marketplace" tab. It renders the SAME
 * real marketplace body as the /dashboard-marketplace page (DashboardMarketplaceContent),
 * which is backed by real tRPC data (dashboardWidget.getSharedTemplates) with no
 * fabricated ratings. The previous mock implementation (MOCK_TEMPLATES with
 * hardcoded star ratings) has been removed to eliminate the duplicate/fake surface.
 */
import { DashboardMarketplaceContent } from "@/pages/DashboardMarketplace";

export default function EmbeddedDashboardMarketplace() {
  return <DashboardMarketplaceContent />;
}
