"""Loaded only inside the pinned native tau environment."""
from copy import deepcopy

from tau2.agent.base_agent import HalfDuplexAgent
from tau2.agent.llm_agent import AGENT_INSTRUCTION
from tau2.data_model.message import AssistantMessage, MultiToolMessage

from goalspec.adapters.step_gateway import StepBroker


class ExternalGoalSpecAgent(HalfDuplexAgent[list]):
    def __init__(self, tools, domain_policy: str, broker: StepBroker, run_id: str, snapshot_environment=None, actor_instruction=None):
        super().__init__(tools=tools, domain_policy=domain_policy)
        self.broker, self.run_id = broker, run_id
        self.snapshot_environment = snapshot_environment
        self.actor_instruction = AGENT_INSTRUCTION if actor_instruction is None else actor_instruction

    def get_init_state(self, message_history=None):
        return deepcopy(message_history or [])

    def generate_next_message(self, message, state):
        state = deepcopy(state)
        state.extend(message.tool_messages if isinstance(message, MultiToolMessage) else [message])
        response = self.broker.exchange(self.run_id, {
            "messages": [m.model_dump(mode="json") for m in state],
            "policy": self.actor_instruction + "\n\n" + self.domain_policy,
            "tools": [tool.openai_schema for tool in self.tools],
        })
        leases = response.pop("_goalspecPromotions", {})
        assistant = AssistantMessage.model_validate(response)
        if self.snapshot_environment is not None:
            self.snapshot_environment.stage(assistant, leases)
        elif leases:
            raise ValueError("Native promotions require an audited snapshot environment")
        state.append(assistant)
        return assistant, state
