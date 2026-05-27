"""Generate PBKDF2 password hashes compatible with AUTH_USERS_JSON.

Output format:
pbkdf2_sha256$iterations$salt$base64_hash
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import secrets


def build_hash(password: str, iterations: int = 600000, salt: str | None = None) -> str:
    if not password:
        raise ValueError("Password cannot be empty")

    if salt is None:
        salt = secrets.token_urlsafe(16)

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    )
    digest_b64 = base64.b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${iterations}${salt}${digest_b64}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate password hash for AUTH_USERS_JSON (PBKDF2-SHA256)."
    )
    parser.add_argument(
        "--password",
        help="Password to hash. If omitted, a secure prompt is shown.",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=600000,
        help="PBKDF2 iteration count (default: 600000).",
    )
    parser.add_argument(
        "--salt",
        help="Custom salt (optional). If omitted, a random salt is generated.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    password = args.password or getpass.getpass("Password: ")
    hashed = build_hash(password=password, iterations=args.iterations, salt=args.salt)
    print(hashed)


if __name__ == "__main__":
    main()
