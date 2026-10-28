"""Entrance hostess + venue seating export - pure rules shared by core endpoints.

Two ways a guest list reaches the entrance:
- ShowUp's own hostess mode (core /public/hostess/{token}) on any tablet/phone.
- The venue's seating system (iPlan and the like): an Excel of the confirmed
  parties, one row per invitation, which the venue imports; their own hostess
  app (iPlan Hostess) then syncs from there. iPlan has no public API.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

ATTENDING = frozenset({"attending", "confirmed"})
MAX_PARTY = 50


def expected_count(status: Optional[str], guest_count: Optional[int], import_count: Optional[int]) -> int:
    """People the entrance should expect for one invitation: the confirmed
    number once the guest answered, otherwise the number the host invited."""
    if (status or "") in ATTENDING and guest_count:
        return int(guest_count)
    return int(import_count or 1)


def tables_from_layout(layout: Any) -> List[Dict[str, Any]]:
    """Numbered tables from events.seating_layout ({"tables": [{id, name, seats}]}).
    Guests point at a table by its number (guests.table_number = int(table id))."""
    tables = (layout or {}).get("tables") if isinstance(layout, dict) else None
    out = []
    for t in tables or []:
        try:
            number = int(str(t.get("id")))
        except (TypeError, ValueError):
            continue
        try:
            seats = max(0, int(t.get("seats") or 0))
        except (TypeError, ValueError):
            seats = 0
        out.append({"number": number, "name": str(t.get("name") or "").strip(), "seats": seats})
    out.sort(key=lambda t: t["number"])
    return out


def table_load(tables: List[Dict[str, Any]], guests: Iterable[Dict[str, Any]],
               walkins: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Per table: seats, people planned there, people actually sitting there.

    A checked-in party counts where it really sat (check-in table, else its
    planned table); a party not yet arrived counts at its planned table only if
    it confirmed - those are the seats to hold for them.
    """
    by_num: Dict[int, Dict[str, Any]] = {
        t["number"]: {**t, "planned": 0, "seated": 0} for t in tables
    }

    def row(n):
        if n not in by_num:
            by_num[n] = {"number": n, "name": "", "seats": 0, "planned": 0, "seated": 0}
        return by_num[n]

    for g in guests:
        if g.get("table") is not None and g.get("status") in ATTENDING:
            row(g["table"])["planned"] += g["expected"]
        if g.get("arrived"):
            sat = g.get("seated_table") if g.get("seated_table") is not None else g.get("table")
            if sat is not None:
                row(sat)["seated"] += g["arrived"]
    for w in walkins:
        if w.get("table") is not None:
            row(w["table"])["seated"] += w["count"]
    return [by_num[n] for n in sorted(by_num)]


def split_name(full: str) -> tuple:
    """"דנה כהן לוי" -> ("דנה", "כהן לוי"). Venue systems ask for first/last."""
    parts = (full or "").split()
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


SEATING_EXPORT_HEADERS = [
    "שם מלא", "שם פרטי", "שם משפחה", "טלפון", "קבוצה", "כמות מגיעים", "מספר שולחן", "הערות",
]


def seating_export_rows(guests: Iterable[Any]) -> List[List[Any]]:
    """Rows for the venue seating system: confirmed invitations only, one row per
    invitation with its party size (how venues import - each row is a seating
    unit, not a person)."""
    rows = []
    for g in guests:
        if (g.status or "") not in ATTENDING:
            continue
        first, last = split_name(g.name)
        rows.append([
            g.name, first, last, local_phone(g.phone), g.group or "",
            expected_count(g.status, g.guest_count, g.import_count),
            g.table_number or "", (g.notes or "").strip(),
        ])
    rows.sort(key=lambda r: ((r[4] or "￿"), r[0]))
    return rows


def local_phone(phone: Optional[str]) -> str:
    """+972501234567 -> 050-1234567 (how Israeli venue systems display/import)."""
    p = (phone or "").strip()
    if p.startswith("+972") and len(p) == 13:
        local = "0" + p[4:]
        return f"{local[:3]}-{local[3:]}"
    return p
