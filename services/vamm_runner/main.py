"""Lean VAMM runner API that executes the maker/settlement scripts via Node."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("vamm_runner")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="VAMM Runner")

def _parse_cors_origins(value: str) -> list[str]:
    if not value:
        return []
    return [origin.strip() for origin in value.split(",") if origin.strip()]


cors_origins = _parse_cors_origins(os.getenv("API_SERVER_CORS_ORIGINS", ""))
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

VAMM_PROJECT_ROOT = Path(os.getenv("VAMM_PROJECT_ROOT", "/app")).resolve()
EXECUTE_SCRIPT = Path(os.getenv("VAMM_EXECUTE_SCRIPT", "scripts/execute-requester-order.mjs"))
REVERSE_SCRIPT = Path(os.getenv("VAMM_REVERSE_PREP_SCRIPT", "scripts/prepare-vamm-reverse-requester.mjs"))
API_KEY = os.getenv("VAMM_API_KEY", "").strip()


def _require_auth(request: Request) -> None:
    if not API_KEY:
        return

    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = header.split(" ", 1)[1]
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid bearer token")


def _cors_headers_for_origin(origin: str) -> Dict[str, str]:
    if not origin or not cors_origins:
        return {}
    if "*" in cors_origins:
        return {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Allow-Credentials": "true",
        }
    if origin not in cors_origins:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


def _cors_preflight_response(request: Request) -> JSONResponse:
    headers = _cors_headers_for_origin(request.headers.get("origin", ""))
    return JSONResponse(content={"status": "ok"}, headers=headers)


def _extract_json_object(raw: str) -> Optional[Dict[str, Any]]:
    text = raw.strip()
    if not text:
        return None

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    while start != -1:
        candidate = text[start:]
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
    return None


def _make_command(script_path: Path) -> str:
    rel_path = script_path.relative_to(VAMM_PROJECT_ROOT)
    return (
        "set -a\n"
        "[ -f .env ] && source ./.env\n"
        "set +a\n"
        f"exec node {rel_path} --payload-json \"$PAYLOAD_JSON\""
    )


async def _run_vamm_script(
    script: Path,
    payload: Dict[str, Any],
    mode: str,
    extra_env: Optional[Dict[str, str]] = None,
) -> JSONResponse:
    script_path = script if script.is_absolute() else VAMM_PROJECT_ROOT / script
    if not script_path.exists():
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "mode": mode,
                "script": str(script_path),
                "error": "VAMM script not found",
            },
        )

    env = os.environ.copy()
    env["PAYLOAD_JSON"] = json.dumps(payload, separators=(",", ":"))
    if extra_env:
        env.update(extra_env)

    command = _make_command(script_path)
    request_id = f"vamm-{uuid.uuid4().hex[:10]}"
    logger.info("[%s] running %s script=%s payload=%s", request_id, mode, script_path, payload.get("order_id"))

    try:
        process = await asyncio.create_subprocess_exec(
            "bash",
            "-c",
            command,
            cwd=str(VAMM_PROJECT_ROOT),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except Exception as exc:  # pragma: no cover
        logger.error("[%s] failed to start script=%s: %s", request_id, script_path, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to launch {mode} script: {exc}")

    stdout, stderr = await process.communicate()
    stdout_text = stdout.decode("utf-8", errors="replace").strip()
    stderr_text = stderr.decode("utf-8", errors="replace").strip()

    logger.info(
        "[%s] %s exit=%s stdout=%s stderr=%s",
        request_id,
        mode,
        process.returncode,
        stdout_text[:200],
        stderr_text[:200],
    )

    if process.returncode != 0:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "mode": mode,
                "script": str(script_path),
                "exitCode": process.returncode,
                "error": stderr_text or stdout_text or f"{mode} script failed",
            },
        )

    result = _extract_json_object(stdout_text)
    if result is None:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "mode": mode,
                "script": str(script_path),
                "error": "VAMM script returned non-JSON output",
                "stdout": stdout_text,
                "stderr": stderr_text,
            },
        )

    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "mode": mode,
            "script": str(script_path),
            "result": result,
            "stderr": stderr_text or None,
        },
    )


async def _get_payload(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON")

    payload = body.get("payload") if isinstance(body, dict) and isinstance(body.get("payload"), dict) else body
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Missing or invalid payload object")

    return payload


@app.get("/")
async def root() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "vamm-runner"})


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "vamm-runner"})


@app.post("/execute-order")
@app.post("/api/vamm/execute-order")
async def execute_order(request: Request) -> JSONResponse:
    _require_auth(request)
    payload = await _get_payload(request)
    return await _run_vamm_script(
        EXECUTE_SCRIPT,
        payload,
        mode="requester_as_maker",
        extra_env={"ALEOVEIL_USE_REQUESTER_AS_MAKER": "true"},
    )


@app.options("/execute-order")
@app.options("/api/vamm/execute-order")
async def execute_order_preflight(request: Request) -> JSONResponse:
    return _cors_preflight_response(request)


@app.post("/reverse-requester-prep")
@app.post("/api/vamm/reverse-requester-prep")
async def reverse_requester_prep(request: Request) -> JSONResponse:
    _require_auth(request)
    payload = await _get_payload(request)
    return await _run_vamm_script(
        REVERSE_SCRIPT,
        payload,
        mode="reverse_requester_prep",
    )


@app.options("/reverse-requester-prep")
@app.options("/api/vamm/reverse-requester-prep")
async def reverse_requester_prep_preflight(request: Request) -> JSONResponse:
    return _cors_preflight_response(request)
