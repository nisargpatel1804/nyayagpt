# NyayaGPT

AI legal assistant for Indian law with retrieval-augmented generation (RAG).

## Project Structure
- backend/: FastAPI + LangChain + Chroma + Supabase
- frontend/: Next.js app

## Requirements
- Python 3.10+
- Node.js 18+
- Supabase project (Auth + Postgres)
- Ollama running locally (or a custom host URL)

## Local Setup (No Docker)

### Backend
1. Copy environment template:
   - backend/.env.example -> backend/.env
2. Set required variables in backend/.env:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - SUPABASE_JWT_SECRET
3. Install dependencies:
   - pip install -r backend/requirements.txt
4. Ingest documents:
   - python backend/ingest.py
5. Run the API:
   - uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

### Frontend
1. Copy environment template:
   - frontend/.env.example -> frontend/.env
2. Set required variables in frontend/.env:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - NEXT_PUBLIC_API_URL (e.g., http://localhost:8000)
3. Install dependencies:
   - npm install
4. Run the dev server:
   - npm run dev

## Notes
- API base path: /v1/*
- Health check: /v1/health
- The ingest step uses documents from backend/data/indian_laws.
- This repository is configured for local development and resume showcase only (no production deployment).

## Security
- Never commit .env files.
- Rotate any exposed keys before publishing.
