import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# 20 targeted YouTube DIY queries spanning all 10 Trade Categories (2 per trade)
CREATOR_SEARCH_SEEDS: List[Tuple[str, str]] = [
    ("diy plumbing repair kitchen sink", "Plumbing & Drain"),
    ("how to fix leaky toilet pipe diy", "Plumbing & Drain"),
    ("diy electrical outlet switch install", "Electrical & Lighting"),
    ("how to install ceiling fan light fixture", "Electrical & Lighting"),
    ("diy landscaping patio paver build", "Yardwork & Landscaping"),
    ("lawn care yard renovation diy", "Yardwork & Landscaping"),
    ("how to patch drywall mud tape diy", "Painting & Drywall"),
    ("interior room painting tips diy", "Painting & Drywall"),
    ("diy fence gate deck build", "Carpentry, Doors & Windows"),
    ("how to install door trim baseboard", "Carpentry, Doors & Windows"),
    ("how to mount tv drywall studs", "Mounting & Furniture Assembly"),
    ("ikea furniture built in hack diy", "Mounting & Furniture Assembly"),
    ("diy gutter cleaning roof shingle repair", "Roofing, Siding & Gutters"),
    ("pressure washing siding exterior diy", "Roofing, Siding & Gutters"),
    ("diy bathroom tile shower backsplash", "Flooring & Tile"),
    ("how to install lvp vinyl plank flooring", "Flooring & Tile"),
    ("diy hvac furnace thermostat repair", "Appliance & HVAC Repair"),
    ("how to fix dishwasher washer dryer", "Appliance & HVAC Repair"),
    ("handyman home repair tips tricks", "General Handyman & Odd Jobs"),
    ("home renovation diy creator", "General Handyman & Odd Jobs"),
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
    "youtube.com", "google.com", "gstatic.com", "linktr.ee", "beacons.ai",
    "stan.store", "example.com", "sentry.io", "wixpress.com", "shopify.com",
    "cloudflare.com", "instagram.com", "facebook.com", "tiktok.com",
    "twitter.com", "x.com", "twitch.tv", "bsky.app", "wordpress.org",
    "w3.org", "gravatar.com", "godaddy.com", "squarespace.com", "domain.com",
    "skool.com", "getjobber.com", "patreon.com", "substack.com",
    "kajabi.com", "teachable.com",
)

_AFFILIATE_OR_RETAIL_HOSTS = (
    "amazon.", "amzn.", "amzlink.", "geni.us", "homedepot.", "lowes.",
    "shoplowes.", "walmart.", "ikea.", "wayfair.", "kit.co", "rstyle.me",
    "liketk.it", "patreon.com", "buymeacoffee.com", "ko-fi.com", "paypal.",
    "venmo.com", "cash.app", "discord.gg", "discord.com", "youtube.com",
    "youtu.be", "bit.ly", "tinyurl.com", "goo.gl", "twitch.tv",
    "instagram.com", "tiktok.com", "facebook.com", "fb.com", "twitter.com",
    "x.com", "bsky.app", "pinterest.", "linkedin.com", "threads.net",
)

_LINK_HUB_HOSTS = ("linktr.ee", "beacons.ai", "stan.store", "bio.site", "linkin.bio", "solo.to", "taplink.cc")


def _extract_clean_emails(text: str) -> List[str]:
    """Extract real business/outreach emails while filtering out @2x image assets & platform domains."""
    out: List[str] = []
    if not text:
        return out
    cleaned_src = re.sub(r"(?:\\?u003[ce]|\\?u0026|\\?u002f|mailto:)", " ", text, flags=re.IGNORECASE)
    for raw in _EMAIL_RE.findall(cleaned_src):
        el = raw.lower().strip()
        if any(el.endswith(ext) for ext in _BAD_EMAIL_EXTENSIONS):
            continue
        local, dom = el.split("@", 1)
        if not local or len(local) > 64 or local in ("noreply", "no-reply", "donotreply"):
            continue
        if re.match(r"^\d+x$", local):
            continue
        if any(dom == bad or dom.endswith("." + bad) for bad in _BAD_EMAIL_DOMAINS):
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
    """Sort discovered external URLs into social profiles, link hubs, and personal website."""
    res: Dict[str, Any] = {
        "instagram_url": "",
        "tiktok_url": "",
        "facebook_url": "",
        "x_url": "",
        "twitch_url": "",
        "bluesky_url": "",
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
        if not path and any(s in host for s in ("instagram.", "tiktok.", "facebook.", "twitter.", "x.com", "twitch.")):
            continue

        if "instagram.com" in host and not res["instagram_url"]:
            if not any(path.startswith(skip) for skip in ("p/", "reel/", "explore/", "accounts/")):
                res["instagram_url"] = norm
        elif "tiktok.com" in host and not res["tiktok_url"]:
            res["tiktok_url"] = norm
        elif ("facebook.com" in host or "fb.com" in host) and not res["facebook_url"]:
            if not any(path.startswith(skip) for skip in ("sharer", "share.php")):
                res["facebook_url"] = norm
        elif ("twitter.com" in host or host == "x.com" or host == "www.x.com") and not res["x_url"]:
            res["x_url"] = norm
        elif "twitch.tv" in host and not res["twitch_url"]:
            res["twitch_url"] = norm
        elif "bsky.app" in host and not res["bluesky_url"]:
            res["bluesky_url"] = norm
        elif any(hub in host for hub in _LINK_HUB_HOSTS):
            if norm not in res["link_hubs"]:
                res["link_hubs"].append(norm)
        elif not res["website"]:
            if not any(skip in host for skip in _AFFILIATE_OR_RETAIL_HOSTS):
                res["website"] = f"https://{host}" + (f"/{path}" if path and len(path) < 30 else "")
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


def _extract_links_and_emails_from_url(url: str, timeout: int = 5) -> Tuple[List[str], List[str]]:
    try:
        html = _fetch_text(url, timeout=timeout)
    except Exception:
        return [], []
    emails = _extract_clean_emails(html)
    social_urls = re.findall(
        r"https?://(?:www\.)?(?:instagram\.com|tiktok\.com|facebook\.com|twitter\.com|x\.com|twitch\.tv|bsky\.app)/[A-Za-z0-9._/@-]+",
        html,
        re.IGNORECASE,
    )
    return emails, social_urls


def _fetch_youtube_creator_profile(seed: Dict[str, str]) -> Optional[Dict[str, Any]]:
    nav_url = seed["nav_url"]
    about_url = f"https://www.youtube.com{nav_url}/about"
    try:
        html = _fetch_text(about_url, timeout=9)
    except Exception:
        return None

    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html)
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

    raw_links = [
        (l.get("channelExternalLinkViewModel") or {}).get("link", {}).get("content", "")
        for l in (about.get("links") or [])
    ]
    raw_links.extend(
        re.findall(
            r"(?:https?://)?(?:www\.)?(?:linktr\.ee|beacons\.ai|stan\.store|instagram\.com|tiktok\.com|facebook\.com|twitter\.com|x\.com|twitch\.tv)/[A-Za-z0-9._/@-]+",
            desc,
            re.IGNORECASE,
        )
    )
    socials = _classify_creator_links([u for u in raw_links if u])
    emails = _extract_clean_emails(desc)

    # Hop to Linktree/Beacons/Stan.store pages to uncover business email & cross-links (IG/TikTok/X/Twitch/FB)
    for hub_url in socials["link_hubs"][:2]:
        hub_emails, hub_socials = _extract_links_and_emails_from_url(hub_url, timeout=5)
        for em in hub_emails:
            if em not in emails:
                emails.append(em)
        if hub_socials:
            extra = _classify_creator_links(hub_socials)
            for k in ("instagram_url", "tiktok_url", "facebook_url", "x_url", "twitch_url", "bluesky_url"):
                if not socials[k] and extra[k]:
                    socials[k] = extra[k]

    # If still no email and creator has a personal website, check homepage & /contact
    if not emails and socials["website"]:
        site_emails, site_socials = _extract_links_and_emails_from_url(socials["website"], timeout=4)
        emails.extend(em for em in site_emails if em not in emails)
        if not emails:
            base = socials["website"].rstrip("/")
            c_emails, _ = _extract_links_and_emails_from_url(f"{base}/contact", timeout=4)
            emails.extend(em for em in c_emails if em not in emails)
        if site_socials:
            extra = _classify_creator_links(site_socials)
            for k in ("instagram_url", "tiktok_url", "facebook_url", "x_url", "twitch_url"):
                if not socials[k] and extra[k]:
                    socials[k] = extra[k]

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
        "twitch_url": socials["twitch_url"],
        "bluesky_url": socials["bluesky_url"],
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
    if not emails and socials["link_hubs"]:
        he, hs = _extract_links_and_emails_from_url(socials["link_hubs"][0], timeout=4)
        emails.extend(he)
        if hs:
            extra = _classify_creator_links(hs)
            for k in ("instagram_url", "tiktok_url", "facebook_url", "x_url", "twitch_url"):
                if not socials[k] and extra[k]:
                    socials[k] = extra[k]

    bsky_url = f"https://bsky.app/profile/{handle}"
    slug_id = re.sub(r"[^A-Za-z0-9_.-]", "_", handle)
    return {
        "creator_id": f"bsky_{slug_id}",
        "name": name,
        "handle": f"@{handle}",
        "primary_platform": "bluesky",
        "profile_url": bsky_url,
        "country": "",
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
        "twitch_url": socials["twitch_url"],
        "bluesky_url": bsky_url,
    }


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


def _scrape_twitch_diy_creators(existing_ids: Optional[set] = None) -> List[Dict[str, Any]]:
    """Query Twitch public Makers & Crafting category for English woodworking / DIY repair creators."""
    results: List[Dict[str, Any]] = []
    try:
        gql_req = urllib.request.Request(
            "https://gql.twitch.tv/gql",
            data=json.dumps(
                {
                    "query": """query { game(name: "Makers & Crafting") { streams(first: 25) { edges { node { title broadcaster { login displayName description } } } } } }"""
                }
            ).encode("utf-8"),
            headers={
                "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        with urllib.request.urlopen(gql_req, timeout=8) as r:
            data = json.loads(r.read().decode("utf-8"))
        edges = (((data.get("data") or {}).get("game") or {}).get("streams") or {}).get("edges") or []
    except Exception:
        return results

    for edge in edges:
        node = (edge or {}).get("node") or {}
        b = node.get("broadcaster") or {}
        login = (b.get("login") or "").strip()
        name = (b.get("displayName") or login).strip()
        desc = (b.get("description") or "").strip()
        stream_title = (node.get("title") or "").strip()
        if not login or _is_excluded_creator(name, login):
            continue
        cid = f"twitch_{login.lower()}"
        if existing_ids and cid in existing_ids:
            continue
        combined = f"{stream_title} {desc}"
        if not re.search(
            r"\b(woodwork\w*|carpentr\w*|diy|handyman|home repair|renovat\w*|plumb\w*|electric\w*|weld\w*|metalwork|workshop|cabinet\w*|furniture)\b",
            combined,
            re.IGNORECASE,
        ):
            continue
        emails = _extract_clean_emails(desc)
        raw_urls = re.findall(r"https?://[^\s)<\]\"']+", desc, re.IGNORECASE)
        socials = _classify_creator_links(raw_urls)
        tw_url = f"https://www.twitch.tv/{login}"
        results.append(
            {
                "creator_id": cid,
                "name": name,
                "handle": f"@{login}",
                "primary_platform": "twitch",
                "profile_url": tw_url,
                "country": "",
                "audience_count": 0,
                "audience_text": "Twitch Maker Channel",
                "default_category": "Carpentry, Doors & Windows",
                "seed_topic": "twitch makers workshop woodworking",
                "bio": re.sub(r"\s+", " ", f"{desc or stream_title}")[:600],
                "business_email": ", ".join(emails[:2]),
                "website": socials["website"] or (socials["link_hubs"][0] if socials["link_hubs"] else ""),
                "youtube_url": "",
                "instagram_url": socials["instagram_url"],
                "tiktok_url": socials["tiktok_url"],
                "facebook_url": socials["facebook_url"],
                "x_url": socials["x_url"],
                "twitch_url": tw_url,
                "bluesky_url": socials["bluesky_url"],
            }
        )
    return results


def scrape_diy_creators(
    existing_ids: Optional[set] = None,
    max_new_profiles: int = 85,
) -> List[Dict[str, Any]]:
    """
    Discovers DIY / Home-Improvement creators across YouTube, Bluesky, and Twitch,
    follows Linktree/bio links to extract business outreach emails and cross-platform
    social handles (Instagram, TikTok, Facebook, X/Twitter, Twitch, YouTube),
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

    with ThreadPoolExecutor(max_workers=2) as extra_exec:
        bsky_fut = extra_exec.submit(_scrape_bluesky_diy_creators, existing_ids)
        tw_fut = extra_exec.submit(_scrape_twitch_diy_creators, existing_ids)
        for fut in (bsky_fut, tw_fut):
            try:
                creators.extend(fut.result())
            except Exception:
                pass

    return creators
