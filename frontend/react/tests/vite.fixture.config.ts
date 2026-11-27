import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'isolated-navigation-routes',
      configureServer(server) {
        if (mode !== 'navigation-test') return;
        server.middlewares.use((request, _response, next) => {
          if (request.headers.accept?.includes('text/html')) request.url = '/tests/browser-fixture.html';
          next();
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 3100, strictPort: true },
}));
