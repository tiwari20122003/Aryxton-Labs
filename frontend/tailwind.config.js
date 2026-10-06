/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        lav: {
          light: "#e9deff",
          DEFAULT: "#c8b6ff",
          deep: "#8b7fd3",
        },
        mint: {
          light: "#d4f5e3",
          DEFAULT: "#a7e8c3",
          deep: "#56b98a",
        },
        peach: {
          light: "#ffe5d9",
          DEFAULT: "#ffc3a0",
          deep: "#ff9a7a",
        },
        rose: {
          light: "#ffd8e4",
          DEFAULT: "#ffb4cc",
          deep: "#ff8aac",
        },
        ink: {
          DEFAULT: "#2a2440",
          soft: "#5c5577",
          muted: "#8a84a3",
        },
      },
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Outfit"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glass: "0 10px 40px -12px rgba(140, 110, 200, 0.22)",
        "glass-lg": "0 18px 52px -14px rgba(140, 110, 200, 0.28)",
      },
      borderRadius: {
        "4xl": "32px",
      },
      animation: {
        "fade-in": "fadeIn 420ms ease-out both",
      },
    },
  },
  plugins: [],
};
