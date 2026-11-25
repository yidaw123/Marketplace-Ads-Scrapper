import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

BARK_CATEGORIES: List[Tuple[str, str, str]] = [
    ("handyman", "Handyman", "General Handyman & Odd Jobs"),
    ("cleaners", "House & Commercial Cleaning", "Cleaning & Home Care"),
    ("window-cleaners", "Window Cleaning", "Cleaning & Home Care"),
    ("plumbers", "Plumbing & Drainage", "Plumbing & Drain"),
    ("electricians", "Electricians", "Electrical & Lighting"),
    ("gardening-landscaping", "Gardening & Landscaping", "Yardwork & Landscaping"),
    ("painter-decorator", "Painter & Decorator", "Painting & Drywall"),
    ("fence-installers", "Fence & Gate Installation", "Carpentry, Doors & Windows"),
    ("locksmith-security-fire-safety", "Locksmiths & Security", "Carpentry, Doors & Windows"),
    ("roofers", "Roofing", "Roofing, Siding & Gutters"),
    ("gutter-cleaning-repairs", "Gutter Cleaning & Repairs", "Roofing, Siding & Gutters"),
    ("air-conditioning-repair", "Heating & Air Conditioning", "Appliance & HVAC Repair"),
]

# Maps region IDs from database.DEFAULT_REGIONS to Bark's (locale, state/province/city path)
BARK_REGION_PATHS: Dict[str, Tuple[str, str]] = {
    "toronto": ("en/ca", "ontario/toronto"),
    "ottawa": ("en/ca", "ontario/ottawa"),
    "hamilton": ("en/ca", "ontario/hamilton"),
    "kitchener": ("en/ca", "ontario/kitchener"),
    "london_on": ("en/ca", "ontario/london"),
    "vancouver": ("en/ca", "british-columbia/vancouver"),
    "victoria": ("en/ca", "british-columbia/victoria"),
    "calgary": ("en/ca", "alberta/calgary"),
    "edmonton": ("en/ca", "alberta/edmonton"),
    "montreal": ("en/ca", "quebec/montreal"),
    "winnipeg": ("en/ca", "manitoba/winnipeg"),
    "halifax": ("en/ca", "nova-scotia/halifax"),
    "sfbay": ("en/us", "california/san-francisco"),
    "la": ("en/us", "california/los-angeles"),
    "nyc": ("en/us", "new-york/new-york-city"),
    "austin": ("en/us", "texas/austin"),
    "chicago": ("en/us", "illinois/chicago"),
    "seattle": ("en/us", "washington/seattle"),
}

_NON_BUSINESS_HOSTS = (
    "bark.com",
    "trustpilot.com",
    "typeform.com",
    "amazonaws.com",
    "youtube.com",
    "youtu.be",
    "instagram.com",
    "facebook.com",
    "fb.com",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "linkedin.com",
    "nextdoor.com",
    "wikipedia.org",
    "google.com",
    "goo.gl",
)

_REVIEW_DATE_RE = re.compile(
    r"\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+202[3456])\b",
    re.IGNORECASE,
)


def _fetch_html(url: str, timeout: int = 12) -> str:
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


def _parse_review_date(text: str) -> str:
    m = _REVIEW_DATE_RE.search(text or "")
    if not m:
        return ""
    raw = re.sub(r"\bsept\b", "Sep", m.group(1), flags=re.IGNORECASE)
    for fmt in ("%d %B %Y", "%d %b %Y"):
        try:
            dt = datetime.strptime(raw, fmt).replace(hour=12, tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue
    return ""


def _is_external_company_site(url: str) -> bool:
    if not url or not url.lower().startswith(("http://", "https://")):
        return False
    try:
        host = (urlparse(url).netloc or "").lower().split(":")[0]
    except Exception:
        return False
    if not host or "." not in host:
        return False
    bare = host[4:] if host.startswith("www.") else host
    return not any(bare == b or bare.endswith("." + b) for b in _NON_BUSINESS_HOSTS)


def _parse_bark_city_category_page(
    cat_slug: str,
    cat_label: str,
    default_trade_category: str,
    region: Dict[str, Any],
    max_per_page: int,
) -> List[Dict[str, Any]]:
    reg_id = region.get("id", "")
    path_info = BARK_REGION_PATHS.get(reg_id)
    if not path_info:
        return []
    locale, city_path = path_info
    page_url = f"https://www.bark.com/{locale}/{cat_slug}/{city_path}/"

    try:
        html = _fetch_html(page_url, timeout=12)
    except Exception:
        return []

    soup = BeautifulSoup(html, "html.parser")
    items: List[Dict[str, Any]] = []
    seen_codes = set()

    for card in soup.select(".seller-card"):
        profile_link = card.select_one('a[href*="/company/"]')
        if not profile_link:
            continue
        href = (profile_link.get("href") or "").strip()
        m = re.search(r"/company/[^/]+/([A-Za-z0-9]+)/?", href)
        if not m:
            continue
        code = m.group(1)
        if code in seen_codes:
            continue

        name_el = card.select_one(".popular-seller-company-name, .seller-name-wrapper, h3, h4")
        company_name = re.sub(r"\s+", " ", name_el.get_text(" ", strip=True)) if name_el else ""
        if not company_name:
            continue

        desc_el = card.select_one(".company-description-collapse, .company-description")
        desc = re.sub(r"\s+", " ", desc_el.get_text(" ", strip=True)) if desc_el else ""

        review_el = card.select_one(".directory-seller-review, .popular-seller-review")
        review = re.sub(r"\s+", " ", review_el.get_text(" ", strip=True)) if review_el else ""

        full_profile_url = href if href.startswith("http") else f"https://www.bark.com{href}"

        seen_codes.add(code)
        items.append(
            {
                "code": code,
                "company_name": company_name,
                "cat_label": cat_label,
                "default_trade_category": default_trade_category,
                "desc": desc,
                "review": review,
                "url": full_profile_url,
                "country": region.get("country", "Canada"),
                "province": region.get("province", ""),
                "city_region": region.get("name", ""),
                "website": "",
                "posted_date": "",
            }
        )
        if len(items) >= max_per_page:
            break

    return items


def _fetch_bark_company_profile(item: Dict[str, Any]) -> None:
    try:
        html = _fetch_html(item["url"], timeout=10)
        soup = BeautifulSoup(html, "html.parser")
        for chrome in soup.select("nav, header, footer"):
            chrome.decompose()

        for a in soup.select("a[href^='http']"):
            href = (a.get("href") or "").strip()
            if _is_external_company_site(href):
                item["website"] = href
                break

        about_el = soup.select_one("#about, .about-section, .seller-profile-about, .company-description")
        if about_el:
            about_txt = re.sub(r"\s+", " ", about_el.get_text(" ", strip=True))
            if len(about_txt) > len(item["desc"]):
                item["desc"] = about_txt[:900]

        date_iso = _parse_review_date(html)
        if date_iso:
            item["posted_date"] = date_iso
    except Exception:
        pass


def scrape_bark_services(
    regions: Optional[List[Dict[str, Any]]] = None,
    max_per_page: int = 5,
    fetch_profiles: bool = True,
    existing_ids: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """
    Crawls Bark.com public city + category directories across enabled CA/US metro regions,
    collects service provider profiles, fetches new company profile pages for business sites
    and review dates (skipping already-stored IDs), and maps them into the standard schema.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    if regions:
        active_regions = [r for r in regions if r.get("enabled", True) and r.get("id") in BARK_REGION_PATHS]
    else:
        active_regions = []

    if not active_regions:
        active_regions = [
            {"id": "toronto", "name": "Toronto / GTA, ON", "province": "Ontario", "country": "Canada"},
            {"id": "vancouver", "name": "Vancouver / Lower Mainland, BC", "province": "British Columbia", "country": "Canada"},
            {"id": "nyc", "name": "New York City, NY", "province": "New York", "country": "United States"},
            {"id": "austin", "name": "Austin, TX", "province": "Texas", "country": "United States"},
        ]

    # Build balanced crawl tasks:
    # - Cover all enabled regions for the core 'handyman' category
    # - Rotate the other 9 trade categories across 3 diverse regions (CA + US) so every
    #   category and metro gets coverage in ~35 concurrent requests (~4s total).
    tasks: List[Tuple[str, str, str, Dict[str, Any]]] = []
    seen_pairs = set()
    for reg in active_regions:
        slug, label, def_cat = BARK_CATEGORIES[0]
        seen_pairs.add((slug, reg["id"]))
        tasks.append((slug, label, def_cat, reg))

    for c_idx, (slug, label, def_cat) in enumerate(BARK_CATEGORIES[1:]):
        for offset in range(min(3, len(active_regions))):
            reg = active_regions[(c_idx * 3 + offset) % len(active_regions)]
            if (slug, reg["id"]) not in seen_pairs:
                seen_pairs.add((slug, reg["id"]))
                tasks.append((slug, label, def_cat, reg))

    collected_by_code: Dict[str, Dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        fut_map = {
            executor.submit(
                _parse_bark_city_category_page, slug, label, def_cat, reg, max_per_page
            ): (slug, reg["id"])
            for slug, label, def_cat, reg in tasks
        }
        for fut in as_completed(fut_map):
            try:
                for it in fut.result():
                    collected_by_code.setdefault(it["code"], it)
            except Exception:
                pass

    items = list(collected_by_code.values())
    if not items:
        return []

    if existing_ids:
        new_items = [it for it in items if f"bark_{it['code']}" not in existing_ids]
        seen_items = [it for it in items if f"bark_{it['code']}" in existing_ids]
    else:
        new_items = items
        seen_items = []

    if fetch_profiles and new_items:
        to_fetch = new_items[:30]
        with ThreadPoolExecutor(max_workers=8) as prof_exec:
            futs = [prof_exec.submit(_fetch_bark_company_profile, it) for it in to_fetch]
            for fut in as_completed(futs):
                try:
                    fut.result()
                except Exception:
                    pass

    posts: List[Dict[str, Any]] = []
    for it in new_items:
        body_parts = [p for p in (it["desc"], f"Recent Review: {it['review']}" if it["review"] else "") if p]
        posts.append(
            {
                "external_id": f"bark_{it['code']}",
                "platform": "bark",
                "source_detail": f"bark.com ({it['cat_label']})",
                "country": it["country"],
                "province": it["province"],
                "city_region": it["city_region"],
                "neighborhood": "",
                "title": f"{it['company_name']} — {it['cat_label']} ({it['city_region']})",
                "body": " | ".join(body_parts)[:1200],
                "url": it["url"],
                "author": it["company_name"],
                "contact_name": it["company_name"],
                "phone": "",
                "email": "",
                "website": it.get("website") or "",
                "price_mention": "",
                "posted_at": it["posted_date"] or now_iso,
                "posted_at_exact": bool(it["posted_date"]),
                "default_category": it["default_trade_category"],
                "score": 1,
                "num_comments": 0,
            }
        )

    for it in seen_items:
        posts.append(
            {
                "external_id": f"bark_{it['code']}",
                "platform": "bark",
                "source_detail": f"bark.com ({it['cat_label']})",
                "country": it["country"],
                "province": it["province"],
                "city_region": it["city_region"],
                "title": it["company_name"],
                "body": "",
                "url": it["url"],
                "_already_stored": True,
            }
        )

    return posts
