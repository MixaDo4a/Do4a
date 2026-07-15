import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f7f2ea",
        muted: "#b8a99c",
        line: "rgba(234, 214, 184, 0.18)",
        surface: "#120d0d",
        brand: "#c1121f",
        warning: "#d6a84f",
        danger: "#ff4d5a"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(0, 0, 0, 0.35)"
      }
    },
  },
  plugins: [],
};

export default config;
