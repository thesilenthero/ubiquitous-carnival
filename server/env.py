"""Reads .env at the repo root into the environment, before anything looks.

Half a dozen modules configure themselves from `os.environ` at import time —
DB_PATH in db.py, ANTHROPIC_API_KEY in ai.py, GOOGLE_SHEET_ID in sheets_sync.py
— which is fine for the ones that have working defaults and awkward for the ones
that don't: a secret can't have a default, so it had to be exported by hand into
every shell that ran the server. Miss it and the feature is simply off, quietly,
which is exactly how a Sheet mirror stops being a backup.

So: put them in `.env` once and every entry point picks them up — `npm start`,
`npm run dev`, `npm run lan`, and the standalone scripts, including one run from
cron with no profile loaded at all. Called from server/__init__.py, so importing
any part of the package is enough; nothing has to remember to opt in.

A real environment variable always wins over the file. That keeps the one-off
override working — `GOOGLE_SHEET_ID=… npm start` to try a different Sheet — and
means production, where these come from the process manager, is unaffected.

Deliberately not python-dotenv: this is thirty lines of parsing against a
dependency, in a file read once at startup. The format is the common subset —
KEY=value, # comments, optional surrounding quotes, an optional `export ` prefix
so the same file can be `source`d by a shell.

.env holds credentials and is already in .gitignore. Keep it that way.
"""
import os
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def load(path: Path = ENV_PATH) -> None:
    """Apply .env to os.environ. Missing file is the normal case, not an error.

    Never raises: this runs at import, so a stray line in a config file must not
    be able to stop the server from starting. A line that doesn't parse is
    skipped and the rest of the file is still applied.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export ") :].strip()
        if not key:
            continue

        value = value.strip()
        # Quotes are the shell's way of protecting spaces; they aren't part of
        # the value. Only a matched pair, so an apostrophe in a path survives.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]

        # setdefault, not assignment: the real environment wins.
        os.environ.setdefault(key, value)
