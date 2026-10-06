import requests
import time
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin
from datetime import datetime, timezone
from .cyber_scanner import is_safe_public_domain

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def normalize_url(url):
    try:
        p = urlparse(url)
        netloc = p.netloc.lower().replace("www.", "")
        path = p.path.rstrip("/")
        return f"{p.scheme}://{netloc}{path}"
    except Exception:
        return url


MAX_CONTENT_BYTES = 2 * 1024 * 1024 
ALLOWED_CONTENT_TYPES = ("text/html", "application/xhtml+xml", "text/plain")


def crawl_site(base_url: str, max_pages: int = 10) -> dict:
    """Crawl site and return SEO audit results."""
    if not base_url.startswith(("http://", "https://")):
        base_url = "https://" + base_url

    base_parsed = urlparse(base_url)
    base_host = base_parsed.netloc.lower().replace("www.", "").split(":")[0]

    safe, msg = is_safe_public_domain(base_host)
    if not safe:
        return {
            "pages": [],
            "issues": [{
                "domain": base_url,
                "url": base_url,
                "issue": "Target Blocked",
                "severity": "Critical",
                "category": "Security",
                "description": msg,
                "fix": "Use a publicly routable domain.",
            }],
            "audits": [],
        }

    visited = set()
    normalized_visited = set()
    issues = []
    pages = []
    audits = []
    to_crawl = [base_url]

    session = requests.Session()
    session.headers.update(DEFAULT_HEADERS)
    session.max_redirects = 5

    while to_crawl and len(visited) < max_pages:
        current = to_crawl.pop(0)
        norm = normalize_url(current)
        if norm in normalized_visited:
            continue

        try:
            cur_host = urlparse(current).netloc.lower().replace("www.", "").split(":")[0]
            safe, msg = is_safe_public_domain(cur_host)
            if not safe:
                continue
        except Exception:
            continue

        visited.add(current)
        normalized_visited.add(norm)

        start = time.time()
        raw = ""
        status = 0
        load_time = 0
        try:
            with session.get(
                current,
                timeout=8,
                allow_redirects=True,
                verify=False,
                stream=True,
            ) as resp:
                status = resp.status_code
                ctype = resp.headers.get("Content-Type", "")
                if status >= 400:
                    pass 
                elif not any(t in ctype.lower() for t in ALLOWED_CONTENT_TYPES):
                    continue 
                chunks = []
                size = 0
                for chunk in resp.iter_content(chunk_size=16384, decode_unicode=True):
                    chunks.append(chunk if isinstance(chunk, str) else chunk.decode("utf-8", errors="ignore"))
                    size += len(chunk)
                    if size >= MAX_CONTENT_BYTES:
                        break
                raw = "".join(chunks)
                load_time = round(time.time() - start, 2)
        except Exception as e:
            issues.append({
                "domain": base_url,
                "url": current,
                "issue": "Connection Failure",
                "severity": "Critical",
                "category": "Technical",
                "description": f"Could not reach {current}: {str(e)[:120]}",
                "fix": "Verify DNS, SSL, firewall and host availability.",
            })
            continue

        soup = BeautifulSoup(raw, "html.parser")

        title = (soup.title.string.strip() if soup.title and soup.title.string else "Missing Title")
        meta = soup.find("meta", attrs={"name": "description"})
        meta_desc = str(meta.get("content", "")).strip() if meta else "Missing Meta Description"
        if not meta_desc:
            meta_desc = "Missing Meta Description"
        h1 = soup.find("h1")
        h1_text = h1.get_text(strip=True) if h1 else "Missing H1"

        canonical = soup.find("link", rel="canonical")
        canonical_status = str(canonical.get("href")).strip() if canonical and canonical.get("href") else "Missing"
        og_title = soup.find("meta", property="og:title")
        og_desc = soup.find("meta", property="og:description")
        social_meta = "Present" if og_title or og_desc else "Missing"
        schema = bool(soup.find_all("script", type="application/ld+json"))

        internal = external = 0
        for link in soup.find_all("a", href=True):
            href = link["href"].strip()
            if not href or href.startswith("#") or href.lower().startswith("javascript:"):
                continue
            try:
                full = urljoin(resp.url, href)
                parsed = urlparse(full)
                link_domain = parsed.netloc.lower().replace("www.", "")
            except Exception:
                continue
            if link_domain == base_domain and parsed.scheme in ("http", "https"):
                internal += 1
                clean = full.split("#")[0]
                nclean = normalize_url(clean)
                if nclean not in normalized_visited and clean not in to_crawl and len(visited) < max_pages:
                    to_crawl.append(clean)
            else:
                external += 1

        images = soup.find_all("img")
        missing_alt = sum(1 for img in images if not (img.get("alt") or "").strip())

        if title == "Missing Title":
            issues.append({"domain": base_url, "url": current, "issue": "Missing Title Tag", "severity": "High", "category": "On-Page SEO",
                           "description": "Page has no <title> tag.", "fix": "Add a descriptive <title> tag of 10-65 chars."})
        elif len(title) < 10 or len(title) > 65:
            issues.append({"domain": base_url, "url": current, "issue": "Title Length Issue", "severity": "Medium", "category": "On-Page SEO",
                           "description": f"Title length is {len(title)} chars (recommended 10-65).", "fix": "Rewrite title to 10-65 chars."})
        if meta_desc == "Missing Meta Description":
            issues.append({"domain": base_url, "url": current, "issue": "Missing Meta Description", "severity": "Medium", "category": "On-Page SEO",
                           "description": "Meta description tag missing.", "fix": "Add compelling 50-160 char meta description."})
        elif len(meta_desc) < 50 or len(meta_desc) > 160:
            issues.append({"domain": base_url, "url": current, "issue": "Meta Description Length", "severity": "Low", "category": "On-Page SEO",
                           "description": f"Meta description length is {len(meta_desc)} (50-160 recommended).", "fix": "Rewrite 50-160 chars."})
        if h1_text == "Missing H1" or len(h1_text) < 3:
            issues.append({"domain": base_url, "url": current, "issue": "Missing H1 Tag", "severity": "High", "category": "On-Page SEO",
                           "description": "No <h1> heading found.", "fix": "Add a single descriptive H1."})
        if missing_alt > 0:
            issues.append({"domain": base_url, "url": current, "issue": f"Missing Image Alt Text ({missing_alt})",
                           "severity": "Medium", "category": "Accessibility",
                           "description": f"{missing_alt} images lack alt attributes.", "fix": "Add descriptive alt text to all images."})
        if status >= 400:
            issues.append({"domain": base_url, "url": current, "issue": f"HTTP {status}", "severity": "High" if status < 500 else "Critical",
                           "category": "Technical", "description": f"Returned status {status}.", "fix": "Fix broken links or server errors."})

        lcp = round(load_time * 1.2, 2)
        page_speed_score = max(0, 100 - int(load_time * 12))

        pages.append({
            "domain": base_url, "url": current, "title": title, "meta_description": meta_desc,
            "h1": h1_text, "status": status,
        })
        audits.append({
            "url": current, "load_time_sec": load_time,
            "page_size_kb": round(len(raw.encode("utf-8")) / 1024, 2),
            "missing_alt_images": missing_alt, "canonical_tag": canonical_status,
            "social_meta_og": social_meta, "structured_data": "Yes" if schema else "No",
            "internal_links": internal, "external_links": external,
            "title_length": len(title) if title != "Missing Title" else 0,
            "meta_length": len(meta_desc) if meta_desc != "Missing Meta Description" else 0,
            "lcp_sec": lcp, "page_speed_score": page_speed_score,
            "lcp_target": "Good (< 2.5s)" if lcp < 2.5 else "Needs Improvement",
        })

        if len(visited) > 1:
            time.sleep(0.1)

    return {
        "pages": pages,
        "issues": issues,
        "audits": audits,
        "meta": {
            "pages_crawled": len(visited),
            "base_domain": base_host,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }
