"""Minimal HTTP transport (stdlib only) so tests can swap it out."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class Response:
    status: int
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict)  # lower-cased keys

    def json(self):
        return json.loads(self.body) if self.body else None


Send = Callable[[str, str, dict, Optional[bytes]], Response]


def urllib_send(method: str, url: str, headers: dict, body: Optional[bytes]) -> Response:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return Response(r.status, r.read(), {k.lower(): v for k, v in r.headers.items()})
    except urllib.error.HTTPError as e:
        return Response(e.code, e.read(), {k.lower(): v for k, v in e.headers.items()})
