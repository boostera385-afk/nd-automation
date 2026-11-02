"""Approved media metadata and local-byte validation. No URL download or storage API."""

import hashlib
import os
from pathlib import Path
import re
import stat
from uuid import UUID

MIMES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
DESCRIPTOR_KEYS = {"id", "sha256", "bytes", "mime", "name", "rightsConfirmed", "privacyReviewed"}


def bounded_dimensions(width, height):
    if not 1 <= width <= 12000 or not 1 <= height <= 12000 or width * height > 40000000:
        raise ValueError("Image dimensions exceed the supported safety bound")


def jpeg_dimensions(data):
    cursor = 2
    while cursor + 4 <= len(data):
        if data[cursor] != 255:
            break
        while cursor < len(data) and data[cursor] == 255:
            cursor += 1
        if cursor >= len(data):
            break
        marker = data[cursor]; cursor += 1
        if marker in {1, *range(208, 217)}:
            continue
        if marker in {217, 218} or cursor + 2 > len(data):
            break
        length = int.from_bytes(data[cursor:cursor + 2], "big")
        if length < 2 or cursor + length > len(data):
            break
        if marker in {192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207} and length >= 8:
            return int.from_bytes(data[cursor + 5:cursor + 7], "big"), int.from_bytes(data[cursor + 3:cursor + 5], "big")
        cursor += length
    raise ValueError("JPEG dimensions could not be verified")


def webp_dimensions(data):
    cursor = 12
    while cursor + 8 <= len(data):
        kind = data[cursor:cursor + 4]
        length = int.from_bytes(data[cursor + 4:cursor + 8], "little")
        payload = data[cursor + 8:cursor + 8 + length]
        if len(payload) != length:
            break
        if kind == b"VP8X" and length == 10:
            if payload[0] & 2:
                raise ValueError("Animated media is not supported")
            return int.from_bytes(payload[4:7], "little") + 1, int.from_bytes(payload[7:10], "little") + 1
        if kind == b"VP8 " and length >= 10 and payload[3:6] == b"\x9d\x01\x2a":
            return int.from_bytes(payload[6:8], "little") & 16383, int.from_bytes(payload[8:10], "little") & 16383
        if kind == b"VP8L" and length >= 5 and payload[0] == 47:
            bits = int.from_bytes(payload[1:5], "little")
            return (bits & 16383) + 1, ((bits >> 14) & 16383) + 1
        cursor += 8 + length + length % 2
    raise ValueError("Static WebP dimensions could not be verified")


def check_png_chunks(data):
    cursor = 8
    while cursor + 12 <= len(data):
        length = int.from_bytes(data[cursor:cursor + 4], "big")
        kind = data[cursor + 4:cursor + 8]
        end = cursor + 12 + length
        if end > len(data) or kind == b"acTL":
            raise ValueError("Malformed or animated PNG is not supported")
        if kind == b"IEND":
            if length != 0 or end != len(data):
                raise ValueError("Unexpected trailing PNG bytes")
            return
        cursor = end
    raise ValueError("PNG termination could not be verified")


def validate_media(value):
    if not isinstance(value, list) or len(value) > 10:
        raise ValueError("At most ten explicitly approved images are supported")
    ids, total = set(), 0
    for item in value:
        if not isinstance(item, dict) or set(item) != DESCRIPTOR_KEYS:
            raise ValueError("Unexpected approved media metadata")
        identity = item["id"]
        if not isinstance(identity, str) or str(UUID(identity)) != identity or UUID(identity).version not in range(1, 9):
            raise ValueError("A canonical media UUID is required")
        if identity in ids or not isinstance(item["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]):
            raise ValueError("Duplicate media identity or invalid SHA-256")
        ids.add(identity)
        if type(item["bytes"]) is not int or not 1 <= item["bytes"] <= 8 * 1024 * 1024:
            raise ValueError("An approved image must be bounded to 8 MiB")
        total += item["bytes"]
        if (not isinstance(item["mime"], str) or item["mime"] not in MIMES or not isinstance(item["name"], str) or
                not re.fullmatch(r"[A-Za-z0-9_-]{1,80}\.(jpg|png|webp)", item["name"]) or
                not item["name"].endswith(MIMES[item["mime"]]) or
                item["rightsConfirmed"] is not True or item["privacyReviewed"] is not True):
            raise ValueError("Supported image type and explicit rights/privacy review are required")
    if total > 30 * 1024 * 1024:
        raise ValueError("Total media exceeds 30 MiB")
    return value


def validate_registry(value):
    if not isinstance(value, dict) or set(value) != {"version", "assets"} or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Invalid private local media registry")
    assets = value["assets"]
    if not isinstance(assets, dict) or len(assets) > 500:
        raise ValueError("Local media registry exceeds its bound")
    for key, path in assets.items():
        if not isinstance(key, str) or str(UUID(key)) != key or not isinstance(path, str) or not Path(path).is_absolute() or len(path) > 4096 or "\0" in path:
            raise ValueError("Registry entries require exact UUIDs and private absolute local file paths")
    return value


def read_image(path):
    path = Path(path)
    if not path.is_absolute() or any(parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()) for parent in [path, *path.parents]):
        raise ValueError("Media must be an ordinary explicitly registered local file")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or not 1 <= before.st_size <= 8 * 1024 * 1024:
            raise ValueError("Local image is not a bounded ordinary file")
        data = stream.read(8 * 1024 * 1024 + 1)
        after = os.fstat(stream.fileno())
        if len(data) != before.st_size or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("Local image changed while it was read")
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 33 and data[12:16] == b"IHDR":
        check_png_chunks(data)
        width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        bounded_dimensions(width, height)
        mime = "image/png"
    elif data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"):
        bounded_dimensions(*jpeg_dimensions(data))
        mime = "image/jpeg"
    elif len(data) >= 20 and data[:4] == b"RIFF" and data[8:12] == b"WEBP" and int.from_bytes(data[4:8], "little") + 8 == len(data):
        bounded_dimensions(*webp_dimensions(data))
        mime = "image/webp"
    else:
        raise ValueError("Bytes do not match a supported image signature")
    # Signature checks are not a complete image decoder, malware scanner or EXIF
    # scrubber. Rights/privacy/metadata review remains an explicit human duty.
    return data, mime


def prepare_media(descriptors, registry):
    validate_media(descriptors)
    validate_registry(registry)
    payloads = []
    for item in descriptors:
        path = registry["assets"].get(item["id"])
        if path is None:
            raise ValueError("An approved asset is not registered on this device")
        data, mime = read_image(path)
        if mime != item["mime"] or len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("Local media differs from its immutable approved fingerprint")
        payloads.append({"name": item["name"], "mimeType": mime, "buffer": data})
    # In-memory FilePayloads prevent file-path TOCTOU and leave no temporary
    # uploaded copies to delete. Originals are never modified or removed.
    return payloads
