import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "./StatusBadge";

/**
 * DS Wave 6 — <StatusBadge> stories (doc 17 §7.1 / §7.8).
 * Shows the tone tints, the auto keyword heuristic, the solid `variant` path,
 * and a per-page `map`.
 */
const meta: Meta<typeof StatusBadge> = {
  title: "Patterns/StatusBadge",
  component: StatusBadge,
  parameters: { layout: "centered" },
  args: { status: "running" },
};
export default meta;

type Story = StoryObj<typeof StatusBadge>;

export const Default: Story = {};

/** Forced tones — the soft-tint render path (semantic tokens). */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status="Default" tone="default" />
      <StatusBadge status="Success" tone="success" />
      <StatusBadge status="Warning" tone="warning" />
      <StatusBadge status="Error" tone="error" />
      <StatusBadge status="Info" tone="info" />
    </div>
  ),
};

/** Auto keyword heuristic — tone inferred from the status string. */
export const AutoHeuristic: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status="online" />
      <StatusBadge status="running" />
      <StatusBadge status="pending" />
      <StatusBadge status="degraded" />
      <StatusBadge status="failed" />
      <StatusBadge status="offline" />
      <StatusBadge status="unknown-state" />
    </div>
  ),
};

/** Solid shadcn-<Badge> variants (additive W4 render path). */
export const SolidVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status="Default" variant="default" />
      <StatusBadge status="Secondary" variant="secondary" />
      <StatusBadge status="Destructive" variant="destructive" />
      <StatusBadge status="Outline" variant="outline" />
    </div>
  ),
};

/** Per-page status → {tone,label} map override. */
export const WithMap: Story = {
  render: () => {
    const map = {
      A: { tone: "success" as const, label: "Assembled" },
      B: { tone: "warning" as const, label: "Buffered" },
      C: { tone: "error" as const, label: "Cancelled" },
    };
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status="A" map={map} />
        <StatusBadge status="B" map={map} />
        <StatusBadge status="C" map={map} />
      </div>
    );
  },
};
