import type { Config } from "tailwindcss";
const c = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: { ivory: c("ivory"), paper: c("paper"), navy: c("navy"), teal: c("teal"), sage: c("sage"), lav: c("lav"), gold: c("gold"), mist: c("mist") },
    fontFamily: { display: ["var(--font-display)", "Georgia", "serif"], sans: ["var(--font-body)", "system-ui", "sans-serif"] },
    boxShadow: { soft: "0 1px 2px rgba(10,10,40,.12), 0 12px 32px -12px rgba(10,10,70,.35)" },
  }},
  plugins: [],
} satisfies Config;
