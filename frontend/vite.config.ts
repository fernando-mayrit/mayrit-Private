import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El frontend corre en localhost:5173 (puerto por defecto de Vite).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
