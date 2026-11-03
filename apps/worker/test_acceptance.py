from copy import deepcopy
import unittest
from acceptance import evaluate, template


class AcceptanceTests(unittest.TestCase):
    def test_template_never_claims_completion(self):
        result = evaluate(template("a"*64))
        self.assertEqual(len(result["open_features"]), 36)
        self.assertFalse(result["independently_verified"])
        self.assertFalse(result["desktop_retirement_authorized_by_tool"])

    def test_automated_tests_and_missing_features_cannot_be_live_acceptance(self):
        value = template("a"*64)
        value["features"]["F01"] = {"decision": "accepted", "method": "synthetic_fixture", "approved_by": "fixture", "approved_at": "2026-01-01T00:00:00Z", "evidence_sha256": "b"*64}
        with self.assertRaises(ValueError): evaluate(value)
        del value["features"]["F36"]
        with self.assertRaises(ValueError): evaluate(value)

    def test_records_are_only_an_operator_attestation_not_an_independent_certificate(self):
        value = template("a"*64)
        for feature in value["features"]:
            value["features"][feature] = {"decision": "retired_with_approval", "method": "explicit_retirement_approval", "approved_by": "synthetic-test-only", "approved_at": "2026-01-01T00:00:00Z", "evidence_sha256": "b"*64}
        self.assertEqual(evaluate(value)["state"], "operator_attested")
        self.assertFalse(evaluate(value)["independently_verified"])


if __name__ == "__main__": unittest.main()
