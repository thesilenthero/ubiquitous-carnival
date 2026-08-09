"""Anthropic client wrapper — the single place the app talks to Claude.

Everything AI-assisted in this app is *suggest-only*: extraction fills a form
the user still edits, scoring fills sliders the user still moves. Nothing here
writes to the database. That mirrors the suggestions inbox (see
server/suggestions.py): the model proposes, the human accepts.

The API key comes from ANTHROPIC_API_KEY. When it is missing every AI route
returns 503 and the UI hides the buttons — the app is fully usable without it.
"""
import os
from typing import Optional, TypeVar

from pydantic import BaseModel, ValidationError

# The model is deliberately not configurable per-request: one model, one place
# to change it. Override with ANTHROPIC_MODEL if you want to A/B another.
MODEL = os.environ.get("ANTHROPIC_MODEL") or "claude-opus-5"

T = TypeVar("T", bound=BaseModel)


class AIError(Exception):
    """Anything that stops us returning a parsed result. The routers turn this
    into a 4xx/5xx with the message shown verbatim in the UI."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


def is_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic  # imported lazily so the app runs without the package

        _client = anthropic.Anthropic()
    return _client


def parse_into(
    schema: type[T],
    system: str,
    prompt: str,
    *,
    effort: str = "medium",
    max_tokens: int = 8000,
) -> T:
    """One structured-output call: prompt in, validated Pydantic model out.

    Structured outputs guarantee the response matches `schema`, so callers never
    hand-parse JSON or defend against a stray prose preamble.
    """
    if not is_configured():
        raise AIError(
            "AI features need an ANTHROPIC_API_KEY in the environment.", status=503
        )

    import anthropic

    try:
        response = _get_client().messages.parse(
            model=MODEL,
            max_tokens=max_tokens,
            # Adaptive thinking is the default on this model; effort is the knob
            # that trades depth against latency. Extraction is mechanical (low),
            # rubric scoring is judgement (high).
            output_config={"effort": effort},
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_format=schema,
        )
    except anthropic.AuthenticationError:
        raise AIError("ANTHROPIC_API_KEY was rejected.", status=502)
    except anthropic.RateLimitError:
        raise AIError("Rate limited by the Anthropic API — try again shortly.", status=503)
    except anthropic.APIConnectionError:
        raise AIError("Could not reach the Anthropic API.", status=503)
    except anthropic.APIStatusError as e:
        raise AIError(f"Anthropic API error ({e.status_code}).", status=502)
    except ValidationError:
        # The response didn't fit the schema. Structured outputs make this rare,
        # but the SDK's schema transform does not enforce every constraint
        # (notably enums, which it demotes to a description), so it is reachable
        # — and a bare 500 with a stack trace is not a useful answer.
        raise AIError(
            "The model's response didn't match the expected shape. Try again.",
            status=502,
        )

    # A safety decline returns HTTP 200 with empty/partial content, so this has
    # to be checked before touching the parsed output.
    if response.stop_reason == "refusal":
        raise AIError("The model declined to process this posting.", status=422)
    if response.stop_reason == "max_tokens":
        raise AIError("The posting was too long to process — trim it and retry.", status=422)

    parsed: Optional[T] = response.parsed_output
    if parsed is None:
        raise AIError("The model returned no usable result.", status=502)
    return parsed
