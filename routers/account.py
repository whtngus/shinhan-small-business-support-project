"""계정 기반 로컬 저장 동기화 API (SQLite)."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List
import os
import requests

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

_BASE_DIR = Path(__file__).resolve().parent.parent
_DB_DIR = _BASE_DIR / "data"
_DB_PATH = _DB_DIR / "account_store.db"


def _conn() -> sqlite3.Connection:
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(_DB_PATH))
    con.row_factory = sqlite3.Row
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS account_store (
            account_id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            account_name TEXT NOT NULL,
            saved_profiles_json TEXT NOT NULL DEFAULT '[]',
            analysis_history_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    return con


def _ensure_account(account_id: str, provider: str = "google", account_name: str = "") -> None:
    name = account_name.strip() or account_id
    con = _conn()
    try:
        con.execute(
            """
            INSERT INTO account_store(account_id, provider, account_name)
            VALUES (?, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
              provider=excluded.provider,
              account_name=excluded.account_name,
              updated_at=datetime('now')
            """,
            (account_id, provider, name),
        )
        con.commit()
    finally:
        con.close()


def _read_field(account_id: str, field: str) -> List[Dict[str, Any]]:
    con = _conn()
    try:
        row = con.execute(
            f"SELECT {field} FROM account_store WHERE account_id = ?",
            (account_id,),
        ).fetchone()
        if not row:
            return []
        raw = row[field]
        data = json.loads(raw) if raw else []
        return data if isinstance(data, list) else []
    finally:
        con.close()


def _write_field(account_id: str, field: str, rows: List[Dict[str, Any]]) -> None:
    payload = json.dumps(rows or [], ensure_ascii=False)
    con = _conn()
    try:
        con.execute(
            f"""
            UPDATE account_store
            SET {field} = ?, updated_at=datetime('now')
            WHERE account_id = ?
            """,
            (payload, account_id),
        )
        con.commit()
    finally:
        con.close()


class LoginRequest(BaseModel):
    account_id: str
    provider: str = "google"
    account_name: str = ""


class RowsPatch(BaseModel):
    rows: List[Dict[str, Any]]

class GoogleLoginRequest(BaseModel):
    id_token: str


@router.post("/account/login")
def login(req: LoginRequest):
    account_id = req.account_id.strip()
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id is required")
    _ensure_account(account_id, req.provider, req.account_name)
    return {
        "ok": True,
        "account": {
            "id": account_id,
            "provider": req.provider,
            "name": req.account_name.strip() or account_id,
        },
    }

@router.post("/account/google-login")
def google_login(req: GoogleLoginRequest):
    token = (req.id_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="id_token is required")
    try:
        resp = requests.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": token},
            timeout=8,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="invalid google token")
        info = resp.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="google verification failed")

    sub = (info.get("sub") or "").strip()
    email = (info.get("email") or "").strip()
    name = (info.get("name") or email or "Google 사용자").strip()
    aud = (info.get("aud") or "").strip()
    exp = int(info.get("exp") or 0)
    if not sub:
        raise HTTPException(status_code=401, detail="google user id missing")
    if exp <= 0:
        raise HTTPException(status_code=401, detail="expired token")
    expected_aud = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if expected_aud and aud and aud != expected_aud:
        raise HTTPException(status_code=401, detail="client id mismatch")

    account_id = f"google:{sub}"
    _ensure_account(account_id, "google", name)
    return {
        "ok": True,
        "account": {
            "id": account_id,
            "provider": "google",
            "name": name,
            "email": email,
        },
    }


@router.get("/account/saved-profiles")
def get_saved_profiles(account_id: str = Query(...)):
    _ensure_account(account_id)
    return {"rows": _read_field(account_id, "saved_profiles_json")}


@router.put("/account/saved-profiles")
def put_saved_profiles(req: RowsPatch, account_id: str = Query(...)):
    _ensure_account(account_id)
    _write_field(account_id, "saved_profiles_json", req.rows)
    return {"ok": True, "count": len(req.rows)}


@router.get("/account/history")
def get_history(account_id: str = Query(...)):
    _ensure_account(account_id)
    return {"rows": _read_field(account_id, "analysis_history_json")}


@router.put("/account/history")
def put_history(req: RowsPatch, account_id: str = Query(...)):
    _ensure_account(account_id)
    _write_field(account_id, "analysis_history_json", req.rows)
    return {"ok": True, "count": len(req.rows)}
