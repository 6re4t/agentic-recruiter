import smtplib
from email.message import EmailMessage

from .settings import settings


class EmailSendError(Exception):
    pass


def smtp_configured() -> bool:
    return bool(settings.SMTP_ENABLED and settings.SMTP_HOST and settings.SMTP_FROM_EMAIL)


def send_email(to_email: str, subject: str, body: str) -> None:
    if not smtp_configured():
        raise EmailSendError("SMTP is not enabled or not fully configured.")

    msg = EmailMessage()
    from_display = settings.SMTP_FROM_NAME.strip() if settings.SMTP_FROM_NAME else ""
    msg["From"] = f"{from_display} <{settings.SMTP_FROM_EMAIL}>" if from_display else settings.SMTP_FROM_EMAIL
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        if settings.SMTP_USE_SSL:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
                if settings.SMTP_USERNAME:
                    server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
                server.send_message(msg)
            return

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            if settings.SMTP_USERNAME:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
            server.send_message(msg)
    except Exception as exc:
        raise EmailSendError(str(exc)) from exc
