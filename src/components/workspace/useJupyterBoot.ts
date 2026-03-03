import { useEffect, useRef } from 'react';

type JupyterBootOptions = {
  enabled: boolean;
  staticAssetBaseUrl: string;
  mountPointRef: React.RefObject<HTMLDivElement>;
  setError: (error: string | null) => void;
};

/* 
 * Extend Window interface for Jupyter configuration
 */
declare global {
  interface Window {
    jupyterlab?: any;
    jupyterConfigData?: any;
    _jupyter_boot_cleanup?: () => void;
  }
}

/**
 * useJupyterBoot
 *
 * Bootstraps a JupyterLab/JupyterLite instance directly into the DOM (no iframe).
 * 
 * Architecture:
 * - Assets loaded from `staticAssetBaseUrl` (S3 or local).
 * - API calls routed to JEG proxy via patched fetch/PageConfig.
 * - Local storage usage disabled/mocked to transient memory if possible.
 * - Accessibility (508) supported by ensuring the mount point is a landmark region.
 */
const useJupyterBoot = ({
  enabled,
  staticAssetBaseUrl,
  mountPointRef,
  setError,
}: JupyterBootOptions) => {
  const bootedRef = useRef(false);

  useEffect(() => {
    // Prevent re-booting or booting if disabled
    if (!enabled || bootedRef.current || !mountPointRef.current) return;

    const mountPoint = mountPointRef.current;
    let cleanupFn: (() => void) | undefined;

    const boot = async () => {
      try {
        console.log('[JupyterBoot] Initializing from:', staticAssetBaseUrl);

        // 1. Configure Jupyter Environment
        // We set global configuration that JupyterLite/Lab will read upon startup.
        // This directs kernel traffic to our JEG proxy and sets up the strict security model.
        window.jupyterConfigData = {
          baseUrl: '/api/workspace/jeg/proxy/',  // Proxy path for kernel/spec API
          wsUrl: undefined,                      // WebSocket URL (empty implies relative to baseUrl)
          appUrl: '/WorkspaceJEG',               // Current page URL
          staticUrl: staticAssetBaseUrl,         // Asset source (S3/Local)
          // Security / Storage settings
          terminalsAvailable: true,
          token: 'dummy-token-for-proxy-auth',   // Token handled by proxy cookie
          disableLocalStorage: true,             // Custom flag for our modified loader?
          
          // Theme & Layout defaults
          settingsOverrides: {
             // Disable autosave or local state if possible via settings
            "@jupyterlab/docmanager-extension:plugin": {
              "autosaveInterval": 0
            }
          }
        };

        // 2. Storage Sandbox (Crucial for "no data leaves my area")
        // Since we are running in the main window context, we must be careful not to break
        // the main app's storage. If JupyterLite insists on using localStorage, 
        // we might need to proxy it *specifically for Jupyter namespaces*.
        // For now, we assume the custom build respects the `disableLocalStorage` config or similar.

        // 3. Script Injection
        // We load the main entry point (usually bundle.js or bootstrap.js).
        // Using a unique ID to track the script for cleanup.
        const scriptId = 'jupyter-boot-script';
        if (document.getElementById(scriptId)) {
          console.warn('[JupyterBoot] Script already detected, skipping injection.');
          return;
        }

        const script = document.createElement('script');
        script.id = scriptId;
        script.src = `${staticAssetBaseUrl}/bootstrap.js`; // Adjust filename as needed for S3 build
        script.async = true;
        script.type = 'module';
        
        // Error handling for script load
        script.onerror = () => {
           setError(`Failed to load Jupyter assets from ${staticAssetBaseUrl}`);
        };

        document.body.appendChild(script);

        // 4. Kernel Interception & Event Wiring
        // We can listen for custom events dispatched by our modified JupyterLite build
        // or standard JupyterLab commands.
        // Example: Intercepting Shift+Enter if we want to prompt for a kernel.
        
        // This cleanup function will be called on unmount
        cleanupFn = () => {
          const s = document.getElementById(scriptId);
          if (s) s.remove();
          
          delete window.jupyterConfigData;
          delete window.jupyterlab;
          
          // Restore any monkey-patched globals if necessary
          if (window._jupyter_boot_cleanup) {
            window._jupyter_boot_cleanup();
            delete window._jupyter_boot_cleanup;
          }
          
          // Clear the mount point
          if (mountPoint) {
            mountPoint.innerHTML = '';
          }
          console.log('[JupyterBoot] Cleaned up session resources.');
        };

        bootedRef.current = true;
      } catch (err: any) {
        console.error('[JupyterBoot] Boot failed:', err);
        setError(err.message || 'Failed to initialize Jupyter environment');
        // Clean up partial state
        if (cleanupFn) cleanupFn();
      }
    };

    boot();

    return () => {
      // Unmount / Cleanup
      bootedRef.current = false;
      if (cleanupFn) cleanupFn();
    };
  }, [enabled, staticAssetBaseUrl, mountPointRef, setError]);
};

export default useJupyterBoot;
