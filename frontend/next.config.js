/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // thirdweb pulls in Coinbase's SDK, which references optional "x402" payment packages that
    // VeraTally never uses and that aren't installed. Resolve them to empty modules so the build
    // doesn't fail on them.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/svm": false,
      "@x402/extensions": false,
    };
    return config;
  },
};

module.exports = nextConfig;
