"""WSGI entrypoint for gunicorn. Usage: gunicorn main:app"""
from api.app import create_app

app = create_app()
