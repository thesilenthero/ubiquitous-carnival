"""Read a job posting into draft application fields — with no model involved.

This is the free counterpart to the dormant `/api/postings/parse` in
`routers/ai.py`. It imports only `server.postings`, which is pure stdlib, so
this route is *structurally* incapable of making a billable API call. That is
the point: the AI autofill was removed over per-token cost, and this route
recovers most of its value at zero marginal cost.

What it can and can't do:

- **Greenhouse, Lever, Ashby, SmartRecruiters URLs** → company, role title,
  location, remote, salary range, and role type, read from those boards' public
  no-auth JSON APIs, plus the full description.
- **Any other URL** → the description text only, scraped from the page HTML.
- **Pasted text** → nothing but the description. Without a model there is
  nothing to read fields out of prose with, so the form stays blank.

`industry` is never inferred; it is the one field that needs a human or a model.
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .. import postings

router = APIRouter()

# Every field the client form knows about, so the response shape is stable
# whether or not the board supplied anything.
FIELD_KEYS = (
    "company",
    "roleTitle",
    "location",
    "workMode",
    "salaryMin",
    "salaryMax",
    "salaryPeriod",
    "industry",
    "roleType",
)


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


@router.post("/postings/fetch")
async def fetch_posting(request: Request):
    """`{url}` or `{text}` → `{fields, jobDescription, source}`."""
    b = await _body(request)
    url = (b.get("url") or "").strip()
    text = (b.get("text") or "").strip()
    if not url and not text:
        return JSONResponse(
            {"error": "Provide a posting url or pasted text."}, status_code=400
        )

    hints: dict = {}
    source = "pasted"
    if url:
        try:
            posting = postings.fetch_posting(url)
        except postings.FetchError as e:
            return JSONResponse({"error": e.message}, status_code=e.status)
        text, source, hints = posting.text, posting.source, posting.hints
    else:
        text = text[: postings.MAX_TEXT]

    return {
        "fields": {
            **{k: None for k in FIELD_KEYS},
            **postings.fields_from_hints(hints),
        },
        "jobDescription": text,
        "source": source,
    }
