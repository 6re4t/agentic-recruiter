from fastapi import APIRouter, HTTPException
from openai import OpenAI
from ..settings import settings

router = APIRouter(prefix="/health", tags=["health"])

@router.get("/openrouter")
def openrouter_health():
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not set on server.")

    client = OpenAI(
        api_key=settings.OPENROUTER_API_KEY,
        base_url=settings.OPENROUTER_BASE_URL,
    )
    try:
        # Minimal call to verify auth + connectivity
        r = client.responses.create(
            model=settings.OPENROUTER_MODEL,
            input="Reply with: ok"
        )
        return {"ok": True, "model": settings.OPENROUTER_MODEL, "sample": r.output_text.strip()[:50]}
    except Exception as e:
        # Useful error message if key is wrong / blocked / model not allowed
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
