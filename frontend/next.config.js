/** Browser security rules, sent with every page.
 *   - The page may only load code, styles and images from this website itself.
 *   - It may only talk to this website and to the blockchain provider (NEXT_PUBLIC_RPC_URL).
 *   - Nobody can show it inside another site's frame (clickjacking).
 *  Next.js needs inline scripts to start the page, so scripts allow 'unsafe-inline'; everything
 *  else is locked down. The strict policy is only sent in production, because the development
 *  server needs eval. */
const isProd = process.env.NODE_ENV === "production";

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

const rpc = origin(process.env.NEXT_PUBLIC_RPC_URL || "");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${rpc}${isProd ? "" : " ws://localhost:* http://localhost:* http://127.0.0.1:*"}`.trim(),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true }, // the image optimizer endpoint is not used; switching it off removes its attack surface
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
