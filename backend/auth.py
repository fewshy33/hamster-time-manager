import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl

from fastapi import HTTPException, Request


@dataclass(frozen=True)
class Identity:
    id: int
    name: str


def identify(request: Request) -> Identity:
    token = os.getenv("BOT_TOKEN", "").strip()
    if not token:
        raise HTTPException(503, "Сервер ещё не подключён к боту. Проверьте BOT_TOKEN.")
    data = request.headers.get("authorization", "")
    if not data.startswith("tma ") or len(data) > 8192:
        raise HTTPException(401, "Откройте приложение кнопкой в чате с ботом.")
    try:
        pairs = parse_qsl(data[4:], keep_blank_values=True, strict_parsing=True, max_num_fields=32)
        fields = dict(pairs)
        if len(fields) != len(pairs):
            raise ValueError
        supplied = fields.pop("hash")
        check = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
        secret = hmac.digest(b"WebAppData", token.encode(), hashlib.sha256)
        expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, supplied):
            raise ValueError
        age = time.time() - int(fields["auth_date"])
        if not -30 <= age <= 86400:
            raise ValueError
        telegram_user = json.loads(fields["user"])
        user_id = telegram_user["id"]
        name = telegram_user.get("first_name") or "Друг"
        if type(user_id) is not int or user_id < 1 or not isinstance(name, str):
            raise ValueError
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(401, "Сеанс Telegram недействителен. Откройте приложение заново.") from None
    return Identity(user_id, name[:128])
