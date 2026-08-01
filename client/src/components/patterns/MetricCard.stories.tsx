import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity } from "lucide-react";
import { MetricCard } from "./MetricCard";

/**
 * DS Wave 6 — <MetricCard> stories (doc 17 §6.2 / §7.1).
 * Canonical KPI card. Tones map to semantic/legacy color classes.
 */
const meta: Meta<typeof MetricCard> = {
  title: "Patterns/MetricCard",
  component: MetricCard,
  parameters: { layout: "centered" },
  args: {
    icon: <Activity className="h-4 w-4" />,
    label: "Running tasks",
    value: 12,
  },
};
export default meta;

type Story = StoryObj<typeof MetricCard>;

export const Default: Story = {};
export const Warning: Story = { args: { tone: "warning", value: 3 } };
export const Danger: Story = { args: { tone: "danger", value: 1 } };
export const Good: Story = { args: { tone: "good", value: 8 } };
export const Info: Story = { args: { tone: "info", value: 5 } };
export const WithDelta: Story = { args: { tone: "success", delta: "+2 today" } };
export const NoIcon: Story = { args: { icon: undefined } };

/** All tones side-by-side. */
export const AllTones: Story = {
  render: (args) => (
    <div className="grid grid-cols-2 gap-3" style={{ width: 420 }}>
      <MetricCard {...args} tone="default" value={12} label="Default" />
      <MetricCard {...args} tone="success" value={8} label="Success" />
      <MetricCard {...args} tone="warning" value={3} label="Warning" />
      <MetricCard {...args} tone="danger" value={1} label="Danger" />
      <MetricCard {...args} tone="info" value={5} label="Info" />
      <MetricCard {...args} tone="good" value={9} label="Good (alias)" />
    </div>
  ),
};
