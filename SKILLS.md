# Smuggler AI Skills

Procedural guides for common development tasks in the Smuggler project.

## Development Lifecycle

### First-Time Setup
```bash
./setup.sh
```
Installs Docker, Python (uv), Node.js, and builds all Docker images.

### Running with Dev Hot-Reload
```bash
./start.sh debug
```
Starts Vite (frontend) and Python (backend) concurrently with hot-reload enabled.

### Running the Full Production Stack
```bash
./start.sh build
./start.sh stop
./start.sh prune  # Tear down everything including mules
```

---

## Backend (Python/Flask)

### Adding a New API Blueprint
1. Create `api/new_feature.py`.
2. Define `new_feature_bp = Blueprint('new_feature', __name__)`.
3. Register it in `api/app.py`: `app.register_blueprint(new_feature_bp, url_prefix='/api/new_feature')`.
4. Add any new tables to `api/database.py` and implement migrations in the `_MIGRATIONS` list.

### Accessing Docker/aria2
Always use the shared clients:
- `from cli.docker_client import ...`
- `from cli.aria2_client import ...`

### Logging
Always use the central logger:
```python
from cli.log import get_logger
logger = get_logger(__name__)
```

---

## Frontend (React/Vite)

### Adding a New Page
1. Create `web/src/pages/NewPage.tsx`.
2. Add the page id to `PAGES` in `web/src/lib/router.ts` — that drives the hash
   route, the nav tabs and the command palette entry.
3. Render it in the `ErrorBoundary` switch in `web/src/App.tsx`.
4. Use TanStack Query for data fetching (see `web/src/api/client.ts`).

### Shared frontend state
- `NotificationContext` — toasts and progress.
- `DeploymentContext` — in-flight mule deploys; polls real phases from
  `/api/deployments/`. Do not reintroduce timer-driven progress.
- `ThemeContext` — light/dark/system.
- `UiActionsContext` — opens the shell-owned Add Torrent / Deploy Mule modals.

### Styling
Use **Tailwind CSS**. Avoid inline styles. Use consistent component patterns from `web/src/components/`.

---

## Testing

### Running Tests
```bash
# All tests
uv run pytest tests/ -v

# With coverage
uv run pytest tests/ --cov=cli --cov=api --cov-report=term-missing
```
Use `SMG_LOGGING=false` to suppress log files during test runs.

### Frontend Tests
```bash
cd web
npm run test:run          # vitest
npm run lint              # eslint
npx tsc --noEmit          # types
```
Pure logic lives in `web/src/lib/` precisely so it is testable — the vitest
environment is `node` with no DOM library.

---

## CLI Tool (`smg`)

### Development
Run via `uv`:
```bash
uv run smg --help
```
Commands are defined in `cli/mule_commands.py` and `cli/torrent_commands.py`.

---

## Git & Quality Workflow

### Branch, verify, PR

`main` is protected by the **`CI / CI Gate`** status check, and work lands via
pull request — never by pushing to `main` directly.

1.  **Branch** off `main`:
    ```bash
    git checkout -b area/short-description
    ```
2.  **Verify locally before pushing.** Run what CI runs, not an approximation:
    ```bash
    uv run ruff check api/ cli/ tests/
    uv run pytest tests/ -q
    (cd web && npm ci --ignore-scripts && npx tsc --noEmit && npm run lint \
       && npm run test:run && npm run build)
    docker compose config --quiet
    ```
    For anything touching the mules, Dockerfiles or networking, also build the
    image and run the stack — a passing unit suite is not evidence that a
    container change works.
3.  **Commit and push the branch**, then open a PR.
4.  **CI runs on the PR, not on the branch push.** The orchestrator triggers on
    `pull_request` to `main`, so a branch push alone produces no run. Wait for
    **`CI / CI Gate`** plus the SonarCloud gate to go green.
5.  **Merge with squash**, matching the existing history.

### Quality gates

- **SonarQube:** SonarCloud **Automatic Analysis** runs server-side; there is no
  local `sonar-scanner` and none is needed. The gate is reported on the PR — fix
  BLOCKERS rather than suppressing them, and if a suppression is genuinely
  correct, document the reason (see `.trivyignore` for the pattern).
- **Security CI:** `pip-audit`, `npm audit`, Trivy image + IaC scans and an SBOM.
  Also runs weekly, because advisories appear without the code changing.
- **Known flake:** `Set up Docker Buildx` fails intermittently on an unrelated
  image job. Confirm it is that step in the log before assuming a real finding,
  then `gh run rerun <id> --failed`.

### Verifying a security-relevant change

Unit tests do not prove a container or networking change works. Use the drills
in [SECURITY.md](SECURITY.md#verifying-a-deployment-does-not-leak): bring the
stack up, deploy a real mule, and confirm the kill-switch drops traffic rather
than leaking.
