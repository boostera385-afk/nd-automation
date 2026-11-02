import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from publishing_media import prepare_media, read_image, validate_media, validate_registry
from stage_media import stage
import test_publisher as fixtures

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRk0AAAAASUVORK5CYII=")


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.image = Path(self.temp.name) / "customer-private-original.png"
        self.image.write_bytes(PNG)
        self.registry_path = Path(self.temp.name) / "private" / "registry.json"

    def registered(self):
        values = stage([self.image], self.registry_path, rights=True, privacy=True)
        registry = json.loads(self.registry_path.read_text())
        return values, registry

    def test_staging_is_offline_non_destructive_and_never_prints_private_paths(self):
        values, registry = self.registered()
        self.assertEqual(self.image.read_bytes(), PNG)
        self.assertNotIn("customer-private", json.dumps(values))
        self.assertEqual(values[0]["sha256"], hashlib.sha256(PNG).hexdigest())
        self.assertEqual(set(registry["assets"]), {values[0]["id"]})

    def test_explicit_rights_and_privacy_are_required_before_registry_writes(self):
        for rights, privacy in ((False, True), (True, False), (True, 1)):
            with self.assertRaises(ValueError):
                stage([self.image], self.registry_path, rights, privacy)
        self.assertFalse(self.registry_path.exists())

    def test_local_byte_payload_matches_exact_approved_order_and_fingerprint(self):
        values, registry = self.registered()
        self.assertEqual(prepare_media(values, registry), [{"name": values[0]["name"], "mimeType": "image/png", "buffer": PNG}])
        self.assertEqual(set(self.registry_path.parent.iterdir()), {self.registry_path, self.registry_path.with_suffix(".lock")})

    def test_changed_local_file_never_silently_uses_new_bytes(self):
        values, registry = self.registered()
        self.image.write_bytes(PNG + b"changed")
        with self.assertRaises(ValueError):
            prepare_media(values, registry)

    def test_unregistered_image_never_downloads_or_guesses_a_path(self):
        values, _registry = self.registered()
        with self.assertRaises(ValueError):
            prepare_media(values, {"version": 1, "assets": {}})

    def test_wrong_hash_size_type_or_permission_is_refused(self):
        values, registry = self.registered()
        for key, value in (("sha256", "0" * 64), ("bytes", len(PNG) + 1), ("mime", "image/jpeg"), ("rightsConfirmed", False), ("privacyReviewed", False)):
            modified = deepcopy(values); modified[0][key] = value
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    prepare_media(modified, registry)

    def test_arbitrary_paths_urls_keys_and_duplicate_ids_cannot_enter_descriptors(self):
        values, _registry = self.registered()
        for extra in ({"path": str(self.image)}, {"url": "https://private.invalid/image"}, {"bytes": True}, {"mime": {}}, {"name": "../escape.png"}):
            item = {**values[0], **extra}
            with self.assertRaises(ValueError):
                validate_media([item])
        with self.assertRaises(ValueError):
            validate_media(values * 2)

    def test_registry_is_strict_and_does_not_accept_remote_urls(self):
        values, registry = self.registered()
        registry["assets"][values[0]["id"]] = "https://private.invalid/image"
        with self.assertRaises(ValueError):
            validate_registry(registry)

    def test_unsupported_or_oversized_file_fails_before_upload(self):
        self.image.write_bytes(b"<svg>not an approved image</svg>")
        with self.assertRaises(ValueError):
            read_image(self.image)
        self.image.write_bytes(b"x" * (8 * 1024 * 1024 + 1))
        with self.assertRaises(ValueError):
            read_image(self.image)

    def test_registry_storage_failure_does_not_replace_existing_configuration(self):
        self.registered(); before = self.registry_path.read_bytes()
        with patch("stage_media.os.replace", side_effect=OSError("disk")):
            with self.assertRaises(OSError):
                stage([self.image], self.registry_path, True, True)
        self.assertEqual(self.registry_path.read_bytes(), before)
        self.assertEqual(set(self.registry_path.parent.iterdir()), {self.registry_path, self.registry_path.with_suffix(".lock")})


class MediaPublisherRefusalTests(unittest.TestCase):
    setUp = fixtures.PublisherTests.setUp
    run_publish = fixtures.PublisherTests.run_publish
    def test_media_without_registry_or_attachment_adapter_cannot_launch_or_fall_back_to_text(self):
        self.job["media"] = [{"id": "99999999-9999-4999-8999-999999999999", "sha256": hashlib.sha256(PNG).hexdigest(),
            "bytes": len(PNG), "mime": "image/png", "name": "fixture.png", "rightsConfirmed": True, "privacyReviewed": True}]
        saved = self.run_publish()
        self.assertEqual(saved["result"]["outcome"], "validation_error")
        self.assertEqual(self.page.submits, 0)
        self.api.launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
