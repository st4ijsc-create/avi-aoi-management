import type { Meta, StoryObj } from "@storybook/react-vite";
import { Gauge } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { Button } from "@/components/ui/button";
import { Text } from "./Heading";

/**
 * DS Wave 6 — <SectionCard> stories (doc 17 §7.1).
 * Titled-panel pattern over shadcn Card primitives.
 */
const meta: Meta<typeof SectionCard> = {
  title: "Patterns/SectionCard",
  component: SectionCard,
  parameters: { layout: "padded" },
  args: {
    icon: <Gauge className="h-4 w-4 text-primary" />,
    title: "Throughput",
    children: <Text tone="muted">Section body content goes here.</Text>,
  },
};
export default meta;

type Story = StoryObj<typeof SectionCard>;

export const Default: Story = {};

export const WithDescription: Story = {
  args: { description: "Rolling 24h units per hour across all cells." },
};

export const WithAction: Story = {
  args: {
    action: (
      <Button variant="outline" size="sm">
        Export
      </Button>
    ),
  },
};

export const FullBleedContent: Story = {
  args: {
    contentClassName: "p-0",
    children: (
      <div className="border-t p-4 text-sm text-muted-foreground">
        Table / full-bleed content (contentClassName="p-0").
      </div>
    ),
  },
};
