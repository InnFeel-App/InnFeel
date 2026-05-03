"""Pydantic request/response models."""
from typing import Optional, Literal
from pydantic import BaseModel, Field, EmailStr


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=40)
    terms_accepted: Optional[bool] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


EMOTION_LITERAL = Literal[
    "joy", "happy", "love", "excitement",
    "grateful", "hopeful", "inspired", "confident", "motivated",
    "peace", "calm", "focus", "nostalgia",
    "tired", "bored", "unmotivated",
    "lonely", "sadness",
    "worried", "anxiety", "lost",
    "stressed", "overwhelmed", "anger",
]


class MusicTrackIn(BaseModel):
    track_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    artist: Optional[str] = Field(default=None, max_length=120)
    artwork_url: Optional[str] = Field(default=None, max_length=500)
    preview_url: str = Field(min_length=1, max_length=500)
    source: Literal["apple", "spotify"] = "apple"


class InnFeelIn(BaseModel):
    word: str = Field(min_length=1, max_length=30)
    emotion: EMOTION_LITERAL
    intensity: int = Field(ge=1, le=10)
    photo_b64: Optional[str] = None  # base64 image
    text: Optional[str] = Field(default=None, max_length=280)
    audio_b64: Optional[str] = None  # base64 audio
    audio_seconds: Optional[int] = Field(default=None, ge=1, le=30)
    music: Optional[MusicTrackIn] = None  # Pro: track from Apple/Spotify search
    privacy: Literal["friends", "close", "private"] = "friends"


class AvatarIn(BaseModel):
    avatar_b64: str = Field(min_length=1)


class ReactionIn(BaseModel):
    emoji: Literal["heart", "fire", "hug", "smile", "sparkle"]


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class MessageIn(BaseModel):
    text: Optional[str] = Field(default=None, max_length=1000)
    photo_b64: Optional[str] = None  # base64-encoded image (optional)
    audio_b64: Optional[str] = None  # base64-encoded audio (optional)
    audio_seconds: Optional[int] = Field(default=None, ge=1, le=60)


class MessageReactIn(BaseModel):
    emoji: Literal["heart", "thumb", "fire", "laugh", "wow", "sad"]


class AddFriendIn(BaseModel):
    email: EmailStr


class CheckoutIn(BaseModel):
    origin_url: Optional[str] = None


class AdminGrantProIn(BaseModel):
    email: EmailStr
    days: int = Field(ge=1, le=3650, default=30)
    note: Optional[str] = Field(default=None, max_length=200)


class AdminRevokeProIn(BaseModel):
    email: EmailStr


class PushTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    platform: Optional[Literal["ios", "android", "web"]] = None


class NotifPrefsIn(BaseModel):
    reminder: Optional[bool] = None
    reaction: Optional[bool] = None
    message: Optional[bool] = None
    friend: Optional[bool] = None


class IAPValidateIn(BaseModel):
    """Client posts a RevenueCat app_user_id after a successful purchase
    so the backend can call RevenueCat REST to fetch & cache the subscription state."""
    app_user_id: str = Field(min_length=1, max_length=200)


class UpdateProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)


class UpdateEmailIn(BaseModel):
    new_email: EmailStr
    password: str = Field(min_length=1)


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1)
    confirm: Literal["DELETE"]
