"""Windows current-user DPAPI, no plaintext fallback and no persisted key."""
import ctypes
from ctypes import wintypes
import os


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    if os.name != "nt" or not isinstance(data, bytes) or not 1 <= len(data) <= 6_000_000:
        raise ValueError("Bounded Windows current-user protected storage is required")
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    result = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]; kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        call = crypt.CryptUnprotectData
        call.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        args = [ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)]
    else:
        call = crypt.CryptProtectData
        call.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        args = [ctypes.byref(source), "ND authorized local intake", None, None, None, 1, ctypes.byref(result)]
    call.restype = wintypes.BOOL
    if not call(*args): raise ValueError("Current-user protected storage failed")
    try:
        if result.size > 6_000_000: raise ValueError("Protected data exceeded bound")
        return ctypes.string_at(result.data, result.size)
    finally:
        kernel.LocalFree(result.data)


def unprotect(data):
    return protect(data, decrypt=True)
