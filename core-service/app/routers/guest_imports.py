from __future__ import annotations

import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db import get_db
from app.crud import event as event_crud
from app.models.models import GuestImport, GuestImportContact
from shared.auth.deps import get_current_user_id

router = APIRouter(prefix="/guest-imports", tags=["guest-imports"])


class GuestImportContactUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None


class GuestImportContactApprove(BaseModel):
    name: Optional[str] = None
    group: Optional[str] = None
    import_count: Optional[int] = None
    table_number: Optional[int] = None


@router.get("")
def list_guest_imports(
    event_id: uuid.UUID = Query(...),
    status: Optional[str] = Query(None, description="Filter by status (pending, processing, completed, failed)"),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    List guest imports for an event.
    Optionally filter by status.
    """
    # AuthZ check
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    query = db.query(GuestImport).filter(GuestImport.event_id == str(event_id))

    if status:
        query = query.filter(GuestImport.status == status)

    imports = query.order_by(GuestImport.created_at.desc()).all()

    # Load contacts for each import
    result = []
    for imp in imports:
        # Filter contacts by status if needed (only pending contacts should be shown)
        contacts_query = db.query(GuestImportContact).filter(
            GuestImportContact.import_id == str(imp.id)
        )
        # Only show pending contacts (not already imported or rejected)
        contacts_query = contacts_query.filter(GuestImportContact.status == "pending")
        contacts = contacts_query.all()

        result.append({
            "id": str(imp.id),
            "event_id": str(imp.event_id),
            "source": imp.source,
            "raw_payload": imp.raw_payload,
            "status": imp.status,
            "message_id": imp.message_id,
            "created_at": imp.created_at.isoformat() if imp.created_at else None,
            "updated_at": imp.updated_at.isoformat() if imp.updated_at else None,
            "contacts": [
                {
                    "id": str(contact.id),
                    "import_id": str(contact.import_id),
                    "name": contact.name,
                    "phone": contact.phone,
                    "email": contact.email,
                    "status": contact.status,
                    "validation_errors": contact.validation_errors,
                    "created_at": contact.created_at.isoformat() if contact.created_at else None,
                }
                for contact in contacts
            ]
        })

    return result


@router.get("/summary")
def get_guest_import_summary(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Get summary of guest imports (counts by status).
    Returns count of pending contacts (not imports).
    """
    # AuthZ check
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    # Count pending contacts (contacts that haven't been approved/rejected yet)
    # Join with GuestImport to filter by event_id
    pending_count = db.query(func.count(GuestImportContact.id)).join(
        GuestImport, GuestImportContact.import_id == GuestImport.id
    ).filter(
        GuestImport.event_id == str(event_id),
        GuestImportContact.status == "pending"
    ).scalar() or 0

    # Count total contacts
    total_count = db.query(func.count(GuestImportContact.id)).join(
        GuestImport, GuestImportContact.import_id == GuestImport.id
    ).filter(
        GuestImport.event_id == str(event_id)
    ).scalar() or 0

    return {
        "pending_count": pending_count,
        "total_count": total_count
    }


@router.put("/contacts/{contact_id}")
def update_guest_import_contact(
    contact_id: uuid.UUID,
    data: GuestImportContactUpdate,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Update an imported guest contact (name, phone, email).
    """
    # Find the contact
    contact = db.query(GuestImportContact).filter(GuestImportContact.id == str(contact_id)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Guest import contact not found")

    # Get the import to check event ownership
    import_record = db.query(GuestImport).filter(GuestImport.id == str(contact.import_id)).first()
    if not import_record:
        raise HTTPException(status_code=404, detail="Guest import not found")

    # AuthZ check
    event = event_crud.get_event(db, import_record.event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    # Only allow updates to pending contacts
    if contact.status != "pending":
        raise HTTPException(status_code=400, detail="Can only update pending contacts")

    # Update fields
    if data.name is not None:
        contact.name = data.name
    if data.phone is not None:
        contact.phone = data.phone
    if data.email is not None:
        contact.email = data.email

    db.commit()

    return {
        "message": "Guest import contact updated",
        "contact_id": str(contact.id)
    }


@router.post("/contacts/{contact_id}/approve")
def approve_guest_import_contact(
    contact_id: uuid.UUID,
    data: Optional[GuestImportContactApprove] = Body(None),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Approve an imported guest contact and create a guest from it.
    Optional fields can be provided to override contact data or add additional fields.
    """
    # Find the contact
    contact = db.query(GuestImportContact).filter(GuestImportContact.id == str(contact_id)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Guest import contact not found")

    # Get the import to check event ownership
    import_record = db.query(GuestImport).filter(GuestImport.id == str(contact.import_id)).first()
    if not import_record:
        raise HTTPException(status_code=404, detail="Guest import not found")

    # AuthZ check
    event = event_crud.get_event(db, import_record.event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    # Import guest creation logic from guest_crud
    from app.crud import guest as guest_crud
    from app.schemas.schemas import GuestCreate

    # Use provided name or contact name
    name = (data.name if data and data.name else contact.name) or "ללא שם"
    phone = contact.phone or ""
    email = contact.email

    # Validate phone is present
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    # Create guest from contact with optional fields
    guest_data = GuestCreate(
        event_id=import_record.event_id,
        name=name,
        phone=phone,
        email=email,
        status="invited",
    )

    # Add optional fields if provided
    if data:
        if data.group is not None:
            guest_data.group = data.group
        if data.import_count is not None and data.import_count > 0:
            guest_data.import_count = data.import_count
        if data.table_number is not None and data.table_number > 0:
            guest_data.table_number = data.table_number

    # Create the guest
    guest = guest_crud.create_guest(db, guest_data)

    # Save contact ID before deletion
    contact_id = str(contact.id)
    
    # Delete the contact from the database after approval
    db.delete(contact)
    db.commit()

    return {
        "message": "Guest import contact approved and guest created",
        "guest_id": str(guest.id),
        "contact_id": contact_id
    }


@router.post("/contacts/{contact_id}/reject")
def reject_guest_import_contact(
    contact_id: uuid.UUID,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Reject an imported guest contact (mark as rejected, don't create guest).
    """
    # Find the contact
    contact = db.query(GuestImportContact).filter(GuestImportContact.id == str(contact_id)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Guest import contact not found")

    # Get the import to check event ownership
    import_record = db.query(GuestImport).filter(GuestImport.id == str(contact.import_id)).first()
    if not import_record:
        raise HTTPException(status_code=404, detail="Guest import not found")

    # AuthZ check
    event = event_crud.get_event(db, import_record.event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    # Save contact ID before deletion
    contact_id = str(contact.id)
    
    # Delete the contact from the database after rejection
    db.delete(contact)
    db.commit()

    return {
        "message": "Guest import contact rejected",
        "contact_id": contact_id
    }

