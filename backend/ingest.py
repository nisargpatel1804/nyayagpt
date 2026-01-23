import os
os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
try:
    import posthog
    posthog.disabled = True
    def _posthog_noop(*args, **kwargs): return None
    posthog.capture = _posthog_noop
except Exception: pass

from pathlib import Path
from datetime import datetime, timezone
import json
import hashlib
import re

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

DATA_DIR = Path("./data/indian_laws")
PERSIST_DIR = Path("./chroma_db")
CHROMA_COLLECTION_NAME = os.getenv("CHROMA_COLLECTION_NAME", "nyayagpt")
INGEST_FORCE = os.getenv("INGEST_FORCE", "false").lower() == "true"

def detect_metadata(text: str, filename: str) -> dict:
    """
    Heuristics to tag documents for State Filters.
    Identifies if a document belongs to a specific state jurisdiction based on content or filename.
    """
    meta = {"state": "Central"}
    
    text_lower = text.lower()
    filename_lower = filename.lower()
    
    # Simple keyword detection for major states
    if "maharashtra" in filename_lower or "maharashtra" in text_lower[:500]:
        meta["state"] = "Maharashtra"
    elif "uttar pradesh" in filename_lower or " u.p. " in text_lower[:500]:
        meta["state"] = "Uttar Pradesh"
    elif "karnataka" in filename_lower:
        meta["state"] = "Karnataka"
        
    return meta

def load_documents(data_dir: Path):
    documents = []
    manifest = []
    for path in data_dir.rglob("*"):
        if path.is_dir(): continue
        try:
            if path.suffix.lower() == ".pdf":
                loader = PyPDFLoader(str(path))
                raw_docs = loader.load()
            elif path.suffix.lower() in {".txt", ".md"}:
                loader = TextLoader(str(path), encoding="utf-8")
                raw_docs = loader.load()
            else: continue

            # Enrich documents with metadata
            for doc in raw_docs:
                custom_meta = detect_metadata(doc.page_content, path.name)
                doc.metadata.update(custom_meta)
                doc.metadata["source"] = path.name

            documents.extend(raw_docs)
            manifest.append(path)
        except Exception as e:
            print(f"Error loading {path}: {e}")
            
    return documents, manifest

def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""): h.update(chunk)
    return h.hexdigest()

def _load_manifest(path: Path) -> dict | None:
    try: return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    except: return None

def main():
    if not DATA_DIR.exists(): raise SystemExit(f"Data directory not found: {DATA_DIR}")

    docs, files = load_documents(DATA_DIR)
    if not docs: raise SystemExit("No documents found.")

    manifest_path = PERSIST_DIR / "ingest_manifest.json"
    current_manifest = {"documents": [{"path": str(p), "sha256": file_sha256(p)} for p in files]}
    existing = _load_manifest(manifest_path)
    
    # Check if files changed to avoid re-ingesting unnecessarily
    if existing and existing.get("documents") == current_manifest.get("documents") and not INGEST_FORCE:
        print("No changes. Skipping ingest.")
        return

    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = splitter.split_documents(docs)

    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2", model_kwargs={"device": "cpu"})
    
    vectordb = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=str(PERSIST_DIR),
        collection_name=CHROMA_COLLECTION_NAME,
    )
    
    try: vectordb.persist() 
    except: pass

    print(f"Ingested {len(chunks)} chunks.")
    
    manifest = {
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "documents": current_manifest["documents"],
        "chunks": len(chunks),
        "collection": CHROMA_COLLECTION_NAME,
    }
    PERSIST_DIR.mkdir(parents=True, exist_ok=True)
    (PERSIST_DIR / "ingest_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()