from __future__ import annotations

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.security import UnsafeUrl, assert_public_hostname, normalize_public_media_url, normalize_source_url


def public_resolver(*_args, **_kwargs):
    return [(None, None, None, None, ("1.1.1.1", 443))]


def private_resolver(*_args, **_kwargs):
    return [(None, None, None, None, ("127.0.0.1", 443))]


class SourceUrlSecurityTests(unittest.TestCase):
    def test_accepts_tiktok_share_hosts_and_removes_fragment(self):
        self.assertEqual(
            normalize_source_url("https://vm.tiktok.com/ZM-example/#tracking"),
            "https://vm.tiktok.com/ZM-example/",
        )

    def test_rejects_non_tiktok_and_suffix_confusion(self):
        for url in ("https://example.com/video", "https://tiktok.com.evil.example/video"):
            with self.assertRaises(UnsafeUrl):
                normalize_source_url(url)

    def test_rejects_http_credentials_and_custom_ports(self):
        for url in (
            "http://www.tiktok.com/video/1",
            "https://user:pass@www.tiktok.com/video/1",
            "https://www.tiktok.com:8443/video/1",
        ):
            with self.assertRaises(UnsafeUrl):
                normalize_source_url(url)

    def test_blocks_private_network_addresses(self):
        assert_public_hostname("cdn.example", public_resolver)
        with self.assertRaises(UnsafeUrl):
            assert_public_hostname("cdn.example", private_resolver)

    def test_media_candidates_must_remain_https(self):
        self.assertEqual(
            normalize_public_media_url("https://cdn.example/video.mp4#fragment"),
            "https://cdn.example/video.mp4",
        )
        with self.assertRaises(UnsafeUrl):
            normalize_public_media_url("http://cdn.example/video.mp4")


if __name__ == "__main__":
    unittest.main()
