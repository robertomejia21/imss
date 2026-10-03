import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  // Plantillas PDF que se leen con fs en el servidor (contrato de retiro por desempleo)
  outputFileTracingIncludes: { "/*": ["src/lib/templates/**/*"] },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
