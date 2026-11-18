import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["10.155.201.172"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
