import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Wikipedia Game',
    description:
      'Navegue entre artigos da Wikipédia por links internos com pontuação dinâmica, modificadores e validação stateless.',
    version: '0.1.0',
    permissions: ['storage', 'sidePanel', 'webNavigation', 'tabs'],
    host_permissions: [
      '*://*.wikipedia.org/*',
      'https://wikipedia-game-api.pablosme9.workers.dev/*',
      'https://*.workers.dev/*',
      'http://localhost:8787/*',
    ],
    action: {
      default_title: 'Abrir Wikipedia Game no Side Panel',
    },
  },
});
