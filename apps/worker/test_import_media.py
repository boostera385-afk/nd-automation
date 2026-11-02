import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from import_media import fetch_image, import_source, public_ip, source_target
from test_publishing_media import PNG


def resolver(host, port, **_kwargs):
    return [(2, 1, 6, "", ("127.0.0.1" if host == "internal.invalid" else "8.8.8.8", port))]


class Reply(io.BytesIO):
    def __init__(self, data=PNG, status=200, headers=None):
        super().__init__(data)
        self.status = status
        self.headers = {"Content-Type": "image/png", "Content-Length": str(len(data)), **(headers or {})}

    def getheader(self, name, default=None):
        return self.headers.get(name, default)


class Connections:
    def __init__(self, replies):
        self.replies = iter(replies)
        self.requests, self.closed = [], 0

    def __call__(self, host, address):
        owner = self
        class Connection:
            def request(self, method, path, headers):
                owner.requests.append((host, address, method, path, headers))

            def getresponse(self):
                return next(owner.replies)

            def close(self):
                owner.closed += 1
        return Connection()


class ImportMediaTests(unittest.TestCase):
    def test_rejects_private_local_multicast_translated_and_reserved_addresses(self):
        for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "224.0.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "64:ff9b::a00:1"):
            self.assertFalse(public_ip(address), address)
        self.assertTrue(public_ip("8.8.8.8"))
        self.assertTrue(public_ip("2607:f8b0:4005:805::200e"))

    def test_resolved_address_is_pinned_not_re_resolved_during_connection(self):
        transport = Connections([Reply()])
        data, kind = fetch_image("https://images.invalid/picture.png", resolver=resolver, connection_factory=transport)
        self.assertEqual(data, PNG); self.assertEqual(kind, "image/png")
        self.assertEqual(transport.requests[0][:3], ("images.invalid", "8.8.8.8", "GET"))
        self.assertEqual(transport.closed, 1)

    def test_url_credentials_ports_fragments_controls_and_http_are_refused(self):
        for url in ("http://images.invalid/p.png", "https://user:pass@images.invalid/p.png", "https://images.invalid:8443/p.png", "https://images.invalid/p.png#secret", "https://images.invalid/a\nb"):
            with self.assertRaises(ValueError):
                source_target(url, resolver)

    def test_dns_must_not_mix_public_and_private_addresses(self):
        def mixed(*args, **kwargs):
            return resolver(*args, **kwargs) + [(2, 1, 6, "", ("10.0.0.1", 443))]
        with self.assertRaises(ValueError):
            source_target("https://images.invalid/p.png", mixed)

    def test_every_redirect_is_revalidated_and_cannot_reach_private_networks(self):
        transport = Connections([Reply(status=302, headers={"Location": "https://internal.invalid/private.png"})])
        with self.assertRaises(ValueError):
            fetch_image("https://images.invalid/p.png", resolver=resolver, connection_factory=transport)
        self.assertEqual(len(transport.requests), 1)

    def test_redirects_are_bounded_and_only_https_is_followed(self):
        transport = Connections([Reply(status=302, headers={"Location": "/again.png"}) for _ in range(4)])
        with self.assertRaises(ValueError):
            fetch_image("https://images.invalid/p.png", resolver=resolver, connection_factory=transport)
        self.assertEqual(len(transport.requests), 4)

    def test_drive_token_is_pinned_to_the_exact_google_api_and_never_forwarded(self):
        token = "private-fixture-drive-token"
        transport = Connections([Reply(status=302, headers={"Location": "https://images.invalid/p.png"})])
        with self.assertRaises(ValueError):
            fetch_image("https://www.googleapis.com/drive/v3/files/fixture_file_id?alt=media", token, resolver, transport)
        self.assertEqual(len(transport.requests), 1)
        self.assertEqual(transport.requests[0][4]["Authorization"], "Bearer " + token)
        with self.assertRaises(ValueError):
            fetch_image("https://images.invalid/p.png", token, resolver, Connections([]))

    def test_html_compression_partial_and_oversized_responses_are_refused(self):
        for reply in (Reply(headers={"Content-Type": "text/html"}), Reply(headers={"Content-Encoding": "gzip"}), Reply(status=206), Reply(headers={"Content-Length": "8388609"})):
            with self.assertRaises(ValueError):
                fetch_image("https://images.invalid/p.png", resolver=resolver, connection_factory=Connections([reply]))

    def test_import_validates_bytes_and_registers_without_storing_url_or_token(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); registry = root / "private" / "registry.json"; objects = root / "objects"
            result = import_source("https://images.invalid/p.png?private-query=fixture", registry, objects, True, True,
                                   resolver=resolver, connection_factory=Connections([Reply()]))
            self.assertEqual(len(result), 1)
            self.assertNotIn("private-query", json.dumps(result) + registry.read_text())
            self.assertEqual([path.suffix for path in objects.iterdir()], [".png"])

    def test_storage_failure_cleans_only_its_new_downloads(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); objects = root / "objects"; objects.mkdir()
            unrelated = objects / "keep.txt"; unrelated.write_text("operator work")
            with patch("import_media.stage", side_effect=OSError("disk")):
                with self.assertRaises(OSError):
                    import_source("https://images.invalid/p.png", root / "registry.json", objects, True, True,
                                  resolver=resolver, connection_factory=Connections([Reply()]))
            self.assertEqual(list(objects.iterdir()), [unrelated]); self.assertEqual(unrelated.read_text(), "operator work")

    def test_rights_and_privacy_are_required_before_any_download(self):
        with patch("import_media.fetch_image") as fetch:
            with self.assertRaises(ValueError):
                import_source("https://images.invalid/p.png", "registry.json", "objects", False, True)
            fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
