NyayaGPT

A specialized AI legal assistant for Indian Law, built with a secure RAG (Retrieval-Augmented Generation) pipeline. It provides accurate legal information, case law summaries, and drafting assistance by grounding answers in the Bharatiya Nyaya Sanhita (BNS), IPC, CrPC, and Constitution.

🚀 Key Features

Core Capabilities

RAG-Powered Chat: Retrieves context from ingested PDFs (IPC, BNS, Constitution) to minimize hallucinations.

Streaming Responses: Real-time token generation for a responsive "typewriter" experience.

Citation & Grounding: Answers are strictly based on the provided legal context.

Specialized Legal Modes

Standard Mode:

Statute Comparator: Automatically detects old IPC sections (e.g., Sec 302) and maps them to new BNS laws (Sec 103).

Smart Query Expansion: Expands layperson queries (e.g., "wife harassment") into legal terminology before searching.

State Amendment Filter: Prioritizes state-specific rules (e.g., Maharashtra, UP) if a jurisdiction is selected.

Timeline Generator:

Extracts dates and events from unstructured client stories and renders them as a chronological table.

Devil's Advocate:

Acts as opposing counsel to critique your legal arguments and find loopholes.

Enterprise-Grade Security

Role-Based Access: Row Level Security (RLS) via Supabase ensures users only see their own data.

Rate Limiting: Protects against abuse (User & IP based).

Data Loss Prevention: Fail-safe architecture ensures AI responses are delivered even if database logging fails temporarily.

🛠️ Tech Stack

Backend

Framework: FastAPI (Python 3.10+)

LLM Engine: Ollama (Llama 3.2)

Vector Database: ChromaDB

Embeddings: HuggingFace (sentence-transformers/all-MiniLM-L6-v2)

Re-Ranking: CrossEncoder (ms-marco-MiniLM-L-6-v2)

Database: Supabase (PostgreSQL + Auth)

Frontend

Framework: Next.js 14 (App Router)

Styling: Tailwind CSS + Lucide Icons

Streaming: NDJSON (Newline Delimited JSON)

⚡ Local Setup Guide

Prerequisites

Python 3.10+ and Node.js 18+ installed.

Ollama installed and running locally (ollama serve).

Pull the model: ollama pull llama3.2:3b

Supabase Project created.

Run the SQL in backend/db/schema.sql in your Supabase SQL Editor.

1. Backend Setup

cd backend

# Create virtual environment
python -m venv .venv
# Activate: 
# Windows: .venv\Scripts\activate
# Mac/Linux: source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure Environment
cp .env.example .env
# Edit .env and add your SUPABASE_URL, SERVICE_ROLE_KEY, and JWT_SECRET

# Ingest Legal Documents
# Place your PDFs in backend/data/indian_laws/
python ingest.py

# Start API Server
uvicorn main:app --reload --host 0.0.0.0 --port 8000


2. Frontend Setup

cd frontend

# Install dependencies
npm install

# Configure Environment
cp .env.example .env.local
# Edit .env.local and add NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, and API_URL

# Start Dev Server
npm run dev


Visit http://localhost:3000 to access the application.

🛡️ Security Best Practices

Environment Variables: Never commit .env files.

CORS: In backend/.env, set FRONTEND_ORIGINS to your specific frontend domain in production (e.g., https://nyayagpt.com). Do not use *.

Supabase Keys: Use the Service Role Key only in the Backend. Use the Anon Key in the Frontend.

📄 License

This project is for educational and portfolio purposes. Legal advice should always be verified by a qualified professional.