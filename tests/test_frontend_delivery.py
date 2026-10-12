"""Compiled SPA delivery: build frontend/ first, as CI and Docker do."""
from pathlib import Path

from fastapi.testclient import TestClient

from grid_report.api import app


def test_unbuilt_frontend_has_actionable_response(tmp_path, monkeypatch):
    monkeypatch.setattr("grid_report.api.STATIC", tmp_path)
    response = TestClient(app).get("/")
    assert response.status_code == 503
    assert "npm run build" in response.json()["detail"]


def test_compiled_spa_and_packaged_fonts():
    import grid_report.api as api

    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200, "Run npm ci and npm run build in frontend/ first"
    assert 'id="root"' in response.text
    assert "/static/spa/assets/" in response.text
    assets = list((api.STATIC / "spa" / "assets").iterdir())
    assert {asset.suffix for asset in assets} >= {".css", ".js"}
    for asset in assets:
        served = client.get(f"/static/spa/assets/{asset.name}")
        assert served.status_code == 200
        assert served.content == asset.read_bytes()
    for weight in (400, 500, 900):
        font = Path("fonts") / f"hanken-grotesk-{weight}.ttf"
        assert client.get(f"/static/{font.as_posix()}").content == (api.STATIC / font).read_bytes()
    assert client.get("/static/app.js").status_code == 404
