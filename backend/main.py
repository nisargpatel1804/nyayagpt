import os
import asyncio
import warnings
import logging
import time
import re
from typing import Deque, Optional, Callable, Any
from uuid import UUID, uuid4
from collections import deque

from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, constr
from jose import jwt, JWTError
from supabase import create_client, Client
from postgrest.exceptions import APIError
from dotenv import load_dotenv

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
try:
    import posthog
    posthog.disabled = True

    def _posthog_noop(*args, **kwargs):
        return None

    posthog.capture = _posthog_noop
except Exception:
    pass

warnings.filterwarnings("ignore", category=DeprecationWarning, module="langchain")

from langchain_community.chat_models import ChatOllama
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_db")
CHROMA_COLLECTION_NAME = os.getenv("CHROMA_COLLECTION_NAME", "nyayagpt")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY or not SUPABASE_JWT_SECRET:
    raise RuntimeError("Missing Supabase environment variables.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2",
    model_kwargs={"device": "cpu"},
)
vectorstore = Chroma(
    persist_directory=CHROMA_DIR,
    embedding_function=embeddings,
    collection_name=CHROMA_COLLECTION_NAME,
)
llm = ChatOllama(model=OLLAMA_MODEL, temperature=0, base_url=OLLAMA_BASE_URL)

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FILE = os.getenv("LOG_FILE")
handlers = [logging.StreamHandler()]
if LOG_FILE:
    from logging.handlers import RotatingFileHandler

    handlers.append(RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=3))

logging.basicConfig(level=LOG_LEVEL, handlers=handlers)
logger = logging.getLogger("nyayagpt")


def _is_missing_column_error(exc: Exception, column: str | None = None) -> bool:
    if not isinstance(exc, APIError):
        return False
    payload = exc.args[0] if exc.args else {}
    if not isinstance(payload, dict):
        return False
    if payload.get("code") != "42703":
        return False
    message = payload.get("message", "") or ""
    return (column in message) if column else True

def _env_int(name: str, default: int, min_value: int | None = None, max_value: int | None = None) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError:
        logger.warning("Invalid integer for %s=%s. Using default %s.", name, raw, default)
        value = default
    if min_value is not None:
        value = max(min_value, value)
    if max_value is not None:
        value = min(max_value, value)
    return value


MAX_MESSAGE_LENGTH = _env_int("MAX_MESSAGE_LENGTH", 2000, min_value=1, max_value=8000)
MAX_CONTEXT_CHARS = _env_int("MAX_CONTEXT_CHARS", 6000, min_value=500, max_value=20000)
MAX_CONTEXT_DOCS = _env_int("MAX_CONTEXT_DOCS", 6, min_value=1, max_value=20)
MAX_REQUEST_BYTES = _env_int("MAX_REQUEST_BYTES", 120_000, min_value=1_024, max_value=2_000_000)
RATE_LIMIT_WINDOW_SECONDS = _env_int("RATE_LIMIT_WINDOW_SECONDS", 60, min_value=10, max_value=600)
RATE_LIMIT_MAX_REQUESTS = _env_int("RATE_LIMIT_MAX_REQUESTS", 30, min_value=1, max_value=300)
RATE_LIMIT_IP_MAX_REQUESTS = _env_int("RATE_LIMIT_IP_MAX_REQUESTS", 120, min_value=1, max_value=1000)
MAX_HISTORY_MESSAGES = _env_int("MAX_HISTORY_MESSAGES", 8, min_value=0, max_value=50)
MAX_HISTORY_CHARS = _env_int("MAX_HISTORY_CHARS", 2500, min_value=200, max_value=15000)
DEFAULT_PAGE_LIMIT = _env_int("DEFAULT_PAGE_LIMIT", 50, min_value=1, max_value=200)
MAX_PAGE_LIMIT = _env_int("MAX_PAGE_LIMIT", 200, min_value=10, max_value=500)

SYSTEM_PROMPT = (
    "You are a specialized Indian Legal AI Assistant. "
    "You must answer the user's question strictly based ONLY on the provided Context below. "
    "If the answer is not found in the Context, politely state that you do not have that specific legal information. "
    "Do not fabricate laws or sections. Context: {context}"
)

ERROR_CHAT_NOT_FOUND = "Chat not found."
ERROR_FORBIDDEN_CHAT = "Forbidden: chat does not belong to the authenticated user."


class ChatRequest(BaseModel):
    message: constr(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    chat_id: UUID


class TokenData(BaseModel):
    sub: str


class CreateChatRequest(BaseModel):
    title: Optional[constr(min_length=1, max_length=80)] = None


def verify_token(authorization: str = Header(...)) -> TokenData:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header.")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        sub = payload.get("sub")
        if not sub:
            raise JWTError("Missing subject in token.")
        return TokenData(sub=sub)
    except JWTError:
        try:
            user_resp = supabase.auth.get_user(token)
            user = None
            if hasattr(user_resp, "user"):
                user = user_resp.user
            elif isinstance(user_resp, dict):
                user = user_resp.get("user")
            if not user or not getattr(user, "id", None):
                raise HTTPException(status_code=401, detail="Invalid token.")
            return TokenData(sub=user.id)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Invalid token.") from exc


def _save_messages_sync(chat_id: str, user_message: str, ai_message: str):
    rows = [
        {"chat_id": chat_id, "role": "user", "content": user_message},
        {"chat_id": chat_id, "role": "assistant", "content": ai_message},
    ]
    supabase.table("messages").insert(rows).execute()


async def safe_save_messages(chat_id: str, user_message: str, ai_message: str):
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_save_messages_sync, chat_id, user_message, ai_message),
            timeout=15,
        )
    except Exception as exc:
        logger.exception("Failed to persist messages for chat %s", chat_id)


class RenameChatRequest(BaseModel):
    title: constr(min_length=1, max_length=80)
    only_if_default: bool | None = False


FRONTEND_ORIGINS = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip() for o in FRONTEND_ORIGINS.split(",") if o.strip()]
if "*" in _allowed_origins:
    logger.warning("CORS is configured with wildcard origin. This is not recommended for production.")

app = FastAPI()


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def enforce_request_size(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH"}:
        body = await request.body()
        if len(body) > MAX_REQUEST_BYTES:
            return error_response(
                "REQUEST_TOO_LARGE",
                "Request payload too large.",
                status_code=413,
                request_id=getattr(request.state, "request_id", None),
            )
    return await call_next(request)


@app.middleware("http")
async def enforce_origin(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and "*" not in _allowed_origins and origin not in _allowed_origins:
            return error_response(
                "CSRF_ORIGIN_DENIED",
                "Invalid origin.",
                status_code=403,
                request_id=getattr(request.state, "request_id", None),
            )
    return await call_next(request)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_checks():
    try:
        count = _get_vectorstore_count()
        if count == 0:
            logger.warning("Vectorstore is empty. Run ingest.py before serving queries.")
    except Exception:
        logger.exception("Failed to validate vectorstore on startup")
    try:
        await _check_ollama()
    except Exception:
        logger.exception("Failed to validate Ollama on startup")

_rate_limit_store: dict[str, Deque[float]] = {}
_rate_limit_store_ip: dict[str, Deque[float]] = {}


def _rate_limit_key(user_id: str, ip: str | None) -> str:
    return f"{user_id}:{ip or 'unknown'}"


def _enforce_window(store: dict[str, Deque[float]], key: str, limit: int) -> None:
    now = time.monotonic()
    dq = store.setdefault(key, deque())
    while dq and now - dq[0] > RATE_LIMIT_WINDOW_SECONDS:
        dq.popleft()
    if len(dq) >= limit:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please slow down.")
    dq.append(now)


def enforce_rate_limit(user_id: str, ip: str | None) -> None:
    _enforce_window(_rate_limit_store, _rate_limit_key(user_id, ip), RATE_LIMIT_MAX_REQUESTS)
    if ip:
        _enforce_window(_rate_limit_store_ip, ip, RATE_LIMIT_IP_MAX_REQUESTS)
    if len(_rate_limit_store) > 10_000 or len(_rate_limit_store_ip) > 10_000:
        _cleanup_rate_limit_store()


def error_response(code: str, message: str, status_code: int = 500, request_id: str | None = None) -> JSONResponse:
    payload = {"error": {"code": code, "message": message}}
    if request_id:
        payload["error"]["request_id"] = request_id
    return JSONResponse(status_code=status_code, content=payload)


def _cleanup_rate_limit_store() -> None:
    now = time.monotonic()
    for store in (_rate_limit_store, _rate_limit_store_ip):
        keys_to_delete = []
        for key, dq in store.items():
            while dq and now - dq[0] > RATE_LIMIT_WINDOW_SECONDS:
                dq.popleft()
            if not dq:
                keys_to_delete.append(key)
        for key in keys_to_delete:
            store.pop(key, None)


def sanitize_text(value: str, max_length: int) -> str:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value.strip())
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]
    return cleaned


def truncate_at_word(text: str, max_length: int) -> str:
    if len(text) <= max_length:
        return text
    truncated = text[:max_length]
    last_space = truncated.rfind(" ")
    if last_space > max_length * 0.6:
        return truncated[:last_space].rstrip()
    return truncated.rstrip()


def _trim_history_by_chars(messages: list[Any], max_chars: int) -> list[Any]:
    if not messages:
        return []
    total = 0
    trimmed: list[Any] = []
    for msg in reversed(messages):
        content = getattr(msg, "content", "") or ""
        total += len(content)
        if total > max_chars:
            break
        trimmed.append(msg)
    return list(reversed(trimmed))


async def _check_ollama() -> None:
    import urllib.request
    try:
        with urllib.request.urlopen(f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags", timeout=3) as response:
            if response.status >= 400:
                raise RuntimeError("Ollama health check failed")
    except Exception:
        raise RuntimeError("Ollama health check failed")


async def _generate_response(messages: list[Any]) -> str:
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            result = await llm.ainvoke(messages)
            return getattr(result, "content", "") or ""
        except Exception as exc:
            last_exc = exc
            await asyncio.sleep(0.2 * (2 ** attempt))
    logger.exception("LLM generation failed", exc_info=last_exc)
    raise HTTPException(status_code=503, detail="Generation failed. Please try again.")


_chats_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_chats_cache_ttl = 15


def _get_cached_chats(user_id: str) -> Optional[list[dict[str, Any]]]:
    cached = _chats_cache.get(user_id)
    if not cached:
        return None
    ts, data = cached
    if time.monotonic() - ts > _chats_cache_ttl:
        _chats_cache.pop(user_id, None)
        return None
    return data


def _set_cached_chats(user_id: str, data: list[dict[str, Any]]):
    _chats_cache[user_id] = (time.monotonic(), data)


def _invalidate_chats_cache(user_id: str):
    _chats_cache.pop(user_id, None)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", None)
    return error_response("HTTP_ERROR", str(exc.detail), exc.status_code, request_id=request_id)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", None)
    logger.exception("Unhandled error", exc_info=exc)
    return error_response("INTERNAL_SERVER_ERROR", "Unexpected server error.", 500, request_id=request_id)


async def execute_supabase(action: Callable[[], Any], retries: int = 3, base_delay: float = 0.2):
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            return await asyncio.to_thread(action)
        except Exception as exc:
            last_exc = exc
            if attempt == retries - 1:
                break
            await asyncio.sleep(base_delay * (2 ** attempt))
    if last_exc:
        raise last_exc
    raise RuntimeError("Supabase call failed.")


def _get_vectorstore_count() -> int:
    try:
        if hasattr(vectorstore, "_collection") and hasattr(vectorstore._collection, "count"):
            return int(vectorstore._collection.count())
    except Exception:
        pass
    return 0


def _extract_supabase_data(res: Any) -> Any:
    return res.get("data") if isinstance(res, dict) else (res.data if hasattr(res, "data") else None)


async def _verify_chat_ownership(chat_id: str, user_id: str) -> None:
    chat_res = await execute_supabase(
        lambda: supabase.table("chats").select("user_id").eq("id", chat_id).single().execute()
    )
    chat_data = _extract_supabase_data(chat_res)
    if not chat_data:
        raise HTTPException(status_code=404, detail=ERROR_CHAT_NOT_FOUND)
    if chat_data.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail=ERROR_FORBIDDEN_CHAT)


async def _get_recent_messages(chat_id: str, limit: int) -> list[Any]:
    if limit <= 0:
        return []
    res = await execute_supabase(
        lambda: supabase.table("messages")
        .select("role, content, created_at")
        .eq("chat_id", chat_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = list(reversed(_extract_supabase_data(res) or []))
    messages: list[Any] = []
    for row in rows:
        role = row.get("role")
        content = row.get("content") or ""
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    return messages


@app.get("/v1/health")
async def health_check(request: Request):
    request_id = getattr(request.state, "request_id", None)
    health = {"status": "ok", "request_id": request_id, "dependencies": {}}

    try:
        await execute_supabase(lambda: supabase.table("chats").select("id").limit(1).execute())
        health["dependencies"]["supabase"] = "ok"
    except Exception:
        health["dependencies"]["supabase"] = "error"
        health["status"] = "degraded"

    count = _get_vectorstore_count()
    health["dependencies"]["vectorstore"] = "ok" if count > 0 else "empty"
    if count == 0:
        health["status"] = "degraded"

    try:
        await _check_ollama()
        health["dependencies"]["ollama"] = "ok"
    except Exception:
        health["dependencies"]["ollama"] = "error"
        health["status"] = "degraded"

    return health


@app.get("/v1/chats")
async def list_chats(
    token_data: TokenData = Depends(verify_token),
    limit: int = DEFAULT_PAGE_LIMIT,
    before: Optional[str] = None,
):
    limit = max(1, min(limit, MAX_PAGE_LIMIT))
    if not before and limit == DEFAULT_PAGE_LIMIT:
        cached = _get_cached_chats(token_data.sub)
        if cached is not None:
            return {"chats": cached}
    query = (
        supabase.table("chats")
        .select("id, title, pinned, created_at")
        .eq("user_id", token_data.sub)
        .order("pinned", desc=True)
        .order("created_at", desc=True)
    )
    if before:
        query = query.lt("created_at", before)
    try:
        res = await execute_supabase(lambda: query.limit(limit).execute())
        chats = _extract_supabase_data(res) or []
    except APIError as exc:
        if not _is_missing_column_error(exc, "chats.pinned"):
            raise
        fallback_query = (
            supabase.table("chats")
            .select("id, title, created_at")
            .eq("user_id", token_data.sub)
            .order("created_at", desc=True)
        )
        if before:
            fallback_query = fallback_query.lt("created_at", before)
        res = await execute_supabase(lambda: fallback_query.limit(limit).execute())
        chats = _extract_supabase_data(res) or []
        for chat in chats:
            chat["pinned"] = False
    if not before and limit == DEFAULT_PAGE_LIMIT:
        _set_cached_chats(token_data.sub, chats)
    return {"chats": chats}


@app.post("/v1/chats")
async def create_chat(payload: CreateChatRequest, token_data: TokenData = Depends(verify_token)):
    title = sanitize_text(payload.title or "New chat", 80) or "New chat"
    try:
        res = await execute_supabase(
            lambda: supabase.table("chats")
            .insert({"user_id": token_data.sub, "title": title})
            .select("id, title, pinned")
            .single()
            .execute()
        )
        data = _extract_supabase_data(res)
    except APIError as exc:
        if not _is_missing_column_error(exc, "chats.pinned"):
            raise
        res = await execute_supabase(
            lambda: supabase.table("chats")
            .insert({"user_id": token_data.sub, "title": title})
            .select("id, title")
            .single()
            .execute()
        )
        data = _extract_supabase_data(res)
        if data is not None:
            data["pinned"] = False
    if not data:
        return error_response("CHAT_CREATE_FAILED", "Unable to create chat.", 500)
    _invalidate_chats_cache(token_data.sub)
    return {"chat": data}


@app.get("/v1/chats/{chat_id}/messages")
async def get_chat_messages(
    chat_id: UUID,
    token_data: TokenData = Depends(verify_token),
    limit: int = DEFAULT_PAGE_LIMIT,
    before: Optional[str] = None,
):
    limit = max(1, min(limit, MAX_PAGE_LIMIT))
    await _verify_chat_ownership(str(chat_id), token_data.sub)

    query = (
        supabase.table("messages")
        .select("id, role, content, created_at")
        .eq("chat_id", str(chat_id))
    )
    if before:
        query = query.lt("created_at", before)
    res = await execute_supabase(lambda: query.order("created_at", desc=False).limit(limit).execute())
    return {"messages": _extract_supabase_data(res) or []}


@app.post("/v1/chat")
async def chat(payload: ChatRequest, request: Request, token_data: TokenData = Depends(verify_token)):
    enforce_rate_limit(token_data.sub, request.client.host if request.client else None)
    await _verify_chat_ownership(str(payload.chat_id), token_data.sub)

    user_message = sanitize_text(payload.message, MAX_MESSAGE_LENGTH)
    if not user_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    try:
        docs = vectorstore.similarity_search(user_message, k=MAX_CONTEXT_DOCS)
        context_parts: list[str] = []
        total_chars = 0
        for doc in docs:
            text = doc.page_content
            if total_chars + len(text) > MAX_CONTEXT_CHARS:
                remaining = max(0, MAX_CONTEXT_CHARS - total_chars)
                if remaining > 0:
                    context_parts.append(truncate_at_word(text, remaining))
                break
            context_parts.append(text)
            total_chars += len(text)
        context = "\n\n".join(context_parts)
        if not context:
            return error_response("CONTEXT_EMPTY", "No relevant context found for this query.", 404, request_id=getattr(request.state, "request_id", None))
    except Exception:
        logger.exception("Similarity search failed")
        return error_response("VECTORSTORE_ERROR", "Failed to retrieve relevant context.", 503, request_id=getattr(request.state, "request_id", None))

    system = SystemMessage(content=SYSTEM_PROMPT.format(context=context))
    user = HumanMessage(content=user_message)
    history_messages = await _get_recent_messages(str(payload.chat_id), MAX_HISTORY_MESSAGES)
    history_messages = _trim_history_by_chars(history_messages, MAX_HISTORY_CHARS)

    try:
        messages = [system, *history_messages, user]
        response_text = await _generate_response(messages)
    except HTTPException as exc:
        return error_response("LLM_ERROR", exc.detail, exc.status_code, request_id=getattr(request.state, "request_id", None))

    await safe_save_messages(str(payload.chat_id), user_message, response_text)
    return {"response": response_text}


@app.patch("/v1/chats/{chat_id}")
async def rename_chat(chat_id: UUID, payload: RenameChatRequest, token_data: TokenData = Depends(verify_token)):
    title = sanitize_text(payload.title, 80)
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty.")

    chat_res = await execute_supabase(
        lambda: supabase.table("chats").select("user_id, title").eq("id", str(chat_id)).single().execute()
    )
    chat_data = _extract_supabase_data(chat_res)
    if not chat_data:
        raise HTTPException(status_code=404, detail=ERROR_CHAT_NOT_FOUND)
    if chat_data.get("user_id") != token_data.sub:
        raise HTTPException(status_code=403, detail=ERROR_FORBIDDEN_CHAT)

    if payload.only_if_default and chat_data.get("title") != "New chat":
        return {"status": "skipped", "id": str(chat_id), "title": chat_data.get("title")}

    await execute_supabase(lambda: supabase.table("chats").update({"title": title}).eq("id", str(chat_id)).execute())
    _invalidate_chats_cache(token_data.sub)
    return {"status": "ok", "id": str(chat_id), "title": title}


@app.delete("/v1/chats/{chat_id}")
async def delete_chat(chat_id: UUID, token_data: TokenData = Depends(verify_token)):
    await _verify_chat_ownership(str(chat_id), token_data.sub)

    await execute_supabase(lambda: supabase.table("messages").delete().eq("chat_id", str(chat_id)).execute())
    await execute_supabase(lambda: supabase.table("chats").delete().eq("id", str(chat_id)).execute())
    _invalidate_chats_cache(token_data.sub)
    return {"status": "deleted", "id": str(chat_id)}


@app.patch("/v1/chats/{chat_id}/pin")
async def pin_chat(chat_id: UUID, payload: dict, token_data: TokenData = Depends(verify_token)):
    pinned = bool(payload.get("pinned"))
    await _verify_chat_ownership(str(chat_id), token_data.sub)

    try:
        await execute_supabase(
            lambda: supabase.table("chats").update({"pinned": pinned}).eq("id", str(chat_id)).execute()
        )
    except APIError as exc:
        if _is_missing_column_error(exc, "chats.pinned"):
            return error_response(
                "PIN_NOT_SUPPORTED",
                "Pinned chats are not enabled. Apply the latest database schema to add chats.pinned.",
                400,
            )
        raise
    _invalidate_chats_cache(token_data.sub)
    return {"status": "ok", "id": str(chat_id), "pinned": pinned}
