"""Flask application factory."""

from __future__ import annotations

from flask import Flask
from flask_cors import CORS

from cli.log import get_logger, log_file_path
from api.workers import workers_bp
from api.torrents import torrents_bp
from api.stats import stats_bp
from api.settings import settings_bp
from api.configs import configs_bp
from api.database import init_db

log = get_logger(__name__)


def create_app() -> Flask:
    log.info("create_app: initialising Flask application")

    lf = log_file_path()
    if lf:
        log.info("create_app: logging to %s", lf)

    # Initialise SQLite database
    init_db()

    app = Flask(__name__)
    CORS(app)

    app.register_blueprint(workers_bp)
    app.register_blueprint(torrents_bp)
    app.register_blueprint(stats_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(configs_bp)

    @app.errorhandler(404)
    def not_found(e):
        log.warning("404: %s", e)
        return {"error": "Not found"}, 404

    @app.errorhandler(500)
    def internal(e):
        log.error("500: %s", e)
        return {"error": str(e)}, 500

    log.info("create_app: blueprints registered — workers, torrents, stats, settings, configs")
    return app
