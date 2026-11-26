import base64
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from server import ResultServer

ORIGIN = "https://medrum.github.io"


class ResultApiTests(unittest.TestCase):
    def test_protected_and_public_crud_with_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            self.database = Path(directory) / "results.sqlite3"
            self.start_server()
            try:
                payload = {
                    "sessionId": str(uuid4()), "bankVersion": 8, "name": "API test",
                    "createdAt": "2026-01-01T10:00:00Z", "updatedAt": "2026-01-01T10:00:00Z", "completedAt": None,
                    "answers": [{"questionId": "example", "answer": "b", "displayOrder": ["b", "a"]}],
                    "summary": {"answered": 1, "asked": 1, "reason": "early", "models": [
                        {"id": "classic5", "covered": 2, "targetMet": False, "certainty": None,
                         "categories": [{"label": "Touch", "score": 70}, {"label": "Time", "score": 30}]}
                    ]}
                }
                self.assertEqual(self.request("OPTIONS", "example")[0], 204)
                self.assertEqual(self.request("PUT", "example", payload, "mötley")[0], 201)
                self.assertEqual(self.request("GET", "example")[0], 401)
                self.assertEqual(self.request("DELETE", "example", password="incorrect")[0], 401)
                updated = dict(payload, name="Revised", updatedAt="2026-01-01T10:01:00Z")
                self.assertEqual(self.request("PUT", "example", updated)[0], 401)
                self.assertEqual(self.request("PUT", "example", updated, "mötley")[0], 200)
                self.assertEqual(self.request("PUT", "example", payload, "mötley")[0], 409)
                self.assertEqual(self.request("PUT", "another-slug", updated)[0], 409)
                self.assertEqual(self.request("PUT", "example", dict(payload, sessionId=str(uuid4())), "mötley")[0], 409)
                with sqlite3.connect(self.database) as db:
                    stored, password_hash = db.execute("SELECT payload, password_hash FROM results").fetchone()
                    self.assertEqual(json.loads(stored), updated)
                    self.assertNotEqual(password_hash, "mötley".encode())
            finally:
                self.stop_server()
            self.start_server()
            try:
                status, shared = self.request("GET", "example", password="mötley")
                self.assertEqual(status, 200)
                self.assertEqual(shared["result"], updated)
                self.assertEqual(self.request("DELETE", "example", password="mötley")[0], 204)
                self.assertEqual(self.request("GET", "example")[0], 404)
                self.assertEqual(self.request("PUT", "public-example", payload)[0], 201)
                self.assertEqual(self.request("GET", "public-example")[0], 200)
                self.assertEqual(self.request("DELETE", "public-example")[0], 204)
            finally:
                self.stop_server()

    def start_server(self):
        self.server = ResultServer(("127.0.0.1", 0), self.database, {ORIGIN})
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, slug, payload=None, password=None):
        headers = {"Origin": ORIGIN}
        if method == "OPTIONS":
            headers["Access-Control-Request-Method"] = "PUT"
        if password:
            headers["Authorization"] = "Basic " + base64.b64encode(f"result:{password}".encode()).decode()
        if payload is not None:
            headers["Content-Type"] = "application/json"
        url = f"http://127.0.0.1:{self.server.server_port}/api/v1/results/{slug}"
        request = Request(url, method=method, headers=headers,
                          data=json.dumps(payload).encode() if payload is not None else None)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], ORIGIN)
            data = response.read()
            return response.code, json.loads(data) if data else None
