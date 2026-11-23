"""Operational child windows without changing original lease or scientific caps."""
import math


def effective(hard_deadline, phase_deadline):
    if (type(hard_deadline) not in (int, float) or type(phase_deadline) not in (int, float)
            or not math.isfinite(hard_deadline) or not math.isfinite(phase_deadline)
            or not 0 < phase_deadline <= hard_deadline):
        raise ValueError('A finite operational phase within the original lease is required')
    return phase_deadline


def full_window(deadline, seconds, now, margin=0):
    if (type(deadline) not in (int, float) or not math.isfinite(deadline) or deadline <= 0
            or type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds <= 0
            or type(margin) not in (int, float) or not math.isfinite(margin) or margin < 0
            or not math.isfinite(now) or now + seconds + margin >= deadline):
        raise ValueError('The complete declared child interval does not fit the current operational phase')
    return deadline


def strict_export_deadline(authorization_deadline, hard_deadline, phase_deadline, now):
    phase = effective(hard_deadline, phase_deadline)
    deadline = min(authorization_deadline - 60, hard_deadline - 900, phase - 870)
    full_window(deadline, 3300, now)
    return deadline
