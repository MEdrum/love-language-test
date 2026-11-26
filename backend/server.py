"""SQLite-backed result storage for the quiz."""
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,63}", re.ASCII)
SESSION_ID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.ASCII)
QUESTION_ID = re.compile(r"[A-Za-z0-9_\-]{1,160}", re.ASCII)
RESULT_PATH = "/api/v1/results/"
MAX_BYTES = 128 * 1024


class ApiError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)


def read_date(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def valid_date(value):
    if not isinstance(value, str) or len(value) > 35:
        return False
    try:
        return read_date(value).tzinfo is not None
    except ValueError:
        return False


def valid_result(result):
    if not isinstance(result, dict):
        return False
    session_id = result.get("sessionId")
    name = result.get("name")
    answers = result.get("answers")
    summary = result.get("summary")
    if not (isinstance(session_id, str) and SESSION_ID.fullmatch(session_id)
            and isinstance(name, str) and 0 < len(name.strip()) <= 80
            and type(result.get("bankVersion")) is int
            and valid_date(result.get("createdAt")) and valid_date(result.get("updatedAt"))
            and (result.get("completedAt") is None or valid_date(result["completedAt"]))
            and isinstance(answers, list) and len(answers) <= 100
            and isinstance(summary, dict)):
        return False
    seen = set()
    for answer in answers:
        if not isinstance(answer, dict):
            return False
        qid = answer.get("questionId")
        if not isinstance(qid, str) or not QUESTION_ID.fullmatch(qid) or qid in seen:
            return False
        if answer.get("answer") not in ("a", "b", "skip") or answer.get("displayOrder") not in (["a", "b"], ["b", "a"]):
            return False
        seen.add(qid)
    models = summary.get("models")
    if not (summary.get("asked") == len(answers)
            and summary.get("answered") == sum(a["answer"] != "skip" for a in answers)
            and isinstance(models, list) and 1 <= len(models) <= 3):
        return False
    for model in models:
        if not isinstance(model, dict) or model.get("id") not in ("classic5", "modern7", "research10"):
            return False
        categories = model.get("categories")
        if not isinstance(categories, list) or not 2 <= len(categories) <= 10:
            return False
        for category in categories:
            if not isinstance(category, dict):
                return False
            label, score = category.get("label"), category.get("score")
            if not (isinstance(label, str) and 0 < len(label) <= 100
                    and type(score) in (float, int) and 0 <= score <= 100):
                return False
        certainty = model.get("certainty")
        if certainty is not None:
            if not (isinstance(certainty, dict)
                    and all(isinstance(certainty.get(k), str) and 0 < len(certainty[k]) <= 100 for k in ("leading", "runnerUp"))
                    and type(certainty.get("probability")) in (float, int)
                    and 0.5 <= certainty["probability"] <= 1):
                return False
        if not (type(model.get("covered")) is int and 0 <= model["covered"] <= len(categories)
                and type(model.get("targetMet")) is bool):
            return False
    return True


class ResultServer(ThreadingHTTPServer):
    def __init__(self, address, database_path, origins):
        self.database_path = database_path
        self.origins = origins
        with closing(self.connect()) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS results (
                slug TEXT PRIMARY KEY,
                session_id TEXT NOT NULL UNIQUE,
                password_salt BLOB,
                password_hash BLOB,
                payload TEXT NOT NULL,
                saved_at TEXT NOT NULL
            )""")
        super().__init__(address, ResultHandler)

    def connect(self):
        db = sqlite3.connect(self.database_path, timeout=5)
        db.row_factory = sqlite3.Row
        return db


class ResultHandler(BaseHTTPRequestHandler):
    # Request paths include result slugs. Avoid putting them in the application log.
    def log_request(self, code="-", size="-"):
        pass

    def send_json(self, status, value=None):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode() if value is not None else b""
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def slug(self):
        path = urlsplit(self.path).path
        slug = path[len(RESULT_PATH):]
        if not path.startswith(RESULT_PATH) or not SLUG.fullmatch(slug):
            raise ApiError(404, "Result not found.")
        return slug

    def password(self):
        value = self.headers.get("Authorization")
        if not value:
            return ""
        if not value.startswith("Basic ") or len(value) > 1500:
            raise ApiError(400, "Invalid password header.")
        try:
            user, password = base64.b64decode(value[6:], validate=True).decode().split(":", 1)
        except (UnicodeError, ValueError, binascii.Error):
            raise ApiError(400, "Invalid password header.") from None
        if user != "result" or len(password) > 256:
            raise ApiError(400, "Invalid password header.")
        return password

    def read_payload(self):
        try:
            size = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise ApiError(411, "Content length required.") from None
        if size > MAX_BYTES or size < 1:
            raise ApiError(413, "The result is too large or empty.")
        if self.headers.get_content_type() != "application/json":
            raise ApiError(415, "Send the result as JSON.")
        try:
            result = json.loads(self.rfile.read(size), parse_constant=lambda value: None)
        except (UnicodeError, ValueError, RecursionError):
            raise ApiError(400, "Invalid result JSON.") from None
        if not valid_result(result):
            raise ApiError(400, "The result is incomplete or invalid.")
        return result

    def dispatch(self):
        slug = self.slug()
        origin = self.headers.get("Origin")
        if origin and origin not in self.server.origins:
            raise ApiError(403, "This origin cannot access the result service.")
        password = self.password()
        payload = self.read_payload() if self.command == "PUT" else None
        with closing(self.server.connect()) as db, db:
            if self.command in ("PUT", "DELETE"):
                db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM results WHERE slug = ?", (slug,)).fetchone()
            if row and row["password_hash"] is not None:
                if not password or not hmac.compare_digest(password_hash(password, row["password_salt"]), row["password_hash"]):
                    raise ApiError(401, "Enter the result password.")
            if self.command == "PUT":
                existing = db.execute("SELECT slug FROM results WHERE session_id = ?", (payload["sessionId"],)).fetchone()
                if (row and row["session_id"] != payload["sessionId"]) or (existing and existing["slug"] != slug):
                    raise ApiError(409, "This slug is taken, or this session already uses another slug.")
                if row and read_date(payload["updatedAt"]) < read_date(json.loads(row["payload"])["updatedAt"]):
                    raise ApiError(409, "A newer copy of this session is already stored.")
                salt, hashed = (row["password_salt"], row["password_hash"]) if row else (None, None)
                if hashed is None and password:
                    salt = secrets.token_bytes(16)
                    hashed = password_hash(password, salt)
                saved_at = datetime.now(timezone.utc).isoformat()
                db.execute("""INSERT INTO results VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(slug) DO UPDATE SET password_salt=excluded.password_salt,
                        password_hash=excluded.password_hash, payload=excluded.payload, saved_at=excluded.saved_at""",
                    (slug, payload["sessionId"], salt, hashed, json.dumps(payload, allow_nan=False), saved_at))
                result = {"slug": slug, "savedAt": saved_at, "passwordProtected": hashed is not None}
                status = 200 if row else 201
            elif not row:
                raise ApiError(404, "Result not found.")
            elif self.command == "DELETE":
                db.execute("DELETE FROM results WHERE slug = ?", (slug,))
                status, result = 204, None
            else:
                status, result = 200, {"slug": slug, "savedAt": row["saved_at"],
                                       "passwordProtected": row["password_hash"] is not None,
                                       "result": json.loads(row["payload"])}
        self.send_json(status, result)

    def handle_result(self):
        try:
            self.dispatch()
        except ApiError as error:
            self.send_json(error.status, {"error": error.message})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except (sqlite3.Error, ValueError, OverflowError, RecursionError):
            self.send_json(500, {"error": "The result service could not complete the request."})

    def do_OPTIONS(self):
        try:
            self.slug()
        except ApiError as error:
            self.send_json(error.status, {"error": error.message})
            return
        origin = self.headers.get("Origin")
        if origin not in self.server.origins:
            self.send_json(403, {"error": "This origin cannot access the result service."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = handle_result
    do_PUT = handle_result
    do_DELETE = handle_result

    def setup(self):
        self.request.settimeout(10)
        super().setup()


if __name__ == "__main__":
    os.umask(0o077)
    allowed = set(os.environ.get("QUIZ_ORIGINS", "https://medrum.github.io,https://lovelang.fabianflow.de").split(","))
    server = ResultServer((os.environ.get("BIND_HOST", "127.0.0.1"), int(os.environ.get("PORT", "8770"))),
                          os.environ.get("RESULT_DB", "results.sqlite3"), allowed)
    server.serve_forever()
