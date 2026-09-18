"""Shared runtime wire profile. The historical pilot canonicalizer stays unchanged."""
import hashlib
import math

import rfc8785


def canonical_v1(value) -> bytes:
    def check(node):
        if type(node) in {int, float} and (not math.isfinite(node) or abs(node) > 2**53 - 1):
            raise ValueError("Number outside shared wire profile")
        if isinstance(node, dict):
            for child in node.values():
                check(child)
        elif isinstance(node, list):
            for child in node:
                check(child)
    check(value)
    return rfc8785.dumps(value)


def hash_v1(value) -> str:
    return hashlib.sha256(canonical_v1(value)).hexdigest()
