# Deployment types for commons-frontend-app

Therre are two chocies for deployment:

Fork or create from template this repository to deploy commons-frontend-app with your own configuration and repository.

Deploy commons-frontend-app with helm chart. To do this you need create a config repository (or use existing).
The config repository contains the config and public directories used by the gen3-frontend-framework, it needs to have the
 following structure:

directoryName | gen3/config/
directoryName | gen3/public/

To deploy commons-frontend-app with helm chart set up the helm chart values:

```yaml
frontend-framework:
  enabled: true
  customConfig:
    enabled: true
    repo: https://github.com/somerepository/gen3ff-commons-config.git
    branch: main
    dir: directoryName (optional)
  image:
    repository: quay.io/cdis/commons-frontend-app
    tag: main
```

## Secure Workspace JEG configuration

The Workspace JEG route at `/Workspace/JEG` uses server-side proxy endpoints to enforce
Fence-backed identity, user-workspace scoping, and optional IAP headers.

Set these runtime environment variables in your deployment:

- `JEG_SERVER_URL` (required): HTTPS URL for your JEG backend.
- `JEG_WORKSPACE_CLAIM` (optional): Fence token claim to map user identity to workspace.
- `JEG_WORKSPACE_PREFIX` (optional): Prefix for generated workspace IDs (`workspace` by default).
- `JEG_DEFAULT_NOTEBOOK_PATH` (optional): Initial Jupyter path (`/lab` by default).
- `JEG_WS_URL` (optional): Explicit WebSocket URL; if omitted, derived from `JEG_SERVER_URL`.
- `JEG_CLIENT_TOKEN` (optional): Token exposed to client-side Jupyter shell if required.
- `JEG_ENFORCE_ENCRYPTED_TRANSPORT` (optional): Defaults to `true`; requires `https`/`wss`.

Data exfiltration controls in the Node.js proxy:

- `JEG_DATA_EXFIL_POLICY` (optional): `strict` (default), `balanced`, or `open`.
  - `strict`: blocks direct file download routes, notebook export, terminal APIs, and
    write operations on contents APIs.
  - `balanced`: blocks notebook export and terminal APIs.
  - `open`: allows all proxied routes.

Encrypted ZeroMQ tunnel signaling:

- `JEG_REQUIRE_ZMQ_TLS=true` adds `x-jeg-require-zmq-tls: true` on proxied calls so
  backend policy can require encrypted kernel channels.

For IAP/Zero-Trust forwarding at the Node.js layer:

- `JEG_IAP_ENABLED=true` enables IAP assertion forwarding.
- `JEG_IAP_ASSERTION` (required when enabled) supplies assertion content.
- `JEG_IAP_ASSERTION_HEADER` (optional) sets header name
  (defaults to `x-goog-iap-jwt-assertion`).

### Export to Jupyter context handoff

Use `POST /api/workspace/jeg/export` to stage cohort/data-library context for JEG.
The endpoint creates a short-lived, httpOnly signed cookie that is forwarded to JEG as
`x-jeg-context-jwt` through the secure proxy.

Request body supports:

- `cohortId` / `cohortName`
- `dataLibraryIds` (array)
- `guids` (array)
- `exportSource` (`cohort`, `data-library`, `mixed`)
- `metadata` (object)

Use `DELETE /api/workspace/jeg/export` to clear staged context.

Required runtime settings:

- `JEG_CONTEXT_SIGNING_KEY` (required): HMAC key used to sign context JWT.
- `JEG_CONTEXT_TOKEN_TTL_SECONDS` (optional): defaults to `600`.

### Shared pre-release library attach

The JEG UI supports two compute modes:

- `personal`: standard isolated compute without pre-release mounts
- `pre-release`: user-selected shared S3 libraries are attached for the session

Session mode and selected libraries are staged through `POST /api/workspace/jeg/launch-profile`
as a signed cookie and forwarded to JEG through:

- `x-jeg-launch-jwt`
- `x-jeg-launch-mode`

For Jupyter session creation calls (`POST /api/sessions`), the proxy also injects
`gen3LaunchProfile` into the JSON body to support backend-specific mount logic.

Library APIs:

- `GET /api/workspace/jeg/libraries` (list user-authorized libraries)
- `POST /api/workspace/jeg/libraries/share` (update library sharing users)
- `GET /api/workspace/jeg/library/my` (list personal published snapshots)
- `POST /api/workspace/jeg/library/my` (publish to personal library)

Required/optional settings:

- `JEG_LIBRARY_SERVICE_URL` (required for library features): internal service that reads/writes RDS-backed library rows.
- `JEG_LIBRARY_READ_AUTHZ_RESOURCE` (optional): Arborist resource required to list libraries.
- `JEG_LIBRARY_SHARE_AUTHZ_RESOURCE` (optional): Arborist resource required to share libraries.
- `JEG_LAUNCH_SIGNING_KEY` (optional): key for launch JWT; defaults to `JEG_CONTEXT_SIGNING_KEY`.
- `JEG_LAUNCH_TOKEN_TTL_SECONDS` (optional): defaults to `600`.
- `JEG_SNAPSHOT_URI_PREFIX` (optional): URI prefix used for kernel snapshot object pointers.

### Kernel lifecycle policy and stale reap

Kernel lifecycle endpoints:

- `GET /api/workspace/jeg/kernels` (kernel/session status with last-used and runtime)
- `POST /api/workspace/jeg/kernels/terminate` (terminate + delete with backend confirmation)
- `POST /api/workspace/jeg/kernels/reap-stale` (policy-driven stale kernel cleanup)

Default lifecycle policy:

- Warn at `5` idle days
- Kill at `10` idle days (after warning window)
- Hard max age kill at `15` days

Configurable settings:

- `JEG_IDLE_WARNING_DAYS` (optional, default `5`)
- `JEG_IDLE_KILL_DAYS` (optional, default `10`)
- `JEG_MAX_KERNEL_AGE_DAYS` (optional, default `15`)
- `JEG_AUTOSAVE_ON_STALE_KILL` (optional, default `true`)

When stale kill is triggered, the app performs autosave to **My Published Library** before
termination, then removes the kernel row from UI only after backend confirmation.

### Frontend-only preview mode

To render the JEG UI without a live JEG backend or Fence session, enable preview mode:

- `JEG_UI_PREVIEW_MODE=true`

When enabled, the workspace page and JEG APIs return deterministic mock data for session,
libraries, personal library, kernels, launch profile, and terminate actions so UI can be
reviewed end-to-end locally.

Recommended hardening for FedRAMP Moderate/High and HIPAA workloads:

- Restrict egress from frontend pods to approved JEG and identity endpoints only.
- Keep JEG behind private networking and enforce TLS everywhere.
- Rotate IAP assertions and context signing keys via your secret manager.
- Ensure backend validates `x-jeg-workspace-id`, `x-jeg-context-jwt`, and optional
  `x-jeg-require-zmq-tls` before loading data into kernels.


