from __future__ import annotations

import os
import uuid
import logging
from typing import Any, Dict, Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.authz import require_event_permission
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/uploads", tags=["uploads"])

# --- Upload policy (production hardening) -----------------------------------
# Image-only uploads. MIME → allowed extensions. Anything else is rejected so the
# bucket can never be used to host arbitrary files (scripts, HTML, SVG w/ JS...).
ALLOWED_IMAGE_TYPES: Dict[str, set] = {
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
    "image/gif": {".gif"},
}
# Folders an upload may target, and whether they are image-only. Keeps keys scoped
# and prevents a client from writing to arbitrary prefixes.
ALLOWED_FOLDERS = {"invitations"}


def _upload_max_bytes() -> int:
    """Per-file hard size cap (bytes). Configurable; default 10 MB."""
    try:
        return max(1, int(os.getenv("UPLOAD_MAX_BYTES", str(10 * 1024 * 1024))))
    except (TypeError, ValueError):
        return 10 * 1024 * 1024


def _upload_max_per_event() -> int:
    """Storage quota expressed as a max object count per event. Combined with the
    per-file cap this bounds total storage per event. Configurable; default 30."""
    try:
        return max(1, int(os.getenv("UPLOAD_MAX_PER_EVENT", "30")))
    except (TypeError, ValueError):
        return 30


def _ext_of(filename: str) -> str:
    return ("." + filename.rsplit(".", 1)[1].lower()) if "." in filename else ""


def _object_url(bucket: str, region: str, key: str) -> str:
    # Matches the URL style the existing deployment already serves images from.
    if region == "il-central-1":
        return f"https://s3.{region}.amazonaws.com/{bucket}/{key}"
    return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"


# S3 client initialization
def get_s3_client():
    """Initialize and return S3 client with credentials from environment."""
    aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    aws_region = os.getenv("AWS_REGION","il-central-1")
    
    if not aws_access_key_id or not aws_secret_access_key:
        raise ValueError("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set")
    
    # Use boto3 Config to ensure region is properly set for presigned URLs
    # This is important for regions like il-central-1
    boto_config = Config(
        region_name=aws_region,
        signature_version='s3v4',
    )
    
    # For regions like il-central-1, we need to explicitly set the endpoint_url
    # to ensure the presigned URL uses the correct region-specific endpoint
    client_kwargs = {
        "aws_access_key_id": aws_access_key_id,
        "aws_secret_access_key": aws_secret_access_key,
        "config": boto_config,
    }
    
    # Explicitly set endpoint_url for newer regions to ensure correct region handling
    # This is especially important for il-central-1 and other newer regions
    if aws_region == "il-central-1":
        client_kwargs["endpoint_url"] = f"https://s3.{aws_region}.amazonaws.com"
    
    return boto3.client("s3", **client_kwargs)


# Named image slots with a STABLE logical path per event. Replacing a slot
# overwrites the same key (or deletes the old-extension sibling), so no orphan
# objects accumulate and every consumer keeps one canonical URL per slot.
IMAGE_PURPOSES = {
    "wa_cover",      # WhatsApp cover - default header for image-header WA templates
    "invite_cover",  # digital invitation / event-website cover (hero image)
}


class GenerateUploadUrlRequest(BaseModel):
    event_id: uuid.UUID = Field(..., description="Event this upload belongs to (ownership + quota are scoped to it)")
    filename: str = Field(..., max_length=255, description="Original filename (used only for its extension)")
    content_type: str = Field(..., max_length=100, description="MIME type; must be an allowed image type")
    folder: Optional[str] = Field(default="invitations", description="Target folder (allow-listed)")
    # Optional named slot. When set, the object key is the slot's stable path
    # (invitations/{event_id}/{purpose}{ext}) instead of a random UUID, and
    # /uploads/finalize replaces the previous image + updates the event default.
    purpose: Optional[str] = Field(default=None, description="Named image slot (wa_cover | invite_cover)")


class GenerateUploadUrlResponse(BaseModel):
    # Presigned POST (not PUT): POST lets S3 enforce a content-length-range, so the
    # size cap is applied by S3 itself and cannot be bypassed by the client.
    url: str = Field(..., description="Presigned POST endpoint")
    fields: Dict[str, Any] = Field(..., description="Form fields to send with the file")
    key: str = Field(..., description="S3 object key")
    object_url: str = Field(..., description="Public URL the object will have once uploaded")
    max_bytes: int = Field(..., description="Server-enforced max file size")
    expires_in: int = Field(900, description="URL expiration (seconds)")


@router.post("/generate-upload-url", response_model=GenerateUploadUrlResponse)
def generate_upload_url(
    request_data: GenerateUploadUrlRequest = Body(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Issue a scoped, validated presigned POST for a single image upload.

    Hardening applied server-side (the client is never trusted):
    - ownership: caller must have EVENT_WRITE on ``event_id``;
    - MIME + extension must be an allowed image type (image-only; no arbitrary files);
    - size is capped by S3 via a content-length-range condition on the presigned POST;
    - per-event object-count quota bounds total storage;
    - the object key is server-generated and scoped to ``{folder}/{event_id}/``.
    """
    # --- ownership ---------------------------------------------------------
    event = event_crud.get_event(db, request_data.event_id)
    require_event_permission(db, event, user_id, Action.EVENT_WRITE)

    # --- folder allow-list -------------------------------------------------
    folder = (request_data.folder or "invitations").strip("/")
    if folder not in ALLOWED_FOLDERS:
        raise HTTPException(status_code=400, detail=f"Uploads to '{folder}' are not allowed")

    # --- MIME + extension validation (image-only) --------------------------
    content_type = (request_data.content_type or "").strip().lower()
    allowed_exts = ALLOWED_IMAGE_TYPES.get(content_type)
    if allowed_exts is None:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. Allowed: {', '.join(sorted(ALLOWED_IMAGE_TYPES))}",
        )
    ext = _ext_of(request_data.filename)
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"File extension '{ext or '(none)'}' does not match {content_type}",
        )

    bucket_name = os.getenv("S3_BUCKET_NAME")
    if not bucket_name:
        logger.error("S3_BUCKET_NAME is not configured")
        raise HTTPException(status_code=500, detail="Uploads are not configured on the server")
    region = os.getenv("AWS_REGION", "il-central-1")
    try:
        s3_client = get_s3_client()
    except Exception as e:  # noqa: BLE001
        logger.error(f"Failed to initialize S3 client: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Uploads are not configured on the server")

    prefix = f"{folder}/{request_data.event_id}/"
    max_bytes = _upload_max_bytes()
    max_count = _upload_max_per_event()

    # --- per-event storage quota (object count) ----------------------------
    # Only successfully-uploaded objects exist under the prefix, so counting them
    # is an accurate quota measure. Best-effort: an S3 listing error must not wedge
    # uploads, but it is logged.
    try:
        resp = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
        current = resp.get("KeyCount", 0)
        if current >= max_count:
            raise HTTPException(
                status_code=409,
                detail=f"Upload limit reached for this event ({max_count} files). Remove some to add more.",
            )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.warning(f"upload quota check failed for {prefix} (allowing): {e}")

    purpose = (request_data.purpose or "").strip() or None
    if purpose and purpose not in IMAGE_PURPOSES:
        raise HTTPException(status_code=400, detail=f"Unknown image purpose '{purpose}'")
    # Named slots keep a stable logical path so replacing an image overwrites it
    # in place; ad-hoc uploads (gallery/hero variants) stay collision-free UUIDs.
    key = f"{prefix}{purpose}{ext}" if purpose else f"{prefix}{uuid.uuid4()}{ext}"
    try:
        presigned = s3_client.generate_presigned_post(
            Bucket=bucket_name,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"Content-Type": content_type},          # MIME pinned
                ["content-length-range", 1, max_bytes],  # size enforced by S3
            ],
            ExpiresIn=900,
        )
    except ClientError as e:
        logger.error(f"generate_presigned_post failed for {key}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail="Could not create upload URL")

    return GenerateUploadUrlResponse(
        url=presigned["url"],
        fields=presigned["fields"],
        key=key,
        object_url=_object_url(bucket_name, region, key),
        max_bytes=max_bytes,
        expires_in=900,
    )


class FinalizeImageRequest(BaseModel):
    event_id: uuid.UUID
    purpose: str = Field(..., description="Named image slot (wa_cover | invite_cover)")
    key: str = Field(..., max_length=512, description="The S3 key returned by generate-upload-url")


class FinalizeImageResponse(BaseModel):
    url: str = Field(..., description="Canonical, cache-busted URL to use everywhere")


@router.post("/finalize", response_model=FinalizeImageResponse)
def finalize_image(
    request_data: FinalizeImageRequest = Body(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Complete a named-slot image upload (or replacement).

    - verifies the object actually landed in S3;
    - deletes any STALE siblings of the slot (same logical name, other
      extension) so no orphan originals/previews remain in storage;
    - stamps a cache-busting version on the URL so guests / WhatsApp / the app
      never keep serving the replaced image;
    - updates the event's default in every place the slot feeds:
        wa_cover     -> events.wa_image_url (default WA template header)
        invite_cover -> event.invitation.hero.imageUrl (landing page + website)
    """
    event = event_crud.get_event(db, request_data.event_id)
    require_event_permission(db, event, user_id, Action.EVENT_WRITE)

    purpose = (request_data.purpose or "").strip()
    if purpose not in IMAGE_PURPOSES:
        raise HTTPException(status_code=400, detail=f"Unknown image purpose '{purpose}'")

    prefix = f"invitations/{request_data.event_id}/"
    key = request_data.key
    if not key.startswith(f"{prefix}{purpose}"):
        raise HTTPException(status_code=400, detail="key does not belong to this slot")

    bucket_name = os.getenv("S3_BUCKET_NAME")
    if not bucket_name:
        raise HTTPException(status_code=500, detail="Uploads are not configured on the server")
    region = os.getenv("AWS_REGION", "il-central-1")
    try:
        s3_client = get_s3_client()
    except Exception:
        raise HTTPException(status_code=500, detail="Uploads are not configured on the server")

    # The upload must exist before we delete anything or point defaults at it.
    try:
        s3_client.head_object(Bucket=bucket_name, Key=key)
    except ClientError:
        raise HTTPException(status_code=409, detail="upload not found - complete the upload first")

    # Remove stale siblings (same slot, different extension) - the "previous
    # original + preview" cleanup. Same-key replacement already overwrote.
    # Deleting each candidate extension directly (instead of ListObjects) works
    # under an IAM policy that grants only object-level permissions, and S3's
    # DeleteObject succeeds silently for keys that don't exist.
    all_exts = {e for exts in ALLOWED_IMAGE_TYPES.values() for e in exts}
    stale = [f"{prefix}{purpose}{e}" for e in sorted(all_exts) if f"{prefix}{purpose}{e}" != key]
    try:
        s3_client.delete_objects(Bucket=bucket_name, Delete={"Objects": [{"Key": k} for k in stale], "Quiet": True})
        logger.info("finalize_image: pruned stale slot siblings for %s", f"{prefix}{purpose}")
    except Exception as e:  # noqa: BLE001 - cleanup is best-effort
        logger.warning("finalize_image: stale cleanup failed for %s: %s", key, e)

    # Cache-bust: S3/browser/WhatsApp caches must never pin the old bytes.
    url = f"{_object_url(bucket_name, region, key)}?v={uuid.uuid4().hex[:10]}"

    if purpose == "wa_cover":
        event.wa_image_url = url
    else:  # invite_cover
        invitation = dict(event.invitation or {})
        hero = dict(invitation.get("hero") or {})
        hero["imageUrl"] = url
        invitation["hero"] = hero
        event.invitation = invitation
    db.add(event)
    db.commit()

    return FinalizeImageResponse(url=url)
