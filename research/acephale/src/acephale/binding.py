"""A small, data-only argument language learned from repeated available values.

References address JSON fields and array indexes in prior authoritative events.
There is deliberately no generated code, expression evaluation, or attribute access.
"""

from __future__ import annotations

import json
import math
import re
import sys
import weakref
from collections import Counter, OrderedDict
from collections.abc import Callable, Iterable
from functools import lru_cache
from typing import Any, Literal

from jsonschema import Draft202012Validator, SchemaError, ValidationError
from pydantic import Field, model_validator

from acephale.schemas import Event, PrefixView, Record, ToolContract

MAX_DEPTH = 8
MAX_LEAVES = 256
MAX_OCCURRENCE = 8
Path = tuple[str | int, ...]


class Reference(Record):
    source: Literal["result", "arguments"]
    tool: str
    occurrence: int = Field(default=1, ge=1, le=MAX_OCCURRENCE)
    path: Path = Field(default=(), max_length=MAX_DEPTH)


class Expression(Record):
    kind: Literal["literal", "reference", "object", "array"]
    value: Any = None
    reference: Reference | None = None
    fields: dict[str, Expression] = Field(default_factory=dict)
    items: tuple[Expression, ...] = ()

    @model_validator(mode="after")
    def valid_shape(self) -> Expression:
        if self.kind == "reference":
            if self.reference is None or self.value is not None or self.fields or self.items:
                raise ValueError("A reference expression must contain only its reference")
        elif self.reference is not None:
            raise ValueError("Only reference expressions may contain references")
        if self.kind == "literal":
            if type(self.value) not in {str, bool, int, float, type(None)} or self.fields or self.items:
                raise ValueError("Literal expressions are JSON scalars")
            if isinstance(self.value, float) and not math.isfinite(self.value):
                raise ValueError("Nonfinite literals are not JSON")
        if self.kind == "object" and (self.value is not None or self.items):
            raise ValueError("Object expressions contain fields only")
        if self.kind == "array" and (self.value is not None or self.fields):
            raise ValueError("Array expressions contain items only")
        return self


class ArgumentBinding(Record):
    expression: Expression
    examples: int = Field(ge=2)
    total_examples: int = Field(ge=2)
    language_version: Literal[1] = 1

    @property
    def precision(self) -> float:
        return self.examples / self.total_examples

    @model_validator(mode="after")
    def valid_counts(self) -> ArgumentBinding:
        if self.examples > self.total_examples:
            raise ValueError("Binding support cannot exceed validation observations")
        return self

    def bind(self, prefix: PrefixView, tool: ToolContract) -> dict[str, Any] | None:
        """Return no candidate when a reference or current schema cannot be satisfied."""
        try:
            result = resolve(self.expression, prefix)
            if not isinstance(result, dict):
                return None
            _schema_validator(canonical(tool.parameters)).validate(result)
            return result
        except (LookupError, TypeError, ValueError, SchemaError, ValidationError):
            return None


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


@lru_cache(maxsize=512)
def _schema_validator(schema_json: str) -> Draft202012Validator:
    """Compile by immutable schema content; never retain caller-owned dictionaries."""
    schema = json.loads(schema_json)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _source_events(prefix: PrefixView, source: str) -> list[Event]:
    requests = {event.call_id: event.seq for event in prefix.events if event.kind == "tool_request"}
    if source == "arguments":
        return sorted((event for event in prefix.events if event.kind == "tool_request"), key=lambda event: event.seq, reverse=True)
    # Simultaneous completion order is an execution detail, not argument identity.
    return sorted((event for event in prefix.events if event.kind == "tool_result" and event.status == "success" and event.call_id in requests), key=lambda event: requests[event.call_id], reverse=True)


def _read(reference: Reference, prefix: PrefixView) -> Any:
    matching = [
        event for event in _source_events(prefix, reference.source)
        if event.tool == reference.tool
    ]
    if len(matching) < reference.occurrence:
        raise LookupError("Referenced event is unavailable")
    event = matching[reference.occurrence - 1]
    value = event.result if reference.source == "result" else event.arguments
    for part in reference.path:
        if type(part) is str and isinstance(value, dict):
            value = value[part]
        elif type(part) is int and isinstance(value, list) and part >= 0:
            value = value[part]
        else:
            raise LookupError("Reference does not address a JSON field or array index")
    return value


def resolve(expression: Expression, prefix: PrefixView) -> Any:
    remaining = [MAX_LEAVES]

    def visit(node: Expression, depth: int) -> Any:
        remaining[0] -= 1
        if depth > MAX_DEPTH or remaining[0] < 0:
            raise ValueError("Argument expression exceeds its bounds")
        if node.kind == "literal":
            return node.value
        if node.kind == "reference":
            if node.reference is None:
                raise ValueError("Missing reference")
            # Round-trip ensures JSON-only values and avoids aliasing mutable trace objects.
            return json.loads(canonical(_read(node.reference, prefix)))
        if node.kind == "object":
            return {key: visit(value, depth + 1) for key, value in node.fields.items()}
        return [visit(value, depth + 1) for value in node.items]

    return visit(expression, 0)


def _references(prefix: PrefixView) -> dict[str, set[str]]:
    """Map type-sensitive JSON values to stable serialized reference candidates."""
    found: dict[str, set[str]] = {}
    occurrence: dict[tuple[str, str], int] = {}

    def visit(current: Any, path: Path, base: Reference, remaining: list[int]) -> None:
        remaining[0] -= 1
        if len(path) > MAX_DEPTH or remaining[0] < 0:
            return
        try:
            encoded = canonical(current)
        except (TypeError, ValueError):
            return
        reference = base.model_copy(update={"path": path})
        found.setdefault(encoded, set()).add(reference.model_dump_json())
        if isinstance(current, dict):
            for field, child in sorted(current.items()):
                if isinstance(field, str):
                    visit(child, (*path, field), base, remaining)
        elif isinstance(current, list):
            for index, child in enumerate(current):
                visit(child, (*path, index), base, remaining)

    for source in ("result", "arguments"):
        for event in _source_events(prefix, source):
            value = event.result if source == "result" else event.arguments
            if event.tool is None:
                continue
            key = (source, event.tool)
            occurrence[key] = occurrence.get(key, 0) + 1
            if occurrence[key] > MAX_OCCURRENCE:
                continue
            base = Reference(source=source, tool=event.tool, occurrence=occurrence[key])
            visit(value, (), base, [MAX_LEAVES])
    return found


class FitReferenceCache:
    """Bounded reference reuse for one fit over immutable causal prefixes.

    Identity-reference learning only asks for target argument roots and subtrees.
    Keeping precisely those values preserves every possible learned expression.
    The complete wanted set must fit its budget; otherwise both filtering and
    caching are disabled. No partial set is ever used. This object is fit-local,
    never serialized, and never shared with inference or another experiment.
    """

    def __init__(
        self,
        argument_values: Iterable[Any],
        *,
        budget_bytes: int = 32 * 1024**2,
        wanted_budget_bytes: int = 8 * 1024**2,
        entry_limit_bytes: int = 8 * 1024**2,
        max_entries: int = 2048,
    ) -> None:
        if min(budget_bytes, wanted_budget_bytes, entry_limit_bytes, max_entries) < 0:
            raise ValueError("Reference-cache resource bounds cannot be negative")
        self.budget_bytes = budget_bytes
        self.entry_limit_bytes = entry_limit_bytes
        self.max_entries = max_entries
        self.hits = self.misses = self.used_bytes = self.peak_bytes = 0
        self.wanted_bytes = 0
        self._entries: OrderedDict[int, tuple[weakref.ReferenceType[PrefixView], dict[str, set[str]], int]] = OrderedDict()
        self._wanted = self._collect_wanted(argument_values, wanted_budget_bytes)

    def _collect_wanted(self, argument_values: Iterable[Any], budget_bytes: int) -> set[str] | None:
        wanted: set[str] = set()
        string_bytes = 0
        try:
            for root in argument_values:
                pending = [root]
                while pending:
                    value = pending.pop()
                    encoded = canonical(value)
                    if encoded not in wanted:
                        wanted.add(encoded)
                        string_bytes += sys.getsizeof(encoded)
                        if sys.getsizeof(wanted) + string_bytes > budget_bytes:
                            return None
                    if isinstance(value, dict):
                        pending.extend(value.values())
                    elif isinstance(value, list):
                        pending.extend(value)
        except (TypeError, ValueError, RecursionError):
            # Preserve ordinary inference's handling of non-JSON input. A cache
            # optimization must never introduce an additional fitting failure.
            return None
        self.wanted_bytes = sys.getsizeof(wanted) + string_bytes
        return wanted if self.wanted_bytes <= budget_bytes else None

    def __call__(self, prefix: PrefixView) -> dict[str, set[str]]:
        if self._wanted is None:
            self.misses += 1
            return _references(prefix)
        key = id(prefix)
        cached = self._entries.pop(key, None)
        if cached is not None:
            reference, result, size = cached
            if reference() is prefix:
                self._entries[key] = cached
                self.hits += 1
                return result
            self.used_bytes -= size
        self.misses += 1
        result = {
            value: references
            for value, references in _references(prefix).items()
            if value in self._wanted
        }
        # Charge complete retained map structures and conservatively count
        # shared strings again, plus entry/weakref/LRU metadata overhead.
        size = 512 + sys.getsizeof(result) + sum(
            sys.getsizeof(value) + sys.getsizeof(references)
            + sum(sys.getsizeof(reference) for reference in references)
            for value, references in result.items()
        )
        if self.max_entries == 0 or size > min(self.budget_bytes, self.entry_limit_bytes):
            return result
        while self._entries and (
            self.used_bytes + size > self.budget_bytes or len(self._entries) >= self.max_entries
        ):
            _, (_, _, previous_size) = self._entries.popitem(last=False)
            self.used_bytes -= previous_size
        self._entries[key] = (weakref.ref(prefix), result, size)
        self.used_bytes += size
        self.peak_bytes = max(self.peak_bytes, self.used_bytes)
        return result


def _constant_allowed(value: Any, schema: dict[str, Any], path: Path) -> bool:
    if "const" in schema and canonical(value) == canonical(schema["const"]):
        return True
    if any(canonical(value) == canonical(choice) for choice in schema.get("enum", [])):
        return True
    # IDs and names must flow from observations, never be copied from training tasks.
    last = str(path[-1]) if path else ""
    normalized_key = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", last).lower()
    if re.search(r"(^|_)(id|name|email|date|address|phone|number|code)($|_)", normalized_key):
        return False
    if isinstance(value, str):
        return len(value) <= 64 and bool(re.fullmatch(r"[a-zA-Z _-]*", value))
    return value is None or type(value) is bool or (type(value) is int and value in {-1, 0, 1})


def infer_binding(
    examples: Iterable[tuple[PrefixView, dict[str, Any]]],
    tool: ToolContract,
    *,
    min_examples: int = 2,
    reference_lookup: Callable[[PrefixView], dict[str, set[str]]] | None = None,
) -> ArgumentBinding | None:
    """Learn repeated mappings, then measure exact fit over every matching example.

    This initial language has identity references and repeated constants only. More
    transformations require a versioned language addition and dedicated tests.
    """
    samples = list(examples)
    if len(samples) < max(2, min_examples):
        return None
    try:
        validator = _schema_validator(canonical(tool.parameters))
        for _, arguments in samples:
            validator.validate(arguments)
        lookup = _references if reference_lookup is None else reference_lookup
        reference_maps = [lookup(prefix) for prefix, _ in samples]
        remaining = [MAX_LEAVES]

        def learn(values: list[Any], schema: dict[str, Any], path: Path) -> Expression:
            remaining[0] -= 1
            if len(path) > MAX_DEPTH or remaining[0] < 0:
                raise ValueError("Arguments exceed bounded binding language")
            refs = [mapping.get(canonical(value), set()) for mapping, value in zip(reference_maps, values, strict=True)]
            counts = Counter(reference for references in refs for reference in references)
            recurring = {reference: count for reference, count in counts.items() if count >= max(2, min_examples)}
            if recurring:
                best_support = max(recurring.values())
                options = [Reference.model_validate_json(item) for item, count in recurring.items() if count == best_support]
                chosen = min(options, key=lambda ref: (ref.source != "result", ref.occurrence, len(ref.path), ref.tool, canonical(ref.path)))
                return Expression(kind="reference", reference=chosen)
            first = values[0]
            if isinstance(first, dict) and all(isinstance(value, dict) and set(value) == set(first) for value in values):
                return Expression(kind="object", fields={
                    key: learn([value[key] for value in values], schema.get("properties", {}).get(key, {}), (*path, key))
                    for key in sorted(first)
                })
            if isinstance(first, list) and all(isinstance(value, list) and len(value) == len(first) for value in values):
                item_schema = schema.get("items", {})
                if not isinstance(item_schema, dict):
                    item_schema = {}
                return Expression(kind="array", items=tuple(
                    learn([value[index] for value in values], item_schema, (*path, index))
                    for index in range(len(first))
                ))
            if all(canonical(value) == canonical(first) for value in values) and _constant_allowed(first, schema, path):
                return Expression(kind="literal", value=first)
            raise ValueError("No repeated argument mapping")

        expression = learn([arguments for _, arguments in samples], tool.parameters, ())
        binding = ArgumentBinding(expression=expression, examples=len(samples), total_examples=len(samples))
        matches = sum(canonical(binding.bind(prefix, tool)) == canonical(arguments) for prefix, arguments in samples)
        if matches < max(2, min_examples):
            return None
        return binding.model_copy(update={"examples": matches})
    except (ValueError, TypeError, SchemaError, ValidationError):
        return None
