import { proxyHandler } from '@/features/workspace-apps';

// Disable Next.js body parsing to allow streaming proxy
export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default proxyHandler;
