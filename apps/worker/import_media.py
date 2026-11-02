"""Explicit image import from public HTTPS or authorized Drive into a private registry.

No browser, platform submission, approval or backend write. TLS/DNS are pinned
per request; private networks, proxies, unbounded redirects and token forwarding
are forbidden. Downloaded bytes still require human rights/privacy review.
"""

import argparse
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import time
from urllib.parse import quote, urljoin, urlsplit
from uuid import uuid4

from publishing_media import MIMES, read_image
from stage_media import stage

MAX_BYTES = 8 * 1024 * 1024


def public_ip(value):
    ip = ipaddress.ip_address(value)
    if not ip.is_global or ip.is_multicast or ip.is_unspecified or ip.is_reserved or ip.is_loopback or ip.is_link_local:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped or ip.sixtofour or ip.teredo or ip not in ipaddress.ip_network("2000::/3"):
            return False
    return True


def source_target(url, resolver=socket.getaddrinfo):
    if not isinstance(url, str) or len(url) > 4096 or any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise ValueError("Invalid HTTPS media source")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in {None, 443} or parsed.fragment:
        raise ValueError("Only credential-free public HTTPS media origins on port 443 are supported")
    host = parsed.hostname.encode("idna").decode("ascii").lower()
    records = resolver(host, 443, type=socket.SOCK_STREAM)
    addresses = sorted({item[4][0] for item in records})
    if not addresses or any(not public_ip(address) for address in addresses):
        raise ValueError("All resolved media addresses must be public unicast addresses")
    path = quote(parsed.path or "/", safe="/%:@!$&'()*+,;=-._~")
    if parsed.query:
        path += "?" + quote(parsed.query, safe="%:@!$&'()*+,;=/?-._~")
    return host, addresses[0], path


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address):
        self.address = address
        self.tls_context = ssl.create_default_context()
        super().__init__(host, 443, timeout=20, context=self.tls_context)

    def connect(self):
        # Do NOT resolve the hostname again when opening the socket. Cert/SNI
        # validation remains pinned to the original hostname, not the IP string.
        sock = socket.create_connection((self.address, 443), timeout=self.timeout)
        try:
            self.sock = self.tls_context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def fetch_image(url, drive_token=None, resolver=socket.getaddrinfo, connection_factory=PinnedHTTPS):
    current = url
    deadline = time.monotonic() + 60
    if drive_token is not None and (not isinstance(drive_token, str) or not 20 <= len(drive_token) <= 8192 or any(c.isspace() for c in drive_token)):
        raise ValueError("Use a private authorized Drive access token, not a password")
    for redirect in range(4):
        if time.monotonic() >= deadline:
            raise ValueError("Media download budget exhausted")
        host, address, path = source_target(current, resolver)
        headers = {"Accept": "image/jpeg,image/png,image/webp,application/octet-stream", "Accept-Encoding": "identity"}
        if drive_token is not None:
            if host != "www.googleapis.com" or not re.fullmatch(r"/drive/v3/files/[A-Za-z0-9_-]+\?alt=media", path):
                raise ValueError("Drive credentials may be sent only to the exact supported Google download endpoint")
            headers["Authorization"] = "Bearer " + drive_token
        connection = connection_factory(host, address)
        try:
            connection.request("GET", path, headers=headers)
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                if drive_token is not None or redirect == 3:
                    raise ValueError("Authenticated redirects or excessive redirect chains are not supported")
                location = response.getheader("Location")
                if not location:
                    raise ValueError("A redirect destination is required")
                current = urljoin(current, location)
                continue
            if response.status != 200 or response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise ValueError("Media download was not a complete uncompressed success")
            kind = response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
            if kind not in set(MIMES) | {"application/octet-stream"}:
                raise ValueError("The source did not return a supported binary image")
            length = response.getheader("Content-Length")
            if length is not None and (not re.fullmatch(r"[0-9]+", length) or not 1 <= int(length) <= MAX_BYTES):
                raise ValueError("Media content length exceeds its bound")
            chunks, size = [], 0
            while size <= MAX_BYTES:
                if time.monotonic() >= deadline:
                    raise ValueError("Media download budget exhausted")
                chunk = response.read1(min(65536, MAX_BYTES + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk); size += len(chunk)
            data = b"".join(chunks)
            if not 1 <= len(data) <= MAX_BYTES or (length is not None and len(data) != int(length)):
                raise ValueError("Media download was oversized or incomplete")
            return data, kind
        finally:
            connection.close()
    raise ValueError("No bounded image response")


def import_source(url, registry_path, object_directory, rights=False, privacy=False, drive_token=None, **transport):
    if rights is not True or privacy is not True:
        raise ValueError("Explicit rights and privacy/metadata review are required before import")
    directory = Path(object_directory)
    if not directory.is_absolute() or any(parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()) for parent in [directory, *directory.parents]):
        raise ValueError("Choose an ordinary private absolute local asset directory")
    data, declared = fetch_image(url, drive_token, **transport)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = directory / (str(uuid4()) + ".download")
    final = None
    temporary_created, final_created = False, False
    try:
        with temporary.open("xb") as stream:
            temporary_created = True
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        _verified, mime = read_image(temporary)
        if declared != "application/octet-stream" and declared != mime:
            raise ValueError("The downloaded image signature and advertised MIME type differ")
        final = directory / (str(uuid4()) + MIMES[mime])
        # Exclusive creation, never overwrite or delete an unrelated local file.
        with final.open("xb") as stream:
            final_created = True
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        result = stage([final], registry_path, rights=True, privacy=True)
        final = None  # The successfully registered object belongs to the operator.
        return result
    finally:
        if temporary_created:
            temporary.unlink(missing_ok=True)
        if final is not None and final_created:
            final.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url")
    source.add_argument("--drive-id")
    parser.add_argument("--drive-token-env", default="ND_DRIVE_ACCESS_TOKEN")
    parser.add_argument("--registry", required=True)
    parser.add_argument("--object-directory", required=True)
    parser.add_argument("--confirm-rights", action="store_true")
    parser.add_argument("--confirm-privacy", action="store_true")
    args = parser.parse_args()
    try:
        token = None
        if args.drive_id:
            if not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", args.drive_id):
                raise ValueError("Invalid Drive file identity")
            token = os.environ.get(args.drive_token_env)
            if not token:
                raise ValueError("Private authorized Drive access is required")
        url = "https://www.googleapis.com/drive/v3/files/" + args.drive_id + "?alt=media" if args.drive_id else args.url
        print(json.dumps(import_source(url, args.registry, args.object_directory, args.confirm_rights, args.confirm_privacy, token)))
        return 0
    except (ValueError, TypeError, OSError, RuntimeError, http.client.HTTPException):
        print(json.dumps({"state": "blocked", "message": "Image import was refused or unconfirmed. Check authorization, public HTTPS transport, size/type and private storage. URLs, paths, tokens and raw errors are withheld; no upload or approval occurred."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
