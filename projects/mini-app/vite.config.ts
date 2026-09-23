import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { partyPreviewPlugins } from './dev/party-preview'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  const previewEnabled = (process.env.VITE_PARTY_PREVIEW ?? environment.VITE_PARTY_PREVIEW) === 'true';
  return {
    plugins: [react(), tailwindcss(), ...partyPreviewPlugins(command, previewEnabled)],
    base: '/app/',
    optimizeDeps: {
      include: ['@brewtify/shared'],
    },
    server: {
      port: 5174,
      host: '127.0.0.1',
    },
  };
})
