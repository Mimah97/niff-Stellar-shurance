const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: false,
  reloadOnOnline: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  workboxOptions: {
    // Never cache API responses that may contain user data.
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        // App shell and static assets.
        urlPattern: ({ request }) => request.destination === 'document',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'app-shell',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        // Docs pages work offline.
        urlPattern: /^https?:\/.*\/docs(\/.*)?$/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'docs',
          expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: ({ request }) =>
          request.destination === 'script' ||
          request.destination === 'style' ||
          request.destination === 'font' ||
          request.destination === 'image',
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'static-assets',
          expiration: { maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        // Explicitly bypass API routes so user data is never cached.
        urlPattern: /\/api\//,
        handler: 'NetworkOnly',
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['recharts', 'lucide-react'],
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      // Route-level code splitting for heavy components.
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...(config.optimization.splitChunks?.cacheGroups || {}),
          charts: {
            test: /[\\/]node_modules[\\/](recharts|d3-|victory)/,
            name: 'charts',
            chunks: 'async',
            priority: 20,
          },
          uploader: {
            test: /[\\/]node_modules[\\/](react-dropzone|uppy)/,
            name: 'uploader',
            chunks: 'async',
            priority: 20,
          },
          wallet: {
            test: /[\\/]node_modules[\\/](@stellar[\\/]|@creit\.tech[\\/]|@wallet)/,
            name: 'wallet',
            chunks: 'async',
            priority: 20,
          },
        },
      };
    }
    return config;
  },
};

module.exports = withPWA(nextConfig);
