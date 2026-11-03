import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    watch: { ignored: ["**/.local/**", "**/src-tauri/target/**"] },
  },
});
