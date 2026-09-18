"""Export public tool signatures without loading tasks, databases, or providers.

Run this script with the pinned native benchmark's Python from its checkout.
These are reconstructed signatures, never evidence of historical payload parity.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from goalspec.adapters.public_tau import PublicCatalog
from goalspec.adapters.tau import TAU_REVISION
from goalspec.adapters.tau_worker import verify_checkout
from goalspec.schemas import ToolContract
from goalspec.storage import file_hash


def export_catalog(domain: str, output: Path) -> PublicCatalog:
    verify_checkout(Path.cwd())
    if output.exists():
        raise ValueError("Catalog artifacts are immutable; choose a new output path")
    from tau2.agent.llm_agent import AGENT_INSTRUCTION, SYSTEM_PROMPT

    if domain == "airline":
        from tau2.domains.airline.tools import AirlineTools
        toolkit = AirlineTools(None)
    elif domain == "retail":
        from tau2.domains.retail.tools import RetailTools
        toolkit = RetailTools(None)
    elif domain == "telecom":
        from tau2.domains.telecom.tools import TelecomTools
        toolkit = TelecomTools(None)
    elif domain == "banking_knowledge":
        from tau2.domains.banking_knowledge.retrieval_toolkits import KnowledgeToolsAllTools
        # Constructors only store references. Introspection never calls a tool
        # or builds dense/BM25 indexes, shell environments, or hidden task state.
        toolkit = KnowledgeToolsAllTools(None, None, None, None)
    else:
        raise ValueError("Unsupported public catalog domain")
    native = toolkit.get_tools()
    tools = []
    for tool in native.values():
        function = tool.openai_schema["function"]
        tools.append(ToolContract(
            name=function["name"], description=function.get("description", ""),
            parameters=function["parameters"], version=TAU_REVISION,
        ))
    source_paths = [
        Path("src/tau2/agent/llm_agent.py"),
        Path("src/tau2/environment/toolkit.py"),
        Path("src/tau2/environment/tool.py"),
        Path("src/tau2/environment/environment.py"),
        *sorted(Path(f"src/tau2/domains/{domain}").glob("*.py")),
    ]
    catalog = PublicCatalog(
        source_revision=TAU_REVISION, domain=domain,
        retrieval_config="alltools" if domain == "banking_knowledge" else None,
        tools=tuple(tools), agent_instruction=AGENT_INSTRUCTION,
        system_prompt_template=SYSTEM_PROMPT,
        source_hashes={path.as_posix(): file_hash(path) for path in source_paths},
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(catalog.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return catalog


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("domain")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = export_catalog(args.domain, args.output)
    print(json.dumps({"domain": result.domain, "tools": len(result.tools)}))
