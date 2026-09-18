"""Offline endpoint annotations from native evaluator task definitions.

These labels describe the intended terminal state, not a realized actor path.
Rules are deliberately explicit. Unknown operations never become invented goals.
Only reference writes with reviewed business semantics and native terminal
assertions contribute endpoint predicates; setup/read calls cannot define goals.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

from goalspec.adapters.tau import LabelBundle, TaskLabel
from goalspec.schemas import GoalSignature, Record
from goalspec.storage import content_hash

RULE_VERSION = "native-terminal-semantics-v1"
_ID_KEYS = {
    "user_id",
    "customer_id",
    "customer_name",
    "name",
    "email",
    "phone_number",
    "address",
    "date_of_birth",
    "time_verified",
    "order_id",
    "reservation_id",
    "transaction_id",
    "credit_card_account_id",
    "account_id",
    "card_id",
}
_OBJECT_KEYS = (
    "transaction_id",
    "card_id",
    "credit_card_account_id",
    "account_id",
    "order_id",
    "reservation_id",
    "user_id",
    "customer_id",
    "customer_name",
)


@dataclass(frozen=True)
class Effect:
    objective: str
    object_type: str
    field: str
    completion: str


def _effect(objective: str, obj: str, field: str, completion: str) -> Effect:
    return Effect(objective, obj, field, completion)


# State dimensions let contradictory writes to the same object resolve to the
# final value. Independent object mutations commute and repeated writes collapse.
RETAIL_EFFECTS = {
    "cancel_pending_order": _effect(
        "CANCEL_ORDER", "existing order", "order.status", "order cancelled"
    ),
    "return_delivered_order_items": _effect(
        "RETURN_ITEM",
        "delivered order item",
        "order.status",
        "return requested and refund method selected",
    ),
    "exchange_delivered_order_items": _effect(
        "EXCHANGE_ITEM",
        "delivered order item",
        "order.status",
        "exchange requested and replacement items selected",
    ),
    "modify_pending_order_items": _effect(
        "MODIFY_ORDER_ITEMS",
        "pending order",
        "order.items",
        "requested order items replaced and payment adjustment selected",
    ),
    "modify_pending_order_address": _effect(
        "CHANGE_ORDER_ADDRESS", "pending order", "order.address", "delivery address updated"
    ),
    "modify_pending_order_payment": _effect(
        "CHANGE_ORDER_PAYMENT", "pending order", "order.payment", "payment method updated"
    ),
    "modify_user_address": _effect(
        "CHANGE_CUSTOMER_ADDRESS",
        "customer profile",
        "customer.address",
        "default customer address updated",
    ),
}
AIRLINE_EFFECTS = {
    "book_reservation": _effect(
        "BOOK_RESERVATION", "flight reservation", "reservation.created", "flight reservation booked"
    ),
    "cancel_reservation": _effect(
        "CANCEL_RESERVATION", "existing reservation", "reservation.status", "reservation cancelled"
    ),
    "update_reservation_flights": _effect(
        "CHANGE_FLIGHTS", "existing reservation", "reservation.flights", "itinerary updated"
    ),
    "update_reservation_baggages": _effect(
        "CHANGE_BAGGAGE", "existing reservation", "reservation.baggage", "baggage allowance updated"
    ),
    "update_reservation_passengers": _effect(
        "CHANGE_PASSENGERS",
        "existing reservation",
        "reservation.passengers",
        "passenger details updated",
    ),
    "send_certificate": _effect(
        "ISSUE_TRAVEL_COMPENSATION",
        "customer travel credit",
        "customer.certificate",
        "travel compensation certificate issued",
    ),
}
BANK_EFFECTS = {
    "apply_for_credit_card": _effect(
        "APPLY_FOR_CREDIT_CARD",
        "credit card application",
        "application.submitted",
        "suitable credit card application submitted",
    ),
    "change_user_email": _effect(
        "CHANGE_CUSTOMER_EMAIL", "customer profile", "customer.email", "contact email updated"
    ),
    "submit_referral": _effect(
        "SUBMIT_REFERRAL", "customer referral", "referral.submitted", "referral submitted"
    ),
    "submit_transaction": _effect(
        "SUBMIT_TRANSACTION",
        "card transaction",
        "transaction.submitted",
        "requested card transaction submitted",
    ),
    "submit_cash_back_dispute": _effect(
        "DISPUTE_REWARDS", "transaction rewards", "rewards.dispute", "cash back dispute submitted"
    ),
    "update_transaction_rewards": _effect(
        "CORRECT_REWARDS", "transaction rewards", "rewards.value", "transaction rewards corrected"
    ),
    "file_credit_card_transaction_dispute": _effect(
        "DISPUTE_CREDIT_TRANSACTION",
        "credit card transaction",
        "credit_transaction.dispute",
        "transaction dispute filed",
    ),
    "file_debit_card_transaction_dispute": _effect(
        "DISPUTE_DEBIT_TRANSACTION",
        "debit card transaction",
        "debit_transaction.dispute",
        "transaction dispute filed",
    ),
    "order_replacement_credit_card": _effect(
        "REPLACE_CREDIT_CARD",
        "credit card",
        "credit_card.replacement",
        "replacement credit card ordered",
    ),
    "pay_credit_card_from_checking": _effect(
        "PAY_CREDIT_CARD",
        "credit card account",
        "credit_account.payment",
        "credit card payment submitted from checking account",
    ),
    "apply_credit_card_account_flag": _effect(
        "UPDATE_CREDIT_ACCOUNT_BENEFIT",
        "credit card account",
        "credit_account.flag",
        "account benefit flag applied",
    ),
    "apply_statement_credit": _effect(
        "CREDIT_CARD_ACCOUNT_CREDIT",
        "credit card account",
        "credit_account.credit",
        "statement credit applied",
    ),
    "close_credit_card_account": _effect(
        "CLOSE_CREDIT_ACCOUNT",
        "credit card account",
        "credit_account.status",
        "credit card account closed",
    ),
    "submit_credit_limit_increase_request": _effect(
        "REQUEST_CREDIT_LIMIT_INCREASE",
        "credit card account",
        "credit_account.limit_request",
        "credit limit increase request submitted",
    ),
    "approve_credit_limit_increase": _effect(
        "RESOLVE_CREDIT_LIMIT_INCREASE",
        "credit card account",
        "credit_account.limit_decision",
        "credit limit increase approved",
    ),
    "deny_credit_limit_increase": _effect(
        "RESOLVE_CREDIT_LIMIT_INCREASE",
        "credit card account",
        "credit_account.limit_decision",
        "credit limit increase denied",
    ),
    "open_bank_account": _effect(
        "OPEN_BANK_ACCOUNT", "bank account", "bank_account.created", "bank account opened"
    ),
    "deposit_check": _effect(
        "DEPOSIT_CHECK", "bank account", "bank_account.deposit", "check deposited"
    ),
    "transfer_funds_between_bank_accounts": _effect(
        "TRANSFER_FUNDS",
        "bank accounts",
        "bank_account.transfer",
        "funds transferred between requested accounts",
    ),
    "close_bank_account": _effect(
        "CLOSE_BANK_ACCOUNT", "bank account", "bank_account.status", "bank account closed"
    ),
    "apply_checking_account_credit": _effect(
        "CORRECT_CHECKING_BALANCE",
        "checking account",
        "checking_account.credit",
        "checking account credit applied",
    ),
    "apply_savings_account_credit": _effect(
        "CORRECT_SAVINGS_BALANCE",
        "savings account",
        "savings_account.credit",
        "savings account credit applied",
    ),
    "order_debit_card": _effect(
        "ORDER_DEBIT_CARD", "debit card", "debit_card.order", "debit card ordered"
    ),
    "activate_debit_card": _effect(
        "MANAGE_DEBIT_CARD_STATUS", "debit card", "debit_card.status", "debit card activated"
    ),
    "close_debit_card": _effect(
        "MANAGE_DEBIT_CARD_STATUS", "debit card", "debit_card.status", "debit card closed"
    ),
    "freeze_debit_card": _effect(
        "MANAGE_DEBIT_CARD_STATUS", "debit card", "debit_card.status", "debit card frozen"
    ),
    "unfreeze_debit_card": _effect(
        "MANAGE_DEBIT_CARD_STATUS", "debit card", "debit_card.status", "debit card active"
    ),
    "clear_debit_card_fraud_alert": _effect(
        "CLEAR_DEBIT_FRAUD_ALERT", "debit card", "debit_card.alert", "fraud alert cleared"
    ),
    "reset_debit_card_pin": _effect(
        "RESET_DEBIT_PIN", "debit card", "debit_card.pin", "debit card PIN reset"
    ),
    "change_debit_card_pin": _effect(
        "RESET_DEBIT_PIN", "debit card", "debit_card.pin", "debit card PIN changed"
    ),
    "request_temporary_debit_card_limit_increase": _effect(
        "INCREASE_DEBIT_LIMIT",
        "debit card",
        "debit_card.limit",
        "temporary debit card limit increase requested",
    ),
    "submit_interest_discrepancy_report": _effect(
        "REPORT_INTEREST_DISCREPANCY",
        "savings account",
        "savings_account.interest_report",
        "interest discrepancy report submitted",
    ),
}
_ESCALATION_EFFECTS = {
    "transfer_to_human_agents": _effect(
        "HUMAN_ASSISTANCE", "support case", "support.escalation",
        "case transferred to human assistance",
    ),
    "request_human_agent_transfer": _effect(
        "REQUEST_HUMAN_ASSISTANCE", "support case", "support.escalation",
        "human transfer request submitted and pending",
    ),
    "initial_transfer_to_human_agent": _effect(
        "INITIATE_HUMAN_TRANSFER", "support case", "support.escalation",
        "human transfer protocol initiated",
    ),
    "emergency_credit_bureau_incident_transfer": _effect(
        "ESCALATE_CREDIT_BUREAU_INCIDENT", "support case", "support.escalation",
        "credit bureau incident priority escalation logged",
    ),
}
_IGNORED_SETUP = {
    "log_verification",
    "unlock_discoverable_agent_tool",
    "give_discoverable_user_tool",
    "log_credit_card_closure_reason",
    "calculate",
}
_TELECOM_REPAIR = {
    "enable_roaming",
    "grant_app_permission",
    "reboot_device",
    "refuel_data",
    "reseat_sim_card",
    "reset_apn_settings",
    "set_network_mode_preference",
    "toggle_airplane_mode",
    "toggle_data",
    "toggle_wifi_calling",
    "toggle_roaming",
    "toggle_data_saver_mode",
    "disconnect_vpn",
    "send_payment_request",
    "make_payment",
    "resume_line",
}


class TaskAnnotation(Record):
    task_id: str
    group_id: str
    goal: GoalSignature | None
    rule_evidence: tuple[str, ...]
    unresolved: tuple[str, ...]
    grouping: str
    normalized_request_hash: str


class AnnotationReport(Record):
    schema_version: int = 1
    rule_version: str = RULE_VERSION
    domain: str
    task_source_hash: str
    tasks: tuple[TaskAnnotation, ...]
    family_similarity_threshold: float
    annotation_status: str = "automatic_semantic_proxy_requires_review"
    limitations: tuple[str, ...] = (
        "Semantic rule annotations are proxies for terminal business objectives, not human goal labels.",
        "Family grouping conservatively joins normalized exact and near-duplicate request templates; semantic paraphrases still require review.",
        "Unsupported or exclusively informational endpoints remain unlabeled; observed actor success never selects the cohort.",
        "Reference action order is used only to resolve contradictory writes to the same terminal field, not as goal identity.",
    )

    @property
    def labels(self) -> LabelBundle:
        return LabelBundle(
            tasks={
                task.task_id: TaskLabel(group_id=task.group_id, goal=task.goal)
                for task in self.tasks
            }
        )

    @property
    def summary(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        goal_groups: dict[str, set[str]] = {}
        for task in self.tasks:
            if task.goal is not None:
                name = task.goal.objective
                counts[name] = counts.get(name, 0) + 1
                goal_groups.setdefault(name, set()).add(task.group_id)
        return {
            "tasks": len(self.tasks),
            "labeled_tasks": sum(t.goal is not None for t in self.tasks),
            "groups": len({t.group_id for t in self.tasks}),
            "objective_tasks": counts,
            "objective_groups": {name: len(groups) for name, groups in goal_groups.items()},
        }


def _unwrap(action: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    name = action.get("name")
    arguments = action.get("arguments", {})
    if not isinstance(name, str) or not isinstance(arguments, dict):
        raise ValueError("Native evaluator actions require a name and argument object")
    if name in {"call_discoverable_agent_tool", "call_discoverable_user_tool"}:
        key = "agent_tool_name" if name.endswith("agent_tool") else "discoverable_tool_name"
        name = arguments.get(key)
        arguments = arguments.get("arguments", {})
        if isinstance(arguments, str):
            arguments = json.loads(arguments)
        if not isinstance(name, str) or not isinstance(arguments, dict):
            raise ValueError("Unsupported discoverable-tool reference action")
    return re.sub(r"_\d{4}$", "", name), arguments


def _telecom_assertion(assertion: dict[str, Any]) -> Effect | None:
    name, args = assertion.get("func_name"), assertion.get("arguments", {})
    if assertion.get("assert_value", True) is not True:
        return None
    if name == "assert_mobile_data_status":
        return _effect(
            "RESTORE_MOBILE_DATA",
            "mobile connection",
            "mobile.data",
            "mobile data operational"
            if args.get("expected_status") is True
            else "mobile data unavailable",
        )
    if name == "assert_internet_speed":
        return _effect(
            "RESTORE_MOBILE_DATA",
            "mobile connection",
            "mobile.speed",
            "internet speed satisfies requested quality",
        )
    if name == "assert_can_send_mms":
        return _effect(
            "RESTORE_MMS",
            "mobile messaging",
            "mobile.mms",
            "MMS sending operational" if args.get("expected_status") is True else "MMS unavailable",
        )
    if name == "assert_data_refueling_amount":
        return _effect(
            "REFUEL_MOBILE_DATA",
            "mobile data allowance",
            "mobile.allowance",
            "requested data allowance added",
        )
    if name == "assert_service_status":
        status = str(args.get("expected_status", "unknown")).replace("_", " ")
        return _effect(
            "RESOLVE_MOBILE_SERVICE",
            "mobile connection",
            "mobile.service",
            f"service state is {status}",
        )
    if name == "assert_no_overdue_bill":
        return _effect(
            "RESOLVE_OVERDUE_BILL",
            "telecom billing account",
            "billing.overdue",
            "overdue bill resolved",
        )
    return None


def infer_endpoint(
    task: dict[str, Any], domain: str
) -> tuple[GoalSignature | None, tuple[str, ...], tuple[str, ...]]:
    effects = {
        "retail": RETAIL_EFFECTS,
        "airline": AIRLINE_EFFECTS,
        "banking_knowledge": BANK_EFFECTS,
        "telecom": {},
    }.get(domain)
    if effects is None:
        raise ValueError(f"No reviewed endpoint semantics for domain {domain}")
    criteria = task.get("evaluation_criteria") or {}
    final: dict[tuple[str, str], Effect] = {}
    evidence, unresolved, constraints = set(), set(), set()
    assertions = criteria.get("env_assertions") or []
    for assertion in assertions:
        effect = _telecom_assertion(assertion) if domain == "telecom" else None
        if effect is None:
            unresolved.add(f"assertion:{assertion.get('func_name')}")
        else:
            final[(effect.field, "assertion")] = effect
            evidence.add(f"terminal_assertion:{assertion['func_name']}")
    for action in criteria.get("actions") or []:
        name, args = _unwrap(action)
        if name == "log_verification":
            constraints.add("identity verification satisfied")
        if name in _IGNORED_SETUP or name.startswith(
            ("get_", "find_", "search_", "query_", "list_")
        ):
            continue
        if domain == "telecom" and name in _TELECOM_REPAIR and assertions:
            continue
        effect = _ESCALATION_EFFECTS.get(name) or effects.get(name)
        if effect is None:
            unresolved.add(f"action:{name}")
            continue
        entity = next((f"{key}:{args[key]}" for key in _OBJECT_KEYS if key in args), "task_object")
        final[(effect.field, entity)] = effect
        evidence.add(f"terminal_effect:{name}")
    if unresolved or not final:
        if not final:
            unresolved.add("no_supported_terminal_business_predicate")
        return None, tuple(sorted(evidence)), tuple(sorted(unresolved))
    terminal = set(final.values())
    payload = {
        "objective": "+".join(sorted({effect.objective for effect in terminal})),
        "object_type": " + ".join(sorted({effect.object_type for effect in terminal})),
        "completion": tuple(sorted({effect.completion for effect in terminal})),
        "constraints": tuple(sorted(constraints)),
    }
    return (
        GoalSignature(goal_id="endpoint_" + content_hash(payload)[:20], **payload),
        tuple(sorted(evidence)),
        (),
    )


def _request_identity(task: dict[str, Any]) -> str:
    scenario = task.get("user_scenario") or {}
    instructions = scenario.get("instructions", "") if isinstance(scenario, dict) else scenario
    if isinstance(instructions, dict):
        text = "\n".join(
            str(instructions.get(key) or "") for key in ("reason_for_call", "task_instructions")
        )
    else:
        text = str(instructions or task.get("ticket") or "")
    if not text.strip():
        raise ValueError(f"Task {task.get('id')} lacks a request for audited family grouping")
    values: set[str] = set()
    for action in (task.get("evaluation_criteria") or {}).get("actions") or []:
        _, args = _unwrap(action)
        values.update(
            str(value)
            for key, value in args.items()
            if key in _ID_KEYS and isinstance(value, (str, int, float))
        )
    text = text.lower()
    for value in sorted(values, key=lambda value: (-len(value), value)):
        if len(value) >= 2:
            text = re.sub(r"(?<!\w)" + re.escape(value.lower()) + r"(?!\w)", " {identity} ", text)
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", " {email} ", text)
    text = re.sub(r"\b(?=[a-z0-9_#-]*\d)[a-z0-9_#-]+\b", " {value} ", text)
    return " ".join(re.findall(r"[a-z]+|\{[a-z]+\}", text))


def annotate_tasks(
    tasks: list[dict[str, Any]], domain: str, *, similarity_threshold: float = 0.92
) -> AnnotationReport:
    if not 0 < similarity_threshold <= 1:
        raise ValueError("Family similarity threshold must be in (0, 1]")
    by_id = {str(task["id"]): task for task in tasks}
    if len(by_id) != len(tasks) or not tasks:
        raise ValueError("Task cohort must be nonempty with unique IDs")
    ordered = sorted(by_id)
    identities = {identifier: _request_identity(by_id[identifier]) for identifier in ordered}
    tokenized = {identifier: text.split() for identifier, text in identities.items()}
    token_counts = {identifier: Counter(tokens) for identifier, tokens in tokenized.items()}
    explicit = {
        identifier: (
            by_id[identifier].get("template_id")
            or (by_id[identifier].get("annotations") or {}).get("template_id")
            if isinstance(by_id[identifier].get("annotations") or {}, dict)
            else by_id[identifier].get("template_id")
        )
        for identifier in ordered
    }
    parent = {identifier: identifier for identifier in ordered}

    def find(identifier: str) -> str:
        while parent[identifier] != identifier:
            parent[identifier] = parent[parent[identifier]]
            identifier = parent[identifier]
        return identifier

    for index, left in enumerate(ordered):
        for right in ordered[index + 1 :]:
            if explicit[left] is not None or explicit[right] is not None:
                same = explicit[left] is not None and explicit[left] == explicit[right]
            else:
                a, b = tokenized[left], tokenized[right]
                maximum_ratio = (
                    2 * sum((token_counts[left] & token_counts[right]).values()) / (len(a) + len(b))
                )
                same = a == b or (
                    maximum_ratio >= similarity_threshold
                    and difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
                    >= similarity_threshold
                )
            if same:
                parent[find(right)] = find(left)
    groups: dict[str, list[str]] = {}
    for identifier in ordered:
        groups.setdefault(find(identifier), []).append(identifier)
    group_ids = {
        identifier: f"{domain}:family:" + content_hash(sorted(identities[x] for x in members))[:16]
        for members in groups.values()
        for identifier in members
    }
    annotations = []
    for identifier in ordered:
        goal, evidence, unresolved = infer_endpoint(by_id[identifier], domain)
        annotations.append(
            TaskAnnotation(
                task_id=identifier,
                group_id=group_ids[identifier],
                goal=goal,
                rule_evidence=evidence,
                unresolved=unresolved,
                grouping="explicit_template"
                if explicit[identifier] is not None
                else "normalized_request_similarity",
                normalized_request_hash=hashlib.sha256(identities[identifier].encode()).hexdigest(),
            )
        )
    return AnnotationReport(
        domain=domain,
        task_source_hash=content_hash(tasks),
        tasks=tuple(annotations),
        family_similarity_threshold=similarity_threshold,
    )
