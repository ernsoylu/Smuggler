"""Flask application factory."""

from __future__ import annotations

import hmac
import os

from flask import Flask, request
from flask_cors import CORS

from cli.log import get_logger, log_file_path
from api.crypto import encryption_enabled
from api.mules import mules_bp
from api.torrents import torrents_bp
from api.stats import stats_bp
from api.settings import settings_bp
from api.configs import configs_bp
from api.watchdog import watchdog_bp, start_watchdog
from api.database import init_db

log = get_logger(__name__)


def create_app() -> Flask:
    log.info("create_app: initialising Flask application")

    lf = log_file_path()
    if lf:
        log.info("create_app: logging to %s", lf)

    # Initialise SQLite database
    init_db()
    
    # Verify the download directory permissions at startup
    try:
        from api.settings import read_settings
        dl_dir = read_settings().get("download_dir")
        if dl_dir:
            if not os.path.exists(dl_dir):
                os.makedirs(dl_dir, exist_ok=True)
            if not os.access(dl_dir, os.W_OK):
                log.critical("SECURITY/CONFIG: Download directory %s is NOT WRITABLE. Please fix permissions.", dl_dir)
    except Exception:
        log.exception("Failed to verify download_dir at startup")

    app = Flask(__name__)

    # Restrict cross-origin access. In production the frontend is served by nginx
    # and proxies /api same-origin, so CORS is only needed for local dev / the
    # desktop client. Override with SMG_CORS_ORIGINS (comma-separated, or "*").
    _origins_env = os.environ.get("SMG_CORS_ORIGINS", "").strip()
    if _origins_env == "*":
        cors_origins: object = "*"
    elif _origins_env:
        cors_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
    else:
        cors_origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8887",
            "http://127.0.0.1:8887",
            "http://localhost",
            "http://127.0.0.1",
        ]
    CORS(app, origins=cors_origins)

    # ── Access control ────────────────────────────────────────────────────────
    # The API holds the Docker socket (host-root equivalent), so it must never be
    # openly reachable. Two layers, both fail-safe for existing local setups:
    #   1. Token auth (opt-in): when SMG_API_TOKEN is set, every /api/* call
    #      (except health + CORS preflight) must carry a matching X-Smuggler-Token.
    #   2. CSRF: state-changing requests carrying a browser Origin that is not in
    #      the allow-list are refused, so a page the user visits cannot drive the
    #      local API. Non-browser clients (desktop, curl) send no Origin and pass.
    if not os.environ.get("SMG_API_TOKEN", "").strip():
        log.warning(
            "SMG_API_TOKEN is not set — API requests are not authenticated. "
            "Keep the API bound to 127.0.0.1 (default) or set SMG_API_TOKEN."
        )

    # Fail loudly at boot rather than on the first VPN config upload, which is
    # where the missing key would otherwise surface as a 503.
    if not encryption_enabled():
        log.critical(
            "SMG_SECRET_KEY is not set — VPN config uploads will be refused. "
            "Run ./setup.sh to generate one, or set SMG_ALLOW_PLAINTEXT_SECRETS=1 "
            "to store secrets unencrypted (not recommended)."
        )

    _MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
    # Exact paths, not a prefix: startswith("/api/health") would also exempt any
    # future route that merely begins with those characters.
    _UNAUTHENTICATED = {"/api/health", "/api/health/"}

    @app.before_request
    def _api_guard():
        if request.method == "OPTIONS" or request.path in _UNAUTHENTICATED:
            return None

        token = os.environ.get("SMG_API_TOKEN", "").strip()
        if token:
            provided = request.headers.get("X-Smuggler-Token", "")
            if not hmac.compare_digest(provided, token):
                # Do not log the request path/method — they are user-controlled
                # and would allow log forging (Sonar S5145).
                log.warning("Rejected API request with missing or invalid token")
                return {"error": "Unauthorized"}, 401

        if request.method in _MUTATING:
            origin = request.headers.get("Origin")
            if origin and cors_origins != "*" and origin not in cors_origins:
                log.warning("Rejected cross-origin state-changing request "
                            "(Origin not allow-listed)")
                return {"error": "Cross-origin request refused"}, 403
        return None

    app.register_blueprint(mules_bp)
    app.register_blueprint(torrents_bp)
    app.register_blueprint(stats_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(configs_bp)
    app.register_blueprint(watchdog_bp)

    @app.route("/api/health/", methods=["GET"])
    def health():
        return {"status": "ok"}, 200

    @app.errorhandler(404)
    def not_found(e):
        log.warning("404: %s", e)
        return {"error": "Not found"}, 404

    @app.errorhandler(500)
    def internal(e):
        # Log the full error server-side but never leak internal exception
        # detail (paths, stack info) to the client.
        log.error("500: %s", e)
        return {"error": "Internal server error"}, 500

    log.info("create_app: blueprints registered — mules, torrents, stats, settings, configs, watchdog")

    # Start the background VPN watchdog (daemon thread — survives app context).
    # start_watchdog() is itself idempotent, which is what actually prevents a
    # second thread; the old WERKZEUG_RUN_MAIN guard read app.debug before
    # app.run() had set it and api/run.py disables the reloader anyway.
    start_watchdog()

    return app
