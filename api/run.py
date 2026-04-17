"""Development server entry point.  Run with: uv run python -m api.run"""

from cli.log import get_logger, log_file_path

log = get_logger(__name__)

if __name__ == "__main__":
    from api.app import create_app

    lf = log_file_path()
    if lf:
        print(f"  Logging  → {lf}")

    app = create_app()
    log.info("Starting Smuggler API development server on 127.0.0.1:55555")
    app.run(host="127.0.0.1", port=55555, debug=True, use_reloader=False)
