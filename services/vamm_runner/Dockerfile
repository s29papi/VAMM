FROM python:3.11-slim

RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies for the VAMM scripts
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Copy scripts and the runner code
COPY scripts ./scripts
COPY src ./src
COPY services/vamm_runner ./services/vamm_runner

# Python dependencies for the FastAPI server
RUN pip install --no-cache-dir -r services/vamm_runner/requirements.txt

ENV PORT=8080
ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "services.vamm_runner.main:app", "--host", "0.0.0.0", "--port", "8080"]
