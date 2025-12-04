from __future__ import annotations

import os
import uuid
import logging
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field

from shared.auth.deps import get_current_user_id

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/uploads", tags=["uploads"])


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


class GenerateUploadUrlRequest(BaseModel):
    filename: str = Field(..., description="Original filename for the upload")
    content_type: str = Field(..., description="MIME type of the file (e.g., image/jpeg, application/pdf)")
    folder: Optional[str] = Field(default="uploads", description="S3 folder/path prefix (default: 'uploads')")


class GenerateUploadUrlResponse(BaseModel):
    upload_url: str = Field(..., description="Presigned URL for PUT upload")
    key: str = Field(..., description="S3 object key (full path)")
    expires_in: int = Field(900, description="URL expiration time in seconds")


@router.post("/generate-upload-url", response_model=GenerateUploadUrlResponse)
def generate_upload_url(
    request_data: GenerateUploadUrlRequest = Body(...),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Generate a presigned URL for uploading a file directly to S3.
    
    The client can use this URL to upload files directly to S3 without going through the API server.
    The URL expires after 15 minutes (900 seconds) by default.
    
    Requires authentication (valid JWT token).
    """
    try:
        logger.info(
            "Generating presigned URL",
            extra={
                "user_id": str(user_id),
                "filename": request_data.filename,
                "content_type": request_data.content_type,
                "folder": request_data.folder,
            }
        )
        
        bucket_name = os.getenv("S3_BUCKET_NAME")
        if not bucket_name:
            logger.error("S3_BUCKET_NAME environment variable is not configured")
            raise HTTPException(
                status_code=500,
                detail="S3_BUCKET_NAME environment variable is not configured"
            )
        
        try:
            s3_client = get_s3_client()
            logger.debug("S3 client initialized successfully")
        except ValueError as e:
            logger.error(f"Failed to initialize S3 client: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            logger.error(f"Unexpected error initializing S3 client: {str(e)}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to initialize S3 client: {str(e)}"
            )
        
        # Generate a unique key to avoid collisions
        # Format: {folder}/{user_id}/{uuid}-{original_filename}
        file_extension = ""
        if "." in request_data.filename:
            file_extension = "." + request_data.filename.rsplit(".", 1)[1]
        
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        folder = request_data.folder.strip("/") if request_data.folder else "uploads"
        key = f"{folder}/{user_id}/{unique_filename}"
        
        logger.info(f"Generating presigned URL for key: {key}, bucket: {bucket_name}")
        
        try:
            # Generate presigned URL for PUT operation
            presigned_url = s3_client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": bucket_name,
                    "Key": key,
                    "ContentType": request_data.content_type,
                },
                ExpiresIn=900,  # 15 minutes
            )
            
            logger.info(f"Successfully generated presigned URL for key: {key}")
            
            return GenerateUploadUrlResponse(
                upload_url=presigned_url,
                key=key,
                expires_in=900,
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            error_message = e.response.get("Error", {}).get("Message", str(e))
            logger.error(
                f"Failed to generate presigned URL: {error_code} - {error_message}",
                extra={
                    "error_code": error_code,
                    "error_message": error_message,
                    "bucket": bucket_name,
                    "key": key,
                },
                exc_info=True
            )
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate presigned URL: {error_code} - {error_message}"
            )
        except Exception as e:
            logger.error(f"Unexpected error generating presigned URL: {str(e)}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Unexpected error: {str(e)}"
            )
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Catch any other unexpected errors
        logger.error(f"Unexpected error in generate_upload_url: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )

