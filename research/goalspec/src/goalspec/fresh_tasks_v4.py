"""Predeclared v4 compositions, native fixtures and independent completion checks.

Family splits are structural and precede labels. These fixtures use shared native
primitives; they are a custom tau-compatible pilot, never official benchmark tasks.
"""
from __future__ import annotations

import copy
import json
import re
from datetime import date, timedelta
from pathlib import Path

from goalspec.fresh_tasks import NATIVE_COMMIT, _airline, _retail, action, digest, preflight

VERSION = "fresh-native-v4"
FAMILIES = {
    "retail": {
        "development": ["v4_ranked_available_variant_other_address", "v4_unknown_order_product_payment"],
        "heldout": ["v4_cross_order_color_capacity", "v4_price_partition_cancel_redirect"],
    },
    "airline": {
        "development": ["v4_reverse_nextday_cheapest", "v4_cabin_selected_baggage_and_quote"],
        "heldout": ["v4_return_connection_other_passenger", "v4_upgrade_before_nextday_retime"],
    },
}
STRUCTURES = {
    "v4_ranked_available_variant_other_address": "maximize available size under price cap on one order; redirect only another order",
    "v4_unknown_order_product_payment": "name and ZIP identity; discover order by product and pending status; change its payment only",
    "v4_cross_order_color_capacity": "bind desired color from a distinct delivered item; maximize available capacity on pending order",
    "v4_price_partition_cancel_redirect": "partition two pending orders by original price; cancel cheaper and redirect dearer; preserve delivered order",
    "v4_reverse_nextday_cheapest": "select return reservation by direction; move to cheapest Economy on relative next day; preserve outbound",
    "v4_cabin_selected_baggage_and_quote": "select business reservation for free bag; quote cheapest next-day Economy separately without booking",
    "v4_return_connection_other_passenger": "choose cheaper two-leg return next day; correct passenger only on distinct outbound reservation",
    "v4_upgrade_before_nextday_retime": "upgrade existing basic ticket before relative-next-day retiming under total cap; preserve second reservation",
}


def _retail_task(family, variant, number):
    db, _, _, _ = _retail("status", variant, number)
    uid, user = next(iter(db["users"].items()))
    oid, other = user["orders"]
    first, second = db["orders"][oid], db["orders"][other]
    item = first["items"][0]
    product = db["products"][item["product_id"]]
    original, replacement, premium = product["variants"]
    card, alternative, _gift = user["payment_methods"]
    user["name"] = {"first_name": "Nora", "last_name": "Vale"}
    user["email"] = f"nora.{number}@example.test"
    address = {**user["address"], "address1": f"{910 + variant} Pine Road", "city": "Bend", "zip": "97701"}
    address_text = f"{address['address1']}, Bend, OR 97701, USA, no apartment"
    patterns, references = [], []
    if family == "v4_ranked_available_variant_other_address":
        product["variants"][original]["options"]["size"] = "small"
        product["variants"][replacement]["options"]["size"] = "large"
        product["variants"][premium]["options"]["size"] = "extra large"
        product["variants"][premium]["price"] = item["price"] + 20
        product["variants"][premium]["available"] = variant == 0
        chosen = premium if variant == 0 else replacement
        references = [action("modify_pending_order_items", order_id=oid, item_ids=[original], new_item_ids=[chosen], payment_method_id=card),
                      action("modify_pending_order_address", order_id=other, **address)]
        request = (f"For order {oid}, change the backpack to the largest available size whose additional price is at most $25. "
                   f"Size preference is extra large, then large; any listed color is fine. Use the original Visa. "
                   f"Redirect only the OTHER order {other} to {address_text}. Keep order {oid}'s shipping address and my saved address unchanged.")
        branch = "extra_large_available" if variant == 0 else "large_fallback"
    elif family == "v4_unknown_order_product_payment":
        second["status"] = "delivered" if variant == 0 else "pending"
        first["status"] = "pending" if variant == 0 else "delivered"
        target = oid if variant == 0 else other
        references = [action("modify_pending_order_payment", order_id=target, payment_method_id=alternative)]
        request = ("I cannot remember either order ID. Find the pending order containing a Travel Backpack, "
                   "and change only its payment to my saved Mastercard ending 5202. The other backpack order was delivered; "
                   "leave that order, all items and all addresses unchanged.")
        branch = "first_pending" if variant == 0 else "second_pending"
    elif family == "v4_cross_order_color_capacity":
        product["name"] = "Water Bottle"
        target_color = "green" if variant == 0 else "black"
        for key, capacity, color in [(original, "500ml", "blue"), (replacement, "1000ml", target_color), (premium, "1500ml", target_color)]:
            product["variants"][key]["options"] = {"capacity": capacity, "color": color}
        product["variants"][premium]["available"] = variant == 1
        first["items"][0].update(name="Water Bottle", options=copy.deepcopy(product["variants"][original]["options"]))
        second["items"][0].update(name="Water Bottle", item_id=replacement, price=product["variants"][replacement]["price"],
                                  options=copy.deepcopy(product["variants"][replacement]["options"]))
        second["payment_history"][0]["amount"] = second["items"][0]["price"]
        second["status"] = "delivered"
        chosen = replacement if variant == 0 else premium
        references = [action("modify_pending_order_items", order_id=oid, item_ids=[original], new_item_ids=[chosen], payment_method_id=card)]
        request = (f"Change the 500ml bottle in pending order {oid} to the largest available bottle that matches the color "
                   f"of the 1000ml bottle in my delivered order {other}. I do not remember that color, so check it. "
                   "Additional charge must not exceed $65; use original Visa. Do not alter or return the delivered bottle or change any address.")
        branch = "matching_1000ml" if variant == 0 else "matching_1500ml"
    elif family == "v4_price_partition_cancel_redirect":
        third = f"#W{number}03"
        db["orders"][third] = {**copy.deepcopy(first), "order_id": third, "status": "delivered"}
        user["orders"].append(third)
        first_price, second_price = (70, 110) if variant == 0 else (115, 75)
        for order, amount in [(first, first_price), (second, second_price)]:
            order["items"][0]["price"] = amount
            order["payment_history"][0]["amount"] = amount
        cheaper, dearer = (oid, other) if variant == 0 else (other, oid)
        references = [action("cancel_pending_order", order_id=cheaper, reason="no longer needed"),
                      action("modify_pending_order_address", order_id=dearer, **address)]
        request = (f"Compare the original item totals of pending orders {oid} and {other}. Cancel the cheaper order because it is "
                   f"no longer needed; redirect only the more expensive pending order to {address_text}. "
                   f"Keep delivered order {third}, my saved address, and the remaining order's items and payment unchanged.")
        branch = "cancel_first" if variant == 0 else "cancel_second"
    else:
        raise ValueError(family)
    if family == "v4_unknown_order_product_payment":
        identity = "I don\u2019t quite recall my email. My name is Nora Vale and ZIP code is 97205."
    else:
        identity = f"My email is {user['email']}. My name is Nora Vale and ZIP code is 97205."
    return db, identity + " " + request, references, patterns, branch


def _airline_task(family, variant, number):
    db, _, _, _ = _airline("membership", variant, number)
    uid, user = next(iter(db["users"].items()))
    outbound_id, return_id = user["reservations"]
    outbound, returning = db["reservations"][outbound_id], db["reservations"][return_id]
    f1, f2, f3, _f4, _f5 = db["flights"]
    card = next(iter(user["payment_methods"]))
    original_date = outbound["flights"][0]["date"]
    next_date = (date.fromisoformat(original_date) + timedelta(days=1)).isoformat()
    base_price = outbound["flights"][0]["price"]
    for flight in db["flights"].values():
        flight["dates"][next_date] = copy.deepcopy(flight["dates"][original_date])
    returning.update(origin="JFK", destination="SFO")
    returning["flights"] = [{"flight_number": f3, "origin": "JFK", "destination": "SFO", "date": original_date, "price": base_price}]
    f6, f7, f8 = (f"HAT{number}{n}" for n in (6, 7, 8))
    for key, origin, destination, departure, arrival, fare in [(f6, "JFK", "SFO", "14:00:00", "18:00:00", base_price - 15),
             (f7, "JFK", "ORD", "08:00:00", "10:00:00", 85), (f8, "ORD", "SFO", "12:00:00", "15:00:00", 90)]:
        flight = copy.deepcopy(db["flights"][f3])
        flight.update(flight_number=key, origin=origin, destination=destination, scheduled_departure_time_est=departure,
                      scheduled_arrival_time_est=arrival)
        for details in flight["dates"].values():
            details["prices"] = {"basic_economy": fare - 30, "economy": fare, "business": fare + 300}
        db["flights"][key] = flight
    references, patterns = [], []
    if family == "v4_reverse_nextday_cheapest":
        chosen = f6 if variant == 0 else f3
        if variant:
            db["flights"][f6]["dates"][next_date]["available_seats"]["economy"] = 0
        references = [action("update_reservation_flights", reservation_id=return_id, cabin="economy",
                             flights=[{"flight_number": chosen, "date": next_date}], payment_id=card)]
        request = (f"Of reservations {outbound_id} and {return_id}, change only the return trip from JFK to SFO. "
                   "Move it to the day after its current flight, choosing the cheapest available nonstop Economy flight, never Basic Economy. "
                   "Keep its passenger and one bag. Use saved Visa for a fare difference or refund. Leave the outbound reservation untouched.")
        branch = "cheapest_later_available" if variant == 0 else "cheapest_later_sold_out"
    elif family == "v4_cabin_selected_baggage_and_quote":
        business_id = outbound_id if variant == 0 else return_id
        business = db["reservations"][business_id]
        business["cabin"] = "business"
        business["flights"][0]["price"] += 300
        business["payment_history"][0]["amount"] += 300
        references = [action("update_reservation_baggages", reservation_id=business_id, total_baggages=2, nonfree_baggages=0, payment_id=card)]
        patterns = [f1, str(base_price)]
        request = (f"Check which of reservations {outbound_id} and {return_id} is business class and add one bag only there, "
                   "making two total, only if both are free under policy. Do not add paid bags. "
                   f"Separately quote the cheapest nonstop Economy fare from SFO to JFK on {next_date}, with flight number and price. "
                   "Do not book or change any flights, passengers or insurance.")
        branch = "outbound_business" if variant == 0 else "return_business"
    elif family == "v4_return_connection_other_passenger":
        direct_price = 170 if variant == 1 else base_price - 15
        db["flights"][f6]["dates"][next_date]["prices"]["economy"] = direct_price
        itinerary = [{"flight_number": f7, "date": next_date}, {"flight_number": f8, "date": next_date}] if variant == 0 else [{"flight_number": f6, "date": next_date}]
        corrected = {**outbound["passengers"][0], "last_name": "Rivers"}
        references = [action("update_reservation_flights", reservation_id=return_id, cabin="economy", flights=itinerary, payment_id=card),
                      action("update_reservation_passengers", reservation_id=outbound_id, passengers=[corrected])]
        request = (f"Move return reservation {return_id} from JFK to SFO to the day after its present flight. Compare nonstop with one-stop via ORD "
                   "and choose the cheapest available Economy itinerary, never Basic Economy. Use Visa for the difference or refund. "
                   f"Separately correct the passenger surname only on outbound reservation {outbound_id} from River to Rivers, keeping Avery and DOB 1990-04-05. "
                   "Keep the return passenger name, both baggage counts, and the outbound flight unchanged.")
        branch = "connection_cheaper" if variant == 0 else "direct_cheaper"
    elif family == "v4_upgrade_before_nextday_retime":
        outbound["cabin"] = "basic_economy"
        outbound["flights"][0]["price"] = base_price - 40
        outbound["payment_history"][0]["amount"] = base_price - 40
        extra = 10 if variant == 0 else 70
        db["flights"][f2]["dates"][next_date]["prices"]["economy"] = base_price + extra
        if extra + 40 <= 80:
            references = [action("update_reservation_flights", reservation_id=outbound_id, cabin="economy",
                                 flights=[{"flight_number": f1, "date": original_date}], payment_id=card),
                          action("update_reservation_flights", reservation_id=outbound_id, cabin="economy",
                                 flights=[{"flight_number": f2, "date": next_date}], payment_id=card)]
        else:
            patterns = ["110", "80", r"unchanged|keep|exceed|over"]
        request = (f"For basic-economy reservation {outbound_id}, first check the combined extra price to upgrade to Economy on the current flight "
                   f"and then move to flight {f2} on the day after the current flight. Do both only if the TOTAL extra cost is at most $80. "
                   "If over $80, explain the total and make no changes, including no upgrade. Use saved Visa. "
                   f"Keep one bag, no insurance and all passenger details; leave return reservation {return_id} unchanged.")
        branch = "within_total_cap" if variant == 0 else "over_total_cap_preserve"
    else:
        raise ValueError(family)
    return db, f"My user ID is {uid}. " + request, references, patterns, branch


def build_tasks(study_id: str, stage: str):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,64}", study_id) or stage not in {"development", "confirmation"}:
        raise ValueError("A safe new study identity and bounded stage are required")
    split = "development" if stage == "development" else "heldout"
    tasks = []
    for domain, splits in FAMILIES.items():
        for family in splits[split]:
            for variant in range(2):
                number = int(digest([VERSION, study_id, domain, family, variant])[:7], 16)
                db, request, references, patterns, branch = {"retail": _retail_task, "airline": _airline_task}[domain](family, variant, number)
                instructions = (request + "\nOnly request the changes above. Give explicit confirmation after the assistant accurately summarizes "
                                "the affected records, requested changes and costs. Do not approve unrelated actions or substitutions. "
                                "Supply your known details when asked. Do not claim to have seen internal tool results.")
                record = {"schemaVersion": 1, "generator": VERSION, "nativeCommit": NATIVE_COMMIT, "studyId": study_id, "studyStage": stage,
                          "familyId": f"{domain}:{family}", "domain": domain, "split": split, "variant": variant,
                          "taskId": f"{study_id}:{stage}:{domain}:{family}:v{variant}", "initialDatabase": db, "initialRequest": request,
                          "userInstructions": instructions, "referenceActions": references, "responsePatterns": patterns,
                          "requireConfirmation": bool(references), "composition": STRUCTURES[family], "branch": branch,
                          "label": "custom tau-compatible pilot"}
                record["fixtureHash"] = digest(record)
                tasks.append(record)
    return tasks


def make_manifest(study_id: str, stage: str):
    tasks = build_tasks(study_id, stage)
    checks = {task["taskId"]: preflight(task) for task in tasks}
    for task in tasks:
        check = checks[task["taskId"]]
        if bool(task["referenceActions"]) != (check["initialStateHash"] != check["expectedStateHash"]):
            raise ValueError("Predeclared reference does not realize the expected change branch")
    manifest = {"schemaVersion": 1, "generator": VERSION, "studyId": study_id, "studyStage": stage, "nativeCommit": NATIVE_COMMIT,
                "label": "custom tau-compatible pilot", "familySplit": FAMILIES, "tasks": tasks, "checks": checks,
                "freshnessClaim": "new predeclared request/constraint compositions over shared native primitives; not unseen domains",
                "familyDefinition": "request and constraint structure, not randomized entity values",
                "previousDataRole": "v1/v2/v3 are development evidence only", "userProtocol": "unchanged-upstream-user-simulator"}
    manifest["manifestHash"] = digest(manifest)
    return manifest


def write_manifest(destination: Path, study_id: str, stage: str):
    manifest = make_manifest(study_id, stage)
    destination.mkdir(parents=True, exist_ok=False)
    path = destination / "fresh-tasks.json"
    with path.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")
    return path, manifest
