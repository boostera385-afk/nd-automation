import json
import unittest

from profile_inventory import InvalidInventory, parse_inventory


class InventoryTests(unittest.TestCase):
    def test_minimizes_legacy_record(self):
        payload = {"profileData": [{"general_profile_information": {
            "browser_id": "id-1", "profile_name": "Example", "password": "secret"
        }, "proxy": "secret", "group": "Team"}]}
        self.assertEqual(parse_inventory(payload), [{"profile_id": "id-1", "name": "Example", "group": "Team"}])

    def test_string_encoded_and_flat_record(self):
        data = [{"profile_browser_id": "id-2", "profile_name": "Example"}]
        self.assertEqual(parse_inventory({"profileData": json.dumps(data)}), [
            {"profile_id": "id-2", "name": "Example", "group": "Unassigned"}
        ])

    def test_duplicate_names_are_preserved_as_distinct_ids(self):
        records = [{"profile_browser_id": "id-1", "profile_name": "Same"},
                   {"profile_browser_id": "id-2", "profile_name": "Same"}]
        self.assertEqual(len(parse_inventory({"profileData": records})), 2)

    def test_duplicate_ids_and_missing_identity_fail_closed(self):
        for records in ([{"profile_browser_id": "x", "profile_name": "a"},
                         {"profile_browser_id": "X", "profile_name": "b"}],
                        [{"profile_name": "a"}]):
            with self.assertRaises(InvalidInventory):
                parse_inventory({"profileData": records})

    def test_invalid_response_is_not_an_empty_inventory(self):
        for payload in ({}, {"profileData": "bad"}, {"profileData": {}}, {"profileData": [None]}):
            with self.assertRaises(InvalidInventory):
                parse_inventory(payload)
        self.assertEqual(parse_inventory({"profileData": []}), [])


if __name__ == "__main__":
    unittest.main()
