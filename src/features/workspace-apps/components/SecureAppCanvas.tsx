import React from 'react';

type Props = {
  appId: string;
  defaultPath?: string;
};

const SecureAppCanvas = ({ appId, defaultPath = '/' }: Props) => {
  // Construct the proxy URL pointing to our Next.js API route
  const proxyUrl = `/api/workspace/proxy/${appId}${defaultPath}`;

  return (
    <div className="h-full w-full overflow-hidden bg-white">
      <object
        data={proxyUrl}
        type="text/html"
        title={`Secure Workspace App: ${appId}`}
        className="h-full w-full border-0"
      >
        <div className="flex h-full items-center justify-center text-slate-500">
          <p>Unable to load application content.</p>
        </div>
      </object>
    </div>
  );
};

export default SecureAppCanvas;
