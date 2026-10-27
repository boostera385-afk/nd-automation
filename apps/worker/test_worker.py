import unittest
from unittest.mock import Mock
from urllib.error import URLError

from worker import INCOGNITON_HEALTH_URL, check_incogniton


class HealthTests(unittest.TestCase):
    def test_reachable(self):
        opener = Mock()
        opener.open.return_value.__enter__ = Mock(return_value=Mock(status=200))
        opener.open.return_value.__exit__ = Mock(return_value=False)
        self.assertEqual(check_incogniton(opener), {"status": "reachable"})
        opener.open.assert_called_once_with(INCOGNITON_HEALTH_URL, timeout=5)

    def test_unavailable_does_not_expose_error(self):
        opener = Mock()
        opener.open.side_effect = URLError("sensitive detail")
        self.assertEqual(check_incogniton(opener), {"status": "unavailable"})

    def test_non_success_status_is_unavailable(self):
        opener = Mock()
        opener.open.return_value.__enter__ = Mock(return_value=Mock(status=503))
        opener.open.return_value.__exit__ = Mock(return_value=False)
        self.assertEqual(check_incogniton(opener), {"status": "unavailable"})


if __name__ == "__main__":
    unittest.main()
