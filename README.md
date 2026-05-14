Terminal 1 — Backend:

cd thesis-app/backend

uv venv --python 3.12

.venv/Scripts/activate

uv pip install --index-url https://download.pytorch.org/whl/cu126 torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0

uv pip install -r requirements.txt

get tanl-scierc_all-backbone/ and cdcr_ckpts.pt

cd thesis-app/frontend
npm install      # installs React, vis-network, etc.
npm run dev 


# Terminal 1 (backend)
cd backend;
uvicorn main:app --reload --port 8000

# Terminal 2 (frontend) — after npm install is done
cd frontend;
npm run dev