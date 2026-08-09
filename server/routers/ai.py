"""AI-assisted routes: read a posting into form fields, score one against the
rubric, and report whether AI is configured at all.

Every route here is read-only with respect to the database. They return drafts;
the existing create/update routes are still the only way anything is written.
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .. import ai, extract, postings

router = APIRouter()


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


# Lets the UI hide the AI buttons instead of offering something that 503s.
@router.get("/ai/status")
def ai_status():
    return {"configured": ai.is_configured(), "model": ai.MODEL if ai.is_configured() else None}


# Turn a posting URL (or pasted posting text) into a draft application.
# Expects { url } or { text }; returns the fields plus the description to keep.
@router.post("/postings/parse")
async def parse_posting(request: Request):
    b = await _body(request)
    url = (b.get("url") or "").strip()
    text = (b.get("text") or "").strip()
    if not url and not text:
        return _err(400, "Provide a posting url or pasted text.")

    source = "pasted"
    hints: dict = {}
    if url:
        try:
            posting = postings.fetch_posting(url)
        except postings.FetchError as e:
            return _err(e.status, e.message)
        text, source, hints = posting.text, posting.source, posting.hints
    else:
        text = text[: postings.MAX_TEXT]

    # Without a key the ATS tiers still deliver title/location/description —
    # degraded, but better than an empty form, so this is a success not a 503.
    if not ai.is_configured():
        return {
            "fields": {**{k: None for k in extract.ExtractedFields.model_fields}, **hints},
            "jobDescription": text,
            "source": source,
            "aiUsed": False,
        }

    try:
        fields = extract.extract_fields(text, hints)
    except ai.AIError as e:
        return _err(e.status, e.message)
    return {
        "fields": fields.model_dump(),
        "jobDescription": text,
        "source": source,
        "aiUsed": True,
    }


# Score a job description against the evaluation rubric. Returns the Evaluation
# shape minus composite/verdict — the client computes those.
@router.post("/evaluations/score")
async def score_evaluation(request: Request):
    b = await _body(request)
    text = (b.get("jobDescription") or "").strip()
    if len(text) < 200:
        return _err(400, "Paste the job description first — there's too little text to score.")
    try:
        return extract.score_posting(
            text[: postings.MAX_TEXT],
            (b.get("company") or "").strip() or None,
            (b.get("roleTitle") or "").strip() or None,
        )
    except ai.AIError as e:
        return _err(e.status, e.message)
