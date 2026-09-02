from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.extractors import (
    ChromiumBrowserPool,
    ExtractedAudio,
    ExtractionError,
    MAX_DURATION_SECONDS,
    TikTokSsrExtractor,
    _candidate_score,
    _is_tiktok_login_asset,
    _tiktok_hydration_candidates,
    _tiktok_hydration_payload_from_html,
    build_ffmpeg_command,
    build_ffmpeg_remux_command,
    build_yt_dlp_command,
    download_browser_media,
    download_browser_media_with_context,
    download_observed_browser_media,
    extract_with_fallback,
    fetch_tiktok_ssr_page,
    prepare_audio,
)


class FakeExtractor:
    def __init__(self, result=None, error: ExtractionError | None = None):
        self.result = result
        self.error = error
        self.calls = 0

    async def extract(self, _url, _workdir):
        self.calls += 1
        if self.error:
            raise self.error
        return self.result


class FakeHttpResponse:
    def __init__(self, status: int, *, headers=None, chunks=None):
        self.status = status
        self.headers = headers or {}
        self.chunks = list(chunks or [])
        self.closed = False

    def getcode(self):
        return self.status

    def read(self, _size):
        return self.chunks.pop(0) if self.chunks else b""

    def close(self):
        self.closed = True


class FakeResponseOpener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, url, headers):
        self.requests.append((url, dict(headers)))
        return self.responses.pop(0)


class FakeAsyncHttpResponse:
    def __init__(self, status: int, *, headers=None, payload=b"media"):
        self.status = status
        self.headers = headers or {}
        self.payload = payload
        self.disposed = False

    async def body(self):
        return self.payload

    async def dispose(self):
        self.disposed = True


class FakeRequestContext:
    def __init__(self, response):
        self.response = response
        self.requests = []

    async def get(self, url, **options):
        self.requests.append((url, options))
        return self.response


class ExtractorCommandTests(unittest.TestCase):
    def test_yt_dlp_is_limited_to_one_non_live_short_media(self):
        command = build_yt_dlp_command("https://vm.tiktok.com/example/", Path("/tmp/job"))
        self.assertIn("--no-playlist", command)
        self.assertIn("--no-config", command)
        self.assertIn(f"!is_live & duration <= {MAX_DURATION_SECONDS}", command)
        self.assertEqual(command[-2:], ["--", "https://vm.tiktok.com/example/"])

    def test_ffmpeg_outputs_lossless_mono_wav_without_shell(self):
        command = build_ffmpeg_command("/tmp/source.mp4", Path("/tmp/audio.wav"))
        self.assertIn("-vn", command)
        self.assertEqual(command[command.index("-ac") + 1], "1")
        self.assertEqual(command[command.index("-ar") + 1], "24000")
        self.assertEqual(command[command.index("-c:a") + 1], "pcm_s16le")
        self.assertNotIn("-b:a", command)
        self.assertEqual(command[-1], "/tmp/audio.wav")

    def test_ffmpeg_remux_copies_audio_without_reencoding(self):
        command = build_ffmpeg_remux_command("/tmp/source.mp4", Path("/tmp/audio.m4a"))
        self.assertEqual(command[command.index("-c:a") + 1], "copy")
        self.assertIn("-vn", command)
        self.assertNotIn("pcm_s16le", command)


class AudioPreparationTests(unittest.IsolatedAsyncioTestCase):
    async def test_keeps_a_compatible_audio_source_without_reencoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.m4a"
            source.write_bytes(b"audio")
            with patch("app.extractors.probe_duration", AsyncMock(return_value=42.0)):
                prepared = await prepare_audio(str(source), Path(temporary))
            self.assertEqual(prepared.path, source)
            self.assertEqual(prepared.media_type, "audio/mp4")
            self.assertEqual(prepared.mode, "source-audio")

    def test_primary_video_outscores_unrelated_page_media(self):
        unrelated_audio = _candidate_score(
            "https://cdn.example/sound.mp3",
            "audio/mpeg",
        )
        primary_video = _candidate_score(
            "https://cdn.example/main.mp4",
            "video/mp4",
            primary=True,
        )
        self.assertGreater(primary_video, unrelated_audio)

    def test_media_network_responses_receive_a_small_priority(self):
        ordinary = _candidate_score("https://cdn.example/main.mp4", "video/mp4")
        media = _candidate_score(
            "https://cdn.example/main.mp4",
            "video/mp4",
            resource_type="media",
        )
        self.assertGreater(media, ordinary)

    def test_observed_media_response_outscores_metadata_only_url(self):
        observed = _candidate_score(
            "https://cdn.example/video?id=123",
            "video/mp4",
            resource_type="media",
        )
        metadata_only = _candidate_score(
            "https://cdn.example/play?id=123",
            "",
            primary=True,
        )
        self.assertGreater(observed, metadata_only)

    def test_tiktok_login_media_is_never_a_candidate(self):
        self.assertTrue(_is_tiktok_login_asset(
            "https://sf16-website-login.neutral.ttwstatic.com/portal/background.mp4"
        ))
        self.assertFalse(_is_tiktok_login_asset(
            "https://v45.tiktokcdn-eu.com/video/audio.mp3"
        ))

    def test_extracts_signed_tiktok_media_from_hydration_state(self):
        payload = json.dumps({
            "__DEFAULT_SCOPE__": {
                "webapp.reflow.video.detail": {
                    "itemInfo": {
                        "itemStruct": {
                            "video": {
                                "playAddr": "https://video.example/play",
                                "downloadAddr": "https://video.example/download",
                                "duration": 129,
                            },
                            "music": {
                                "playUrl": "https://audio.example/sound",
                                "title": "son original",
                                "duration": 129,
                            },
                        }
                    }
                }
            }
        })
        self.assertEqual(_tiktok_hydration_candidates(payload), [
            ("https://video.example/play", "video/mp4", 220),
            ("https://audio.example/sound", "audio/mpeg", 210),
            ("https://video.example/download", "video/mp4", 200),
        ])

    def test_invalid_tiktok_hydration_is_ignored(self):
        self.assertEqual(_tiktok_hydration_candidates("<html>login</html>"), [])

    def test_extracts_hydration_script_from_public_ssr_html(self):
        payload = '{"itemStruct":{"video":{"playAddr":"https://cdn.example/video"}}}'
        page = f'<html><script type="application/json" id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{payload}</script></html>'
        self.assertEqual(_tiktok_hydration_payload_from_html(page), payload)

    def test_ignores_unrelated_or_oversized_ssr_html(self):
        self.assertIsNone(_tiktok_hydration_payload_from_html("<html>login</html>"))
        with patch("app.extractors.MAX_SSR_PAGE_BYTES", 10):
            self.assertIsNone(_tiktok_hydration_payload_from_html("<html>too large</html>"))

    def test_added_tiktok_music_is_not_used_as_the_video_voice_track(self):
        payload = json.dumps({"scope": {"itemStruct": {
            "video": {
                "playAddr": "https://video.example/play",
                "downloadAddr": "https://video.example/download",
                "duration": 30,
            },
            "music": {
                "playUrl": "https://audio.example/commercial-song",
                "title": "Popular song",
                "authorName": "Unrelated artist",
                "duration": 30,
            },
            "author": {"uniqueId": "video_creator"},
        }}})
        candidates = _tiktok_hydration_candidates(payload)
        self.assertNotIn(
            ("https://audio.example/commercial-song", "audio/mpeg", 210),
            candidates,
        )

    async def test_browser_download_reuses_session_headers_and_writes_a_local_media_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            opener = FakeResponseOpener(FakeHttpResponse(
                200,
                headers={"content-type": "video/mp4"},
                chunks=[b"public-video"],
            ))

            with patch("app.extractors.assert_public_hostname"):
                source, content_type = await download_browser_media(
                    "https://cdn.example/video/tos/file.mp4",
                    Path(temporary),
                    {"User-Agent": "Miqdar", "Referer": "https://www.tiktok.com/"},
                    open_response=opener,
                )
            self.assertEqual(source.read_bytes(), b"public-video")
            self.assertEqual(source.suffix, ".mp4")
            self.assertEqual(content_type, "video/mp4")
            self.assertEqual(opener.requests[0][1]["Referer"], "https://www.tiktok.com/")

    async def test_browser_download_checks_every_redirect_before_following_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            opener = FakeResponseOpener(
                FakeHttpResponse(302, headers={"location": "/final.mp4"}),
                FakeHttpResponse(
                    200,
                    headers={"content-type": "video/mp4"},
                    chunks=[b"redirected-video"],
                ),
            )

            with patch("app.extractors.assert_public_hostname") as hostname_check:
                source, _ = await download_browser_media(
                    "https://cdn.example/start",
                    Path(temporary),
                    {"User-Agent": "Miqdar"},
                    open_response=opener,
                )
            self.assertEqual(source.read_bytes(), b"redirected-video")
            self.assertEqual([request[0] for request in opener.requests], [
                "https://cdn.example/start",
                "https://cdn.example/final.mp4",
            ])
            self.assertEqual(hostname_check.call_count, 2)

    async def test_browser_download_reports_a_forbidden_signed_media_url(self):
        with tempfile.TemporaryDirectory() as temporary:
            opener = FakeResponseOpener(FakeHttpResponse(403, chunks=[b"denied"]))
            with patch("app.extractors.assert_public_hostname"):
                with self.assertRaises(ExtractionError) as raised:
                    await download_browser_media(
                        "https://cdn.example/signed.mp4",
                        Path(temporary),
                        {"User-Agent": "Miqdar"},
                        open_response=opener,
                    )
            self.assertEqual(raised.exception.code, "browser_media_forbidden")

    async def test_browser_download_rejects_an_html_access_denied_with_status_200(self):
        with tempfile.TemporaryDirectory() as temporary:
            opener = FakeResponseOpener(FakeHttpResponse(
                200,
                headers={"content-type": "video/mp4"},
                chunks=[b"<HTML><TITLE>Access Denied</TITLE></HTML>"],
            ))
            with patch("app.extractors.assert_public_hostname"):
                with self.assertRaises(ExtractionError) as raised:
                    await download_browser_media(
                        "https://cdn.example/signed.mp4",
                        Path(temporary),
                        {"User-Agent": "Miqdar"},
                        open_response=opener,
                    )
            self.assertEqual(raised.exception.code, "browser_media_invalid_payload")
            self.assertFalse((Path(temporary) / "source-browser.mp4").exists())

    async def test_browser_download_rejects_json_disguised_as_media(self):
        with tempfile.TemporaryDirectory() as temporary:
            opener = FakeResponseOpener(FakeHttpResponse(
                200,
                headers={"content-type": "application/octet-stream"},
                chunks=[b'{"status":"blocked"}'],
            ))
            with patch("app.extractors.assert_public_hostname"):
                with self.assertRaises(ExtractionError) as raised:
                    await download_browser_media(
                        "https://cdn.example/video?id=123",
                        Path(temporary),
                        {"User-Agent": "Miqdar"},
                        open_response=opener,
                    )
            self.assertEqual(raised.exception.code, "browser_media_invalid_payload")

    async def test_observed_chromium_response_is_reused_without_a_second_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            response = FakeAsyncHttpResponse(
                206,
                headers={"content-type": "video/mp4"},
                payload=b"\x00\x00\x00\x18ftypisompublic-video",
            )
            source, content_type = await download_observed_browser_media(
                "https://cdn.example/video?id=123",
                response,
                Path(temporary),
            )
            self.assertEqual(content_type, "video/mp4")
            self.assertEqual(source.read_bytes(), response.payload)

    async def test_playwright_request_shares_headers_and_rejects_html(self):
        with tempfile.TemporaryDirectory() as temporary:
            response = FakeAsyncHttpResponse(
                200,
                headers={"content-type": "video/mp4"},
                payload=b"<html><body>Access Denied</body></html>",
            )
            request_context = FakeRequestContext(response)
            with self.assertRaises(ExtractionError) as raised:
                await download_browser_media_with_context(
                    "https://cdn.example/video?id=123",
                    Path(temporary),
                    {"User-Agent": "Chromium", "Cookie": "session=ok"},
                    request_context,
                )
            self.assertEqual(raised.exception.code, "browser_media_invalid_payload")
            self.assertEqual(request_context.requests[0][1]["headers"]["Cookie"], "session=ok")
            self.assertIn("Range", request_context.requests[0][1]["headers"])
            self.assertTrue(response.disposed)

    async def test_browser_download_stops_while_streaming_past_the_size_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            opener = FakeResponseOpener(FakeHttpResponse(
                200,
                headers={"content-type": "video/mp4"},
                chunks=[b"x" * 6, b"x" * 5],
            ))
            with patch("app.extractors.assert_public_hostname"), patch("app.extractors.MAX_SOURCE_BYTES", 10):
                with self.assertRaises(ExtractionError) as raised:
                    await download_browser_media(
                        "https://cdn.example/large.mp4",
                        Path(temporary),
                        {"User-Agent": "Miqdar"},
                        open_response=opener,
                    )
            self.assertEqual(raised.exception.code, "media_too_large")
            self.assertFalse((Path(temporary) / "source-browser.mp4").exists())


class ChromiumBrowserPoolTests(unittest.IsolatedAsyncioTestCase):
    async def test_reuses_one_browser_with_an_isolated_context_per_extraction(self):
        class FakeContext:
            def __init__(self, number):
                self.number = number

        class FakeBrowser:
            def __init__(self):
                self.contexts = []
                self.closed = False

            def is_connected(self):
                return not self.closed

            async def new_context(self, **_options):
                context = FakeContext(len(self.contexts) + 1)
                self.contexts.append(context)
                return context

            async def close(self):
                self.closed = True

        class FakeChromium:
            def __init__(self, browser):
                self.browser = browser
                self.launches = 0

            async def launch(self, **_options):
                self.launches += 1
                return self.browser

        class FakePlaywright:
            def __init__(self, chromium):
                self.chromium = chromium
                self.stops = 0

            async def stop(self):
                self.stops += 1

        class FakeManager:
            def __init__(self, playwright):
                self.playwright = playwright

            async def start(self):
                return self.playwright

        browser = FakeBrowser()
        chromium = FakeChromium(browser)
        playwright = FakePlaywright(chromium)
        pool = ChromiumBrowserPool(lambda: FakeManager(playwright))

        first = await pool.new_context()
        second = await pool.new_context()
        self.assertNotEqual(first.number, second.number)
        self.assertEqual(chromium.launches, 1)
        self.assertEqual(len(browser.contexts), 2)

        await pool.close()
        self.assertTrue(browser.closed)
        self.assertEqual(playwright.stops, 1)


class FallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_tiktok_uses_public_ssr_before_chromium(self):
        with tempfile.TemporaryDirectory() as temporary:
            expected = ExtractedAudio(Path(temporary) / "audio.m4a", "tiktok-ssr")
            ssr = FakeExtractor(result=expected)
            direct = FakeExtractor(result=ExtractedAudio(Path(temporary) / "direct.wav", "yt-dlp"))
            browser = FakeExtractor(result=ExtractedAudio(Path(temporary) / "browser.wav", "chromium"))
            result = await extract_with_fallback(
                "https://vm.tiktok.com/example/",
                Path(temporary),
                direct_extractor=direct,
                browser_extractor=browser,
                ssr_extractor=ssr,
            )
            self.assertEqual(result, expected)
            self.assertEqual(ssr.calls, 1)
            self.assertEqual(browser.calls, 0)
            self.assertEqual(direct.calls, 0)

    async def test_retryable_ssr_failure_falls_back_to_chromium(self):
        with tempfile.TemporaryDirectory() as temporary:
            expected = ExtractedAudio(Path(temporary) / "browser.wav", "chromium")
            ssr = FakeExtractor(error=ExtractionError("ssr_media_not_found", retryable=True))
            direct = FakeExtractor(result=ExtractedAudio(Path(temporary) / "direct.wav", "yt-dlp"))
            browser = FakeExtractor(result=expected)
            result = await extract_with_fallback(
                "https://vm.tiktok.com/example/",
                Path(temporary),
                direct_extractor=direct,
                browser_extractor=browser,
                ssr_extractor=ssr,
            )
            self.assertEqual(result, expected)
            self.assertEqual(ssr.calls, 1)
            self.assertEqual(browser.calls, 1)
            self.assertEqual(direct.calls, 0)

    async def test_tiktok_uses_chromium_first(self):
        with tempfile.TemporaryDirectory() as temporary:
            expected = ExtractedAudio(Path(temporary) / "audio.wav", "chromium")
            direct = FakeExtractor(result=ExtractedAudio(Path(temporary) / "direct.wav", "yt-dlp"))
            browser = FakeExtractor(result=expected)
            result = await extract_with_fallback(
                "https://vm.tiktok.com/example/",
                Path(temporary),
                direct_extractor=direct,
                browser_extractor=browser,
            )
            self.assertEqual(result, expected)
            self.assertEqual(direct.calls, 0)
            self.assertEqual(browser.calls, 1)

    async def test_tiktok_uses_yt_dlp_after_a_retryable_chromium_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            expected = ExtractedAudio(Path(temporary) / "audio.wav", "yt-dlp")
            direct = FakeExtractor(result=expected)
            browser = FakeExtractor(error=ExtractionError("browser_media_invalid_payload", retryable=True))
            result = await extract_with_fallback(
                "https://vm.tiktok.com/example/",
                Path(temporary),
                direct_extractor=direct,
                browser_extractor=browser,
            )
            self.assertEqual(result, expected)
            self.assertEqual(browser.calls, 1)
            self.assertEqual(direct.calls, 1)

    async def test_does_not_bypass_duration_limits_with_chromium(self):
        with tempfile.TemporaryDirectory() as temporary:
            direct = FakeExtractor(result=ExtractedAudio(Path(temporary) / "audio.wav", "yt-dlp"))
            browser = FakeExtractor(error=ExtractionError("media_too_long", status=413))
            with self.assertRaisesRegex(ExtractionError, "media_too_long"):
                await extract_with_fallback(
                    "https://www.tiktok.com/@example/video/123",
                    Path(temporary),
                    direct_extractor=direct,
                    browser_extractor=browser,
                )
            self.assertEqual(browser.calls, 1)
            self.assertEqual(direct.calls, 0)

    async def test_chromium_failure_still_tries_yt_dlp(self):
        with tempfile.TemporaryDirectory() as temporary:
            expected = ExtractedAudio(Path(temporary) / "audio.wav", "yt-dlp")
            direct = FakeExtractor(result=expected)
            browser = FakeExtractor(error=ExtractionError("browser_media_not_found"))
            result = await extract_with_fallback(
                "https://vm.tiktok.com/example/",
                Path(temporary),
                direct_extractor=direct,
                browser_extractor=browser,
            )
            self.assertEqual(result, expected)
            self.assertEqual(browser.calls, 1)
            self.assertEqual(direct.calls, 1)

    async def test_reports_both_attempts_when_every_method_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            direct = FakeExtractor(error=ExtractionError("media_unavailable", status=404))
            browser = FakeExtractor(error=ExtractionError("browser_media_not_found"))
            with self.assertRaises(ExtractionError) as raised:
                await extract_with_fallback(
                    "https://vm.tiktok.com/example/",
                    Path(temporary),
                    direct_extractor=direct,
                    browser_extractor=browser,
                )
            self.assertEqual(raised.exception.attempted_methods, ("chromium", "yt-dlp"))
            self.assertEqual(raised.exception.last_failure, "browser_media_not_found")
            self.assertEqual(raised.exception.direct_failure, "media_unavailable")


if __name__ == "__main__":
    unittest.main()
