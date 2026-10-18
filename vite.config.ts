import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relative : l'application fonctionne aussi ouverte depuis un sous-dossier (GitHub Pages…)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { globals: true, environment: 'node' },
});
