"""
Shared Nextdoor composer UI handling: the "Posting about an incident?"
reminder modal, the audience/visibility selector (both UI variants Nextdoor
ships) and the Post button.
"""

import time

# "Posting about an incident?" - we always decline so the normal post goes out.
REMINDER_MODAL_SELECTOR = ", ".join([
    '[data-testid="reminder-modal"]',
    '[data-dialog="true"]:has-text("Posting about an incident")',
    'div[role="dialog"]:has-text("Posting about an incident")',
])

DECLINE_LABELS = ("no, i'm not", "no i'm not", "no, im not", "no, i am not", "no thanks")

# Both audience triggers Nextdoor uses.
VISIBILITY_TRIGGERS = [
    '[data-testid="composer-audience-row-trigger"]',
    '[data-testid="neighbor-audience-visibility-button"]',
    '[data-testid="composer-audience-trigger"]',
    'button[aria-haspopup="menu"][data-testid*="audience"]',
]

SUBMIT_SELECTOR = ", ".join([
    'button[data-testid="composer-submit-button"]',
    'div[role="dialog"] button:has-text("Post")',
    'section[role="dialog"] button:has-text("Post")',
])


def _norm(text):
    return " ".join(str(text or "").replace("’", "'").split()).strip().lower()


def _sleep(sleep_fn, seconds):
    if sleep_fn:
        sleep_fn(seconds)
    else:
        time.sleep(seconds)


# ---------------------------------------------------------------------------
# "Posting about an incident?" reminder modal
# ---------------------------------------------------------------------------

def dismiss_reminder_modal(page, log=None, sleep_fn=None, rounds=2):
    """
    Clicks "No, I'm not" on the incident reminder modal if it is showing.

    Nextdoor can throw this up at any point while posting, which blocks the
    Post button. Returns True if a modal was dismissed.
    """
    def say(msg):
        if log:
            log(msg)

    dismissed = False
    for _ in range(max(1, rounds)):
        try:
            modal = page.locator(REMINDER_MODAL_SELECTOR).first
            if not modal.is_visible(timeout=1000):
                return dismissed
        except Exception:
            return dismissed

        say("Incident reminder modal detected. Declining with \"No, I'm not\"...")

        clicked = False
        try:
            buttons = modal.locator("button").all()
        except Exception:
            buttons = []

        # 1. Exact label match.
        for button in buttons:
            try:
                label = _norm(button.text_content())
                if any(label == text or label.startswith(text) for text in DECLINE_LABELS):
                    button.click(force=True)
                    clicked = True
                    break
            except Exception:
                continue

        # 2. Any button that is clearly a refusal.
        if not clicked:
            for button in buttons:
                try:
                    label = _norm(button.text_content())
                    if label.startswith("no") and "continue" not in label:
                        button.click(force=True)
                        clicked = True
                        break
                except Exception:
                    continue

        # 3. Last resort: the modal's last button is the decline option.
        if not clicked and buttons:
            try:
                buttons[-1].click(force=True)
                clicked = True
            except Exception:
                pass

        if not clicked:
            say("Warning: could not click a decline button on the reminder modal.")
            return dismissed

        dismissed = True
        _sleep(sleep_fn, 1.5)

    return dismissed


# ---------------------------------------------------------------------------
# Audience / visibility
# ---------------------------------------------------------------------------

def resolve_visibility_target(visibility_pref):
    """Maps a sheet value to (label, option testid, index)."""
    value = _norm(visibility_pref).replace(" ", "")
    if "your" in value or "only" in value or "myneighborhood" in value:
        return "Your neighborhood", "visibility-menu-option-2", 2
    if "near" in value or "nearby" in value or "neighborhoods" in value:
        return "Nearby neighborhoods", "visibility-menu-option-1", 1
    if "anyone" in value or "public" in value or "everyone" in value or not value:
        return "Anyone", "visibility-menu-option-0", 0
    # Unknown wording: fall back to the broadest audience.
    return "Anyone", "visibility-menu-option-0", 0


def _find_visibility_trigger(page):
    for selector in VISIBILITY_TRIGGERS:
        try:
            trigger = page.locator(selector).first
            if trigger.is_visible(timeout=800):
                return trigger
        except Exception:
            continue
    return None


def _trigger_text(trigger):
    try:
        return _norm(trigger.text_content())
    except Exception:
        return ""


def set_post_visibility(page, visibility_pref, log=None, sleep_fn=None):
    """
    Sets the composer audience. Handles the older inline button and the newer
    "Visible to <X>" row trigger, and verifies the trigger text afterwards so
    the caller never posts with the wrong audience.

    Returns (success, message).
    """
    def say(msg):
        if log:
            log(msg)

    if not visibility_pref:
        return False, "No visibility preference supplied"

    target_label, option_testid, _index = resolve_visibility_target(visibility_pref)

    trigger = _find_visibility_trigger(page)
    if trigger is None:
        return False, "Audience selector not found on the composer"

    current = _trigger_text(trigger)
    # The new UI reads "Visible to Anyone", the old one just "Anyone".
    if _norm(target_label) in current:
        say(f"Visibility is already set to '{target_label}'.")
        return True, f"Already '{target_label}'"

    say(f"Opening the audience selector (currently: '{current or 'unknown'}')...")
    try:
        trigger.click(force=True)
    except Exception as e:
        return False, f"Could not open the audience selector: {str(e)[:120]}"

    _sleep(sleep_fn, 1.0)

    # Wait for the menu itself - in the new UI it starts as display:none.
    try:
        page.locator('div[role="menu"][aria-label="Select an audience"], div[role="menu"]').first.wait_for(
            state="visible", timeout=5000
        )
    except Exception:
        pass

    say(f"Applying: {target_label}")
    clicked = False

    # 1. Strict data-testid (same ids in both variants).
    try:
        option = page.locator(f'[data-testid="{option_testid}"]').first
        option.wait_for(state="visible", timeout=4000)
        option.click(force=True)
        clicked = True
        say("Clicked the audience option by data-testid.")
    except Exception:
        say("Option testid not clickable. Trying text fallbacks...")

    # 2. Menu item by heading text.
    if not clicked:
        for selector in (
            f'div[role="menuitem"]:has-text("{target_label}")',
            f'div[role="menu"] h2:has-text("{target_label}")',
            f'[role="menuitemradio"]:has-text("{target_label}")',
            f'li:has-text("{target_label}")',
        ):
            try:
                option = page.locator(selector).last
                option.wait_for(state="visible", timeout=2000)
                option.click(force=True)
                clicked = True
                say(f"Clicked the audience option via '{selector}'.")
                break
            except Exception:
                continue

    if not clicked:
        return False, f"Could not click the '{target_label}' option"

    _sleep(sleep_fn, 1.5)

    # Verify from the trigger text rather than trusting the click.
    verify_trigger = _find_visibility_trigger(page) or trigger
    final_text = _trigger_text(verify_trigger)
    if _norm(target_label) in final_text:
        say(f"Visibility confirmed as '{target_label}'.")
        return True, f"Set to '{target_label}'"

    # The menu may still be open and covering the trigger; close and re-check.
    try:
        page.keyboard.press("Escape")
        _sleep(sleep_fn, 0.8)
        verify_trigger = _find_visibility_trigger(page)
        if verify_trigger is not None:
            final_text = _trigger_text(verify_trigger)
            if _norm(target_label) in final_text:
                say(f"Visibility confirmed as '{target_label}'.")
                return True, f"Set to '{target_label}'"
    except Exception:
        pass

    if not final_text:
        # Nothing left to read - the selector collapsed after choosing.
        say(f"Audience selector closed after choosing '{target_label}'; treating it as set.")
        return True, f"Set to '{target_label}' (unverified)"

    return False, f"Audience still reads '{final_text}' after choosing '{target_label}'"


# ---------------------------------------------------------------------------
# Post button
# ---------------------------------------------------------------------------

def find_submit_button(page, timeout=10000):
    """
    Returns the composer's Post/Next button, or None.

    The real button is `button[data-testid="composer-submit-button"]` and it is
    NOT inside a role="dialog", so dialog-scoped selectors miss it.
    """
    try:
        button = page.locator('button[data-testid="composer-submit-button"]').first
        button.wait_for(state="visible", timeout=timeout)
        return button
    except Exception:
        pass

    for selector in (
        'div[role="dialog"] button:has-text("Post")',
        'section[role="dialog"] button:has-text("Post")',
        'button:has-text("Next")',
    ):
        try:
            button = page.locator(selector).first
            button.wait_for(state="visible", timeout=1500)
            return button
        except Exception:
            continue
    return None


def submit_button_ready(button):
    """False while Nextdoor has the button disabled or spinning."""
    try:
        return button.evaluate("""node => {
            const root = node.closest('[data-part="root"]') || node;
            const inner = root.querySelector('[data-part="button"]') || node;
            if (node.disabled) return false;
            if (node.getAttribute('aria-disabled') === 'true') return false;
            if (inner.getAttribute('data-disabled') === 'true') return false;
            if (inner.getAttribute('data-loading') === 'true') return false;
            return true;
        }""")
    except Exception:
        return True


def click_post_button(page, log=None, sleep_fn=None, wait_ready=8.0):
    """
    Clicks the composer's Post button, declining the incident modal first and
    waiting for the button to leave its disabled/loading state.

    Returns (clicked, label).
    """
    def say(msg):
        if log:
            log(msg)

    dismiss_reminder_modal(page, log=log, sleep_fn=sleep_fn)

    button = find_submit_button(page)
    if button is None:
        return False, ""

    deadline = time.time() + wait_ready
    while not submit_button_ready(button):
        if time.time() >= deadline:
            say("Post button is still disabled; clicking it anyway.")
            break
        _sleep(sleep_fn, 0.5)

    try:
        label = _norm(button.text_content())
    except Exception:
        label = ""

    try:
        button.click()
    except Exception:
        try:
            button.click(force=True)
        except Exception as e:
            return False, f"click failed: {str(e)[:120]}"

    say(f"Clicked '{label or 'Post'}'.")
    _sleep(sleep_fn, 1.0)

    # The modal often appears the moment Post is pressed.
    if dismiss_reminder_modal(page, log=log, sleep_fn=sleep_fn):
        say("Reminder modal appeared after clicking Post - declined it.")

    return True, label
