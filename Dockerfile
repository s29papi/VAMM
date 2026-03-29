FROM python:3.11-slim
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm --prefix interfaces/frontend install
RUN python -m venv .venv
RUN .venv/bin/python -m pip install --upgrade pip && .venv/bin/pip install -r requirements.txt
RUN .venv/bin/python -m pip install -r external/hermes-agent/requirements.txt
ENV API_SERVER_ENABLED=true
ENV API_SERVER_PORT=8080
ENV API_SERVER_HOST=0.0.0.0
ENV PATH="/app/.venv/bin:$PATH"
CMD ["./.venv/bin/python", "external/hermes-agent/gateway/run.py"]
