import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
import uuid
import io

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

from analyzer.whois_dns import get_domain_info, clean_host
from analyzer.crawler import crawl_site
from analyzer.cyber_scanner import run_cyber_scan
from analyzer.ai_insights import generate_ai_insights
from analyzer.report_generator import generate_excel_report

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Website Analyser API", version="2.0")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("website-analyser")


class AnalyzeRequest(BaseModel):
    domain: str = Field(..., min_length=3)
    max_pages: int = Field(default=8, ge=1, le=25)


class AIInsightsRequest(BaseModel):
    report: dict


class HistoryItem(BaseModel):
    id: str
    domain: str
    grade: Optional[str] = None
    global_score: Optional[int] = None
    issues_count: int = 0
    created_at: str


def _normalize_target(domain: str) -> tuple[str, str]:
    d = domain.strip()
    if not d.startswith(("http://", "https://")):
        d = "https://" + d
    host = clean_host(d)
    return d, host


@api.get("/")
async def root():
    return {"ok": True, "service": "website-analyser", "version": "2.0"}


@api.get("/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@api.post("/analyze")
async def analyze(req: AnalyzeRequest):
    full_url, host = _normalize_target(req.domain)
    logger.info(f"Analyzing {full_url} (max_pages={req.max_pages})")

    try:
        domain_info = get_domain_info(full_url)
    except Exception as e:
        logger.exception("domain info failed")
        domain_info = {"domain": host, "error": str(e)[:200]}

    try:
        seo = crawl_site(full_url, max_pages=req.max_pages)
    except Exception as e:
        logger.exception("crawl failed")
        seo = {"pages": [], "issues": [], "audits": [], "error": str(e)[:200]}
    html_content = ""
    try:
        r = requests.get(full_url, timeout=10, verify=False,
                         headers={"User-Agent": "Mozilla/5.0"})
        html_content = r.text or ""
    except Exception:
        pass

    try:
        cyber = run_cyber_scan(full_url, full_url, html_content,
                               domain_info.get("creation_date", "N/A"))
    except Exception as e:
        logger.exception("cyber scan failed")
        cyber = {"error": str(e)[:200], "global_score": 0, "grade": "N/A"}

    report = {
        "id": str(uuid.uuid4()),
        "domain": domain_info,
        "seo": seo,
        "cyber": cyber,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        summary = {
            "id": report["id"],
            "domain": host,
            "grade": cyber.get("grade"),
            "global_score": cyber.get("global_score"),
            "issues_count": len(seo.get("issues", [])),
            "pages_crawled": len(seo.get("audits", [])),
            "created_at": report["created_at"],
            "full": report,
        }
        await db.reports.insert_one(summary)
    except Exception as e:
        logger.warning(f"Mongo insert failed: {e}")

    return report


@api.post("/ai-insights")
async def ai_insights(req: AIInsightsRequest):
    result = generate_ai_insights(req.report)
    return result


@api.get("/history")
async def history(limit: int = 20):
    docs = await db.reports.find({}, {"_id": 0, "full": 0}).sort("created_at", -1).to_list(limit)
    return {"items": docs}


@api.get("/report/{report_id}")
async def get_report(report_id: str):
    doc = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return doc.get("full", doc)


@api.delete("/report/{report_id}")
async def delete_report(report_id: str):
    res = await db.reports.delete_one({"id": report_id})
    return {"deleted": res.deleted_count}


@api.post("/export/excel")
async def export_excel(req: AIInsightsRequest):
    data = generate_excel_report(req.report)
    domain = req.report.get("domain", {}).get("domain", "report")
    filename = f"website-analyser-{domain}-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api.get("/screenshot")
async def screenshot(url: str):
    """Proxy to thum.io free screenshot service (no auth required)."""
    target = url if url.startswith(("http://", "https://")) else f"https://{url}"
    try:
        r = requests.get(f"https://image.thum.io/get/width/1280/crop/800/{quote(target, safe=':/')}",
                         timeout=25, stream=True)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Screenshot service error")
        return Response(content=r.content, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=1800"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Screenshot error: {str(e)[:100]}")


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
