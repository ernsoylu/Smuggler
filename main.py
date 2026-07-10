"""WSGI entrypoint for gunicorn. Usage: gunicorn main:app"""
from dotenv import load_dotenv

from api.app import create_app

# Load .env before the app factory reads SMG_SECRET_KEY / SMG_API_TOKEN.
load_dotenv()

app = create_app()
