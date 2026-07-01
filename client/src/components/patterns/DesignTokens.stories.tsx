import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * DS Wave 6 — Design Tokens playground (doc 17 §6.2 / §12.1).
 *
 * Renders live swatches for the semantic color tokens (bound via the @theme
 * layer in client/src/index.css), the surface/text elevation ramps, and one
 * row per .ds-* type-scale class. Use the toolbar Theme toggle (dark/light) to
 * verify tokens resolve correctly in both modes.
 */
const meta: Meta = {
  title: "Design System/Tokens",
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const SEMANTIC = [
  ["Background", "bg-background", "text-foreground"],
  ["Card", "bg-card", "text-card-foreground"],
  ["Primary", "bg-primary", "text-primary-foreground"],
  ["Secondary", "bg-secondary", "text-secondary-foreground"],
  ["Muted", "bg-muted", "text-muted-foreground"],
  ["Accent", "bg-accent", "text-accent-foreground"],
  ["Success", "bg-success", "text-success-foreground"],
  ["Warning", "bg-warning", "text-warning-foreground"],
  ["Info", "bg-info", "text-info-foreground"],
  ["Destructive / Error", "bg-destructive", "text-destructive-foreground"],
] as const;

const SURFACE = ["bg-surface-1", "bg-surface-2", "bg-surface-3"] as const;
const TEXT_RAMP = ["text-text-1", "text-text-2", "text-text-3"] as const;

const TYPE_SCALE = [
  ["ds-display", "Display"],
  ["ds-h1", "Heading 1"],
  ["ds-h2", "Heading 2"],
  ["ds-h3", "Heading 3"],
  ["ds-h4", "Heading 4"],
  ["ds-h5", "Heading 5"],
  ["ds-h6", "Heading 6"],
  ["ds-body", "Body"],
  ["ds-body-sm", "Body small"],
  ["ds-caption", "Caption"],
] as const;

function Swatch({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <div className={`flex h-20 flex-col justify-between rounded-lg border p-3 ${bg} ${fg}`}>
      <span className="text-sm font-medium">{label}</span>
      <span className="font-mono text-xs opacity-80">{bg}</span>
    </div>
  );
}

export const Colors: Story = {
  render: () => (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <h2 className="ds-h3 mb-4">Semantic color tokens</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SEMANTIC.map(([label, bg, fg]) => (
          <Swatch key={label} label={label} bg={bg} fg={fg} />
        ))}
      </div>

      <h2 className="ds-h3 mb-4 mt-8">Surface elevation ramp</h2>
      <div className="grid grid-cols-3 gap-3">
        {SURFACE.map((bg) => (
          <div
            key={bg}
            className={`flex h-16 items-center justify-center rounded-lg border font-mono text-xs ${bg} text-foreground`}
          >
            {bg}
          </div>
        ))}
      </div>

      <h2 className="ds-h3 mb-4 mt-8">Text emphasis ramp</h2>
      <div className="space-y-1">
        {TEXT_RAMP.map((fg) => (
          <p key={fg} className={`ds-body font-mono ${fg}`}>
            {fg} — The quick brown fox jumps over the lazy dog.
          </p>
        ))}
      </div>
    </div>
  ),
};

export const TypeScale: Story = {
  render: () => (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <h2 className="ds-h3 mb-4">Type scale (.ds-*)</h2>
      <div className="space-y-3">
        {TYPE_SCALE.map(([cls, label]) => (
          <div key={cls} className="flex items-baseline gap-4 border-b pb-2">
            <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">
              .{cls}
            </span>
            <span className={cls}>{label} — Aa Bb Cc 0123</span>
          </div>
        ))}
      </div>
    </div>
  ),
};
