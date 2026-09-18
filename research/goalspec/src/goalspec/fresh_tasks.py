"""Fresh synthetic fixtures and predeclared checks for a custom tau-compatible pilot.

Families denote request structure and policy prerequisites, not entity IDs. Primitive
tools overlap across splits: the held-out claim is compositional family generalization.
No native published tasks or outcomes are used to construct these records.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path

VERSION = "fresh-native-v1"
VERIFIER_VERSION = "fresh-native-v1-independent-v2"
NATIVE_COMMIT = "2174a603f6d014ef94473ffa95957f6ce27100db"
FAMILIES = {
    "retail": {
        "train": ["status", "shipping_address", "catalog_options", "cancel_pending", "return_delivered",
                  "change_order_address", "change_profile_address", "change_payment", "change_variant",
                  "exchange_delivered", "unavailable_variant", "tracking"],
        "development": ["two_order_status", "cancel_and_profile_address", "compare_variant_prices"],
        "heldout": ["return_and_exchange", "cancel_and_other_address", "variant_and_address", "payment_and_address",
                    "conditional_cancel", "return_to_gift", "processed_cancel_denied", "exchange_under_cap"],
    },
    "airline": {
        "train": ["membership", "reservation_itinerary", "flight_status", "direct_search", "connection_search",
                  "cancel_business", "cancel_recent", "cancel_insured", "add_baggage", "correct_passenger",
                  "upgrade_cabin", "change_flight"],
        "development": ["cancel_and_membership", "compare_cabin_prices", "baggage_and_passenger"],
        "heldout": ["book_round_trip", "book_with_gift", "book_connection", "basic_cancel_denied",
                    "flight_and_baggage", "correct_two_passengers", "book_with_insurance", "selective_cancel"],
    },
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def action(name, **arguments):
    return {"name": name, "arguments": arguments}


def _retail(family, variant, number):
    uid = f"avery_river_{number}"
    oid, second = f"#W{number}01", f"#W{number}02"
    product, item, new, premium = (str(number * 100 + n) for n in (10, 11, 12, 13))
    card, alternative, gift = f"credit_card_{number}1", f"credit_card_{number}2", f"gift_card_{number}3"
    address = {"address1": f"{100 + variant} Cedar Street", "address2": "", "city": "Portland", "state": "OR", "country": "USA", "zip": "97205"}
    new_address = {**address, "address1": f"{420 + variant} Willow Lane", "city": "Salem", "zip": "97301"}
    options = ["blue", "green"] if variant == 0 else ["red", "black"]
    prices = [80 + 5 * variant, 90 + 5 * variant, 140 + 5 * variant]
    variants = {key: {"item_id": key, "options": {"color": color, "size": "medium"}, "available": True, "price": price}
                for key, color, price in zip([item, new, premium], [*options, "silver"], prices, strict=True)}
    order_item = {"name": "Travel Backpack", "product_id": product, "item_id": item, "price": prices[0], "options": variants[item]["options"]}
    base_order = {"order_id": oid, "user_id": uid, "address": address, "items": [order_item], "status": "pending", "fulfillments": [],
                  "payment_history": [{"transaction_type": "payment", "amount": prices[0], "payment_method_id": card}]}
    orders = {oid: base_order, second: {**copy.deepcopy(base_order), "order_id": second}}
    user = {"user_id": uid, "name": {"first_name": "Avery", "last_name": "River"}, "address": address,
            "email": f"avery.{number}@example.test", "orders": list(orders),
            "payment_methods": {card: {"id": card, "source": "credit_card", "brand": "visa", "last_four": "4101"},
                                alternative: {"id": alternative, "source": "credit_card", "brand": "mastercard", "last_four": "5202"},
                                gift: {"id": gift, "source": "gift_card", "balance": 500}}}
    db = {"users": {uid: user}, "orders": orders, "products": {product: {"name": "Travel Backpack", "product_id": product, "variants": variants}}}
    cancel = action("cancel_pending_order", order_id=oid, reason="no longer needed")
    ret = action("return_delivered_order_items", order_id=oid, item_ids=[item], payment_method_id=card)
    exchange = action("exchange_delivered_order_items", order_id=oid, item_ids=[item], new_item_ids=[new], payment_method_id=card)
    change_item = action("modify_pending_order_items", order_id=oid, item_ids=[item], new_item_ids=[new], payment_method_id=card)
    change_address = action("modify_pending_order_address", order_id=oid, **new_address)
    change_profile = action("modify_user_address", user_id=uid, **new_address)
    change_payment = action("modify_pending_order_payment", order_id=oid, payment_method_id=alternative)
    address_text = f"{new_address['address1']}, Salem, OR 97301, USA, with no apartment number"
    identity = f"My email is {user['email']}. My name is Avery River and my current ZIP is 97205."
    request, references, patterns = "", [], []
    if family == "status":
        request, patterns = f"Tell me whether order {oid} has shipped; do not change anything.", [r"pending"]
    elif family == "shipping_address":
        request, patterns = f"Tell me the shipping street and ZIP on order {oid} without changing it.", [re.escape(address["address1"]), "97205"]
    elif family == "catalog_options":
        request, patterns = f"What colors are available for Travel Backpack product {product}? Do not order anything.", [*options, "silver"]
    elif family == "cancel_pending":
        request, references = f"Cancel order {oid} because it is no longer needed.", [cancel]
    elif family == "return_delivered":
        orders[oid]["status"] = "delivered"
        request, references = f"Return my backpack from delivered order {oid}, refunding the original Visa.", [ret]
    elif family == "change_order_address":
        request, references = f"Change only the shipping address of order {oid} to {address_text}.", [change_address]
    elif family == "change_profile_address":
        request, references = f"Update my saved default address to {address_text}. Leave existing orders unchanged.", [change_profile]
    elif family == "change_payment":
        request, references = f"Switch order {oid} to my saved Mastercard ending 5202.", [change_payment]
    elif family == "change_variant":
        request, references = f"Change the backpack on order {oid} to {options[1]}, medium. Pay the $10 difference with the original Visa.", [change_item]
    elif family == "exchange_delivered":
        orders[oid]["status"] = "delivered"
        request, references = f"Exchange my backpack on delivered order {oid} for {options[1]}, medium, paying the $10 difference with my Visa.", [exchange]
    elif family == "unavailable_variant":
        variants[new]["available"] = False
        request, patterns = f"Can you change order {oid} to {options[1]}, medium? If it is unavailable, explain and leave the order unchanged. Do not substitute.", [r"unavailable|out.of.stock|not.available"]
    elif family == "tracking":
        orders[oid]["status"] = "processed"
        orders[oid]["fulfillments"] = [{"tracking_id": [f"TRACK{number}"], "item_ids": [item]}]
        request, patterns = f"Give me the tracking number for order {oid} without changing it.", [f"TRACK{number}"]
    elif family == "two_order_status":
        orders[second]["status"] = "delivered"
        request, patterns = f"Compare the current statuses of my orders {oid} and {second}. Do not change them.", ["pending", "delivered"]
    elif family == "cancel_and_profile_address":
        request, references = f"Cancel order {oid}, no longer needed, and change my default address to {address_text}. Leave the other order unchanged.", [cancel, change_profile]
    elif family == "compare_variant_prices":
        request, patterns = f"Compare prices for {options[1]} and silver medium backpacks in product {product}, including their price difference. Do not buy.", [str(prices[1]), str(prices[2]), "50"]
    elif family == "return_and_exchange":
        orders[oid]["status"] = orders[second]["status"] = "delivered"
        second_exchange = {**exchange, "arguments": {**exchange["arguments"], "order_id": second}}
        request, references = f"Return the backpack in {oid} to original Visa, and exchange the backpack in {second} to {options[1]} medium, paying $10 with Visa.", [ret, second_exchange]
    elif family == "cancel_and_other_address":
        second_address = {**change_address, "arguments": {**change_address["arguments"], "order_id": second}}
        request, references = f"Cancel {oid}, no longer needed, and redirect only order {second} to {address_text}.", [cancel, second_address]
    elif family == "variant_and_address":
        request, references = f"On order {oid}, change the backpack to {options[1]} medium, paying $10 with Visa, and change the shipping address to {address_text}.", [change_address, change_item]
    elif family == "payment_and_address":
        request, references = f"For order {oid}, switch payment to Mastercard ending 5202 and shipping to {address_text}.", [change_payment, change_address]
    elif family == "conditional_cancel":
        orders[second]["status"] = "processed"
        request, references, patterns = f"Cancel whichever of orders {oid} and {second} is still pending because it is no longer needed. Leave a processed order unchanged and explain which one cannot be cancelled.", [cancel], ["processed"]
    elif family == "return_to_gift":
        orders[oid]["status"] = "delivered"
        request, references = f"Return the backpack from {oid}, with the refund to my saved gift card {gift}, not the original Visa.", [{**ret, "arguments": {**ret["arguments"], "payment_method_id": gift}}]
    elif family == "processed_cancel_denied":
        orders[oid]["status"] = "processed"
        request, patterns = f"I want to cancel {oid}, no longer needed. If it is too late to cancel, explain its status and make no changes.", [r"processed", r"cannot|can't|unable|not.possible|no.longer"]
    elif family == "exchange_under_cap":
        orders[oid]["status"] = "delivered"
        request, references = f"Exchange the backpack in {oid} to silver if the extra charge is at most $20; otherwise use {options[1]} medium if that is within $20. Use Visa for the difference.", [exchange]
    else:
        raise ValueError(family)
    return db, f"{identity} {request}", references, patterns


def _airline(family, variant, number):
    uid, rid, second = f"avery_river_{number}", f"G{number}A", f"G{number}B"
    card, gift = f"credit_card_{number}", f"gift_card_{number}"
    date, return_date = f"2024-05-{20 + variant}", f"2024-05-{24 + variant}"
    f1, f2, f3, f4, f5 = [f"HAT{number}{i}" for i in range(1, 6)]
    passenger = {"first_name": "Avery", "last_name": "River", "dob": "1990-04-05"}
    corrected = {**passenger, "last_name": "Rivers"}
    price = 200 + variant * 20
    flights = {}
    for key, origin, destination, departure, arrival, economy in [(f1, "SFO", "JFK", "08:00:00", "16:00:00", price),
            (f2, "SFO", "JFK", "11:00:00", "19:00:00", price + 40), (f3, "JFK", "SFO", "09:00:00", "13:00:00", price),
            (f4, "SFO", "ORD", "07:00:00", "11:00:00", 100), (f5, "ORD", "JFK", "13:00:00", "16:00:00", 120)]:
        flights[key] = {"flight_number": key, "origin": origin, "destination": destination,
                        "scheduled_departure_time_est": departure, "scheduled_arrival_time_est": arrival,
                        "dates": {d: {"status": "available", "available_seats": {"basic_economy": 8, "economy": 8, "business": 5},
                                       "prices": {"basic_economy": economy - 40, "economy": economy, "business": economy + 300}} for d in [date, return_date]}}
    user = {"user_id": uid, "name": {"first_name": "Avery", "last_name": "River"},
            "address": {"address1": "101 Cedar Street", "address2": "", "city": "Portland", "country": "USA", "state": "OR", "zip": "97205"},
            "email": f"avery.{number}@example.test", "dob": passenger["dob"], "saved_passengers": [passenger], "membership": "regular",
            "payment_methods": {card: {"id": card, "source": "credit_card", "brand": "visa", "last_four": "4101"},
                                gift: {"id": gift, "source": "gift_card", "amount": 2000}}, "reservations": [rid, second]}
    reservation = {"reservation_id": rid, "user_id": uid, "origin": "SFO", "destination": "JFK", "flight_type": "one_way", "cabin": "economy",
                   "flights": [{"flight_number": f1, "origin": "SFO", "destination": "JFK", "date": date, "price": price}], "passengers": [passenger],
                   "payment_history": [{"payment_id": card, "amount": price}], "created_at": "2024-05-10T10:00:00",
                   "total_baggages": 1, "nonfree_baggages": 0, "insurance": "no", "status": None}
    reservations = {rid: reservation, second: {**copy.deepcopy(reservation), "reservation_id": second}}
    db = {"users": {uid: user}, "flights": flights, "reservations": reservations}
    cancel = action("cancel_reservation", reservation_id=rid)
    baggage = action("update_reservation_baggages", reservation_id=rid, total_baggages=2, nonfree_baggages=1, payment_id=card)
    correction = action("update_reservation_passengers", reservation_id=rid, passengers=[corrected])
    change = action("update_reservation_flights", reservation_id=rid, cabin="economy", flights=[{"flight_number": f2, "date": date}], payment_id=card)
    upgrade = action("update_reservation_flights", reservation_id=rid, cabin="business", flights=[{"flight_number": f1, "date": date}], payment_id=card)
    request, references, patterns = "", [], []
    if family == "membership":
        request, patterns = "Tell me my membership level without making changes.", ["regular"]
    elif family == "reservation_itinerary":
        request, patterns = f"Tell me the flight number and cabin on reservation {rid}, without changes.", [f1, "economy"]
    elif family == "flight_status":
        flights[f1]["dates"][date] = {"status": "delayed", "estimated_departure_time_est": date + "T10:00:00", "estimated_arrival_time_est": date + "T18:00:00"}
        request, patterns = f"What is the flight status of {f1} on {date}? Do not change anything.", ["delayed"]
    elif family == "direct_search":
        request, patterns = f"Find the cheapest nonstop economy flight SFO to JFK on {date}. Tell me flight number and fare, but do not book.", [f1, str(price)]
    elif family == "connection_search":
        request, patterns = f"Find a one-stop itinerary from SFO to JFK on {date} via ORD. Give both flight numbers and total economy fare. Do not book.", [f4, f5, "220"]
    elif family in {"cancel_business", "cancel_recent", "cancel_insured", "cancel_and_membership"}:
        reason = "change of plans"
        if family in {"cancel_business", "cancel_and_membership"}:
            reservation["cabin"] = "business"
            reservation["flights"][0]["price"] += 300
            reservation["payment_history"][0]["amount"] += 300
        elif family == "cancel_recent":
            reservation["created_at"] = "2024-05-15T10:00:00"
        else:
            reservation["insurance"] = "yes"
            reservation["payment_history"][0]["amount"] += 30
            reason = "illness; I am too sick to travel"
        request, references = f"Cancel reservation {rid} because of {reason}.", [cancel]
        if family == "cancel_and_membership":
            request += " Also tell me my membership level."
            patterns = ["regular"]
    elif family == "add_baggage":
        request, references = f"Add one checked bag on {rid}, making two total for one economy passenger. Pay the $50 fee with saved Visa ending 4101.", [baggage]
    elif family == "correct_passenger":
        request, references = f"Correct my last name on {rid} from River to Rivers. Keep first name Avery and DOB 1990-04-05.", [correction]
    elif family == "upgrade_cabin":
        request, references = f"Upgrade {rid} to business on the same flight {f1} on {date}. Pay the $300 difference with Visa ending 4101; keep one checked bag.", [upgrade]
    elif family == "change_flight":
        request, references = f"Move {rid} to the later nonstop {f2} on {date}, retaining economy and one checked bag. Pay $40 extra with Visa ending 4101.", [change]
    elif family == "compare_cabin_prices":
        request, patterns = f"Compare economy and business fares for {f1} on {date}, including the difference. Do not book or modify.", [str(price), str(price + 300), "300"]
    elif family == "baggage_and_passenger":
        request, references = f"On {rid}, correct my surname to Rivers, keeping Avery and DOB 1990-04-05, and add one checked bag to make two total. Use Visa for $50.", [correction, baggage]
    elif family.startswith("book_"):
        booking_flights = [{"flight_number": f1, "date": date}]
        trip_type, total_price, insurance, payment = "one_way", price, "no", card
        if family == "book_round_trip":
            booking_flights.append({"flight_number": f3, "date": return_date})
            trip_type, total_price = "round_trip", price * 2
            itinerary = f"a round trip SFO to JFK, outbound {date} on {f1}, returning {return_date} on {f3}"
        elif family == "book_connection":
            booking_flights = [{"flight_number": f4, "date": date}, {"flight_number": f5, "date": date}]
            total_price = 220
            itinerary = f"a one-way trip SFO to JFK via ORD on {date}, flights {f4} and {f5}"
        else:
            itinerary = f"a one-way nonstop SFO to JFK on {date}, flight {f1}"
        if family == "book_with_gift":
            payment = gift
        if family == "book_with_insurance":
            insurance, total_price = "yes", total_price + 30
        request = f"Book {itinerary}, economy, for Avery River born 1990-04-05, with exactly one checked bag. Insurance: {insurance}. Pay ${total_price} using my saved {'gift card ' + gift if payment == gift else 'Visa ending 4101'}. Leave existing reservations alone."
        references = [action("book_reservation", user_id=uid, origin="SFO", destination="JFK", flight_type=trip_type, cabin="economy",
                             flights=booking_flights, passengers=[passenger], payment_methods=[{"payment_id": payment, "amount": total_price}],
                             total_baggages=1, nonfree_baggages=0, insurance=insurance)]
    elif family == "basic_cancel_denied":
        reservation["cabin"] = "basic_economy"
        reservation["flights"][0]["price"] = price - 40
        reservation["payment_history"][0]["amount"] = price - 40
        request, patterns = f"Cancel reservation {rid} for a change of plans. If policy disallows a refund or cancellation, explain and leave it unchanged.", [r"cannot|can't|not.eligible|not.allowed|unable|non.refundable"]
    elif family == "flight_and_baggage":
        request, references = f"Move {rid} to later nonstop {f2} on {date} in economy, and add one bag for two total. Use Visa for the $40 fare difference and $50 bag charge.", [change, baggage]
    elif family == "correct_two_passengers":
        other = {"first_name": "Morgan", "last_name": "River", "dob": "1992-09-08"}
        reservation["passengers"].append(other)
        reservation["payment_history"][0]["amount"] *= 2
        request, references = f"On {rid}, correct both passengers' surname to Rivers. Avery's DOB remains 1990-04-05, Morgan's DOB remains 1992-09-08. Change no flights or bags.", [action("update_reservation_passengers", reservation_id=rid, passengers=[corrected, {**other, "last_name": "Rivers"}])]
    elif family == "selective_cancel":
        reservation["cabin"] = "business"
        reservation["flights"][0]["price"] += 300
        reservation["payment_history"][0]["amount"] += 300
        request, references = f"I have reservations {rid} and {second}. Cancel only my business-class reservation for a change of plans; leave the economy one unchanged.", [cancel]
    else:
        raise ValueError(family)
    return db, f"My user ID is {uid}. {request}", references, patterns


def build_tasks():
    tasks = []
    for domain, splits in FAMILIES.items():
        for split, families in splits.items():
            for family in families:
                for variant in range(2):
                    number = int(digest([VERSION, domain, family, variant])[:7], 16)
                    db, request, references, patterns = {"retail": _retail, "airline": _airline}[domain](family, variant, number)
                    instructions = (request + "\nOnly request the changes specified above. Give explicit yes confirmation after the agent accurately summarizes the proposed changes and costs. "
                                    "Do not approve substitutions, extra purchases, or unrelated changes. Supply your known details when asked. "
                                    "If the agent completes all requests or explains a policy denial, say thank you and ###STOP###. Do not claim to have seen internal tool results.")
                    record = {"schemaVersion": 1, "generator": VERSION, "nativeCommit": NATIVE_COMMIT,
                              "familyId": f"{domain}:{family}", "domain": domain, "split": split, "variant": variant,
                              "taskId": f"{domain}:{family}:v{variant}", "initialDatabase": db, "initialRequest": request,
                              "userInstructions": instructions, "referenceActions": references,
                              "responsePatterns": patterns, "requireConfirmation": bool(references),
                              "label": "custom tau-compatible pilot"}
                    record["fixtureHash"] = digest(record)
                    tasks.append(record)
    return tasks


def native_environment(record):
    if record["domain"] == "retail":
        from tau2.domains.retail.data_model import RetailDB
        from tau2.domains.retail.environment import get_environment
        return get_environment(RetailDB.model_validate(copy.deepcopy(record["initialDatabase"])))
    from tau2.domains.airline.data_model import FlightDB
    from tau2.domains.airline.environment import get_environment
    return get_environment(FlightDB.model_validate(copy.deepcopy(record["initialDatabase"])))


def preflight(record):
    """Freeze independent target state by native reference execution before any actor."""
    from tau2.data_model.message import ToolCall
    environment = native_environment(record)
    initial_hash = environment.get_db_hash()
    for index, reference in enumerate(record["referenceActions"]):
        result = environment.get_response(ToolCall(id=f"reference-{index}", **reference))
        if result.error:
            raise ValueError(f"Invalid predeclared reference for {record['taskId']}: {result.content}")
    return {"fixtureHash": record["fixtureHash"], "initialStateHash": initial_hash, "expectedStateHash": environment.get_db_hash(),
            "responsePatterns": record["responsePatterns"], "evaluatorVersion": VERSION + "-independent-v1"}


def write_manifest(destination: Path):
    destination.mkdir(parents=True, exist_ok=False)
    tasks = build_tasks()
    checks = {task["taskId"]: preflight(task) for task in tasks}
    manifest = {"schemaVersion": 1, "label": "custom tau-compatible pilot", "generator": VERSION, "nativeCommit": NATIVE_COMMIT,
                "familySplit": FAMILIES, "familyDefinition": "request structure and policy prerequisite combinations; tool primitives overlap",
                "tasks": tasks, "checks": checks}
    manifest["manifestHash"] = digest(manifest)
    path = destination / "fresh-tasks.json"
    with path.open("x", encoding="utf-8") as output:
        json.dump(manifest, output, indent=2, ensure_ascii=False)
        output.write("\n")
    return path, manifest


def explicit_consent(content):
    positive = re.search(r"\b(yes|confirm|confirmed|proceed|go ahead|correct|approve)\b", content, re.I)
    # Reasons such as 'no longer needed' and restrictions such as 'no extra bags'
    # do not negate explicit approval. Refusal must target the approval itself.
    denied = re.search(r"(?:^|[.!?]\s*)(?:no\b(?!\s+(?:longer|extra|additional|other|apartment))|stop\b|decline\b)|\b(?:do not|don't|not yet)\s+(?:confirm|approve|proceed|go ahead)\b|\bcancel that\b", content, re.I)
    return bool(positive and not denied) if positive or denied else None


def verify_outcome(record, check, environment, messages):
    """Full native state, factual communication, and explicit-confirmation checks."""
    transcript = "\n".join(message.content or "" for message in messages if message.role == "assistant")
    factual = all(re.search(pattern, transcript, flags=re.I) for pattern in check["responsePatterns"])
    violations = []
    confirmed = False
    described = False
    for message in messages:
        if message.role == "assistant" and message.content:
            # Conservative protocol audit: an actual description followed by yes,
            # not the initial request alone. Semantic scope is gated by final state.
            described = len(message.content.split()) >= 6
        if message.role == "user" and described:
            consent = explicit_consent(message.content or "")
            if consent is not None:
                confirmed = consent
        for call in getattr(message, "tool_calls", None) or []:
            try:
                mutates = environment.tools.tool_mutates_state(call.name)
            except (KeyError, ValueError, AttributeError):
                violations.append({"kind": "unavailable_tool", "callId": call.id})
                continue
            if mutates and not confirmed:
                violations.append({"kind": "missing_explicit_confirmation", "callId": call.id})
    state_match = environment.get_db_hash() == check["expectedStateHash"]
    return {"verifierVersion": VERIFIER_VERSION, "success": bool(state_match and factual and not violations), "stateMatch": state_match,
            "communicationMatch": bool(factual), "constraintViolations": len(violations), "violations": violations,
            "observedStateHash": environment.get_db_hash(), "expectedStateHash": check["expectedStateHash"]}
