import type { Meta, StoryObj } from "@storybook/react-vite";
import { Truck, RefreshCw, Plus } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";

/**
 * DS Wave 6 — <PageHeader> stories (doc 17 §7.1).
 * Canonical page header: [icon chip] · title (+ badge) + description · [actions].
 */
const meta: Meta<typeof PageHeader> = {
  title: "Patterns/PageHeader",
  component: PageHeader,
  parameters: { layout: "padded" },
  args: {
    icon: <Truck className="h-6 w-6 text-primary" />,
    title: "Fleet Orchestration",
    description: "Live AMR fleet, tasks and charging across the plant.",
  },
};
export default meta;

type Story = StoryObj<typeof PageHeader>;

export const Default: Story = {};

export const WithActions: Story = {
  args: {
    actions: (
      <>
        <Button variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> New task
        </Button>
      </>
    ),
  },
};

export const WithBadge: Story = {
  args: {
    badge: <StatusBadge status="running" className="mt-1" />,
  },
};

export const NoIcon: Story = {
  args: { icon: undefined },
};

export const AsH2: Story = {
  args: { as: "h2", title: "Sub-section header" },
};
