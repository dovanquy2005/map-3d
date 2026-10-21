import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/osm': {
        target: 'https://api.openstreetmap.org/api/0.6',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/osm/, ''),
      },
      '/api/overpass': {
        target: 'https://maps.mail.ru/osm/tools/overpass/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass/, ''),
      },
    },
  },
});
