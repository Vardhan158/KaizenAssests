from pathlib import Path


def test_startup_does_not_register_kafka_background_tasks() -> None:
    main_source = Path(__file__).parents[2].joinpath("app", "main.py").read_text(encoding="utf-8")

    assert "start_producer" not in main_source
    assert "start_notification_consumer" not in main_source
    assert "outbox-relay" not in main_source
