import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "@/components/EmptyState";

/**
 * DS Wave 6 — <EmptyState> stories (doc 17 §7.1).
 * Uses react-i18next; preview.ts initialises i18next so `t()` resolves.
 * Explicit title/description are passed so copy is stable regardless of locale.
 */
const meta: Meta<typeof EmptyState> = {
  title: "Patterns/EmptyState",
  component: EmptyState,
  parameters: { layout: "padded" },
  args: {
    title: "No data yet",
    description: "Once inspections run, results appear here.",
  },
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};
export const NoData: Story = { args: { variant: "no-data" } };
export const NoResults: Story = { args: { variant: "no-results" } };
export const NoAnalytics: Story = { args: { variant: "no-analytics" } };
export const NoConfig: Story = { args: { variant: "no-config" } };
export const ErrorState: Story = {
  args: { variant: "error", title: "Cannot load data", description: "Try again." },
};
export const Compact: Story = { args: { compact: true } };
export const WithAction: Story = {
  args: { actionLabel: "Refresh", onAction: () => {} },
};
