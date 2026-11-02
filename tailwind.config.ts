import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: { ivory:"#FAF6EE", paper:"#FFFDF8", navy:"#1B2A3A", teal:"#4E8A86", sage:"#A9B8A0", lav:"#D9D1EC", gold:"#C9A24D", mist:"#E8E2D4" },
    fontFamily: { display:["var(--font-display)","Georgia","serif"], sans:["var(--font-body)","system-ui","sans-serif"] },
    boxShadow: { soft:"0 1px 2px rgba(27,42,58,.05), 0 12px 32px -12px rgba(27,42,58,.14)" },
  }},
  plugins: [],
} satisfies Config;
