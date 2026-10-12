"""Readiness responses must be explicit and must not expose database errors."""
from contextlib import contextmanager

import psycopg
import pytest
from fastapi.testclient import TestClient

from grid_report.api import app


@pytest.mark.parametrize("failure,expected", [
    (None, {"status": "ok", "database": "ok", "schema": "ready"}),
    (psycopg.errors.UndefinedTable, {
        "status": "unavailable", "database": "ok", "schema": "not_ready"}),
    (psycopg.errors.UndefinedColumn, {
        "status": "unavailable", "database": "ok", "schema": "not_ready"}),
    (psycopg.OperationalError, {
        "status": "unavailable", "database": "unavailable", "schema": "unknown"}),
])
def test_health_readiness(monkeypatch, failure, expected):
    queries = []

    class Connection:
        def execute(self, query):
            queries.append(query)
            if failure and query != "SELECT 1":
                raise failure("secret database diagnostic")

    @contextmanager
    def connect():
        if failure is psycopg.OperationalError:
            raise failure("secret connection string")
        yield Connection()

    monkeypatch.setattr("grid_report.api.db.connect", connect)
    response = TestClient(app).get("/health")
    assert response.status_code == (200 if failure is None else 503)
    assert response.json() == expected
    assert "secret" not in response.text
    if failure is None:
        assert len(queries) == 3
