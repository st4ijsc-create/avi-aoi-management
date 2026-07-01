import type { Meta, StoryObj } from "@storybook/react-vite";
import { Heading, Text } from "./Heading";

/**
 * DS Wave 6 — <Heading> / <Text> stories (doc 17 §7.1, type scale §12.1).
 */
const meta: Meta<typeof Heading> = {
  title: "Patterns/Typography",
  component: Heading,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof Heading>;

/** The full heading ramp (.ds-display + .ds-h1..h6). */
export const Headings: Story = {
  render: () => (
    <div className="space-y-2">
      <Heading level={1} display>
        Display
      </Heading>
      <Heading level={1}>Heading 1</Heading>
      <Heading level={2}>Heading 2</Heading>
      <Heading level={3}>Heading 3</Heading>
      <Heading level={4}>Heading 4</Heading>
      <Heading level={5}>Heading 5</Heading>
      <Heading level={6}>Heading 6</Heading>
    </div>
  ),
};

/** Body / caption text variants + tone ramps. */
export const BodyText: Story = {
  render: () => (
    <div className="space-y-2">
      <Text variant="body">Body — default tone.</Text>
      <Text variant="body" tone="muted">
        Body — muted tone.
      </Text>
      <Text variant="body-sm">Body small.</Text>
      <Text variant="caption" tone="subtle">
        Caption — subtle tone.
      </Text>
    </div>
  ),
};
