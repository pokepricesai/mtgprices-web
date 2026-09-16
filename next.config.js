/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Block 1C correction pass: web tsconfig is now zero-error, so the
    // build can enforce type correctness directly. The edge function
    // surface is intentionally excluded from tsconfig.json and is
    // checked separately via `npm run typecheck:edge:diagnostic`.
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
    ],
  },
  // ── Baseline security headers (Block 1C) ───────────────────────────────
  // Conservative defaults that do not break any current behaviour. A real
  // Content-Security-Policy is intentionally deferred — see
  // docs/deployment-safety.md.
  async headers() {
    const preLaunch = process.env.SITE_LAUNCHED !== 'true'
    const baseline = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options',        value: 'SAMEORIGIN' },
      // Pre-launch: block indexing at the header level too, in addition
      // to the per-page <meta name="robots"> directive. Removed
      // automatically when SITE_LAUNCHED=true at build time.
      ...(preLaunch
        ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
        : []),
      {
        key: 'Permissions-Policy',
        // camera + geolocation are kept on for the scanner and vendor
        // proximity lookup. Everything else is opted out.
        value: [
          'accelerometer=()',
          'autoplay=()',
          'browsing-topics=()',
          'camera=(self)',
          'display-capture=()',
          'encrypted-media=()',
          'fullscreen=(self)',
          'geolocation=(self)',
          'gyroscope=()',
          'magnetometer=()',
          'microphone=()',
          'midi=()',
          'payment=()',
          'picture-in-picture=(self)',
          'publickey-credentials-get=()',
          'screen-wake-lock=()',
          'sync-xhr=()',
          'usb=()',
          'xr-spatial-tracking=()',
        ].join(', '),
      },
    ]
    return [
      {
        // Apply to every route, including API routes and sitemap XML.
        source: '/:path*',
        headers: baseline,
      },
    ]
  },
}
module.exports = nextConfig
