from __future__ import annotations
from typing import Tuple, Optional
from pypdf import PdfReader
from .settings import settings


def extract_text_pdf_text_layer(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    parts = []
    for page in reader.pages:
        txt = page.extract_text() or ""
        if txt.strip():
            parts.append(txt)
    return "\n".join(parts).strip()


def extract_text_pdf_ocr(pdf_path: str, max_pages: int) -> str:
    from pdf2image import convert_from_path
    import pytesseract

    pages = convert_from_path(pdf_path, dpi=200, first_page=1, last_page=max_pages)
    ocr_parts = []
    for img in pages:
        text = pytesseract.image_to_string(img) or ""
        if text.strip():
            ocr_parts.append(text)
    return "\n".join(ocr_parts).strip()


def extract_resume_text(pdf_path: str) -> Tuple[Optional[str], str, Optional[str]]:
    try:
        text = extract_text_pdf_text_layer(pdf_path)
        if len(text) >= settings.TEXT_MIN_CHARS_FOR_NO_OCR:
            return text, "text", None

        ocr_text = extract_text_pdf_ocr(pdf_path, max_pages=settings.OCR_MAX_PAGES)
        if ocr_text:
            return ocr_text, "ocr", None

        return None, "failed", "No extractable text found (text layer empty + OCR empty)."
    except Exception as e:
        return None, "failed", f"Extraction error: {type(e).__name__}: {e}"