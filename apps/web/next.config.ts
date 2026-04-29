import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* ===== 生产构建配置 ===== */
  // 独立输出模式，适合 Docker / Serverless 部署
  output: "standalone",

  /* ===== 图片优化 ===== */
  images: {
    // 支持的图片格式（按优先级降序）
    formats: ["image/avif", "image/webp"],
    // 允许外部图片域名（按需添加）
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "**.cloudfront.net",
      },
    ],
    // 设备宽度 breakpoints
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    // 图片尺寸 breakpoints
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // 最长缓存时间（秒）
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 天
  },

  /* ===== 安全头 ===== */
  async headers() {
    return [
      {
        // 对所有路由生效
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' blob: data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.example.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },

  /* ===== API 代理（rewrites） ===== */
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";
    return [
      {
        // 将 /api/proxy/* 请求代理到后端服务
        source: "/api/proxy/:path*",
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },

  /* ===== 其他生产优化 ===== */
  // 压缩
  compress: true,
  // 生产环境关闭 x-powered-by
  poweredByHeader: false,
  // 严格模式
  reactStrictMode: true,
  // 构建时类型检查
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
