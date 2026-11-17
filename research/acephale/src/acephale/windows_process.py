"""Own a Windows process tree from its first instruction until verified drain.

The primary thread starts suspended, joins a kill-on-close Job Object, and only
then resumes. Inheritable handles are duplicated and explicitly allowlisted;
the job handle never reaches a child. No PID lookup is used for termination.
"""

from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import time
from ctypes import wintypes as w
from pathlib import Path


class BasicLimits(ctypes.Structure):
    _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong), ("flags", w.DWORD),
                ("min_working", ctypes.c_size_t), ("max_working", ctypes.c_size_t), ("active_limit", w.DWORD),
                ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in
                ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [("basic", BasicLimits), ("io", IoCounters), ("process_memory", ctypes.c_size_t),
                ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]


class Accounting(ctypes.Structure):
    _fields_ = [(name, ctypes.c_longlong) for name in ("user_time", "kernel_time", "period_user", "period_kernel")] + [
        (name, w.DWORD) for name in ("page_faults", "total_processes", "active_processes", "terminated_processes")]


class StartupInfo(ctypes.Structure):
    _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR), ("title", w.LPWSTR),
                ("x", w.DWORD), ("y", w.DWORD), ("xsize", w.DWORD), ("ysize", w.DWORD),
                ("xchars", w.DWORD), ("ychars", w.DWORD), ("fill", w.DWORD), ("flags", w.DWORD),
                ("show", w.WORD), ("reserved_bytes", w.WORD), ("reserved_pointer", ctypes.c_void_p),
                ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]


class StartupInfoEx(ctypes.Structure):
    _fields_ = [("startup", StartupInfo), ("attributes", ctypes.c_void_p)]


class ProcessInformation(ctypes.Structure):
    _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE), ("pid", w.DWORD), ("tid", w.DWORD)]


def kernel():
    if os.name != "nt":
        raise ValueError("Windows Job Objects require Windows")
    library = ctypes.WinDLL("kernel32", use_last_error=True)
    for name, args, result in [
        ("CreateJobObjectW", [ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
        ("SetInformationJobObject", [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
        ("QueryInformationJobObject", [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p], w.BOOL),
        ("AssignProcessToJobObject", [w.HANDLE, w.HANDLE], w.BOOL),
        ("GetCurrentProcess", [], w.HANDLE),
        ("DuplicateHandle", [w.HANDLE, w.HANDLE, w.HANDLE, ctypes.POINTER(w.HANDLE), w.DWORD, w.BOOL, w.DWORD], w.BOOL),
        ("InitializeProcThreadAttributeList", [ctypes.c_void_p, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.c_size_t)], w.BOOL),
        ("UpdateProcThreadAttribute", [ctypes.c_void_p, w.DWORD, ctypes.c_size_t, ctypes.c_void_p,
                                       ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p], w.BOOL),
        ("DeleteProcThreadAttributeList", [ctypes.c_void_p], None),
        ("CreateProcessW", [w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, w.BOOL, w.DWORD,
                            ctypes.c_void_p, w.LPCWSTR, ctypes.POINTER(StartupInfoEx), ctypes.POINTER(ProcessInformation)], w.BOOL),
        ("ResumeThread", [w.HANDLE], w.DWORD), ("CloseHandle", [w.HANDLE], w.BOOL),
        ("GetExitCodeProcess", [w.HANDLE, ctypes.POINTER(w.DWORD)], w.BOOL),
        ("TerminateProcess", [w.HANDLE, w.UINT], w.BOOL), ("TerminateJobObject", [w.HANDLE, w.UINT], w.BOOL),
        ("WaitForSingleObject", [w.HANDLE, w.DWORD], w.DWORD),
    ]:
        function = getattr(library, name)
        function.argtypes, function.restype = args, result
    return library


def check(success):
    if not success:
        raise ctypes.WinError(ctypes.get_last_error())


class WindowsProcess:
    """Minimal poll/wait interface with deterministic ownership of descendants."""

    def __init__(self, command: list[str], *, cwd: Path, stdout):
        import msvcrt

        self.api = kernel()
        self.command = command
        self.returncode = None
        self.process = self.job = self.pid = None
        executable = command[0]
        if not Path(executable).is_absolute() and ("/" in executable or "\\" in executable):
            executable = str(cwd / executable)
        executable = shutil.which(executable)
        if not executable:
            raise FileNotFoundError(command[0])
        self.job = self.api.CreateJobObjectW(None, None)
        check(self.job)
        information, process_info = ExtendedLimits(), ProcessInformation()
        information.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway
        inherited, attributes = [], None
        try:
            check(self.api.SetInformationJobObject(self.job, 9, ctypes.byref(information), ctypes.sizeof(information)))
            with open(os.devnull, "rb") as stdin:
                current = self.api.GetCurrentProcess()
                for stream in (stdin, stdout):
                    duplicate = w.HANDLE()
                    check(self.api.DuplicateHandle(current, msvcrt.get_osfhandle(stream.fileno()), current,
                                                   ctypes.byref(duplicate), 0, True, 2))
                    inherited.append(duplicate.value)
                size = ctypes.c_size_t()
                # First call obtains the required allocation size (ERROR_INSUFFICIENT_BUFFER).
                self.api.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
                if not size.value:
                    raise ctypes.WinError(ctypes.get_last_error())
                allocation = ctypes.create_string_buffer(size.value)
                check(self.api.InitializeProcThreadAttributeList(allocation, 1, 0, ctypes.byref(size)))
                attributes = allocation
                handles = (w.HANDLE * len(inherited))(*inherited)
                check(self.api.UpdateProcThreadAttribute(attributes, 0, 0x20002, handles, ctypes.sizeof(handles), None, None))
                startup = StartupInfoEx()
                startup.startup.cb, startup.startup.flags = ctypes.sizeof(startup), 0x100  # STARTF_USESTDHANDLES
                startup.startup.stdin, startup.startup.stdout, startup.startup.stderr = inherited[0], inherited[1], inherited[1]
                startup.attributes = ctypes.cast(attributes, ctypes.c_void_p)
                line = ctypes.create_unicode_buffer(subprocess.list2cmdline(command))
                flags = 0x4 | 0x08000000 | 0x80000  # CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT
                check(self.api.CreateProcessW(executable, line, None, None, True, flags, None, str(cwd),
                                              ctypes.byref(startup), ctypes.byref(process_info)))
            self.process, self.pid = process_info.process, process_info.pid
            check(self.api.AssignProcessToJobObject(self.job, self.process))
            if self.api.ResumeThread(process_info.thread) == 0xFFFFFFFF:
                raise ctypes.WinError(ctypes.get_last_error())
        except BaseException:
            if process_info.process:
                self.api.TerminateProcess(process_info.process, 1)
                self.api.WaitForSingleObject(process_info.process, 10000)
                self.api.CloseHandle(process_info.process)
                self.process = None
            self.api.CloseHandle(self.job)
            self.job = None
            raise
        finally:
            if process_info.thread:
                self.api.CloseHandle(process_info.thread)
            if attributes is not None:
                self.api.DeleteProcThreadAttributeList(attributes)
            for handle in inherited:
                self.api.CloseHandle(handle)

    def poll(self):
        if self.returncode is not None:
            return self.returncode
        status = self.api.WaitForSingleObject(self.process, 0)
        if status == 0x102:  # WAIT_TIMEOUT
            return None
        if status != 0:
            raise ctypes.WinError(ctypes.get_last_error())
        code = w.DWORD()
        check(self.api.GetExitCodeProcess(self.process, ctypes.byref(code)))
        self.returncode = code.value  # 259 is valid after the process handle signals.
        return self.returncode

    def wait(self, timeout: float = 10):
        status = self.api.WaitForSingleObject(self.process, max(0, int(timeout * 1000)))
        if status == 0x102:
            raise subprocess.TimeoutExpired(self.command, timeout)
        if status != 0:
            raise ctypes.WinError(ctypes.get_last_error())
        return self.poll()

    def active_processes(self) -> int:
        information = Accounting()
        check(self.api.QueryInformationJobObject(self.job, 1, ctypes.byref(information), ctypes.sizeof(information), None))
        return information.active_processes

    def drain(self, timeout: float = 10) -> None:
        if self.job is None:
            return
        try:
            check(self.api.TerminateJobObject(self.job, 1))
            deadline = time.monotonic() + timeout
            self.wait(timeout)
            while self.active_processes():
                if time.monotonic() >= deadline:
                    raise TimeoutError("Owned Windows process tree did not drain")
                time.sleep(0.025)
        finally:
            # Closing the noninherited job also enforces termination on cleanup errors.
            self.api.CloseHandle(self.job)
            self.job = None
            self.api.CloseHandle(self.process)
            self.process = None
