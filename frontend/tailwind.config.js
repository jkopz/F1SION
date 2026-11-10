/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        f1: {
          red: "#E10600",
          dark: "#07080B",
          panel: "#10131B",
          border: "#1F2432",
          accent: "#22C55E",
        },
      },
      fontFamily: {
        f1: ["Formula1", "sans-serif"],
        "f1-bold": ["Formula1-Bold", "sans-serif"],
        "f1-wide": ["Formula1-Wide", "sans-serif"],
        "f1-black": ["Formula1-Black", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
}
