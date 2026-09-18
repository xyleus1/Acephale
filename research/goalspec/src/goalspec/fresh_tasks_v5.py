"""Fresh v5 compositions over pinned native primitives, never official task data.

The family structure and training/calibration split are fixed before annotation.
Native reference preflight establishes full-state targets independently of actors.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

from goalspec.fresh_tasks import NATIVE_COMMIT, _airline, _retail, action, digest, native_environment, preflight

VERSION = "fresh-native-v5"
STRUCTURES = {
    "retail": {
        "train": {
            "return_cheaper_then_pending_payment": "compare two delivered totals; return cheaper to original card; change third pending order payment",
            "return_costlier_item_and_profile": "return only costlier of two delivered items; update saved address while preserving order shipping",
            "exchange_subset_and_quote_other_product": "exchange one of two delivered products; quote alternatives for the other without changing it",
            "cancel_selected_and_other_payment": "cancel higher-priced pending order; change lower-priced pending order payment",
            "swap_two_order_shipping_addresses": "swap two pending order addresses using their original values; preserve saved profile",
            "profile_from_delivered_address": "copy address of uniquely delivered order to saved profile; preserve both orders",
            "balance_selected_refund_and_tracking": "refund delivered item to gift only below current balance threshold; report distinct processed order tracking",
            "two_product_modification_total_cap": "replace two distinct pending products in one tool invocation under their combined additional-price cap",
            "exchange_destination_selected_order": "select one of two delivered orders by shipping destination; exchange its item; preserve other order",
            "payment_before_variant_same_order": "switch pending order payment first; replace variant using the newly selected payment method",
        },
        "development": {
            "exchange_bundle_and_other_payment": "exchange two delivered products in one invocation under combined cap; change a distinct pending order payment",
            "ranked_payment_and_copied_profile": "change payment on higher-priced pending order; copy lower-priced order address into saved profile",
        },
    },
    "airline": {
        "train": {
            "all_economy_upgrades_combined_cap": "upgrade both economy reservations together only under combined cap; preserve basic-economy reservation",
            "cancel_cheaper_business_add_other_bag": "compare two business fares; cancel cheaper; add free bag to dearer only",
            "copy_passenger_from_other_booking": "copy corrected passenger details from another booking; preserve source booking and saved passenger",
            "group_upgrade_seat_feasibility": "upgrade existing two-passenger reservation only when both seats and combined fare cap permit",
            "insured_cancel_other_passenger": "cancel insured economy booking for illness; correct passenger on other uninsured booking",
            "earliest_after_cutoff_retime": "choose earliest available nonstop after departure cutoff even when a later flight is cheaper",
            "roundtrip_return_date_only": "move only roundtrip return leg to its next date; submit complete itinerary preserving outbound",
            "membership_and_per_booking_bag_cap": "add bags separately by membership/cabin allowance and per-booking fee cap",
            "two_passenger_split_payment_booking": "book two passengers using entire limited gift balance then one credit card for remainder",
            "swap_two_reservation_dates": "swap dates between two economy reservations while keeping their distinct flight numbers and other fields",
        },
        "development": {
            "earliest_priority_upgrade_budget": "among three economy reservations, upgrade earliest departure first while combined budget permits only one",
            "roundtrip_outbound_connection_and_name": "replace roundtrip outbound with two-leg connection while preserving return; correct same booking surname",
        },
    },
}
FAMILIES = {domain: {split: [f"v5_{name}" for name in families] for split, families in splits.items()}
            for domain, splits in STRUCTURES.items()}


def family_splits():
    """Two calibration families per domain; no labels/outcomes enter assignment."""
    result = {}
    for domain, splits in FAMILIES.items():
        ordered = sorted(splits["train"], key=lambda family: digest(["v5-split-before-labels", domain, family]))
        result.update({f"{domain}:{family}": "calibration" if i < 2 else "train" for i, family in enumerate(ordered)})
        result.update({f"{domain}:{family}": "development" for family in splits["development"]})
    return result


def _address(variant, kind=0):
    return {"address1": f"{610 + variant + kind * 10} Alder Avenue", "address2": "", "city": "Eugene" if kind == 0 else "Bend",
            "state": "OR", "country": "USA", "zip": "97401" if kind == 0 else "97701"}


def _address_text(value):
    return f"{value['address1']}, {value['city']}, OR {value['zip']}, USA, no apartment"


def _retail_task(family, variant, number):
    db, _, _, _ = _retail("status", variant, number)
    uid, user = next(iter(db["users"].items()))
    oid, second = user["orders"]
    first, other = db["orders"][oid], db["orders"][second]
    product_id = first["items"][0]["product_id"]
    product = db["products"][product_id]
    old, new, premium = product["variants"]
    card, alternative, gift = user["payment_methods"]
    user["name"] = {"first_name": "Elena", "last_name": "Park"}
    user["email"] = f"elena.{number}@example.test"
    address = _address(variant)
    references, patterns, preserves = [], [], []
    branch = "fixed_composition"
    color = product["variants"][new]["options"]["color"]
    difference = product["variants"][new]["price"] - first["items"][0]["price"]

    def payment(target):
        return action("modify_pending_order_payment", order_id=target, payment_method_id=alternative)

    def profile(value=address):
        return action("modify_user_address", user_id=uid, **value)

    def return_item(target, item=old, method=card):
        return action("return_delivered_order_items", order_id=target, item_ids=[item], payment_method_id=method)

    def exchange(target, before=None, after=None):
        return action("exchange_delivered_order_items", order_id=target, item_ids=before or [old], new_item_ids=after or [new], payment_method_id=card)

    def add_product(order):
        pid, original, replacement = (str(number * 100 + n) for n in (20, 21, 22))
        price = 35 + variant * 5
        variants = {original: {"item_id": original, "options": {"color": "white", "capacity": "500ml"}, "available": True, "price": price},
                    replacement: {"item_id": replacement, "options": {"color": "black", "capacity": "1000ml"}, "available": True, "price": price + 15}}
        db["products"][pid] = {"name": "Water Bottle", "product_id": pid, "variants": variants}
        order["items"].append({"name": "Water Bottle", "product_id": pid, "item_id": original,
                               "price": price, "options": copy.deepcopy(variants[original]["options"])})
        order["payment_history"][0]["amount"] += price
        return pid, original, replacement

    if family == "return_cheaper_then_pending_payment":
        third = f"#W{number}03"
        db["orders"][third] = {**copy.deepcopy(first), "order_id": third}
        user["orders"].append(third)
        for order, price in zip((first, other), (60, 110) if variant == 0 else (115, 65)):
            order["status"] = "delivered"
            order["items"][0]["price"] = order["payment_history"][0]["amount"] = price
        target = oid if variant == 0 else second
        references = [return_item(target), payment(third)]
        request = (f"Compare the original totals of delivered orders {oid} and {second}. Return only the cheaper backpack to its original Visa. "
                   f"Switch only pending order {third} to Mastercard ending 5202. Preserve the more expensive delivered order and every address.")
        preserves = [["orders", second if variant == 0 else oid], ["users", uid, "address"]]
        branch = "return_first" if variant == 0 else "return_second"
    elif family == "return_costlier_item_and_profile":
        first["status"] = "delivered"
        expensive = copy.deepcopy(first["items"][0])
        expensive.update(item_id=premium, price=product["variants"][premium]["price"], options=copy.deepcopy(product["variants"][premium]["options"]))
        first["items"].append(expensive)
        first["payment_history"][0]["amount"] += expensive["price"]
        references = [return_item(oid, premium), profile()]
        request = (f"Return only the more expensive of the two backpacks in delivered order {oid}, refunding original Visa. Keep the cheaper backpack. "
                   f"Set my saved profile address to {_address_text(address)}; do not redirect any existing order.")
        preserves = [["orders", second], ["orders", oid, "address"]]
    elif family == "exchange_subset_and_quote_other_product":
        first["status"] = "delivered"
        pid, bottle, _ = add_product(first)
        references = [exchange(oid)]
        patterns = [str(50 + variant * 5), "1000"]
        request = (f"In delivered order {oid}, exchange only the backpack for {color} medium, paying ${difference} with original Visa. "
                   f"Keep the bottle unchanged. Separately quote the black 1000ml bottle in product {pid}, including capacity and price, but do not exchange or buy it.")
        preserves = [["orders", second], ["orders", oid, "items", 1]]
    elif family == "cancel_selected_and_other_payment":
        for order, price in zip((first, other), (150, 70) if variant == 0 else (75, 155)):
            order["items"][0]["price"] = order["payment_history"][0]["amount"] = price
        cancel, pay = (oid, second) if variant == 0 else (second, oid)
        references = [action("cancel_pending_order", order_id=cancel, reason="no longer needed"), payment(pay)]
        request = (f"Compare pending orders {oid} and {second}. Cancel only the one with the larger original total because it is no longer needed. "
                   "Switch only the cheaper remaining order to saved Mastercard ending 5202. Keep its items and all addresses unchanged.")
        preserves = [["users", uid, "address"], ["orders", pay, "items"]]
        branch = "cancel_first_pay_second" if variant == 0 else "cancel_second_pay_first"
    elif family == "swap_two_order_shipping_addresses":
        other["address"] = _address(variant, 1)
        references = [action("modify_pending_order_address", order_id=oid, **copy.deepcopy(other["address"])),
                      action("modify_pending_order_address", order_id=second, **copy.deepcopy(first["address"]))]
        request = (f"Swap the existing shipping addresses of pending orders {oid} and {second}: each should get the other's ORIGINAL address. "
                   "Look up both before updating either. Keep saved profile, items and payments unchanged.")
        preserves = [["users", uid, "address"], ["orders", oid, "items"], ["orders", second, "items"]]
    elif family == "profile_from_delivered_address":
        target = oid if variant == 0 else second
        db["orders"][target]["status"] = "delivered"
        db["orders"][target]["address"] = _address(variant, 1)
        references = [profile(copy.deepcopy(db["orders"][target]["address"]))]
        request = (f"Look at orders {oid} and {second}. Copy the complete shipping address of the DELIVERED order to my saved profile. "
                   "The pending order's address is not the one I want. Do not modify either order.")
        preserves = [["orders"]]
        branch = "copy_first" if variant == 0 else "copy_second"
    elif family == "balance_selected_refund_and_tracking":
        first["status"], other["status"] = "delivered", "processed"
        tracking = f"TRACK-V5-{number}"
        other["fulfillments"] = [{"tracking_id": [tracking], "item_ids": [old]}]
        user["payment_methods"][gift]["balance"] = 50 if variant == 0 else 150
        references = [return_item(oid, method=gift if variant == 0 else card)]
        patterns = [tracking]
        request = (f"Return the backpack from delivered order {oid}. Check my gift card {gift}: refund there only if its CURRENT balance is below $100; "
                   f"otherwise refund original Visa. Also tell me tracking for processed order {second}, leaving that order unchanged.")
        preserves = [["orders", second]]
        branch = "refund_gift" if variant == 0 else "refund_original"
    elif family in {"two_product_modification_total_cap", "exchange_bundle_and_other_payment"}:
        _, bottle, larger = add_product(first)
        total_extra = difference + 15
        cap = 30 if variant == 0 else 20
        if family == "exchange_bundle_and_other_payment":
            first["status"] = "delivered"
            references = [exchange(oid, [old, bottle], [new, larger]), payment(second)]
            request = (f"Exchange BOTH products in delivered order {oid} in one exchange request: backpack to {color} medium and bottle to black 1000ml. "
                       f"The combined additional charge must be at most $30; use original Visa. Also switch only pending order {second} to Mastercard ending 5202. "
                       "Preserve addresses and that pending order's items.")
            preserves = [["orders", second, "items"], ["users", uid, "address"]]
        else:
            references = [action("modify_pending_order_items", order_id=oid, item_ids=[old, bottle], new_item_ids=[new, larger], payment_method_id=card)] if total_extra <= cap else []
            patterns = [] if references else [str(total_extra), str(cap), r"unchanged|over|exceed|cannot"]
            request = (f"For pending order {oid}, price changing BOTH products together: backpack to {color} medium and bottle to black 1000ml. "
                       f"Only do the complete pair if TOTAL extra cost is at most ${cap}; otherwise explain and change neither item. "
                       "Use original Visa and one item-modification request containing both replacements. Keep every address and the other order unchanged.")
            preserves = [["orders", second], ["users", uid, "address"]]
            branch = "both_within_cap" if references else "neither_over_cap"
    elif family == "exchange_destination_selected_order":
        first["status"] = other["status"] = "delivered"
        target = oid if variant == 0 else second
        db["orders"][target]["address"] = _address(variant, 1)
        references = [exchange(target)]
        request = (f"Of delivered orders {oid} and {second}, exchange only the backpack shipped to Bend, ZIP97701, for {color} medium. "
                   f"Use original Visa for ${difference} extra. Do not exchange the Portland order or change any address.")
        preserves = [["orders", second if variant == 0 else oid], ["users", uid, "address"]]
        branch = "bend_first" if variant == 0 else "bend_second"
    elif family == "payment_before_variant_same_order":
        references = [payment(oid), action("modify_pending_order_items", order_id=oid, item_ids=[old], new_item_ids=[new], payment_method_id=alternative)]
        request = (f"First switch pending order {oid}'s original payment from Visa to saved Mastercard ending5202. "
                   f"Then change its backpack to {color} medium, charging the ${difference} difference to that same Mastercard. "
                   "Do not modify items before switching payment. Keep addresses and the other order unchanged.")
        preserves = [["orders", second], ["users", uid, "address"]]
    elif family == "ranked_payment_and_copied_profile":
        other["address"] = _address(variant, 1)
        for order, price in zip((first, other), (160, 70) if variant == 0 else (75, 165)):
            order["items"][0]["price"] = order["payment_history"][0]["amount"] = price
        dearer, cheaper = (oid, second) if variant == 0 else (second, oid)
        references = [payment(dearer), profile(copy.deepcopy(db["orders"][cheaper]["address"]))]
        request = (f"Compare original totals of pending orders {oid} and {second}. Switch the more expensive order to Mastercard ending5202. "
                   "Separately copy the cheaper order's complete shipping address to my saved profile. Do not redirect either order or change any items.")
        preserves = [["orders", oid, "address"], ["orders", second, "address"], ["orders", cheaper, "payment_history"]]
        branch = "pay_first_copy_second" if variant == 0 else "pay_second_copy_first"
    else:
        raise ValueError(family)
    identity = f"My email is {user['email']}. My name is Elena Park and current profile ZIP is97205. "
    return db, identity + request, references, patterns, branch, preserves


def _airline_task(family, variant, number):
    db, _, _, _ = _airline("membership", variant, number)
    uid, user = next(iter(db["users"].items()))
    rid, second = user["reservations"]
    first, other = db["reservations"][rid], db["reservations"][second]
    f1, f2, f3, f4, f5 = db["flights"]
    original_date, return_date = list(db["flights"][f1]["dates"])
    card, gift = user["payment_methods"]
    price = first["flights"][0]["price"]
    passenger = copy.deepcopy(first["passengers"][0])
    corrected = {**passenger, "last_name": "Rivers"}
    references, patterns, preserves = [], [], []
    branch = "fixed_composition"

    def change(target, cabin="economy", flights=None):
        return action("update_reservation_flights", reservation_id=target, cabin=cabin,
                      flights=flights or [{"flight_number": f1, "date": original_date}], payment_id=card)

    def business(reservation):
        reservation["cabin"] = "business"
        reservation["flights"][0]["price"] += 300
        reservation["payment_history"][0]["amount"] += 300

    def roundtrip():
        first["flight_type"] = "round_trip"
        first["flights"].append({"flight_number": f3, "origin": "JFK", "destination": "SFO", "date": return_date, "price": price})
        first["payment_history"][0]["amount"] += price

    if family == "all_economy_upgrades_combined_cap":
        third = f"G{number}C"
        db["reservations"][third] = copy.deepcopy(first)
        db["reservations"][third].update(reservation_id=third, cabin="basic_economy")
        db["reservations"][third]["flights"][0]["price"] = price - 40
        db["reservations"][third]["payment_history"][0]["amount"] = price - 40
        db["reservations"][third]["total_baggages"] = 0
        user["reservations"].append(third)
        cap = 620 if variant == 0 else 550
        references = [change(rid, "business"), change(second, "business")] if cap >= 600 else []
        patterns = [] if references else ["600", str(cap), r"unchanged|over|exceed|cannot"]
        request = (f"Look up {rid}, {second}, and {third}. Upgrade both Economy reservations together to Business on their existing flights "
                   f"only if the COMBINED additional fare is at most ${cap}. If over, upgrade neither. Do not touch the Basic Economy reservation. "
                   "Use Visa and retain existing bags, passenger details and insurance.")
        preserves = [["reservations", third]]
        branch = "both_within_cap" if references else "neither_over_cap"
    elif family == "cancel_cheaper_business_add_other_bag":
        business(first); business(other)
        for reservation, amount in zip((first, other), (500, 550) if variant == 0 else (560, 510)):
            reservation["flights"][0]["price"] = reservation["payment_history"][0]["amount"] = amount
        cheaper, dearer = (rid, second) if variant == 0 else (second, rid)
        references = [action("cancel_reservation", reservation_id=cheaper), action("update_reservation_baggages", reservation_id=dearer,
                      total_baggages=2, nonfree_baggages=0, payment_id=card)]
        request = (f"Compare original fares on business reservations {rid} and {second}. Cancel only the cheaper one for a change of plans. "
                   "Add one checked bag only to the more expensive one, making two total, if both are free. Keep that booking's flights and passenger unchanged.")
        preserves = [["reservations", dearer, "flights"], ["reservations", dearer, "passengers"]]
        branch = "cancel_first" if variant == 0 else "cancel_second"
    elif family == "copy_passenger_from_other_booking":
        target, source = (rid, second) if variant == 0 else (second, rid)
        db["reservations"][source]["passengers"] = [copy.deepcopy(corrected)]
        references = [action("update_reservation_passengers", reservation_id=target, passengers=[corrected])]
        request = (f"Reservation {source} has my correct passenger spelling; reservation {target} has the typo. "
                   f"Copy the complete passenger name and DOB from {source} to {target}. Keep source booking, saved passenger profile, flights, bags and insurance unchanged.")
        preserves = [["reservations", source], ["users", uid, "saved_passengers"]]
        branch = "copy_second_to_first" if variant == 0 else "copy_first_to_second"
    elif family == "group_upgrade_seat_feasibility":
        companion = {"first_name": "Morgan", "last_name": "River", "dob": "1992-07-08"}
        first["passengers"].append(companion)
        first["payment_history"][0]["amount"] = price * 2
        first["total_baggages"] = 2
        db["flights"][f1]["dates"][original_date]["available_seats"]["business"] = 2 if variant == 0 else 1
        references = [change(rid, "business")] if variant == 0 else []
        patterns = [] if references else [r"seat|available", r"unchanged|cannot|not enough|only one"]
        request = (f"Upgrade existing reservation {rid} with both passengers to Business on its same flight only if BOTH seats are available "
                   "and total additional fare is at most $650. Never split passengers or remove one. If insufficient seats, explain and leave it untouched. "
                   f"Keep two total bags and no insurance; use Visa; preserve {second}.")
        preserves = [["reservations", second], ["reservations", rid, "passengers"]]
        branch = "two_seats" if variant == 0 else "only_one_seat"
    elif family == "insured_cancel_other_passenger":
        insured, correct = (rid, second) if variant == 0 else (second, rid)
        db["reservations"][insured]["insurance"] = "yes"
        db["reservations"][insured]["payment_history"][0]["amount"] += 30
        references = [action("cancel_reservation", reservation_id=insured), action("update_reservation_passengers", reservation_id=correct, passengers=[corrected])]
        request = (f"Of {rid} and {second}, cancel only the insured reservation because I am ill and unable to travel. "
                   "Correct surname River to Rivers only on the uninsured reservation, keeping Avery and DOB1990-04-05. Keep its flight, bag and insurance unchanged.")
        preserves = [["reservations", correct, "flights"], ["reservations", correct, "insurance"]]
        branch = "cancel_first" if variant == 0 else "cancel_second"
    elif family == "earliest_after_cutoff_retime":
        later = f"HAT{number}6"
        db["flights"][later] = copy.deepcopy(db["flights"][f2])
        db["flights"][later].update(flight_number=later, scheduled_departure_time_est="13:00:00", scheduled_arrival_time_est="21:00:00")
        for details in db["flights"][later]["dates"].values():
            details["prices"]["economy"] = price + 10
        if variant:
            db["flights"][f2]["dates"][original_date]["available_seats"]["economy"] = 0
        chosen = f2 if variant == 0 else later
        references = [change(rid, flights=[{"flight_number": chosen, "date": original_date}])]
        request = (f"Move {rid} to the EARLIEST available nonstop SFO to JFK departing after10:00 on {original_date}, retaining Economy. "
                   "Do not choose a later flight just because it is cheaper; additional fare must stay within$45. Use Visa, keep the bag and passenger, and preserve the other reservation.")
        preserves = [["reservations", second]]
        branch = "eleven_available" if variant == 0 else "thirteen_fallback"
    elif family == "roundtrip_return_date_only":
        from datetime import date, timedelta
        roundtrip()
        new_date = (date.fromisoformat(return_date) + timedelta(days=1)).isoformat()
        db["flights"][f3]["dates"][new_date] = copy.deepcopy(db["flights"][f3]["dates"][return_date])
        db["flights"][f3]["dates"][new_date]["prices"]["economy"] += 15 + variant * 5
        references = [change(rid, flights=[{"flight_number": f1, "date": original_date}, {"flight_number": f3, "date": new_date}])]
        request = (f"For roundtrip reservation {rid}, move only the RETURN leg to the day after its current date, keeping its flight number. "
                   "Keep the outbound leg exactly as booked, Economy cabin, passenger and bag. Use Visa for up to$25 extra. Preserve the other reservation.")
        preserves = [["reservations", second], ["reservations", rid, "flights", 0]]
    elif family == "membership_and_per_booking_bag_cap":
        business(other)
        user["membership"] = "regular" if variant == 0 else "silver"
        targets = [second] if variant == 0 else [rid, second]
        references = [action("update_reservation_baggages", reservation_id=target, total_baggages=2, nonfree_baggages=0, payment_id=card) for target in targets]
        request = (f"For EACH reservation {rid} and {second}, use my membership and its cabin to price adding one bag, making two total. "
                   "Add it only if that reservation's additional charge is at most$40; skip any booking above that cap and explain. Do not pool the caps or change flights/passengers.")
        patterns = ["50"] if variant == 0 else []
        preserves = [["reservations", rid, "flights"], ["reservations", second, "flights"]]
        branch = "business_only" if variant == 0 else "both_free_silver"
    elif family == "two_passenger_split_payment_booking":
        companion = {"first_name": "Morgan", "last_name": "River", "dob": "1992-07-08"}
        balance = 100 + variant * 50
        user["payment_methods"][gift]["amount"] = balance
        total = 2 * (price + 40)
        references = [action("book_reservation", user_id=uid, origin="SFO", destination="JFK", flight_type="one_way", cabin="economy",
                             flights=[{"flight_number": f2, "date": original_date}], passengers=[passenger, companion],
                             payment_methods=[{"payment_id": gift, "amount": balance}, {"payment_id": card, "amount": total - balance}],
                             total_baggages=2, nonfree_baggages=0, insurance="no")]
        request = (f"Book a NEW Economy one-way SFO to JFK on {f2}, {original_date}, for Avery River DOB1990-04-05 and Morgan River DOB1992-07-08. "
                   f"Two total checked bags, no insurance. Use ALL current balance of saved gift card {gift}, then charge the remainder to saved Visa. "
                   "Confirm the split amounts before booking. Keep existing reservations unchanged.")
        preserves = [["reservations", rid], ["reservations", second]]
    elif family == "swap_two_reservation_dates":
        other["flights"] = [{"flight_number": f2, "origin": "SFO", "destination": "JFK", "date": return_date, "price": price + 40}]
        other["payment_history"][0]["amount"] = price + 40
        references = [change(rid, flights=[{"flight_number": f1, "date": return_date}]), change(second, flights=[{"flight_number": f2, "date": original_date}])]
        request = (f"Swap the travel dates of reservations {rid} and {second}, using their ORIGINAL dates before either change. "
                   "Keep each reservation's own flight number, Economy cabin, passenger, one bag and insurance. Use Visa if a fare difference arises; do not swap flight numbers.")
        preserves = [["reservations", rid, "passengers"], ["reservations", second, "passengers"]]
    elif family == "earliest_priority_upgrade_budget":
        third = f"G{number}C"
        db["reservations"][third] = {**copy.deepcopy(first), "reservation_id": third}
        user["reservations"].append(third)
        early = rid if variant == 0 else second
        late = second if variant == 0 else rid
        db["reservations"][late]["flights"] = [{"flight_number": f2, "origin": "SFO", "destination": "JFK", "date": original_date, "price": price + 40}]
        db["reservations"][late]["payment_history"][0]["amount"] = price + 40
        db["reservations"][third]["flights"][0]["date"] = return_date
        references = [change(early, "business")]
        request = (f"I have a TOTAL upgrade budget of$350 across {rid}, {second} and {third}. Prioritize earliest departure date, then departure time. "
                   "Upgrade to Business in that order while the cumulative extra fare fits; skip any upgrade that would exceed the total. Keep booked flights, bags and names; use Visa.")
        preserves = [["reservations", late], ["reservations", third]]
        branch = "first_earliest" if variant == 0 else "second_earliest"
    elif family == "roundtrip_outbound_connection_and_name":
        roundtrip()
        references = [change(rid, flights=[{"flight_number": f4, "date": original_date}, {"flight_number": f5, "date": original_date}, {"flight_number": f3, "date": return_date}]),
                      action("update_reservation_passengers", reservation_id=rid, passengers=[corrected])]
        request = (f"Change only the OUTBOUND part of roundtrip {rid} to the connection via ORD on its same date, keeping the original return flight and date. "
                   "Retain Economy and one bag, paying or refunding the fare difference to Visa. Correct its surname River to Rivers, keeping Avery and DOB1990-04-05. Preserve the other booking.")
        preserves = [["reservations", second]]
    else:
        raise ValueError(family)
    return db, f"My user ID is {uid}. " + request, references, patterns, branch, preserves


def build_tasks(study_id: str, stage: str):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,64}", study_id) or stage not in {"training", "development"}:
        raise ValueError("A new safe study identity and training/development stage are required")
    split = "train" if stage == "training" else "development"
    tasks, assignments = [], family_splits()
    for domain, splits in STRUCTURES.items():
        for family, structure in splits[split].items():
            for variant in range(2 if split == "train" else 1):
                number = int(digest([VERSION, study_id, domain, family, variant])[:7], 16)
                db, request, refs, patterns, branch, preserves = {"retail": _retail_task, "airline": _airline_task}[domain](family, variant, number)
                family_id = f"{domain}:v5_{family}"
                instructions = (request + "\nOnly request the changes above. Give explicit confirmation after the assistant accurately summarizes "
                    "the affected records, changes and costs. Do not approve unrelated actions or substitutions. Supply your known details when asked. "
                    "Do not claim to have seen internal tool results.")
                record = {"schemaVersion": 1, "generator": VERSION, "nativeCommit": NATIVE_COMMIT, "studyId": study_id, "studyStage": stage,
                    "familyId": family_id, "domain": domain, "split": split, "learningSplit": assignments[family_id], "variant": variant,
                    "taskId": f"{study_id}:{stage}:{family_id}:v{variant}", "initialDatabase": db, "initialRequest": request, "userInstructions": instructions,
                    "referenceActions": refs, "responsePatterns": patterns, "requireConfirmation": bool(refs), "composition": structure,
                    "structureHash": digest([domain, structure]), "branch": branch, "preservePaths": preserves,
                    "lineage": {"databasePrimitives": "fresh-native-v1 _retail(status) / _airline(membership)",
                                "nativeToolSemantics": NATIVE_COMMIT, "compositionVersion": VERSION, "publishedTaskUsed": False},
                    "label": "custom tau-compatible pilot"}
                record["fixtureHash"] = digest(record)
                tasks.append(record)
    return tasks


def _at(value, path):
    for part in path:
        value = value[part]
    return value


def preflight_v5(record):
    check = preflight(record)
    from tau2.data_model.message import ToolCall
    environment = native_environment(record)
    before = environment.tools.db.model_dump(mode="json")
    for index, reference in enumerate(record["referenceActions"]):
        result = environment.get_response(ToolCall(id=f"v5-invariant-{index}", **reference))
        if result.error:
            raise ValueError("Reference failed invariant replay")
    after = environment.tools.db.model_dump(mode="json")
    if environment.get_db_hash() != check["expectedStateHash"]:
        raise ValueError("Native reference replay is not deterministic")
    invariants = []
    for path in record["preservePaths"]:
        expected = digest(_at(before, path))
        if digest(_at(after, path)) != expected:
            raise ValueError(f"Reference violates preservation requirement: {record['taskId']} {path}")
        invariants.append({"path": path, "valueHash": expected})
    if bool(record["referenceActions"]) != (check["initialStateHash"] != check["expectedStateHash"]):
        raise ValueError("Reference does not realize the predeclared change/no-change branch")
    return {**check, "v5PreservationChecks": invariants, "structureHash": record["structureHash"], "referenceReplayedTwice": True}


def make_manifest(study_id: str, stage: str):
    tasks = build_tasks(study_id, stage)
    checks = {task["taskId"]: preflight_v5(task) for task in tasks}
    manifest = {"schemaVersion": 1, "generator": VERSION, "studyId": study_id, "studyStage": stage, "nativeCommit": NATIVE_COMMIT,
        "label": "custom tau-compatible pilot", "familySplit": FAMILIES, "learningFamilySplit": family_splits(), "tasks": tasks, "checks": checks,
        "familyDefinition": "Declared request composition, cross-record dependencies, ranking and policy prerequisites; randomized identifiers do not define families.",
        "lineage": "Shared v1 native fixture primitives and v1 independent verifier; v5 request structures. No published task/private answer or prior actor outcome is a generation input.",
        "freshnessClaim": "New predeclared compositions over previously used tools and domain primitives; not unseen domains or certified semantic independence.",
        "annotationPolicy": "Only public prefixes of training-cohort records; learningFamilySplit is assigned before labels. Calibration families cannot enter fitting or mining.",
        "userProtocol": "unchanged-upstream-user-simulator", "providerCalls": 0}
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
