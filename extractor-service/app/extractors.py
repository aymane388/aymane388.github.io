from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .security import UnsafeUrl, assert_public_hostname, normalize_public_media_url, normalize_source_url


MAX_SOURCE_BYTES = 96 * 1024 * 1024
MAX_UPLOAD_BYTES = 80 * 1024 * 1024
MAX_AUDIO_BYTES = 24 * 1024 * 1024
MAX_DURATION_SECONDS = 3 * 60
OUTPUT_SAMPLE_RATE = 24_000
OUTPUT_AUDIO_FORMAT = "wav-pcm-s16le-24000-mono"
COMMAND_TIMEOUT_SECONDS = 75
MAX_BROWSER_REDIRECTS = 5
MAX_BROWSER_CANDIDATES = 6
MAX_SSR_PAGE_BYTES = 2 * 1024 * 1024
TIKTOK_PAGE_HOSTS = {
    "tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
}
SSR_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36"
)
MEDIA_URL_PATTERN = re.compile(r"\.(?:mp4|m4a|mp3|aac|webm|m3u8)(?:$|[?#])", re.IGNORECASE)
TIKTOK_LOGIN_ASSET_MARKERS = (
    "website-login.",
    "website_login_static",
    "web_login_static",
)
PASSTHROUGH_MEDIA_TYPES = {
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".wav": "audio/wav",
}
logger = logging.getLogger("miqdar.extractor")


class ExtractionError(RuntimeError):
    def __init__(
        self,
        code: str,
        *,
        status: int = 422,
        retryable: bool = False,
        attempted_methods: tuple[str, ...] = (),
        last_failure: str | None = None,
        direct_failure: str | None = None,
    ):
        super().__init__(code)
        self.code = code
        self.status = status
        self.retryable = retryable
        self.attempted_methods = attempted_methods
        self.last_failure = last_failure
        self.direct_failure = direct_failure


@dataclass(frozen=True)
class ExtractedAudio:
    path: Path
    method: str
    media_type: str = "audio/wav"
    preparation_mode: str = "lossless-wav"
    timings_ms: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class PreparedAudio:
    path: Path
    media_type: str
    mode: str


@dataclass(frozen=True)
class CommandResult:
    stdout: str
    stderr: str


def build_yt_dlp_command(url: str, workdir: Path) -> list[str]:
    return [
        os.environ.get("YT_DLP_BINARY", "yt-dlp"),
        "--no-config",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--socket-timeout",
        "15",
        "--retries",
        "1",
        "--fragment-retries",
        "1",
        "--max-filesize",
        str(MAX_SOURCE_BYTES),
        "--match-filter",
        f"!is_live & duration <= {MAX_DURATION_SECONDS}",
        "--format",
        "bestaudio/best",
        "--output",
        str(workdir / "source.%(ext)s"),
        "--print",
        "after_move:filepath",
        "--",
        url,
    ]


def build_ffmpeg_command(source: str, output: Path, request_headers: str | None = None) -> list[str]:
    command = [
        os.environ.get("FFMPEG_BINARY", "ffmpeg"),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
    ]
    if request_headers:
        command.extend(["-headers", request_headers])
    command.extend([
        "-i",
        source,
        "-map",
        "0:a:0?",
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(OUTPUT_SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        "-t",
        str(MAX_DURATION_SECONDS + 1),
        str(output),
    ])
    return command


def build_ffmpeg_remux_command(source: str, output: Path, request_headers: str | None = None) -> list[str]:
    command = [
        os.environ.get("FFMPEG_BINARY", "ffmpeg"),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
    ]
    if request_headers:
        command.extend(["-headers", request_headers])
    command.extend([
        "-i",
        source,
        "-map",
        "0:a:0?",
        "-vn",
        "-c:a",
        "copy",
        "-t",
        str(MAX_DURATION_SECONDS + 1),
        str(output),
    ])
    return command


async def run_command(command: list[str], timeout: int = COMMAND_TIMEOUT_SECONDS) -> CommandResult:
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, PermissionError) as error:
        raise ExtractionError("extractor_misconfigured", status=503) from error

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError as error:
        process.kill()
        await process.communicate()
        raise ExtractionError("extraction_timeout", status=504, retryable=True) from error

    stdout = stdout_bytes.decode("utf-8", errors="replace")[-16_000:]
    stderr = stderr_bytes.decode("utf-8", errors="replace")[-16_000:]
    if process.returncode != 0:
        lowered = f"{stdout}\n{stderr}".lower()
        if "longer than" in lowered or "duration" in lowered and "filter" in lowered:
            raise ExtractionError("media_too_long", status=413)
        if any(marker in lowered for marker in ("private", "login required", "not available", "unavailable")):
            raise ExtractionError("media_unavailable", status=404)
        raise ExtractionError("direct_extraction_failed", retryable=True)
    return CommandResult(stdout=stdout, stderr=stderr)


async def probe_duration(path: Path) -> float | None:
    command = [
        os.environ.get("FFPROBE_BINARY", "ffprobe"),
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        result = await run_command(command, timeout=15)
        duration = float(result.stdout.strip().splitlines()[-1])
    except (ExtractionError, ValueError, IndexError):
        return None
    return duration if duration >= 0 else None


async def _validate_prepared_audio(path: Path) -> None:
    if not path.is_file() or path.stat().st_size <= 0:
        raise ExtractionError("no_audio_track")
    if path.stat().st_size > MAX_AUDIO_BYTES:
        raise ExtractionError("audio_too_large", status=413)
    duration = await probe_duration(path)
    if duration is not None and duration > MAX_DURATION_SECONDS + 0.25:
        path.unlink(missing_ok=True)
        raise ExtractionError("media_too_long", status=413)


def _source_suffix(source: str) -> str:
    raw_path = urlsplit(source).path if source.startswith("https://") else source
    return Path(raw_path).suffix.lower()


async def prepare_audio(
    source: str,
    workdir: Path,
    request_headers: str | None = None,
    source_content_type: str | None = None,
) -> PreparedAudio:
    local_source: Path | None = None
    if not source.startswith("https://"):
        local_source = Path(source)
        if not local_source.is_file() or local_source.stat().st_size <= 0:
            raise ExtractionError("empty_media")
        if local_source.stat().st_size > MAX_SOURCE_BYTES:
            raise ExtractionError("media_too_large", status=413)
        duration = await probe_duration(local_source)
        if duration is not None and duration > MAX_DURATION_SECONDS:
            raise ExtractionError("media_too_long", status=413)

        passthrough_type = PASSTHROUGH_MEDIA_TYPES.get(local_source.suffix.lower())
        if passthrough_type and local_source.stat().st_size <= MAX_AUDIO_BYTES:
            return PreparedAudio(local_source, passthrough_type, "source-audio")

    suffix = _source_suffix(source)
    normalized_type = (source_content_type or "").split(";", 1)[0].strip().lower()
    remux_extension: str | None = None
    remux_type: str | None = None
    if suffix in {".mp4", ".m4v", ".mov", ".m3u8", ".aac"} or normalized_type in {"video/mp4", "audio/aac", "application/vnd.apple.mpegurl"}:
        remux_extension, remux_type = ".m4a", "audio/mp4"
    elif suffix == ".webm" or normalized_type in {"video/webm", "audio/webm"}:
        remux_extension, remux_type = ".webm", "audio/webm"

    if remux_extension and remux_type:
        remuxed = workdir / f"miqdar-audio{remux_extension}"
        try:
            await run_command(build_ffmpeg_remux_command(source, remuxed, request_headers))
            await _validate_prepared_audio(remuxed)
            return PreparedAudio(remuxed, remux_type, "lossless-remux")
        except ExtractionError as error:
            remuxed.unlink(missing_ok=True)
            logger.info("audio_remux=fallback reason=%s", error.code)

    output = workdir / "miqdar-audio.wav"
    await run_command(build_ffmpeg_command(source, output, request_headers))
    await _validate_prepared_audio(output)
    return PreparedAudio(output, "audio/wav", "lossless-wav")


class YtDlpExtractor:
    async def extract(self, url: str, workdir: Path) -> ExtractedAudio:
        download_started = time.perf_counter()
        result = await run_command(build_yt_dlp_command(url, workdir))
        download_ms = round((time.perf_counter() - download_started) * 1_000)
        printed_paths = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]
        source = next((path for path in reversed(printed_paths) if path.is_file()), None)
        if source is None:
            source = next((path for path in workdir.glob("source.*") if path.is_file()), None)
        if source is None:
            raise ExtractionError("direct_extraction_failed", retryable=True)
        preparation_started = time.perf_counter()
        prepared = await prepare_audio(str(source), workdir)
        preparation_ms = round((time.perf_counter() - preparation_started) * 1_000)
        return ExtractedAudio(
            path=prepared.path,
            method="yt-dlp",
            media_type=prepared.media_type,
            preparation_mode=prepared.mode,
            timings_ms={"source": download_ms, "preparation": preparation_ms},
        )


def _candidate_score(
    url: str,
    content_type: str,
    *,
    primary: bool = False,
    resource_type: str = "",
) -> int:
    lowered_type = content_type.lower()
    lowered_url = url.lower()
    score = 0
    if lowered_type.startswith("audio/"):
        score = 80
    elif "mpegurl" in lowered_type or ".m3u8" in lowered_url:
        score = 60
    elif lowered_type.startswith("video/"):
        score = 70
    elif MEDIA_URL_PATTERN.search(lowered_url):
        score = 40
    if resource_type == "media":
        score += 20
    if primary:
        # Une URL déclarée dans le DOM n'est qu'un indice. Une réponse média
        # réellement observée par Chromium reste prioritaire : TikTok peut
        # publier dans ses métadonnées une URL signée qui renvoie ensuite une
        # page HTML « Access Denied » lors d'un second téléchargement.
        score += 15
    return score


def _is_tiktok_login_asset(url: str) -> bool:
    """Ignore les vidéos décoratives et autres médias du portail de connexion."""
    lowered = url.lower()
    return any(marker in lowered for marker in TIKTOK_LOGIN_ASSET_MARKERS)


def _tiktok_hydration_candidates(raw_payload: str) -> list[tuple[str, str, int]]:
    """Extrait les flux signés publiés dans l'état SSR de la page TikTok.

    Certaines pages publiques sont rendues avec les scripts du portail de
    connexion tout en conservant ``itemStruct`` dans leur état hydraté. Le flux
    audio ``music.playUrl`` est alors souvent accessible même lorsque les deux
    adresses vidéo renvoient 403.
    """
    if not raw_payload or len(raw_payload) > 2_000_000:
        return []
    try:
        root = json.loads(raw_payload)
    except (TypeError, ValueError):
        return []

    item_structs: list[dict[str, object]] = []

    def collect(value: object) -> None:
        if isinstance(value, dict):
            item = value.get("itemStruct")
            if isinstance(item, dict):
                item_structs.append(item)
            for nested in value.values():
                collect(nested)
        elif isinstance(value, list):
            for nested in value:
                collect(nested)

    collect(root)
    candidates: list[tuple[str, str, int]] = []
    seen: set[str] = set()

    def remember(value: object, content_type: str, score: int) -> None:
        if not isinstance(value, str) or not value.startswith("https://") or value in seen:
            return
        seen.add(value)
        candidates.append((value, content_type, score))

    def original_sound_matches_video(item: dict[str, object], video: dict[str, object], music: dict[str, object]) -> bool:
        video_duration = video.get("duration")
        music_duration = music.get("duration")
        if not isinstance(video_duration, (int, float)) or not isinstance(music_duration, (int, float)):
            return False
        if abs(float(video_duration) - float(music_duration)) > 2.0:
            return False

        music_title = str(music.get("title") or "").casefold()
        title_is_original = "original" in music_title
        author = item.get("author")
        if not isinstance(author, dict):
            author = {}

        def identity(value: object) -> str:
            return re.sub(r"[^a-z0-9]", "", str(value or "").casefold())

        music_author = identity(music.get("authorName"))
        author_names = {
            identity(author.get("uniqueId")),
            identity(author.get("nickname")),
        }
        author_names.discard("")
        return title_is_original or bool(music_author and music_author in author_names)

    for item in item_structs:
        video = item.get("video")
        music = item.get("music")
        if isinstance(video, dict):
            remember(video.get("playAddr"), "video/mp4", 220)
        if isinstance(video, dict) and isinstance(music, dict) and original_sound_matches_video(item, video, music):
            # C'est la bande-son TikTok. Elle précède downloadAddr car ce
            # dernier est fréquemment protégé par la même règle 403 que
            # playAddr, tandis que l'audio reste publiquement lisible. Elle
            # n'est admise que si sa durée correspond à la vidéo et qu'elle
            # est identifiée comme son original, afin de ne jamais transcrire
            # une musique ajoutée à la place de la voix de la publication.
            remember(music.get("playUrl"), "audio/mpeg", 210)
        if isinstance(video, dict):
            remember(video.get("downloadAddr"), "video/mp4", 200)
    return candidates


def _tiktok_hydration_payload_from_html(page_html: str) -> str | None:
    """Lit uniquement l'état SSR public, sans exécuter les scripts TikTok."""
    if not page_html or len(page_html.encode("utf-8", errors="ignore")) > MAX_SSR_PAGE_BYTES:
        return None
    match = re.search(
        r"<script\b[^>]*\bid=[\"']__UNIVERSAL_DATA_FOR_REHYDRATION__[\"'][^>]*>(.*?)</script\s*>",
        page_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None
    payload = html.unescape(match.group(1)).strip()
    return payload if payload and len(payload) <= MAX_SSR_PAGE_BYTES else None


def _safe_header_value(value: str) -> str:
    return value.replace("\r", " ").replace("\n", " ")[:4_096]


def _browser_source_suffix(url: str, content_type: str) -> str:
    suffix = _source_suffix(url)
    if suffix in {".mp4", ".m4v", ".mov", ".m4a", ".mp3", ".aac", ".webm"}:
        return suffix
    normalized_type = content_type.split(";", 1)[0].strip().lower()
    return {
        "video/mp4": ".mp4",
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/aac": ".aac",
        "video/webm": ".webm",
        "audio/webm": ".webm",
    }.get(normalized_type, ".media")


def _validate_browser_media_payload(content_type: str, payload_start: bytes) -> None:
    """Refuse les pages d'erreur servies avec un statut HTTP trompeur."""
    normalized_type = content_type.split(";", 1)[0].strip().lower()
    beginning = payload_start[:4_096].lstrip().lower()
    hls_playlist = normalized_type in {
        "application/vnd.apple.mpegurl",
        "application/x-mpegurl",
    } or beginning.startswith(b"#extm3u")
    textual_type = normalized_type.startswith("text/") or normalized_type in {
        "application/json",
        "application/problem+json",
        "application/xml",
        "application/xhtml+xml",
    }
    error_page = any(marker in beginning for marker in (
        b"<!doctype html",
        b"<html",
        b"<head",
        b"<body",
        b"access denied",
        b"verify you are human",
    ))
    json_page = beginning.startswith((b"{", b"["))
    if not hls_playlist and (textual_type or error_page or json_page):
        raise ExtractionError("browser_media_invalid_payload", retryable=True)


def _validated_browser_target(
    media_url: str,
    workdir: Path,
    content_type: str,
    payload: bytes,
) -> Path:
    if not payload:
        raise ExtractionError("browser_media_empty", retryable=True)
    if len(payload) > MAX_SOURCE_BYTES:
        raise ExtractionError("media_too_large", status=413)
    _validate_browser_media_payload(content_type, payload)
    source = workdir / f"source-browser{_browser_source_suffix(media_url, content_type)}"
    source.write_bytes(payload)
    return source


def _validate_declared_media_size(headers: object) -> None:
    content_length = str(getattr(headers, "get", lambda *_: "")("content-length", ""))
    if content_length.isdigit() and int(content_length) > MAX_SOURCE_BYTES:
        raise ExtractionError("media_too_large", status=413)
    content_range = str(getattr(headers, "get", lambda *_: "")("content-range", ""))
    total_size = content_range.rsplit("/", 1)[-1].strip() if "/" in content_range else ""
    if total_size.isdigit() and int(total_size) > MAX_SOURCE_BYTES:
        raise ExtractionError("media_too_large", status=413)


async def download_browser_media(
    media_url: str,
    workdir: Path,
    headers: dict[str, str],
    *,
    open_response: Callable[[str, dict[str, str]], object] | None = None,
) -> tuple[Path, str]:
    """Transfère le média par blocs avec les en-têtes Chromium et une limite stricte."""
    current_url = media_url
    response_opener = open_response or _open_browser_response
    try:
        for redirect_index in range(MAX_BROWSER_REDIRECTS + 1):
            current_url = normalize_public_media_url(current_url)
            hostname = urlsplit(current_url).hostname or ""
            await asyncio.to_thread(assert_public_hostname, hostname)
            response = await asyncio.to_thread(response_opener, current_url, headers)
            try:
                raw_status = getattr(response, "status", None)
                status = int(raw_status if raw_status is not None else response.getcode())
                response_headers = getattr(response, "headers", {})
                if status in {301, 302, 303, 307, 308}:
                    location = str(response_headers.get("location", "")).strip()
                    if not location or redirect_index >= MAX_BROWSER_REDIRECTS:
                        raise ExtractionError("browser_media_redirect_failed", retryable=True)
                    current_url = urljoin(current_url, location)
                    continue
                if status in {401, 403}:
                    raise ExtractionError("browser_media_forbidden", retryable=True)
                if status in {404, 410}:
                    raise ExtractionError("browser_media_not_found", retryable=True)
                if status < 200 or status >= 300:
                    raise ExtractionError("browser_media_download_failed", retryable=True)

                _validate_declared_media_size(response_headers)
                content_type = str(response_headers.get("content-type", ""))
                source = workdir / f"source-browser{_browser_source_suffix(current_url, content_type)}"
                total = await asyncio.to_thread(_stream_response_to_file, response, source, content_type)
                if total <= 0:
                    source.unlink(missing_ok=True)
                    raise ExtractionError("browser_media_empty", retryable=True)
                return source, content_type
            finally:
                response.close()
    except ExtractionError:
        raise
    except UnsafeUrl:
        raise
    except Exception as error:
        raise ExtractionError("browser_media_download_failed", retryable=True) from error
    raise ExtractionError("browser_media_redirect_failed", retryable=True)


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):  # noqa: ANN001
        return None


def _open_browser_response(url: str, headers: dict[str, str]) -> object:
    request = Request(url, headers=headers, method="GET")
    opener = build_opener(_NoRedirectHandler())
    try:
        return opener.open(request, timeout=30)
    except HTTPError as response:
        return response


def _read_limited_response(response: object, limit: int) -> bytes:
    payload = bytearray()
    while chunk := response.read(64 * 1024):
        payload.extend(chunk)
        if len(payload) > limit:
            raise ExtractionError("ssr_page_too_large", retryable=True)
    return bytes(payload)


async def fetch_tiktok_ssr_page(
    url: str,
    *,
    open_response: Callable[[str, dict[str, str]], object] | None = None,
) -> tuple[str, str]:
    """Résout une page TikTok publique avec des redirections contrôlées."""
    current_url = normalize_source_url(url)
    response_opener = open_response or _open_browser_response
    headers = {
        "User-Agent": SSR_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "fr-FR,fr;q=0.8,en;q=0.6",
    }
    try:
        for redirect_index in range(MAX_BROWSER_REDIRECTS + 1):
            current_url = normalize_source_url(current_url)
            hostname = urlsplit(current_url).hostname or ""
            await asyncio.to_thread(assert_public_hostname, hostname)
            response = await asyncio.to_thread(response_opener, current_url, headers)
            try:
                raw_status = getattr(response, "status", None)
                status = int(raw_status if raw_status is not None else response.getcode())
                response_headers = getattr(response, "headers", {}) or {}
                if status in {301, 302, 303, 307, 308}:
                    location = str(response_headers.get("location", "")).strip()
                    if not location or redirect_index >= MAX_BROWSER_REDIRECTS:
                        raise ExtractionError("ssr_redirect_failed", retryable=True)
                    redirected = urljoin(current_url, location)
                    if (urlsplit(redirected).hostname or "").lower() not in TIKTOK_PAGE_HOSTS:
                        raise ExtractionError("unexpected_redirect", retryable=True)
                    current_url = redirected
                    continue
                if status in {401, 403}:
                    raise ExtractionError("ssr_page_forbidden", retryable=True)
                if status in {404, 410}:
                    raise ExtractionError("media_unavailable", status=404)
                if status < 200 or status >= 300:
                    raise ExtractionError("ssr_page_unavailable", retryable=True)
                content_length = str(response_headers.get("content-length", ""))
                if content_length.isdigit() and int(content_length) > MAX_SSR_PAGE_BYTES:
                    raise ExtractionError("ssr_page_too_large", retryable=True)
                content_type = str(response_headers.get("content-type", "")).lower()
                if content_type and "html" not in content_type:
                    raise ExtractionError("ssr_page_invalid", retryable=True)
                payload = await asyncio.to_thread(_read_limited_response, response, MAX_SSR_PAGE_BYTES)
                return current_url, payload.decode("utf-8", errors="replace")
            finally:
                response.close()
    except ExtractionError:
        raise
    except UnsafeUrl:
        raise
    except Exception as error:
        raise ExtractionError("ssr_page_unavailable", retryable=True) from error
    raise ExtractionError("ssr_redirect_failed", retryable=True)


def _stream_response_to_file(response: object, target: Path, content_type: str = "") -> int:
    total = 0
    first_chunk = True
    try:
        with target.open("wb") as output:
            while chunk := response.read(64 * 1024):
                if first_chunk:
                    _validate_browser_media_payload(content_type, chunk)
                    first_chunk = False
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise ExtractionError("media_too_large", status=413)
                output.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return total


async def download_observed_browser_media(
    media_url: str,
    response: object,
    workdir: Path,
) -> tuple[Path, str]:
    """Matérialise exactement la réponse média déjà acceptée par Chromium."""
    status = int(getattr(response, "status", 0))
    if status in {401, 403}:
        raise ExtractionError("browser_media_forbidden", retryable=True)
    if status < 200 or status >= 300:
        raise ExtractionError("browser_media_download_failed", retryable=True)
    headers = getattr(response, "headers", {}) or {}
    content_type = str(headers.get("content-type", ""))
    _validate_declared_media_size(headers)
    try:
        payload = await response.body()
    except Exception as error:
        raise ExtractionError("browser_media_body_unavailable", retryable=True) from error
    source = await asyncio.to_thread(_validated_browser_target, media_url, workdir, content_type, payload)
    return source, content_type


async def download_browser_media_with_context(
    media_url: str,
    workdir: Path,
    headers: dict[str, str],
    request_context: object,
) -> tuple[Path, str]:
    """Retélécharge avec le contexte HTTP Playwright partageant les cookies Chromium."""
    safe_headers = {
        key: _safe_header_value(value)
        for key, value in headers.items()
        if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}
    }
    safe_headers.setdefault("Accept", "video/*,audio/*;q=0.9,*/*;q=0.5")
    safe_headers.setdefault("Range", f"bytes=0-{MAX_SOURCE_BYTES - 1}")
    response = None
    try:
        response = await request_context.get(
            normalize_public_media_url(media_url),
            headers=safe_headers,
            timeout=30_000,
            max_redirects=MAX_BROWSER_REDIRECTS,
            fail_on_status_code=False,
        )
        status = int(getattr(response, "status", 0))
        if status in {401, 403}:
            raise ExtractionError("browser_media_forbidden", retryable=True)
        if status in {404, 410}:
            raise ExtractionError("browser_media_not_found", retryable=True)
        if status < 200 or status >= 300:
            raise ExtractionError("browser_media_download_failed", retryable=True)
        response_headers = getattr(response, "headers", {}) or {}
        content_type = str(response_headers.get("content-type", ""))
        _validate_declared_media_size(response_headers)
        payload = await response.body()
        source = await asyncio.to_thread(_validated_browser_target, media_url, workdir, content_type, payload)
        return source, content_type
    except ExtractionError:
        raise
    except UnsafeUrl:
        raise
    except Exception as error:
        raise ExtractionError("browser_media_download_failed", retryable=True) from error
    finally:
        if response is not None:
            try:
                await response.dispose()
            except Exception:
                logger.warning("browser_request_response=dispose_failed", exc_info=True)


async def _browser_candidate_headers(
    observed_response: object | None,
    context: object,
    page: object,
    media_url: str,
) -> dict[str, str]:
    """Rejoue les en-têtes du vrai flux média sans conserver la session."""
    headers: dict[str, str] = {}
    request = getattr(observed_response, "request", None) if observed_response is not None else None
    if request is not None:
        try:
            observed_headers = await request.all_headers()
        except Exception:
            observed_headers = getattr(request, "headers", {}) or {}
        headers.update({str(key): _safe_header_value(str(value)) for key, value in observed_headers.items()})

    user_agent = _safe_header_value(await page.evaluate("() => navigator.userAgent"))
    referer = _safe_header_value(page.url)
    headers["User-Agent"] = user_agent
    headers["Referer"] = referer
    headers.setdefault("Accept", "video/*,audio/*;q=0.9,*/*;q=0.5")
    headers.setdefault("Sec-Fetch-Dest", "video")
    headers.setdefault("Sec-Fetch-Mode", "no-cors")
    headers.setdefault("Sec-Fetch-Site", "cross-site")

    cookies = await context.cookies(media_url)
    cookie_header = "; ".join(
        f"{_safe_header_value(cookie['name'])}={_safe_header_value(cookie['value'])}"
        for cookie in cookies
        if cookie.get("name") and cookie.get("value")
    )
    if cookie_header:
        headers["Cookie"] = cookie_header
    return headers


def _discard_candidate_files(workdir: Path) -> None:
    for pattern in ("source-browser.*", "miqdar-audio.*"):
        for candidate in workdir.glob(pattern):
            candidate.unlink(missing_ok=True)


class TikTokSsrExtractor:
    """Chemin rapide : état SSR public, média signé, validation ffmpeg."""

    async def extract(self, url: str, workdir: Path) -> ExtractedAudio:
        page_started = time.perf_counter()
        final_url, page_html = await fetch_tiktok_ssr_page(url)
        page_ms = round((time.perf_counter() - page_started) * 1_000)
        hydration = _tiktok_hydration_payload_from_html(page_html)
        candidates = _tiktok_hydration_candidates(hydration or "")
        if not candidates:
            raise ExtractionError("ssr_media_not_found", retryable=True)

        headers = {
            "User-Agent": SSR_USER_AGENT,
            "Referer": final_url,
            "Accept": "video/*,audio/*;q=0.9,*/*;q=0.5",
        }
        last_error = ExtractionError("ssr_media_not_found", retryable=True)
        for candidate_index, (media_url, _declared_type, _score) in enumerate(candidates[:3], start=1):
            _discard_candidate_files(workdir)
            try:
                source_started = time.perf_counter()
                source, source_content_type = await download_browser_media(media_url, workdir, headers)
                source_ms = round((time.perf_counter() - source_started) * 1_000)
                preparation_started = time.perf_counter()
                prepared = await prepare_audio(
                    str(source),
                    workdir,
                    source_content_type=source_content_type,
                )
                preparation_ms = round((time.perf_counter() - preparation_started) * 1_000)
                logger.info(
                    "tiktok_ssr_candidate=%s status=succeeded host=%s",
                    candidate_index,
                    urlsplit(media_url).hostname or "-",
                )
                return ExtractedAudio(
                    path=prepared.path,
                    method="tiktok-ssr",
                    media_type=prepared.media_type,
                    preparation_mode=prepared.mode,
                    timings_ms={
                        "source": page_ms + source_ms,
                        "preparation": preparation_ms,
                    },
                )
            except ExtractionError as error:
                last_error = error
                logger.info(
                    "tiktok_ssr_candidate=%s status=failed reason=%s",
                    candidate_index,
                    error.code,
                )
                if error.code in {"media_too_long", "media_too_large", "audio_too_large"}:
                    raise
        raise ExtractionError(last_error.code, retryable=True) from last_error


class ChromiumBrowserPool:
    """Réutilise le processus Chromium, jamais les cookies ni les pages d'un appel."""

    def __init__(self, playwright_factory: Callable[[], object] | None = None):
        self._playwright_factory = playwright_factory
        self._lock = asyncio.Lock()
        self._playwright: object | None = None
        self._browser: object | None = None

    def _browser_is_connected(self) -> bool:
        if self._browser is None:
            return False
        is_connected = getattr(self._browser, "is_connected", None)
        return bool(is_connected()) if callable(is_connected) else True

    async def _start_locked(self) -> None:
        if self._playwright_factory is None:
            try:
                from playwright.async_api import async_playwright
            except ImportError as error:
                raise ExtractionError("browser_misconfigured", status=503) from error
            factory = async_playwright
        else:
            factory = self._playwright_factory

        manager = factory()
        try:
            self._playwright = await manager.start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=["--disable-dev-shm-usage", "--no-sandbox"],
            )
        except Exception as error:
            playwright = self._playwright
            self._playwright = None
            self._browser = None
            if playwright is not None:
                try:
                    await playwright.stop()
                except Exception:
                    logger.warning("chromium_pool=start_cleanup_failed", exc_info=True)
            raise ExtractionError("browser_misconfigured", status=503) from error

    async def _close_locked(self) -> None:
        browser, playwright = self._browser, self._playwright
        self._browser = None
        self._playwright = None
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                logger.warning("chromium_pool=browser_close_failed", exc_info=True)
        if playwright is not None:
            try:
                await playwright.stop()
            except Exception:
                logger.warning("chromium_pool=playwright_stop_failed", exc_info=True)

    async def new_context(self) -> object:
        async with self._lock:
            if not self._browser_is_connected():
                await self._close_locked()
                await self._start_locked()
            try:
                return await self._browser.new_context(
                    locale="fr-FR",
                    viewport={"width": 1080, "height": 900},
                )
            except Exception:
                logger.warning("chromium_pool=context_restart", exc_info=True)
                await self._close_locked()
                await self._start_locked()
                return await self._browser.new_context(
                    locale="fr-FR",
                    viewport={"width": 1080, "height": 900},
                )

    async def close(self) -> None:
        async with self._lock:
            await self._close_locked()


_chromium_browser_pool = ChromiumBrowserPool()


async def close_browser_pool() -> None:
    await _chromium_browser_pool.close()


class ChromiumExtractor:
    def __init__(self, browser_pool: ChromiumBrowserPool | None = None):
        self.browser_pool = browser_pool or _chromium_browser_pool

    async def extract(self, url: str, workdir: Path) -> ExtractedAudio:
        browser_started = time.perf_counter()
        candidates: dict[str, tuple[int, str, object | None]] = {}
        context = await self.browser_pool.new_context()
        try:
            page = await context.new_page()

            def remember_response(response: object) -> None:
                response_url = str(getattr(response, "url", ""))
                if _is_tiktok_login_asset(response_url):
                    return
                headers = getattr(response, "headers", {}) or {}
                content_type = str(headers.get("content-type", ""))
                request = getattr(response, "request", None)
                resource_type = str(getattr(request, "resource_type", ""))
                score = _candidate_score(
                    response_url,
                    content_type,
                    resource_type=resource_type,
                )
                if score and response_url.startswith("https://"):
                    previous = candidates.get(response_url, (0, "", None))
                    candidates[response_url] = (
                        max(previous[0], score),
                        content_type or previous[1],
                        response,
                    )

            page.on("response", remember_response)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
                final_url = normalize_source_url(page.url)
                if urlsplit(final_url).hostname not in {"tiktok.com", "www.tiktok.com", "m.tiktok.com"}:
                    raise ExtractionError("unexpected_redirect")

                try:
                    page_text = (await page.locator("body").inner_text(timeout=2_000)).lower()[:12_000]
                except Exception:
                    page_text = ""
                if any(marker in page_text for marker in ("captcha", "verify to continue", "vérifiez pour continuer")):
                    raise ExtractionError("browser_challenge", status=409)

                await page.evaluate(
                    """() => document.querySelectorAll('video').forEach((video) => {
                      video.muted = true;
                      video.play().catch(() => undefined);
                    })"""
                )
                try:
                    hydration_payload = await page.locator(
                        "script#__UNIVERSAL_DATA_FOR_REHYDRATION__"
                    ).text_content(timeout=2_000)
                except Exception:
                    hydration_payload = None
                hydration_candidates = _tiktok_hydration_candidates(hydration_payload or "")
                for media_url, content_type, score in hydration_candidates:
                    previous = candidates.get(media_url, (0, "", None))
                    candidates[media_url] = (
                        max(previous[0], score),
                        content_type or previous[1],
                        previous[2],
                    )
                if hydration_candidates:
                    logger.info("tiktok_hydration=media_candidates count=%s", len(hydration_candidates))
                for _ in range(20):
                    await page.wait_for_timeout(250)
                    primary_urls = await page.evaluate(
                        """() => {
                          const values = [];
                          document.querySelectorAll('video').forEach((video) => {
                            values.push(video.currentSrc, video.src);
                            video.querySelectorAll('source').forEach((source) => values.push(source.src));
                          });
                          document.querySelectorAll(
                            'meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]'
                          ).forEach((meta) => values.push(meta.content));
                          return [...new Set(values.filter((value) => value && value.startsWith('https://')))];
                        }"""
                    )
                    for primary_url in primary_urls:
                        previous = candidates.get(primary_url, (0, "", None))
                        score = _candidate_score(primary_url, previous[1], primary=True)
                        candidates[primary_url] = (max(previous[0], score), previous[1], previous[2])
                    if primary_urls:
                        break

                if not candidates:
                    raise ExtractionError("browser_media_not_found", retryable=True)

                ranked_candidates = sorted(candidates.items(), key=lambda item: item[1][0], reverse=True)
                last_error = ExtractionError("browser_media_not_found", retryable=True)
                for candidate_index, (raw_media_url, metadata) in enumerate(
                    ranked_candidates[:MAX_BROWSER_CANDIDATES],
                    start=1,
                ):
                    media_url = normalize_public_media_url(raw_media_url)
                    hostname = urlsplit(media_url).hostname or ""
                    await asyncio.to_thread(assert_public_hostname, hostname)
                    browser_headers = await _browser_candidate_headers(metadata[2], context, page, media_url)
                    downloaders: list[tuple[str, Callable[[], object]]] = []
                    if metadata[2] is not None:
                        downloaders.append((
                            "observed-response",
                            lambda media_url=media_url, response=metadata[2]: download_observed_browser_media(
                                media_url,
                                response,
                                workdir,
                            ),
                        ))
                    downloaders.extend([
                        (
                            "playwright-request",
                            lambda media_url=media_url, headers=browser_headers: download_browser_media_with_context(
                                media_url,
                                workdir,
                                headers,
                                context.request,
                            ),
                        ),
                        (
                            "session-stream",
                            lambda media_url=media_url, headers=browser_headers: download_browser_media(
                                media_url,
                                workdir,
                                headers,
                            ),
                        ),
                    ])

                    for download_method, downloader in downloaders:
                        _discard_candidate_files(workdir)
                        try:
                            source_started = time.perf_counter()
                            source, source_content_type = await downloader()
                            source_ms = round((time.perf_counter() - source_started) * 1_000)
                            preparation_started = time.perf_counter()
                            prepared = await prepare_audio(
                                str(source),
                                workdir,
                                source_content_type=source_content_type,
                            )
                            preparation_ms = round((time.perf_counter() - preparation_started) * 1_000)
                            logger.info(
                                "browser_candidate=%s method=%s status=succeeded host=%s content_type=%s",
                                candidate_index,
                                download_method,
                                hostname,
                                source_content_type.split(";", 1)[0] or "unknown",
                            )
                            return ExtractedAudio(
                                path=prepared.path,
                                method="chromium",
                                media_type=prepared.media_type,
                                preparation_mode=prepared.mode,
                                timings_ms={"source": source_ms, "preparation": preparation_ms},
                            )
                        except ExtractionError as candidate_error:
                            if candidate_error.code in {"media_too_long", "media_too_large", "audio_too_large"}:
                                raise
                            last_error = candidate_error
                            logger.info(
                                "browser_candidate=%s method=%s status=failed host=%s reason=%s",
                                candidate_index,
                                download_method,
                                hostname,
                                candidate_error.code,
                            )
                raise ExtractionError(last_error.code, retryable=True) from last_error
            except ExtractionError:
                raise
            except UnsafeUrl as error:
                raise ExtractionError(str(error)) from error
            except Exception as error:
                raise ExtractionError("browser_extraction_failed", retryable=True) from error
        finally:
            try:
                await context.close()
            except Exception:
                logger.warning("chromium_context=close_failed", exc_info=True)


async def extract_with_fallback(
    url: str,
    workdir: Path,
    direct_extractor: YtDlpExtractor | None = None,
    browser_extractor: ChromiumExtractor | None = None,
    ssr_extractor: TikTokSsrExtractor | None = None,
    request_id: str | None = None,
) -> ExtractedAudio:
    normalized = normalize_source_url(url)
    direct = direct_extractor or YtDlpExtractor()
    browser = browser_extractor or ChromiumExtractor()
    # Les tests et intégrations qui injectent leurs extracteurs conservent le
    # chemin historique. En production, où rien n'est injecté, SSR est le
    # premier étage et évite le démarrage/navigation Chromium lorsque possible.
    ssr = ssr_extractor
    if ssr is None and direct_extractor is None and browser_extractor is None:
        ssr = TikTokSsrExtractor()
    is_tiktok = (urlsplit(normalized).hostname or "").lower() in {
        "tiktok.com",
        "www.tiktok.com",
        "m.tiktok.com",
        "vm.tiktok.com",
        "vt.tiktok.com",
    }
    if is_tiktok:
        attempted_prefix: tuple[str, ...] = ()
        if ssr is not None:
            try:
                logger.info("request_id=%s method=tiktok-ssr status=started priority=tiktok", request_id or "-")
                ssr_started = time.perf_counter()
                extracted = await ssr.extract(normalized, workdir)
                logger.info(
                    "request_id=%s method=tiktok-ssr status=succeeded duration_ms=%s preparation=%s preparation_ms=%s",
                    request_id or "-",
                    round((time.perf_counter() - ssr_started) * 1_000),
                    extracted.preparation_mode,
                    extracted.timings_ms.get("preparation", 0),
                )
                return extracted
            except ExtractionError as ssr_error:
                attempted_prefix = ("tiktok-ssr",)
                logger.warning(
                    "request_id=%s method=tiktok-ssr status=failed reason=%s duration_ms=%s",
                    request_id or "-",
                    ssr_error.code,
                    round((time.perf_counter() - ssr_started) * 1_000),
                )
                if ssr_error.code in {"media_too_long", "media_too_large", "audio_too_large"}:
                    raise ExtractionError(
                        ssr_error.code,
                        status=ssr_error.status,
                        attempted_methods=attempted_prefix,
                        last_failure=ssr_error.code,
                    ) from ssr_error
                for path in workdir.iterdir():
                    if path.is_file():
                        path.unlink(missing_ok=True)
        try:
            logger.info("request_id=%s method=chromium status=started priority=tiktok", request_id or "-")
            browser_started = time.perf_counter()
            extracted = await browser.extract(normalized, workdir)
            logger.info(
                "request_id=%s method=chromium status=succeeded duration_ms=%s preparation=%s preparation_ms=%s",
                request_id or "-",
                round((time.perf_counter() - browser_started) * 1_000),
                extracted.preparation_mode,
                extracted.timings_ms.get("preparation", 0),
            )
            return extracted
        except ExtractionError as browser_error:
            logger.warning(
                "request_id=%s method=chromium status=failed reason=%s duration_ms=%s",
                request_id or "-",
                browser_error.code,
                round((time.perf_counter() - browser_started) * 1_000),
            )
            if browser_error.code in {"media_too_long", "media_too_large", "audio_too_large"}:
                raise ExtractionError(
                    browser_error.code,
                    status=browser_error.status,
                    attempted_methods=attempted_prefix + ("chromium",),
                    last_failure=browser_error.code,
                ) from browser_error
            for path in workdir.iterdir():
                if path.is_file():
                    path.unlink(missing_ok=True)
            try:
                direct_started = time.perf_counter()
                extracted = await direct.extract(normalized, workdir)
                logger.info(
                    "request_id=%s method=yt-dlp status=succeeded duration_ms=%s preparation=%s preparation_ms=%s",
                    request_id or "-",
                    round((time.perf_counter() - direct_started) * 1_000),
                    extracted.preparation_mode,
                    extracted.timings_ms.get("preparation", 0),
                )
                return extracted
            except ExtractionError as direct_error:
                logger.warning(
                    "request_id=%s method=yt-dlp status=failed reason=%s duration_ms=%s",
                    request_id or "-",
                    direct_error.code,
                    round((time.perf_counter() - direct_started) * 1_000),
                )
                if direct_error.code in {"media_too_long", "media_too_large", "audio_too_large"}:
                    raise ExtractionError(
                        direct_error.code,
                        status=direct_error.status,
                        attempted_methods=attempted_prefix + ("chromium", "yt-dlp"),
                        last_failure=browser_error.code,
                        direct_failure=direct_error.code,
                    ) from direct_error
                challenge = browser_error.code == "browser_challenge"
                raise ExtractionError(
                    "public_media_unavailable" if not challenge else "browser_challenge",
                    status=browser_error.status if challenge else 422,
                    retryable=True,
                    attempted_methods=attempted_prefix + ("chromium", "yt-dlp"),
                    last_failure=browser_error.code,
                    direct_failure=direct_error.code,
                ) from direct_error

    try:
        direct_started = time.perf_counter()
        extracted = await direct.extract(normalized, workdir)
        logger.info(
            "request_id=%s method=yt-dlp status=succeeded duration_ms=%s preparation=%s preparation_ms=%s",
            request_id or "-",
            round((time.perf_counter() - direct_started) * 1_000),
            extracted.preparation_mode,
            extracted.timings_ms.get("preparation", 0),
        )
        return extracted
    except ExtractionError as error:
        logger.warning(
            "request_id=%s method=yt-dlp status=failed reason=%s duration_ms=%s",
            request_id or "-",
            error.code,
            round((time.perf_counter() - direct_started) * 1_000),
        )
        if error.code in {"media_too_long", "media_too_large", "audio_too_large"}:
            raise ExtractionError(
                error.code,
                status=error.status,
                attempted_methods=("yt-dlp",),
                last_failure=error.code,
                direct_failure=error.code,
            ) from error
        for path in workdir.iterdir():
            if path.is_file():
                path.unlink(missing_ok=True)
        try:
            logger.info("request_id=%s method=chromium status=started", request_id or "-")
            browser_started = time.perf_counter()
            extracted = await browser.extract(normalized, workdir)
            logger.info(
                "request_id=%s method=chromium status=succeeded duration_ms=%s preparation=%s preparation_ms=%s",
                request_id or "-",
                round((time.perf_counter() - browser_started) * 1_000),
                extracted.preparation_mode,
                extracted.timings_ms.get("preparation", 0),
            )
            return extracted
        except ExtractionError as browser_error:
            logger.warning(
                "request_id=%s method=chromium status=failed reason=%s duration_ms=%s",
                request_id or "-",
                browser_error.code,
                round((time.perf_counter() - browser_started) * 1_000),
            )
            if browser_error.code == "browser_challenge":
                raise ExtractionError(
                    browser_error.code,
                    status=browser_error.status,
                    attempted_methods=("yt-dlp", "chromium"),
                    last_failure=browser_error.code,
                    direct_failure=error.code,
                ) from browser_error
            raise ExtractionError(
                "public_media_unavailable",
                status=422,
                retryable=True,
                attempted_methods=("yt-dlp", "chromium"),
                last_failure=browser_error.code,
                direct_failure=error.code,
            ) from browser_error


def available_tools() -> dict[str, bool]:
    return {
        "ytDlp": shutil.which(os.environ.get("YT_DLP_BINARY", "yt-dlp")) is not None,
        "ffmpeg": shutil.which(os.environ.get("FFMPEG_BINARY", "ffmpeg")) is not None,
        "ffprobe": shutil.which(os.environ.get("FFPROBE_BINARY", "ffprobe")) is not None,
    }
