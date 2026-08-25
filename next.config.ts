import type { NextConfig } from 'next';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isGitHubPagesBuild = process.env.GITHUB_PAGES === 'true';
const isAccountSite = repositoryName.endsWith('.github.io');
const pagesBasePath = isGitHubPagesBuild && repositoryName && !isAccountSite
  ? `/${repositoryName}`
  : '';

const nextConfig: NextConfig = {
  ...(isGitHubPagesBuild
    ? {
        output: 'export' as const,
        trailingSlash: true,
        basePath: pagesBasePath,
        assetPrefix: pagesBasePath,
      }
    : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: pagesBasePath,
  },
};

export default nextConfig;
