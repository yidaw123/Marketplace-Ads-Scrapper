import sqlite3
import json
import os
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, Tuple

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "market_research.db")

DEFAULT_REGIONS = [
    # --- Canada: Ontario ---
    {
        "id": "toronto",
        "name": "Toronto / GTA, ON",
        "city": "Toronto / GTA",
        "province": "Ontario",
        "country": "Canada",
        "craigslist_subdomain": "toronto",
        "subreddits": ["askTO", "toronto", "GTA", "mississauga", "Brampton"],
        "enabled": True,
    },
    {
        "id": "ottawa",
        "name": "Ottawa, ON",
        "city": "Ottawa",
        "province": "Ontario",
        "country": "Canada",
        "craigslist_subdomain": "ottawa",
        "subreddits": ["ottawa"],
        "enabled": True,
    },
    {
        "id": "hamilton",
        "name": "Hamilton / Burlington, ON",
        "city": "Hamilton / Burlington",
        "province": "Ontario",
        "country": "Canada",
        "craigslist_subdomain": "hamilton",
        "subreddits": ["Hamilton", "BurlingtonON"],
        "enabled": True,
    },
    {
        "id": "kitchener",
        "name": "Kitchener / Waterloo, ON",
        "city": "Kitchener / Waterloo",
        "province": "Ontario",
        "country": "Canada",
        "craigslist_subdomain": "kitchener",
        "subreddits": ["waterloo", "kitchener"],
        "enabled": False,
    },
    {
        "id": "london_on",
        "name": "London, ON",
        "city": "London",
        "province": "Ontario",
        "country": "Canada",
        "craigslist_subdomain": "londonon",
        "subreddits": ["londonontario"],
        "enabled": False,
    },
    # --- Canada: British Columbia ---
    {
        "id": "vancouver",
        "name": "Vancouver / Lower Mainland, BC",
        "city": "Vancouver / Lower Mainland",
        "province": "British Columbia",
        "country": "Canada",
        "craigslist_subdomain": "vancouver",
        "subreddits": ["vancouver", "AskVan", "burnaby", "SurreyBC"],
        "enabled": True,
    },
    {
        "id": "victoria",
        "name": "Victoria, BC",
        "city": "Victoria",
        "province": "British Columbia",
        "country": "Canada",
        "craigslist_subdomain": "victoria",
        "subreddits": ["VictoriaBC"],
        "enabled": True,
    },
    {
        "id": "kelowna",
        "name": "Kelowna / Okanagan, BC",
        "city": "Kelowna / Okanagan",
        "province": "British Columbia",
        "country": "Canada",
        "craigslist_subdomain": "kelowna",
        "subreddits": ["kelowna"],
        "enabled": False,
    },
    # --- Canada: Alberta ---
    {
        "id": "calgary",
        "name": "Calgary, AB",
        "city": "Calgary",
        "province": "Alberta",
        "country": "Canada",
        "craigslist_subdomain": "calgary",
        "subreddits": ["Calgary"],
        "enabled": True,
    },
    {
        "id": "edmonton",
        "name": "Edmonton, AB",
        "city": "Edmonton",
        "province": "Alberta",
        "country": "Canada",
        "craigslist_subdomain": "edmonton",
        "subreddits": ["Edmonton"],
        "enabled": True,
    },
    # --- Canada: Quebec ---
    {
        "id": "montreal",
        "name": "Montreal, QC",
        "city": "Montreal",
        "province": "Quebec",
        "country": "Canada",
        "craigslist_subdomain": "montreal",
        "subreddits": ["montreal"],
        "enabled": True,
    },
    {
        "id": "quebec_city",
        "name": "Quebec City, QC",
        "city": "Quebec City",
        "province": "Quebec",
        "country": "Canada",
        "craigslist_subdomain": "quebec",
        "subreddits": ["villedequebec"],
        "enabled": False,
    },
    # --- Canada: Manitoba, Saskatchewan, Nova Scotia ---
    {
        "id": "winnipeg",
        "name": "Winnipeg, MB",
        "city": "Winnipeg",
        "province": "Manitoba",
        "country": "Canada",
        "craigslist_subdomain": "winnipeg",
        "subreddits": ["Winnipeg"],
        "enabled": False,
    },
    {
        "id": "saskatoon",
        "name": "Saskatoon, SK",
        "city": "Saskatoon",
        "province": "Saskatchewan",
        "country": "Canada",
        "craigslist_subdomain": "saskatoon",
        "subreddits": ["saskatoon"],
        "enabled": False,
    },
    {
        "id": "halifax",
        "name": "Halifax, NS",
        "city": "Halifax",
        "province": "Nova Scotia",
        "country": "Canada",
        "craigslist_subdomain": "halifax",
        "subreddits": ["halifax"],
        "enabled": False,
    },
    # --- United States ---
    {
        "id": "sfbay",
        "name": "SF Bay Area, CA",
        "city": "SF Bay Area",
        "province": "California",
        "country": "United States",
        "craigslist_subdomain": "sfbay",
        "subreddits": ["bayarea", "AskSF", "sanfrancisco", "oakland", "SanJose"],
        "enabled": True,
    },
    {
        "id": "austin",
        "name": "Austin, TX",
        "city": "Austin",
        "province": "Texas",
        "country": "United States",
        "craigslist_subdomain": "austin",
        "subreddits": ["Austin", "AskAustin"],
        "enabled": True,
    },
    {
        "id": "nyc",
        "name": "New York City, NY",
        "city": "New York City",
        "province": "New York",
        "country": "United States",
        "craigslist_subdomain": "newyork",
        "subreddits": ["AskNYC", "nyc", "brooklyn", "queens"],
        "enabled": True,
    },
    {
        "id": "la",
        "name": "Los Angeles, CA",
        "city": "Los Angeles",
        "province": "California",
        "country": "United States",
        "craigslist_subdomain": "losangeles",
        "subreddits": ["AskLosAngeles", "LosAngeles"],
        "enabled": True,
    },
    {
        "id": "chicago",
        "name": "Chicago, IL",
        "city": "Chicago",
        "province": "Illinois",
        "country": "United States",
        "craigslist_subdomain": "chicago",
        "subreddits": ["chicago", "AskChicago"],
        "enabled": False,
    },
    {
        "id": "seattle",
        "name": "Seattle, WA",
        "city": "Seattle",
        "province": "Washington",
        "country": "United States",
        "craigslist_subdomain": "seattle",
        "subreddits": ["Seattle", "AskSeattle"],
        "enabled": False,
    },
]

DEFAULT_NATIONAL_SUBREDDITS = [
    "HomeImprovement",
    "DIY",
    "handyman",
    "fixit",
    "homeowners",
    "Plumbing",
    "landscaping",
]

DEFAULT_SEARCH_KEYWORDS = [
    "handyman",
    "plumber",
    "electrician",
    "drywall",
    "yard work",
    "landscaping",
    "carpenter",
    "painter",
    "gutter",
    "mount tv",
    "furniture assembly",
    "fence repair",
]


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            external_id TEXT UNIQUE NOT NULL,
            platform TEXT NOT NULL,
            source_detail TEXT NOT NULL,
            country TEXT DEFAULT 'National',
            province TEXT DEFAULT '',
            city_region TEXT NOT NULL,
            neighborhood TEXT DEFAULT '',
            title TEXT NOT NULL,
            body TEXT DEFAULT '',
            url TEXT NOT NULL,
            author TEXT DEFAULT '',
            contact_name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            website TEXT DEFAULT '',
            price_mention TEXT DEFAULT '',
            posted_at TEXT NOT NULL,
            scraped_at TEXT NOT NULL,
            intent_type TEXT NOT NULL,
            intent_score INTEGER DEFAULT 50,
            primary_category TEXT NOT NULL,
            secondary_categories TEXT DEFAULT '[]',
            urgency TEXT DEFAULT 'medium',
            diy_difficulty TEXT DEFAULT 'moderate',
            extracted_pain_point TEXT DEFAULT '',
            marketing_angle TEXT DEFAULT '',
            classified_by TEXT DEFAULT 'hybrid_rules',
            score INTEGER DEFAULT 0,
            num_comments INTEGER DEFAULT 0
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS scrape_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            platforms TEXT NOT NULL,
            regions TEXT NOT NULL,
            total_fetched INTEGER DEFAULT 0,
            new_stored INTEGER DEFAULT 0,
            demand_leads_found INTEGER DEFAULT 0,
            status TEXT NOT NULL,
            log_summary TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS creators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            creator_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            handle TEXT DEFAULT '',
            primary_platform TEXT NOT NULL,
            profile_url TEXT NOT NULL,
            country TEXT DEFAULT '',
            province_state TEXT DEFAULT '',
            city TEXT DEFAULT '',
            audience_count INTEGER DEFAULT 0,
            audience_text TEXT DEFAULT '',
            audience_tier TEXT DEFAULT 'micro',
            primary_category TEXT NOT NULL,
            sub_service TEXT DEFAULT '',
            secondary_categories TEXT DEFAULT '[]',
            bio TEXT DEFAULT '',
            business_email TEXT DEFAULT '',
            website TEXT DEFAULT '',
            youtube_url TEXT DEFAULT '',
            instagram_url TEXT DEFAULT '',
            tiktok_url TEXT DEFAULT '',
            facebook_url TEXT DEFAULT '',
            x_url TEXT DEFAULT '',
            twitch_url TEXT DEFAULT '',
            bluesky_url TEXT DEFAULT '',
            scraped_at TEXT NOT NULL
        )
        """
    )

    # Schema migration for existing DBs: add country, province, sub_service, price_value, price_type columns if missing
    cur.execute("PRAGMA table_info(posts)")
    existing_cols = {row["name"] for row in cur.fetchall()}
    if "country" not in existing_cols:
        cur.execute("ALTER TABLE posts ADD COLUMN country TEXT DEFAULT 'National'")
    if "province" not in existing_cols:
        cur.execute("ALTER TABLE posts ADD COLUMN province TEXT DEFAULT ''")
    if "sub_service" not in existing_cols:
        cur.execute("ALTER TABLE posts ADD COLUMN sub_service TEXT DEFAULT ''")
    if "price_value" not in existing_cols:
        cur.execute("ALTER TABLE posts ADD COLUMN price_value REAL DEFAULT 0")
    if "price_type" not in existing_cols:
        cur.execute("ALTER TABLE posts ADD COLUMN price_type TEXT DEFAULT ''")
    if "last_seen_at" not in existing_cols:
        cur.execute("ALTER TABLE posts ADD COLUMN last_seen_at TEXT DEFAULT ''")
        cur.execute("UPDATE posts SET last_seen_at = scraped_at WHERE last_seen_at = '' OR last_seen_at IS NULL")
    if "deleted_at" not in existing_cols:
        cur.execute("ALTER TABLE posts ADD COLUMN deleted_at TEXT DEFAULT ''")
    for col_name in ("contact_name", "phone", "email", "website"):
        if col_name not in existing_cols:
            cur.execute(f"ALTER TABLE posts ADD COLUMN {col_name} TEXT DEFAULT ''")

    cur.execute("PRAGMA table_info(creators)")
    existing_creator_cols = {row["name"] for row in cur.fetchall()}
    for col_name in ("province_state", "city"):
        if col_name not in existing_creator_cols:
            cur.execute(f"ALTER TABLE creators ADD COLUMN {col_name} TEXT DEFAULT ''")

    # Seed or upgrade regions setting so new Canadian provinces/cities are always present
    cur.execute("SELECT value FROM settings WHERE key = 'regions'")
    reg_row = cur.fetchone()
    if not reg_row:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            ("regions", json.dumps(DEFAULT_REGIONS)),
        )
    else:
        try:
            saved_regions = json.loads(reg_row["value"])
            saved_by_id = {r["id"]: r for r in saved_regions if isinstance(r, dict) and "id" in r}
            merged_regions = []
            for d in DEFAULT_REGIONS:
                if d["id"] in saved_by_id:
                    merged = {**d, "enabled": saved_by_id[d["id"]].get("enabled", d["enabled"])}
                else:
                    merged = dict(d)
                merged_regions.append(merged)
            cur.execute(
                "UPDATE settings SET value = ? WHERE key = 'regions'",
                (json.dumps(merged_regions),),
            )
        except Exception:
            cur.execute(
                "UPDATE settings SET value = ? WHERE key = 'regions'",
                (json.dumps(DEFAULT_REGIONS),),
            )

    # Backfill country/province on any older rows based on city_region
    for reg in DEFAULT_REGIONS:
        cur.execute(
            "UPDATE posts SET country = ?, province = ? WHERE city_region = ? AND (country IS NULL OR country = '' OR country = 'National')",
            (reg["country"], reg["province"], reg["name"]),
        )
    cur.execute("SELECT COUNT(*) as cnt FROM settings WHERE key = 'national_subreddits'")
    if cur.fetchone()["cnt"] == 0:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            ("national_subreddits", json.dumps(DEFAULT_NATIONAL_SUBREDDITS)),
        )
    cur.execute("SELECT COUNT(*) as cnt FROM settings WHERE key = 'search_keywords'")
    if cur.fetchone()["cnt"] == 0:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            ("search_keywords", json.dumps(DEFAULT_SEARCH_KEYWORDS)),
        )
    cur.execute("SELECT COUNT(*) as cnt FROM settings WHERE key = 'llm_config'")
    if cur.fetchone()["cnt"] == 0:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            (
                "llm_config",
                json.dumps(
                    {
                        "provider": "gemini",
                        "gemini_api_key": os.environ.get("GEMINI_API_KEY", ""),
                        "openai_api_key": os.environ.get("OPENAI_API_KEY", ""),
                        "enable_llm_enrichment": True,
                    }
                ),
            ),
        )

    # One-time cleanup: older versions stored a placeholder Craigslist body containing the search
    # keyword (e.g. "matched query: 'handyman'"), which skewed classification. Blank those out.
    cur.execute(
        "UPDATE posts SET body = '' WHERE platform = 'craigslist' AND body LIKE 'Craigslist % listing in %matched query:%'"
    )
    cur.execute(
        "UPDATE posts SET primary_category = 'Yardwork & Landscaping' WHERE primary_category = 'Gardening & Landscaping'"
    )

    conn.commit()
    conn.close()


def get_setting(key: str, default: Any = None) -> Any:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except Exception:
        return row["value"]


def set_setting(key: str, value: Any) -> None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        (key, json.dumps(value)),
    )
    conn.commit()
    conn.close()


def get_existing_ids(external_ids: List[str]) -> set:
    """Return the subset of external_ids already stored (used to avoid re-paying for LLM enrichment)."""
    if not external_ids:
        return set()
    conn = get_connection()
    cur = conn.cursor()
    found: set = set()
    for i in range(0, len(external_ids), 500):
        chunk = external_ids[i:i + 500]
        cur.execute(
            f"SELECT external_id FROM posts WHERE external_id IN ({','.join('?' * len(chunk))})",
            chunk,
        )
        found.update(r["external_id"] for r in cur.fetchall())
    conn.close()
    return found


def get_all_existing_ids() -> set:
    """Return the full set of external_ids currently stored in the posts table."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT external_id FROM posts")
    found = {r["external_id"] for r in cur.fetchall()}
    conn.close()
    return found


def touch_seen_posts(external_ids: List[str], seen_at_iso: str) -> None:
    """Batch-refresh last_seen_at and clear deleted_at for still-live posts in one transaction."""
    if not external_ids:
        return
    conn = get_connection()
    cur = conn.cursor()
    for i in range(0, len(external_ids), 500):
        chunk = external_ids[i:i + 500]
        placeholders = ",".join("?" * len(chunk))
        cur.execute(
            f"UPDATE posts SET last_seen_at = ?, deleted_at = '' WHERE external_id IN ({placeholders})",
            [seen_at_iso, *chunk],
        )
    conn.commit()
    conn.close()


def upsert_post(post: Dict[str, Any], force: bool = False) -> bool:
    """
    Insert a post or update it if it already exists. Returns True if newly inserted.
    An existing LLM classification is not overwritten by a rules-only classification unless force=True.
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, classified_by FROM posts WHERE external_id = ?", (post["external_id"],))
    existing = cur.fetchone()
    now_iso = datetime.now(timezone.utc).isoformat()

    secondary_json = (
        json.dumps(post.get("secondary_categories", []))
        if isinstance(post.get("secondary_categories"), list)
        else str(post.get("secondary_categories", "[]"))
    )

    if existing:
        # Always refresh engagement + content fields (bodies/dates may have been fetched this time)
        if post.get("body"):
            cur.execute("UPDATE posts SET body = ? WHERE external_id = ?", (post["body"], post["external_id"]))
        if post.get("posted_at_exact") and post.get("posted_at"):
            cur.execute("UPDATE posts SET posted_at = ? WHERE external_id = ?", (post["posted_at"], post["external_id"]))
        if any(k in post for k in ("contact_name", "phone", "email", "website")):
            cur.execute(
                """
                UPDATE posts SET
                    contact_name = ?,
                    phone = ?,
                    email = ?,
                    website = ?
                WHERE external_id = ?
                """,
                (
                    post.get("contact_name", ""),
                    post.get("phone", ""),
                    post.get("email", ""),
                    post.get("website", ""),
                    post["external_id"],
                ),
            )
        if not force:
            cur.execute(
                "UPDATE posts SET score = ?, num_comments = ?, last_seen_at = ?, deleted_at = '' WHERE external_id = ?",
                (post.get("score", 0), post.get("num_comments", 0), now_iso, post["external_id"]),
            )
        else:
            cur.execute(
                "UPDATE posts SET score = ?, num_comments = ? WHERE external_id = ?",
                (post.get("score", 0), post.get("num_comments", 0), post["external_id"]),
            )
        keep_llm = (
            not force
            and str(existing["classified_by"]).endswith("_llm")
            and not str(post.get("classified_by", "")).endswith("_llm")
        )
        if keep_llm:
            conn.commit()
            conn.close()
            return False
        cur.execute(
            """
            UPDATE posts SET
                country = ?,
                province = ?,
                city_region = ?,
                intent_type = ?,
                intent_score = ?,
                primary_category = ?,
                sub_service = ?,
                secondary_categories = ?,
                urgency = ?,
                diy_difficulty = ?,
                extracted_pain_point = ?,
                marketing_angle = ?,
                classified_by = ?,
                price_mention = ?,
                price_value = ?,
                price_type = ?
            WHERE external_id = ?
            """,
            (
                post.get("country", "National"),
                post.get("province", ""),
                post.get("city_region", "National / Online"),
                post.get("intent_type", "diy_help_needed"),
                post.get("intent_score", 50),
                post.get("primary_category", "General Handyman & Odd Jobs"),
                post.get("sub_service", ""),
                secondary_json,
                post.get("urgency", "medium"),
                post.get("diy_difficulty", "moderate"),
                post.get("extracted_pain_point", ""),
                post.get("marketing_angle", ""),
                post.get("classified_by", "hybrid_rules"),
                post.get("price_mention", ""),
                float(post.get("price_value") or 0.0),
                post.get("price_type", ""),
                post["external_id"],
            ),
        )
        conn.commit()
        conn.close()
        return False
    else:
        cur.execute(
            """
            INSERT INTO posts (
                external_id, platform, source_detail, country, province, city_region, neighborhood,
                title, body, url, author, contact_name, phone, email, website,
                price_mention, price_value, price_type, posted_at, scraped_at,
                last_seen_at, deleted_at,
                intent_type, intent_score, primary_category, sub_service, secondary_categories,
                urgency, diy_difficulty, extracted_pain_point, marketing_angle,
                classified_by, score, num_comments
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                post["external_id"],
                post["platform"],
                post.get("source_detail", ""),
                post.get("country", "National"),
                post.get("province", ""),
                post.get("city_region", "National / Online"),
                post.get("neighborhood", ""),
                post["title"],
                post.get("body", ""),
                post["url"],
                post.get("author", "anonymous"),
                post.get("contact_name", ""),
                post.get("phone", ""),
                post.get("email", ""),
                post.get("website", ""),
                post.get("price_mention", ""),
                float(post.get("price_value") or 0.0),
                post.get("price_type", ""),
                post.get("posted_at", now_iso),
                now_iso,
                now_iso,
                "",
                post.get("intent_type", "diy_help_needed"),
                post.get("intent_score", 50),
                post.get("primary_category", "General Handyman & Odd Jobs"),
                post.get("sub_service", ""),
                secondary_json,
                post.get("urgency", "medium"),
                post.get("diy_difficulty", "moderate"),
                post.get("extracted_pain_point", ""),
                post.get("marketing_angle", ""),
                post.get("classified_by", "hybrid_rules"),
                post.get("score", 0),
                post.get("num_comments", 0),
            ),
        )
        conn.commit()
        conn.close()
        return True


def mark_missing_posts_deleted(raw_posts: List[Dict[str, Any]], scrape_timestamp: str) -> int:
    """
    Estimate removal timestamps for posts that were previously seen in a feed
    (platform + source_detail) but are missing when that feed is scraped again.
    """
    if not raw_posts:
        return 0

    grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for p in raw_posts:
        key = (p.get("platform", ""), p.get("source_detail", ""))
        if key[0] and key[1]:
            grouped.setdefault(key, []).append(p)

    conn = get_connection()
    cur = conn.cursor()
    deleted_count = 0

    for (platform, source_detail), batch in grouped.items():
        seen_ids = {p["external_id"] for p in batch if p.get("external_id")}
        posted_dates = [str(p.get("posted_at") or "") for p in batch if p.get("posted_at")]
        min_posted_at = min(posted_dates) if posted_dates else ""

        cur.execute(
            """
            SELECT external_id, posted_at
            FROM posts
            WHERE platform = ?
              AND source_detail = ?
              AND (deleted_at IS NULL OR deleted_at = '')
            """,
            (platform, source_detail),
        )
        for row in cur.fetchall():
            ext_id = row["external_id"]
            if ext_id in seen_ids:
                continue
            row_posted = str(row["posted_at"] or "")
            if platform in ("kijiji", "craigslist", "51ca", "bark") or (min_posted_at and row_posted >= min_posted_at):
                cur.execute(
                    "UPDATE posts SET deleted_at = ? WHERE external_id = ?",
                    (scrape_timestamp, ext_id),
                )
                deleted_count += 1

    conn.commit()
    conn.close()
    return deleted_count


def query_posts(
    platform: Optional[str] = None,
    intent_type: Optional[str] = None,
    category: Optional[str] = None,
    sub_service: Optional[str] = None,
    country: Optional[str] = None,
    province: Optional[str] = None,
    city_region: Optional[str] = None,
    urgency: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    min_score: int = 0,
    limit: int = 2500,
) -> List[Dict[str, Any]]:
    conn = get_connection()
    cur = conn.cursor()

    clauses = ["intent_score >= ?"]
    params: List[Any] = [min_score]

    if platform and platform != "all":
        clauses.append("platform = ?")
        params.append(platform)

    if intent_type and intent_type != "all":
        if intent_type == "demand_only":
            clauses.append("intent_type IN ('customer_hiring', 'diy_help_needed')")
        elif intent_type == "hiring_and_supply":
            clauses.append("intent_type IN ('customer_hiring', 'service_provider_ad')")
        else:
            clauses.append("intent_type = ?")
            params.append(intent_type)

    if category and category != "all":
        clauses.append("primary_category = ?")
        params.append(category)

    if sub_service and sub_service != "all":
        clauses.append("sub_service = ?")
        params.append(sub_service)

    if country and country != "all":
        clauses.append("country = ?")
        params.append(country)

    if province and province != "all":
        clauses.append("province = ?")
        params.append(province)

    if city_region and city_region != "all":
        clauses.append("city_region = ?")
        params.append(city_region)

    if urgency and urgency != "all":
        clauses.append("urgency = ?")
        params.append(urgency)

    if search and search.strip():
        q = f"%{search.strip()}%"
        clauses.append("(title LIKE ? OR body LIKE ? OR neighborhood LIKE ? OR source_detail LIKE ?)")
        params.extend([q, q, q, q])

    if date_from and date_from.strip():
        clauses.append("substr(posted_at, 1, 10) >= ?")
        params.append(date_from.strip()[:10])

    if date_to and date_to.strip():
        clauses.append("substr(posted_at, 1, 10) <= ?")
        params.append(date_to.strip()[:10])

    where_sql = " AND ".join(clauses)
    sql = f"""
        SELECT * FROM posts
        WHERE {where_sql}
        ORDER BY
            CASE WHEN intent_type = 'customer_hiring' THEN 0
                 WHEN intent_type = 'diy_help_needed' THEN 1
                 ELSE 2 END ASC,
            intent_score DESC,
            posted_at DESC
        LIMIT ?
    """
    params.append(limit)
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        try:
            r["secondary_categories"] = json.loads(r.get("secondary_categories") or "[]")
        except Exception:
            r["secondary_categories"] = []
    conn.close()
    return rows


def get_analytics_summary(
    country: Optional[str] = None,
    province: Optional[str] = None,
    city_region: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Dict[str, Any]:
    conn = get_connection()
    cur = conn.cursor()

    geo_clauses: List[str] = []
    geo_params: List[Any] = []
    if country and country != "all":
        geo_clauses.append("country = ?")
        geo_params.append(country)
    if province and province != "all":
        geo_clauses.append("province = ?")
        geo_params.append(province)
    if city_region and city_region != "all":
        geo_clauses.append("city_region = ?")
        geo_params.append(city_region)
    if date_from and date_from.strip():
        geo_clauses.append("substr(posted_at, 1, 10) >= ?")
        geo_params.append(date_from.strip()[:10])
    if date_to and date_to.strip():
        geo_clauses.append("substr(posted_at, 1, 10) <= ?")
        geo_params.append(date_to.strip()[:10])

    where_geo_only = ("WHERE " + " AND ".join(geo_clauses)) if geo_clauses else ""
    where_not_irr = "WHERE intent_type != 'irrelevant'" + ((" AND " + " AND ".join(geo_clauses)) if geo_clauses else "")
    where_demand = "WHERE intent_type IN ('customer_hiring', 'diy_help_needed')" + ((" AND " + " AND ".join(geo_clauses)) if geo_clauses else "")

    # Total counts by intent
    cur.execute(
        f"""
        SELECT intent_type, COUNT(*) as count
        FROM posts
        {where_geo_only}
        GROUP BY intent_type
        """,
        geo_params,
    )
    intent_counts = {r["intent_type"]: r["count"] for r in cur.fetchall()}

    # Demand breakdown by service category (customer_hiring + diy_help_needed vs service_provider_ad)
    cur.execute(
        f"""
        SELECT
            primary_category,
            SUM(CASE WHEN intent_type = 'customer_hiring' THEN 1 ELSE 0 END) as hiring_count,
            SUM(CASE WHEN intent_type = 'diy_help_needed' THEN 1 ELSE 0 END) as diy_count,
            SUM(CASE WHEN intent_type IN ('customer_hiring', 'diy_help_needed') THEN 1 ELSE 0 END) as total_demand,
            SUM(CASE WHEN intent_type = 'service_provider_ad' THEN 1 ELSE 0 END) as provider_supply,
            ROUND(AVG(CASE WHEN intent_type IN ('customer_hiring', 'diy_help_needed') THEN intent_score ELSE NULL END), 1) as avg_intent_score
        FROM posts
        {where_not_irr}
        GROUP BY primary_category
        ORDER BY total_demand DESC, hiring_count DESC
        """,
        geo_params,
    )
    category_breakdown = [dict(r) for r in cur.fetchall()]

    # Regional breakdown
    cur.execute(
        f"""
        SELECT
            city_region,
            province,
            country,
            SUM(CASE WHEN intent_type = 'customer_hiring' THEN 1 ELSE 0 END) as hiring_count,
            SUM(CASE WHEN intent_type = 'diy_help_needed' THEN 1 ELSE 0 END) as diy_count,
            SUM(CASE WHEN intent_type IN ('customer_hiring', 'diy_help_needed') THEN 1 ELSE 0 END) as total_demand,
            SUM(CASE WHEN intent_type = 'service_provider_ad' THEN 1 ELSE 0 END) as provider_supply
        FROM posts
        {where_not_irr}
        GROUP BY city_region, province, country
        ORDER BY total_demand DESC
        """,
        geo_params,
    )
    region_breakdown = [dict(r) for r in cur.fetchall()]

    # Platform breakdown
    cur.execute(
        f"""
        SELECT
            platform,
            SUM(CASE WHEN intent_type = 'customer_hiring' THEN 1 ELSE 0 END) as hiring_count,
            SUM(CASE WHEN intent_type = 'diy_help_needed' THEN 1 ELSE 0 END) as diy_count,
            SUM(CASE WHEN intent_type = 'service_provider_ad' THEN 1 ELSE 0 END) as provider_supply,
            COUNT(*) as total
        FROM posts
        {where_not_irr}
        GROUP BY platform
        """,
        geo_params,
    )
    platform_breakdown = [dict(r) for r in cur.fetchall()]

    # Top neighborhoods / subreddits for customer demand
    cur.execute(
        f"""
        SELECT
            source_detail,
            platform,
            city_region,
            COUNT(*) as demand_count,
            SUM(CASE WHEN intent_type = 'customer_hiring' THEN 1 ELSE 0 END) as direct_hiring
        FROM posts
        {where_demand}
        GROUP BY source_detail, platform, city_region
        ORDER BY direct_hiring DESC, demand_count DESC
        LIMIT 12
        """,
        geo_params,
    )
    top_channels = [dict(r) for r in cur.fetchall()]

    # Recent scrape runs
    cur.execute("SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 5")
    recent_runs = [dict(r) for r in cur.fetchall()]

    # Sub-service (Task Category) & Pricing breakdown
    # Benchmark criteria: excludes job_posting (employee wages), Hourly $25-$250/hr, Flat Fee $45-$5,000
    cur.execute(
        f"""
        SELECT
            primary_category,
            sub_service,
            SUM(CASE WHEN intent_type = 'customer_hiring' THEN 1 ELSE 0 END) as hiring_count,
            SUM(CASE WHEN intent_type = 'diy_help_needed' THEN 1 ELSE 0 END) as diy_count,
            SUM(CASE WHEN intent_type IN ('customer_hiring', 'diy_help_needed') THEN 1 ELSE 0 END) as total_demand,
            SUM(CASE WHEN intent_type = 'service_provider_ad' THEN 1 ELSE 0 END) as provider_supply,
            COUNT(CASE WHEN intent_type != 'job_posting' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN 1 END) as hourly_count,
            ROUND(AVG(CASE WHEN intent_type != 'job_posting' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as avg_hourly,
            ROUND(MIN(CASE WHEN intent_type != 'job_posting' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as min_hourly,
            ROUND(MAX(CASE WHEN intent_type != 'job_posting' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as max_hourly,
            COUNT(CASE WHEN intent_type != 'job_posting' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN 1 END) as flat_count,
            ROUND(AVG(CASE WHEN intent_type != 'job_posting' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as avg_flat,
            ROUND(MIN(CASE WHEN intent_type != 'job_posting' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as min_flat,
            ROUND(MAX(CASE WHEN intent_type != 'job_posting' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as max_flat,
            COUNT(CASE WHEN intent_type = 'customer_hiring' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN 1 END) as hiring_hourly_count,
            ROUND(AVG(CASE WHEN intent_type = 'customer_hiring' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as hiring_avg_hourly,
            ROUND(MIN(CASE WHEN intent_type = 'customer_hiring' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as hiring_min_hourly,
            ROUND(MAX(CASE WHEN intent_type = 'customer_hiring' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as hiring_max_hourly,
            COUNT(CASE WHEN intent_type = 'customer_hiring' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN 1 END) as hiring_flat_count,
            ROUND(AVG(CASE WHEN intent_type = 'customer_hiring' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as hiring_avg_flat,
            ROUND(MIN(CASE WHEN intent_type = 'customer_hiring' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as hiring_min_flat,
            ROUND(MAX(CASE WHEN intent_type = 'customer_hiring' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as hiring_max_flat,
            COUNT(CASE WHEN intent_type = 'service_provider_ad' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN 1 END) as supply_hourly_count,
            ROUND(AVG(CASE WHEN intent_type = 'service_provider_ad' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as supply_avg_hourly,
            ROUND(MIN(CASE WHEN intent_type = 'service_provider_ad' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as supply_min_hourly,
            ROUND(MAX(CASE WHEN intent_type = 'service_provider_ad' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as supply_max_hourly,
            COUNT(CASE WHEN intent_type = 'service_provider_ad' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN 1 END) as supply_flat_count,
            ROUND(AVG(CASE WHEN intent_type = 'service_provider_ad' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as supply_avg_flat,
            ROUND(MIN(CASE WHEN intent_type = 'service_provider_ad' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as supply_min_flat,
            ROUND(MAX(CASE WHEN intent_type = 'service_provider_ad' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as supply_max_flat,
            MAX(posted_at) as latest_posted_at
        FROM posts
        {where_not_irr}
        GROUP BY primary_category, sub_service
        ORDER BY total_demand DESC, hiring_count DESC
        """,
        geo_params,
    )
    sub_service_breakdown = [dict(r) for r in cur.fetchall()]

    cur.execute(
        f"""
        SELECT
            primary_category,
            COUNT(CASE WHEN intent_type != 'job_posting' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN 1 END) as hourly_count,
            ROUND(AVG(CASE WHEN intent_type != 'job_posting' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as avg_hourly,
            ROUND(MIN(CASE WHEN intent_type != 'job_posting' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as min_hourly,
            ROUND(MAX(CASE WHEN intent_type != 'job_posting' AND price_type = 'hourly' AND price_value BETWEEN 25 AND 250 THEN price_value END), 0) as max_hourly,
            COUNT(CASE WHEN intent_type != 'job_posting' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN 1 END) as flat_count,
            ROUND(AVG(CASE WHEN intent_type != 'job_posting' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as avg_flat,
            ROUND(MIN(CASE WHEN intent_type != 'job_posting' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as min_flat,
            ROUND(MAX(CASE WHEN intent_type != 'job_posting' AND price_type = 'flat' AND price_value BETWEEN 45 AND 5000 THEN price_value END), 0) as max_flat
        FROM posts
        {where_not_irr}
        GROUP BY primary_category
        ORDER BY (hourly_count + flat_count) DESC
        """,
        geo_params,
    )
    pricing_by_category = [dict(r) for r in cur.fetchall()]

    conn.close()

    total_hiring = intent_counts.get("customer_hiring", 0)
    total_diy = intent_counts.get("diy_help_needed", 0)
    total_supply = intent_counts.get("service_provider_ad", 0)
    total_jobs = intent_counts.get("job_posting", 0)
    total_demand = total_hiring + total_diy

    return {
        "kpis": {
            "total_posts": sum(intent_counts.values()),
            "total_demand_leads": total_demand,
            "direct_hiring_leads": total_hiring,
            "diy_conversion_leads": total_diy,
            "competitor_supply_ads": total_supply,
            "job_postings": total_jobs,
        },
        "category_breakdown": category_breakdown,
        "sub_service_breakdown": sub_service_breakdown,
        "pricing_by_category": pricing_by_category,
        "region_breakdown": region_breakdown,
        "platform_breakdown": platform_breakdown,
        "top_channels": top_channels,
        "recent_runs": recent_runs,
    }


def get_demand_trends(
    period: str = "1Y",
    country: Optional[str] = None,
    province: Optional[str] = None,
    city_region: Optional[str] = None,
    intent_type: Optional[str] = None,
    categories_list: Optional[List[str]] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Returns stock-market style time-series and seasonality demand data broken down
    by work category.
    Supported periods: '7D', '1M', '3M', '6M', '1Y', 'ALL', 'YTD', 'SEASONALITY', 'CUSTOM'
    """
    conn = get_connection()
    cur = conn.cursor()

    clauses: List[str] = []
    params: List[Any] = []
    if not intent_type or intent_type == "demand_only":
        clauses.append("intent_type IN ('customer_hiring', 'diy_help_needed')")
    elif intent_type == "hiring_and_supply":
        clauses.append("intent_type IN ('customer_hiring', 'service_provider_ad')")
    elif intent_type == "all":
        clauses.append("intent_type != 'irrelevant'")
    else:
        clauses.append("intent_type = ?")
        params.append(intent_type)
    if country and country != "all":
        clauses.append("country = ?")
        params.append(country)
    if province and province != "all":
        clauses.append("province = ?")
        params.append(province)
    if city_region and city_region != "all":
        clauses.append("city_region = ?")
        params.append(city_region)

    where_sql = "WHERE " + " AND ".join(clauses)
    cur.execute(
        f"SELECT posted_at, primary_category, intent_type FROM posts {where_sql}",
        params,
    )
    rows = cur.fetchall()
    conn.close()

    default_cats = categories_list or [
        "Plumbing & Drain",
        "Electrical & Lighting",
        "Yardwork & Landscaping",
        "Painting & Drywall",
        "Carpentry, Doors & Windows",
        "Mounting & Furniture Assembly",
        "Roofing, Siding & Gutters",
        "Flooring & Tile",
        "Appliance & HVAC Repair",
        "General Handyman & Odd Jobs",
    ]
    all_series_keys = ["All Demand"] + default_cats

    # Parse dates safely
    parsed_rows = []
    max_dt: Optional[datetime] = None
    min_dt: Optional[datetime] = None
    for r in rows:
        raw_dt = str(r["posted_at"] or "")[:19]
        if len(raw_dt) < 10:
            continue
        try:
            dt = datetime.strptime(raw_dt[:10], "%Y-%m-%d")
            parsed_rows.append((dt, r["primary_category"]))
            if max_dt is None or dt > max_dt:
                max_dt = dt
            if min_dt is None or dt < min_dt:
                min_dt = dt
        except ValueError:
            continue

    today_dt = datetime.now(timezone.utc).replace(tzinfo=None)
    if max_dt is None:
        max_dt = today_dt
    if min_dt is None:
        min_dt = max_dt

    period_norm = (period or "1Y").upper()
    month_abbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    buckets: List[Dict[str, str]] = []
    if period_norm in ("YTD", "SEASONALITY"):
        end_month = max_dt.month
        for m_idx in range(1, end_month + 1):
            buckets.append({"key": f"{m_idx:02d}", "label": month_abbr[m_idx - 1]})
        series = {k: [0] * end_month for k in all_series_keys}
        for dt, cat in parsed_rows:
            if dt.year == max_dt.year and 1 <= dt.month <= end_month:
                b_idx = dt.month - 1
                series["All Demand"][b_idx] += 1
                if cat in series:
                    series[cat][b_idx] += 1
    elif period_norm == "CUSTOM":
        try:
            start_dt = datetime.strptime(date_from.strip()[:10], "%Y-%m-%d") if (date_from and date_from.strip()) else min_dt
        except ValueError:
            start_dt = min_dt
        try:
            end_dt = datetime.strptime(date_to.strip()[:10], "%Y-%m-%d") if (date_to and date_to.strip()) else today_dt
        except ValueError:
            end_dt = today_dt
        if start_dt > end_dt:
            start_dt, end_dt = end_dt, start_dt

        span_days = max(1, (end_dt - start_dt).days + 1)
        if span_days <= 45:
            key_to_idx: Dict[str, int] = {}
            for i in range(span_days):
                d = start_dt + timedelta(days=i)
                k = d.strftime("%Y-%m-%d")
                lbl = f"{month_abbr[d.month - 1]} {d.day:02d}"
                key_to_idx[k] = i
                buckets.append({"key": k, "label": lbl})
            series = {k: [0] * span_days for k in all_series_keys}
            for dt, cat in parsed_rows:
                k = dt.strftime("%Y-%m-%d")
                if k in key_to_idx:
                    idx = key_to_idx[k]
                    series["All Demand"][idx] += 1
                    if cat in series:
                        series[cat][idx] += 1
        elif span_days <= 210:
            num_weeks = max(1, (span_days + 6) // 7)
            for w in range(num_weeks):
                w_start = start_dt + timedelta(days=w * 7)
                w_end = min(end_dt, w_start + timedelta(days=6))
                lbl = f"{month_abbr[w_end.month - 1]} {w_end.day:02d}"
                buckets.append({"key": w_end.strftime("%Y-%m-%d"), "label": lbl})
            series = {k: [0] * num_weeks for k in all_series_keys}
            for dt, cat in parsed_rows:
                if start_dt <= dt <= end_dt:
                    w_idx = min(num_weeks - 1, (dt - start_dt).days // 7)
                    series["All Demand"][w_idx] += 1
                    if cat in series:
                        series[cat][w_idx] += 1
        else:
            key_to_idx = {}
            y, m = start_dt.year, start_dt.month
            month_list = []
            while (y, m) <= (end_dt.year, end_dt.month):
                month_list.append((y, m))
                m += 1
                if m > 12:
                    m = 1
                    y += 1
            for idx, (yy, mm) in enumerate(month_list):
                k = f"{yy:04d}-{mm:02d}"
                lbl = f"{month_abbr[mm - 1]} '{str(yy)[2:]}"
                key_to_idx[k] = idx
                buckets.append({"key": k, "label": lbl})
            series = {k: [0] * len(month_list) for k in all_series_keys}
            for dt, cat in parsed_rows:
                if start_dt <= dt <= end_dt:
                    k = f"{dt.year:04d}-{dt.month:02d}"
                    if k in key_to_idx:
                        idx = key_to_idx[k]
                        series["All Demand"][idx] += 1
                        if cat in series:
                            series[cat][idx] += 1
    elif period_norm in ("7D", "1M"):
        num_days = 7 if period_norm == "7D" else 30
        start_dt = max_dt - timedelta(days=num_days - 1)
        key_to_idx: Dict[str, int] = {}
        for i in range(num_days):
            d = start_dt + timedelta(days=i)
            k = d.strftime("%Y-%m-%d")
            lbl = f"{month_abbr[d.month - 1]} {d.day:02d}"
            key_to_idx[k] = i
            buckets.append({"key": k, "label": lbl})
        series = {k: [0] * num_days for k in all_series_keys}
        for dt, cat in parsed_rows:
            k = dt.strftime("%Y-%m-%d")
            if k in key_to_idx:
                idx = key_to_idx[k]
                series["All Demand"][idx] += 1
                if cat in series:
                    series[cat][idx] += 1
    elif period_norm in ("3M", "6M"):
        num_weeks = 13 if period_norm == "3M" else 26
        # Align end of last 7-day bucket to max_dt
        start_dt = max_dt - timedelta(days=num_weeks * 7 - 1)
        for w in range(num_weeks):
            w_start = start_dt + timedelta(days=w * 7)
            w_end = w_start + timedelta(days=6)
            lbl = f"{month_abbr[w_end.month - 1]} {w_end.day:02d}"
            buckets.append({"key": w_end.strftime("%Y-%m-%d"), "label": lbl})
        series = {k: [0] * num_weeks for k in all_series_keys}
        for dt, cat in parsed_rows:
            delta_days = (dt - start_dt).days
            if 0 <= delta_days < num_weeks * 7:
                w_idx = delta_days // 7
                series["All Demand"][w_idx] += 1
                if cat in series:
                    series[cat][w_idx] += 1
    else:
        # '1Y' (12 months) or 'ALL' (24 months up to max_dt)
        num_months = 12 if period_norm == "1Y" else 24
        end_y, end_m = max_dt.year, max_dt.month
        key_to_idx = {}
        month_list = []
        y, m = end_y, end_m
        for _ in range(num_months):
            month_list.append((y, m))
            m -= 1
            if m == 0:
                m = 12
                y -= 1
        month_list.reverse()
        for idx, (yy, mm) in enumerate(month_list):
            k = f"{yy:04d}-{mm:02d}"
            lbl = f"{month_abbr[mm - 1]} '{str(yy)[2:]}"
            key_to_idx[k] = idx
            buckets.append({"key": k, "label": lbl})
        series = {k: [0] * num_months for k in all_series_keys}
        for dt, cat in parsed_rows:
            k = f"{dt.year:04d}-{dt.month:02d}"
            if k in key_to_idx:
                idx = key_to_idx[k]
                series["All Demand"][idx] += 1
                if cat in series:
                    series[cat][idx] += 1

    if period_norm == "ALL":
        totals = {k: 0 for k in all_series_keys}
        for _dt, cat in parsed_rows:
            totals["All Demand"] += 1
            if cat in totals:
                totals[cat] += 1
    else:
        totals = {k: sum(vals) for k, vals in series.items()}
    return {
        "period": period_norm,
        "buckets": buckets,
        "series": series,
        "totals": totals,
        "categories": default_cats,
        "min_date": min_dt.strftime("%Y-%m-%d"),
        "max_date": today_dt.strftime("%Y-%m-%d"),
        "latest_month_label": month_abbr[max_dt.month - 1],
    }


def get_all_creator_ids() -> set:
    """Return all creator_ids currently stored in the creators table."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT creator_id FROM creators")
    found = {r["creator_id"] for r in cur.fetchall()}
    conn.close()
    return found


def upsert_creator(creator: Dict[str, Any]) -> bool:
    """Insert or update a DIY affiliate creator row by creator_id. Returns True if newly inserted."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id FROM creators WHERE creator_id = ?", (creator["creator_id"],))
    existing = cur.fetchone()
    now_iso = datetime.now(timezone.utc).isoformat()

    secondary_json = (
        json.dumps(creator.get("secondary_categories", []))
        if isinstance(creator.get("secondary_categories"), list)
        else str(creator.get("secondary_categories", "[]"))
    )

    country_val = (creator.get("country") or "").strip()
    prov_val = (creator.get("province_state") or "").strip() if country_val in ("United States", "Canada") else ""
    city_val = (creator.get("city") or "").strip() if country_val in ("United States", "Canada") else ""

    if existing:
        cur.execute(
            """
            UPDATE creators SET
                name = ?,
                handle = ?,
                primary_platform = ?,
                profile_url = ?,
                country = ?,
                province_state = ?,
                city = ?,
                audience_count = ?,
                audience_text = ?,
                audience_tier = ?,
                primary_category = ?,
                sub_service = ?,
                secondary_categories = ?,
                bio = ?,
                business_email = ?,
                website = ?,
                youtube_url = ?,
                instagram_url = ?,
                tiktok_url = ?,
                facebook_url = ?,
                x_url = ?,
                twitch_url = ?,
                bluesky_url = ?,
                scraped_at = ?
            WHERE creator_id = ?
            """,
            (
                creator.get("name", ""),
                creator.get("handle", ""),
                creator.get("primary_platform", "youtube"),
                creator.get("profile_url", ""),
                country_val,
                prov_val,
                city_val,
                int(creator.get("audience_count") or 0),
                creator.get("audience_text", ""),
                creator.get("audience_tier", "micro"),
                creator.get("primary_category", "General Handyman & Odd Jobs"),
                creator.get("sub_service", ""),
                secondary_json,
                creator.get("bio", ""),
                creator.get("business_email", ""),
                creator.get("website", ""),
                creator.get("youtube_url", ""),
                creator.get("instagram_url", ""),
                creator.get("tiktok_url", ""),
                creator.get("facebook_url", ""),
                creator.get("x_url", ""),
                creator.get("twitch_url", ""),
                creator.get("bluesky_url", ""),
                now_iso,
                creator["creator_id"],
            ),
        )
        conn.commit()
        conn.close()
        return False

    cur.execute(
        """
        INSERT INTO creators (
            creator_id, name, handle, primary_platform, profile_url, country, province_state, city,
            audience_count, audience_text, audience_tier, primary_category, sub_service,
            secondary_categories, bio, business_email, website,
            youtube_url, instagram_url, tiktok_url, facebook_url, x_url, twitch_url, bluesky_url,
            scraped_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            creator["creator_id"],
            creator.get("name", ""),
            creator.get("handle", ""),
            creator.get("primary_platform", "youtube"),
            creator.get("profile_url", ""),
            country_val,
            prov_val,
            city_val,
            int(creator.get("audience_count") or 0),
            creator.get("audience_text", ""),
            creator.get("audience_tier", "micro"),
            creator.get("primary_category", "General Handyman & Odd Jobs"),
            creator.get("sub_service", ""),
            secondary_json,
            creator.get("bio", ""),
            creator.get("business_email", ""),
            creator.get("website", ""),
            creator.get("youtube_url", ""),
            creator.get("instagram_url", ""),
            creator.get("tiktok_url", ""),
            creator.get("facebook_url", ""),
            creator.get("x_url", ""),
            creator.get("twitch_url", ""),
            creator.get("bluesky_url", ""),
            now_iso,
        ),
    )
    conn.commit()
    conn.close()
    return True


def query_creators(
    category: Optional[str] = None,
    sub_service: Optional[str] = None,
    social_platform: Optional[str] = None,
    tier: Optional[str] = None,
    contact_filter: Optional[str] = None,
    country: Optional[str] = None,
    province_state: Optional[str] = None,
    city: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    """Query DIY affiliate creators filtered by trade/task category, social presence, tier, geo, and contact availability."""
    conn = get_connection()
    cur = conn.cursor()

    clauses: List[str] = ["1=1"]
    params: List[Any] = []

    if category and category != "all":
        clauses.append("primary_category = ?")
        params.append(category)

    if sub_service and sub_service != "all":
        clauses.append("sub_service = ?")
        params.append(sub_service)

    plat_col_map = {
        "instagram": "instagram_url",
        "tiktok": "tiktok_url",
        "youtube": "youtube_url",
        "facebook": "facebook_url",
        "x": "x_url",
        "twitch": "twitch_url",
        "bluesky": "bluesky_url",
    }
    if social_platform and social_platform in plat_col_map:
        col = plat_col_map[social_platform]
        clauses.append(f"COALESCE({col}, '') != ''")

    if tier and tier != "all":
        if tier == "micro_mid":
            clauses.append("audience_tier IN ('micro', 'mid')")
        else:
            clauses.append("audience_tier = ?")
            params.append(tier)

    if contact_filter == "has_email":
        clauses.append("COALESCE(business_email, '') != ''")
    elif contact_filter == "has_contact":
        clauses.append("(COALESCE(business_email, '') != '' OR COALESCE(website, '') != '')")

    if country and country != "all":
        if country == "Other":
            clauses.append("COALESCE(country, '') NOT IN ('Canada', 'United States')")
        elif country == "North America":
            clauses.append("country IN ('Canada', 'United States')")
        else:
            clauses.append("country = ?")
            params.append(country)

    if province_state and province_state != "all":
        clauses.append("province_state = ?")
        params.append(province_state)

    if city and city != "all":
        clauses.append("city = ?")
        params.append(city)

    if search and search.strip():
        q = f"%{search.strip()}%"
        clauses.append(
            "(name LIKE ? OR handle LIKE ? OR bio LIKE ? OR business_email LIKE ? OR website LIKE ? "
            "OR country LIKE ? OR province_state LIKE ? OR city LIKE ?)"
        )
        params.extend([q, q, q, q, q, q, q, q])

    where_sql = " AND ".join(clauses)
    sql = f"""
        SELECT * FROM creators
        WHERE {where_sql}
        ORDER BY
            (CASE WHEN COALESCE(business_email, '') != '' THEN 0 ELSE 1 END) ASC,
            audience_count DESC
        LIMIT ?
    """
    params.append(limit)
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        try:
            r["secondary_categories"] = json.loads(r.get("secondary_categories") or "[]")
        except Exception:
            r["secondary_categories"] = []
    conn.close()
    return rows


def get_creators_summary() -> Dict[str, Any]:
    """Return KPI counts, all social platform counts, tier counts, US/CA geo options, and trade breakdown."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT
            COUNT(*) as total_creators,
            SUM(CASE WHEN COALESCE(business_email, '') != '' THEN 1 ELSE 0 END) as with_email,
            SUM(CASE WHEN COALESCE(youtube_url, '') != '' THEN 1 ELSE 0 END) as on_youtube,
            SUM(CASE WHEN COALESCE(instagram_url, '') != '' THEN 1 ELSE 0 END) as on_instagram,
            SUM(CASE WHEN COALESCE(tiktok_url, '') != '' THEN 1 ELSE 0 END) as on_tiktok,
            SUM(CASE WHEN COALESCE(facebook_url, '') != '' THEN 1 ELSE 0 END) as on_facebook,
            SUM(CASE WHEN COALESCE(x_url, '') != '' THEN 1 ELSE 0 END) as on_x,
            SUM(CASE WHEN COALESCE(twitch_url, '') != '' THEN 1 ELSE 0 END) as on_twitch,
            SUM(CASE WHEN COALESCE(bluesky_url, '') != '' THEN 1 ELSE 0 END) as on_bluesky,
            SUM(CASE WHEN COALESCE(x_url, '') != '' OR COALESCE(facebook_url, '') != '' OR COALESCE(twitch_url, '') != '' THEN 1 ELSE 0 END) as on_x_fb_twitch,
            SUM(CASE WHEN audience_tier IN ('micro', 'mid') THEN 1 ELSE 0 END) as micro_mid_tier,
            SUM(CASE WHEN country IN ('Canada', 'United States') THEN 1 ELSE 0 END) as north_america,
            SUM(CASE WHEN audience_tier = 'nano' THEN 1 ELSE 0 END) as tier_nano,
            SUM(CASE WHEN audience_tier = 'micro' THEN 1 ELSE 0 END) as tier_micro,
            SUM(CASE WHEN audience_tier = 'mid' THEN 1 ELSE 0 END) as tier_mid,
            SUM(CASE WHEN audience_tier = 'macro' THEN 1 ELSE 0 END) as tier_macro,
            SUM(CASE WHEN audience_tier = 'mega' THEN 1 ELSE 0 END) as tier_mega
        FROM creators
        """
    )
    kpi_row = cur.fetchone()
    kpis = {
        "total_creators": (kpi_row["total_creators"] or 0) if kpi_row else 0,
        "with_email": (kpi_row["with_email"] or 0) if kpi_row else 0,
        "on_youtube": (kpi_row["on_youtube"] or 0) if kpi_row else 0,
        "on_instagram": (kpi_row["on_instagram"] or 0) if kpi_row else 0,
        "on_tiktok": (kpi_row["on_tiktok"] or 0) if kpi_row else 0,
        "on_facebook": (kpi_row["on_facebook"] or 0) if kpi_row else 0,
        "on_x": (kpi_row["on_x"] or 0) if kpi_row else 0,
        "on_twitch": (kpi_row["on_twitch"] or 0) if kpi_row else 0,
        "on_bluesky": (kpi_row["on_bluesky"] or 0) if kpi_row else 0,
        "on_x_fb_twitch": (kpi_row["on_x_fb_twitch"] or 0) if kpi_row else 0,
        "micro_mid_tier": (kpi_row["micro_mid_tier"] or 0) if kpi_row else 0,
        "north_america": (kpi_row["north_america"] or 0) if kpi_row else 0,
    }
    tier_counts = {
        "nano": (kpi_row["tier_nano"] or 0) if kpi_row else 0,
        "micro": (kpi_row["tier_micro"] or 0) if kpi_row else 0,
        "mid": (kpi_row["tier_mid"] or 0) if kpi_row else 0,
        "macro": (kpi_row["tier_macro"] or 0) if kpi_row else 0,
        "mega": (kpi_row["tier_mega"] or 0) if kpi_row else 0,
    }

    cur.execute(
        """
        SELECT DISTINCT country, province_state, city
        FROM creators
        WHERE country IN ('United States', 'Canada')
        """
    )
    provinces_by_country: Dict[str, set] = {"United States": set(), "Canada": set()}
    cities_by_country: Dict[str, set] = {"United States": set(), "Canada": set()}
    cities_by_province: Dict[str, set] = {}
    all_provinces: set = set()
    all_cities: set = set()
    for row in cur.fetchall():
        ctry = (row["country"] or "").strip()
        prov = (row["province_state"] or "").strip()
        city_val_row = (row["city"] or "").strip()
        if prov:
            provinces_by_country.setdefault(ctry, set()).add(prov)
            all_provinces.add(prov)
        if city_val_row:
            cities_by_country.setdefault(ctry, set()).add(city_val_row)
            all_cities.add(city_val_row)
            if prov:
                cities_by_province.setdefault(prov, set()).add(city_val_row)

    geo_options = {
        "provinces_by_country": {k: sorted(v) for k, v in provinces_by_country.items()},
        "cities_by_country": {k: sorted(v) for k, v in cities_by_country.items()},
        "cities_by_province": {k: sorted(v) for k, v in cities_by_province.items()},
        "all_provinces": sorted(all_provinces),
        "all_cities": sorted(all_cities),
    }

    cur.execute(
        """
        SELECT
            primary_category,
            COUNT(*) as total_creators,
            SUM(CASE WHEN COALESCE(business_email, '') != '' THEN 1 ELSE 0 END) as with_email,
            SUM(CASE WHEN COALESCE(instagram_url, '') != '' THEN 1 ELSE 0 END) as on_instagram,
            SUM(CASE WHEN COALESCE(tiktok_url, '') != '' THEN 1 ELSE 0 END) as on_tiktok
        FROM creators
        GROUP BY primary_category
        ORDER BY total_creators DESC, with_email DESC
        """
    )
    category_breakdown = [dict(r) for r in cur.fetchall()]
    conn.close()

    return {
        "kpis": kpis,
        "tier_counts": tier_counts,
        "geo_options": geo_options,
        "category_breakdown": category_breakdown,
    }
