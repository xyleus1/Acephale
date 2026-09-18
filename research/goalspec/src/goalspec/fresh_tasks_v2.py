"""New synthetic task compositions over the unchanged pinned native toolkits.

These are fresh request/constraint combinations, not unseen domains or independent
real-world tasks. Entity randomization is supplementary and is not the freshness
claim. No prior actor outcomes or held-out transcripts enter this generator.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

from goalspec.fresh_tasks import NATIVE_COMMIT, _airline, _retail, action, digest, preflight

VERSION = "fresh-native-v2"
FAMILIES = {
    "retail": {
        "development": ["v2_payment_and_default_scope", "v2_subset_return_and_cancel"],
        "heldout": ["v2_status_selected_refunds", "v2_subset_variant_and_profile", "v2_availability_change_or_cancel", "v2_return_and_redirect"],
    },
    "airline": {
        "development": ["v2_retime_and_name", "v2_two_reservation_cabin_changes"],
        "heldout": ["v2_fare_cap_retime_or_keep", "v2_passenger_and_other_baggage", "v2_seat_and_price_booking", "v2_cancel_and_insured_roundtrip"],
    },
}
STRUCTURES = {
    "v2_payment_and_default_scope": "change one order payment plus saved profile; preserve both order shipping addresses",
    "v2_subset_return_and_cancel": "return one of two delivered items plus cancel a distinct pending order",
    "v2_status_selected_refunds": "select delivered orders among three statuses; select refund destination separately by original amount",
    "v2_subset_variant_and_profile": "replace one of two items plus saved profile; preserve other item and order shipping address",
    "v2_availability_change_or_cancel": "catalog availability selects mutually exclusive pending-item modification or cancellation",
    "v2_return_and_redirect": "return one delivered order to gift card plus redirect a different pending order; preserve profile",
    "v2_retime_and_name": "retime economy booking plus correct passenger; preserve second booking",
    "v2_two_reservation_cabin_changes": "retime one economy booking and upgrade another on its original flight",
    "v2_fare_cap_retime_or_keep": "price ceiling selects retiming or unchanged booking with factual denial",
    "v2_passenger_and_other_baggage": "correct one booking passenger and add baggage to the other; preserve inverse fields",
    "v2_seat_and_price_booking": "seat availability and price jointly select cabin for a new booking",
    "v2_cancel_and_insured_roundtrip": "cancel a business booking and create insured roundtrip while preserving economy booking",
}


def _retail_task(family, variant, number):
    db, _, _, _ = _retail("status", variant, number)
    uid, user = next(iter(db["users"].items()))
    oid, second = user["orders"]
    order = db["orders"][oid]
    item = order["items"][0]
    product = db["products"][item["product_id"]]
    old, replacement, premium = product["variants"]
    card, alternative, gift = user["payment_methods"]
    user["name"] = {"first_name": "Mira", "last_name": "Chen"}
    user["email"] = f"mira.{number}@example.test"
    address = {**user["address"], "address1": f"{730 + variant} Juniper Avenue", "city": "Eugene", "zip": "97401"}
    address_text = f"{address['address1']}, Eugene, OR 97401, USA, no apartment"
    new_color = product["variants"][replacement]["options"]["color"]
    original_price = item["price"]
    difference = product["variants"][replacement]["price"] - original_price
    cancel = action("cancel_pending_order", order_id=second, reason="no longer needed")
    profile = action("modify_user_address", user_id=uid, **address)
    ret = action("return_delivered_order_items", order_id=oid, item_ids=[old], payment_method_id=card)
    replace = action("modify_pending_order_items", order_id=oid, item_ids=[old], new_item_ids=[replacement], payment_method_id=card)
    patterns, references, branch = [], [], "fixed"
    if family in {"v2_subset_return_and_cancel", "v2_subset_variant_and_profile"}:
        other = {**copy.deepcopy(item), "item_id": premium, "price": product["variants"][premium]["price"], "options": product["variants"][premium]["options"]}
        order["items"].append(other)
        order["payment_history"][0]["amount"] += other["price"]
    if family == "v2_payment_and_default_scope":
        references = [action("modify_pending_order_payment", order_id=oid, payment_method_id=alternative), profile]
        request = f"Switch only order {oid} to my saved Mastercard ending 5202, and update my saved default address to {address_text}. Keep the shipping addresses on BOTH existing orders unchanged."
    elif family == "v2_subset_return_and_cancel":
        order["status"] = "delivered"
        references = [ret, cancel]
        request = f"Return only item {old} from delivered order {oid} to the original Visa, keeping the silver backpack. Separately cancel order {second} because it is no longer needed."
    elif family == "v2_status_selected_refunds":
        third = f"#W{number}03"
        db["orders"][third] = {**copy.deepcopy(order), "order_id": third}
        user["orders"].append(third)
        delivered = [oid, third] if variant == 0 else [second, third]
        db["orders"][third]["items"][0]["price"] = 120 + variant
        db["orders"][third]["payment_history"][0]["amount"] = 120 + variant
        for target in delivered:
            db["orders"][target]["status"] = "delivered"
            payment = gift if db["orders"][target]["items"][0]["price"] > 100 else card
            references.append(action("return_delivered_order_items", order_id=target, item_ids=[old], payment_method_id=payment))
        branch = "first_and_third_delivered" if variant == 0 else "second_and_third_delivered"
        request = f"Check orders {oid}, {second}, and {third}. Return backpacks only from orders already delivered. Refund each backpack to gift card {gift} if its original price exceeds $100, otherwise to original Visa. Leave pending orders completely unchanged."
    elif family == "v2_subset_variant_and_profile":
        references = [replace, profile]
        request = f"In order {oid}, replace only item {old} with the {new_color} medium backpack, paying the ${difference} difference with original Visa. Keep the silver item. Also set my saved default address to {address_text}, leaving this order's shipping address unchanged."
    elif family == "v2_availability_change_or_cancel":
        available = variant == 0
        product["variants"][replacement]["available"] = available
        references = [replace] if available else [action("cancel_pending_order", order_id=oid, reason="no longer needed")]
        branch = "available_replace" if available else "unavailable_cancel"
        request = f"For order {oid}, check whether the {new_color} medium backpack is available. If it is, replace my current backpack and pay ${difference} extra with Visa. If unavailable, cancel the order because it is no longer needed. Do not substitute another color; leave order {second} unchanged."
    elif family == "v2_return_and_redirect":
        order["status"] = "delivered"
        references = [action("return_delivered_order_items", order_id=oid, item_ids=[old], payment_method_id=gift),
                      action("modify_pending_order_address", order_id=second, **address)]
        request = f"Return the backpack in delivered order {oid}, refunding saved gift card {gift}. Redirect only pending order {second} to {address_text}. Keep my saved default address unchanged."
    else:
        raise ValueError(family)
    identity = f"My email is {user['email']}. My name is Mira Chen and my current ZIP is {user['address']['zip']}."
    return db, identity + " " + request, references, patterns, branch


def _airline_task(family, variant, number):
    db, _, _, _ = _airline("membership", variant, number)
    uid, user = next(iter(db["users"].items()))
    rid, second = user["reservations"]
    reservation = db["reservations"][rid]
    f1, f2, f3, _, _ = db["flights"]
    date = reservation["flights"][0]["date"]
    return_date = list(db["flights"][f1]["dates"])[1]
    card, gift = user["payment_methods"]
    passenger = {"first_name": "Mira", "last_name": "Chen", "dob": "1988-06-12"}
    corrected = {**passenger, "last_name": "Cheng"}
    user["name"] = {"first_name": "Mira", "last_name": "Chen"}
    user["saved_passengers"] = [copy.deepcopy(passenger)]
    user["dob"] = passenger["dob"]
    for row in db["reservations"].values():
        row["passengers"] = [copy.deepcopy(passenger)]
    price = reservation["flights"][0]["price"]
    retime = action("update_reservation_flights", reservation_id=rid, cabin="economy", flights=[{"flight_number": f2, "date": date}], payment_id=card)
    correction = action("update_reservation_passengers", reservation_id=rid, passengers=[corrected])
    patterns, references, branch = [], [], "fixed"
    if family == "v2_retime_and_name":
        references = [retime, correction]
        request = f"Move reservation {rid} to later flight {f2} on {date}, keeping economy and one bag and paying the $40 difference with Visa. Correct its passenger surname from Chen to Cheng, keeping Mira and DOB 1988-06-12. Leave reservation {second} unchanged."
    elif family == "v2_two_reservation_cabin_changes":
        upgrade = action("update_reservation_flights", reservation_id=second, cabin="business", flights=[{"flight_number": f1, "date": date}], payment_id=card)
        references = [retime, upgrade]
        request = f"Move only reservation {rid} to {f2} on {date} in economy for $40 extra. Upgrade reservation {second} to business while keeping its original flight {f1}, paying $300 extra. Use saved Visa and keep the existing one bag on each reservation."
    elif family == "v2_fare_cap_retime_or_keep":
        extra = 20 if variant == 0 else 70
        db["flights"][f2]["dates"][date]["prices"]["economy"] = price + extra
        references = [retime] if extra <= 35 else []
        branch = "within_cap_retime" if references else "over_cap_preserve"
        patterns = [] if references else [r"70", r"35", r"unchanged|keep|cannot|exceed|over"]
        request = f"For reservation {rid}, check moving to {f2} on {date} in economy. Change only if the extra fare is at most $35, paying Visa. Otherwise explain the extra fare and keep everything unchanged. Keep one bag and leave reservation {second} unchanged."
    elif family == "v2_passenger_and_other_baggage":
        target, bags = (rid, second) if variant == 0 else (second, rid)
        references = [action("update_reservation_passengers", reservation_id=target, passengers=[corrected]),
                      action("update_reservation_baggages", reservation_id=bags, total_baggages=2, nonfree_baggages=1, payment_id=card)]
        branch = "correct_first_bag_second" if variant == 0 else "correct_second_bag_first"
        request = f"Correct the surname only on reservation {target} to Cheng, keeping Mira and DOB 1988-06-12; leave its bags unchanged. Add one checked bag only on reservation {bags}, making two total with a $50 Visa charge; leave its passenger name unchanged. Do not change either flight."
    elif family == "v2_seat_and_price_booking":
        flight = db["flights"][f2]["dates"][date]
        flight["prices"]["business"] = 320
        flight["prices"]["economy"] = 260
        flight["available_seats"]["business"] = 2 if variant == 0 else 0
        cabin = "business" if variant == 0 else "economy"
        total = flight["prices"][cabin]
        references = [action("book_reservation", user_id=uid, origin="SFO", destination="JFK", flight_type="one_way", cabin=cabin,
                             flights=[{"flight_number": f2, "date": date}], passengers=[passenger], payment_methods=[{"payment_id": card, "amount": total}],
                             total_baggages=1, nonfree_baggages=0, insurance="no")]
        branch = "business_available" if variant == 0 else "business_unavailable_economy"
        request = f"Book a new one-way SFO to JFK trip on {f2} on {date} for Mira Chen, DOB 1988-06-12. Choose business only if a seat is available AND fare is at most $350; otherwise choose economy if available and within $350. One checked bag, no insurance, pay saved Visa. Keep both existing reservations unchanged."
    elif family == "v2_cancel_and_insured_roundtrip":
        reservation["cabin"] = "business"
        reservation["flights"][0]["price"] += 300
        reservation["payment_history"][0]["amount"] += 300
        total = 2 * price + 30
        references = [action("cancel_reservation", reservation_id=rid),
                      action("book_reservation", user_id=uid, origin="SFO", destination="JFK", flight_type="round_trip", cabin="economy",
                             flights=[{"flight_number": f1, "date": date}, {"flight_number": f3, "date": return_date}], passengers=[passenger],
                             payment_methods=[{"payment_id": gift, "amount": total}], total_baggages=1, nonfree_baggages=0, insurance="yes")]
        request = f"Cancel business reservation {rid} for a change of plans, preserving economy reservation {second}. Book a separate insured economy roundtrip SFO to JFK, outbound {date} on {f1} and back {return_date} on {f3}, for Mira Chen DOB 1988-06-12, one bag. Pay ${total} from saved gift card {gift}, including insurance."
    else:
        raise ValueError(family)
    return db, f"My user ID is {uid}. " + request, references, patterns, branch


def build_tasks(study_id: str, stage: str):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,64}", study_id) or stage not in {"development-1", "development-2", "confirmation"}:
        raise ValueError("A new safe study identity and bounded stage are required")
    split = "heldout" if stage == "confirmation" else "development"
    tasks = []
    for domain, splits in FAMILIES.items():
        for family in splits[split]:
            for variant in range(2):
                number = int(digest([VERSION, study_id, stage, domain, family, variant])[:7], 16)
                db, request, references, patterns, branch = {"retail": _retail_task, "airline": _airline_task}[domain](family, variant, number)
                instructions = request + "\nOnly request the specified changes. Explicitly confirm only after the agent summarizes the exact affected records, changes, and costs. Do not approve substitutions or unrelated changes. Supply known details when asked. Once all requests are completed or a policy/price denial is explained, say thank you and ###STOP###. Do not claim to see internal tool results."
                record = {"schemaVersion": 1, "generator": VERSION, "nativeCommit": NATIVE_COMMIT, "studyId": study_id, "studyStage": stage,
                          "familyId": f"{domain}:{family}", "domain": domain, "split": split, "variant": variant,
                          "taskId": f"{study_id}:{stage}:{domain}:{family}:v{variant}", "initialDatabase": db, "initialRequest": request,
                          "userInstructions": instructions, "referenceActions": references, "responsePatterns": patterns, "requireConfirmation": bool(references),
                          "composition": STRUCTURES[family], "branch": branch, "label": "custom tau-compatible pilot"}
                record["fixtureHash"] = digest(record)
                tasks.append(record)
    return tasks


def make_manifest(study_id: str, stage: str):
    tasks = build_tasks(study_id, stage)
    checks = {task["taskId"]: preflight(task) for task in tasks}
    for task in tasks:
        check = checks[task["taskId"]]
        if bool(task["referenceActions"]) != (check["initialStateHash"] != check["expectedStateHash"]):
            raise ValueError("Reference path must realize the predeclared mutation/no-change branch")
    manifest = {"schemaVersion": 1, "generator": VERSION, "studyId": study_id, "studyStage": stage, "nativeCommit": NATIVE_COMMIT,
                "label": "custom tau-compatible pilot", "familySplit": FAMILIES, "tasks": tasks, "checks": checks,
                "freshnessClaim": "new request and policy/constraint compositions over shared native primitives; not unseen domains",
                "v1HeldoutRole": "development evidence only", "familyDefinition": "predeclared request/constraint structure, not entity values"}
    manifest["manifestHash"] = digest(manifest)
    return manifest


def write_manifest(destination: Path, study_id: str, stage: str):
    manifest = make_manifest(study_id, stage)
    destination.mkdir(parents=True, exist_ok=False)
    path = destination / "fresh-tasks.json"
    with path.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    return path, manifest
