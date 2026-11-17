from __future__ import annotations

import copy
from collections import Counter

import pytest

from acephale.custom_native_tasks import (
    OPERATIONS,
    airline_blueprint,
    expected_database,
    family_plan,
    overlap_report,
    retail_blueprint,
)


def test_family_split_precedes_entities_and_discloses_shared_intents():
    plan = family_plan()
    assert plan == family_plan()
    assert len(plan) == 44
    assert Counter(row["partition"] for row in plan) == {"weight_fit": 24, "calibration": 6, "development": 6, "test": 8}
    for domain in OPERATIONS:
        rows = [row for row in plan if row["domain"] == domain]
        assert len({tuple(row["operations"]) for row in rows}) == 22
        fitting = [row for row in rows if row["partition"] == "weight_fit"]
        assert {operation for row in fitting for operation in row["operations"]} == set(OPERATIONS[domain])
        assert all(len(row["operations"]) >= 3 for row in rows if row["partition"] == "test")
    report = overlap_report(plan)
    assert report["unseenPrimitiveClaim"] is False
    assert any(row["sharedPrimitives"] for row in report["crossPartitionPairs"])
    assert all(row["jaccard"] < 1 for row in report["crossPartitionPairs"])


def retail_catalog():
    return {"users": {}, "orders": {}, "products": {"product": {"name": "Cotton shirt", "product_id": "product",
        "variants": {"old": {"item_id": "old", "options": {"size": "M"}, "available": True, "price": 30.0},
                     "new": {"item_id": "new", "options": {"size": "L"}, "available": True, "price": 35.0}}}}}


def test_retail_fixture_is_fresh_owned_and_does_not_rewrite_catalog():
    database = retail_catalog()
    original = copy.deepcopy(database)
    family = {"familyId": "retail-fixture", "partition": "weight_fit", "domain": "retail", "operations": list(OPERATIONS["retail"])}
    first, second = (retail_blueprint(family, variant, database) for variant in (0, 1))
    assert database == original
    assert first["task"]["evaluation_criteria"]["reward_basis"] == ["DB"]
    overlay = first["task"]["initial_state"]["initialization_data"]["agent_data"]
    assert "products" not in overlay
    assert len(overlay["users"]) == 1 and len(overlay["orders"]) == 4
    user = next(iter(overlay["users"].values()))
    assert set(user["orders"]) == set(overlay["orders"])
    assert all(order["user_id"] == user["user_id"] for order in overlay["orders"].values())
    assert user["user_id"] not in second["task"]["initial_state"]["initialization_data"]["agent_data"]["users"]
    assert len(first["task"]["evaluation_criteria"]["actions"]) == 5


def test_airline_blueprint_uses_future_existing_flights_and_separate_reservations():
    dates = {date: {"status": "available", "available_seats": {"economy": 3, "business": 2},
                    "prices": {"economy": price, "business": 500}}
             for date, price in (("2024-05-20", 200), ("2024-05-21", 230))}
    database = {"users": {}, "reservations": {}, "flights": {"HAT123": {"flight_number": "HAT123", "origin": "JFK", "destination": "LAX", "dates": dates}}}
    family = {"familyId": "airline-fixture", "partition": "weight_fit", "domain": "airline", "operations": list(OPERATIONS["airline"])}
    row = airline_blueprint(family, 0, database)
    overlay = row["task"]["initial_state"]["initialization_data"]["agent_data"]
    assert "flights" not in overlay
    assert len(overlay["reservations"]) == 5
    assert all(reservation["created_at"] == "2024-05-15T10:00:00" for reservation in overlay["reservations"].values())
    changed = next(action for action in row["task"]["evaluation_criteria"]["actions"] if action["action_id"] == "reschedule_date")
    assert changed["arguments"]["flights"] == [{"flight_number": "HAT123", "date": "2024-05-21"}]
    assert len(row["outcomeChecks"]) > 5


def test_independent_oracle_preserves_every_unmentioned_database_field():
    initial = {"orders": {"one": {"status": "pending", "amount": 20}, "other": {"status": "pending"}}}
    target = expected_database(initial, [{"path": ["orders", "one", "status"], "value": "cancelled"}])
    assert target["orders"]["one"] == {"status": "cancelled", "amount": 20}
    assert target["orders"]["other"] == initial["orders"]["other"]
    assert initial["orders"]["one"]["status"] == "pending"
    with pytest.raises(ValueError, match="unknown state field"):
        expected_database(initial, [{"path": ["orders", "one", "missing"], "value": 1}])
