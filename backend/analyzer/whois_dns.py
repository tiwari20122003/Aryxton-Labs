import whois
import dns.resolver
import dns.exception
import requests
from datetime import datetime, timezone
from .cyber_scanner import is_safe_public_domain


def parse_whois_date(date_val):
    if not date_val:
        return "N/A"
    if isinstance(date_val, list):
        if len(date_val) > 0:
            date_val = date_val[0]
        else:
            return "N/A"
    try:
        if hasattr(date_val, "strftime"):
            return date_val.strftime("%Y-%m-%d")
        date_str = str(date_val).strip()
        if len(date_str) >= 10:
            return date_str[:10]
    except Exception:
        pass
    return "N/A"


def parse_name_servers(ns_val):
    if not ns_val:
        return "N/A"
    raw = []
    if isinstance(ns_val, (list, set)):
        for ns in ns_val:
            if isinstance(ns, dict):
                v = ns.get("name") or ns.get("hostname") or (list(ns.values())[0] if ns else None)
                if v:
                    raw.append(str(v).strip())
            elif ns:
                raw.append(str(ns).strip())
    else:
        raw = str(ns_val).replace(",", " ").split()
    cleaned = []
    for ns in raw:
        c = ns.rstrip(".").lower()
        if c and c not in cleaned:
            cleaned.append(c)
    cleaned.sort()
    return ", ".join([n.upper() for n in cleaned]) if cleaned else "N/A"


def parse_registrar(reg):
    if not reg:
        return "N/A"
    if isinstance(reg, list):
        for r in reg:
            if r:
                return str(r).strip()
    return str(reg).strip()


def clean_host(domain: str) -> str:
    return domain.replace("https://", "").replace("http://", "").rstrip("/").split("/")[0]


def get_domain_info(domain: str) -> dict:
    host = clean_host(domain)
    safe, msg = is_safe_public_domain(host)
    if not safe:
        return {
            "domain": host,
            "registrar": "N/A",
            "creation_date": "N/A",
            "expiration_date": "N/A",
            "name_servers": "N/A",
            "mx_records": "N/A",
            "a_records": "N/A",
            "ssl_status": f"Blocked: {msg}",
            "robots_txt": "N/A",
            "sitemap_xml": "N/A",
            "error": msg,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    try:
        w = whois.whois(host, command=False)
        creation = parse_whois_date(w.get("creation_date"))
        expiration = parse_whois_date(w.get("expiration_date"))
        ns = parse_name_servers(w.get("name_servers"))
        registrar = parse_registrar(w.get("registrar"))
    except Exception as e:
        creation, expiration, ns, registrar = "N/A", "N/A", "N/A", "N/A"

    resolver = dns.resolver.Resolver()
    resolver.lifetime = 4
    resolver.timeout = 2

    try:
        mx = [str(r.exchange).rstrip(".") for r in resolver.resolve(host, "MX")]
        mx_info = ", ".join(mx) if mx else "N/A"
    except (dns.exception.DNSException, Exception):
        mx_info = "N/A"

    a_records = []
    try:
        for r in resolver.resolve(host, "A"):
            ip = str(r)
            parts = [int(p) for p in ip.split(".")] if ip.count(".") == 3 else []
            if len(parts) == 4 and not (
                parts[0] == 10
                or (parts[0] == 172 and 16 <= parts[1] <= 31)
                or (parts[0] == 192 and parts[1] == 168)
                or parts[0] == 127
            ):
                a_records.append(ip)
    except (dns.exception.DNSException, Exception):
        pass

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; Aryxton LabsBot/2.1; +https://Aryxton Labs.example/bot)"
    }

    robots = "Not Found"
    robots_text = ""
    for scheme in ["https", "http"]:
        try:
            r = requests.get(
                f"{scheme}://{host}/robots.txt",
                timeout=5,
                headers=headers,
                verify=False,
                allow_redirects=True,
                stream=True,
            )
            body = ""
            for chunk in r.iter_content(chunk_size=8192, decode_unicode=True):
                body += chunk
                if len(body) > 32 * 1024:
                    break
            if r.status_code == 200 and ("user-agent" in body.lower() or "disallow" in body.lower()):
                robots = "Found"
                robots_text = body
                break
        except Exception:
            continue

    sitemap = "Not Found"
    candidates = [f"https://{host}/sitemap.xml", f"http://{host}/sitemap.xml"]
    if robots_text:
        for line in robots_text.splitlines():
            if line.lower().strip().startswith("sitemap:"):
                parts = line.split(":", 1)
                if len(parts) > 1:
                    candidates.insert(0, parts[1].strip())
    for url in candidates[:5]:
        try:
            r = requests.get(url, timeout=5, headers=headers, verify=False, allow_redirects=True)
            if r.status_code == 200 and len(r.content) < 5 * 1024 * 1024:
                low = r.text.lower()
                if "<urlset" in low or "<sitemapindex" in low or "<sitemap" in low:
                    sitemap = "Found"
                    break
        except Exception:
            continue
    ssl_status = "HTTP Only"
    try:
        requests.get(f"https://{host}", timeout=5, headers=headers, verify=True, allow_redirects=True)
        ssl_status = "Valid (HTTPS)"
    except requests.exceptions.SSLError:
        ssl_status = "Invalid SSL Certificate"
    except requests.exceptions.ConnectionError:
        ssl_status = "HTTP Only"
    except Exception:
        ssl_status = "Unknown"

    return {
        "domain": host,
        "registrar": registrar,
        "creation_date": creation,
        "expiration_date": expiration,
        "name_servers": ns,
        "mx_records": mx_info,
        "a_records": ", ".join(a_records) if a_records else "N/A",
        "ssl_status": ssl_status,
        "robots_txt": robots,
        "sitemap_xml": sitemap,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
