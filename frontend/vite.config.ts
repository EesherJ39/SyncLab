import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // if backend is on 8080, you can leave this as-is; WS uses absolute URL in code
    port: 5173
  }
});