"""Fresh compositional tasks with native tools and independently specified DB outcomes.

No official task text is imported. Catalog facts, policies and native tools remain
pinned. Shared primitive intents are disclosed; families represent combinations,
not previously unseen intents. Generation and verification make no model calls.
"""

from __future__ import annotations

import argparse
import copy
import itertools
import json
from collections import Counter
from pathlib import Path
from typing import Any

from acephale.contracts_v1 import hash_v1
from acephale.native_common import REVISION
from acephale.storage import file_hash
from acephale.training_data import file_inventory, hashed, verify_hashed, write_new

OPERATIONS = {
    "retail": ("cancel_pending", "shipping_address", "default_address", "return_delivered", "exchange_variant"),
    "airline": ("cancel_within_24h", "add_baggage", "correct_passenger", "upgrade_cabin", "reschedule_date"),
}
QUOTAS = {"weight_fit": {1: 5, 2: 4, 3: 3}, "calibration": {2: 2, 3: 1},
          "development": {2: 2, 3: 1}, "test": {3: 2, 4: 2}}
VERSION = "acephale-custom-compositions-v1"


def family_plan(seed: int = 17) -> list[dict[str, Any]]:
    """Partition operation sets before creating entities, instructions or traces."""
    if type(seed) is not int or not 0 <= seed < 2**31:
        raise ValueError("A nonnegative 32-bit generation seed is required")
    families = []
    for domain, operations in OPERATIONS.items():
        available = {size: sorted(itertools.combinations(operations, size), key=lambda ops: hash_v1([seed, domain, ops]))
                     for size in range(1, 5)}
        for partition, quotas in QUOTAS.items():
            for size, count in quotas.items():
                selected, available[size] = available[size][:count], available[size][count:]
                for operations in selected:
                    families.append({"familyId": domain + "-composition-" + hash_v1(list(operations))[:12],
                                     "domain": domain, "operations": list(operations), "partition": partition})
    return families


def _pick(values: list[Any], identity: Any) -> Any:
    if not values:
        raise ValueError("Pinned catalog cannot satisfy the declared task blueprint")
    return copy.deepcopy(values[int(hash_v1(identity)[:12], 16) % len(values)])


def _address(number: int) -> dict[str, str]:
    return {"address1": f"{number} Cedar Street", "address2": "", "city": "Columbus",
            "state": "OH", "country": "USA", "zip": "43215"}


def _customer(identity: str) -> tuple[str, str, dict[str, Any]]:
    token = hash_v1(identity)[:12]
    user_id, payment_id = "study_" + token, "credit_card_" + token
    user = {"user_id": user_id, "name": {"first_name": "Avery", "last_name": "Mercer"},
            "address": _address(100 + int(token[:4], 16) % 800), "email": token + "@example.test",
            "payment_methods": {payment_id: {"id": payment_id, "source": "credit_card", "brand": "visa", "last_four": "4242"}}}
    return user_id, payment_id, user


def _action(name: str, arguments: dict[str, Any], operation: str) -> dict[str, Any]:
    return {"action_id": operation, "requestor": "assistant", "name": name, "arguments": arguments}


def _checks(path: list[str], fields: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"path": [*path, field], "value": value} for field, value in fields.items()]


def retail_blueprint(family: dict, variant: int, database: dict) -> dict:
    identity = f"{family['familyId']}-v{variant}"
    user_id, payment_id, user = _customer(identity)
    new_address = _address(1200 + int(hash_v1(identity)[:4], 16) % 800)
    catalog = [product for _, product in sorted(database["products"].items())
               if sum(item["available"] for item in product["variants"].values()) >= 2]
    orders, actions, checks, requests = {}, [], [], []
    for operation in family["operations"]:
        if operation == "default_address":
            actions.append(_action("modify_user_address", {"user_id": user_id, **new_address}, operation))
            checks.extend(_checks(["users", user_id], {"address": new_address}))
            requests.append("Change my default account address to " + json.dumps(new_address) + ".")
            continue
        product = _pick(catalog, [identity, operation])
        variants = [item for _, item in sorted(product["variants"].items()) if item["available"]]
        old, new = variants[variant % len(variants)], variants[(variant + 1) % len(variants)]
        order_id = "#W" + str(int(hash_v1([identity, operation])[:12], 16)).zfill(15)
        delivered = operation in {"return_delivered", "exchange_variant"}
        item = {"name": product["name"], "product_id": product["product_id"],
                "item_id": old["item_id"], "price": old["price"], "options": old["options"]}
        payment = {"transaction_type": "payment", "amount": old["price"], "payment_method_id": payment_id}
        order = {"order_id": order_id, "user_id": user_id, "address": copy.deepcopy(user["address"]),
                 "items": [item], "status": "delivered" if delivered else "pending", "payment_history": [payment],
                 "fulfillments": [{"tracking_id": ["TRACK" + hash_v1(order_id)[:10]], "item_ids": [old["item_id"]]}] if delivered else []}
        orders[order_id] = order
        prefix = ["orders", order_id]
        if operation == "cancel_pending":
            actions.append(_action("cancel_pending_order", {"order_id": order_id, "reason": "no longer needed"}, operation))
            checks.extend(_checks(prefix, {"status": "cancelled", "cancel_reason": "no longer needed",
                "payment_history": [payment, {**payment, "transaction_type": "refund"}]}))
            requests.append(f"Cancel order {order_id}; I no longer need it.")
        elif operation == "shipping_address":
            actions.append(_action("modify_pending_order_address", {"order_id": order_id, **new_address}, operation))
            checks.extend(_checks(prefix, {"address": new_address}))
            requests.append(f"Change the shipping address of order {order_id} to " + json.dumps(new_address) + ".")
        elif operation == "return_delivered":
            actions.append(_action("return_delivered_order_items", {"order_id": order_id, "item_ids": [old["item_id"]], "payment_method_id": payment_id}, operation))
            checks.extend(_checks(prefix, {"status": "return requested", "return_items": [old["item_id"]], "return_payment_method_id": payment_id}))
            requests.append(f"Return the only item ({product['name']}, item {old['item_id']}) from order {order_id}, refunding the original card.")
        elif operation == "exchange_variant":
            actions.append(_action("exchange_delivered_order_items", {"order_id": order_id, "item_ids": [old["item_id"]],
                "new_item_ids": [new["item_id"]], "payment_method_id": payment_id}, operation))
            difference = round(new["price"] - old["price"], 2)
            checks.extend(_checks(prefix, {"status": "exchange requested", "exchange_items": [old["item_id"]],
                "exchange_new_items": [new["item_id"]], "exchange_payment_method_id": payment_id, "exchange_price_difference": difference}))
            requests.append(f"Exchange the only item in order {order_id}, {product['name']} item {old['item_id']}, for the same product with options {json.dumps(new['options'])}. "
                            f"I can pay up to ${max(difference, 0):.2f} extra using my saved Visa; use that card for any refund.")
        else:
            raise ValueError("Unknown retail operation")
    user["orders"] = list(orders)
    if user_id in database["users"] or set(orders) & set(database["orders"]):
        raise ValueError("Fresh retail identity collided with native data")
    return _task(family, variant, user, {"users": {user_id: user}, "orders": orders}, actions, checks, requests, payment_id)


def airline_blueprint(family: dict, variant: int, database: dict) -> dict:
    identity = f"{family['familyId']}-v{variant}"
    user_id, payment_id, user = _customer(identity)
    passenger = {"first_name": "Avery", "last_name": "Mercer", "dob": "1990-04-05"}
    user.update(dob=passenger["dob"], saved_passengers=[passenger], membership="regular")
    eligible = []
    for _, flight in sorted(database["flights"].items()):
        dates = [date for date, details in sorted(flight["dates"].items())
                 if date > "2024-05-15" and details["status"] == "available"
                 and details["available_seats"]["economy"] > 0 and details["available_seats"]["business"] > 0]
        if len(dates) >= 2:
            eligible.append((flight, dates))
    reservations, actions, checks, requests = {}, [], [], []
    for operation in family["operations"]:
        flight, dates = _pick(eligible, [identity, operation])
        date, new_date = dates[variant % (len(dates) - 1)], dates[variant % (len(dates) - 1) + 1]
        reservation_id = "A" + hash_v1([identity, operation])[:9].upper()
        price = flight["dates"][date]["prices"]["economy"]
        leg = {"flight_number": flight["flight_number"], "origin": flight["origin"], "destination": flight["destination"], "date": date, "price": price}
        payment = {"payment_id": payment_id, "amount": price}
        reservation = {"reservation_id": reservation_id, "user_id": user_id, "origin": flight["origin"],
            "destination": flight["destination"], "flight_type": "one_way", "cabin": "economy", "flights": [leg],
            "passengers": [copy.deepcopy(passenger)], "payment_history": [payment], "created_at": "2024-05-15T10:00:00",
            "total_baggages": 1, "nonfree_baggages": 0, "insurance": "no", "status": None}
        reservations[reservation_id] = reservation
        prefix = ["reservations", reservation_id]
        if operation == "cancel_within_24h":
            actions.append(_action("cancel_reservation", {"reservation_id": reservation_id}, operation))
            checks.extend(_checks(prefix, {"status": "cancelled", "payment_history": [payment, {**payment, "amount": -price}]}))
            requests.append(f"Cancel reservation {reservation_id} because my plans changed. I booked it today at 10:00 EST.")
        elif operation == "add_baggage":
            actions.append(_action("update_reservation_baggages", {"reservation_id": reservation_id,
                "total_baggages": 2, "nonfree_baggages": 1, "payment_id": payment_id}, operation))
            checks.extend(_checks(prefix, {"total_baggages": 2, "nonfree_baggages": 1,
                "payment_history": [payment, {"payment_id": payment_id, "amount": 50}]}))
            requests.append(f"Add one checked bag to reservation {reservation_id}, for two total. I accept the $50 extra charge on my saved Visa.")
        elif operation == "correct_passenger":
            corrected = {**passenger, "last_name": "Moreno"}
            actions.append(_action("update_reservation_passengers", {"reservation_id": reservation_id, "passengers": [corrected]}, operation))
            checks.extend(_checks(prefix, {"passengers": [corrected]}))
            requests.append(f"Correct the only passenger's surname on reservation {reservation_id} from Mercer to Moreno; keep Avery and date of birth 1990-04-05 unchanged.")
        elif operation in {"upgrade_cabin", "reschedule_date"}:
            cabin = "business" if operation == "upgrade_cabin" else "economy"
            target_date = date if operation == "upgrade_cabin" else new_date
            new_price = flight["dates"][target_date]["prices"][cabin]
            difference = new_price - price
            actions.append(_action("update_reservation_flights", {"reservation_id": reservation_id, "cabin": cabin,
                "flights": [{"flight_number": flight["flight_number"], "date": target_date}], "payment_id": payment_id}, operation))
            payments = [payment] + ([{"payment_id": payment_id, "amount": difference}] if difference else [])
            checks.extend(_checks(prefix, {"cabin": cabin, "flights": [{**leg, "date": target_date, "price": new_price}], "payment_history": payments}))
            request = (f"Upgrade reservation {reservation_id} to business on the same flight and date." if operation == "upgrade_cabin"
                       else f"Move reservation {reservation_id} to the same flight {flight['flight_number']} on {new_date}, keeping economy, route and one-way trip type.")
            requests.append(request + f" I accept a fare difference up to ${max(difference, 0)} on my saved Visa; refund that card if cheaper. Do not change baggage or insurance.")
        else:
            raise ValueError("Unknown airline operation")
    user["reservations"] = list(reservations)
    if user_id in database["users"] or set(reservations) & set(database["reservations"]):
        raise ValueError("Fresh airline identity collided with native data")
    return _task(family, variant, user, {"users": {user_id: user}, "reservations": reservations}, actions, checks, requests, payment_id)


def _task(family, variant, user, overlay, actions, checks, requests, payment_id):
    task_id = f"{family['familyId']}-v{variant}"
    consent = "Before every database mutation, the assistant described the action details and obtained an explicit yes from the user."
    instructions = "Complete all of these requests for your own account: " + " ".join(requests)
    instructions += (" Give the agent your email and user ID when asked. Answer factual questions using the known information. "
                     "These are all requested changes and all affected items/passengers. Do not authorize unrelated changes. "
                     "Say yes when the agent has accurately described the requested changes and costs; otherwise correct the details first.")
    known = f"Your user ID is {user['user_id']}; email {user['email']}; name Avery Mercer; current ZIP {user['address']['zip']}. "
    known += f"Your saved Visa ending 4242 has payment ID {payment_id}. " + " ".join(requests)
    task = {"id": task_id, "description": {"purpose": "Complete a fresh composition of native customer requests.",
            "notes": "Custom tau-compatible task; not an official task or unseen-primitive evaluation."},
            "user_scenario": {"persona": "You are concise and cooperative, but require correct details before confirming changes.",
                "instructions": {"domain": family["domain"], "reason_for_call": " ".join(requests), "known_info": known,
                                 "unknown_info": "You do not know backend field names or the agent's tool implementations.", "task_instructions": instructions}},
            "initial_state": {"initialization_data": {"agent_data": overlay}},
            "evaluation_criteria": {"actions": actions, "reward_basis": ["DB"], "nl_assertions": [consent]}}
    if family["domain"] == "retail":
        task["evaluation_criteria"]["nl_assertions"].append("The assistant authenticated the user through email or name and ZIP before disclosing account data or making changes.")
    return {"domain": family["domain"], "taskId": task_id, "familyId": family["familyId"], "variant": variant,
            "partition": family["partition"], "operations": family["operations"], "task": task, "outcomeChecks": checks}


def expected_database(initial: dict, checks: list[dict]) -> dict:
    """Construct the complete target from blueprint fields, never tool responses."""
    expected = copy.deepcopy(initial)
    seen = set()
    for check in checks:
        path = check["path"]
        if not path or tuple(path) in seen:
            raise ValueError("Independent outcome paths must be unique")
        seen.add(tuple(path))
        current = expected
        for key in path[:-1]:
            current = current[key]
        if path[-1] not in current:
            raise ValueError("Independent check references an unknown state field")
        current[path[-1]] = copy.deepcopy(check["value"])
    return expected


def verify_blueprint(blueprint: dict, constructor) -> dict:
    from tau2.data_model.message import AssistantMessage, ToolCall
    from tau2.data_model.tasks import Task
    from tau2.evaluator.evaluator_env import EnvironmentEvaluator

    task = Task.model_validate(blueprint["task"])

    def execute(actions):
        env = constructor()
        env.set_state(task.initial_state.initialization_data, None, [])
        before = env.tools.db.model_dump(mode="json")
        messages = []
        for action in actions:
            call = ToolCall(id=action.action_id, name=action.name, arguments=action.arguments)
            response = env.get_response(call)
            if response.error:
                raise ValueError(f"Reference action failed: {blueprint['taskId']} / {action.name}")
            messages.extend([AssistantMessage(role="assistant", tool_calls=[call]), response])
        return before, env, messages

    actions = task.evaluation_criteria.actions
    before, final, messages = execute(actions)
    expected = expected_database(before, blueprint["outcomeChecks"])
    target_hash = hash_v1(expected)
    if hash_v1(before) == target_hash or hash_v1(final.tools.db.model_dump(mode="json")) != target_hash:
        raise ValueError("Reference execution did not achieve the independently specified complete DB state")
    reward = EnvironmentEvaluator.calculate_reward(constructor, task, messages)
    if reward.reward != 1 or reward.db_check.db_match is not True:
        raise ValueError("Actual native DB evaluator rejected the verified reference trajectory")
    ablations = []
    for index, action in enumerate(actions):
        _, reduced, _ = execute(actions[:index] + actions[index + 1:])
        if hash_v1(reduced.tools.db.model_dump(mode="json")) == target_hash:
            raise ValueError("Dropping a requested mutation did not fail the independent outcome")
        ablations.append({"droppedAction": action.action_id, "independentOutcome": False,
                          "nativeDbMatch": reduced.get_db_hash() == final.get_db_hash()})
    if any(item["nativeDbMatch"] for item in ablations):
        raise ValueError("A dropped mutation unexpectedly preserved the native reward DB state")
    return {"taskId": blueprint["taskId"], "taskHash": hash_v1(blueprint["task"]),
            "checksHash": hash_v1(blueprint["outcomeChecks"]), "initialDatabaseHash": hash_v1(before),
            "targetDatabaseHash": target_hash, "nativeTargetDatabaseHash": final.get_db_hash(),
            "referenceSucceeded": True, "nativeDbReward": reward.reward, "ablationChecks": ablations,
            "consentAssertionsEvaluated": False, "modelCalls": 0}


def overlap_report(families: list[dict]) -> dict:
    pairs = []
    for first, second in itertools.combinations(families, 2):
        if first["domain"] != second["domain"] or first["partition"] == second["partition"]:
            continue
        left, right = set(first["operations"]), set(second["operations"])
        pairs.append({"first": first["familyId"], "second": second["familyId"],
                      "sharedPrimitives": sorted(left & right), "jaccard": len(left & right) / len(left | right)})
    return {"claim": "Compositional generalization with shared primitive intents and native catalogs",
            "unseenPrimitiveClaim": False, "exactOperationSetOverlap": 0, "crossPartitionPairs": pairs}


def generate(upstream_root: Path, output: Path, *, seed: int = 17) -> dict:
    from acephale.infra_native_runner import NativeTauExecutor, _verify_checkout

    upstream_root = upstream_root.resolve()
    _verify_checkout(upstream_root, REVISION)
    native = NativeTauExecutor({"runs": []}, {}, upstream_root)
    families = family_plan(seed)
    output.mkdir(parents=True, exist_ok=False)
    partition = hashed({"version": 1, "kind": "acephale-custom-native-partition", "generatorVersion": VERSION,
                        "seed": seed, "families": {row["familyId"]: row["partition"] for row in families}, "design": families})
    write_new(output / "partition.json", partition)
    source_names = [f"{prefix}/{domain}/{name}" for domain in OPERATIONS for prefix, names in (
        ("data/tau2/domains", ("db.json", "policy.md")), ("src/tau2/domains", ("tools.py", "data_model.py", "environment.py"))) for name in names]
    source_names += ["src/tau2/environment/environment.py", "src/tau2/environment/toolkit.py",
                     "src/tau2/evaluator/evaluator_env.py", "src/tau2/data_model/tasks.py"]
    sources = [{"path": name, "sha256": file_hash(upstream_root / name)} for name in sorted(source_names)]
    blueprints, verification = [], []
    for domain in OPERATIONS:
        constructor = native.registry.get_env_constructor(domain)
        base = constructor().tools.db
        database = base.model_dump(mode="json")

        def fresh(*, solo_mode=False, constructor=constructor, base=base):
            return constructor(db=base.model_copy(deep=True), solo_mode=solo_mode)

        builder = retail_blueprint if domain == "retail" else airline_blueprint
        blueprints.extend(builder(family, variant, database) for family in families if family["domain"] == domain for variant in (0, 1))
        # All blueprints and checks for this domain exist before any execution.
        for row in (item for item in blueprints if item["domain"] == domain):
            verification.append(verify_blueprint(row, fresh))
    if len(blueprints) != 88 or len(verification) != 88:
        raise ValueError("The complete declared 88-task cohort must verify")
    bundle = {"version": 1, "upstreamRevision": REVISION, "tasks": [
        {key: row[key] for key in ("domain", "taskId", "familyId", "task")} for row in blueprints]}
    write_new(output / "tasks.json", bundle)
    write_new(output / "blueprints.json", blueprints)
    write_new(output / "verification.json", hashed({"version": 1, "checks": verification, "modelCalls": 0}))
    write_new(output / "overlap.json", overlap_report(families))
    receipt = hashed({"version": 1, "kind": "acephale-custom-native-bundle", "generatorVersion": VERSION,
        "generatorSourceHash": file_hash(Path(__file__)), "upstreamRevision": REVISION, "sourceInputs": sources,
        "partitionHash": partition["contentHash"], "taskBundleHash": hash_v1(bundle), "taskCount": len(blueprints),
        "familyCounts": dict(Counter(row["partition"] for row in families)), "taskCounts": dict(Counter(row["partition"] for row in blueprints)),
        "allReferencesVerified": True, "allMutationAblationsFailed": True, "modelCalls": 0, "actorTrials": 0,
        "consentAssertionsEvaluated": False, "rewardBasis": ["DB"], "officialBenchmark": False,
        "files": file_inventory(output)})
    write_new(output / "receipt.json", receipt)
    return receipt


def verify_custom_bundle(directory: Path, upstream_root: Path | None = None) -> tuple[dict, dict, dict]:
    receipt = verify_hashed(json.loads((directory / "receipt.json").read_text(encoding="utf-8")))
    if (receipt.get("kind") != "acephale-custom-native-bundle" or receipt.get("generatorVersion") != VERSION
            or receipt.get("upstreamRevision") != REVISION or receipt.get("generatorSourceHash") != file_hash(Path(__file__))
            or receipt.get("taskCount") != 88 or receipt.get("allReferencesVerified") is not True
            or receipt.get("allMutationAblationsFailed") is not True or receipt.get("rewardBasis") != ["DB"]):
        raise ValueError("Custom bundle lacks exact generator, native revision or complete verification")
    observed = [item for item in file_inventory(directory) if item["path"] != "receipt.json"]
    if observed != receipt.get("files"):
        raise ValueError("Custom task bundle inventory changed")
    if upstream_root is not None:
        from acephale.infra_native_runner import _verify_checkout

        _verify_checkout(upstream_root, REVISION)
        if any(file_hash(upstream_root / row["path"]) != row["sha256"] for row in receipt["sourceInputs"]):
            raise ValueError("Custom task upstream source differs")
    bundle = json.loads((directory / "tasks.json").read_text(encoding="utf-8"))
    partition = verify_hashed(json.loads((directory / "partition.json").read_text(encoding="utf-8")))
    if receipt["taskBundleHash"] != hash_v1(bundle) or receipt["partitionHash"] != partition["contentHash"]:
        raise ValueError("Custom task or partition identity differs")
    if partition["design"] != family_plan(partition["seed"]):
        raise ValueError("Custom task family partition differs from its predeclared design")
    return receipt, bundle, partition


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args(argv)
    result = verify_custom_bundle(args.output, args.upstream_root)[0] if args.verify else generate(args.upstream_root, args.output, seed=args.seed)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
