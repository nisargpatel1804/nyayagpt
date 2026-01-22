import os
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
from pathlib import Path
from datetime import datetime, timezone
import json
import hashlib

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

DATA_DIR = Path("./data/indian_laws")
PERSIST_DIR = Path("./chroma_db")
CHROMA_COLLECTION_NAME = os.getenv("CHROMA_COLLECTION_NAME", "nyayagpt")
INGEST_FORCE = os.getenv("INGEST_FORCE", "false").lower() == "true"


def load_documents(data_dir: Path):
    documents = []
    manifest = []
    for path in data_dir.rglob("*"):
        if path.is_dir():
            continue
        if path.suffix.lower() == ".pdf":
            loader = PyPDFLoader(str(path))
            documents.extend(loader.load())
            manifest.append(path)
        elif path.suffix.lower() in {".txt", ".md"}:
            loader = TextLoader(str(path), encoding="utf-8")
            documents.extend(loader.load())
            manifest.append(path)
    return documents, manifest


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_manifest(path: Path) -> dict | None:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return None


def main():
    if not DATA_DIR.exists():
        raise SystemExit(f"Data directory not found: {DATA_DIR}")

    docs, files = load_documents(DATA_DIR)
    if not docs:
        raise SystemExit("No documents found to ingest.")

    manifest_path = PERSIST_DIR / "ingest_manifest.json"
    current_manifest = {
        "documents": [
            {"path": str(p), "sha256": file_sha256(p)}
            for p in files
        ]
    }
    existing_manifest = _load_manifest(manifest_path)
    if existing_manifest and existing_manifest.get("documents") == current_manifest.get("documents") and not INGEST_FORCE:
        print("No document changes detected. Skipping ingest. Set INGEST_FORCE=true to override.")
        return

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        separators=["\n\n", "\n", " ", ""],
    )
    chunks = splitter.split_documents(docs)

    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2",
        model_kwargs={"device": "cpu"},
    )

    vectordb = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=str(PERSIST_DIR),
        collection_name=CHROMA_COLLECTION_NAME,
    )

    try:
        vectordb.persist()
    except Exception:
        pass

    print(f"Ingested {len(chunks)} chunks into {PERSIST_DIR}")

    manifest = {
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "documents": current_manifest["documents"],
        "chunks": len(chunks),
        "collection": CHROMA_COLLECTION_NAME,
    }
    try:
        PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        (PERSIST_DIR / "ingest_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    except Exception:
        pass


if __name__ == "__main__":
    main()
