"""Exercise the smoke script's actual validator without opening Dagster instance storage."""
from pathlib import Path

import dagster as dg
import pytest


def test_smoke_validation_does_not_initialize_dagster_home(tmp_path, monkeypatch, capsys):
    home = tmp_path / "dagster-home"
    home.mkdir()
    marker = home / "existing-metadata"
    marker.write_text("untouched")
    monkeypatch.setenv("DAGSTER_HOME", str(home))

    def forbidden_instance(*args, **kwargs):
        pytest.fail("Definitions validation must not open shared instance storage")

    monkeypatch.setattr(dg.DagsterInstance, "get", forbidden_instance)
    script = (Path(__file__).parents[1] / "scripts/smoke_compose.sh").read_text()
    validator = script.split('exec -T dagster python - <<\'PY\'\n', 1)[1].split('\nPY\n', 1)[0]
    exec(compile(validator, "smoke-definition-validation", "exec"), {})
    assert "definitions validated without instance storage" in capsys.readouterr().out
    assert list(home.iterdir()) == [marker]
    assert marker.read_text() == "untouched"


def test_validation_rejects_unresolved_resources():
    @dg.asset(required_resource_keys={"missing"})
    def invalid_asset():
        return 1

    with pytest.raises(dg.DagsterInvalidDefinitionError):
        dg.Definitions.validate_loadable(dg.Definitions(assets=[invalid_asset]))
