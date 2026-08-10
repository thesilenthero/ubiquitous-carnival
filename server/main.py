"""App assembly — the port of src/server's index.ts.

In production, serves the built SPA and falls back to index.html for client
routing. In dev the Vite server handles the frontend and proxies /api here.
Run: python3 -m uvicorn server.main:app --port 4000
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import init_schema
from .routers import (
    ai,
    applications,
    contacts,
    data,
    discovery,
    postings,
    suggestions,
)

init_schema()

app = FastAPI(title="Job Tracker API", docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(applications.router, prefix="/api/applications")
app.include_router(contacts.router, prefix="/api/contacts")
app.include_router(suggestions.router, prefix="/api/suggestions")
app.include_router(data.router, prefix="/api")
app.include_router(postings.router, prefix="/api")
app.include_router(discovery.router, prefix="/api")
app.include_router(ai.router, prefix="/api")

DIST_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"

if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        # API routes are handled above; anything else is the SPA — serve real
        # files (favicon etc.) directly, index.html for client-side routes.
        if full_path.startswith("api"):
            return JSONResponse({"error": "Not found"}, status_code=404)
        candidate = DIST_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")


if __name__ == "__main__":
    import os

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "4000")))
