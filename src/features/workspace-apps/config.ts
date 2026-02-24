export type WorkspaceAppConfig = {
  id: string;
  displayName: string;
  upstreamUrl: string;
  defaultPath: string;
};

// 1. Static Defaults (Code-based)
const STATIC_APPS: Record<string, WorkspaceAppConfig> = {
  superset: {
    id: 'superset',
    displayName: 'Apache Superset',
    upstreamUrl: process.env.SUPERSET_UPSTREAM_URL || 'http://localhost:8088',
    defaultPath: '/',
  },
  igv: {
    id: 'igv',
    displayName: 'IGV Genomics Viewer',
    upstreamUrl: process.env.IGV_UPSTREAM_URL || 'http://localhost:8080',
    defaultPath: '/index.html',
  },
  streamlit: {
    id: 'streamlit',
    displayName: 'Streamlit Analytics',
    upstreamUrl: process.env.STREAMLIT_UPSTREAM_URL || 'http://localhost:8501',
    defaultPath: '/',
  },
};

// 2. Dynamic Injection (Environment-based)
// Allows adding apps via K8s ConfigMap without rebuilding the frontend.
// Example: WORKSPACE_APPS_JSON='[{"id":"rstudio","displayName":"RStudio","upstreamUrl":"http://rstudio:8787","defaultPath":"/"}]'
function getDynamicApps(): Record<string, WorkspaceAppConfig> {
  const envJson = process.env.WORKSPACE_APPS_JSON;
  if (!envJson) return {};

  try {
    const parsed = JSON.parse(envJson) as WorkspaceAppConfig[];
    return parsed.reduce((acc, app) => {
      if (app.id && app.upstreamUrl) {
        acc[app.id] = app;
      }
      return acc;
    }, {} as Record<string, WorkspaceAppConfig>);
  } catch (e) {
    console.error('Failed to parse WORKSPACE_APPS_JSON:', e);
    return {};
  }
}

export function getAllApps(): WorkspaceAppConfig[] {
  const dynamic = getDynamicApps();
  // Dynamic apps override static ones if IDs collide
  const merged = { ...STATIC_APPS, ...dynamic };
  return Object.values(merged);
}

export function getAppConfig(appId: string): WorkspaceAppConfig | null {
  const dynamic = getDynamicApps();
  return dynamic[appId] || STATIC_APPS[appId] || null;
}
