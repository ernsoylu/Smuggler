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
2. Register the route in `web/src/App.tsx`.
3. Use TanStack Query for data fetching (see `web/src/api/client.ts`).

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
Use `DVD_LOGGING=false` to suppress log files during test runs.

---

## CLI Tool (`smg`)

### Development
Run via `uv`:
```bash
uv run smg --help
```
Commands are defined in `cli/mule_commands.py` and `cli/torrent_commands.py`.
