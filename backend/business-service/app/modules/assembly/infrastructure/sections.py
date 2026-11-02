"""Transport sections: never raw material or warehouse stock quantities."""
import uuid
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import inspect, select, text, update, Sequence
from sqlalchemy.orm import defer
from app.modules.assembly.infrastructure.persistence.models import AssemblyFinishedGoodsModel, FinishedGoodsSectionModel


async def section_schema_missing(session):
    """Read-only preflight, cached for this request's session, never repairs data."""
    if "fg_section_schema_missing" not in session.info:
        def check(connection):
            inspector = inspect(connection)
            required = {
                "assembly_finished_goods": {"section_main_id", "section_supplier_id"},
                "finished_goods_request": {"section_fg_id"},
                "finished_goods_section": set(FinishedGoodsSectionModel.__table__.columns.keys()),
            }
            missing = []
            for table, columns in required.items():
                actual = {c["name"] for c in inspector.get_columns(table)} if inspector.has_table(table) else set()
                missing.extend(f"{table}.{name}" for name in sorted(columns - actual))
            if connection.dialect.name == "postgresql" and "fg_transport_main_number" not in inspector.get_sequence_names():
                missing.append("fg_transport_main_number sequence")
            return missing
        connection = await session.connection()
        session.info["fg_section_schema_missing"] = await connection.run_sync(check)
    return session.info["fg_section_schema_missing"]


async def require_section_schema(session):
    missing = await section_schema_missing(session)
    if missing:
        raise HTTPException(503, "FG section workflow requires database migrations through "
            "20261037_fg_section_numbering. Missing: " + ", ".join(missing))


async def compatible_fg_read(session, query):
    if await section_schema_missing(session):
        # Historical FG reads must not SELECT columns that have not been migrated.
        return query.options(defer(AssemblyFinishedGoodsModel.section_main_id, raiseload=True),
                             defer(AssemblyFinishedGoodsModel.section_supplier_id, raiseload=True))
    return query


async def assign_section_main_id(session, fg):
    await require_section_schema(session)
    if not fg.section_main_id:
        connection = await session.connection()
        if connection.dialect.name == "sqlite":
            await session.execute(text("INSERT INTO fg_transport_main_number DEFAULT VALUES"))
            number = await session.scalar(text("SELECT last_insert_rowid()"))
        else:
            number = await session.scalar(select(Sequence("fg_transport_main_number").next_value()))
        fg.section_main_id = f"FG-{number:04d}"


async def generate_sections(session, fg):
    await require_section_schema(session)
    # Caller must lock the parent. Existing labels and historical records stay unchanged.
    rows = (await session.scalars(select(FinishedGoodsSectionModel).where(
        FinishedGoodsSectionModel.finished_goods_id == fg.id))).all()
    if rows:
        if len(rows) != 8:
            raise HTTPException(409, "Incomplete section set requires administrator repair")
        return rows
    await assign_section_main_id(session, fg)
    rows = [FinishedGoodsSectionModel(finished_goods_id=fg.id, section_number=n,
        sub_id=f"{fg.section_main_id}-S{n:02d}",
        qr_identity=f"FGSECTION|{fg.id}|S{n:02d}|{uuid.uuid4().hex}") for n in range(1, 9)]
    session.add_all(rows)
    await session.flush()
    return rows


async def section_summary(session, fg_id):
    missing = await section_schema_missing(session)
    if missing:
        return {"main_fg_id": None, "sections": [], "dispatched_sections": None,
            "remaining_sections": None, "dispatch_status": None,
            "section_workflow_available": False,
            "section_workflow_message": "FG sections unavailable until database migrations through 20261037_fg_section_numbering are applied."}
    rows = (await session.scalars(select(FinishedGoodsSectionModel).where(
        FinishedGoodsSectionModel.finished_goods_id == fg_id).order_by(FinishedGoodsSectionModel.section_number))).all()
    dispatched = sum(r.status == "DISPATCHED" for r in rows)
    fg = await session.get(AssemblyFinishedGoodsModel, fg_id)
    return {"section_workflow_available": True, "main_fg_id": fg.section_main_id if fg else None, "sections": [{"sub_id": r.sub_id, "qr_identity": r.qr_identity,
        "status": r.status, "gate_visit_id": r.gate_visit_id,
        "loaded_by": r.loaded_by, "loaded_at": r.loaded_at.isoformat() if r.loaded_at else None,
        "dispatched_by": r.dispatched_by, "dispatched_at": r.dispatched_at.isoformat() if r.dispatched_at else None} for r in rows],
        "dispatched_sections": dispatched, "remaining_sections": sum(r.status == "AVAILABLE" for r in rows),
        "dispatch_status": ("FULLY_DISPATCHED" if dispatched == 8 else "PARTIALLY_DISPATCHED" if dispatched else "READY") if rows else None}


async def transition_sections(session, fg_id, visit_id, identities, actor, exiting=False):
    await require_section_schema(session)
    if not identities or len(identities) != len(set(identities)):
        raise HTTPException(422, "Scan each selected section exactly once")
    source, target = ("LOADED", "DISPATCHED") if exiting else ("AVAILABLE", "LOADED")
    for identity in sorted(identities):
        conditions = [FinishedGoodsSectionModel.finished_goods_id == fg_id,
            FinishedGoodsSectionModel.qr_identity == identity, FinishedGoodsSectionModel.status == source]
        if exiting:
            conditions.append(FinishedGoodsSectionModel.gate_visit_id == visit_id)
        values = {"status": target, "dispatched_at" if exiting else "loaded_at": datetime.now(),
            "dispatched_by" if exiting else "loaded_by": actor}
        if not exiting:
            values["gate_visit_id"] = visit_id
        result = await session.execute(update(FinishedGoodsSectionModel).where(*conditions).values(**values))
        if result.rowcount != 1:
            raise HTTPException(409, "Section QR is invalid, already allocated, or belongs to another vehicle")
