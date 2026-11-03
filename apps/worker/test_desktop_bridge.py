import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from desktop_bridge import OPEN_URI, HELPER_URI, file_hash, load_config, local_file, main as native_main, open_incogniton, start_profile_helper, validate_config, verify_publisher
from install_desktop_bridge import REGISTRY_ROOT, connect_helper, install, remove


class Registry:
    HKEY_CURRENT_USER = 1
    KEY_WRITE = 2
    REG_SZ = 1

    def __init__(self): self.values = {}
    def OpenKey(self, _root, name):
        if name not in self.values: raise FileNotFoundError()
        key = Mock(); key.__enter__ = Mock(return_value=name); key.__exit__ = Mock(return_value=False)
        return key
    def CreateKeyEx(self, root, name, *_args):
        self.values.setdefault(name, {})
        return self.OpenKey(root, name)
    def SetValueEx(self, key, name, _zero, _type, value): self.values[key][name] = value
    def QueryValueEx(self, key, name): return self.values[key][name], self.REG_SZ
    def DeleteKey(self, _root, name):
        if any(key.startswith(name + "\\") for key in self.values): raise OSError("Unknown child")
        del self.values[name]


class DesktopBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.executable = self.root / "Incogniton.exe"; self.executable.write_bytes(b"Synthetic signed-exe fixture; never run")
        self.config = {"version": 1, "executable": str(self.executable), "sha256": file_hash(self.executable)}
        self.spawn, self.publisher = Mock(), Mock()

    def launch(self, uri=OPEN_URI, confirm=None):
        return open_incogniton(uri, self.config, confirm or Mock(return_value=True), self.spawn, self.publisher)

    def test_only_exact_uri_no_arguments_paths_tokens_callbacks_or_encoded_variants(self):
        for uri in (OPEN_URI + "/", OPEN_URI + "?code=secret", OPEN_URI + "#x", HELPER_URI,
                    "nd-automation://open-incogniton%22 --execute", "file:///Incogniton.exe", OPEN_URI.upper()):
            with self.subTest(uri=uri), self.assertRaises(ValueError): self.launch(uri)
        self.spawn.assert_not_called(); self.publisher.assert_not_called()

    def test_launch_requires_native_confirmation_and_publisher_validation(self):
        self.assertEqual(self.launch(confirm=Mock(return_value=False)), "cancelled")
        self.spawn.assert_not_called()
        self.publisher.side_effect = ValueError("Untrusted publisher")
        with self.assertRaises(ValueError): self.launch()
        self.spawn.assert_not_called()

    def test_only_pinned_executable_without_shell_or_remote_arguments_is_launched(self):
        self.assertEqual(self.launch(), "launch_requested")
        self.spawn.assert_called_once_with([str(self.executable)], cwd=str(self.root), shell=False, close_fds=True)

    def test_changed_app_requires_review_not_silent_update(self):
        self.executable.write_bytes(b"Different update")
        with self.assertRaises(ValueError): self.launch()
        self.spawn.assert_not_called()

    def test_change_during_confirmation_cannot_launch(self):
        def confirm(_exe): self.executable.write_bytes(b"Changed during prompt"); return True
        with self.assertRaises(ValueError): self.launch(confirm=confirm)
        self.spawn.assert_not_called()

    def test_bad_config_and_network_paths_are_refused(self):
        for change in ({"version": True}, {"sha256": "invalid"}, {"executable": "relative.exe"},
                       {"executable": r"\\server\Incogniton.exe"}, {"executable": "https://example.invalid/app.exe"},
                       {"command": "arbitrary"}):
            with self.assertRaises(ValueError): validate_config({**self.config, **change})
        with self.assertRaises(ValueError): local_file("relative")

    def test_duplicate_or_large_configuration_is_refused(self):
        path = self.root / "config.json"; path.write_text('{"version":1,"version":2}')
        with self.assertRaises(ValueError): load_config(path)
        path.write_text("x" * 4097)
        with self.assertRaises(ValueError): load_config(path)

    def test_install_and_remove_are_scoped_to_own_exact_registry_keys(self):
        registry = Registry(); destination = self.root / "settings.json"
        with patch("install_desktop_bridge.handler_command", return_value='"python.exe" "desktop_bridge.py" "%1"'):
            install(self.executable, registry, destination, self.publisher)
            self.assertEqual(json.loads(destination.read_text()), self.config)
            self.assertEqual(len(registry.values), 4)
            with self.assertRaises(ValueError): install(self.executable, registry, destination, self.publisher)
            remove(registry, destination)
            self.assertEqual(registry.values, {}); self.assertFalse(destination.exists())

    def test_existing_or_another_apps_registry_registration_is_never_overwritten_or_removed(self):
        registry = Registry(); registry.values[REGISTRY_ROOT] = {}
        with self.assertRaises(ValueError): install(self.executable, registry, self.root / "settings.json", self.publisher)
        registry.values[REGISTRY_ROOT + r"\shell\open\command"] = {"": "someone-else.exe"}
        with patch("install_desktop_bridge.handler_command", return_value="our-command"), self.assertRaises(ValueError):
            remove(registry, self.root / "settings.json")
        self.assertEqual(len(registry.values), 2)

    def test_profile_helper_has_fixed_arguments_private_connection_and_no_browser_adapter(self):
        private = self.root / ".monitoring"; private.mkdir()
        connection = {"version": 1, "supabase_url": "https://example.supabase.co", "publishable_key": "sb_publishable_fixture", "worker_token": "a" * 64}
        (private / "worker.json").write_text(json.dumps(connection)); (self.root / "agent.py").write_text("# fixture")
        interpreter = self.root / "python.exe"; interpreter.write_bytes(b"never executed")
        with patch("desktop_bridge.sys.executable", str(interpreter)):
            self.assertEqual(start_profile_helper(HELPER_URI, Mock(return_value=True), self.spawn, self.root), "helper_start_requested")
        arguments = self.spawn.call_args.args[0]
        self.assertIn("--tasks-only", arguments); self.assertNotIn("--adapter", arguments)
        self.assertNotIn(connection["worker_token"], " ".join(arguments))
        self.assertFalse(self.spawn.call_args.kwargs["shell"])

    def test_selected_connection_is_validated_saved_exclusively_and_never_echoed(self):
        source = self.root / "download.json"; destination = self.root / "private" / "worker.json"
        value = {"version": 1, "supabase_url": "https://example.supabase.co", "publishable_key": "sb_publishable_fixture", "worker_token": "a" * 64}
        source.write_text(json.dumps(value))
        self.assertEqual(connect_helper(source, destination), "connection_saved")
        self.assertEqual(json.loads(destination.read_text()), value)
        with self.assertRaises(ValueError): connect_helper(source, destination)
        self.assertTrue(source.exists())  # Never silently delete an operator's original/download.

    def test_connection_import_rejects_privileged_key_and_cannot_replace_an_existing_file(self):
        source = self.root / "download.json"; destination = self.root / "private" / "worker.json"
        source.write_text(json.dumps({"version": 1, "supabase_url": "https://example.supabase.co", "publishable_key": "not-a-publishable-key", "worker_token": "a" * 64}))
        with self.assertRaises(ValueError): connect_helper(source, destination)
        self.assertFalse(destination.exists())

    def test_native_entrypoint_rejects_extra_arguments_before_gui_or_state_access(self):
        with patch("desktop_bridge.load_config") as load:
            self.assertEqual(native_main([OPEN_URI, "--remove"]), 1)
            self.assertEqual(native_main([OPEN_URI + "?command=anything"]), 1)
            load.assert_not_called()

    def test_publisher_check_requires_valid_signature_and_exact_reviewed_publisher(self):
        for status, subject, allowed in (("Valid", "CN=WorkingGreen B.V., O=WorkingGreen B.V.", True),
                                         ("NotSigned", "CN=WorkingGreen B.V.", False),
                                         ("Valid", "CN=Another publisher", False),
                                         ("Valid", "CN=WorkingGreen B.V. Imposter", False)):
            with self.subTest(status=status, subject=subject), patch("desktop_bridge.subprocess.run", return_value=Mock(stdout=json.dumps({"status": status, "subject": subject}))) as run:
                if allowed: verify_publisher(self.executable)
                else:
                    with self.assertRaises(ValueError): verify_publisher(self.executable)
                self.assertFalse(run.call_args.kwargs["shell"])

    def test_failed_registration_cleans_only_its_own_new_keys_and_configuration(self):
        registry = Registry(); destination = self.root / "settings.json"
        with patch("install_desktop_bridge.handler_command", return_value="our-command"), patch.object(registry, "SetValueEx", side_effect=OSError("fixture failure")):
            with self.assertRaises(OSError): install(self.executable, registry, destination, self.publisher)
        self.assertEqual(registry.values, {}); self.assertFalse(destination.exists())


if __name__ == "__main__": unittest.main()
