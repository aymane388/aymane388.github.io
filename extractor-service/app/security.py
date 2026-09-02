from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Iterable
from urllib.parse import SplitResult, urlsplit, urlunsplit


MAX_SOURCE_URL_LENGTH = 2_048
ALLOWED_SOURCE_HOSTS = {
    "tiktok.com",
    "www.tiktok.com",
    "m.tiktok.com",
    "vm.tiktok.com",
    "vt.tiktok.com",
}


class UnsafeUrl(ValueError):
    """Raised when a URL could make the extractor access an unsafe target."""


def _clean_split_url(value: str, *, max_length: int) -> SplitResult:
    candidate = value.strip()
    if not candidate or len(candidate) > max_length:
        raise UnsafeUrl("invalid_url")
    try:
        parsed = urlsplit(candidate)
    except ValueError as error:
        raise UnsafeUrl("invalid_url") from error
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise UnsafeUrl("https_required")
    if parsed.username or parsed.password:
        raise UnsafeUrl("credentials_forbidden")
    try:
        port = parsed.port
    except ValueError as error:
        raise UnsafeUrl("invalid_port") from error
    if port not in (None, 443):
        raise UnsafeUrl("invalid_port")
    return parsed


def normalize_source_url(value: str) -> str:
    parsed = _clean_split_url(value, max_length=MAX_SOURCE_URL_LENGTH)
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname not in ALLOWED_SOURCE_HOSTS:
        raise UnsafeUrl("unsupported_host")
    netloc = hostname if parsed.port is None else f"{hostname}:{parsed.port}"
    return urlunsplit(("https", netloc, parsed.path or "/", parsed.query, ""))


def normalize_public_media_url(value: str) -> str:
    parsed = _clean_split_url(value, max_length=4_096)
    hostname = parsed.hostname.lower().rstrip(".")
    netloc = hostname if parsed.port is None else f"{hostname}:{parsed.port}"
    return urlunsplit(("https", netloc, parsed.path or "/", parsed.query, ""))


def _is_public_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


Resolver = Callable[..., Iterable[tuple[object, object, object, object, tuple[object, ...]]]]


def assert_public_hostname(hostname: str, resolver: Resolver = socket.getaddrinfo) -> None:
    try:
        records = list(resolver(hostname, 443, type=socket.SOCK_STREAM))
    except OSError as error:
        raise UnsafeUrl("host_unreachable") from error
    addresses = {str(record[4][0]) for record in records if record[4]}
    if not addresses or any(not _is_public_ip(address) for address in addresses):
        raise UnsafeUrl("private_network_forbidden")
