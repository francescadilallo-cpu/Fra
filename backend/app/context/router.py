"""Context API router — document upload + structured definitions."""

from __future__ import annotations

import io
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from .store import ContextStore, default_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/context", tags=["context"])


def _get_store() -> ContextStore:
    return default_store


def _get_current_user_dep():
    """Lazy import of get_current_user to avoid circular imports."""
    from app.main import get_current_user  # noqa: PLC0415

    return Depends(get_current_user)


# ── PDF extraction helper ──────────────────────────────────────────────────────


def _extract_text(content_bytes: bytes, filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        try:
            import pypdf  # noqa: PLC0415

            reader = pypdf.PdfReader(io.BytesIO(content_bytes))
            return "\n\n".join(
                page.extract_text() or "" for page in reader.pages
            ).strip()
        except Exception as exc:
            logger.warning("PDF extraction failed for %s: %s", filename, exc)
            return content_bytes.decode("utf-8", errors="replace")
    return content_bytes.decode("utf-8", errors="replace")


# ── Pydantic request/response models ──────────────────────────────────────────


class DocumentMeta(BaseModel):
    id: int
    filename: str
    file_type: str
    created_at: str


_MAX_UPLOAD_BYTES = 2 * 1024 * 1024  # 2 MB — prevent OOM on Render 512 MB tier


class EntityIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=128)
    synonyms: list[str] = Field(default_factory=list, max_length=20)
    description: str = Field(default="", max_length=1000)
    source: str = Field(default="", max_length=256)


class EntityOut(EntityIn):
    id: int
    created_at: str


class MetricIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=128)
    synonyms: list[str] = Field(default_factory=list, max_length=20)
    description: str = Field(default="", max_length=1000)
    unit: str = Field(default="", max_length=64)
    certified: bool = False


class MetricOut(MetricIn):
    id: int
    created_at: str


class GlossaryIn(BaseModel):
    term: str = Field(min_length=1, max_length=128)
    definition: str = Field(min_length=1, max_length=2000)


class GlossaryOut(GlossaryIn):
    id: int
    created_at: str


# ── Document endpoints ─────────────────────────────────────────────────────────


@router.post("/upload", response_model=DocumentMeta)
async def upload_document(
    file: UploadFile = File(...),
    store: ContextStore = Depends(_get_store),
):
    allowed = {".txt", ".md", ".pdf"}
    ext = (
        "." + file.filename.rsplit(".", 1)[-1].lower()
        if "." in (file.filename or "")
        else ""
    )
    if ext not in allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"File type not supported. Allowed: {', '.join(allowed)}",
        )
    raw = await file.read()
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"File exceeds {_MAX_UPLOAD_BYTES // 1024 // 1024} MB limit",
        )
    content = _extract_text(raw, file.filename or "upload")
    if not content.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="File appears to be empty or unreadable.",
        )
    doc = store.add_document(file.filename or "upload", content, ext.lstrip("."))
    return DocumentMeta(
        id=doc.id,
        filename=doc.filename,
        file_type=doc.file_type,
        created_at=doc.created_at,
    )


@router.get("/documents", response_model=list[DocumentMeta])
def list_documents(store: ContextStore = Depends(_get_store)):
    return [
        DocumentMeta(
            id=d.id, filename=d.filename, file_type=d.file_type, created_at=d.created_at
        )
        for d in store.list_documents()
    ]


@router.delete("/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(doc_id: int, store: ContextStore = Depends(_get_store)):
    if not store.delete_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")


@router.get("/search")
def search_documents(
    q: str = Query(..., min_length=1, max_length=256),
    store: ContextStore = Depends(_get_store),
):
    keywords = q.split()
    return {"snippets": store.search_documents(keywords)}


# ── Entity endpoints ───────────────────────────────────────────────────────────


@router.get("/entities", response_model=list[EntityOut])
def list_entities(store: ContextStore = Depends(_get_store)):
    return [EntityOut(**e.__dict__) for e in store.list_entities()]


@router.post("/entities", response_model=EntityOut, status_code=status.HTTP_201_CREATED)
def create_entity(body: EntityIn, store: ContextStore = Depends(_get_store)):
    e = store.add_entity(
        body.name, body.display_name, body.synonyms, body.description, body.source
    )
    return EntityOut(**e.__dict__)


@router.delete("/entities/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(entity_id: int, store: ContextStore = Depends(_get_store)):
    if not store.delete_entity(entity_id):
        raise HTTPException(status_code=404, detail="Entity not found")


# ── Metric endpoints ───────────────────────────────────────────────────────────


@router.get("/metrics", response_model=list[MetricOut])
def list_metrics(store: ContextStore = Depends(_get_store)):
    return [MetricOut(**m.__dict__) for m in store.list_metrics()]


@router.post("/metrics", response_model=MetricOut, status_code=status.HTTP_201_CREATED)
def create_metric(body: MetricIn, store: ContextStore = Depends(_get_store)):
    m = store.add_metric(
        body.name,
        body.display_name,
        body.synonyms,
        body.description,
        body.unit,
        body.certified,
    )
    return MetricOut(**m.__dict__)


@router.delete("/metrics/{metric_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_metric(metric_id: int, store: ContextStore = Depends(_get_store)):
    if not store.delete_metric(metric_id):
        raise HTTPException(status_code=404, detail="Metric not found")


# ── Glossary endpoints ─────────────────────────────────────────────────────────


@router.get("/glossary", response_model=list[GlossaryOut])
def list_glossary(store: ContextStore = Depends(_get_store)):
    return [GlossaryOut(**g.__dict__) for g in store.list_glossary()]


@router.post(
    "/glossary", response_model=GlossaryOut, status_code=status.HTTP_201_CREATED
)
def create_glossary_term(body: GlossaryIn, store: ContextStore = Depends(_get_store)):
    g = store.add_glossary_term(body.term, body.definition)
    return GlossaryOut(**g.__dict__)


@router.delete("/glossary/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_glossary_term(term_id: int, store: ContextStore = Depends(_get_store)):
    if not store.delete_glossary_term(term_id):
        raise HTTPException(status_code=404, detail="Term not found")
