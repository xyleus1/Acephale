from goalspec.annotations import annotate_tasks, infer_endpoint


def task(identifier, query, actions, assertions=()):
    return {
        "id": identifier,
        "user_scenario": {"instructions": query},
        "evaluation_criteria": {"actions": actions, "env_assertions": list(assertions)},
    }


def action(name, **arguments):
    return {"name": name, "arguments": arguments}


def test_endpoint_ignores_setup_reads_instances_and_repetition():
    one = task("a", "Return order 123", [action("return_delivered_order_items", order_id="123")])
    two = task(
        "b",
        "Return order 456",
        [
            action("get_order_details", order_id="456"),
            action("return_delivered_order_items", order_id="456"),
            action("return_delivered_order_items", order_id="456"),
        ],
    )
    assert infer_endpoint(one, "retail")[0] == infer_endpoint(two, "retail")[0]
    report = annotate_tasks([one, two], "retail")
    assert report.tasks[0].group_id == report.tasks[1].group_id
    assert report.annotation_status == "automatic_semantic_proxy_requires_review"


def test_independent_effects_commute_and_remain_composite():
    writes = [
        action("modify_pending_order_address", order_id="1"),
        action("modify_pending_order_items", order_id="1"),
    ]
    one = infer_endpoint(task("a", "Update my order", writes), "retail")[0]
    two = infer_endpoint(task("b", "Update my order", list(reversed(writes))), "retail")[0]
    assert one == two
    assert len(one.completion) == 2


def test_final_state_resolves_contradictory_writes_to_same_object():
    one = task(
        "a",
        "Unfreeze card",
        [
            action("freeze_debit_card_3892", card_id="card1"),
            action("unfreeze_debit_card_3893", card_id="card1"),
        ],
    )
    two = task("b", "Unfreeze card", [action("unfreeze_debit_card_3893", card_id="card9")])
    assert (
        infer_endpoint(one, "banking_knowledge")[0] == infer_endpoint(two, "banking_knowledge")[0]
    )


def test_wrapper_unwraps_terminal_semantics_without_using_workflow_as_identity():
    plain = task(
        "a",
        "Replace card",
        [action("order_replacement_credit_card_7291", credit_card_account_id="one")],
    )
    wrapped = task(
        "b",
        "Replace card",
        [
            action(
                "unlock_discoverable_agent_tool",
                agent_tool_name="order_replacement_credit_card_7291",
            ),
            action(
                "call_discoverable_agent_tool",
                agent_tool_name="order_replacement_credit_card_7291",
                arguments='{"credit_card_account_id":"two"}',
            ),
        ],
    )
    assert (
        infer_endpoint(plain, "banking_knowledge")[0]
        == infer_endpoint(wrapped, "banking_knowledge")[0]
    )


def test_unsupported_writes_remain_unlabeled():
    goal, _, unresolved = infer_endpoint(
        task("a", "Do something", [action("unknown_mutation")]), "retail"
    )
    assert goal is None
    assert "action:unknown_mutation" in unresolved


def test_information_only_goal_is_not_invented():
    goal, _, unresolved = infer_endpoint(
        task("a", "Tell me about an order", [action("get_order_details")]), "retail"
    )
    assert goal is None
    assert "no_supported_terminal_business_predicate" in unresolved


def test_telecom_goal_uses_functional_end_state_not_repair_actions():
    assertions = [
        {
            "func_name": "assert_can_send_mms",
            "arguments": {"expected_status": True},
            "assert_value": True,
        }
    ]
    one = task("a", "Fix MMS", [action("toggle_data")], assertions)
    two = task("b", "Fix MMS", [action("reseat_sim_card"), action("reboot_device")], assertions)
    assert infer_endpoint(one, "telecom")[0] == infer_endpoint(two, "telecom")[0]
    assert infer_endpoint(one, "telecom")[0].objective == "RESTORE_MMS"


def test_family_group_is_not_goal_identity():
    one = task(
        "a",
        "A keyboard I bought yesterday does not work; send it back",
        [action("return_delivered_order_items")],
    )
    two = task(
        "b",
        "My clothes do not fit and I need a refund for the purchase",
        [action("return_delivered_order_items")],
    )
    report = annotate_tasks([one, two], "retail")
    assert report.tasks[0].goal == report.tasks[1].goal
    assert report.tasks[0].group_id != report.tasks[1].group_id


def test_explicit_template_overrides_paraphrase_differences():
    one = task("a", "A broken purchase", [action("return_delivered_order_items")])
    two = task("b", "Get my money refunded", [action("return_delivered_order_items")])
    one["template_id"] = two["template_id"] = "explicit-family"
    report = annotate_tasks([one, two], "retail")
    assert report.tasks[0].group_id == report.tasks[1].group_id
    assert report.tasks[0].grouping == "explicit_template"


def test_transfer_helpers_do_not_imply_completed_human_transfer():
    completions = {
        "request_human_agent_transfer": "human transfer request submitted and pending",
        "initial_transfer_to_human_agent_0218": "human transfer protocol initiated",
        "initial_transfer_to_human_agent_1822": "human transfer protocol initiated",
        "emergency_credit_bureau_incident_transfer_1114":
            "credit bureau incident priority escalation logged",
    }
    for name, completion in completions.items():
        goal, _, _ = infer_endpoint(task("a", "Get human help", [action(name)]), "banking_knowledge")
        assert goal.completion == (completion,)
        final, _, _ = infer_endpoint(
            task("b", "Get human help", [action(name), action("transfer_to_human_agents")]),
            "banking_knowledge",
        )
        assert final.completion == ("case transferred to human assistance",)
