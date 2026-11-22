import solid from "@solidjs/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  plugins: [solid(), tailwindcss()],
  optimizeDeps: { exclude: ["@ui-sdk/core"] },
})
