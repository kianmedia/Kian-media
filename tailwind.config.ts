import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        bebas: ["'Bebas Neue'", "sans-serif"],
        mont:  ["'Montserrat'", "sans-serif"],
      },
      colors: {
        red: {
          50:"#fff1f1", 100:"#ffe0e0", 200:"#ffc7c7", 300:"#ffa0a0",
          400:"#ff6b6b", 500:"#e74c3c", 600:"#c0392b", 700:"#a93226",
          800:"#8b1a1a", 900:"#7a1a1a", 950:"#3d0808",
        },
      },
      transitionDuration: { "400": "400ms" },
    },
  },
  plugins: [],
} satisfies Config;
