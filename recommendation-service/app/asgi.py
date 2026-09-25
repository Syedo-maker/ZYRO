"""Entry point for uvicorn: `uvicorn app.asgi:app --host 127.0.0.1 --port 8001`.

Kept apart from main.py so importing `create_app` in tests does not build a real app (which would
demand the environment variables and open a MongoDB connection)."""
from .main import create_app

app = create_app()
