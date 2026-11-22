import html as html_lib
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# 34 targeted YouTube DIY / home-improvement queries spanning all 10 Trade Categories
CREATOR_SEARCH_SEEDS: List[Tuple[str, str]] = [
    ("diy plumbing repair kitchen sink", "Plumbing & Drain"),
    ("how to fix leaky toilet pipe diy", "Plumbing & Drain"),
    ("bathroom vanity faucet install diy", "Plumbing & Drain"),
    ("diy electrical outlet switch install", "Electrical & Lighting"),
    ("how to install ceiling fan light fixture", "Electrical & Lighting"),
    ("recessed lighting dimmer switch diy", "Electrical & Lighting"),
    ("diy landscaping patio paver build", "Yardwork & Landscaping"),
    ("lawn care yard renovation diy", "Yardwork & Landscaping"),
    ("backyard retaining wall garden bed diy", "Yardwork & Landscaping"),
    ("how to patch drywall mud tape diy", "Painting & Drywall"),
    ("interior room painting tips diy", "Painting & Drywall"),
    ("accent wall board and batten diy", "Painting & Drywall"),
    ("diy fence gate deck build", "Carpentry, Doors & Windows"),
    ("how to install door trim baseboard", "Carpentry, Doors & Windows"),
    ("woodworking cabinet built in diy", "Carpentry, Doors & Windows"),
    ("basement framing door hang diy canada", "Carpentry, Doors & Windows"),
    ("how to mount tv drywall studs", "Mounting & Furniture Assembly"),
    ("ikea furniture built in hack diy", "Mounting & Furniture Assembly"),
    ("closet organizer floating shelves diy", "Mounting & Furniture Assembly"),
    ("diy gutter cleaning roof shingle repair", "Roofing, Siding & Gutters"),
    ("pressure washing siding exterior diy", "Roofing, Siding & Gutters"),
    ("window caulking weatherstripping exterior diy", "Roofing, Siding & Gutters"),
    ("diy bathroom tile shower backsplash", "Flooring & Tile"),
    ("how to install lvp vinyl plank flooring", "Flooring & Tile"),
    ("hardwood stair treads tile grout diy", "Flooring & Tile"),
    ("diy hvac furnace thermostat repair", "Appliance & HVAC Repair"),
    ("how to fix dishwasher washer dryer", "Appliance & HVAC Repair"),
    ("mini split heat pump filter clean diy", "Appliance & HVAC Repair"),
    ("handyman home repair tips tricks", "General Handyman & Odd Jobs"),
    ("home renovation diy creator", "General Handyman & Odd Jobs"),
    ("diy homeowner garage workshop tour", "General Handyman & Odd Jobs"),
    ("pinterest diy home makeover budget renovation", "General Handyman & Odd Jobs"),
    ("canadian home renovation diy channel", "General Handyman & Odd Jobs"),
    ("kitchen cabinet makeover budget diy", "Painting & Drywall"),
]

BLUESKY_SEARCH_SEEDS: List[Tuple[str, str]] = [
    ("handyman home repair", "General Handyman & Odd Jobs"),
    ("diy home renovation", "General Handyman & Odd Jobs"),
    ("woodworking carpentry", "Carpentry, Doors & Windows"),
    ("diy plumbing electrician", "Plumbing & Drain"),
    ("landscaping gardening diy", "Yardwork & Landscaping"),
    ("drywall painting tiling", "Painting & Drywall"),
]

_EXCLUDED_CREATOR_SLUGS = (
    "homedepot", "thehomedepot", "lowes", "menards", "acehardware", "rona",
    "canadiantire", "walmart", "ikea", "wayfair", "hgtv", "thisoldhouse",
    "5minutecrafts", "5-minute", "5minuterepair", "brightside", "techzone",
    "milwaukeetool", "dewalttv", "ryobitools", "makitatools", "harborfreight",
    "boschtools", "familyhandyman", "bobvila", "mrhandyman", "rotorooter",
    "9news", "abcnews", "cbsnews", "nbcnews", "foxnews", "cnn", "bbcnews",
    "globalnews", "cbcnews", "ctvnews", "news12", "howtobasic",
)

_NON_TARGET_COUNTRIES = {
    "india", "pakistan", "bangladesh", "indonesia", "vietnam", "philippines",
    "nigeria", "brazil", "russia", "ukraine", "egypt", "morocco", "turkey",
    "mexico", "colombia", "argentina", "peru", "thailand", "malaysia",
}

_EMAIL_RE = re.compile(r"\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,10})\b")
_BAD_EMAIL_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js",
    ".woff", ".woff2", ".ttf", ".ico", ".mp4", ".mp3", ".pdf", ".json",
)
_BAD_EMAIL_DOMAINS = (
    # Social & link-in-bio platforms
    "youtube.com", "google.com", "gstatic.com", "linktr.ee", "beacons.ai",
    "stan.store", "hoo.be", "campsite.bio", "bio.site", "lnk.bio", "carrd.co",
    "komi.io", "solo.to", "taplink.cc", "instagram.com", "facebook.com",
    "tiktok.com", "twitter.com", "x.com", "twitch.tv", "bsky.app",
    "pinterest.com", "pinterest.ca", "threads.net", "threads.com",
    "linkedin.com", "reddit.com",
    # Website builders, hosting, CMS, analytics, cookie/legal, music & SaaS platforms
    "wix.com", "wixpress.com", "squarespace.com", "shopify.com", "shopify.ca",
    "myshopify.com", "wordpress.org", "wordpress.com", "wpengine.com",
    "elementor.com", "godaddy.com", "bluehost.com", "cloudflare.com",
    "webflow.com", "weebly.com", "ghost.org", "ghost.io", "kajabi.com",
    "teachable.com", "gumroad.com", "skool.com", "getjobber.com",
    "creator-spring.com", "teespring.com", "bonfire.com", "fourthwall.com",
    "redbubble.com", "etsy.com", "shopltk.com", "liketk.it", "shopmy.us",
    "patreon.com", "substack.com", "sentry.io", "mailchimp.com",
    "convertkit.com", "kit.com", "beehiiv.com", "hubspot.com", "calendly.com",
    "stripe.com", "paypal.com", "zendesk.com", "intercom.io", "termly.io",
    "iubenda.com", "cookiebot.com", "onetrust.com", "epidemicsound.com",
    "artlist.io", "musicbed.com", "soundstripe.com", "canva.com", "adobe.com",
    "gravatar.com", "schema.org", "w3.org", "amazonaws.com", "mutiny.app",
    # Major hardware/tool/retail sponsor brands & affiliate networks (never creator personal contact)
    "homedepot.com", "lowes.com", "menards.com", "acehardware.com",
    "walmart.com", "ikea.com", "wayfair.com", "milwaukeetool.com",
    "dewalt.com", "ryobitools.com", "makitatools.com", "boschtools.com",
    "harborfreight.com", "ridgid.com", "craftsman.com", "kleintools.com",
    "sherwin-williams.com", "benjaminmoore.com", "behr.com",
    "hvacdirect.com", "gopjn.com", "pjatr.com", "pjtra.com", "pntra.com",
    "pntrac.com", "avantlink.com", "shareasale.com", "awin1.com", "howl.me",
    "sjv.io", "pxf.io", "dpbolvw.net", "tkqlhce.com", "jdoqocy.com",
    "anrdoezrs.net",
    # Placeholders
    "example.com", "example.org", "domain.com", "email.com",
    "yourdomain.com", "yoursite.com", "company.com", "test.com", "localhost",
)

_BAD_EMAIL_LOCAL_PARTS = {
    "noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon",
    "postmaster", "webmaster", "hostmaster", "abuse", "dmca", "privacy",
    "dataprotection", "gdpr", "security", "legal", "copyright",
    "accessibility", "unsubscribe", "notifications", "alerts", "billing",
    "accounts", "careers", "jobs", "hr", "spam", "root", "admin",
    "wordpress", "test", "user", "name", "yourname", "you", "email",
    "someone", "example", "sample", "filler", "placeholder",
}

_PERSONAL_EMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "yahoo.ca", "outlook.com", "hotmail.com",
    "icloud.com", "me.com", "live.com", "aol.com", "proton.me",
    "protonmail.com", "msn.com", "rogers.com", "shaw.ca", "telus.net",
    "bell.net",
}

_OUTREACH_CONTEXT_RE = re.compile(
    r"\b(business|inquir\w*|collab\w*|partner\w*|sponsor\w*|management|agency|talent|media|booking|press|contact|email|reach|work with)\b",
    re.IGNORECASE,
)
_FALSE_CONTEXT_RE = re.compile(
    r"\b(music by|music license|licensed by|theme by|powered by|built by|designed by|cookie policy|privacy policy|terms of service|terms of use|affiliate program terms)\b",
    re.IGNORECASE,
)

_AFFILIATE_OR_RETAIL_HOSTS = (
    "amazon.", "amzn.", "amzlink.", "geni.us", "homedepot.", "lowes.",
    "shoplowes.", "walmart.", "ikea.", "wayfair.", "kit.co", "rstyle.me",
    "liketk.it", "patreon.com", "buymeacoffee.com", "ko-fi.com", "paypal.",
    "venmo.com", "cash.app", "discord.gg", "discord.com", "youtube.com",
    "youtu.be", "bit.ly", "tinyurl.com", "goo.gl", "twitch.tv",
    "instagram.com", "tiktok.com", "facebook.com", "fb.com", "twitter.com",
    "x.com", "bsky.app", "pinterest.", "linkedin.com", "threads.net",
    "threads.com", "reddit.com", "creator-spring.com", "teespring.com",
    "bonfire.com", "fourthwall.com", "spreadshop.com", "redbubble.com",
    "etsy.com", "shopltk.com", "shopmy.us", "ltk.app",
    "hvacdirect.com", "gopjn.com", "pjatr.com", "pjtra.com", "pntra.com",
    "pntrac.com", "avantlink.com", "shareasale.com", "awin1.com", "howl.me",
    "sjv.io", "pxf.io", "dpbolvw.net", "tkqlhce.com", "jdoqocy.com",
    "anrdoezrs.net",
)

_LINK_HUB_HOSTS = (
    "linktr.ee", "beacons.ai", "stan.store", "bio.site", "linkin.bio",
    "solo.to", "taplink.cc", "campsite.bio", "hoo.be", "msha.ke",
    "carrd.co", "direct.me", "lnk.bio", "komi.io", "allmylinks.com",
)


def _root_domain(host_or_url: str) -> str:
    s = (host_or_url or "").strip().lower()
    if "://" in s:
        s = (urlparse(s).netloc or "").lower()
    s = s.split(":")[0].lstrip(".")
    if s.startswith("www."):
        s = s[4:]
    parts = [p for p in s.split(".") if p]
    if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "edu", "gov") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return s


def _decode_cfemail(hex_str: str) -> str:
    """Decode Cloudflare [data-cfemail] obfuscated email addresses cleanly."""
    clean = (hex_str or "").strip()
    if len(clean) < 4 or len(clean) % 2 != 0:
        return ""
    try:
        key = int(clean[:2], 16)
        return "".join(chr(int(clean[i:i + 2], 16) ^ key) for i in range(2, len(clean), 2)).strip()
    except Exception:
        return ""


def _is_valid_outreach_email(email_addr: str) -> bool:
    el = (email_addr or "").lower().strip().strip(".,;:<>()[]\"'")
    if "@" not in el or any(el.endswith(ext) for ext in _BAD_EMAIL_EXTENSIONS):
        return False
    local, dom = el.split("@", 1)
    if not local or not dom or "." not in dom or len(local) > 64 or len(el) > 120:
        return False
    if local in _BAD_EMAIL_LOCAL_PARTS or local.startswith(("noreply", "no-reply", "donotreply")):
        return False
    if re.match(r"^\d+x$", local) or re.match(r"^[0-9a-f]{16,}$", local):
        return False
    if any(dom == bad or dom.endswith("." + bad) for bad in _BAD_EMAIL_DOMAINS):
        return False
    return True


def _extract_clean_emails(
    text: str,
    allowed_site_domain: str = "",
    require_context_for_third_party: bool = False,
    explicit_mailto: bool = False,
) -> List[str]:
    """
    Extract verified business/outreach emails while rejecting platform, SaaS,
    sponsor-brand, hex-hash, placeholder, and asset filenames.
    """
    out: List[str] = []
    if not text:
        return out
    unescaped = html_lib.unescape(text)
    cleaned_src = re.sub(r"(?:\\?u003[ce]|\\?u0026|\\?u002f|mailto:)", " ", unescaped, flags=re.IGNORECASE)
    cleaned_src = re.sub(r"\s*(?:\[\s*at\s*\]|\(\s*at\s*\))\s*", "@", cleaned_src, flags=re.IGNORECASE)
    cleaned_src = re.sub(r"\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\))\s*", ".", cleaned_src, flags=re.IGNORECASE)
    allowed_root = _root_domain(allowed_site_domain) if allowed_site_domain else ""

    for m in _EMAIL_RE.finditer(cleaned_src):
        el = m.group(1).lower().strip()
        if not _is_valid_outreach_email(el):
            continue
        dom = el.split("@", 1)[1]
        dom_root = _root_domain(dom)
        if require_context_for_third_party and not explicit_mailto:
            is_own_or_personal = (
                dom in _PERSONAL_EMAIL_DOMAINS
                or dom_root in _PERSONAL_EMAIL_DOMAINS
                or (allowed_root and (dom_root == allowed_root or dom == allowed_root))
            )
            if not is_own_or_personal:
                win_start = max(0, m.start() - 140)
                win_end = min(len(cleaned_src), m.end() + 140)
                window = cleaned_src[win_start:win_end]
                if not _OUTREACH_CONTEXT_RE.search(window) or _FALSE_CONTEXT_RE.search(window):
                    continue
        if el not in out:
            out.append(el)
    return out


def _fetch_text(url: str, timeout: int = 7) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def _parse_subscriber_count(sub_text: str) -> int:
    if not sub_text:
        return 0
    m = re.search(r"([\d.,]+)\s*([KMB])?", sub_text.strip(), re.IGNORECASE)
    if not m:
        return 0
    try:
        num = float(m.group(1).replace(",", ""))
    except ValueError:
        return 0
    suffix = (m.group(2) or "").upper()
    if suffix == "K":
        num *= 1_000
    elif suffix == "M":
        num *= 1_000_000
    elif suffix == "B":
        num *= 1_000_000_000
    return int(round(num))


def _normalize_social_url(raw_url: str, keep_query: bool = False) -> str:
    u = (raw_url or "").strip()
    if not u:
        return ""
    if not u.lower().startswith(("http://", "https://")):
        u = "https://" + u.lstrip("/")
    try:
        p = urlparse(u)
        if not p.netloc:
            return ""
        path = p.path.rstrip("/") or ""
        if not keep_query:
            return f"https://{p.netloc.lower()}{path}"
        return f"https://{p.netloc.lower()}{path}" + (f"?{p.query}" if p.query else "")
    except Exception:
        return ""


def _classify_creator_links(raw_urls: List[str]) -> Dict[str, Any]:
    """Sort discovered external URLs into social profiles, storefronts, link hubs, and personal website."""
    res: Dict[str, Any] = {
        "instagram_url": "",
        "tiktok_url": "",
        "facebook_url": "",
        "x_url": "",
        "bluesky_url": "",
        "pinterest_url": "",
        "threads_url": "",
        "linkedin_url": "",
        "reddit_url": "",
        "amazon_store_url": "",
        "website": "",
        "link_hubs": [],
    }
    for raw in raw_urls:
        norm = _normalize_social_url(raw)
        if not norm:
            continue
        try:
            host = (urlparse(norm).netloc or "").lower()
            path = (urlparse(norm).path or "").strip("/")
        except Exception:
            continue
        low_path = path.lower()
        if not path and any(
            s in host
            for s in (
                "instagram.", "tiktok.", "facebook.", "twitter.", "x.com", "twitch.",
                "pinterest.", "threads.", "linkedin.", "reddit.",
            )
        ):
            continue

        if "instagram.com" in host and not res["instagram_url"]:
            if not any(low_path.startswith(skip) for skip in ("p/", "reel/", "explore/", "accounts/")):
                res["instagram_url"] = norm
        elif "tiktok.com" in host and not res["tiktok_url"]:
            if not low_path.startswith(("discover/", "tag/", "music/")):
                res["tiktok_url"] = norm
        elif ("facebook.com" in host or "fb.com" in host) and not res["facebook_url"]:
            if not any(low_path.startswith(skip) for skip in ("sharer", "share.php", "privacy", "policies")):
                res["facebook_url"] = norm
        elif ("twitter.com" in host or host == "x.com" or host == "www.x.com") and not res["x_url"]:
            if not any(low_path.startswith(skip) for skip in ("intent/", "share", "search")):
                res["x_url"] = norm
        elif "bsky.app" in host and not res["bluesky_url"]:
            res["bluesky_url"] = norm
        elif ("pinterest.com" in host or "pinterest.ca" in host) and not res["pinterest_url"]:
            if not any(low_path.startswith(skip) for skip in ("pin/", "search/", "_/", "ideas/")):
                res["pinterest_url"] = norm
        elif ("threads.net" in host or "threads.com" in host) and not res["threads_url"]:
            if "/post/" not in low_path:
                res["threads_url"] = norm
        elif "linkedin.com" in host and not res["linkedin_url"]:
            if low_path.startswith(("in/", "company/")):
                res["linkedin_url"] = norm
        elif "reddit.com" in host and not res["reddit_url"]:
            if low_path.startswith(("u/", "user/", "r/")) and "/comments/" not in low_path:
                res["reddit_url"] = norm
        elif ("amazon.com" in host or "amazon.ca" in host) and not res["amazon_store_url"]:
            if low_path.startswith(("shop/", "live/")):
                res["amazon_store_url"] = norm
        elif any(hub in host for hub in _LINK_HUB_HOSTS):
            if norm not in res["link_hubs"]:
                res["link_hubs"].append(norm)
        elif not res["website"]:
            if not any(skip in host for skip in _AFFILIATE_OR_RETAIL_HOSTS):
                res["website"] = f"https://{host}" + (f"/{path}" if path and len(path) < 35 else "")
    return res


def _is_excluded_creator(name: str, handle: str) -> bool:
    slug = re.sub(r"[^a-z0-9]", "", f"{name} {handle}".lower())
    return any(ex in slug for ex in _EXCLUDED_CREATOR_SLUGS)


def _search_youtube_seed(query: str, default_category: str) -> List[Dict[str, str]]:
    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
    try:
        html = _fetch_text(url, timeout=9)
    except Exception:
        return []

    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except Exception:
        return []

    found: Dict[str, Dict[str, str]] = {}

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            vr = obj.get("videoRenderer")
            if isinstance(vr, dict):
                runs = (vr.get("ownerText") or {}).get("runs") or []
                if runs:
                    name = (runs[0].get("text") or "").strip()
                    nav_url = (
                        ((runs[0].get("navigationEndpoint") or {}).get("commandMetadata") or {})
                        .get("webCommandMetadata", {})
                        .get("url", "")
                    )
                    if name and nav_url and (nav_url.startswith("/@") or nav_url.startswith("/channel/")):
                        if not _is_excluded_creator(name, nav_url) and nav_url not in found:
                            found[nav_url] = {
                                "nav_url": nav_url,
                                "name": name,
                                "default_category": default_category,
                                "seed_topic": query,
                            }
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for x in obj:
                walk(x)

    walk(data)
    return list(found.values())[:10]


def extract_visible_text_from_html(raw_html: str) -> str:
    """Strip scripts/styles/tags from HTML so geo extraction only scans visible page copy."""
    if not raw_html:
        return ""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(raw_html, "html.parser")
        for tag in soup(["script", "style", "noscript", "svg", "head"]):
            tag.decompose()
        return " ".join(soup.get_text(" ", strip=True).split())[:8000]
    except Exception:
        cleaned = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", raw_html, flags=re.I | re.S)
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        return " ".join(cleaned.split())[:8000]


_SOCIAL_URL_SCAN_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:"
    r"linktr\.ee|beacons\.ai|stan\.store|bio\.site|linkin\.bio|solo\.to|taplink\.cc|"
    r"campsite\.bio|hoo\.be|msha\.ke|carrd\.co|direct\.me|lnk\.bio|komi\.io|allmylinks\.com|"
    r"instagram\.com|tiktok\.com|facebook\.com|fb\.com|twitter\.com|x\.com|bsky\.app|"
    r"pinterest\.com|pinterest\.ca|threads\.net|threads\.com|linkedin\.com|reddit\.com|"
    r"amazon\.com/shop|amazon\.ca/shop|amazon\.com/live|amazon\.ca/live"
    r")/[A-Za-z0-9._/@%+-]+",
    re.IGNORECASE,
)

_ALL_SOCIAL_FIELDS = (
    "instagram_url", "tiktok_url", "facebook_url", "x_url", "bluesky_url",
    "pinterest_url", "threads_url", "linkedin_url", "reddit_url", "amazon_store_url",
)

_CONTACT_NAV_WORDS = (
    "contact", "about", "work-with", "partner", "sponsor", "advertise",
    "media-kit", "mediakit", "collab", "press", "inquiry", "inquiries",
)


def _merge_socials_into(target: Dict[str, Any], raw_urls: List[str]) -> None:
    if not raw_urls:
        return
    extra = _classify_creator_links(raw_urls)
    for k in _ALL_SOCIAL_FIELDS:
        if not target.get(k) and extra.get(k):
            target[k] = extra[k]
    for hub in extra.get("link_hubs") or []:
        if hub not in target.setdefault("link_hubs", []):
            target["link_hubs"].append(hub)
    if not target.get("website") and extra.get("website"):
        target["website"] = extra["website"]


def _parse_html_page_signals(
    raw_html: str,
    page_url: str = "",
    allowed_site_domain: str = "",
    require_context_for_third_party: bool = False,
) -> Tuple[List[str], List[str], str, List[str]]:
    """Extract verified emails (mailto/cfemail/visible text), social URLs, visible text, and same-site contact links."""
    visible_text = extract_visible_text_from_html(raw_html)
    emails: List[str] = []
    social_urls: List[str] = []
    nav_candidates: List[str] = []

    base_root = _root_domain(page_url) if page_url else ""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(raw_html, "html.parser")
        for a in soup.find_all("a", href=True):
            href = (a.get("href") or "").strip()
            low_href = href.lower()
            if low_href.startswith("mailto:"):
                for em in _extract_clean_emails(href, allowed_site_domain=allowed_site_domain, explicit_mailto=True):
                    if em not in emails:
                        emails.append(em)
                continue
            if _SOCIAL_URL_SCAN_RE.search(href):
                social_urls.append(href)
                continue
            if page_url and base_root:
                link_text = (a.get_text(" ", strip=True) or "").lower()
                if any(tok in low_href or tok in link_text for tok in _CONTACT_NAV_WORDS):
                    full_url = urljoin(page_url, href).split("#")[0].rstrip("/")
                    if full_url.startswith(("http://", "https://")) and _root_domain(full_url) == base_root:
                        if full_url not in nav_candidates:
                            nav_candidates.append(full_url)
        for el in soup.select("[data-cfemail]"):
            decoded = _decode_cfemail(el.get("data-cfemail", ""))
            if decoded and _is_valid_outreach_email(decoded) and decoded.lower() not in emails:
                emails.append(decoded.lower())
    except Exception:
        pass

    for em in _extract_clean_emails(
        visible_text,
        allowed_site_domain=allowed_site_domain,
        require_context_for_third_party=require_context_for_third_party,
    ):
        if em not in emails:
            emails.append(em)

    for m_href in re.findall(r'mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,10})', raw_html, re.IGNORECASE):
        if _is_valid_outreach_email(m_href) and m_href.lower() not in emails:
            emails.append(m_href.lower())

    for s_url in _SOCIAL_URL_SCAN_RE.findall(raw_html):
        if s_url not in social_urls:
            social_urls.append(s_url)

    return emails, social_urls, visible_text, nav_candidates


def _extract_page_signals(
    url: str,
    timeout: int = 5,
    allowed_site_domain: str = "",
    require_context_for_third_party: bool = False,
) -> Tuple[List[str], List[str], str]:
    try:
        raw_html = _fetch_text(url, timeout=timeout)
    except Exception:
        return [], [], ""
    emails, social_urls, visible_text, _ = _parse_html_page_signals(
        raw_html,
        page_url=url,
        allowed_site_domain=allowed_site_domain,
        require_context_for_third_party=require_context_for_third_party,
    )
    return emails, social_urls, visible_text


def _extract_links_and_emails_from_url(url: str, timeout: int = 5) -> Tuple[List[str], List[str]]:
    emails, social_urls, _ = _extract_page_signals(url, timeout=timeout, require_context_for_third_party=False)
    return emails, social_urls


def _crawl_creator_website(website_url: str, need_email: bool = True, need_geo: bool = True) -> Tuple[List[str], List[str], str]:
    """
    Crawl creator homepage plus up to 4 verified contact/about/partnership subpages
    to uncover verified business emails, extra social links, and US/Canada location text.
    """
    norm_home = _normalize_social_url(website_url)
    if not norm_home:
        return [], [], ""
    parsed_home = urlparse(norm_home)
    base_root = _root_domain(parsed_home.netloc)
    origin = f"{parsed_home.scheme}://{parsed_home.netloc}"

    emails: List[str] = []
    socials: List[str] = []
    geo_chunks: List[str] = []
    visited = set()

    def _absorb(page_url: str, raw_html: str) -> List[str]:
        pe, ps, pt, pnav = _parse_html_page_signals(
            raw_html,
            page_url=page_url,
            allowed_site_domain=base_root,
            require_context_for_third_party=True,
        )
        for em in pe:
            if em not in emails:
                emails.append(em)
        for su in ps:
            if su not in socials:
                socials.append(su)
        if pt:
            geo_chunks.append(pt)
        return pnav

    nav_links: List[str] = []
    home_key = norm_home.rstrip("/")
    visited.add(home_key)
    try:
        home_html = _fetch_text(norm_home, timeout=5)
        nav_links = _absorb(norm_home, home_html)
    except Exception:
        pass

    if not need_email and geo_chunks and not need_geo:
        return emails, socials, "\n".join(geo_chunks)[:10000]

    fallback_paths = ("/contact", "/contact-us", "/about", "/about-us", "/work-with-me", "/partnerships", "/advertise")
    candidates: List[str] = []
    for cand in list(nav_links) + [origin + p for p in fallback_paths]:
        ckey = cand.rstrip("/")
        if ckey not in visited and ckey not in candidates:
            candidates.append(ckey)

    subpages_checked = 0
    for sub_url in candidates:
        if subpages_checked >= 4 or (emails and not need_geo):
            break
        if emails and geo_chunks:
            break
        visited.add(sub_url)
        subpages_checked += 1
        try:
            sub_html = _fetch_text(sub_url, timeout=4)
            _absorb(sub_url, sub_html)
        except Exception:
            continue

    return emails, socials, "\n".join(geo_chunks)[:10000]


def _fetch_youtube_recent_video_signals(nav_url: str, site_domain: str = "") -> Tuple[List[str], List[str], str]:
    """Check up to 2 recent video descriptions where DIY creators often list business email, PO Box geo & socials."""
    if not nav_url:
        return [], [], ""
    emails: List[str] = []
    social_urls: List[str] = []
    desc_chunks: List[str] = []
    try:
        vhtml = _fetch_text(f"https://www.youtube.com{nav_url}/videos", timeout=6)
    except Exception:
        return [], [], ""

    vid_ids: List[str] = []
    for vid in re.findall(r'"videoId":"([A-Za-z0-9_-]{11})"', vhtml):
        if vid not in vid_ids:
            vid_ids.append(vid)
        if len(vid_ids) >= 2:
            break

    for vid in vid_ids:
        try:
            whtml = _fetch_text(f"https://www.youtube.com/watch?v={vid}", timeout=6)
        except Exception:
            continue
        m = re.search(r'"shortDescription":"((?:\\.|[^"\\])*)"', whtml)
        if not m:
            continue
        try:
            desc = json.loads('"' + m.group(1) + '"')
        except Exception:
            desc = ""
        if not desc:
            continue
        desc_chunks.append(desc[:2500])
        for em in _extract_clean_emails(desc, allowed_site_domain=site_domain, require_context_for_third_party=True):
            if em not in emails:
                emails.append(em)
        for su in _SOCIAL_URL_SCAN_RE.findall(desc):
            if su not in social_urls:
                social_urls.append(su)
        if emails and social_urls:
            break

    return emails, social_urls, "\n".join(desc_chunks)[:5000]


def _fetch_youtube_creator_profile(seed: Dict[str, str]) -> Optional[Dict[str, Any]]:
    nav_url = seed["nav_url"]
    about_url = f"https://www.youtube.com{nav_url}/about"
    try:
        raw_about_html = _fetch_text(about_url, timeout=9)
    except Exception:
        return None

    m = re.search(r"var ytInitialData = (\{.*?\});</script>", raw_about_html)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except Exception:
        return None

    about: Dict[str, Any] = {}

    def find_about(obj: Any) -> None:
        if isinstance(obj, dict):
            if "aboutChannelViewModel" in obj:
                about.update(obj["aboutChannelViewModel"])
            for v in obj.values():
                find_about(v)
        elif isinstance(obj, list):
            for x in obj:
                find_about(x)

    find_about(data)
    if not about:
        return None

    country = (about.get("country") or "").strip()
    if country.lower() in _NON_TARGET_COUNTRIES:
        return None

    sub_text = (about.get("subscriberCountText") or "").strip()
    sub_count = _parse_subscriber_count(sub_text)
    if 0 < sub_count < 1000:
        return None

    desc = (about.get("description") or "").strip()
    # Skip clearly non-Latin scripts in bio/title
    if re.search(r"[\u0900-\u097f\u0600-\u06ff\u0400-\u04ff]", f"{seed['name']} {desc}"):
        return None

    _SPONSOR_LINK_TITLE_RE = re.compile(
        r"(%\s*off|use code|promo code|discount|coupon|sponsor|affiliate)",
        re.IGNORECASE,
    )
    raw_links: List[str] = []
    for l in (about.get("links") or []):
        vm = l.get("channelExternalLinkViewModel") or {}
        url_val = (vm.get("link") or {}).get("content", "")
        title_val = (vm.get("title") or {}).get("content", "")
        if not url_val:
            continue
        if _SPONSOR_LINK_TITLE_RE.search(title_val) and not _SOCIAL_URL_SCAN_RE.match(url_val):
            continue
        raw_links.append(url_val)
    raw_links.extend(_SOCIAL_URL_SCAN_RE.findall(desc))
    socials = _classify_creator_links([u for u in raw_links if u])
    site_domain = _root_domain(socials["website"]) if socials.get("website") else ""
    emails = _extract_clean_emails(desc, allowed_site_domain=site_domain, require_context_for_third_party=False)
    extra_geo_chunks: List[str] = []

    # 1. Hop to Linktree / Beacons / Stan.store / Hoo.be / Campsite hubs
    for hub_url in socials["link_hubs"][:2]:
        hub_emails, hub_socials, hub_text = _extract_page_signals(
            hub_url, timeout=5, allowed_site_domain=site_domain, require_context_for_third_party=False
        )
        if hub_text:
            extra_geo_chunks.append(hub_text)
        for em in hub_emails:
            if em not in emails:
                emails.append(em)
        _merge_socials_into(socials, hub_socials)

    # 2. Check recent YouTube video descriptions when email or social coverage is still thin
    if not emails or not socials.get("website") or not socials.get("pinterest_url"):
        vid_emails, vid_socials, vid_text = _fetch_youtube_recent_video_signals(nav_url, site_domain=site_domain)
        if vid_text:
            extra_geo_chunks.append(vid_text)
        for em in vid_emails:
            if em not in emails:
                emails.append(em)
        _merge_socials_into(socials, vid_socials)
        if not site_domain and socials.get("website"):
            site_domain = _root_domain(socials["website"])

    # 3. Deep crawl personal website (/ + contact/about/work-with-me/partnerships)
    if socials["website"] and (not emails or country in ("", "United States", "Canada")):
        site_emails, site_socials, site_text = _crawl_creator_website(
            socials["website"],
            need_email=not bool(emails),
            need_geo=country in ("", "United States", "Canada"),
        )
        if site_text:
            extra_geo_chunks.append(site_text)
        for em in site_emails:
            if em not in emails:
                emails.append(em)
        _merge_socials_into(socials, site_socials)

    handle = nav_url.lstrip("/")
    slug_id = re.sub(r"[^A-Za-z0-9_-]", "_", handle)
    canonical_yt = f"https://www.youtube.com{nav_url}"

    return {
        "creator_id": f"yt_{slug_id}",
        "name": seed["name"],
        "handle": handle if handle.startswith("@") else f"@{slug_id}",
        "primary_platform": "youtube",
        "profile_url": canonical_yt,
        "country": country,
        "_extra_geo_text": "\n".join(extra_geo_chunks)[:12000],
        "audience_count": sub_count,
        "audience_text": sub_text or (f"{sub_count:,} subscribers" if sub_count else ""),
        "default_category": seed["default_category"],
        "seed_topic": seed["seed_topic"],
        "bio": re.sub(r"\s+", " ", desc)[:600],
        "business_email": ", ".join(emails[:2]),
        "website": socials["website"] or (socials["link_hubs"][0] if socials["link_hubs"] else ""),
        "youtube_url": canonical_yt,
        "instagram_url": socials["instagram_url"],
        "tiktok_url": socials["tiktok_url"],
        "facebook_url": socials["facebook_url"],
        "x_url": socials["x_url"],
        "bluesky_url": socials["bluesky_url"],
        "pinterest_url": socials["pinterest_url"],
        "threads_url": socials["threads_url"],
        "linkedin_url": socials["linkedin_url"],
        "reddit_url": socials["reddit_url"],
        "amazon_store_url": socials["amazon_store_url"],
    }


_DIY_RELEVANCE_RE = re.compile(
    r"\b(diy|handyman|handyperson|plumb\w*|electric\w*|carpentr\w*|woodwork\w*|renovat\w*|remodel\w*|drywall|paint\w*|landscap\w*|roof\w*|tile|tiling|flooring|home repair|home improvement|maker)\b",
    re.IGNORECASE,
)


def _fetch_bluesky_creator(actor: Dict[str, Any], default_category: str, seed_topic: str) -> Optional[Dict[str, Any]]:
    handle = (actor.get("handle") or "").strip()
    name = (actor.get("displayName") or handle).strip()
    bio = (actor.get("description") or "").strip()
    if not handle or _is_excluded_creator(name, handle):
        return None
    if not _DIY_RELEVANCE_RE.search(f"{name} {bio}"):
        return None

    # Fetch public profile metadata to get exact followersCount
    followers = 0
    try:
        prof_raw = _fetch_text(
            f"https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={urllib.parse.quote(handle)}",
            timeout=5,
        )
        prof = json.loads(prof_raw)
        followers = int(prof.get("followersCount") or 0)
    except Exception:
        pass
    if 0 < followers < 250:
        return None

    emails = _extract_clean_emails(bio)
    raw_urls = re.findall(r"https?://[^\s)<\]\"']+", bio, re.IGNORECASE)
    socials = _classify_creator_links(raw_urls)
    extra_geo_chunks: List[str] = []
    for hub_url in socials["link_hubs"][:2]:
        he, hs, ht = _extract_page_signals(hub_url, timeout=4)
        if ht:
            extra_geo_chunks.append(ht)
        for em in he:
            if em not in emails:
                emails.append(em)
        _merge_socials_into(socials, hs)
    if socials["website"] and not emails:
        se, ss, st = _crawl_creator_website(socials["website"], need_email=True, need_geo=True)
        if st:
            extra_geo_chunks.append(st)
        for em in se:
            if em not in emails:
                emails.append(em)
        _merge_socials_into(socials, ss)

    bsky_url = f"https://bsky.app/profile/{handle}"
    slug_id = re.sub(r"[^A-Za-z0-9_.-]", "_", handle)
    return {
        "creator_id": f"bsky_{slug_id}",
        "name": name,
        "handle": f"@{handle}",
        "primary_platform": "bluesky",
        "profile_url": bsky_url,
        "country": "",
        "_extra_geo_text": "\n".join(extra_geo_chunks)[:8000],
        "audience_count": followers,
        "audience_text": f"{followers:,} followers" if followers else "Bluesky Creator",
        "default_category": default_category,
        "seed_topic": seed_topic,
        "bio": re.sub(r"\s+", " ", bio)[:600],
        "business_email": ", ".join(emails[:2]),
        "website": socials["website"] or (socials["link_hubs"][0] if socials["link_hubs"] else ""),
        "youtube_url": "",
        "instagram_url": socials["instagram_url"],
        "tiktok_url": socials["tiktok_url"],
        "facebook_url": socials["facebook_url"],
        "x_url": socials["x_url"],
        "bluesky_url": bsky_url,
        "pinterest_url": socials["pinterest_url"],
        "threads_url": socials["threads_url"],
        "linkedin_url": socials["linkedin_url"],
        "reddit_url": socials["reddit_url"],
        "amazon_store_url": socials["amazon_store_url"],
    }


def enrich_creator_profile_deep(creator: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deep-crawl website contact/about/partnership subpages, link hubs, and recent
    YouTube video descriptions for an existing creator record.
    """
    updated = dict(creator)
    emails = [
        em.strip().lower()
        for em in (updated.get("business_email") or "").split(",")
        if _is_valid_outreach_email(em)
    ]
    site = (updated.get("website") or "").strip()
    site_domain = _root_domain(site) if site else ""
    socials: Dict[str, Any] = {k: updated.get(k, "") for k in _ALL_SOCIAL_FIELDS}
    socials["website"] = site
    socials["link_hubs"] = [site] if any(h in site.lower() for h in _LINK_HUB_HOSTS) else []
    extra_geo_chunks: List[str] = []

    country = (updated.get("country") or "").strip()
    need_geo = country in ("", "United States", "Canada") and not (updated.get("city") and updated.get("province_state"))

    for hub_url in list(socials["link_hubs"])[:2]:
        he, hs, ht = _extract_page_signals(hub_url, timeout=5, allowed_site_domain=site_domain)
        if ht:
            extra_geo_chunks.append(ht)
        for em in he:
            if em not in emails:
                emails.append(em)
        _merge_socials_into(socials, hs)
        if socials.get("website") and socials["website"] != hub_url:
            site = socials["website"]
            site_domain = _root_domain(site)

    if site and not any(h in site.lower() for h in _LINK_HUB_HOSTS):
        se, ss, st = _crawl_creator_website(site, need_email=not bool(emails), need_geo=need_geo)
        if st:
            extra_geo_chunks.append(st)
        for em in se:
            if em not in emails:
                emails.append(em)
        _merge_socials_into(socials, ss)

    yt_url = (updated.get("youtube_url") or "").strip()
    if yt_url and (not emails or not updated.get("pinterest_url") or need_geo):
        nav_url = urlparse(yt_url).path
        ve, vs, vt = _fetch_youtube_recent_video_signals(nav_url, site_domain=site_domain)
        if vt:
            extra_geo_chunks.append(vt)
        for em in ve:
            if em not in emails:
                emails.append(em)
        _merge_socials_into(socials, vs)

    updated["business_email"] = ", ".join(emails[:2])
    if socials.get("website"):
        updated["website"] = socials["website"]
    for k in _ALL_SOCIAL_FIELDS:
        if socials.get(k):
            updated[k] = socials[k]
    if extra_geo_chunks:
        updated["_extra_geo_text"] = "\n".join(extra_geo_chunks)[:12000]
    return updated


def _scrape_bluesky_diy_creators(existing_ids: Optional[set] = None) -> List[Dict[str, Any]]:
    candidates: Dict[str, Tuple[Dict[str, Any], str, str]] = {}
    for query, default_cat in BLUESKY_SEARCH_SEEDS:
        try:
            url = f"https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q={urllib.parse.quote(query)}&limit=15"
            raw = _fetch_text(url, timeout=6)
            actors = json.loads(raw).get("actors") or []
            for a in actors:
                h = (a.get("handle") or "").strip()
                if not h:
                    continue
                cid = f"bsky_{re.sub(r'[^A-Za-z0-9_.-]', '_', h)}"
                if existing_ids and cid in existing_ids:
                    continue
                if h not in candidates and _DIY_RELEVANCE_RE.search(f"{a.get('displayName', '')} {a.get('description', '')}"):
                    candidates[h] = (a, default_cat, query)
        except Exception:
            continue

    results: List[Dict[str, Any]] = []
    if not candidates:
        return results
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = [ex.submit(_fetch_bluesky_creator, a, cat, q) for a, cat, q in list(candidates.values())[:20]]
        for fut in as_completed(futs):
            try:
                item = fut.result()
                if item:
                    results.append(item)
            except Exception:
                pass
    return results


def scrape_diy_creators(
    existing_ids: Optional[set] = None,
    max_new_profiles: int = 85,
) -> List[Dict[str, Any]]:
    """
    Discovers DIY / Home-Improvement creators across YouTube and Bluesky,
    follows Linktree/bio links and websites to extract business outreach emails and
    cross-platform social handles (Instagram, TikTok, Facebook, X/Twitter, YouTube),
    and returns normalized creator records.
    """
    seed_by_nav: Dict[str, Dict[str, str]] = {}
    with ThreadPoolExecutor(max_workers=8) as search_exec:
        futs = [search_exec.submit(_search_youtube_seed, q, cat) for q, cat in CREATOR_SEARCH_SEEDS]
        for fut in as_completed(futs):
            try:
                for item in fut.result():
                    nav = item["nav_url"]
                    slug_id = re.sub(r"[^A-Za-z0-9_-]", "_", nav.lstrip("/"))
                    cid = f"yt_{slug_id}"
                    if existing_ids and cid in existing_ids:
                        continue
                    seed_by_nav.setdefault(nav, item)
            except Exception:
                pass

    by_cat: Dict[str, List[Dict[str, str]]] = {}
    for item in seed_by_nav.values():
        by_cat.setdefault(item["default_category"], []).append(item)
    new_yt_seeds: List[Dict[str, str]] = []
    idx = 0
    while len(new_yt_seeds) < max_new_profiles:
        added = False
        for cat_items in by_cat.values():
            if idx < len(cat_items):
                new_yt_seeds.append(cat_items[idx])
                added = True
                if len(new_yt_seeds) >= max_new_profiles:
                    break
        if not added:
            break
        idx += 1

    creators: List[Dict[str, Any]] = []

    if new_yt_seeds:
        with ThreadPoolExecutor(max_workers=8) as prof_exec:
            futs = [prof_exec.submit(_fetch_youtube_creator_profile, s) for s in new_yt_seeds]
            for fut in as_completed(futs):
                try:
                    c = fut.result()
                    if c:
                        creators.append(c)
                except Exception:
                    pass

    try:
        creators.extend(_scrape_bluesky_diy_creators(existing_ids))
    except Exception:
        pass

    return creators
