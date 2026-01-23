import os
import asyncio
import warnings
import logging
import time
import re
import json
from datetime import datetime, timezone, timedelta
from typing import Deque, Optional, Callable, Any
from uuid import UUID, uuid4
from collections import deque
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, constr
from jose import jwt, JWTError
from supabase import create_client, Client
from dotenv import load_dotenv

# --- INITIAL SETUP & ENV ---
os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
try:
    import posthog
    posthog.disabled = True
    def _posthog_noop(*args, **kwargs): return None
    posthog.capture = _posthog_noop
except Exception: pass

warnings.filterwarnings("ignore", category=DeprecationWarning, module="langchain")

from langchain_community.chat_models import ChatOllama
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from sentence_transformers import CrossEncoder

load_dotenv()

def _require_env(name: str, min_length: int = 1) -> str:
    value = os.getenv(name)
    if not value or len(value.strip()) < min_length:
        raise RuntimeError(f"Missing or invalid environment variable: {name}")
    return value

SUPABASE_URL = _require_env("SUPABASE_URL", 10)
SUPABASE_SERVICE_ROLE_KEY = _require_env("SUPABASE_SERVICE_ROLE_KEY", 20)
SUPABASE_JWT_SECRET = _require_env("SUPABASE_JWT_SECRET", 32)
CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_db")
CHROMA_COLLECTION_NAME = os.getenv("CHROMA_COLLECTION_NAME", "nyayagpt")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

# --- CLIENTS ---
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2", model_kwargs={"device": "cpu"})

# Re-ranker (Cross Encoder) - Falls back gracefully if model download fails
try:
    reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu")
except Exception:
    reranker = None
    print("Warning: CrossEncoder failed to load. Re-ranking disabled.")

vectorstore = Chroma(persist_directory=CHROMA_DIR, embedding_function=embeddings, collection_name=CHROMA_COLLECTION_NAME)
llm = ChatOllama(model=OLLAMA_MODEL, temperature=0.1, base_url=OLLAMA_BASE_URL)

# Load IPC->BNS Map
IPC_TO_BNS_MAP = {}
try:
    map_path = Path("./data/ipc_to_bns.json")
    if map_path.exists():
        IPC_TO_BNS_MAP = json.loads(map_path.read_text(encoding="utf-8"))
except Exception: pass

# --- LOGGING ---
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger("nyayagpt")

# --- PROMPTS ---
SYSTEM_PROMPT = (
    "You are a specialized Indian Legal AI Assistant. "
    "Answer strictly based on the Context below. "
    "If unknown, state you do not have the info. "
    "Do not fabricate laws. Context: {context}"
)

DEVIL_ADVOCATE_PROMPT = (
    "You are a senior opposing counsel (Prosecutor or Defense depending on context). "
    "Your goal is to AGGRESSIVELY dismantle the user's argument. "
    "1. Find legal loopholes in their statement. "
    "2. Demand specific evidence (dates, medical reports, eyewitnesses). "
    "3. Cite potential counter-arguments or conflicting rulings. "
    "4. Do not be helpful. Be critical and skeptical. "
    "Context: {context}"
)

TIMELINE_SYSTEM_PROMPT = (
    "You are a specialized Legal Paralegal AI. "
    "Your task is to extract all dates and significant legal events from the user's text. "
    "You must output the result strictly as a valid JSON array of objects. "
    "Each object must have exactly two keys: 'Date' (string) and 'Event' (string). "
    "Sort the events chronologically. "
    "Do not add any markdown formatting. Just the JSON array."
)

ERROR_CHAT_NOT_FOUND = "Chat not found."
ERROR_FORBIDDEN_CHAT = "Forbidden: chat does not belong to the authenticated user."

# --- DATA MODELS ---
class ChatRequest(BaseModel):
    message: constr(min_length=1, max_length=2000)
    chat_id: str
    mode: Optional[str] = "standard"  # standard, timeline, devils_advocate
    jurisdiction: Optional[str] = "All India"

class TokenData(BaseModel):
    sub: str

class CreateChatRequest(BaseModel):
    title: Optional[constr(min_length=1, max_length=80)] = None

# --- UTILS ---
def verify_token(authorization: str = Header(...)) -> TokenData:
    if not authorization.startswith("Bearer "): raise HTTPException(401, "Invalid Auth")
    try:
        token = authorization.split(" ", 1)[1]
        payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False})
        return TokenData(sub=payload.get("sub"))
    except:
        try:
            user = supabase.auth.get_user(token.split(" ", 1)[1] if " " in token else token).user
            if user: return TokenData(sub=user.id)
        except: pass
        raise HTTPException(401, "Invalid Token")

def _get_client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd: return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

_rate_limit = {}
def enforce_rate_limit(uid: str, ip: str):
    now = time.monotonic()
    k = f"{uid}:{ip}"
    dq = _rate_limit.setdefault(k, deque())
    while dq and now - dq[0] > 60: dq.popleft()
    if len(dq) >= 30: raise HTTPException(429, "Rate limit exceeded")
    dq.append(now)
    if len(_rate_limit) > 5000: _rate_limit.clear()

async def safe_save_messages(chat_id: str, user_msg: str, ai_msg: str):
    try:
        await asyncio.to_thread(lambda: supabase.table("messages").insert([
            {"chat_id": chat_id, "role": "user", "content": user_msg},
            {"chat_id": chat_id, "role": "assistant", "content": ai_msg}
        ]).execute())
        return True
    except: return False

async def log_audit_event(user_id: str, action: str, target_id: str = None):
    try: await asyncio.to_thread(lambda: supabase.table("audit_logs").insert({"user_id": user_id, "action": action, "target_id": target_id}).execute())
    except: pass

def _extract_supabase_data(res: Any) -> Any:
    return res.data if hasattr(res, "data") else (res.get("data") if isinstance(res, dict) else None)

def _detect_and_map_statutes(text: str) -> tuple[str, str | None]:
    pattern = r"(?:Section|Sec|S\.)\s*(\d+[A-Za-z]*)\s*(?:of\s+the\s+)?(?:IPC|Indian Penal Code)"
    matches = re.findall(pattern, text, re.IGNORECASE)
    injections, footers = [], []
    seen = set()
    for sec in matches:
        s = sec.upper()
        if s in IPC_TO_BNS_MAP and s not in seen:
            m = IPC_TO_BNS_MAP[s]
            injections.append(f"- Sec {s} IPC -> Sec {m['bns']} BNS ({m['description']})")
            footers.append(f"**Update:** Sec {s} IPC is now Sec {m['bns']} BNS.")
            seen.add(s)
    
    sys_note = ("\n[LAW UPDATE - IPC to BNS Mapping]:\n" + "\n".join(injections)) if injections else ""
    footer = ("\n\n" + "\n".join(footers)) if footers else None
    return sys_note, footer

def _rerank_documents(query: str, docs: list[Any], top_k: int = 3) -> list[Any]:
    if not reranker or not docs: return docs[:top_k]
    try:
        # Cross-Encoder expects pairs: [query, doc_text]
        scores = reranker.predict([[query, d.page_content] for d in docs])
        # Sort by score descending
        sorted_docs = sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)
        return [d for d, s in sorted_docs][:top_k]
    except: return docs[:top_k]

# --- APP ---
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID") or str(uuid4())
    if request.method in ("POST", "PUT", "PATCH"):
        body = await request.body()
        if len(body) > 120_000: return JSONResponse({"error": "Payload too large"}, 413)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response

# --- ENDPOINTS ---

@app.get("/v1/chats")
async def list_chats(token: TokenData = Depends(verify_token), limit: int = 50):
    res = await asyncio.to_thread(lambda: supabase.table("chats").select("id,title,created_at").eq("user_id", token.sub).is_("deleted_at", "null").order("created_at", desc=True).limit(limit).execute())
    return {"chats": _extract_supabase_data(res) or []}

@app.post("/v1/chats")
async def create_chat(request: Request, payload: CreateChatRequest, token: TokenData = Depends(verify_token)):
    enforce_rate_limit(token.sub, _get_client_ip(request))
    title = (payload.title or "New chat")[:80]
    
    # Deduplication logic (Ghost Chat Prevention)
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    recent = await asyncio.to_thread(lambda: supabase.table("chats").select("id,title,created_at").eq("user_id", token.sub).eq("title", "New chat").is_("deleted_at", "null").gte("created_at", cutoff).order("created_at", desc=True).limit(5).execute())
    
    recent_chats = _extract_supabase_data(recent) or []
    for chat in recent_chats:
        # Check if empty
        msgs = await asyncio.to_thread(lambda: supabase.table("messages").select("id").eq("chat_id", chat["id"]).limit(1).execute())
        if not _extract_supabase_data(msgs): return {"chat": chat}

    cid = str(uuid4())
    res = await asyncio.to_thread(lambda: supabase.table("chats").insert({"id": cid, "user_id": token.sub, "title": title}).execute())
    data = _extract_supabase_data(res)
    chat_obj = data[0] if isinstance(data, list) and data else {"id": cid, "title": title}
    await log_audit_event(token.sub, "chat.create", cid)
    return {"chat": chat_obj}

@app.get("/v1/chats/{chat_id}/messages")
async def get_messages(chat_id: str, token: TokenData = Depends(verify_token), limit: int = 50):
    # Ownership check
    cres = await asyncio.to_thread(lambda: supabase.table("chats").select("user_id").eq("id", chat_id).single().execute())
    cdata = _extract_supabase_data(cres)
    if not cdata or cdata["user_id"] != token.sub: raise HTTPException(404, ERROR_CHAT_NOT_FOUND)
    
    res = await asyncio.to_thread(lambda: supabase.table("messages").select("*").eq("chat_id", chat_id).is_("deleted_at", "null").order("created_at", desc=True).limit(limit).execute())
    return {"messages": _extract_supabase_data(res) or []}

@app.delete("/v1/chats/{chat_id}")
async def delete_chat(chat_id: str, token: TokenData = Depends(verify_token)):
    enforce_rate_limit(token.sub, "unknown")
    t = datetime.now(timezone.utc).isoformat()
    await asyncio.to_thread(lambda: supabase.table("chats").update({"deleted_at": t}).eq("id", chat_id).eq("user_id", token.sub).execute())
    return {"status": "deleted"}

@app.post("/v1/chat")
async def chat(payload: ChatRequest, request: Request, token: TokenData = Depends(verify_token)):
    enforce_rate_limit(token.sub, _get_client_ip(request))
    chat_id = payload.chat_id
    user_msg = payload.message.strip()
    mode = payload.mode
    jurisdiction = payload.jurisdiction

    # Verify Ownership
    cres = await asyncio.to_thread(lambda: supabase.table("chats").select("user_id").eq("id", chat_id).single().execute())
    cdata = _extract_supabase_data(cres)
    if not cdata or cdata["user_id"] != token.sub: raise HTTPException(403, ERROR_FORBIDDEN_CHAT)

    # 1. TIMELINE MODE
    if mode == "timeline":
        async def timeline_gen():
            try:
                sys = SystemMessage(content=TIMELINE_SYSTEM_PROMPT)
                usr = HumanMessage(content=user_msg)
                full = ""
                async for chunk in llm.astream([sys, usr]):
                    if chunk.content:
                        full += chunk.content
                        yield json.dumps({"type": "token", "content": chunk.content}) + "\n"
                
                saved = await safe_save_messages(chat_id, user_msg, full)
                end = {"type": "end", "saved": saved}
                if not saved: end["warning"] = "HISTORY_SAVE_FAILED"
                yield json.dumps(end) + "\n"
            except Exception:
                yield json.dumps({"type": "error", "content": "Generation Failed"}) + "\n"

        return StreamingResponse(timeline_gen(), media_type="application/x-ndjson")

    # 2. STANDARD & DEVIL'S ADVOCATE
    
    # A. Search Config
    filter_dict = {}
    if jurisdiction and jurisdiction != "All India":
        filter_dict["state"] = jurisdiction

    search_kwargs = {"k": 10} # Fetch more for re-ranking
    if filter_dict: search_kwargs["filter"] = filter_dict

    async def response_gen():
        context = ""
        try:
            # Retrieval
            docs = await asyncio.to_thread(lambda: vectorstore.similarity_search(user_msg, **search_kwargs))
            
            # Re-Ranking (Top 10 -> Top 4)
            top_docs = _rerank_documents(user_msg, docs, top_k=4)
            context = "\n\n".join([d.page_content for d in top_docs])
        except Exception as e:
            logger.error(f"Retrieval error: {e}")
            yield json.dumps({"type": "error", "content": "Context retrieval failed."}) + "\n"

        # B. Prompt Construction
        statute_note, footer = _detect_and_map_statutes(user_msg)
        
        base_prompt = SYSTEM_PROMPT
        if mode == "devils_advocate":
            base_prompt = DEVIL_ADVOCATE_PROMPT

        final_system = base_prompt.format(context=context or "No context available.")
        
        if jurisdiction and jurisdiction != "All India":
            final_system += f"\n[JURISDICTION ALERT]: Prioritize {jurisdiction} State Amendments over Central Acts."
        
        if statute_note: final_system += statute_note

        # C. History
        history = []
        try:
            hres = await asyncio.to_thread(lambda: supabase.table("messages").select("role,content").eq("chat_id", chat_id).is_("deleted_at", "null").order("created_at", desc=True).limit(8).execute())
            for r in reversed(_extract_supabase_data(hres) or []):
                history.append(HumanMessage(content=r["content"]) if r["role"] == "user" else AIMessage(content=r["content"]))
        except: pass

        # D. Generation Loop
        full_resp = ""
        try:
            async for chunk in llm.astream([SystemMessage(content=final_system), *history, HumanMessage(content=user_msg)]):
                if chunk.content:
                    full_resp += chunk.content
                    yield json.dumps({"type": "token", "content": chunk.content}) + "\n"
            
            if footer:
                full_resp += footer
                yield json.dumps({"type": "token", "content": footer}) + "\n"

            saved = await safe_save_messages(chat_id, user_msg, full_resp)
            end_pkt = {"type": "end", "saved": saved}
            if not saved: end_pkt["warning"] = "HISTORY_SAVE_FAILED"
            yield json.dumps(end_pkt) + "\n"
            await log_audit_event(token.sub, "message.create", chat_id)

        except Exception as e:
            logger.error(f"LLM Error: {e}")
            yield json.dumps({"type": "error", "content": "LLM Generation Failed."}) + "\n"

    return StreamingResponse(response_gen(), media_type="application/x-ndjson")