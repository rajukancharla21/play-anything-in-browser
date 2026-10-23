/**
 * Play Anything in Browser — Lightweight Client
 * Wires browser controls (Keyboard, Mouse Pointer Lock, Gamepad API)
 * to the isolated remote machine so the local laptop GPU/CPU remains untouched!
 */
class BrowserGameClient {
  constructor() {
    this.iframe = document.getElementById('gameIframe');
    this.gameSelector = document.getElementById('gameSelector');
    this.hudPing = document.getElementById('hudPing');
    this.hudCompute = document.getElementById('hudCompute');
    this.headerPing = document.getElementById('headerPingVal');
    this.computeBadgeText = document.getElementById('computeStatusText');
    this.gamepadIndicator = document.getElementById('gamepadIndicator');
    this.hintText = document.getElementById('hintText');
    this.viewportFrame = document.getElementById('viewportFrame');

    this.config = { remote_gpu_host: '', is_remote_active: false };
    this.ws = null;
    this.isMouseLocked = false;

    this.games = {
      gtavc: {
        title: 'GTA: Vice City (Local Server)',
        url: '/gta-vice-city-wasm/',
        hint: 'GTA Vice City: Local server active! Click "1-Click Load Local game.tar.gz" to unpack & start game!',
        isLocalWasm: true
      },
      pop: {
        title: 'Prince of Persia (1989)',
        url: 'https://princejs.com',
        hint: 'Controls: Arrow keys to move/jump/crouch • Shift for potion/slow-step',
        isLocalWasm: true
      },
      doom: {
        title: 'DOOM (1993 Shareware)',
        url: 'https://silentspacemarine.com/',
        hint: 'Controls: WASD / Arrow keys to move • Left Click / Ctrl to shoot • Space to open doors',
        isLocalWasm: true
      },
      remote: {
        title: 'Remote Cloud GPU Host (GTA V / PC Stream)',
        url: '',
        hint: 'Remote GPU Stream: Controls streamed via WebSocket to remote server',
        isLocalWasm: false
      },
      supertux: {
        title: 'SuperTux 2 (Linux Container)',
        url: '',
        hint: 'Controls: Arrow keys to move • Space to jump • Ctrl to fire',
        isLocalWasm: false
      }
    };

    this.init();
  }

  async init() {
    await this.fetchConfig();
    this.setupControlsSocket();
    this.initEventListeners();
    this.initGamepad();
    this.startPingTracker();

    // Default load GTA Vice City or selected game
    this.loadGame(this.gameSelector.value || 'gtavc');

  }

  async fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        this.config = await res.json();
        if (this.config.is_remote_active) {
          const host = this.config.remote_gpu_host;
          this.computeBadgeText.textContent = `Remote GPU (${host})`;
          this.hudCompute.textContent = `Cloud Node (${host})`;
          this.games.remote.url = `http://${host}:${this.config.remote_gpu_port || '18080'}`;
        } else {
          this.computeBadgeText.textContent = `Remote GPU Stream (Configure .env)`;
          this.hudCompute.textContent = `Isolated Sandbox`;
          this.games.remote.url = 'https://princejs.com';
        }
      }
    } catch (e) {
      console.warn("Config fetch failed", e);
    }
  }

  setupControlsSocket() {
    // WebSocket to forward raw mouse deltas, key presses, and gamepad packets to remote GPU host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/controls`;
    
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => console.log("[Controls] Stream channel connected to orchestrator");
      this.ws.onclose = () => setTimeout(() => this.setupControlsSocket(), 3000);
    } catch(e) {}
  }

  sendInput(eventObj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(eventObj));
    }
  }

  initEventListeners() {
    // Game switcher
    this.gameSelector.addEventListener('change', (e) => {
      this.loadGame(e.target.value);
    });

    // Pointer Lock (Mouse lock for FPS / 3D camera aim)
    const lockBtn = document.getElementById('btnLockPointer');
    if (lockBtn) {
      lockBtn.addEventListener('click', () => this.requestPointerLock());
    }

    document.addEventListener('pointerlockchange', () => {
      this.isMouseLocked = (document.pointerLockElement === this.viewportFrame);
      if (this.isMouseLocked) {
        this.showToast('🎯 Mouse Locked: 360° Game Controls Active (Press Esc to unlock)');
      }
    });

    // Capture mouse movement deltas and send to remote machine
    window.addEventListener('mousemove', (e) => {
      if (this.isMouseLocked) {
        this.sendInput({
          type: 'mouse_move',
          dx: e.movementX,
          dy: e.movementY,
          time: performance.now()
        });
      }
    });

    window.addEventListener('mousedown', (e) => {
      this.sendInput({ type: 'mouse_down', button: e.button });
    });

    window.addEventListener('mouseup', (e) => {
      this.sendInput({ type: 'mouse_up', button: e.button });
    });

    // Keyboard capture & forward to game iframe and remote socket
    window.addEventListener('keydown', (e) => {
      // Prevent page scrolling on gaming navigation keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
      this.sendInput({
        type: 'key_down',
        code: e.code,
        key: e.key,
        keyCode: e.keyCode,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey
      });

      this.forwardKeyToFrame('keydown', e);
    });

    window.addEventListener('keyup', (e) => {
      this.sendInput({
        type: 'key_up',
        code: e.code,
        key: e.key,
        keyCode: e.keyCode,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey
      });

      this.forwardKeyToFrame('keyup', e);
    });

    // Auto-focus iframe on click or mouse enter
    if (this.viewportFrame) {
      this.viewportFrame.addEventListener('mouseenter', () => {
        try {
          this.iframe?.contentWindow?.focus();
        } catch (_) {}
      });

      this.viewportFrame.addEventListener('click', () => {
        try {
          if (this.iframe && this.iframe.contentWindow) {
            this.iframe.contentWindow.focus();
            const canvas = this.iframe.contentDocument?.getElementById('canvas');
            if (canvas) canvas.focus();
          }
        } catch (_) {}
      });
    }

    // Fullscreen button
    const fsBtn = document.getElementById('btnFullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          this.viewportFrame.requestFullscreen().catch(err => console.warn(err));
        } else {
          document.exitFullscreen().catch(err => console.warn(err));
        }
      });
    }

    // Reload button
    const reloadBtn = document.getElementById('btnRestartGame');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        if (this.iframe.src) {
          const s = this.iframe.src;
          this.iframe.src = 'about:blank';
          setTimeout(() => { this.iframe.src = s; }, 80);
        }
      });
    }
  }

  forwardKeyToFrame(type, e) {
    try {
      if (this.iframe && this.iframe.contentWindow) {
        this.iframe.contentWindow.postMessage({
          type: type,
          code: e.code,
          key: e.key,
          keyCode: e.keyCode,
          which: e.which
        }, '*');

        const evt = new KeyboardEvent(type, {
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          which: e.which,
          bubbles: true,
          cancelable: true
        });
        this.iframe.contentDocument?.dispatchEvent(evt);
        const canvas = this.iframe.contentDocument?.getElementById('canvas');
        if (canvas) canvas.dispatchEvent(evt);
      }
    } catch (_) {}
  }

  requestPointerLock() {
    if (this.viewportFrame && this.viewportFrame.requestPointerLock) {
      this.viewportFrame.requestPointerLock().catch(err => console.warn(err));
    }
  }

  loadGame(key) {
    const game = this.games[key] || this.games.pop;
    this.hintText.textContent = game.hint;

    const targetUrl = game.url || (this.config.remote_gpu_host ? `http://${this.config.remote_gpu_host}:${this.config.remote_gpu_port || '18080'}` : 'https://princejs.com');
    this.iframe.src = targetUrl;
    this.showToast(`Loaded ${game.title} (Isolated Stream)`);
  }

  initGamepad() {
    window.addEventListener("gamepadconnected", (e) => {
      if (this.gamepadIndicator) {
        this.gamepadIndicator.classList.add('connected');
        this.gamepadIndicator.textContent = `🎮 ${e.gamepad.id.slice(0, 14)}... Connected`;
        this.showToast(`🎮 Controller detected: ${e.gamepad.id.slice(0, 20)}`);
      }
      this.pollGamepadLoop();
    });

    window.addEventListener("gamepaddisconnected", () => {
      if (this.gamepadIndicator) {
        this.gamepadIndicator.classList.remove('connected');
        this.gamepadIndicator.textContent = `🎮 Gamepad: None`;
      }
    });
  }

  pollGamepadLoop() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (gamepads && gamepads[0]) {
      const gp = gamepads[0];
      // Send controller axes & buttons to remote host
      this.sendInput({
        type: 'gamepad',
        axes: [gp.axes[0], gp.axes[1], gp.axes[2], gp.axes[3]],
        buttons: gp.buttons.map(b => ({ pressed: b.pressed, value: b.value }))
      });
    }
    requestAnimationFrame(() => this.pollGamepadLoop());
  }

  startPingTracker() {
    const ping = async () => {
      const t0 = performance.now();
      try {
        const res = await fetch('/api/ping');
        if (res.ok) {
          const rtt = Math.round(performance.now() - t0);
          this.hudPing.textContent = `${rtt} ms`;
          this.headerPing.textContent = `${rtt} ms`;
        }
      } catch (e) {}
    };

    ping();
    setInterval(ping, 2000);
  }

  showToast(msg) {
    const shelf = document.getElementById('toastShelf');
    if (!shelf) return;

    const toast = document.createElement('div');
    toast.className = 'clean-toast';
    toast.textContent = msg;
    shelf.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 2500);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.browserGameClient = new BrowserGameClient();
});
