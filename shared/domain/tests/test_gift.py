"""Gift link helpers (shared/domain/gift.py) + the gift_link URL button."""
import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import pytest  # noqa: E402

from shared.domain import gift as g  # noqa: E402


def test_links_and_phones():
    assert g.provider_of("https://links.payboxapp.com/x") == "paybox"
    assert g.provider_of("https://www.bitpay.co.il/x") == "bit"
    assert g.provider_of("https://example.com/x") == "other"
    for bad in ("http://payboxapp.com/x", "javascript:alert(1)", "https://x", "https://a.com/ b"):
        with pytest.raises(ValueError):
            g.clean_url(bad)
    assert g.clean_bit_phone("+972-52-540-1686") == "0525401686" and g.clean_bit_phone("") == ""
    with pytest.raises(ValueError):
        g.clean_bit_phone("03-1234567")


def test_merge_keeps_code_and_ready_needs_details():
    a = g.merge_gift(None, {"url": "https://payboxapp.page.link/q"})
    b = g.merge_gift(a, {"bit_phone": "0501234567", "code": "hacked"})
    assert b["code"] == a["code"] and b["paybox_url"] == a["paybox_url"] and g.gift_ready(b)
    c = g.merge_gift(b, {"url": "", "bit_phone": ""})
    assert not g.gift_ready(c) and g.gift_page_code(c) == a["code"]
    assert g.format_phone("0525401686") == "052-540-1686"


def test_card_and_bit_together():
    a = g.merge_gift(None, {"card_url": "https://www.giftcard.co.il/x", "bit_url": "https://www.bitpay.co.il/g"})
    assert [o["kind"] for o in g.gift_options(a)] == ["card", "bit"] and g.gift_ready(a)
    b = g.merge_gift(a, {"paybox_url": "https://links.payboxapp.com/p", "bit_url": ""})
    assert [o["kind"] for o in g.gift_options(b)] == ["card", "paybox"]
    for bad in ({"card_url": "http://x.com"}, {"bit_url": "javascript:x"}):
        with pytest.raises(ValueError):
            g.merge_gift(b, bad)


def test_legacy_single_url_is_read_by_provider():
    legacy = {"url": "https://www.bitpay.co.il/g", "bit_phone": "", "code": "abc"}
    assert g.gift_options(legacy) == [{"kind": "bit", "url": "https://www.bitpay.co.il/g"}] and g.gift_ready(legacy)
    moved = g.merge_gift(legacy, {"card_url": "https://pay.example.com/c"})
    assert moved["bit_url"] == "https://www.bitpay.co.il/g" and moved["code"] == "abc" and "url" not in moved


def test_gift_button_publishes_under_g():
    from shared.domain.messaging.catalog import UrlButton
    from shared.domain.messaging.publishing import _url_button
    b = _url_button(UrlButton(label="למתנה", url_var="gift_link"))
    assert b["url"].endswith("/g/{{1}}") and b["example"][0].endswith("/g/demo")
