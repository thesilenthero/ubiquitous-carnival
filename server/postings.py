"""Fetch a job posting from a URL and reduce it to text + whatever facts the
source hands us for free.

Two tiers, in order of trust:

1. **ATS APIs** — Greenhouse, Lever, and Ashby all publish their boards as
   public JSON. When the URL matches one, the title/location/description come
   back as structured fields: exact, free, and available with no API key.
2. **Anything else** — fetch the HTML and strip it to text. Nothing is known
   about the fields; the extractor in server/extract.py reads them out.

Either way the caller gets `Posting.text` (the job description) plus `hints`
holding only the fields this tier could establish with certainty. The AI
extractor fills the gaps and never overwrites a hint.
"""
import html
import ipaddress
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

from .domain import classify_role_type

TIMEOUT = 15
MAX_BYTES = 3_000_000
# Job descriptions run long; this is well past the longest real posting and
# keeps a pathological page from becoming an enormous prompt.
MAX_TEXT = 40_000

# Some boards 403 the default urllib agent.
USER_AGENT = "Mozilla/5.0 (compatible; JobTracker/1.0)"


class FetchError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class Posting:
    text: str
    source: str  # greenhouse | lever | ashby | smartrecruiters | html
    # Fields this tier established with certainty. Possible keys, all optional:
    # company, roleTitle, location, remote, salaryMin, salaryMax, roleType.
    # Only `industry` is never inferable from a posting without a model.
    hints: dict = field(default_factory=dict)


# --- Safety ---------------------------------------------------------------


def _assert_public_url(url: str) -> urllib.parse.ParseResult:
    """Only fetch public http(s) hosts.

    The server fetches a URL the user pastes, so it must not be usable to reach
    the loopback interface or a private network behind the app.
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise FetchError("Only http and https URLs can be fetched.")
    if not parsed.hostname:
        raise FetchError("That URL has no host.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        raise FetchError(f"Could not resolve {parsed.hostname}.")
    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
        ):
            raise FetchError("That URL points at a private address.")
    return parsed


def _get(url: str) -> bytes:
    _assert_public_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read(MAX_BYTES)
    except urllib.error.HTTPError as e:
        raise FetchError(f"The posting URL returned HTTP {e.code}.", status=422)
    except urllib.error.URLError as e:
        raise FetchError(f"Could not fetch that URL: {e.reason}.", status=422)
    except TimeoutError:
        raise FetchError("Fetching that URL timed out.", status=422)


def _get_json(url: str):
    try:
        return json.loads(_get(url).decode("utf-8", "replace"))
    except json.JSONDecodeError:
        raise FetchError("The job board returned something that wasn't JSON.", status=422)


# --- HTML → text ----------------------------------------------------------

_BLOCK_END = re.compile(
    r"</(p|div|li|tr|h[1-6]|section|article|ul|ol)>|<br\s*/?>", re.I
)
_DROP = re.compile(r"<(script|style|noscript|svg)\b.*?</\1>", re.I | re.S)
_TAG = re.compile(r"<[^>]+>")


def html_to_text(markup: str) -> str:
    """Strip markup to readable text, preserving block boundaries as newlines.

    Deliberately simple: the output is read by a language model and by a human
    in a textarea, neither of which needs a faithful DOM.
    """
    text = _DROP.sub(" ", markup)
    text = _BLOCK_END.sub("\n", text)
    text = _TAG.sub(" ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:MAX_TEXT]


# --- Salary normalisation -------------------------------------------------


def _money(value) -> Optional[int]:
    """Coerce an ATS compensation figure to whole annual units, or None.

    Boards are inconsistent: some send `140000`, some `"140000"`, some
    `"$140,000"`, and some send minor units (`14000000` = $140,000). Anything
    that doesn't look like a plausible annual salary is dropped rather than
    guessed at — a wrong number in the salary column is worse than a blank one.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        digits = re.sub(r"[^\d.]", "", value)
        if not digits:
            return None
        try:
            value = float(digits)
        except ValueError:
            return None
    if not isinstance(value, (int, float)):
        return None
    n = int(value)
    # Minor units: some boards send cents. Only convert above a threshold no
    # real salary reaches, so a genuine high salary ($1.2M) isn't mangled into
    # $12,000 — and only keep the result if it lands in a plausible band.
    if n >= 2_000_000:
        cents = n // 100
        if 10_000 <= cents <= 2_000_000:
            return cents
        return None
    # Below a plausible annual floor this is an hourly or daily rate.
    return n if 10_000 <= n <= 2_000_000 else None


def _salary_hints(lo, hi) -> dict:
    out = {}
    lo, hi = _money(lo), _money(hi)
    if lo is not None:
        out["salaryMin"] = lo
    if hi is not None:
        out["salaryMax"] = hi
    return out


# --- ATS fast paths -------------------------------------------------------

_GREENHOUSE = re.compile(
    r"^(?:boards|job-boards)\.greenhouse\.io$|^(?:boards|job-boards)\.eu\.greenhouse\.io$", re.I
)


def _try_greenhouse(parsed: urllib.parse.ParseResult):
    if not parsed.hostname or not _GREENHOUSE.match(parsed.hostname):
        return None
    m = re.match(r"^/([^/]+)/jobs/(\d+)", parsed.path)
    if not m:
        return None
    board, job_id = m.group(1), m.group(2)
    job = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job_id}")
    hints = {}
    if job.get("title"):
        hints["roleTitle"] = job["title"]
    location = (job.get("location") or {}).get("name")
    if location:
        hints["location"] = location
    # The board endpoint carries the real company name; the URL slug is only a
    # handle ("acmecorp" vs "Acme Corp"), so it is worth the extra request.
    try:
        board_meta = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{board}")
        if board_meta.get("name"):
            hints["company"] = board_meta["name"]
    except FetchError:
        pass
    # Greenhouse returns `content` as entity-escaped HTML ("&lt;p&gt;..."), so
    # it has to be unescaped once before the markup means anything to a stripper.
    content = html.unescape(job.get("content") or "")
    return Posting(html_to_text(content), "greenhouse", hints)


def _try_lever(parsed: urllib.parse.ParseResult):
    if not parsed.hostname or parsed.hostname.lower() != "jobs.lever.co":
        return None
    m = re.match(r"^/([^/]+)/([0-9a-f-]{16,})", parsed.path, re.I)
    if not m:
        return None
    company, posting_id = m.group(1), m.group(2)
    job = _get_json(f"https://api.lever.co/v0/postings/{company}/{posting_id}")
    categories = job.get("categories") or {}
    hints = {"company": company.replace("-", " ").title()}
    if job.get("text"):
        hints["roleTitle"] = job["text"]
    if categories.get("location"):
        hints["location"] = categories["location"]
    if str(job.get("workplaceType") or "").lower() == "remote":
        hints["remote"] = True
    # Lever exposes an optional structured salary range on the category block.
    salary = job.get("salaryRange") or {}
    hints.update(_salary_hints(salary.get("min"), salary.get("max")))
    body = job.get("descriptionPlain") or html_to_text(job.get("description") or "")
    extras = "\n\n".join(
        f"{lst.get('text', '')}\n{html_to_text(lst.get('content') or '')}"
        for lst in (job.get("lists") or [])
    )
    tail = job.get("additionalPlain") or ""
    text = "\n\n".join(p for p in (body, extras, tail) if p.strip())
    return Posting(text[:MAX_TEXT], "lever", hints)


def _try_ashby(parsed: urllib.parse.ParseResult):
    if not parsed.hostname or parsed.hostname.lower() != "jobs.ashbyhq.com":
        return None
    m = re.match(r"^/([^/]+)/([0-9a-f-]{16,})", parsed.path, re.I)
    if not m:
        return None
    board, job_id = m.group(1), m.group(2)
    # Ashby publishes the whole board rather than a per-job endpoint.
    payload = _get_json(
        f"https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true"
    )
    job = next(
        (j for j in (payload.get("jobs") or []) if j.get("id") == job_id), None
    )
    if job is None:
        return None
    hints = {"company": job.get("companyName") or board.replace("-", " ").title()}
    if job.get("title"):
        hints["roleTitle"] = job["title"]
    if job.get("location"):
        hints["location"] = job["location"]
    if job.get("isRemote") is not None:
        hints["remote"] = bool(job["isRemote"])
    # The board is already fetched with ?includeCompensation=true — read it.
    comp = job.get("compensation") or {}
    summary = comp.get("summaryComponents") or comp.get("components") or []
    salary = next(
        (c for c in summary if str(c.get("compensationType", "")).lower() == "salary"),
        summary[0] if summary else {},
    )
    hints.update(_salary_hints(salary.get("minValue"), salary.get("maxValue")))
    text = job.get("descriptionPlain") or html_to_text(job.get("descriptionHtml") or "")
    return Posting(text[:MAX_TEXT], "ashby", hints)


def _try_smartrecruiters(parsed: urllib.parse.ParseResult):
    """SmartRecruiters — the richest of the public ATS APIs.

    Unlike the others it has a real per-job endpoint, and its location block
    carries explicit `remote` / `hybrid` booleans rather than leaving remoteness
    to be inferred from prose.
    """
    if not parsed.hostname or parsed.hostname.lower() != "jobs.smartrecruiters.com":
        return None
    # /{Company}/{numericId}-{slugified-title}
    m = re.match(r"^/([^/]+)/(\d+)", parsed.path)
    if not m:
        return None
    company, job_id = m.group(1), m.group(2)
    job = _get_json(
        f"https://api.smartrecruiters.com/v1/companies/{company}/postings/{job_id}"
    )
    hints = {"company": (job.get("company") or {}).get("name") or company}
    if job.get("name"):
        hints["roleTitle"] = job["name"]

    loc = job.get("location") or {}
    where = ", ".join(
        p for p in (loc.get("city"), loc.get("region"), loc.get("country")) if p
    )
    if where:
        hints["location"] = where
    if loc.get("remote") is not None:
        hints["remote"] = bool(loc["remote"])

    comp = (job.get("compensation") or {})
    hints.update(_salary_hints(comp.get("min"), comp.get("max")))

    # The description lives in jobAd.sections: a dict of {title, text} blocks.
    sections = ((job.get("jobAd") or {}).get("sections")) or {}
    parts = []
    for key in ("companyDescription", "jobDescription", "qualifications", "additionalInformation"):
        block = sections.get(key) or {}
        chunk = html_to_text(block.get("text") or "")
        if chunk:
            parts.append(chunk)
    return Posting("\n\n".join(parts)[:MAX_TEXT], "smartrecruiters", hints)


_WORKDAY = re.compile(r"^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$", re.I)


def _try_workday(parsed: urllib.parse.ParseResult):
    """Workday — what large institutional employers (banks, insurers, telecoms,
    pensions, crown corps) almost all use.

    Unlike the other ATSes there is no single API host: every tenant gets its
    own `{tenant}.wd{N}.myworkdayjobs.com`, and each careers site has its own
    slug. Both are recoverable from the posting URL:

        https://omers.wd3.myworkdayjobs.com/en-US/OMERS_External/job/Toronto-Ontario/Some-Role_JR-8205
               └tenant┘ └wd┘                └locale┘└──site───┘└──────── externalPath ────────────┘

    The locale segment is optional, which is why it is detected rather than
    assumed. The CXS endpoint mirrors that path exactly.
    """
    host = _WORKDAY.match(parsed.hostname or "")
    if not host:
        return None
    tenant, wd = host.group(1), host.group(2)

    segments = [s for s in parsed.path.split("/") if s]
    # Drop a leading locale like "en-US" / "en" if present.
    if segments and re.fullmatch(r"[a-z]{2}(-[A-Za-z]{2})?", segments[0]):
        segments = segments[1:]
    if len(segments) < 2 or segments[1] != "job":
        return None
    site = segments[0]
    external_path = "/" + "/".join(segments[1:])

    base = f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"
    payload = _get_json(f"{base}{external_path}")
    info = payload.get("jobPostingInfo") or {}
    if not info:
        return None

    company = (payload.get("hiringOrganization") or {}).get("name") or tenant.title()
    hints = {"company": company}
    if info.get("title"):
        hints["roleTitle"] = info["title"]
    if info.get("location"):
        hints["location"] = info["location"]
    if info.get("remoteType"):
        hints["remote"] = "remote" in str(info["remoteType"]).lower()

    text = html_to_text(info.get("jobDescription") or "")
    return Posting(text[:MAX_TEXT], "workday", hints)


_ATS_HANDLERS = (
    _try_greenhouse,
    _try_lever,
    _try_ashby,
    _try_smartrecruiters,
    _try_workday,
)


# --- Board listing --------------------------------------------------------
#
# `fetch_posting` reads one posting; the functions below list a whole company
# board so new postings can be discovered. Same endpoints, collection form.
# Everything goes through `_get_json`, so `_assert_public_url` still applies.

# Bound the work one board can cause. Bosch alone publishes ~4,700 openings;
# without a cap a single refresh could issue dozens of requests and hang.
#
# Page size is per-ATS because Workday rejects anything above 20 with a bare
# HTTP 400 (no message). Max pages is tuned so each board tops out around the
# same number of postings despite the different page sizes.
PAGING = {
    "workday": (20, 15),
    "smartrecruiters": (100, 5),
}
DEFAULT_PAGING = (100, 5)


def _post_json(url: str, payload: dict):
    """POST + JSON decode. Workday's list endpoint is the only POST here."""
    _assert_public_url(url)
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read(MAX_BYTES).decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise FetchError(f"The job board returned HTTP {e.code}.", status=422)
    except urllib.error.URLError as e:
        raise FetchError(f"Could not reach the job board: {e.reason}.", status=422)
    except json.JSONDecodeError:
        raise FetchError("The job board returned something that wasn't JSON.", status=422)


def _list_workday(board: dict, term: str) -> list[dict]:
    host, tenant, site = board["host"], board["slug"], board["site"]
    base = f"https://{host}/wday/cxs/{tenant}/{site}"
    size, max_pages = PAGING["workday"]
    out = []
    # Workday reports `total` on the FIRST page only; every later page returns
    # total: 0. Comparing against it each time broke the loop after two pages
    # and silently truncated every board to 40 postings, so it is captured once.
    total = None
    for page in range(max_pages):
        data = _post_json(
            f"{base}/jobs",
            {
                "appliedFacets": {},
                "limit": size,
                "offset": page * size,
                "searchText": term,
            },
        )
        if total is None:
            total = data.get("total") or 0
        batch = data.get("jobPostings") or []
        for j in batch:
            path = j.get("externalPath") or ""
            out.append(
                {
                    "externalId": path or j.get("title"),
                    "jobUrl": f"https://{host}/en-US/{site}{path}",
                    "roleTitle": j.get("title"),
                    "location": j.get("locationsText"),
                    # Workday words this as prose ("Posted 2 Days Ago"), so it
                    # is kept verbatim for display rather than parsed to a date.
                    "postedAt": j.get("postedOn"),
                }
            )
        if len(batch) < size or (total and len(out) >= total):
            break
    return out


def _list_smartrecruiters(board: dict, term: str) -> list[dict]:
    company = board["slug"]
    size, max_pages = PAGING["smartrecruiters"]
    out = []
    for page in range(max_pages):
        # `q` narrows server-side but matches loosely (a "data analyst" query on
        # Bosch still returns ~1,000), so the keyword filter in discovery.py
        # remains the authoritative one.
        qs = urllib.parse.urlencode(
            {"limit": size, "offset": page * size, **({"q": term} if term else {})}
        )
        data = _get_json(
            f"https://api.smartrecruiters.com/v1/companies/{company}/postings?{qs}"
        )
        batch = data.get("content") or []
        for j in batch:
            loc = j.get("location") or {}
            where = ", ".join(
                p for p in (loc.get("city"), loc.get("region"), loc.get("country")) if p
            )
            out.append(
                {
                    "externalId": str(j.get("id")),
                    "jobUrl": f"https://jobs.smartrecruiters.com/{company}/{j.get('id')}",
                    "roleTitle": j.get("name"),
                    "location": where or None,
                    "remote": loc.get("remote"),
                    "postedAt": j.get("releasedDate"),
                }
            )
        if len(batch) < size:
            break
    return out


def _list_greenhouse(board: dict, term: str) -> list[dict]:
    slug = board["slug"]
    data = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    return [
        {
            "externalId": str(j.get("id")),
            "jobUrl": j.get("absolute_url"),
            "roleTitle": j.get("title"),
            "location": (j.get("location") or {}).get("name"),
            "postedAt": j.get("updated_at"),
        }
        for j in (data.get("jobs") or [])
    ]


def _list_lever(board: dict, term: str) -> list[dict]:
    slug = board["slug"]
    data = _get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    out = []
    for j in data if isinstance(data, list) else []:
        cats = j.get("categories") or {}
        salary = j.get("salaryRange") or {}
        out.append(
            {
                "externalId": str(j.get("id")),
                "jobUrl": j.get("hostedUrl"),
                "roleTitle": j.get("text"),
                "location": cats.get("location"),
                "postedAt": j.get("createdAt"),
                **_salary_hints(salary.get("min"), salary.get("max")),
            }
        )
    return out


def _list_ashby(board: dict, term: str) -> list[dict]:
    slug = board["slug"]
    data = _get_json(
        f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"
    )
    return [
        {
            "externalId": str(j.get("id")),
            "jobUrl": j.get("jobUrl"),
            "roleTitle": j.get("title"),
            "location": j.get("location"),
            "remote": j.get("isRemote"),
            "postedAt": j.get("publishedAt"),
        }
        for j in (data.get("jobs") or [])
    ]


_LISTERS = {
    "workday": _list_workday,
    "smartrecruiters": _list_smartrecruiters,
    "greenhouse": _list_greenhouse,
    "lever": _list_lever,
    "ashby": _list_ashby,
}

# Workday and SmartRecruiters run a real search over the whole posting — the
# same engine their careers sites use. The rest have no search parameter at all,
# so their boards are fetched whole and matched on title here.
SEARCHABLE = {"workday", "smartrecruiters"}

# Ceiling on stored postings per board, whichever strategy is used. A broad
# keyword set across a huge employer should degrade to "a lot" and not "all".
MAX_PER_BOARD = 400


def _title_matches(title: str, terms: list[str]) -> bool:
    low = title.lower()
    return any(t in low for t in terms)


def list_board(board: dict, keywords: str = "") -> list[dict]:
    """List a board's open postings, already narrowed by `keywords`.

    Filtering lives here rather than in the caller because *how* to narrow is
    ATS knowledge:

    - **Searchable boards** (Workday, SmartRecruiters) are queried once per
      keyword and the results unioned. Their search covers the whole posting,
      so the results are NOT re-filtered on title afterwards — doing that was a
      bug that threw away most of what the board correctly matched (a CIBC
      search for "analytics" returns 41 roles, of which only 6 carry the word
      in their title; "Senior Analyst, Data & Reporting" is a real hit).
    - **Everything else** has no search parameter, so the whole board is
      fetched and matched on title. That is all their list endpoints expose.

    Returns dicts with externalId / jobUrl / roleTitle and optionally location,
    remote, salaryMin, salaryMax, postedAt, plus a derived roleType.
    """
    ats = board.get("ats")
    lister = _LISTERS.get(ats)
    if lister is None:
        raise FetchError(f"Unsupported board type: {ats}", status=400)

    terms = [k.strip().lower() for k in (keywords or "").split(",") if k.strip()]

    if ats in SEARCHABLE and terms:
        rows, seen = [], set()
        for term in terms:
            for r in lister(board, term):
                key = r.get("externalId")
                if key and key not in seen:
                    seen.add(key)
                    rows.append(r)
            if len(rows) >= MAX_PER_BOARD:
                break
    else:
        rows = lister(board, "")
        if terms:
            rows = [r for r in rows if _title_matches(r.get("roleTitle") or "", terms)]

    out = []
    for r in rows[:MAX_PER_BOARD]:
        if not r.get("roleTitle") or not r.get("jobUrl") or not r.get("externalId"):
            continue
        r["roleType"] = classify_role_type(r["roleTitle"])
        out.append(r)
    return out


def parse_board_url(url: str) -> dict:
    """Derive a board record from a pasted careers URL.

    Reuses the same host matchers the per-posting handlers use, so all URL
    knowledge lives in this module.
    """
    parsed = _assert_public_url(url)
    host = (parsed.hostname or "").lower()
    segments = [s for s in parsed.path.split("/") if s]

    wd = _WORKDAY.match(host)
    if wd:
        # /{locale?}/{site}
        segs = list(segments)
        if segs and re.fullmatch(r"[a-z]{2}(-[A-Za-z]{2})?", segs[0]):
            segs = segs[1:]
        if not segs:
            raise FetchError(
                "That Workday URL is missing its careers-site segment "
                "(e.g. …/en-US/OMERS_External)."
            )
        return {
            "ats": "workday",
            "host": parsed.hostname,
            "slug": wd.group(1),
            "site": segs[0],
            "company": wd.group(1).replace("-", " ").title(),
        }

    simple = None
    if _GREENHOUSE.match(host):
        simple = "greenhouse"
    elif host == "jobs.lever.co":
        simple = "lever"
    elif host == "jobs.ashbyhq.com":
        simple = "ashby"
    elif host in ("jobs.smartrecruiters.com", "careers.smartrecruiters.com"):
        simple = "smartrecruiters"

    if simple and segments:
        return {
            "ats": simple,
            "host": None,
            "slug": segments[0],
            "site": None,
            "company": segments[0].replace("-", " ").title(),
        }

    raise FetchError(
        "That doesn't look like a Workday, Greenhouse, Lever, Ashby, or "
        "SmartRecruiters board URL."
    )


def fetch_posting(url: str) -> Posting:
    """Fetch a posting URL, preferring an ATS API when one covers it."""
    parsed = _assert_public_url(url)
    for handler in _ATS_HANDLERS:
        posting = handler(parsed)
        if posting is not None and posting.text.strip():
            # Derived centrally so every ATS benefits: role type is pure regex
            # over the title (server/domain.py), so it costs nothing.
            title = posting.hints.get("roleTitle")
            if title and "roleType" not in posting.hints:
                posting.hints["roleType"] = classify_role_type(title)
            return posting
    markup = _get(url).decode("utf-8", "replace")
    text = html_to_text(markup)
    if len(text) < 200:
        # Almost always a JS-rendered board (LinkedIn, Indeed) that served a
        # shell page. Say so plainly — the paste path is the fix.
        raise FetchError(
            "That page returned almost no text — it probably renders in the "
            "browser. Copy the posting text and paste it instead.",
            status=422,
        )
    return Posting(text, "html", {})
