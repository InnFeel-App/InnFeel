"""Email sending via Resend HTTP API + multilingual OTP templates."""
import base64
import logging
import os
from pathlib import Path
from typing import Optional
import httpx

from .config import RESEND_API_KEY, EMAIL_FROM

logger = logging.getLogger("innfeel.email")

RESEND_API_URL = "https://api.resend.com/emails"

# ---------------------------------------------------------------------------
# Brand logo — loaded once at import, attached to every email as a CID
# inline image (most reliable cross-client method: Apple Mail, Gmail, Outlook,
# iCloud, ProtonMail all render CID-referenced images natively).
# ---------------------------------------------------------------------------
_LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "logo-email.png"
LOGO_CID = "innfeel-logo"  # stable reference — never change or existing emails break on forward

_LOGO_B64: Optional[str] = None
try:
    if _LOGO_PATH.is_file():
        with open(_LOGO_PATH, "rb") as fh:
            _LOGO_B64 = base64.b64encode(fh.read()).decode("ascii")
        logger.info(f"Email logo loaded: {_LOGO_PATH} ({len(_LOGO_B64) * 3 // 4} bytes)")
    else:
        logger.warning(f"Email logo not found at {_LOGO_PATH} — emails will ship without it")
except Exception as e:
    logger.warning(f"Could not read email logo: {e}")


def get_logo_attachment() -> Optional[dict]:
    """Return the Resend attachment dict for the brand logo, or None if the file is missing."""
    if not _LOGO_B64:
        return None
    return {
        "filename": "innfeel-logo.png",
        "content": _LOGO_B64,
        "content_type": "image/png",
        # Resend accepts content_id for inline CID references (RFC 2392).
        "content_id": LOGO_CID,
        "disposition": "inline",
    }


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


# ---------------------------------------------------------------------------
# Brand footer — shared across every automated email (logo + signature tagline)
# ---------------------------------------------------------------------------
BRAND_TAGLINE = "One aura a day! Twenty seconds. Full color! Share yours. Unlock the others!"


def render_brand_footer_html() -> str:
    """Return a reusable HTML block with the InnFeel logo + tagline.

    Uses a CID-referenced inline PNG (the real brand logo). Every email shipped via
    `send_email_resend(..., include_logo=True)` attaches the logo automatically, and
    this block references it via `src="cid:innfeel-logo"` — the most reliable way to
    render images in email (works in Apple Mail, Gmail, Outlook, iCloud, ProtonMail).
    """
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:520px;margin-top:16px;">'
        '<tr><td align="center" style="padding:24px 24px 8px 24px;">'
        # Real brand logo (CID attachment)
        f'<img src="cid:{LOGO_CID}" alt="InnFeel" width="84" height="84" '
        'style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;'
        'border-radius:18px;" />'
        # Tagline — brand signature kept in English on purpose (like "Just do it")
        f'<div style="margin-top:14px;font-size:12px;font-style:italic;color:#9CA3AF;'
        f'line-height:18px;max-width:380px;margin-left:auto;margin-right:auto;">'
        f'{BRAND_TAGLINE}</div>'
        # Contact link
        '<div style="margin-top:14px;font-size:11px;color:#6B6B78;">'
        '<a href="mailto:hello@innfeel.app" style="color:#A78BFA;text-decoration:none;">'
        'hello@innfeel.app</a> &nbsp;·&nbsp; '
        '<a href="https://innfeel.app" style="color:#6B6B78;text-decoration:none;">innfeel.app</a>'
        '</div>'
        '</td></tr></table>'
    )


def render_brand_footer_text() -> str:
    return (
        "\n\n-- \n"
        "✦ InnFeel\n"
        f"{BRAND_TAGLINE}\n"
        "hello@innfeel.app · innfeel.app"
    )


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
        {render_brand_footer_html()}
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
        f"{render_brand_footer_text()}"
    )
    return c["subject"], html, text


async def send_email_resend(
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    include_logo: bool = True,
) -> bool:
    """Send an email via the Resend HTTP API. Returns True on success.

    If include_logo is True (default), the InnFeel logo is attached inline as
    `cid:innfeel-logo`, so any HTML that references `src="cid:innfeel-logo"` renders
    the real brand logo in every major mail client.

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
    if include_logo:
        att = get_logo_attachment()
        if att:
            payload["attachments"] = [att]
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



# ===========================================================================
# Welcome email — shipped once the user has verified their email
# ===========================================================================
_WELCOME_CONTENT: dict[str, dict[str, str]] = {
    "en": {
        "subject": "Welcome to InnFeel ✦",
        "heading": "You're in — welcome!",
        "greeting": "Hi {name},",
        "intro": "Your email is confirmed and your InnFeel account is ready. One aura a day keeps the disconnection away ✦",
        "step_1_title": "Drop your first aura",
        "step_1_body": "Pick a color, add a word, a photo or a short voice note — whatever your day feels like right now.",
        "step_2_title": "Add your people",
        "step_2_body": "InnFeel is most magical with friends. Invite up to 25 people on the free plan, or unlock unlimited with Pro.",
        "step_3_title": "Unlock the feed",
        "step_3_body": "Once you share your aura of the day, your friends' auras unlock — pure reciprocity, no endless doom-scrolling.",
        "cta": "Open InnFeel",
        "footer": "Send color, receive color.\nThe InnFeel team",
    },
    "fr": {
        "subject": "Bienvenue sur InnFeel ✦",
        "heading": "Tu es dedans — bienvenue !",
        "greeting": "Salut {name},",
        "intro": "Ton e-mail est confirmé et ton compte InnFeel est prêt. Une aura par jour, pour rester connecté·e à toi et aux autres ✦",
        "step_1_title": "Dépose ta première aura",
        "step_1_body": "Choisis une couleur, ajoute un mot, une photo ou un petit message vocal — ce que tu ressens, là, maintenant.",
        "step_2_title": "Ajoute tes proches",
        "step_2_body": "InnFeel prend toute sa magie entre amis. Invite jusqu'à 25 personnes avec le plan gratuit, sans limite avec Pro.",
        "step_3_title": "Déverrouille le feed",
        "step_3_body": "Dès que tu partages ton aura du jour, celles de tes amis se révèlent — pure réciprocité, zéro scroll infini.",
        "cta": "Ouvrir InnFeel",
        "footer": "Envoie de la couleur, reçois de la couleur.\nL'équipe InnFeel",
    },
    "es": {
        "subject": "Bienvenido a InnFeel ✦",
        "heading": "¡Ya estás dentro — bienvenido!",
        "greeting": "Hola {name},",
        "intro": "Tu correo está confirmado y tu cuenta InnFeel lista. Un aura al día te mantiene conectado ✦",
        "step_1_title": "Comparte tu primera aura",
        "step_1_body": "Elige un color, añade una palabra, foto o un mensaje de voz — lo que sientas ahora mismo.",
        "step_2_title": "Añade a los tuyos",
        "step_2_body": "InnFeel brilla entre amigos. Invita hasta 25 personas en el plan gratis; ilimitadas en Pro.",
        "step_3_title": "Desbloquea el feed",
        "step_3_body": "Al compartir tu aura del día, se desbloquean las de tus amigos — reciprocidad pura, sin scroll infinito.",
        "cta": "Abrir InnFeel",
        "footer": "Envía color, recibe color.\nEl equipo de InnFeel",
    },
    "it": {
        "subject": "Benvenuto su InnFeel ✦",
        "heading": "Ci sei — benvenuto!",
        "greeting": "Ciao {name},",
        "intro": "La tua email è confermata e il tuo account InnFeel è pronto. Un'aura al giorno per restare connesso ✦",
        "step_1_title": "Condividi la tua prima aura",
        "step_1_body": "Scegli un colore, aggiungi una parola, una foto o un breve vocale — quello che senti adesso.",
        "step_2_title": "Aggiungi i tuoi",
        "step_2_body": "InnFeel brilla tra amici. Invita fino a 25 persone nel piano gratuito; illimitate con Pro.",
        "step_3_title": "Sblocca il feed",
        "step_3_body": "Appena condividi la tua aura del giorno, si sbloccano quelle dei tuoi amici — reciprocità pura.",
        "cta": "Apri InnFeel",
        "footer": "Invia colore, ricevi colore.\nIl team InnFeel",
    },
    "de": {
        "subject": "Willkommen bei InnFeel ✦",
        "heading": "Du bist drin — willkommen!",
        "greeting": "Hallo {name},",
        "intro": "Deine E-Mail ist bestätigt und dein InnFeel-Konto bereit. Eine Aura pro Tag für echte Verbindung ✦",
        "step_1_title": "Teile deine erste Aura",
        "step_1_body": "Wähle eine Farbe, füge ein Wort, Foto oder eine kurze Sprachnotiz hinzu — was auch immer du gerade fühlst.",
        "step_2_title": "Füge deine Leute hinzu",
        "step_2_body": "InnFeel wirkt am besten mit Freunden. Lade bis zu 25 Personen im Gratis-Plan ein, unbegrenzt mit Pro.",
        "step_3_title": "Schalte den Feed frei",
        "step_3_body": "Sobald du deine Aura teilst, werden die deiner Freunde sichtbar — pure Gegenseitigkeit, kein Endlos-Scrolling.",
        "cta": "InnFeel öffnen",
        "footer": "Sende Farbe, empfange Farbe.\nDein InnFeel-Team",
    },
    "pt": {
        "subject": "Bem-vindo ao InnFeel ✦",
        "heading": "Estás dentro — bem-vindo!",
        "greeting": "Olá {name},",
        "intro": "O teu email está confirmado e a tua conta InnFeel pronta. Uma aura por dia para ficar ligado ✦",
        "step_1_title": "Partilha a tua primeira aura",
        "step_1_body": "Escolhe uma cor, junta uma palavra, foto ou curto vocal — o que sentires agora.",
        "step_2_title": "Adiciona os teus",
        "step_2_body": "O InnFeel brilha entre amigos. Convida até 25 pessoas no plano grátis, ilimitadas no Pro.",
        "step_3_title": "Desbloqueia o feed",
        "step_3_body": "Ao partilhar a tua aura do dia, desbloqueias as dos teus amigos — reciprocidade pura.",
        "cta": "Abrir InnFeel",
        "footer": "Envia cor, recebe cor.\nA equipa InnFeel",
    },
    "ar": {
        "subject": "مرحبًا بك في InnFeel ✦",
        "heading": "أنت الآن معنا — مرحبًا!",
        "greeting": "مرحبًا {name}،",
        "intro": "تم تأكيد بريدك الإلكتروني وحسابك في InnFeel جاهز. هالة واحدة يوميًا تُبقيك على تواصل ✦",
        "step_1_title": "شارك هالتك الأولى",
        "step_1_body": "اختر لونًا، أضف كلمة أو صورة أو مقطعًا صوتيًا قصيرًا — ما تشعر به الآن.",
        "step_2_title": "أضف أحبّاءك",
        "step_2_body": "InnFeel أروع مع الأصدقاء. ادعُ حتى 25 شخصًا في الخطة المجانية، وغير محدود في Pro.",
        "step_3_title": "افتح التغذية",
        "step_3_body": "عندما تشارك هالتك اليوم، تنكشف هالات أصدقائك — تبادل خالص، بلا تمرير لانهائي.",
        "cta": "افتح InnFeel",
        "footer": "أرسل الألوان، استقبل الألوان.\nفريق InnFeel",
    },
}


APP_URL = "https://innfeel.app"


def render_welcome_email(name: str = "", lang: str = "en") -> tuple[str, str, str]:
    l = _pick_lang(lang)
    c = _WELCOME_CONTENT[l]
    display_name = (name or "").strip() or ("friend" if l == "en" else "")
    greeting = c["greeting"].format(name=display_name).strip()
    dir_attr = 'dir="rtl"' if l == "ar" else ''

    def _step(num: int, color: str, title: str, body: str) -> str:
        return (
            '<tr><td style="padding:12px 32px 0 32px;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            '<tr>'
            f'<td valign="top" style="width:40px;padding-top:2px;">'
            f'<div style="width:32px;height:32px;border-radius:16px;background:{color};'
            f'color:#0B0B0F;font-weight:800;font-size:15px;text-align:center;line-height:32px;">{num}</div>'
            '</td>'
            '<td style="padding-left:12px;">'
            f'<div style="color:#fff;font-size:16px;font-weight:700;margin-bottom:4px;">{title}</div>'
            f'<div style="color:#B0B0BD;font-size:14px;line-height:20px;">{body}</div>'
            '</td>'
            '</tr></table>'
            '</td></tr>'
        )

    steps_html = (
        _step(1, "#A78BFA", c["step_1_title"], c["step_1_body"])
        + _step(2, "#F472B6", c["step_2_title"], c["step_2_body"])
        + _step(3, "#FDE047", c["step_3_title"], c["step_3_body"])
    )

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
            <td style="padding:16px 32px 6px 32px;color:#B0B0BD;font-size:15px;line-height:22px;">
              <p style="margin:0 0 10px 0;">{greeting}</p>
              <p style="margin:0 0 6px 0;">{c['intro']}</p>
            </td>
          </tr>
          {steps_html}
          <tr>
            <td style="padding:28px 32px 8px 32px;text-align:center;">
              <a href="{APP_URL}" style="display:inline-block;padding:14px 32px;border-radius:999px;background:linear-gradient(135deg,#A78BFA 0%,#F472B6 100%);color:#0B0B0F;font-weight:800;text-decoration:none;font-size:15px;letter-spacing:0.3px;">{c['cta']} ✦</a>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 28px 32px;border-top:1px solid rgba(255,255,255,0.06);color:#6B6B78;font-size:12px;line-height:18px;text-align:center;white-space:pre-line;margin-top:18px;">
{c['footer']}
            </td>
          </tr>
        </table>
        {render_brand_footer_html()}
      </td>
    </tr>
  </table>
</body>
</html>"""

    text = (
        f"{greeting}\n\n"
        f"{c['intro']}\n\n"
        f"1. {c['step_1_title']} — {c['step_1_body']}\n"
        f"2. {c['step_2_title']} — {c['step_2_body']}\n"
        f"3. {c['step_3_title']} — {c['step_3_body']}\n\n"
        f"{c['cta']}: {APP_URL}\n\n"
        f"{c['footer']}"
        f"{render_brand_footer_text()}"
    )
    return c["subject"], html, text


async def send_welcome_email(to: str, name: str = "", lang: str = "en") -> bool:
    subject, html, text = render_welcome_email(name=name, lang=lang)
    return await send_email_resend(to, subject, html, text)


# ===========================================================================
# Weekly recap email — personal stats of the previous 7 days
# ===========================================================================
_WEEKLY_CONTENT: dict[str, dict[str, str]] = {
    "en": {
        "subject": "Your InnFeel week ✦",
        "heading": "Your week, in color",
        "greeting": "Hi {name},",
        "intro": "Here's what your last 7 days on InnFeel looked like:",
        "lbl_auras": "Auras shared",
        "lbl_streak": "Current streak",
        "lbl_dominant": "Dominant emotion",
        "lbl_love": "Reactions received",
        "cta": "See full stats",
        "footer": "Every color counts.\nThe InnFeel team",
        "unsub_hint": "You can switch off weekly recaps in Settings → Notifications.",
        "days": "day·s",
    },
    "fr": {
        "subject": "Ta semaine InnFeel ✦",
        "heading": "Ta semaine, en couleur",
        "greeting": "Salut {name},",
        "intro": "Voilà ce à quoi ont ressemblé tes 7 derniers jours sur InnFeel :",
        "lbl_auras": "Auras partagées",
        "lbl_streak": "Série actuelle",
        "lbl_dominant": "Émotion dominante",
        "lbl_love": "Réactions reçues",
        "cta": "Voir les stats complètes",
        "footer": "Chaque couleur compte.\nL'équipe InnFeel",
        "unsub_hint": "Tu peux désactiver le récap hebdomadaire dans Paramètres → Notifications.",
        "days": "jour·s",
    },
    "es": {
        "subject": "Tu semana en InnFeel ✦",
        "heading": "Tu semana, en color",
        "greeting": "Hola {name},",
        "intro": "Esto fueron tus últimos 7 días en InnFeel:",
        "lbl_auras": "Auras compartidas",
        "lbl_streak": "Racha actual",
        "lbl_dominant": "Emoción dominante",
        "lbl_love": "Reacciones recibidas",
        "cta": "Ver estadísticas completas",
        "footer": "Cada color cuenta.\nEl equipo de InnFeel",
        "unsub_hint": "Puedes desactivar el resumen semanal en Ajustes → Notificaciones.",
        "days": "día·s",
    },
    "it": {
        "subject": "La tua settimana InnFeel ✦",
        "heading": "La tua settimana, a colori",
        "greeting": "Ciao {name},",
        "intro": "Ecco com'è andata la tua settimana su InnFeel:",
        "lbl_auras": "Aure condivise",
        "lbl_streak": "Streak attuale",
        "lbl_dominant": "Emozione dominante",
        "lbl_love": "Reazioni ricevute",
        "cta": "Vedi statistiche complete",
        "footer": "Ogni colore conta.\nIl team InnFeel",
        "unsub_hint": "Puoi disattivare il riepilogo settimanale in Impostazioni → Notifiche.",
        "days": "giorni",
    },
    "de": {
        "subject": "Deine InnFeel-Woche ✦",
        "heading": "Deine Woche in Farben",
        "greeting": "Hallo {name},",
        "intro": "So sahen deine letzten 7 Tage auf InnFeel aus:",
        "lbl_auras": "Geteilte Auren",
        "lbl_streak": "Aktuelle Serie",
        "lbl_dominant": "Dominante Emotion",
        "lbl_love": "Erhaltene Reaktionen",
        "cta": "Alle Statistiken",
        "footer": "Jede Farbe zählt.\nDein InnFeel-Team",
        "unsub_hint": "Den Wochenrückblick kannst du in Einstellungen → Benachrichtigungen ausschalten.",
        "days": "Tag·e",
    },
    "pt": {
        "subject": "A tua semana InnFeel ✦",
        "heading": "A tua semana, a cores",
        "greeting": "Olá {name},",
        "intro": "Assim foram os teus últimos 7 dias no InnFeel:",
        "lbl_auras": "Auras partilhadas",
        "lbl_streak": "Sequência atual",
        "lbl_dominant": "Emoção dominante",
        "lbl_love": "Reações recebidas",
        "cta": "Ver estatísticas completas",
        "footer": "Cada cor conta.\nA equipa InnFeel",
        "unsub_hint": "Podes desativar o resumo semanal em Definições → Notificações.",
        "days": "dias",
    },
    "ar": {
        "subject": "أسبوعك في InnFeel ✦",
        "heading": "أسبوعك، بالألوان",
        "greeting": "مرحبًا {name}،",
        "intro": "هكذا بدت آخر 7 أيام لك على InnFeel:",
        "lbl_auras": "الهالات المشاركة",
        "lbl_streak": "السلسلة الحالية",
        "lbl_dominant": "الشعور الغالب",
        "lbl_love": "التفاعلات المستلمة",
        "cta": "عرض كل الإحصاءات",
        "footer": "كل لون مهم.\nفريق InnFeel",
        "unsub_hint": "يمكنك إيقاف الملخص الأسبوعي من الإعدادات ← الإشعارات.",
        "days": "أيام",
    },
}


def render_weekly_recap_email(
    name: str = "",
    lang: str = "en",
    *,
    auras_count: int = 0,
    streak: int = 0,
    dominant: Optional[str] = None,
    dominant_color: Optional[str] = None,
    reactions_received: int = 0,
) -> tuple[str, str, str]:
    l = _pick_lang(lang)
    c = _WEEKLY_CONTENT[l]
    display_name = (name or "").strip() or ("friend" if l == "en" else "")
    greeting = c["greeting"].format(name=display_name).strip()
    dir_attr = 'dir="rtl"' if l == "ar" else ''
    dom_display = (dominant or "—").capitalize()
    dom_color = dominant_color or "#A78BFA"

    def _stat_card(label: str, value: str, color: str) -> str:
        return (
            '<td valign="top" width="50%" style="padding:6px;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="background:rgba(255,255,255,0.04);border:1px solid {color}33;'
            'border-radius:14px;padding:14px;">'
            '<tr><td>'
            f'<div style="color:{color};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;'
            'font-weight:700;margin-bottom:6px;">'
            f'{label}</div>'
            f'<div style="color:#fff;font-size:22px;font-weight:800;">{value}</div>'
            '</td></tr></table></td>'
        )

    stats_html = (
        '<tr><td style="padding:18px 26px 0 26px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        + _stat_card(c["lbl_auras"], str(auras_count), "#A78BFA")
        + _stat_card(c["lbl_streak"], f"{streak} {c['days']}", "#FB923C")
        + '</tr><tr>'
        + _stat_card(c["lbl_dominant"], dom_display, dom_color)
        + _stat_card(c["lbl_love"], str(reactions_received), "#F472B6")
        + '</tr></table></td></tr>'
    )

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
            <td style="padding:16px 32px 2px 32px;color:#B0B0BD;font-size:15px;line-height:22px;">
              <p style="margin:0 0 8px 0;">{greeting}</p>
              <p style="margin:0 0 0 0;">{c['intro']}</p>
            </td>
          </tr>
          {stats_html}
          <tr>
            <td style="padding:24px 32px 8px 32px;text-align:center;">
              <a href="{APP_URL}" style="display:inline-block;padding:13px 28px;border-radius:999px;background:linear-gradient(135deg,#A78BFA 0%,#F472B6 100%);color:#0B0B0F;font-weight:800;text-decoration:none;font-size:14px;letter-spacing:0.3px;">{c['cta']} ✦</a>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 10px 32px;text-align:center;color:#6B6B78;font-size:12px;line-height:17px;">
              {c['unsub_hint']}
            </td>
          </tr>
          <tr>
            <td style="padding:14px 32px 28px 32px;border-top:1px solid rgba(255,255,255,0.06);color:#6B6B78;font-size:12px;line-height:18px;text-align:center;white-space:pre-line;">
{c['footer']}
            </td>
          </tr>
        </table>
        {render_brand_footer_html()}
      </td>
    </tr>
  </table>
</body>
</html>"""

    text = (
        f"{greeting}\n\n"
        f"{c['intro']}\n\n"
        f"• {c['lbl_auras']}: {auras_count}\n"
        f"• {c['lbl_streak']}: {streak} {c['days']}\n"
        f"• {c['lbl_dominant']}: {dom_display}\n"
        f"• {c['lbl_love']}: {reactions_received}\n\n"
        f"{c['cta']}: {APP_URL}\n\n"
        f"{c['unsub_hint']}\n\n"
        f"{c['footer']}"
        f"{render_brand_footer_text()}"
    )
    return c["subject"], html, text


async def send_weekly_recap_email(
    to: str,
    name: str = "",
    lang: str = "en",
    **stats,
) -> bool:
    subject, html, text = render_weekly_recap_email(name=name, lang=lang, **stats)
    return await send_email_resend(to, subject, html, text)
