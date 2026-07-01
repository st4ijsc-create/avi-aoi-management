import type { Preview } from "@storybook/react-vite";

// App global CSS — brings in Tailwind v4 (@import "tailwindcss") + the @theme
// token layer + the .ds-* type scale so stories render with real DS tokens.
import "../client/src/index.css";
// Initialise i18next so components using useTranslation() (e.g. EmptyState) work.
import "../client/src/i18n";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "hsl(0 0% 3.9%)" },
        { name: "light", value: "hsl(0 0% 100%)" },
      ],
    },
  },
  // Toggle the app's `.dark` class on the story root so tokens resolve to the
  // matching theme. Defaults to dark (the app's primary surface).
  globalTypes: {
    theme: {
      description: "DS theme (toggles the .dark class)",
      defaultValue: "dark",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme ?? "dark";
      if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("dark", theme === "dark");
      }
      return Story();
    },
  ],
};

export default preview;
