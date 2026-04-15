"""Development server entry point.  Run with: uv run python -m api.run"""

from cli.log import get_logger, log_file_path

log = get_logger(__name__)

if __name__ == "__main__":
    from api.app import create_app

    lf = log_file_path()
    if lf:
        print(f"  Logging  → {lf}")

    app = create_app()
    log.info("Starting Flask development server on 0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
