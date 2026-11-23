#!/usr/bin/env python3
"""Verify the favicon declared by the built server's embedded page."""

import sys
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.request import urlopen
from xml.etree import ElementTree


class IconParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.href = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link" and "icon" in attrs.get("rel", "").split():
            self.href = attrs.get("href")


base_url = sys.argv[1]
with urlopen(base_url) as response:
    page = response.read().decode("utf-8")

parser = IconParser()
parser.feed(page)
if not parser.href:
    raise SystemExit("Page does not declare a favicon href")

with urlopen(urljoin(base_url, parser.href)) as response:
    if response.status != 200 or response.headers.get_content_type() != "image/svg+xml":
        raise SystemExit("Favicon response is not an SVG")
    root = ElementTree.fromstring(response.read())
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise SystemExit("Favicon response has no SVG root")

print("Embedded page favicon is valid SVG")
