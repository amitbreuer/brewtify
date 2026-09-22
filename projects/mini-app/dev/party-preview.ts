import type { Plugin } from 'vite';

export function partyPreviewPlugins(command: 'build' | 'serve', enabled: boolean): Plugin[] {
  if (command !== 'serve' || !enabled) return [];
  return [{
    name: 'party-navigation-preview',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || request.url?.split('?')[0] !== '/api/party/config') {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ enabled: true, telegramUrl: null, autoEnabled: false }));
      });
    },
  }];
}
