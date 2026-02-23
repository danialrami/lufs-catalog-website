import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

export default defineConfig({
  output: 'static',
  integrations: [svelte()],
  
  // Local paths - for production with R2, you'd configure Vite to alias public/ URLs
  // or use environment variables for asset base paths
  
  // Ensure Astro properly serves static files from public/
  // (default behavior, just documented here)
  
  // Optional: Configure base path if serving from subdirectory
  // baseURL: 'https://catalog.lufs.audio',
});
