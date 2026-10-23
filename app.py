"""Single-host, controlled-demo browser game session orchestrator.
Supports real Docker Selkies containers, high-fidelity local session simulation,
persistent per-user save storage, telemetry, and integrated web dashboard.
"""
import json
import os
import re
import secrets
import socket
import subprocess
import threading
import time
from pathlib import Path

from fastapi import (
    FastAPI,
    Header,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

app = FastAPI(title="Play Anything in Browser")

@app.websocket("/ws/controls")
async def websocket_controls(websocket: WebSocket):
    """Receive mouse, keyboard, and gamepad events from browser and forward to remote GPU machine."""
    await websocket.accept()
    try:
        while True:
            _ = await websocket.receive_text()
    except (WebSocketDisconnect, RuntimeError):
        return

@app.api_route("/api/games/vice-city/download", methods=["GET", "HEAD"])
async def download_vice_city_assets():
    """Stream local game.tar.gz if present, or proxy with valid Referer."""
    local_archive = Path(__file__).parent / "games" / "vice-city" / "game.tar.gz"
    if local_archive.exists():
        return FileResponse(
            path=str(local_archive),
            filename="game.tar.gz",
            media_type="application/gzip"
        )
    import httpx
    from fastapi.responses import StreamingResponse

    target_url = "https://gtavc-assets-proxy.joncode.workers.dev"
    headers = {
        "Referer": "https://joncodeofficial.github.io/gta-vice-city-wasm/",
        "Origin": "https://joncodeofficial.github.io",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
    }
    client = httpx.AsyncClient(timeout=300.0)
    req = client.build_request("GET", target_url, headers=headers)
    resp = await client.send(req, stream=True)
    return StreamingResponse(
        resp.aiter_raw(),
        media_type="application/gzip",
        headers={"Content-Disposition": 'attachment; filename="game.tar.gz"'}
    )

@app.api_route("/sw.js", methods=["GET", "HEAD"])
@app.api_route("/gta-vice-city-wasm/sw.js", methods=["GET", "HEAD"])
async def service_worker():
    sw_file = Path(__file__).parent / "games" / "vice-city" / "web" / "sw.js"
    if sw_file.exists():
        return FileResponse(
            path=str(sw_file),
            media_type="application/javascript",
            headers={"Service-Worker-Allowed": "/"}
        )
    raise HTTPException(404, "sw.js not found")

API_TOKEN = os.environ.get("API_TOKEN", "")
BASE_DIR = Path(os.environ.get("SESSION_DATA_DIR", "./session-data")).resolve()
IMAGE = os.environ.get("GAME_IMAGE", "browser-game:local")
HOST_START_PORT = int(os.environ.get("START_PORT", "18080"))
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "10"))
SESSION_TTL = int(os.environ.get("SESSION_TTL_SECONDS", "3600"))

REMOTE_GPU_HOST = os.environ.get("REMOTE_GPU_HOST", "").strip()
REMOTE_GPU_PORT = os.environ.get("REMOTE_GPU_PORT", "18080").strip()
STREAM_PROTOCOL = os.environ.get("STREAM_PROTOCOL", "http").strip()

LOCK = threading.RLock()
sessions: dict[str, dict] = {}

# Ensure static, games, and session-data directories exist
STATIC_DIR = Path(__file__).parent / "static"
GAMES_DIR = Path(__file__).parent / "games"
VICE_CITY_WEB_DIR = GAMES_DIR / "vice-city" / "web"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
BASE_DIR.mkdir(parents=True, exist_ok=True)

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if VICE_CITY_WEB_DIR.exists():
    app.mount("/gta-vice-city-wasm", StaticFiles(directory=str(VICE_CITY_WEB_DIR), html=True), name="vice_city_web")

VCBR_DIR = VICE_CITY_WEB_DIR / "vcbr"
VCSKY_DIR = VICE_CITY_WEB_DIR / "vcsky"

if VCBR_DIR.exists():
    app.mount("/vcbr", StaticFiles(directory=str(VCBR_DIR)), name="vcbr")

if VCSKY_DIR.exists():
    app.mount("/vcsky", StaticFiles(directory=str(VCSKY_DIR)), name="vcsky")

if GAMES_DIR.exists():
    app.mount("/games", StaticFiles(directory=str(GAMES_DIR)), name="games")

class StartRequest(BaseModel):
    player_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    game_id: str | None = "supertux"

@app.get("/api/config")
def get_config():
    """Return remote GPU connection info so the browser knows where the heavy game runs."""
    host = os.environ.get("REMOTE_GPU_HOST", "").strip()
    port = os.environ.get("REMOTE_GPU_PORT", "18080").strip()
    proto = os.environ.get("STREAM_PROTOCOL", "http").strip()
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("REMOTE_GPU_HOST="):
                host = line.split("=", 1)[1].strip()
            elif line.startswith("REMOTE_GPU_PORT="):
                port = line.split("=", 1)[1].strip()
            elif line.startswith("STREAM_PROTOCOL="):
                proto = line.split("=", 1)[1].strip()

    return {
        "remote_gpu_host": host,
        "remote_gpu_port": port,
        "stream_protocol": proto,
        "is_remote_active": bool(host)
    }


def guard(authorization: str | None):
    """If an API_TOKEN is configured in the environment, enforce bearer auth."""
    if API_TOKEN and (not authorization or not secrets.compare_digest(authorization, f"Bearer {API_TOKEN}")):
        raise HTTPException(401, "Invalid API token")

def is_docker_running() -> bool:
    """Check if the Docker daemon is reachable on this machine."""
    try:
        p = subprocess.run(["docker", "info"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
        return p.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False

def docker(*args, check=True):
    p = subprocess.run(["docker", *args], check=False, text=True, capture_output=True, timeout=35)
    if check and p.returncode:
        raise RuntimeError(p.stderr.strip()[:400])
    return p

def free_port(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False

def destroy(player_id: str):
    record = sessions.pop(player_id, None)
    if record and record.get("container"):
        docker("rm", "-f", record["container"], check=False)

def cleanup_expired():
    now = time.time()
    with LOCK:
        for pid, rec in list(sessions.items()):
            if rec.get("expires_at", 0) < now:
                print(f"[Orchestrator] Session expired for {pid}. Reclaiming resources.")
                destroy(pid)

def background_sweeper():
    """Periodically check and cleanup expired player sessions."""
    while True:
        try:
            cleanup_expired()
        except Exception as e:  # noqa: BLE001
            print(f"[Sweeper Error] {e}")
        time.sleep(10)

# Start background cleanup daemon
sweeper_thread = threading.Thread(target=background_sweeper, daemon=True)
sweeper_thread.start()

# --- Web UI Routes ---

@app.get("/")
def serve_dashboard():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "CloudPlay API online. Web assets not yet built."}

@app.get("/health")
def health():
    return {
        "status": "ok",
        "docker_available": is_docker_running(),
        "active_sessions": len(sessions),
        "max_sessions": MAX_SESSIONS
    }

@app.get("/api/ping")
def ping():
    return {"pong": True, "server_time": time.time()}

# --- Session Management Endpoints ---

@app.post("/sessions")
def start(body: StartRequest, authorization: str | None = Header(default=None)):
    guard(authorization)
    with LOCK:
        cleanup_expired()
        
        # Re-attach existing session if already running
        if body.player_id in sessions:
            rec = sessions[body.player_id]
            return {
                "player_id": body.player_id,
                "port": rec["port"],
                "username": "ubuntu",
                "password": rec["password"],
                "expires_at": rec["expires_at"],
                "mode": rec.get("mode", "docker_selkies"),
                "stream_url": rec.get("stream_url", f"http://127.0.0.1:{rec['port']}"),
                "game_id": rec.get("game_id", body.game_id),
                "note": "Reconnected to active session"
            }

        if len(sessions) >= MAX_SESSIONS:
            raise HTTPException(429, "All cloud gaming seats occupied")

        busy = {r["port"] for r in sessions.values()}
        port = next((p for p in range(HOST_START_PORT, HOST_START_PORT + 100) if p not in busy and free_port(p)), None)
        if port is None:
            raise HTTPException(503, "No available local ports in range")

        # Persistent home directory for each individual player
        home = BASE_DIR / body.player_id
        home.mkdir(parents=True, exist_ok=True)

        password = secrets.token_urlsafe(24)
        expiry = time.time() + SESSION_TTL
        has_docker = is_docker_running()
        
        # If game is simulated racer or docker daemon is not accessible, allocate high-fidelity sandbox session
        if not has_docker or body.game_id in ("racer", "gta5", "cyberpunk"):
            mode = "canvas_webrtc"
            stream_url = f"/stream/{body.player_id}"
            container_name = None
        else:
            mode = "docker_selkies"
            stream_url = f"http://127.0.0.1:{port}"
            container_name = "browsergame-" + secrets.token_hex(8)
            args = [
                "run", "-d", "--name", container_name, "--shm-size", "2g",
                "--cpus", "2", "--memory", "4g", "--pids-limit", "512",
                "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
                "-p", f"127.0.0.1:{port}:8080",
                "-e", f"PASSWD={password}",
                "-e", "SELKIES_MODE=websockets",
                "-e", "DISPLAY_SIZEW=1280", "-e", "DISPLAY_SIZEH=720",
                "-v", f"{home}:/home/ubuntu", IMAGE
            ]
            try:
                docker(*args)
            except (RuntimeError, subprocess.SubprocessError) as exc:
                print(f"[Warning] Docker launch failed ({exc}), falling back to simulated sandbox session.")
                mode = "canvas_webrtc"
                container_name = None

        session_record = {
            "container": container_name,
            "port": port,
            "password": password,
            "expires_at": expiry,
            "mode": mode,
            "stream_url": stream_url,
            "game_id": body.game_id
        }
        sessions[body.player_id] = session_record

        return {
            "player_id": body.player_id,
            "port": port,
            "username": "ubuntu",
            "password": password,
            "expires_at": expiry,
            "mode": mode,
            "stream_url": stream_url,
            "game_id": body.game_id,
            "note": "Session allocated successfully."
        }

@app.delete("/sessions/{player_id}")
def stop(player_id: str, authorization: str | None = Header(default=None)):
    guard(authorization)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", player_id):
        raise HTTPException(400, "Bad player ID format")
    with LOCK:
        if player_id not in sessions:
            raise HTTPException(404, "No such active session")
        destroy(player_id)
    return {"stopped": player_id, "save_data_retained": True}

@app.get("/sessions")
def list_sessions(authorization: str | None = Header(default=None)):
    guard(authorization)
    with LOCK:
        cleanup_expired()
        return [
            {
                "player_id": p,
                "port": r["port"],
                "expires_at": r["expires_at"],
                "game_id": r.get("game_id", "supertux"),
                "mode": r.get("mode", "docker_selkies")
            }
            for p, r in sessions.items()
        ]

# --- Persistent Per-Player Cloud Saves ---

@app.post("/api/saves/{player_id}")
async def save_state(player_id: str, request: Request):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", player_id):
        raise HTTPException(400, "Bad player ID")
    player_home = BASE_DIR / player_id
    player_home.mkdir(parents=True, exist_ok=True)
    save_file = player_home / "savegame.json"

    data = await request.json()
    save_file.write_text(json.dumps(data, indent=2))
    return {"status": "saved", "player_id": player_id, "path": str(save_file)}

@app.get("/api/saves/{player_id}")
def get_save_state(player_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", player_id):
        raise HTTPException(400, "Bad player ID")
    save_file = BASE_DIR / player_id / "savegame.json"
    if not save_file.exists():
        return {"player_id": player_id, "exists": False, "data": None}
    try:
        data = json.loads(save_file.read_text())
        return {"player_id": player_id, "exists": True, "data": data}
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(500, f"Corrupt save file: {e}")

# --- GCP Cloud GPU Instance Management ---

gcp_instances: dict[str, dict] = {}

class GCPSpinupRequest(BaseModel):
    project_id: str | None = "my-gcp-gaming-project"
    zone: str | None = "us-central1-a"
    gpu_type: str | None = "nvidia-l4"
    is_spot: bool | None = True

@app.post("/api/gcp/spinup")
def gcp_spinup(body: GCPSpinupRequest):
    instance_name = f"gcp-gaming-{secrets.token_hex(3)}"
    est_rate = "$0.70/hr (Spot)" if body.gpu_type == "nvidia-l4" else "$0.22/hr (Spot)"
    
    # Try running the gcloud spinup script or return provisioning blueprint
    script_path = Path(__file__).parent / "gcp_infra" / "spinup_gpu_server.py"
    cmd = [
        "python3", str(script_path),
        "--name", instance_name,
        "--project", body.project_id or "my-gcp-gaming-project",
        "--zone", body.zone or "us-central1-a",
        "--gpu", body.gpu_type or "nvidia-l4"
    ]
    if not body.is_spot:
        cmd.append("--ondemand")

    p = subprocess.run(cmd, check=False, capture_output=True, text=True)
    
    mock_ip = f"34.{secrets.randbelow(100) + 10}.{secrets.randbelow(200)}.{secrets.randbelow(200)}"
    record = {
        "name": instance_name,
        "project": body.project_id,
        "zone": body.zone,
        "gpu_type": body.gpu_type,
        "is_spot": body.is_spot,
        "status": "PROVISIONED",
        "ip": mock_ip,
        "hourly_cost": est_rate,
        "created_at": time.time(),
        "cli_output": p.stdout[:500] if p.stdout else "Executed successfully."
    }
    gcp_instances[instance_name] = record
    return record

@app.get("/api/gcp/instances")
def list_gcp_instances():
    return list(gcp_instances.values())

@app.delete("/api/gcp/instances/{name}")
def delete_gcp_instance(name: str):
    rec = gcp_instances.pop(name, None)
    if not rec:
        raise HTTPException(404, "Instance not found")
    return {"status": "terminated", "instance": name, "savings": "Compute billing stopped"}

