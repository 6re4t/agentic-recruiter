import os
import uuid
from fastapi import UploadFile
from .settings import settings


def ensure_upload_dir() -> None:
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


def save_upload_pdf(file: UploadFile) -> str:
    ensure_upload_dir()

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext != ".pdf":
        ext = ".pdf"

    unique_name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(settings.UPLOAD_DIR, unique_name)

    with open(path, "wb") as f:
        f.write(file.file.read())

    return path