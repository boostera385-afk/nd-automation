"""Real Playwright DOM integration against intercepted synthetic HTML only.

Uses a fresh isolated browser, never an Incogniton/customer profile. All page
requests are fulfilled from the fixture below; no request reaches Nextdoor.
The CDP/Incogniton transport is mocked, not claimed as live acceptance.
"""

import argparse
import base64
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock

from publisher import publish_one
from publishing_journal import PublishingJournal
from test_publisher import CONFIG, adapter, job
from stage_media import stage

HTML = """<!doctype html><meta charset="utf-8"><title>Local publisher fixture</title>
<a id="account" href="https://nextdoor.com/profile/authorized-fixture">Authorized Person</a>
<button id="open" type="button">Compose</button>
<section id="root" hidden>
<textarea id="body"></textarea><input id="title"><input id="price">
<select id="category"><option>Furniture</option></select>
<input id="files" type="file" accept="image/*" multiple hidden><div id="previews"></div>
<button id="audience" type="button">Choose audience</button>
<div id="choices" hidden><button id="choice" type="button">Your neighborhood</button></div>
<button id="submit" type="button">Submit fixture</button></section><div id="results"></div>
<script>
const get=id=>document.getElementById(id);
window.__submits=0;
get('files').onchange=()=>{
  get('previews').replaceChildren();
  for(const file of get('files').files){const node=document.createElement('div');node.className='preview';const ready=document.createElement('span');ready.className='ready';ready.textContent='Ready';node.append(ready);get('previews').append(node);}
  if(window.__tamperMedia){const original=get('files').files[0],dt=new DataTransfer();dt.items.add(new File(['wrong bytes'],original.name,{type:original.type}));get('files').files=dt.files;}
};
get('open').onclick=()=>get('root').hidden=false;
get('audience').onclick=()=>get('choices').hidden=false;
get('choice').onclick=()=>{get('audience').textContent='Your neighborhood'; get('choices').hidden=true;};
get('submit').onclick=()=>{
  window.__submits++;
  const article=document.createElement('article');
  article.className='result';
  for (const [name,value] of [['result-body',get('body').value],['result-title',get('title').value]]) {
    const node=document.createElement('p');node.className=name;node.textContent=value;article.append(node);
  }
  const author=document.createElement('a');author.className='author';author.href=get('account').href;author.textContent='Authorized Person';article.append(author);
  const link=document.createElement('a');link.className='link';
  link.href='https://nextdoor.com/'+(get('title').value?'for_sale_and_free':'p')+'/local-fixture';link.textContent='Open exact fixture';article.append(link);
  for(const file of get('files').files){const image=document.createElement('span');image.className='result-image';image.textContent=file.name;article.append(image);}
  get('results').append(article); get('root').hidden=true;
};
</script>"""


class LocalPage:
    def __init__(self, page, requests, html=HTML):
        self.page, self.requests, self.html = page, requests, html

    def __getattr__(self, name):
        return getattr(self.page, name)

    def route(self, pattern, _production_handler):
        # Deliberately replace transport only. Exercise the real locator/fill/
        # audience/click/evidence path against a fully offline test document.
        def fulfill(route):
            self.requests.append(route.request.url)
            if route.request.url != "https://nextdoor.com/news_feed/":
                raise AssertionError("Unexpected fixture page request")
            route.fulfill(status=200, content_type="text/html", body=self.html)
        self.page.route(pattern, fulfill)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", required=True, help="Installed Chrome/Edge executable for a fresh isolated context")
    args = parser.parse_args()
    if not Path(args.browser).is_file():
        raise ValueError("Fixture browser is unavailable")
    from playwright.sync_api import sync_playwright
    results = []
    with sync_playwright() as playwright, TemporaryDirectory() as directory:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True)
        try:
            for kind, media, tamper in (("post", False, False), ("listing", False, False), ("post", True, False), ("listing", True, False), ("post", True, True)):
                context = browser.new_context(service_workers="block")
                try:
                    requests = []
                    value, spec = job(kind), adapter()
                    registry = None
                    if media:
                        image_path = Path(directory) / "fixture.png"
                        image_path.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRk0AAAAASUVORK5CYII="))
                        registry_path = Path(directory) / "media-registry.json"
                        value["media"] = stage([image_path], registry_path, rights=True, privacy=True)
                        registry = json.loads(registry_path.read_text())
                    spec["account"], spec["login"], spec["verification"] = "#account", "#absent-login", "#absent-verification"
                    form = spec["forms"][kind]
                    for key in ("open", "root", "body", "title", "price", "category", "audience", "submit"):
                        form[key] = "#" + key
                    form.update(result_root="article.result", result_link="a.link", result_body="p.result-body",
                                result_author="a.author", result_title="p.result-title")
                    form["audiences"] = {key: "#choice" for key in ("anyone", "nearby", "neighborhood")}
                    if media:
                        form["media"] = {"input": "#files", "preview": ".preview", "ready": ".ready", "result": ".result-image"}
                    html = HTML.replace("window.__submits=0;", "window.__submits=0;window.__tamperMedia=" + str(tamper).lower() + ";")
                    proxy = SimpleNamespace(contexts=[SimpleNamespace(new_page=lambda: LocalPage(context.new_page(), requests, html))])
                    chromium = SimpleNamespace(connect_over_cdp=lambda *_args, **_kwargs: proxy)
                    api = Mock()
                    api.launch.return_value = {"status": "ok", "puppeteerUrl": "http://127.0.0.1:50001"}
                    journal = PublishingJournal(Path(directory) / f"{kind}-{media}-{tamper}.json", CONFIG)
                    publish_one(value, spec, api, chromium, journal, registry)
                    saved = journal.read()
                    if tamper:
                        assert saved["result"]["outcome"] == "validation_error", saved["result"]["reason"]
                        assert saved["result"]["post_url"] is None
                    else:
                        assert saved["result"]["outcome"] == "submitted", saved["result"]["reason"]
                        expected = "p" if kind == "post" else "for_sale_and_free"
                        assert saved["result"]["post_url"] == f"https://nextdoor.com/{expected}/local-fixture"
                    assert saved["cleanup_required"] is False
                    assert requests == ["https://nextdoor.com/news_feed/"]
                    results.append({"kind": kind, "media": media, "tamper_refused": tamper, "fixture_dom": "pass", "real_platform_requests": 0})
                finally:
                    context.close()
        finally:
            browser.close()
    print(json.dumps({"mode": "isolated_synthetic_browser", "results": results, "live_acceptance": False}))


if __name__ == "__main__":
    main()
