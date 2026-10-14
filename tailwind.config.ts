import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    // Plugin workspaces (gitignored, separate repos): without this glob,
    // every Tailwind class used ONLY inside plugins/ is silently never
    // generated (e.g. the Agent-Sessions dialog max-h → unscrollable modal).
    "./plugins/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        status: {
          new: "#3B82F6",           // Blue
          firstRequests: "#8B5CF6", // Purple  
          successPartly: "#F59E0B", // Amber
          successComplete: "#10B981", // Emerald
          locked: "#6B7280"         // Gray
        },
        "btn-default": "#86b0e2",
        "btn-hover": "#adcff8",
        gradient: {
          'success': {
            from: '#ced8f7',
            via: '#b4caf4',
            to: '#97b8ec'
          },
          'default': {
            from: '#ced8f7',
            via: '#b4caf4',
            to: '#97b8ec'
          },
          'dark': {  // dark mode gradients
            success: {
              from: '#2a3f5f',
              via: '#1e3a5f',
              to: '#152847'
            },
            default: {
              from: '#2a3f5f',
              via: '#1e3a5f',
              to: '#152847'
            }
          }
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        fadeIn: "fadeIn 0.3s ease-in-out",
      },
      cssVariables: {
        '--primary-rgb': '59, 130, 246', // Updated to match the blue color
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;