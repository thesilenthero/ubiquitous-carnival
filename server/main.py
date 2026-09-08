"""App assembly — the port of src/server's index.ts.

In production, serves the built SPA and falls back to index.html for client
routing. In dev the Vite server handles the frontend and proxies /api here.
Run: python3 -m uvicorn server.main:app --port 4000
"""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import mirror
from .db import init_schema
from .routers import (
    activity,
    ai,
    applications,
    contacts,
    data,
    discovery,
    next_steps,
    postings,
    suggestions,
)

init_schema()

app = FastAPI(title="Job Tracker API", docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(GZipMiddleware, minimum_size=500)

# No CORS by default. The SPA and the API share an origin — this process serves
# web/dist — and in dev Vite proxies /api server-side, so the browser never
# issues a cross-origin request to this app. Allowing "*" was therefore pure
# exposure the moment the server answered on anything but loopback: it told the
# browser that any page on the internet could read this API's responses, and the
# API has no login in front of it. Opt back in explicitly if a separate front
# end ever needs it: ALLOWED_ORIGINS=http://a.example,http://b.example
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(applications.router, prefix="/api/applications")
app.include_router(contacts.router, prefix="/api/contacts")
app.include_router(suggestions.router, prefix="/api/suggestions")
app.include_router(data.router, prefix="/api")
app.include_router(activity.router, prefix="/api")
app.include_router(next_steps.router, prefix="/api")
app.include_router(postings.router, prefix="/api")
app.include_router(discovery.router, prefix="/api")
app.include_router(ai.router, prefix="/api")


# Every change also lands in the backup mirrors — the synced CSVs and, when
# configured, the Google Sheet (server/mirror.py). Hooked here rather than in
# each handler so a route added later is covered without anyone remembering to
# opt in — the cost of catching the read-only POSTs too is nil, because a mirror
# whose data is unchanged doesn't write.
@app.middleware("http")
async def mirror_backups(request, call_next):
    response = await call_next(request)
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and request.url.path.startswith("/api")
        and response.status_code < 400
    ):
        mirror.request_export()
    return response


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
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "4000")))
