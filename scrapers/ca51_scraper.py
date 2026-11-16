import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

CA51_CATEGORIES: List[Tuple[str, str, str]] = [
    ("drain-plumbing", "Drain & Plumbing", "Plumbing & Drain"),
    ("pipe-services", "Pipe & Water Line", "Plumbing & Drain"),
    ("electric-services", "Electrical & Lighting", "Electrical & Lighting"),
    ("garden-snow-removal-services", "Garden & Snow Removal", "Yardwork & Landscaping"),
    ("paint-stucco", "Painting & Drywall", "Painting & Drywall"),
    ("doors-windows-inserts", "Doors & Windows", "Carpentry, Doors & Windows"),
    ("fence-deck", "Fence & Deck", "Carpentry, Doors & Windows"),
    ("locks-locksmiths", "Locks & Locksmiths", "Carpentry, Doors & Windows"),
    ("cabinets-stone-materials", "Cabinets & Countertops", "Carpentry, Doors & Windows"),
    ("repair-assembly", "Repair & Assembly", "Mounting & Furniture Assembly"),
    ("roofing", "Roofing & Gutters", "Roofing, Siding & Gutters"),
    ("floor-staircase", "Flooring & Stairs", "Flooring & Tile"),
    ("household-appliances-repair", "Appliance Repair", "Appliance & HVAC Repair"),
    ("heating-cooling-ventilating", "HVAC & Heating", "Appliance & HVAC Repair"),
    ("construction-renovation", "Renovation & Handyman", "General Handyman & Odd Jobs"),
    ("basement-construction-repair", "Basement Repair", "General Handyman & Odd Jobs"),
]

GTA_ZH_AREA_MAP: List[Tuple[str, str]] = [
    ("万锦", "Markham"),
    ("列治文山", "Richmond Hill"),
    ("士嘉堡", "Scarborough"),
    ("密西沙加", "Mississauga"),
    ("密市", "Mississauga"),
    ("北约克", "North York"),
    ("旺市", "Vaughan"),
    ("奥克维尔", "Oakville"),
    ("奥村", "Oakville"),
    ("康山", "Thornhill"),
    ("伊桃碧谷", "Etobicoke"),
    ("多伦多", "Toronto"),
    ("大多地区", "GTA"),
    ("大多", "GTA"),
]

ZH_GLOSSARY: List[Tuple[str, str]] = [
    ("通渠", "drain cleaning unclogging"),
    ("疏通", "drain unclogging"),
    ("漏水", "pipe leak repair"),
    ("水龙头", "faucet sink"),
    ("马桶", "toilet repair"),
    ("热水炉", "water heater"),
    ("水管", "plumbing pipe"),
    ("电工", "electrician wiring"),
    ("配电盘", "breaker panel"),
    ("灯具", "light fixture"),
    ("剪草", "lawn mowing"),
    ("铲雪", "snow removal"),
    ("围栏", "fence repair"),
    ("露台", "deck repair"),
    ("油漆", "interior painting"),
    ("粉刷", "painting"),
    ("补洞", "drywall patching"),
    ("灰板", "drywall"),
    ("门窗", "door window repair"),
    ("换锁", "door lock repair"),
    ("橱柜", "cabinetry"),
    ("安装", "furniture assembly mounting"),
    ("屋顶", "roof shingle repair"),
    ("水槽", "gutter cleaning"),
    ("雨槽", "gutter cleaning"),
    ("地板", "hardwood laminate flooring"),
    ("瓷砖", "tile grout"),
    ("冰箱", "fridge appliance repair"),
    ("洗衣机", "washer appliance repair"),
    ("烘干机", "dryer appliance repair"),
    ("冷暖", "hvac furnace ac repair"),
    ("暖炉", "furnace hvac repair"),
    ("空调", "ac air conditioner repair"),
    ("装修", "handyman home repair"),
]


def _fetch_html(url: str, timeout: int = 12) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en-CA;q=0.8,en;q=0.7",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def normalize_zh_prices(text: str) -> str:
    """Convert Chinese price formats into standard $ amounts before extraction."""
    if not text:
        return ""
    s = str(text)
    # e.g. 50刀/小时, 40加币每小时 -> $50/hr
    s = re.sub(
        r"(\d{2,4})\s*(?:刀|加币|加元|块|元)\s*(?:/\s*(?:小时|hr)|每小时)",
        r"$\1/hr",
        s,
        flags=re.IGNORECASE,
    )
    # e.g. 每小时45, 时薪$35 -> $45/hr
    s = re.sub(r"(?:每小时|时薪)\s*\$?\s*(\d{2,3})", r"$\1/hr", s, flags=re.IGNORECASE)
    # e.g. $45/小时 -> $45/hr
    s = re.sub(r"\$\s*(\d{2,3})\s*/\s*(?:小时|钟头)", r"$\1/hr", s)
    # e.g. 50刀, 80加币, 100刀起 -> $50
    s = re.sub(r"(\d{2,4})\s*(?:刀|加币|加元)(?:起)?", r"$\1", s)
    return s


def _fallback_glossary_translate(text: str) -> str:
    norm = normalize_zh_prices(text)
    hints = []
    for zh_kw, en_kw in ZH_GLOSSARY:
        if zh_kw in norm and en_kw not in hints:
            hints.append(en_kw)
    if hints:
        return f"{', '.join(hints)} ({norm[:120]})"
    return norm


def _translate_single_gtx(text: str, timeout: int = 8) -> Optional[str]:
    clean = normalize_zh_prices(text).strip()
    if not clean:
        return ""
    q = urllib.parse.quote(clean[:1800])
    url = (
        "https://translate.googleapis.com/translate_a/single"
        f"?client=gtx&sl=zh-CN&tl=en&dt=t&q={q}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        translated = "".join(seg[0] for seg in (data[0] or []) if seg and seg[0])
        return normalize_zh_prices(translated.strip())
    except Exception:
        return None


def translate_zh_batch(texts: List[str]) -> List[str]:
    """
    Batch-translate Chinese strings into English via Google Translate's single endpoint,
    with a home-services glossary fallback so offline or rate-limited runs still classify.
    """
    if not texts:
        return []
    results = [""] * len(texts)
    non_empty_indices = [i for i, t in enumerate(texts) if (t or "").strip()]
    chunk_size = 15
    sep = "\n~#~#~\n"

    for start in range(0, len(non_empty_indices), chunk_size):
        idx_chunk = non_empty_indices[start:start + chunk_size]
        src_items = [normalize_zh_prices(texts[i]).replace("\n", " ").strip()[:600] for i in idx_chunk]
        joined = sep.join(src_items)
        translated_joined = _translate_single_gtx(joined, timeout=10)

        if translated_joined:
            parts = re.split(r"\s*~\s*#\s*~\s*#\s*~\s*", translated_joined)
            if len(parts) == len(idx_chunk):
                for idx, part in zip(idx_chunk, parts):
                    results[idx] = normalize_zh_prices(part.strip()) or _fallback_glossary_translate(texts[idx])
                continue

        # Alignment mismatch or batch error -> fallback individually (then glossary)
        for idx in idx_chunk:
            single = _translate_single_gtx(texts[idx][:600], timeout=6)
            results[idx] = single if single else _fallback_glossary_translate(texts[idx])

    return results


def _resolve_gta_neighborhood(locations: str, title: str, desc: str) -> str:
    combined = f"{locations} {title} {desc}"
    found = []
    for zh_area, en_area in GTA_ZH_AREA_MAP:
        if zh_area in combined and en_area not in found:
            found.append(en_area)
    if found:
        return ", ".join(found[:2])
    return "GTA"


def _parse_category_page(
    slug: str,
    cat_label: str,
    default_trade_category: str,
    max_per_category: int,
) -> List[Dict[str, Any]]:
    cat_url = f"https://www.51.ca/service/categories/{slug}"
    try:
        html = _fetch_html(cat_url, timeout=15)
    except Exception:
        return []

    soup = BeautifulSoup(html, "html.parser")
    items: List[Dict[str, Any]] = []
    seen_ids = set()

    # Primary card extraction: div[data-cate] or overview links
    for card in soup.select("div[data-cate]"):
        link_el = card.select_one('a.overview[href*="/posts/"]') or card.select_one('a[href*="/posts/"]')
        if not link_el:
            continue
        href = link_el.get("href") or ""
        m = re.search(r"/posts/(\d+)", href)
        if not m:
            continue
        post_id = m.group(1)
        if post_id in seen_ids:
            continue

        title_el = card.select_one(".title") or link_el
        zh_title = re.sub(r"\s+", " ", title_el.get_text(" ", strip=True)).strip()
        if not zh_title:
            continue

        tags = [re.sub(r"\s+", " ", t.get_text(strip=True)) for t in card.select(".el51__tag-pill")]
        tags_str = ", ".join(t for t in tags if t)
        contact = (card.get("data-contact-name") or "").strip()
        locations = (card.get("data-locations") or "").strip()
        clean_url = f"https://www.51.ca/service/categories/{slug}/posts/{post_id}"

        seen_ids.add(post_id)
        items.append(
            {
                "post_id": post_id,
                "slug": slug,
                "cat_label": cat_label,
                "default_trade_category": default_trade_category,
                "zh_title": zh_title,
                "zh_tags": tags_str,
                "contact": contact,
                "locations": locations,
                "url": clean_url,
                "zh_desc": "",
                "posted_date": "",
            }
        )
        if len(items) >= max_per_category:
            break

    # JSON-LD ListItem fallback if DOM cards didn't yield enough
    if len(items) < max_per_category:
        for script_el in soup.select('script[type="application/ld+json"]'):
            raw_json = script_el.string or ""
            if "ListItem" not in raw_json:
                continue
            try:
                ld = json.loads(raw_json)
            except Exception:
                continue
            item_list = []
            if isinstance(ld, dict) and isinstance(ld.get("itemListElement"), list):
                item_list = ld["itemListElement"]
            for entry in item_list:
                if not isinstance(entry, dict):
                    continue
                entry_url = entry.get("url") or ""
                zh_title = (entry.get("name") or "").strip()
                m = re.search(r"/posts/(\d+)", entry_url)
                if not m or not zh_title:
                    continue
                post_id = m.group(1)
                if post_id in seen_ids:
                    continue
                seen_ids.add(post_id)
                items.append(
                    {
                        "post_id": post_id,
                        "slug": slug,
                        "cat_label": cat_label,
                        "default_trade_category": default_trade_category,
                        "zh_title": zh_title,
                        "zh_tags": "",
                        "contact": "",
                        "locations": "GTA",
                        "url": f"https://www.51.ca/service/categories/{slug}/posts/{post_id}",
                        "zh_desc": "",
                        "posted_date": "",
                    }
                )
                if len(items) >= max_per_category:
                    break
            if len(items) >= max_per_category:
                break

    return items


def _fetch_detail_page(item: Dict[str, Any]) -> None:
    try:
        html = _fetch_html(item["url"], timeout=12)
        soup = BeautifulSoup(html, "html.parser")
        meta = soup.find("meta", attrs={"name": "description"})
        meta_desc = (meta.get("content") or "").strip() if meta else ""

        body_el = soup.select_one(".post-content, .detail-content, .content, article, main")
        body_text = re.sub(r"\s+", " ", body_el.get_text(" ", strip=True)) if body_el else ""
        # Strip leading title repetition and contact noise where possible
        desc = body_text[:700] if len(body_text) > len(meta_desc) else meta_desc
        item["zh_desc"] = desc[:700]

        date_match = re.search(r"(202[456]-\d{2}-\d{2})", html)
        if date_match:
            item["posted_date"] = f"{date_match.group(1)}T12:00:00+00:00"
    except Exception:
        pass


def scrape_51ca_services(
    max_per_category: int = 6,
    fetch_details: bool = True,
    existing_ids: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """
    Crawls 51.ca Chinese Yellow Pages across the 16 home-service categories,
    clicks into post detail pages for full descriptions and pricing (skipping
    posts already stored in existing_ids), normalizes Chinese pricing formats,
    and translates new content to English.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    collected_by_id: Dict[str, Dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=8) as executor:
        fut_map = {
            executor.submit(_parse_category_page, slug, label, default_cat, max_per_category): slug
            for slug, label, default_cat in CA51_CATEGORIES
        }
        for fut in as_completed(fut_map):
            try:
                batch = fut.result()
                for item in batch:
                    collected_by_id.setdefault(item["post_id"], item)
            except Exception:
                pass

    items = list(collected_by_id.values())
    if not items:
        return []

    if existing_ids:
        new_items = [it for it in items if f"51ca_{it['post_id']}" not in existing_ids]
        seen_items = [it for it in items if f"51ca_{it['post_id']}" in existing_ids]
    else:
        new_items = items
        seen_items = []

    posts: List[Dict[str, Any]] = []

    if new_items:
        if fetch_details:
            with ThreadPoolExecutor(max_workers=8) as detail_exec:
                futs = [detail_exec.submit(_fetch_detail_page, item) for item in new_items]
                for fut in as_completed(futs):
                    try:
                        fut.result()
                    except Exception:
                        pass

        # Prepare texts for batched Chinese -> English translation
        titles_src = [
            f"{it['zh_title']} ({it['zh_tags']})" if it["zh_tags"] else it["zh_title"]
            for it in new_items
        ]
        descs_src = [it["zh_desc"] or it["zh_tags"] or it["zh_title"] for it in new_items]

        en_titles = translate_zh_batch(titles_src)
        en_descs = translate_zh_batch(descs_src)

        for it, en_title, en_desc in zip(new_items, en_titles, en_descs):
            zh_title = it["zh_title"]
            zh_desc = it["zh_desc"] or it["zh_tags"]
            norm_en_title = normalize_zh_prices(en_title or zh_title)
            norm_en_desc = normalize_zh_prices(en_desc or zh_desc)
            neighborhood = _resolve_gta_neighborhood(it["locations"], zh_title, zh_desc)

            combined_body = f"{norm_en_desc}\n[Original ZH]: {normalize_zh_prices(zh_desc)}"
            posts.append(
                {
                    "external_id": f"51ca_{it['post_id']}",
                    "platform": "51ca",
                    "source_detail": f"51.ca Yellow Pages ({it['cat_label']})",
                    "country": "Canada",
                    "province": "Ontario",
                    "city_region": "Toronto / GTA, ON",
                    "neighborhood": neighborhood,
                    "title": f"{norm_en_title} [{zh_title}]",
                    "body": combined_body[:1200],
                    "url": it["url"],
                    "author": it["contact"] or "51ca_provider",
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
                "external_id": f"51ca_{it['post_id']}",
                "platform": "51ca",
                "source_detail": f"51.ca Yellow Pages ({it['cat_label']})",
                "country": "Canada",
                "province": "Ontario",
                "city_region": "Toronto / GTA, ON",
                "title": it["zh_title"],
                "body": "",
                "url": it["url"],
                "_already_stored": True,
            }
        )

    return posts
