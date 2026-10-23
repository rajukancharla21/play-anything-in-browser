# CloudPlay: Play Big AAA Games (GTA V) In Any Browser

An end-to-end cloud gaming platform enabling users on low-end laptops, Chromebooks, or mobile devices to play high-end GPU titles (GTA V, Cyberpunk 2077) with sub-25ms latency, dedicated per-player sessions, and persistent cloud save state.

---

## 1. System Architecture Overview

```
 [ Player Browser (Chrome/Edge) ]
       │  ▲
       │  │ WebRTC Video/Audio (H.264 / AV1 < 15ms)
       │  │ WebRTC DataChannel (Keyboard, Raw Mouse, Gamepad API)
       ▼  │
 [ Edge NAT / Ingress Gateway (STUN/TURN Coturn) ]
       │
       ▼
 [ CloudPlay Orchestrator (FastAPI) ]
  ├── Session Allocation & Port Pool
  ├── Player Auth & Multi-Tenancy Isolation
  ├── Idle Auto-Reclaim Sweeper Daemon (cost control)
  └── S3 / Local Persistent Save Manager
       │
   ┌───┴───────────────────────────────────────────────────────┐
   │                                                           │
   ▼                                                           ▼
[ Linux Container Host (Docker) ]               [ Windows GPU Host (AWS EC2 G5) ]
- Games: SuperTux 2, Retro Arena                - Games: GTA V, Cyberpunk 2077
- Streaming: Selkies WebSockets / WebRTC        - GPU: NVIDIA A10G (24GB VRAM)
- Capture: X11 / Wayland / KMS                  - Capture: DXGI Desktop Duplication
- Input: uinput virtual devices                 - Encoding: NVENC Ultra-Low-Latency (<4ms)
- Storage: `/home/ubuntu` volume mount          - Streaming: Sunshine / Moonlight WebRTC
                                                - Input: ViGEmBus Virtual Xbox 360 / PS4
                                                - Storage: S3 Profile Save Sync Daemon
```

---

## 2. Ultra-Low Latency Pipeline Breakdown

To make AAA games feel responsive in a browser, total round-trip input-to-display latency must stay under **30 ms**:

| Stage | Latency | Technology Used |
|---|---|---|
| **Input Capture** | < 2 ms | Browser Pointer Lock API (mouse delta) + Gamepad API |
| **Network Uplink** | 4 – 10 ms | WebRTC DataChannel (unreliable, unordered UDP) |
| **Host Input Injection** | < 1 ms | ViGEmBus virtual controller driver (Windows) / uinput (Linux) |
| **Game Engine Render** | 8 – 16 ms | 60 FPS (16.6ms) or 120 FPS (8.3ms) frame pacing |
| **Frame Capture** | 1 – 2 ms | Windows Desktop Duplication API (DXGI / Direct3D 11) |
| **Hardware Encoding** | 2 – 4 ms | NVIDIA NVENC (H.264 / AV1) with Ultra-Low Latency (`ull`) preset |
| **Network Downlink** | 4 – 10 ms | WebRTC SRTP RTP stream over UDP |
| **Browser Hardware Decode** | 2 – 3 ms | HTML5 `<video>` / WebCodecs with GPU hardware acceleration |
| **Total Round-Trip** | **~22 – 35 ms** | **Near-Imperceptible Lag** |

---

## 3. Multi-Session Isolation & Persistent Save Storage

### Independent Sessions
Each connected player (`player_1`, `player_2`, etc.) is allocated an isolated sandbox:
- **Linux Containers**: Separate Docker container with isolated cgroups, CPU limits (2 vCPUs), memory limits (4GB), and dedicated streaming port (`18080`, `18081`, etc.).
- **Windows GPU Nodes**: Dedicated Windows GPU VM or NVIDIA vGPU partition (MIG / vGPU) with isolated user profile directories.

### Persistent Save Synchronization
When a session stops, compute is reclaimed immediately to save costs, but save games are retained:
- **Local Dev / Single Host**: Saved in `./session-data/<player_id>/savegame.json` or `/home/ubuntu/.local/share/`.
- **Production AWS**: The `save_sync.py` daemon monitors `~/Documents/Rockstar Games/GTA V/Profiles/` and automatically synchronizes save files to `s3://cloudplay-player-saves/<player_id>/` at start and on exit.

---

## 4. Cloud Cost Economics (AWS G5 Spot Fleet)

High-end GPU instances are expensive if left idle:
- **AWS `g5.2xlarge` (NVIDIA A10G 24GB VRAM)**:
  - On-Demand: **$1.21 / hour** (~$870 / month)
  - Spot Instance: **$0.45 / hour** (~$324 / month)

### Automated Idle Sweeper
CloudPlay includes an automatic session sweeper:
1. When player inputs cease or browser tab is closed, the idle timer triggers after 5 minutes.
2. The orchestrator triggers cloud save upload to S3.
3. The instance is stopped or container is destroyed.
4. **Result:** Players only pay for active playtime, delivering an **80%+ cloud infrastructure cost reduction**.

---

## 5. Quickstart & Local Demo

### 1. Launch the Server
```bash
source .venv/bin/activate
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
```

### 2. Open Web Portal
Navigate to:
```
http://127.0.0.1:8000
```

### 3. Test Multi-Session Gameplay
1. In window 1, play as `player_1`.
2. Open an incognito window or change user to `player_2`.
3. Launch game; both players run completely independent sessions, separate ports, separate saves, and independent FPS telemetry!
