from __future__ import annotations

import asyncio
import hmac
import logging
import os
import secrets
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, File, Header, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.background import BackgroundTask

from .extractors import (
    MAX_DURATION_SECONDS,
    MAX_UPLOAD_BYTES,
    OUTPUT_AUDIO_FORMAT,
    ExtractionError,
    available_tools,
    close_browser_pool,
    extract_with_fallback,
    prepare_audio,
)
from .security import UnsafeUrl, assert_public_hostname, normalize_source_url


SERVICE_VERSION = "1.5.0"
DIAGNOSTIC_VERSION = 8
logging.basicConfig(level=os.environ.get("MIQDAR_LOG_LEVEL", "INFO").upper())
logger = logging.getLogger("miqdar.extractor")


class ExtractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=12, max_length=2_048)


MAX_CONCURRENT_EXTRACTIONS = max(1, min(4, int(os.environ.get("MIQDAR_MAX_CONCURRENCY", "2"))))
AUTH_TOKEN = os.environ.get("MIQDAR_EXTRACTOR_TOKEN", "")
semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXTRACTIONS)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await close_browser_pool()


app = FastAPI(
    title="Miqdar Extractor",
    version=SERVICE_VERSION,
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


def error_response(
    code: str,
    status: int,
    *,
    attempted_methods: tuple[str, ...] = (),
    last_failure: str | None = None,
    direct_failure: str | None = None,
    request_id: str | None = None,
    elapsed_ms: int | None = None,
) -> JSONResponse:
    payload: dict[str, object] = {
        "ok": False,
        "code": code,
        "serviceVersion": SERVICE_VERSION,
        "diagnosticVersion": DIAGNOSTIC_VERSION,
    }
    if attempted_methods:
        payload["attemptedMethods"] = list(attempted_methods)
    if last_failure:
        payload["lastFailure"] = last_failure
    if direct_failure:
        payload["directFailure"] = direct_failure
    if request_id:
        payload["requestId"] = request_id
    if elapsed_ms is not None:
        payload["elapsedMs"] = max(0, elapsed_ms)
    return JSONResponse(
        payload,
        status_code=status,
        headers={"cache-control": "no-store", "x-content-type-options": "nosniff"},
    )


def authorized(authorization: str | None) -> bool:
    if not AUTH_TOKEN or not authorization or not authorization.startswith("Bearer "):
        return False
    return hmac.compare_digest(authorization[7:], AUTH_TOKEN)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    content_length = request.headers.get("content-length")
    request_limit = MAX_UPLOAD_BYTES + 2 * 1024 * 1024 if request.url.path == "/v1/prepare-upload" else 8_192
    if content_length and content_length.isdigit() and int(content_length) > request_limit:
        return error_response("request_too_large", 413)
    response = await call_next(request)
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["referrer-policy"] = "no-referrer"
    return response


@app.get("/health")
async def health() -> dict[str, object]:
    tools = available_tools()
    return {
        "ok": True,
        "serviceVersion": SERVICE_VERSION,
        "diagnosticVersion": DIAGNOSTIC_VERSION,
        "capabilities": {
            "ytDlp": True,
            "chromiumFallback": True,
            "browserSessionDownload": True,
            "chromiumFirstForTikTok": True,
            "observedResponseReuse": True,
            "multiCandidateFallback": True,
            "mediaPayloadValidation": True,
            "tiktokHydrationAudio": True,
            "tiktokSsrFirst": True,
            "tiktokLoginAssetRejection": True,
            "streamingMediaDownload": True,
            "persistentChromium": True,
            "extractionTrace": True,
            "stageTimings": True,
            "losslessRemux": True,
        },
        "configured": bool(AUTH_TOKEN) and all(tools.values()),
        "tools": tools,
        "maxConcurrency": MAX_CONCURRENT_EXTRACTIONS,
        "maxUploadBytes": MAX_UPLOAD_BYTES,
        "maxDurationSeconds": MAX_DURATION_SECONDS,
        "audioFormat": OUTPUT_AUDIO_FORMAT,
    }


@app.post("/v1/extract")
async def extract_public_media(
    payload: ExtractionRequest,
    authorization: str | None = Header(default=None),
):
    request_id = secrets.token_hex(6)
    if not authorized(authorization):
        return error_response("unauthorized", 401, request_id=request_id)

    try:
        normalized_url = normalize_source_url(payload.url)
        hostname = urlsplit(normalized_url).hostname or ""
        await asyncio.to_thread(assert_public_hostname, hostname)
    except UnsafeUrl as error:
        return error_response(str(error), 422, request_id=request_id)

    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=0.05)
    except TimeoutError:
        return error_response("extractor_busy", 429, request_id=request_id)

    workdir = Path(tempfile.mkdtemp(prefix="miqdar-"))
    extraction_started = time.perf_counter()
    logger.info("request_id=%s extraction=started host=%s", request_id, hostname)
    try:
        extracted = await extract_with_fallback(normalized_url, workdir, request_id=request_id)
        extraction_ms = round((time.perf_counter() - extraction_started) * 1_000)
        logger.info("request_id=%s extraction=succeeded method=%s duration_ms=%s", request_id, extracted.method, extraction_ms)
        cleanup = BackgroundTask(shutil.rmtree, workdir, ignore_errors=True)
        return FileResponse(
            extracted.path,
            media_type=extracted.media_type,
            filename=extracted.path.name,
            background=cleanup,
            headers={
                "cache-control": "no-store",
                "x-miqdar-extraction-method": extracted.method,
                "x-miqdar-source-host": hostname,
                "x-miqdar-extractor-version": SERVICE_VERSION,
                "x-miqdar-request-id": request_id,
                "x-miqdar-extraction-ms": str(extraction_ms),
                "x-miqdar-source-ms": str(extracted.timings_ms.get("source", 0)),
                "x-miqdar-preparation-ms": str(extracted.timings_ms.get("preparation", 0)),
                "x-miqdar-preparation-mode": extracted.preparation_mode,
            },
        )
    except ExtractionError as error:
        logger.warning(
            "request_id=%s extraction=failed attempts=%s direct_failure=%s last_failure=%s duration_ms=%s",
            request_id,
            ",".join(error.attempted_methods) or "none",
            error.direct_failure or "-",
            error.last_failure or error.code,
            round((time.perf_counter() - extraction_started) * 1_000),
        )
        shutil.rmtree(workdir, ignore_errors=True)
        return error_response(
            error.code,
            error.status,
            attempted_methods=error.attempted_methods,
            last_failure=error.last_failure,
            direct_failure=error.direct_failure,
            request_id=request_id,
            elapsed_ms=round((time.perf_counter() - extraction_started) * 1_000),
        )
    except Exception:
        logger.exception("request_id=%s extraction=crashed", request_id)
        shutil.rmtree(workdir, ignore_errors=True)
        return error_response(
            "extractor_failure",
            500,
            request_id=request_id,
            elapsed_ms=round((time.perf_counter() - extraction_started) * 1_000),
        )
    finally:
        semaphore.release()

@app.post("/v1/prepare-upload")
async def prepare_uploaded_media(
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    if not authorized(authorization):
        return error_response("unauthorized", 401)

    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=0.05)
    except TimeoutError:
        return error_response("extractor_busy", 429)

    workdir = Path(tempfile.mkdtemp(prefix="miqdar-upload-"))
    source_suffix = Path(file.filename or "").suffix.lower()
    if source_suffix not in {".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".aac", ".mov", ".m4v"}:
        source_suffix = ""
    source = workdir / f"source-upload{source_suffix}"
    preparation_started = time.perf_counter()
    try:
        total = 0
        with source.open("wb") as target:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise ExtractionError("media_too_large", status=413)
                target.write(chunk)
        await file.close()
        if total <= 0:
            raise ExtractionError("empty_media", status=400)

        prepared = await prepare_audio(str(source), workdir, source_content_type=file.content_type)
        preparation_ms = round((time.perf_counter() - preparation_started) * 1_000)
        cleanup = BackgroundTask(shutil.rmtree, workdir, ignore_errors=True)
        return FileResponse(
            prepared.path,
            media_type=prepared.media_type,
            filename=prepared.path.name,
            background=cleanup,
            headers={
                "cache-control": "no-store",
                "x-miqdar-extraction-method": "upload-audio-preparation",
                "x-miqdar-preparation-mode": prepared.mode,
                "x-miqdar-preparation-ms": str(preparation_ms),
            },
        )
    except ExtractionError as error:
        shutil.rmtree(workdir, ignore_errors=True)
        return error_response(error.code, error.status)
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        return error_response("extractor_failure", 500)
    finally:
        await file.close()
        semaphore.release()
