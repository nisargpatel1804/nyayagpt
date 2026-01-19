# NyayaGPT

AI legal assistant for Indian law with retrieval-augmented generation.

## Project Structure
- backend/: FastAPI + LangChain + Chroma
- frontend/: Next.js app

## Requirements
- Python 3.10+
- Node.js 18+
- Supabase project
- Ollama running locally (or custom host)

## Setup

### Backend
1. Copy environment template:
   - backend/.env.example -> backend/.env
2. Install dependencies:
   - pip install -r backend/requirements.txt
3. Ingest documents:
   - python backend/ingest.py
4. Run server:
   - uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

### Frontend
1. Copy environment template:
   - frontend/.env.example -> frontend/.env
2. Install dependencies:
   - npm install
3. Run dev server:
   - npm run dev

## Notes
- The API is available at /v1/* (versioned endpoints).
- Use the health endpoint to verify dependencies.

## Docker
```bash
docker-compose up --build
```
