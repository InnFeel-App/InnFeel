"""Email sending via Resend HTTP API + multilingual OTP templates."""
import logging
from typing import Optional
import httpx

from .config import RESEND_API_KEY, EMAIL_FROM

logger = logging.getLogger("innfeel.email")

RESEND_API_URL = "https://api.resend.com/emails"

# Supported email locales (keep aligned with /app/frontend/src/i18n.ts)
SUPPORTED_LANGS = ("en", "fr", "es", "it", "de", "pt", "ar")


# ---------------------------------------------------------------------------
# Localised email content — subject + heading + body + CTA label
# ---------------------------------------------------------------------------
_OTP_CONTENT: dict[str, dict[str, str]] = {
    "en": {
        "subject": "Your InnFeel verification code",
        "heading": "Confirm your email",
        "greeting": "Hi {name},",
        "intro": "Welcome to InnFeel ✦ Use the code below to confirm your email address:",
        "expires": "This code expires in 10 minutes.",
        "ignore": "If you didn't sign up for InnFeel, you can safely ignore this email.",
        "footer": "With color,\nThe InnFeel team",
    },
    "fr": {
        "subject": "Ton code de vérification InnFeel",
        "heading": "Confirme ton e-mail",
        "greeting": "Salut {name},",
        "intro": "Bienvenue sur InnFeel ✦ Utilise le code ci-dessous pour confirmer ton adresse e-mail :",
        "expires": "Ce code expire dans 10 minutes.",
        "ignore": "Si tu n'as pas créé de compte InnFeel, tu peux ignorer cet e-mail.",
        "footer": "Avec couleur,\nL'équipe InnFeel",
    },
    "es": {
        "subject": "Tu código de verificación de InnFeel",
        "heading": "Confirma tu correo",
        "greeting": "Hola {name},",
        "intro": "Bienvenido a InnFeel ✦ Usa el código siguiente para confirmar tu dirección de correo:",
        "expires": "Este código caduca en 10 minutos.",
        "ignore": "Si no te registraste en InnFeel, puedes ignorar este correo.",
        "footer": "Con color,\nEl equipo de InnFeel",
    },
    "it": {
        "subject": "Il tuo codice di verifica InnFeel",
        "heading": "Conferma la tua email",
        "greeting": "Ciao {name},",
        "intro": "Benvenuto su InnFeel ✦ Usa il codice qui sotto per confermare il tuo indirizzo email:",
        "expires": "Questo codice scade tra 10 minuti.",
        "ignore": "Se non ti sei registrato a InnFeel, puoi ignorare questa email.",
        "footer": "Con colore,\nIl team InnFeel",
    },
    "de": {
        "subject": "Dein InnFeel-Bestätigungscode",
        "heading": "Bestätige deine E-Mail",
        "greeting": "Hallo {name},",
        "intro": "Willkommen bei InnFeel ✦ Verwende den folgenden Code, um deine E-Mail-Adresse zu bestätigen:",
        "expires": "Dieser Code läuft in 10 Minuten ab.",
        "ignore": "Wenn du dich nicht bei InnFeel registriert hast, kannst du diese E-Mail ignorieren.",
        "footer": "Mit Farbe,\nDein InnFeel-Team",
    },
    "pt": {
        "subject": "O teu código de verificação InnFeel",
        "heading": "Confirma o teu email",
        "greeting": "Olá {name},",
        "intro": "Bem-vindo ao InnFeel ✦ Usa o código abaixo para confirmar o teu endereço de email:",
        "expires": "Este código expira em 10 minutos.",
        "ignore": "Se não te registaste no InnFeel, podes ignorar este email.",
        "footer": "Com cor,\nA equipa InnFeel",
    },
    "ar": {
        "subject": "رمز التحقق الخاص بك في InnFeel",
        "heading": "تأكيد بريدك الإلكتروني",
        "greeting": "مرحبًا {name}،",
        "intro": "مرحبًا بك في InnFeel ✦ استخدم الرمز أدناه لتأكيد عنوان بريدك الإلكتروني:",
        "expires": "ينتهي هذا الرمز خلال 10 دقائق.",
        "ignore": "إذا لم تقم بالتسجيل في InnFeel، يمكنك تجاهل هذه الرسالة بأمان.",
        "footer": "بألوان،\nفريق InnFeel",
    },
}


def _pick_lang(lang: Optional[str]) -> str:
    if lang and lang.lower() in SUPPORTED_LANGS:
        return lang.lower()
    return "en"


def render_otp_email(code: str, name: str = "", lang: str = "en") -> tuple[str, str, str]:
    """Return (subject, html, text) for an OTP verification email in the given language."""
    l = _pick_lang(lang)
    c = _OTP_CONTENT[l]
    display_name = (name or "").strip() or ("friend" if l == "en" else "")
    greeting = c["greeting"].format(name=display_name).strip()
    dir_attr = 'dir="rtl"' if l == "ar" else ''

    html = f"""<!DOCTYPE html>
<html lang="{l}" {dir_attr}>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{c['subject']}</title>
</head>
<body style="margin:0;padding:0;background:#0B0B0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#F7F7F8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0F;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:linear-gradient(180deg,#17171D 0%,#0F0F14 100%);border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 8px 32px;text-align:center;">
              <div style="font-size:13px;letter-spacing:4px;text-transform:uppercase;color:#A78BFA;font-weight:700;">InnFeel</div>
              <div style="margin-top:18px;font-size:24px;font-weight:700;color:#fff;letter-spacing:-0.4px;">{c['heading']}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0 32px;color:#B0B0BD;font-size:15px;line-height:22px;">
              <p style="margin:0 0 10px 0;">{greeting}</p>
              <p style="margin:0 0 22px 0;">{c['intro']}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px;text-align:center;">
              <div style="display:inline-block;padding:18px 28px;border-radius:18px;background:linear-gradient(135deg,#A78BFA 0%,#F472B6 100%);">
                <div style="font-size:36px;letter-spacing:10px;font-weight:800;color:#0B0B0F;font-family:'SF Mono',Menlo,monospace;">{code}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 32px 32px;color:#7B7B88;font-size:13px;line-height:20px;text-align:center;">
              <p style="margin:0 0 8px 0;">{c['expires']}</p>
              <p style="margin:0;">{c['ignore']}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 28px 32px;border-top:1px solid rgba(255,255,255,0.06);color:#6B6B78;font-size:12px;line-height:18px;text-align:center;white-space:pre-line;">
{c['footer']}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    text = (
        f"{greeting}\n\n"
        f"{c['intro']}\n\n"
        f"    {code}\n\n"
        f"{c['expires']}\n{c['ignore']}\n\n"
        f"{c['footer']}"
    )
    return c["subject"], html, text


async def send_email_resend(to: str, subject: str, html: str, text: Optional[str] = None) -> bool:
    """Send an email via the Resend HTTP API. Returns True on success.

    Gracefully no-ops if RESEND_API_KEY is not configured (dev mode).
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY missing — email to %s not sent", to)
        return False
    payload: dict = {
        "from": EMAIL_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text
    try:
        async with httpx.AsyncClient(timeout=10.0) as client_http:
            r = await client_http.post(
                RESEND_API_URL,
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if r.status_code >= 400:
            logger.warning("Resend send failed (%s): %s", r.status_code, r.text[:300])
            return False
        return True
    except Exception as e:
        logger.warning("Resend send exception: %s", e)
        return False


async def send_verification_email(to: str, code: str, name: str = "", lang: str = "en") -> bool:
    subject, html, text = render_otp_email(code, name=name, lang=lang)
    return await send_email_resend(to, subject, html, text)
