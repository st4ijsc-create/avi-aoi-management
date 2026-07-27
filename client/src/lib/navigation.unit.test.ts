/**
 * doc69 Wave 0-C — nav-gating regression test for the `NavItem.requiredRole`
 * widening (`'admin' | 'user'` → `string | string[]`) in navigation.tsx.
 *
 * Proves:
 *  - The 7 engineer-work AI screens widened to `['admin', 'engineer']` admit the
 *    "engineer" role.
 *  - `/ai-monitoring` (deliberately NOT widened — system health/config) still
 *    rejects "engineer" — proves the widening is scoped, not a blanket loosening.
 *  - A representative still-`'admin'`-only item (single-string legacy shape)
 *    still rejects a non-admin role ("operator") — regression guard for the
 *    single-string code path through the new normalization.
 *  - Admin bypass is intact (admin passes every gated item regardless of
 *    `requiredRole`).
 */
import { describe, it, expect } from "vitest";
import { hasAccessToItem } from "./navigation";

// Permission checker that always allows — isolates the test to the ROLE gate
// (isItemAccessible's requiredRole branch), not the separate permission gate.
const allowAllPerms = () => true;

const WIDENED_ENGINEER_SCREENS = [
  "/ai-brain",
  "/ai-command-center",
  "/ai-active-learning",
  "/anomaly-banks",
  "/mask-annotation",
  "/ai-datasets",
  "/ai-training-studio",
];

describe("navigation.tsx — engineer AI nav widening (doc69 Wave 0-C)", () => {
  it.each(WIDENED_ENGINEER_SCREENS)("engineer can access widened screen %s", (href) => {
    expect(hasAccessToItem(href, "engineer", allowAllPerms)).toBe(true);
  });

  it("engineer is NOT admitted to /ai-monitoring (deliberately not widened)", () => {
    expect(hasAccessToItem("/ai-monitoring", "engineer", allowAllPerms)).toBe(false);
  });

  it("a non-widened admin-only item still rejects a non-admin role (string-path regression)", () => {
    // /ai-models stays a single-string 'admin' requiredRole — unchanged by this task.
    expect(hasAccessToItem("/ai-models", "operator", allowAllPerms)).toBe(false);
  });

  it("admin bypass is intact for both widened and non-widened items", () => {
    expect(hasAccessToItem("/ai-brain", "admin", allowAllPerms)).toBe(true);
    expect(hasAccessToItem("/ai-monitoring", "admin", allowAllPerms)).toBe(true);
    expect(hasAccessToItem("/ai-models", "admin", allowAllPerms)).toBe(true);
  });

  it("a role outside the widened set (e.g. operator) is still rejected by the widened items", () => {
    expect(hasAccessToItem("/ai-brain", "operator", allowAllPerms)).toBe(false);
    expect(hasAccessToItem("/ai-datasets", "operator", allowAllPerms)).toBe(false);
  });
});
