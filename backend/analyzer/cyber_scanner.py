import ssl
import socket
import requests
import math
import re
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


BLOCKED_LITERALS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}

def _is_private_ipv4(ip: str) -> bool:
    try:
        parts = [int(p) for p in ip.split(".")]
        if len(parts) != 4: return False
        if parts[0] == 10: return True
        if parts[0] == 127: return True
        if parts[0] == 172 and 16 <= parts[1] <= 31: return True
        if parts[0] == 192 and parts[1] == 168: return True
        if parts[0] == 169 and parts[1] == 254: return True 
        if parts[0] == 100 and 64 <= parts[1] <= 127: return True
        if parts[0] == 192 and parts[1] == 0 and parts[2] in (0, 2): return True
        if parts[0] == 198 and parts[1] in (18, 19, 51): return True
        if parts[0] >= 224: return True 
        return False
    except Exception:
        return False


def is_safe_public_domain(host):
    host = host.lower().strip().replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    if not host:
        return False, "Empty host"
    if host in BLOCKED_LITERALS:
        return False, "Target is loopback (SSRF blocked)."
    import re
    if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", host):
        if _is_private_ipv4(host):
            return False, f"Private IP {host} (SSRF blocked)."
    try:
        ip = socket.gethostbyname(host)
        if _is_private_ipv4(ip):
            return False, f"Resolved to private IP {ip} (SSRF blocked)."
    except Exception:
        pass
    return True, ""


def get_ssl_details(host):
    host = host.lower().strip().replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=6) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
                tls = ssock.version() or "TLS"
                cipher = ssock.cipher()
                cipher_name = cipher[0] if cipher else "N/A"
                issuer_cn = "N/A"
                issuer_org = "N/A"
                for entry in cert.get("issuer", ()):
                    for item in entry:
                        if len(item) == 2:
                            k, v = item
                            if k == "commonName":
                                issuer_cn = v
                            elif k == "organizationName":
                                issuer_org = v
                expire_str = cert.get("notAfter", "")
                try:
                    expire_date = date_parser.parse(expire_str)
                    if expire_date.tzinfo:
                        expire_date = expire_date.astimezone(timezone.utc).replace(tzinfo=None)
                except Exception:
                    expire_date = datetime.now()
                days_left = (expire_date - datetime.utcnow()).days
                return {
                    "valid": True, "issuer_cn": issuer_cn, "issuer_org": issuer_org,
                    "expiry_date": expire_date.strftime("%Y-%m-%d"),
                    "days_left": max(0, days_left), "tls_version": tls, "cipher": cipher_name, "error": "",
                }
    except Exception as e:
        return {"valid": False, "issuer_cn": "N/A", "issuer_org": "N/A", "expiry_date": "N/A",
                "days_left": 0, "tls_version": "N/A", "cipher": "N/A", "error": str(e)[:120]}


def check_security_headers(url):
    checks = {
        "Strict-Transport-Security": "Enforces encrypted HTTPS and mitigates downgrade attacks.",
        "Content-Security-Policy": "Mitigates XSS, clickjacking, and injection.",
        "X-Frame-Options": "Prevents clickjacking via iframe restrictions.",
        "X-Content-Type-Options": "Blocks MIME-sniffing exploits.",
        "Referrer-Policy": "Restricts referral data on cross-origin navigation.",
        "Permissions-Policy": "Restricts browser feature access (camera, mic, geo).",
    }
    findings = []
    score = 100
    status = 0
    rt = 0.0
    server_hdr = "N/A"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        t0 = datetime.now()
        r = requests.get(url, timeout=10, headers=headers, allow_redirects=True, verify=False)
        rt = (datetime.now() - t0).total_seconds()
        status = r.status_code
        rh = r.headers
        server_hdr = rh.get("Server", rh.get("X-Powered-By", "Hidden"))

        has_cf = ("cf-ray" in rh) or ("cf-mitigated" in rh) or ("cloudflare" in server_hdr.lower())
        if has_cf:
            findings.append({"header": "WAF Protection", "status": "Active",
                             "value": "Cloudflare detected", "desc": "Active WAF shields against bots.", "severity": "Info"})
            score = min(100, score + 15)

        for h, desc in checks.items():
            v = rh.get(h)
            if v:
                findings.append({"header": h, "status": "Present", "value": v[:60], "desc": desc, "severity": "Info"})
            else:
                high = h in ("Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options")
                findings.append({"header": h, "status": "Missing", "value": "N/A", "desc": desc,
                                 "severity": "High" if high else "Medium"})
                score -= 15 if high else 8
    except Exception as e:
        status = 0
        score = 0
        findings = [{"header": h, "status": "Error", "value": str(e)[:60], "desc": d, "severity": "High"} for h, d in checks.items()]

    return findings, max(0, score), status, round(rt, 3), server_hdr


def entropy(s):
    if not s:
        return 0.0
    e = 0.0
    for x in range(256):
        p = float(s.count(chr(x))) / len(s)
        if p > 0:
            e += -p * math.log(p, 2)
    return e


def phishing_heuristics(domain, creation_str="N/A"):
    risk = 0
    reasons = []
    host = domain.lower().replace("https://", "").replace("http://", "").split("/")[0]
    brands = ["paypal", "google", "microsoft", "facebook", "apple", "amazon", "bank", "secure", "login", "verify"]
    for b in brands:
        if b in host:
            legit = [f"{b}.com", f"{b}.net", f"{b}.org"]
            if not any(host == l or host.endswith("." + l) for l in legit):
                risk += 40
                reasons.append(f"Brand impersonation risk: '{b}' not in official domain.")
    ent = entropy(host.split(".")[0])
    if ent > 4.2:
        risk += 25
        reasons.append(f"High name entropy ({ent:.2f}): algorithmic pattern.")
    if len(host.split(".")) > 4:
        risk += 15
        reasons.append("Excess subdomain depth may obfuscate origin.")
    high_risk_tlds = [".xyz", ".top", ".cc", ".gq", ".cf", ".tk", ".ml", ".ga"]
    for t in high_risk_tlds:
        if host.endswith(t):
            risk += 15
            reasons.append(f"High-risk TLD '{t}'.")
    if creation_str and creation_str != "N/A":
        try:
            cd = datetime.strptime(creation_str, "%Y-%m-%d")
            age = (datetime.now() - cd).days
            if age < 180:
                risk += 20
                reasons.append(f"Newly registered ({age} days).")
        except Exception:
            pass
    return min(100, risk), reasons


def malware_scan(html, is_https=True):
    risk = 0
    reasons = []
    if not html:
        return 0, []
    soup = BeautifulSoup(html, "html.parser")
    hidden = 0
    for frame in soup.find_all("iframe"):
        style = (frame.get("style", "") or "").lower()
        if "display:none" in style or frame.get("width") == "0" or frame.get("height") == "0":
            hidden += 1
    if hidden:
        risk += 35
        reasons.append(f"Hidden iframes detected ({hidden}).")
    scripts = soup.find_all("script")
    evals = sum(1 for s in scripts if s.string and "eval(" in s.string)
    obf = sum(1 for s in scripts if s.string and ("unescape(" in s.string or "fromCharCode" in s.string))
    if evals:
        risk += 25
        reasons.append("Dynamic eval() usage detected.")
    if obf:
        risk += 20
        reasons.append("Code obfuscation patterns found.")
    patterns = {
        "AWS Key": r"AKIA[0-9A-Z]{16}",
        "Secret API Key": r"sk-[a-zA-Z0-9_-]{32,}",
        "JWT Token": r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}",
    }
    for name, pat in patterns.items():
        if re.search(pat, html):
            risk += 40
            reasons.append(f"Exposed secret pattern: {name}.")
    return min(100, risk), reasons


def run_cyber_scan(domain, url, html, creation_str="N/A"):
    host = domain.lower().replace("https://", "").replace("http://", "").split("/")[0]
    safe, msg = is_safe_public_domain(host)
    if not safe:
        return {"domain": domain, "global_score": 0, "grade": "F", "rating": "Critical (SSRF)",
                "ssl_info": {"valid": False, "error": msg, "days_left": 0, "tls_version": "N/A", "cipher": "N/A",
                             "issuer_cn": "N/A", "issuer_org": "N/A", "expiry_date": "N/A"},
                "headers_score": 0, "header_findings": [], "phishing_score": 100, "phishing_reasons": [msg],
                "malware_score": 0, "malware_reasons": [], "status_code": 403, "load_time": 0.0,
                "recommendations": ["Do not scan private/internal targets."], "timestamp": datetime.now(timezone.utc).isoformat()}

    is_https = url.startswith("https://")
    ssl_info = get_ssl_details(host)
    findings, hdr_score, status, load_time, server_hdr = check_security_headers(url)
    ph_score, ph_reasons = phishing_heuristics(host, creation_str)
    mw_score, mw_reasons = malware_scan(html, is_https)

    ssl_valid = bool(ssl_info.get("valid"))
    g = round(100 - ((0 if ssl_valid else 25) + (100 - hdr_score) * 0.25 + ph_score * 0.25 + mw_score * 0.25))
    g = max(0, min(100, g))

    if g >= 95:
        grade, rating = "A+", "Optimal Security"
    elif g >= 88:
        grade, rating = "A", "Low Risk"
    elif g >= 78:
        grade, rating = "B", "Low Risk"
    elif g >= 68:
        grade, rating = "C", "Medium Risk"
    elif g >= 50:
        grade, rating = "D", "High Risk"
    else:
        grade, rating = "F", "Critical Risk"

    recs = []
    if not ssl_valid:
        recs.append("Provision a valid SSL/TLS certificate from a trusted CA.")
    elif ssl_info.get("days_left", 0) < 30:
        recs.append(f"SSL expires in {ssl_info.get('days_left')} days — renew soon.")
    for f in findings:
        if f["status"] == "Missing":
            recs.append(f"Enable '{f['header']}' header. {f['desc']}")
    if ph_score > 30:
        recs.append("Review brand protection and trademark registration.")
    if mw_score > 30:
        recs.append("Audit source for obfuscated scripts and secret leaks.")
    if not recs:
        recs.append("No active vulnerabilities detected. Keep TLS and stack patched.")

    return {
        "domain": domain, "global_score": g, "grade": grade, "rating": rating,
        "ssl_info": ssl_info, "headers_score": hdr_score, "header_findings": findings,
        "phishing_score": ph_score, "phishing_reasons": ph_reasons,
        "malware_score": mw_score, "malware_reasons": mw_reasons,
        "status_code": status, "load_time": load_time, "recommendations": recs,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
