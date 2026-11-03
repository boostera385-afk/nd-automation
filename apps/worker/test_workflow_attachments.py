from copy import deepcopy
import unittest
from unittest.mock import Mock

from supervised_workflows import validate_plan
from test_supervised_workflows import plan
from workflow_attachments import check_attachments, validate_attachment_review


REVIEW = {"mode": "preserve", "id_attribute": "data-media-id", "ids": ["asset-1", "asset-2"]}


class AttachmentReviewTests(unittest.TestCase):
    def test_review_is_local_edit_only_and_optional(self):
        validate_plan(plan("post_edit"))
        spec = plan("post_edit"); spec["attachments"] = deepcopy(REVIEW)
        self.assertEqual(validate_plan(spec)["attachments"], REVIEW)
        spec = plan(); spec["attachments"] = REVIEW
        with self.assertRaises(ValueError):
            validate_plan(spec)

    def test_composer_selector_is_required_even_for_text_only(self):
        spec = plan("post_edit"); del spec["selectors"]["edit_media"]
        with self.assertRaises(ValueError):
            validate_plan(spec)

    def test_no_add_remove_unknown_fields_urls_or_unbounded_ids(self):
        for change in ({"mode": "remove"}, {"mode": "add"}, {"remove": ["asset-1"]},
                       {"id_attribute": "src"}, {"id_attribute": "data-media-id]"},
                       {"ids": []}, {"ids": ["same", "same"]}, {"ids": ["a"] * 11},
                       {"ids": ["https://private.invalid/image?token=secret"]},
                       {"ids": ["C:\\private\\photo.jpg"]}, {"ids": ["x" * 201]},
                       {"ids": [None]}, {"ids": "asset-1"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_attachment_review({**REVIEW, **change})
        for value in (None, [], True):
            with self.assertRaises(ValueError):
                validate_attachment_review(value)

    def test_exact_ordered_set_is_checked_with_one_dom_snapshot(self):
        root = Mock(); nodes = root.locator.return_value
        nodes.count.return_value = 2; nodes.evaluate_all.return_value = REVIEW["ids"]
        check_attachments(root, ".media", REVIEW)
        nodes.evaluate_all.assert_called_once()

    def test_missing_added_reordered_replaced_or_unidentified_attachments_fail(self):
        for ids in (["asset-1"], ["asset-1", "asset-2", "asset-3"],
                    ["asset-2", "asset-1"], ["asset-1", "other"], ["asset-1", None]):
            root = Mock(); nodes = root.locator.return_value
            nodes.count.return_value = len(ids); nodes.evaluate_all.return_value = ids
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                check_attachments(root, ".media", REVIEW)

    def test_text_only_rejects_any_matching_node_including_hidden_attachments(self):
        root = Mock(); nodes = root.locator.return_value; nodes.count.return_value = 1
        with self.assertRaises(ValueError):
            check_attachments(root, ".media")
        nodes.is_visible.assert_not_called()
        nodes.count.return_value = 0
        check_attachments(root, ".media")


if __name__ == "__main__":
    unittest.main()
