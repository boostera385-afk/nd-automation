import urllib.parse
import mimetypes
import os
import time
from core.engine.exceptions import AutomationStopped, RetryableError, PermanentError
from core.engine.state_machine import AutomationState
import random
import re
import requests
from playwright.sync_api import sync_playwright
from core.automation.nd_navigation import navigate_with_recovery
from core.automation.nd_ui import (
    click_post_button,
    dismiss_reminder_modal,
    find_submit_button,
    set_post_visibility,
)


# Playwright names the upload's MIME type from the file extension via
# mimetypes; Windows often has no entry for these, which would send a valid
# image as application/octet-stream and get it silently dropped.
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/avif", ".avif")
mimetypes.add_type("image/heic", ".heic")
mimetypes.add_type("image/jpeg", ".jpg")
mimetypes.add_type("image/png", ".png")

DOWNLOAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
}

CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/x-ms-bmp": ".bmp",
    "image/tiff": ".tif",
    "image/heic": ".heic",
    "image/heif": ".heic",
    "image/avif": ".avif",
}

KNOWN_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff")

DRIVE_HOSTS = ("drive.google.com", "docs.google.com", "drive.usercontent.google.com")

# Every shape a Google Drive share link comes in:
#   /file/d/<id>/view      /open?id=<id>      /uc?export=view&id=<id>
#   /uc?export=download&id=<id>               /thumbnail?id=<id>
#   drive.usercontent.google.com/download?id=<id>
DRIVE_ID_PATTERNS = (
    r"/file/d/([a-zA-Z0-9_-]{10,})",
    r"/d/([a-zA-Z0-9_-]{10,})",
    r"[?&]id=([a-zA-Z0-9_-]{10,})",
)


def drive_file_id(token):
    """Returns the Drive file id inside a link, or '' if it is not a Drive link."""
    lowered = str(token or "").lower()
    if not any(host in lowered for host in DRIVE_HOSTS):
        return ""
    for pattern in DRIVE_ID_PATTERNS:
        match = re.search(pattern, str(token))
        if match:
            return match.group(1)
    return ""


def extract_drive_file_ids(cell_text):
    """All Drive file ids in a cell, in order, without duplicates."""
    ids = []
    for token in re.split(r"[\s,]+", str(cell_text or "")):
        file_id = drive_file_id(token)
        if file_id:
            ids.append(file_id)
    return list(dict.fromkeys(ids))

# Nextdoor's uploader rejects these even though they are real images.
UNSUPPORTED_IMAGE_EXTENSIONS = (".heic", ".avif", ".tif", ".tiff")


def sniff_image_extension(data):
    """Identifies an image from its magic bytes. Returns '' if it is not one."""
    if not data or len(data) < 12:
        return ""
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:2] == b"BM":
        return ".bmp"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return ".tif"
    if data[4:8] == b"ftyp" and data[8:12].lower() in (b"heic", b"heix", b"hevc", b"mif1"):
        return ".heic"
    if data[4:8] == b"ftyp" and data[8:12].lower() == b"avif":
        return ".avif"
    return ""


def _looks_like_markup(data):
    head = data[:400].lstrip().lower()
    return head.startswith(b"<!doctype") or head.startswith(b"<html") or b"<head>" in head


def _image_extension(url, response, data):
    """
    Works out the right file extension.

    Google/Photos links such as .../AABkm...=s0 carry no extension at all, and
    saving them without one makes the browser upload them as
    application/octet-stream, which Nextdoor silently discards.

    The file's own bytes decide first: a sign-in or error page served at a
    .jpg URL must not be saved as an image, or the upload fails silently.
    """
    # 1. The bytes themselves - the only trustworthy source.
    sniffed = sniff_image_extension(data)
    if sniffed:
        return sniffed

    # 2. Not a format we recognise: refuse anything that is clearly a web page.
    if _looks_like_markup(data):
        return ""

    # 3. An image Content-Type we trust for formats the sniffer does not know.
    content_type = ""
    if response is not None:
        content_type = str(response.headers.get("Content-Type", "")).split(";")[0].strip().lower()
    if content_type in CONTENT_TYPE_EXTENSIONS:
        return CONTENT_TYPE_EXTENSIONS[content_type]
    if content_type and not content_type.startswith("image/"):
        return ""

    # 4. Last resort: the URL path, ignoring any query or =s0 size suffix.
    path = urllib.parse.urlparse(url).path.lower()
    for ext in KNOWN_IMAGE_EXTENSIONS:
        if path.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext

    return ""


def _safe_image_name(url, extension, index):
    """A short, unique, extension-carrying filename."""
    path = urllib.parse.urlparse(url).path
    tail = path.rstrip("/").split("/")[-1]
    tail = tail.split("=")[0]
    base = "".join(c for c in os.path.splitext(tail)[0] if c.isalnum() or c in "._-")
    base = base[:40].strip("._-")
    if not base:
        base = "img"
    unique = abs(hash(url)) % 1000000
    return f"{base}_{index}_{unique}{extension}"


def _save_image(url, response, temp_dir, index, log, label=""):
    """Validates and writes one downloaded image. Returns a path or ''."""
    data = response.content
    if not data:
        log(f"Skipped {label or url}: the server returned an empty file.")
        return ""

    extension = _image_extension(url, response, data)

    if not extension:
        head = data[:200].lower()
        if b"<html" in head or b"<!doctype" in head:
            log(
                f"Skipped {label or url}: that link returned a web page, not an image file. "
                "Use a direct image link (or share the Drive file so anyone can view it)."
            )
        else:
            log(f"Skipped {label or url}: the downloaded file is not a recognised image.")
        return ""

    if extension in UNSUPPORTED_IMAGE_EXTENSIONS:
        log(
            f"Warning: {label or url} is a {extension.lstrip('.').upper()} image, which Nextdoor "
            "usually rejects. Convert it to JPG or PNG."
        )

    local_path = os.path.join(temp_dir, _safe_image_name(url, extension, index))
    try:
        with open(local_path, "wb") as handle:
            handle.write(data)
    except OSError as e:
        log(f"Could not save {label or url}: {e}")
        return ""

    log(f"Saved image as {os.path.basename(local_path)} ({len(data) // 1024} KB).")
    return local_path


def parse_and_download_images(cell_text, log):
    if not cell_text:
        return []

    local_paths = []
    temp_dir = os.path.join(os.getcwd(), "temp_images")
    os.makedirs(temp_dir, exist_ok=True)
    index = 0

    # 1. Process Google Drive IDs (any share-link shape)
    gdrive_ids = extract_drive_file_ids(cell_text)
    for file_id in gdrive_ids:
        index += 1
        log(f"Downloading Google Drive image: {file_id}")
        saved = ""
        for download_url in (
            f"https://drive.google.com/uc?export=download&id={file_id}",
            f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t",
            # Works for files shared view-only, where download is refused.
            f"https://drive.google.com/thumbnail?id={file_id}&sz=w2000",
        ):
            try:
                response = requests.get(
                    download_url, allow_redirects=True, timeout=30, headers=DOWNLOAD_HEADERS
                )
            except Exception as e:
                log(f"Error downloading {file_id}: {str(e)}")
                continue

            if response.status_code != 200:
                log(f"Failed to download image {file_id}: HTTP {response.status_code}")
                continue

            saved = _save_image(url=download_url, response=response, temp_dir=temp_dir,
                                index=index, log=log, label=f"Drive file {file_id}")
            if saved:
                break

        if saved:
            local_paths.append(saved)

    # 2. Process direct HTTP URLs (that aren't Google Drive)
    url_pattern = r"(https?://[^\s\,\]\)]+)"
    all_urls = list(dict.fromkeys(re.findall(url_pattern, cell_text)))
    for url in all_urls:
        # Drive links whose id we already pulled out were handled above; one
        # we could not parse still gets a straight download attempt here.
        if drive_file_id(url):
            continue
        index += 1
        log(f"Downloading direct image: {url[:90]}{'...' if len(url) > 90 else ''}")
        try:
            response = requests.get(url, allow_redirects=True, timeout=45, headers=DOWNLOAD_HEADERS)
        except Exception as e:
            log(f"Error downloading direct image: {e}")
            continue

        if response.status_code != 200:
            log(f"Failed to download image: HTTP {response.status_code}")
            continue

        saved = _save_image(url=url, response=response, temp_dir=temp_dir, index=index, log=log)
        if saved:
            local_paths.append(saved)

    # 3. Process local file names / paths
    possible_files = [f.strip() for f in str(cell_text).split(",")]
    for file_str in possible_files:
        if not file_str or file_str.startswith("http"):
            continue

        # Check standard path
        if os.path.isfile(file_str):
            local_paths.append(os.path.abspath(file_str))
            log(f"Found local image: {file_str}")
        else:
            # Check 'pictures' or 'images' subfolders
            in_pics = os.path.join(os.getcwd(), "pictures", file_str)
            in_imgs = os.path.join(os.getcwd(), "images", file_str)
            if os.path.isfile(in_pics):
                local_paths.append(os.path.abspath(in_pics))
                log(f"Found local image in pictures folder: {file_str}")
            elif os.path.isfile(in_imgs):
                local_paths.append(os.path.abspath(in_imgs))
                log(f"Found local image in images folder: {file_str}")
            else:
                if "." in file_str:
                    log(
                        f"Warning: Could not find local image '{file_str}'. Please ensure it is in the same folder as the app."
                    )

    return local_paths


def run_auto_posting_flow(
    debug_url,
    post_text,
    visibility_pref=None,
    picture_val=None,
    logger_callback=None,
    target_names=None,
    email_val=None,
    password_val=None,
    state_callback=None,
    stop_event=None,
    random_post_text=None,
    spammers_val=None,
    area_val=None,
):
    """
    Connects to an existing Incogniton profile via Playwright and creates a post on Nextdoor.
    Handles automatic login if prompted. Scans for targets during scrolling.
    """

    def log(msg):
        if logger_callback:
            logger_callback(msg)
        else:
            print(msg)

    def set_state(state, msg=""):
        if state_callback:
            state_callback(state, msg)

    def check_stop():
        if stop_event and stop_event.is_set():
            raise AutomationStopped("User manually stopped automation.")

    def interruptible_sleep(seconds):
        if stop_event is not None:
            if stop_event.wait(seconds):
                raise AutomationStopped("User manually stopped automation.")
        else:
            time.sleep(seconds)

    def check_banned():
        try:
            if (
                "account_disabled" in page.url
                or page.locator("text='Account indefinitely suspended'").is_visible()
                or page.locator(
                    "text='Your account has been indefinitely suspended'"
                ).is_visible()
            ):
                from core.engine.exceptions import PermanentError

                raise PermanentError("Account indefinitely suspended")
        except Exception as e:
            from core.engine.exceptions import PermanentError

            if isinstance(e, PermanentError):
                raise e
            pass

    try:
        with sync_playwright() as p:
            log("Connecting to browser...")

            max_retries = 5
            browser = None
            for attempt in range(max_retries):
                try:
                    browser = p.chromium.connect_over_cdp(debug_url)
                    set_state(AutomationState.CDP_CONNECTING)
                    break
                except Exception as e:
                    if attempt < max_retries - 1:
                        log(
                            f"Browser not ready yet. Retrying in 3s ({attempt+1}/{max_retries})..."
                        )
                        interruptible_sleep(3)
                    else:
                        raise e

            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            page.bring_to_front()
            set_state(AutomationState.PAGE_LOADING)

            downloaded_images = parse_and_download_images(picture_val, log)

            def extract_share_dialog_link():
                extracted_link = "No link extracted"
                try:
                    try:
                        page.wait_for_selector(
                            '[data-testid="share_app_button_COPY_LINK"]', timeout=5000
                        )
                    except:
                        log(
                            "Share dialog not found immediately. Scanning for intercepting pop-ups..."
                        )
                        dismiss_intercepting_popups()
                        page.wait_for_selector(
                            '[data-testid="share_app_button_COPY_LINK"]', timeout=10000
                        )

                    log("Share dialog opened successfully.")

                    # Extract URL from Facebook share button
                    fb_btn = page.locator(
                        '[data-testid="share_app_button_FACEBOOK"]'
                    ).first
                    if fb_btn.is_visible():
                        fb_href = fb_btn.get_attribute("href")
                        if fb_href:
                            parsed = urllib.parse.parse_qs(
                                urllib.parse.urlparse(fb_href).query
                            )
                            if "href" in parsed:
                                extracted_link = parsed["href"][0].split("?")[0]

                    # Click "Copy Link" to trigger any native clipboard/toast events
                    page.locator(
                        '[data-testid="share_app_button_COPY_LINK"]'
                    ).first.click(force=True)
                    if extracted_link == "No link extracted":
                        extracted_link = "Copied to clipboard (URL extraction fallback)"

                    log(f"Extracted Post Link: {extracted_link}")

                    # Close the Share dialog
                    log("Closing share dialog...")
                    close_btn = page.locator(
                        'button[icon="nav-close"], button[aria-label="Close Dialog"]'
                    ).first
                    if close_btn.is_visible():
                        close_btn.click(force=True)
                    
                    # Wait for dialog to fully disappear before taking screenshot
                    interruptible_sleep(1.5)
                    

                except Exception as e:
                    log(f"Warning: Share dialog did not appear or error occurred: {e}")
                return extracted_link

            def smart_navigate(url):
                nonlocal page
                page = navigate_with_recovery(
                    page,
                    context,
                    url,
                    log=log,
                    sleep_fn=interruptible_sleep,
                    set_state=set_state,
                    page_loading_state=AutomationState.PAGE_LOADING,
                )

            # Go to News Feed
            log("Navigating to Nextdoor News Feed...")
            smart_navigate("https://nextdoor.com/news_feed/")
            check_banned()

            def dismiss_intercepting_popups():
                log(
                    "Scanning for random intercepting pop-ups (e.g. app promos, location requests)..."
                )
                # "Posting about an incident?" blocks the composer - decline it first.
                dismiss_reminder_modal(page, log=log, sleep_fn=interruptible_sleep)
                selectors = [
                    'button:has-text("Not now")',
                    'button:has-text("Skip")',
                    'button:has-text("No thanks")',
                    'button:has-text("Maybe later")',
                    'button:has-text("Cancel")',
                    'button:has-text("I understand")',
                    'button[aria-label="Close"]',
                    'button[aria-label="Close Dialog"]',
                    'button[icon="nav-close"]',
                ]
                for _ in range(2):
                    clicked_any = False
                    for sel in selectors:
                        try:
                            # Prioritize clicking buttons inside dialogs to avoid closing actual sidebars
                            for modal_prefix in [
                                'div[role="dialog"] ',
                                'section[role="dialog"] ',
                                "",
                            ]:
                                full_sel = f"{modal_prefix}{sel}"
                                for el in page.locator(full_sel).all():
                                    if el.is_visible():
                                        try:
                                            # SAFETY CHECK: Do not close the composer or share dialog!
                                            is_safe = el.evaluate("""node => {
                                                if (node.closest('div[role="dialog"]') && node.closest('div[role="dialog"]').querySelector('[data-testid="composer-submit-button"]')) return false;
                                                if (node.closest('div[role="dialog"]') && node.closest('div[role="dialog"]').querySelector('[data-testid="share_app_button_COPY_LINK"]')) return false;
                                                return true;
                                            }""")
                                            if not is_safe:
                                                continue
                                        except:
                                            continue

                                        log(f"Closing intercepting pop-up via {sel}...")
                                        el.click(force=True)
                                        interruptible_sleep(1.0)
                                        clicked_any = True
                        except:
                            pass
                    if not clicked_any:
                        break

            dismiss_intercepting_popups()

            # --- LOGIN DETECTION & HANDLING ---
            try:
                # Wait for either the prompt container (logged in) or the sign in button (logged out)
                page.wait_for_selector(
                    'div[data-testid="prompt-container"], [data-testid="signin_button"]',
                    timeout=15000,
                )

                if page.locator('[data-testid="signin_button"]').is_visible():
                    set_state(AutomationState.LOGIN_CHECK)
                    log("Login screen detected. Processing login...")

                    email_input = page.locator(
                        '[data-testid="email-address-input"]'
                    ).first
                    pass_input = page.locator('[data-testid="password-input"]').first

                    # If Google Sheets provided an email, use it. Otherwise rely on autofill
                    if email_val and email_input.is_visible():
                        email_input.type(str(email_val), delay=random.randint(40, 100))
                    elif email_input.is_visible() and not email_input.input_value():
                        log(
                            "Warning: Autofill is empty and no email provided in sheet."
                        )

                    if password_val and pass_input.is_visible():
                        pass_input.type(str(password_val), delay=random.randint(40, 100))
                    elif pass_input.is_visible() and not pass_input.input_value():
                        log(
                            "Warning: Autofill is empty and no password provided in sheet."
                        )

                    interruptible_sleep(1.0)
                    page.locator('[data-testid="signin_button"]').first.click(
                        force=True
                    )

                    # Wait for feed to load after login
                    page.wait_for_selector(
                        'div[data-testid="prompt-container"], span:has-text("What\'s happening, neighbor?")',
                        timeout=20000,
                    )
                    log("Logged in successfully! Feed loaded.")
                else:
                    log("Already logged in. Feed loaded.")
            except Exception:
                log(
                    "Warning: Could not strictly verify feed or login state. Proceeding..."
                )
                check_banned()
                dismiss_intercepting_popups()

            import re

            spammer_urls = []
            if spammers_val:
                for raw_url in re.split(r"[\s,]+", str(spammers_val)):
                    url = raw_url.strip()
                    if "nextdoor.com" in url:
                        if url.startswith("://"):
                            url = "https" + url
                        elif not url.startswith("http"):
                            url = "https://" + url
                        spammer_urls.append(url)
            spammer_status_msgs = []

            def process_spammer_batch(batch_urls, fast_mode=False):
                if not batch_urls: return
                log(f"Opening {len(batch_urls)} spammer profiles concurrently in new tabs...")
                pages_info = []
                
                # Step 1: Open all tabs and trigger navigation (concurrent network loading)
                for s_url in batch_urls:
                    try:
                        p = context.new_page()
                        # wait_until="commit" allows Python to move on while the page finishes loading in the background
                        p.goto(s_url, wait_until="commit", timeout=15000)
                        pages_info.append({"page": p, "url": s_url})
                    except Exception as e:
                        log(f"Warning: Failed to initiate navigation for {s_url}: {e}")
                        spammer_status_msgs.append(f"Failed {s_url[-10:]}")
                        try:
                            p.close()
                        except:
                            pass
                        
                if not fast_mode:
                    interruptible_sleep(2.0)
                else:
                    interruptible_sleep(1.0)
                    
                # Step 2: Sequentially process the now-loaded tabs (DOM interactions are very fast)
                for info in pages_info:
                    p = info["page"]
                    s_url = info["url"]
                    try:
                        more_btn = p.locator('[data-testid="view-more-button"]').first
                        if more_btn.is_visible(timeout=10000):
                            more_btn.click(force=True)
                            if not fast_mode:
                                interruptible_sleep(1.0)
    
                            # Broad check for already blocked (Unblock option)
                            unblock_item = p.locator('div[role="menuitem"]:has-text("Unblock"), button:has-text("Unblock"), a:has-text("Unblock")').first
                            if unblock_item.is_visible(timeout=2000):
                                log(f"Profile {s_url} is already blocked! Skipping...")
                                continue
    
                            # Strict check for Block
                            block_item = p.locator('div[role="menuitem"] span:text-is("Block")').first
                            if not block_item.is_visible():
                                block_item = p.locator('div[role="menuitem"]:has-text("Block"), button:has-text("Block")').first
    
                            if block_item.is_visible(timeout=3000):
                                block_item.click(force=True)
                                if not fast_mode:
                                    interruptible_sleep(1.0)
    
                                try:
                                    confirm_btn = p.locator('section[role="dialog"] button:has-text("Block"), div[role="dialog"] button:has-text("Block"), button:has-text("Block"):visible').first
                                    confirm_btn.wait_for(state="visible", timeout=3000)
                                    confirm_btn.click(timeout=3000, force=True)
                                    
                                    # Strict validation: Wait for confirmation Toast/Dialog 
                                    # (Avoid using text= mixed with CSS to prevent Playwright parsing crashes)
                                    try:
                                        p.locator('svg[data-icon="nav-close"], svg[data-icon="disabled"], span:has-text("You have blocked"), div:has-text("You have blocked")').first.wait_for(state="visible", timeout=5000)
                                        
                                        # Click the close button on the toast/dialog if it exists
                                        close_toast = p.locator('button[icon="nav-close"], button:has(svg[data-icon="nav-close"])').first
                                        if close_toast.is_visible():
                                            close_toast.click(force=True)
                                            interruptible_sleep(0.5)
                                    except Exception:
                                        log(f"Warning: Did not see clear success validation for {s_url}, but proceeding.")

                                    if not fast_mode:
                                        interruptible_sleep(1.0)
                                    log(f"Successfully blocked {s_url}")
                                except Exception:
                                    log(f"Warning: Block confirmation timed out for {s_url}")
                            else:
                                log(f"Warning: Could not find Block option for {s_url}")
                        else:
                            log(f"Skipping {s_url} - Profile failed to load, was deleted, or took too long.")
                    except Exception as e:
                        log(f"Warning: Failed to block {s_url}: {e}")
                        spammer_status_msgs.append(f"Failed {s_url[-10:]}")
                    finally:
                        try:
                            p.close()
                        except Exception:
                            pass

            # 20 Seconds of strict human-like scrolling (and monitoring)
            log(
                "Feed confirmed loaded. Starting 30 seconds of human-like scrolling NOW..."
            )
            found_target_post = None
            page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
            scroll_start = time.time()
            matched_target_name = None

            while time.time() - scroll_start < 30:
                if target_names and not found_target_post:
                    # Scan visible posts for target authors
                    posts = page.locator(".post").all()
                    for post in posts:
                        try:
                            # The author link usually contains /profile/
                            author_elem = post.locator('a[href*="/profile/"]').first
                            if author_elem.is_visible():
                                author_name = author_elem.text_content().strip().lower()
                                for target in target_names:
                                    if target in author_name:
                                        found_target_post = post
                                        matched_target_name = target
                                        break
                        except Exception:
                            pass

                        if found_target_post:
                            break

                if found_target_post:
                    break

                page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
                if spammer_urls:
                    batch = []
                    while spammer_urls and len(batch) < 5:
                        batch.append(spammer_urls.pop(0))
                    process_spammer_batch(batch, fast_mode=False)
                else:
                    interruptible_sleep(random.uniform(1.8, 2.2))

            # --- IF TARGET WAS FOUND ---
            if found_target_post:
                log(f"*** TARGET NAME '{matched_target_name}' FOUND IN FEED! ***")
                log("Extracting their post link and aborting auto-posting...")

                # Try to click the share button on this specific post
                try:
                    share_btn = found_target_post.locator(
                        '[data-testid="share-button"]'
                    ).first
                    share_btn.scroll_into_view_if_needed()
                    interruptible_sleep(1.0)
                    share_btn.click(force=True)

                    post_link = extract_share_dialog_link()

                    log("Target post processed. Starting 15s cooldown scroll NOW...")
                    scroll_start = time.time()
                    while time.time() - scroll_start < 15:
                        page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
                        if spammer_urls:
                            batch = []
                            while spammer_urls and len(batch) < 5:
                                batch.append(spammer_urls.pop(0))
                            process_spammer_batch(batch, fast_mode=True)
                        else:
                            interruptible_sleep(random.uniform(1.8, 2.2))
                    
                    if spammer_urls:
                        log(f"Burst processing {len(spammer_urls)} remaining spammers before closing...")
                        while spammer_urls:
                            batch = []
                            while spammer_urls and len(batch) < 5:
                                batch.append(spammer_urls.pop(0))
                            process_spammer_batch(batch, fast_mode=True)

                    if downloaded_images:
                        for img_path in downloaded_images:
                            try:
                                if os.path.exists(img_path): os.remove(img_path)
                            except: pass

                    try:
                        for p_to_close in context.pages:
                            try: p_to_close.close()
                            except: pass
                    except: pass
                    context.close()
                    browser.close()
                    return "FOUND", post_link
                except Exception as e:
                    log(f"Error extracting target link: {str(e)}")
                    
                    if downloaded_images:
                        for img_path in downloaded_images:
                            try:
                                if os.path.exists(img_path): os.remove(img_path)
                            except: pass
                            
                    try:
                        for p_to_close in context.pages:
                            try: p_to_close.close()
                            except: pass
                    except: pass
                    context.close()
                    browser.close()
                    return (
                        "FOUND",
                        f"Found {matched_target_name} but failed to extract link.",
                    )

            # --- OPTIONAL: EDIT OR DELETE PREVIOUS POST ---
            if random_post_text:
                text_lower = random_post_text.strip().lower()
                # Be gentle with spelling mistakes for "delete"
                is_delete = text_lower in [
                    "delete",
                    "delet",
                    "delte",
                    "deletee",
                    "del",
                    "remove",
                ] or (text_lower.startswith("del") and len(text_lower) <= 8)
                if is_delete:
                    log("Navigating to Profile to DELETE the last uploaded post...")
                else:
                    log(
                        "Navigating to Profile to edit the last uploaded post with random text..."
                    )

                smart_navigate("https://nextdoor.com/profile/")
                check_banned()
                dismiss_intercepting_popups()

                interruptible_sleep(random.uniform(2.0, 3.0))
                log("Scrolling to find the most recent post...")
                page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
                interruptible_sleep(random.uniform(1.5, 2.5))

                try:
                    menu_btn = page.locator(
                        '[data-testid="feed_item_menu_button"]'
                    ).first
                    menu_btn.wait_for(state="visible", timeout=15000)
                    menu_btn.scroll_into_view_if_needed()
                    menu_btn.click()
                    log("Clicked three-dot menu on the last post.")

                    interruptible_sleep(random.uniform(1.0, 1.5))

                    if is_delete:
                        delete_btn = page.locator(
                            '[data-testid="feed_item_menu_dialog"] div[role="menuitem"]:has-text("Delete")'
                        ).first
                        delete_btn.wait_for(state="visible", timeout=5000)
                        delete_btn.click()
                        log("Clicked 'Delete' from the menu.")

                        confirm_btn = page.locator(
                            '[data-testid="confirmation-button"]'
                        ).first
                        confirm_btn.wait_for(state="visible", timeout=5000)
                        confirm_btn.click(force=True)
                        log("Confirmed post deletion!")
                        interruptible_sleep(random.uniform(2.0, 3.0))
                    else:
                        edit_btn = page.locator(
                            '[data-testid="feed_item_menu_dialog"] div[role="menuitem"]:has-text("Edit")'
                        ).first
                        edit_btn.wait_for(state="visible", timeout=5000)
                        edit_btn.click()
                        log("Clicked 'Edit' on the last post.")

                        log("Waiting for the Edit composer popup...")
                        # Wait directly for the text area since container roles change frequently
                        text_area = page.locator(
                            '[data-testid="composer-text-field"], textarea.postbox-textarea-placeholder'
                        ).first
                        text_area.wait_for(state="visible", timeout=10000)

                        # Clear existing text
                        if text_area.is_visible():
                            # Focus the text area safely
                            text_area.click(force=True)
                            interruptible_sleep(0.5)
                            # Triple click to select all text in many web editors
                            text_area.click(click_count=3, force=True)
                            interruptible_sleep(0.2)
                            # Ctrl+A / Cmd+A to select all, then Backspace to clear
                            page.keyboard.press("Control+A")
                            page.keyboard.press("Meta+A") # For Mac
                            interruptible_sleep(0.2)
                            page.keyboard.press("Backspace")
                            # Also hit delete just in case
                            page.keyboard.press("Delete")
                            interruptible_sleep(0.5)

                        # Remove existing pictures
                        while True:
                            remove_btn = page.locator(
                                '[data-testid="composer-remove-attachment"]'
                            ).first
                            if remove_btn.is_visible(timeout=1000):
                                remove_btn.click(force=True)
                                interruptible_sleep(1.0)
                            else:
                                break

                        # Make sure we're focused before typing
                        if text_area.is_visible():
                            text_area.click()
                        
                        # Type the random text
                        page.keyboard.type(
                            random_post_text, delay=random.randint(30, 80)
                        )
                        interruptible_sleep(random.uniform(1.5, 2.5))

                        # Click Save
                        log("Saving the edited post...")
                        
                        # Nextdoor's React state sometimes needs a moment to register keyboard input
                        interruptible_sleep(1.0)
                        
                        save_btn = page.locator(
                            'button[data-testid="composer-submit-button"]:visible, button:has-text("Save"):visible'
                        ).first
                        save_btn.wait_for(state="visible", timeout=5000)
                        
                        # Try to click it normally first so it triggers React handlers
                        try:
                            save_btn.click(timeout=3000)
                        except:
                            save_btn.click(force=True)
                            
                        interruptible_sleep(random.uniform(3.0, 5.0))
                        log("Random post edit complete!")

                except Exception as e:
                    log(
                        f"Warning: Failed to edit or delete previous post. Proceeding to new post anyway. Error: {e}"
                    )
                finally:
                    # Clean up: If the edit popup is still open for any reason, close it so it doesn't block the next steps
                    try:
                        close_btn = page.locator('[data-testid="composer-close-button"]:visible').first
                        if close_btn.is_visible(timeout=2000):
                            close_btn.click(force=True)
                            log("Closed lingering edit popup.")
                            interruptible_sleep(1.0)
                    except:
                        pass

            # --- STANDARD POSTING FLOW ---
            log("Navigating to News Feed to create a new post...")
            smart_navigate("https://nextdoor.com/news_feed/")
            check_banned()
            dismiss_intercepting_popups()

            page.evaluate("window.scrollTo(0, 0)")
            interruptible_sleep(random.uniform(1.0, 2.0))

            try:
                page.wait_for_selector(
                    'div[data-testid="prompt-container"], span:has-text("What\'s happening, neighbor?")',
                    timeout=20000,
                )
                log("Feed loaded successfully.")
                set_state(AutomationState.READY)
            except Exception:
                log(
                    "Warning: Could not find the post prompt box. Page might not be fully loaded."
                )

            log("Clicking the post prompt box...")
            prompt_span = page.locator(
                'span:has-text("What\'s happening, neighbor?")'
            ).first
            prompt_box = page.locator('div[data-testid="prompt-container"]').first
            global_post_btn = page.locator(
                'button[data-integration-id="post"], button[aria-label="Post"][icon*="compose"]'
            ).first

            if prompt_span.is_visible():
                prompt_span.click(force=True)
            elif prompt_box.is_visible():
                prompt_box.click(force=True)
            elif global_post_btn.is_visible():
                global_post_btn.click(force=True)
            else:
                log("Fallback: Forcing click on any generic composer trigger.")
                page.locator(
                    'button:has-text("Post"), [aria-label="Post"], div:has-text("What\'s happening, neighbor?")'
                ).first.click(force=True)

            log("Prompt box clicked. Waiting for composer popup...")
            set_state(AutomationState.COMPOSER_OPEN)

            composer = page.locator(
                'div[role="dialog"], section[role="dialog"], .blocks-1rowqi7'
            ).first
            try:
                composer.wait_for(state="visible", timeout=10000)
                composer.click()
            except Exception:
                log(
                    "Warning: Failed to locate explicitly visible textarea. Attempting to type directly into focused element."
                )

            # Type the text naturally
            text_area = page.locator(
                '[data-testid="composer-text-field"], textarea.postbox-textarea-placeholder'
            ).first
            if post_text:
                if text_area.is_visible():
                    text_area.click()
            page.keyboard.type(post_text, delay=random.randint(30, 80))
            interruptible_sleep(random.uniform(1.5, 2.5))

            # --- UPLOAD IMAGES ---
            if downloaded_images:
                log(f"Attempting to upload {len(downloaded_images)} images...")
                try:
                    try:
                        file_input = page.locator('input[type="file"]').last
                        file_input.evaluate('el => el.setAttribute("multiple", "")')
                        file_input.set_input_files(downloaded_images, timeout=3000)
                        log("Images attached via hidden input.")
                    except:
                        log("Clicking Add Media to trigger file chooser...")
                        with page.expect_file_chooser(timeout=10000) as fc_info:
                            page.locator(
                                '[data-testid="OPEN_MEDIA_GALLERY"], button[aria-label*="photo"], button[aria-label*="media"], button:has(svg[data-icon="photos"])'
                            ).first.click(force=True)
                        fc_info.value.set_files(downloaded_images)
                        log("Images attached via file chooser.")

                    check_stop()
                    set_state(AutomationState.MEDIA_UPLOADED)
                    # Let the images upload and process
                    interruptible_sleep(random.uniform(5.0, 8.0))
                except Exception as e:
                    log(f"Warning: Failed to upload images: {str(e)}")

            visibility_successfully_set = False

            # --- Audience / visibility (handles both Nextdoor UI variants) ---
            if visibility_pref:
                # The reminder modal can cover the audience row.
                dismiss_reminder_modal(page, log=log, sleep_fn=interruptible_sleep)
                try:
                    visibility_successfully_set, vis_msg = set_post_visibility(
                        page, visibility_pref, log=log, sleep_fn=interruptible_sleep
                    )
                    if not visibility_successfully_set:
                        log(f"Warning during visibility selection: {vis_msg}")
                except Exception as e:
                    log(f"Warning during visibility selection: {e}")

            # Progress through Next/Post modals
            log("Progressing through Next/Post modals...")
            clicked_post = False
            for step in range(4):
                try:
                    # Decline "Posting about an incident?" before anything else -
                    # it sits over the composer and swallows the Post click.
                    dismiss_reminder_modal(page, log=log, sleep_fn=interruptible_sleep)

                    submit_button = find_submit_button(page, timeout=10000)
                    if submit_button is None:
                        log("No submit/Next button found, assuming flow is complete.")
                        break

                    btn_text = ""
                    try:
                        btn_text = submit_button.text_content().strip().lower()
                    except Exception:
                        pass

                    # Late audience menu (older UI shows it after clicking Post)
                    if visibility_pref and not visibility_successfully_set:
                        try:
                            visibility_successfully_set, vis_msg = set_post_visibility(
                                page, visibility_pref, log=log, sleep_fn=interruptible_sleep
                            )
                            if visibility_successfully_set:
                                log(f"Visibility: {vis_msg}")
                        except Exception as e:
                            log(f"Warning: Failed to set visibility: {e}")

                    # STRICT VISIBILITY ENFORCEMENT
                    if "post" in btn_text and visibility_pref and not visibility_successfully_set:
                        raise Exception(f"ABORTING: Failed to securely set visibility to '{visibility_pref}'. Refusing to blindly click Post.")

                    clicked, label = click_post_button(
                        page, log=log, sleep_fn=interruptible_sleep
                    )
                    if not clicked:
                        log(f"Could not click the submit button ({label}).")
                        break

                    if "post" in (label or btn_text) or "save" in (label or btn_text):
                        clicked_post = True

                    interruptible_sleep(random.uniform(3.0, 4.0))

                    if clicked_post:
                        # Nextdoor can re-open the composer if a modal interrupted
                        # the submit; only stop once the composer is really gone.
                        still_open = False
                        try:
                            remaining = find_submit_button(page, timeout=2500)
                            still_open = remaining is not None
                        except Exception:
                            still_open = False
                        if not still_open:
                            break
                        # Keep clicked_post True - the retry is a second attempt
                        # at the same post, not a new one.
                        log("Composer is still open - a pop-up likely interrupted the post. Retrying...")
                except Exception as e:
                    log(f"Error during posting modals: {str(e)}")
                    break

            try:
                page.wait_for_selector(
                    'div[role="dialog"]', state="hidden", timeout=15000
                )
            except:
                pass

            log("Auto Posting flow completed successfully!")

            # Extract link if possible
            post_link = ""
            try:
                post_link = extract_share_dialog_link()
            except Exception:
                pass

            used_fallback = False
            if not post_link or "No link extracted" in post_link or "Copied to clipboard" in post_link:
                used_fallback = True
                log("Failed to extract link from standard post flow. Falling back to Profile page...")
                try:
                    smart_navigate("https://nextdoor.com/profile/")
                    interruptible_sleep(3.0)
                    page.evaluate("window.scrollBy(0, 800)")
                    interruptible_sleep(2.0)
                    
                    share_btn = page.locator('[data-testid="share-button"]').first
                    if share_btn.is_visible():
                        log("Share button found on profile. Opening share dialog...")
                        share_btn.click(force=True)
                        interruptible_sleep(2.0)
                        post_link = extract_share_dialog_link()
                        
                        # Wait for popup to fully close before moving to newsfeed
                        interruptible_sleep(1.5)
                    else:
                        log("Could not find Share button on profile page.")
                except Exception as e:
                    log(f"Profile fallback failed: {e}")

            # Take Expanded Post Screenshot
            try:
                dismiss_intercepting_popups()
                log("Opening first post in expanded view for screenshot...")
                first_post = page.locator('.js-media-post, .post').first
                
                # Click the post body or the post itself to open expanded view
                text_body = first_post.locator('[data-testid="post-body"], span.Linkify').first
                if text_body.is_visible():
                    text_body.click(force=True)
                else:
                    first_post.click(force=True)
                    
                expanded_modal = page.locator('#expanded-post-wrapper')
                expanded_modal.wait_for(state="visible", timeout=7000)
                interruptible_sleep(1.5)  # Let images/content load fully
                
                dismiss_intercepting_popups()
                
                from datetime import datetime
                date_folder = datetime.now().strftime("%d %B %Y")
                ss_dir = os.path.join("screenshots", "Auto Posting Pictures", date_folder)
                os.makedirs(ss_dir, exist_ok=True)
                ss_path = os.path.abspath(os.path.join(ss_dir, f"post_success_{int(time.time())}.png"))
                
                page.screenshot(path=ss_path)
                log(f"Expanded post screenshot taken: {ss_path}")
                
                # Close the expanded view
                close_btn = page.locator('button[aria-label="Close expanded post"], button:has(svg[data-icon="close-small"])').first
                if close_btn.is_visible():
                    close_btn.click(force=True)
                interruptible_sleep(1.0)
            except Exception as e:
                log(f"Warning: Failed to take expanded screenshot: {e}")

            # Cooldown Scroll & Final Spammer Processing
            cooldown_time = 0 if used_fallback else 15
            
            if used_fallback:
                log("Navigating back to News Feed before closing (skipping 15s scroll)...")
            else:
                log("Navigating back to News Feed for 15s cooldown scroll...")
                
            try:
                smart_navigate("https://nextdoor.com/news_feed/")
                check_banned()
                dismiss_intercepting_popups()
                
                if cooldown_time > 0:
                    log(f"Feed re-loaded. Starting {cooldown_time}s of active cooldown scrolling and processing remaining spammers...")
                    page.evaluate("window.scrollTo(0, 0)")
                    interruptible_sleep(1.0)
                    
                    scroll_start = time.time()
                    while time.time() - scroll_start < cooldown_time:
                        page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
                        if spammer_urls:
                            batch = []
                            while spammer_urls and len(batch) < 5:
                                batch.append(spammer_urls.pop(0))
                            process_spammer_batch(batch, fast_mode=False)
                        else:
                            interruptible_sleep(random.uniform(1.8, 2.2))
                else:
                    log("Feed re-loaded. Skipping active cooldown scroll because profile fallback was used.")
                
                # If there are still spammers left after the cooldown, burst them now
                if spammer_urls:
                    log(f"Burst processing {len(spammer_urls)} remaining spammers before closing...")
                    while spammer_urls:
                        batch = []
                        while spammer_urls and len(batch) < 5:
                            batch.append(spammer_urls.pop(0))
                        process_spammer_batch(batch, fast_mode=True)
                        
                log("Cooldown scroll and spammer processing complete.")
            except Exception as e:
                log(f"Warning during cooldown scroll: {e}")

            # Cleanup temp images
            if downloaded_images:
                for img_path in downloaded_images:
                    try:
                        if os.path.exists(img_path):
                            os.remove(img_path)
                    except Exception as e:
                        log(f"Warning: Could not remove temp file {img_path}: {e}")

            try:
                for p_to_close in context.pages:
                    try: p_to_close.close()
                    except: pass
            except: pass
            context.close()
            browser.close()

            if not clicked_post:
                raise Exception(
                    "Failed to complete the posting flow (Post/Save button never clicked)."
                )
            return True, post_link

    except Exception as e:
        log(f"Playwright Error during posting: {str(e)}")
        return False, str(e)
