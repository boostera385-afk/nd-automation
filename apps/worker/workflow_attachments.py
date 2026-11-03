"""Local retain-only edit contract. No uploads, downloads or removal controls.

Stable, locally reviewed platform asset IDs are DOM evidence, not byte hashes.
Selectors must cover every attachment, including non-visible attachment nodes.
An adapter that cannot establish that coverage must not be enabled.
"""
import re


def validate_attachment_review(review):
    if not isinstance(review, dict) or set(review) != {"mode", "id_attribute", "ids"} or review["mode"] != "preserve":
        raise ValueError("Only explicit retain-all attachment review is supported")
    if not isinstance(review["id_attribute"], str) or not re.fullmatch(r"data-[a-z][a-z0-9-]{0,63}", review["id_attribute"]):
        raise ValueError("A reviewed stable platform asset ID attribute is required")
    ids = review["ids"]
    if not isinstance(ids, list) or not 1 <= len(ids) <= 10:
        raise ValueError("Review between one and ten retained attachments")
    if any(not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}", item) for item in ids):
        raise ValueError("Only bounded opaque asset IDs are supported, not paths or URLs")
    if len(set(ids)) != len(ids):
        raise ValueError("Each retained attachment must have a distinct asset ID")
    return review


def check_attachments(root, selector, review=None):
    nodes = root.locator(selector)
    if review is None:
        # Text-only must also be checked in the composer and saved result, not
        # merely on the original card. Hidden matching nodes are not ignored.
        if nodes.count() != 0:
            raise ValueError("Attachments require explicit local retain-all review")
        return
    validate_attachment_review(review)
    if nodes.count() != len(review["ids"]):
        raise ValueError("Attachment count differs from local review")
    # One DOM read avoids collecting a mixed list through individual round trips.
    # This fixed read-only script is never supplied by a queued task or plan.
    ids = nodes.evaluate_all("(nodes, attribute) => nodes.map(node => node.getAttribute(attribute))", review["id_attribute"])
    if ids != review["ids"]:
        raise ValueError("Attachment identity or order differs from local review")
