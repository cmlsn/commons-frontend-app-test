import type { NextApiRequest, NextApiResponse } from 'next';
import {
  assertSecureJegConfiguration,
  isJegPreviewModeEnabled,
} from '@/lib/workspace/jegSecurity';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (isJegPreviewModeEnabled()) {
      return res.status(200).json({ enabled: true, previewMode: true });
    }
    assertSecureJegConfiguration();
    return res.status(200).json({ enabled: true });
  } catch {
    return res.status(200).json({ enabled: false });
  }
}
