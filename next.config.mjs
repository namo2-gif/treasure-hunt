/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['jose', 'bcryptjs'],
};

export default nextConfig;
