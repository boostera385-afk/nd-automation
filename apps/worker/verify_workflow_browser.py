"""Intercepted synthetic DOM only; no account, customer profile or platform traffic."""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock

from automation_journal import AutomationJournal
from supervised_workflows import execute_workflow
from test_supervised_workflows import ACCOUNT, CONFIG, POST, plan, task
from test_workflow_attachments import REVIEW

HTML = """<!doctype html><meta charset="utf-8"><title>Workflow fixture</title>
<a id="account" href="ACCOUNT">Authorized Person</a><div id="login" hidden>Login</div>
<div id="challenge" hidden>Human verification</div><div id="disabled" hidden>Disabled</div>
<section id="form" hidden><input id="email"><input id="password" type="password"><input id="first_name"><input id="last_name"><button id="submit">Submit</button></section>
<article id="post_root"><a id="post_link" href="POST">Post</a><a id="post_author" href="ACCOUNT">Author</a><p id="post_body">Original fixture body</p><div id="post_attachments"></div><button id="edit_open">Edit</button><button id="action_open">Action</button>
<span id="result_title">Approved edit</span><span id="result_price">12.99</span><span id="result_category">Furniture</span><span id="result_audience">neighborhood</span></article>
<section id="edit_root" hidden><textarea id="body"></textarea><input id="title"><input id="price"><select id="category"><option>Furniture</option></select><select id="audience"><option value="neighborhood">neighborhood</option></select><div id="edit_attachments"></div><button id="edit_submit">Save</button></section>
<section id="dialog" hidden><a id="dialog_target" href="TARGET">Exact target</a><button id="confirm">Confirm</button></section>
<section id="result" hidden><a id="result_target" href="TARGET">Exact result target</a></section>
<script>
const get=id=>document.getElementById(id); window.submits=0;
const operation=OPERATION, variant=VARIANT;
const media=(id)=>{const node=document.createElement('span');node.className='attachment';node.dataset.mediaId=id;node.textContent='Fixture image';return node;};
if(variant.startsWith('media_')||variant==='unreviewed_media'){
  get('post_attachments').append(media('asset-1'),media('asset-2'));
  if(variant==='media_original_mismatch')get('post_attachments').firstChild.dataset.mediaId='different';
  if(variant==='media_missing_id')get('post_attachments').firstChild.removeAttribute('data-media-id');
  if(variant==='media_hidden')get('post_attachments').hidden=true;
}
if(operation==='account_register'||operation==='account_login'){get('form').hidden=false;get('account').hidden=true;get('login').hidden=false;}
if(variant==='wrong_account')get('account').href='https://nextdoor.com/profile/wrong-person';
if(variant==='challenge')get('challenge').hidden=false;
if(variant==='stale_body')get('post_body').textContent='Unexpected changed body';
if(variant==='wrong_target')get('dialog_target').href='https://nextdoor.com/p/not-authorized';
if(variant==='preexisting_result')get('result').hidden=false;
get('submit').onclick=()=>{window.submits++;get('form').hidden=true;get('login').hidden=true;if(operation==='account_register')get('challenge').hidden=false;else get('account').hidden=false;};
get('edit_open').onclick=()=>{
  get('edit_root').hidden=false;get('edit_attachments').replaceChildren(...Array.from(get('post_attachments').children,node=>node.cloneNode(true)));
  if(variant==='changed_on_open')get('post_body').textContent='Concurrent change';
  if(variant==='media_changed_on_open')get('edit_attachments').firstChild.remove();
  if(variant==='text_media_on_open')get('edit_attachments').append(media('unexpected'));
};
get('body').oninput=()=>{
  if(variant==='media_changed_on_fill')get('edit_attachments').firstChild.dataset.mediaId='different';
  if(variant==='media_changed_card_on_fill')get('post_attachments').firstChild.dataset.mediaId='different';
};
get('edit_submit').onclick=()=>{
  window.submits++;
  if(variant==='media_save_no_result')return;
  get('post_body').textContent=get('body').value;get('edit_root').hidden=true;
  if(variant==='media_removed_result')get('post_attachments').firstChild.remove();
  if(variant==='media_reorder_result')get('post_attachments').append(get('post_attachments').firstChild);
  if(variant==='media_added_result'||variant==='text_media_on_save')get('post_attachments').append(media('unexpected'));
};
get('action_open').onclick=()=>get('dialog').hidden=false;
get('confirm').onclick=()=>{window.submits++;get('dialog').hidden=true;if(variant!=='missing_result')get('result').hidden=false;};
</script>"""


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--browser", required=True); args = parser.parse_args()
    from playwright.sync_api import sync_playwright
    results = []
    cases = [(op, "normal", "handoff_required" if op == "account_register" else "verified", op not in {"account_inspect"}) for op in
             ("account_register", "account_login", "account_inspect", "post_edit", "post_delete", "account_block")]
    cases += [("post_delete", "wrong_account", "validation_error", False), ("post_delete", "wrong_target", "validation_error", False),
              ("post_edit", "stale_body", "validation_error", False), ("post_edit", "changed_on_open", "validation_error", False),
              ("account_register", "challenge", "handoff_required", False), ("account_block", "preexisting_result", "validation_error", False),
               ("post_delete", "missing_result", "needs_reconciliation", True)]
    cases += [("post_edit", variant, expected, attempted) for variant, expected, attempted in [
        ("listing_normal", "verified", True), ("media_normal", "verified", True),
        ("listing_media_normal", "verified", True), ("media_hidden", "verified", True),
        ("unreviewed_media", "validation_error", False), ("media_original_mismatch", "validation_error", False),
        ("media_missing_id", "validation_error", False), ("media_changed_on_open", "validation_error", False),
        ("media_changed_on_fill", "validation_error", False), ("media_changed_card_on_fill", "validation_error", False),
        ("text_media_on_open", "validation_error", False), ("text_media_on_save", "needs_reconciliation", True),
        ("media_removed_result", "needs_reconciliation", True), ("media_reorder_result", "needs_reconciliation", True),
        ("media_added_result", "needs_reconciliation", True), ("media_save_no_result", "needs_reconciliation", True),
    ]]
    with TemporaryDirectory() as directory, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True)
        try:
            for index, (operation, variant, expected, attempted) in enumerate(cases):
                context = browser.new_context(service_workers="block")
                spec = plan(operation)
                if variant.startswith("listing_"):
                    spec["manifest"]["target_url"] = "https://nextdoor.com/for_sale_and_free/owned-fixture"
                spec["selectors"].update({"post_media": ".attachment"} if operation in {"post_edit", "post_delete"} else {})
                if operation == "post_edit":
                    spec["selectors"].update({"submit": "#edit_submit", "edit_media": ".attachment"})
                    if variant.removeprefix("listing_").startswith("media_"):
                        spec["attachments"] = REVIEW.copy()
                job = task(spec)
                if variant.startswith("listing_"):
                    job["payload"]["content"].update({"kind": "listing", "price_cents": 1299, "category": "Furniture"})
                html = HTML.replace("ACCOUNT", ACCOUNT).replace("POST", spec["manifest"]["target_url"] or POST).replace("TARGET", spec["manifest"]["target_url"] or POST).replace("OPERATION", json.dumps(operation)).replace("VARIANT", json.dumps(variant.removeprefix("listing_")))
                requests, counts = [], []
                def intercept(route):
                    requests.append(route.request.url)
                    route.fulfill(status=200, content_type="text/html", body=html)
                context.route("**/*", intercept)
                class Page:
                    def __init__(self, page): self.page = page
                    def __getattr__(self, name): return getattr(self.page, name)
                    def route(self, *_args): pass  # Context fulfills every request; production navigation guard is tested separately.
                    def wait_for_timeout(self, _milliseconds): self.page.wait_for_timeout(10)  # Fixture state is synchronous, not a live timing test.
                    def close(self): counts.append(self.page.evaluate("window.submits")); self.page.close()
                proxy = SimpleNamespace(contexts=[SimpleNamespace(new_page=lambda: Page(context.new_page()))])
                chromium = Mock(); chromium.connect_over_cdp.return_value = proxy
                api = Mock(); api.launch.return_value = {"url": "http://127.0.0.1:9222"}; api.stopped.return_value = True
                journal = AutomationJournal(Path(directory) / f"{index}.json", CONFIG)
                result = execute_workflow(job, spec, api, chromium, journal)
                assert result["outcome"] == expected, (operation, variant, result)
                assert result["action_attempted"] == attempted, (operation, variant, result)
                assert counts == [int(attempted)], (operation, variant, counts)
                assert result["cleanup_confirmed"] is True
                assert "fixture-only-not-a-real-password" not in journal.path.read_text()
                assert "asset-1" not in journal.path.read_text()  # Local review never enters hosted receipts/checkpoints.
                assert journal.read()["inspection_required"] == (expected == "needs_reconciliation")
                api.stop.assert_called_once_with(spec["manifest"]["profile_id"])
                results.append({"operation": operation, "case": variant, "outcome": expected, "submit_count": counts[0], "real_platform_requests": 0})
                context.close()
        finally:
            browser.close()
    print(json.dumps({"mode": "isolated_synthetic_browser", "results": results, "live_accepted": False}))


if __name__ == "__main__": main()
