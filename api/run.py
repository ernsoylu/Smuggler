"""Development server entry point.  Run with: uv run python -m api.run"""

import os

from cli.log import get_logger, log_file_path

log = get_logger(__name__)

if __name__ == "__main__":
    from dotenv import load_dotenv

    # Load .env so SMG_SECRET_KEY / SMG_API_TOKEN are available to the dev server.
    load_dotenv()

    from api.app import create_app

    lf = log_file_path()
    if lf:
        print(f"  Logging  → {lf}")

    # The Werkzeug debugger allows arbitrary code execution via its interactive
    # console. Keep it OFF by default; opt in explicitly with SMG_DEBUG=1 when
    # debugging locally on a trusted machine.
    debug = os.getenv("SMG_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")

    app = create_app()
    log.info("Starting Smuggler API development server on 127.0.0.1:55555 (debug=%s)", debug)
    app.run(host="127.0.0.1", port=55555, debug=debug, use_reloader=False)
