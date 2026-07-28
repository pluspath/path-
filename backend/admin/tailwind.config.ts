import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        navy: {
          DEFAULT: "#0A1F44",
          soft: "#132A52",
          deep: "#060F22",
        },
        cream: {
          DEFAULT: "#F8F6F2",
          dark: "#E8E4DC",
        },
        gold: {
          DEFAULT: "#C9A84C",
          soft: "#F7F0E0",
          muted: "#A88B3A",
        },
        muted: {
          DEFAULT: "#8B8B8B",
        },
        atlas: {
          paper: "var(--atlas-paper)",
          ink: "var(--atlas-ink)",
          muted: "var(--atlas-muted)",
          border: "var(--atlas-border)",
          panel: "var(--atlas-panel)",
          accent: "var(--atlas-accent)",
          soft: "var(--atlas-accent-soft)",
          gold: "var(--atlas-gold)",
          "gold-soft": "var(--atlas-gold-soft)",
          success: "var(--atlas-success)",
          warning: "var(--atlas-warning)",
          danger: "var(--atlas-danger)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        atlas: "0 1px 2px rgba(10, 31, 68, 0.04), 0 8px 24px rgba(10, 31, 68, 0.04)",
        "atlas-lg": "0 12px 40px rgba(10, 31, 68, 0.08)",
      },
      borderRadius: {
        atlas: "0.75rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
