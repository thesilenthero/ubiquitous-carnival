# Load .env before any submodule reads os.environ at import time. This has to
# happen here, in the package root, because that is the only thing guaranteed to
# run first no matter which entry point you came in through — uvicorn, a script
# in scripts/, or a REPL. See server/env.py.
from . import env as _env

_env.load()
