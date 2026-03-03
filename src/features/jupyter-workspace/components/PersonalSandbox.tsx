import React, { useCallback, useEffect, useRef, useState } from 'react';
import LocalSandboxStatus from './LocalSandboxStatus';

type PersonalSandboxProps = {
  onSwitchToSecure: (stashId?: string) => void;
};

type NotebookSnapshot = {
  notebookPath: string;
  notebookJson: unknown;
};

function getRuntimeApp(): any {
  const win = window as any;
  return win.jupyterapp || win.jupyterlab || win._JUPYTERLAB?.app || null;
}

async function getActiveNotebookSnapshot(): Promise<NotebookSnapshot> {
  const app = getRuntimeApp();
  const widget = app?.shell?.currentWidget;

  let notebookPath =
    widget?.context?.path ||
    widget?.context?.localPath ||
    widget?.title?.label ||
    `local-notebook-${Date.now()}.ipynb`;

  let notebookJson =
    widget?.content?.model?.toJSON?.() ||
    widget?.context?.model?.toJSON?.() ||
    null;

  if (!notebookJson && app?.serviceManager?.contents && widget?.context?.path) {
    try {
      const contentModel = await app.serviceManager.contents.get(widget.context.path, {
        content: true,
        type: 'notebook',
      });
      notebookJson = contentModel?.content || null;
    } catch {
      // Continue to final fallback error
    }
  }

  if (!notebookJson) {
    throw new Error('No active notebook found in browser memory. Open a notebook tab first.');
  }

  if (typeof notebookPath === 'string' && !notebookPath.endsWith('.ipynb')) {
    notebookPath = `${notebookPath}.ipynb`;
  }

  return { notebookPath, notebookJson };
}

export default function PersonalSandbox({ onSwitchToSecure }: PersonalSandboxProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');

  // Copy the complete JupyterLite mounting logic from SecureNotebookPage
  useEffect(() => {
    const mountPoint = mountRef.current;
    if (!mountPoint) return;

    let disposed = false;
    const staticAssetBaseUrl = '/jupyter';

    // Create popup container for menus/dialogs
    const popupContainer = document.createElement('div');
    popupContainer.id = 'jupyter-popup-container-personal';
    popupContainer.setAttribute('style', 'position: fixed; top: 0; left: 0; z-index: 10000; pointer-events: none;');
    document.body.appendChild(popupContainer);

    // Add CSS to constrain the shell and handle popups
    const shellContainStyle = document.createElement('style');
    const shellContainStyleId = 'jupyter-shell-contain-personal';
    shellContainStyle.id = shellContainStyleId;
    shellContainStyle.textContent = `
      #jupyter-popup-container-personal > .lm-Widget { pointer-events: auto; position: absolute !important; }
      body > .lm-Widget.lm-Menu, body > .lm-Widget.lm-ContextMenu { position: fixed !important; z-index: 100000 !important; }
      .jp-CommandPalette { position: fixed !important; top: 50% !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 100000 !important; max-height: 80vh !important; margin: 0 !important; }
      #personal-sandbox-site { position: relative !important; contain: strict !important; z-index: 0 !important; height: 100% !important; width: 100% !important; overflow: hidden !important; }
      #personal-sandbox-site > .jp-LabShell, #personal-sandbox-site > .jp-ApplicationShell, #personal-sandbox-site > .lm-Widget { position: absolute !important; inset: 0 !important; height: 100% !important; width: 100% !important; }
    `;
    document.head.appendChild(shellContainStyle);

    // Intercept DOM mutations to route JupyterLab components to mount point
    const origBodyInsertBefore = document.body.insertBefore.bind(document.body);
    const origBodyAppendChild = document.body.appendChild.bind(document.body);
    const origBodyRemoveChild = document.body.removeChild.bind(document.body);

    const isJupyterShell = (node: Node) => node instanceof Element && (node.id === 'jupyterlab-splash' || node.classList.contains('jp-LabShell'));
    const isJupyterPopup = (node: Node) => node instanceof Element && (node.classList.contains('lm-Menu') || node.classList.contains('lm-ContextMenu') || node.classList.contains('jp-Dialog') || node.classList.contains('jp-HoverBox') || node.classList.contains('jp-CommandPalette'));

    (document.body as any).insertBefore = function <T extends Node>(node: T, ref: Node | null): T {
      if (isJupyterShell(node)) return mountPoint.insertBefore(node, null) as unknown as T;
      if (isJupyterPopup(node) && popupContainer) return popupContainer.insertBefore(node, null) as unknown as T;
      return origBodyInsertBefore(node, ref);
    };
    (document.body as any).appendChild = function <T extends Node>(node: T): T {
      if (isJupyterShell(node)) return mountPoint.appendChild(node) as unknown as T;
      if (isJupyterPopup(node) && popupContainer) return popupContainer.appendChild(node) as unknown as T;
      return origBodyAppendChild(node);
    };
    (document.body as any).removeChild = function <T extends Node>(node: T): T {
      if (isJupyterShell(node) && node.parentNode === mountPoint) return mountPoint.removeChild(node) as unknown as T;
      if (isJupyterPopup(node) && popupContainer && node.parentNode === popupContainer) return popupContainer.removeChild(node) as unknown as T;
      return origBodyRemoveChild(node);
    };

    // Load the bundle
    const preloader = document.getElementById('jupyter-lite-main') as HTMLLinkElement;
    if (preloader && preloader.href) {
      // Load via preload link (preferred method)
      const script = document.createElement('script');
      script.src = preloader.href;
      script.setAttribute('main', preloader.getAttribute('main') || 'index');
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    } else {
      // Fallback: load bundle directly
      const script = document.createElement('script');
      script.src = `${staticAssetBaseUrl}/build/lab/bundle.js`;
      script.crossOrigin = 'anonymous';
      script.setAttribute('main', 'index');
      document.head.appendChild(script);
    }

    return () => {
      disposed = true;
      // Restore original methods
      (document.body as any).insertBefore = origBodyInsertBefore;
      (document.body as any).appendChild = origBodyAppendChild;
      (document.body as any).removeChild = origBodyRemoveChild;
      // Clean up
      if (popupContainer.parentNode) popupContainer.parentNode.removeChild(popupContainer);
      const styleEl = document.getElementById(shellContainStyleId);
      if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl);
    };
  }, []);

  const handleCopyToSecure = useCallback(async () => {
    setCopying(true);
    setMessageTone('info');
    setMessage('Preparing notebook snapshot from local browser memory...');

    try {
      const snapshot = await getActiveNotebookSnapshot();
      setMessage('Uploading notebook snapshot to secure stash...');
      setMessageTone('info');

      const response = await fetch('/api/workspace/stash', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'personal-sandbox',
          notebookPath: snapshot.notebookPath,
          notebookJson: snapshot.notebookJson,
          createdAt: new Date().toISOString(),
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || body?.message || 'Failed to stash notebook snapshot.');
      }

      setMessage('Notebook copied. Switching to Secure Clean Room...');
      setMessageTone('success');
      onSwitchToSecure(body?.stashId);
    } catch (error: any) {
      setMessageTone('error');
      setMessage(error?.message || 'Unable to copy notebook to secure workspace.');
    } finally {
      setCopying(false);
    }
  }, [onSwitchToSecure]);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
          Personal sandbox: local browser execution (JupyterLite)
        </div>
        <div ref={mountRef} id="personal-sandbox-site" className="relative flex-1 overflow-hidden" />
      </div>
      <LocalSandboxStatus
        onCopyToSecureWorkspace={handleCopyToSecure}
        copying={copying}
        message={message}
        messageTone={messageTone}
      />
    </div>
  );
}
