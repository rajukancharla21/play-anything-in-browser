/**
 * Minimalist Stream & Game Player
 * Connects to real playable games, measures actual RTT ping to orchestrator,
 * and manages viewport lifecycle.
 */
class StreamPlayer {
  constructor() {
    this.iframe = document.getElementById('gameIframe');
    this.canvas = document.getElementById('streamCanvas');
    this.hudPing = document.getElementById('hudPing');
    this.hudPort = document.getElementById('hudPort');
    this.hudPlayer = document.getElementById('hudPlayer');
    this.headerPing = document.getElementById('headerPingVal');
    this.statusText = document.getElementById('streamStatusText');
    this.hintText = document.getElementById('hintText');
    this.titleEl = document.getElementById('currentStreamTitle');
    this.metaEl = document.getElementById('currentStreamMeta');
    
    this.currentSession = null;
    this.currentGame = null;
    this.pingInterval = null;

    this.initControls();
    this.startRealPingTracker();
  }

  initControls() {
    const fsBtn = document.getElementById('btnFullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        const frame = document.getElementById('viewportFrame');
        if (!document.fullscreenElement) {
          frame.requestFullscreen().catch(err => console.warn(err));
        } else {
          document.exitFullscreen().catch(err => console.warn(err));
        }
      });
    }

    const restartBtn = document.getElementById('btnRestartGame');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        if (this.iframe && this.iframe.src && this.iframe.src !== 'about:blank') {
          const current = this.iframe.src;
          this.iframe.src = 'about:blank';
          setTimeout(() => { this.iframe.src = current; }, 100);
        }
      });
    }

    const endBtn = document.getElementById('btnEndSession');
    if (endBtn) {
      endBtn.addEventListener('click', () => {
        if (this.currentSession && window.cloudApp) {
          window.cloudApp.terminateSession(this.currentSession.player_id);
        }
      });
    }
  }

  startRealPingTracker() {
    // Measures actual round-trip latency to the local server
    const checkPing = async () => {
      const t0 = performance.now();
      try {
        const res = await fetch('/api/ping');
        if (res.ok) {
          const rtt = Math.round(performance.now() - t0);
          if (this.hudPing) this.hudPing.textContent = `${rtt} ms`;
          if (this.headerPing) this.headerPing.textContent = `${rtt} ms`;
        }
      } catch(e) {
        if (this.headerPing) this.headerPing.textContent = `offline`;
      }
    };

    checkPing();
    this.pingInterval = setInterval(checkPing, 2000);
  }

  loadGame(sessionData, gameMeta) {
    this.currentSession = sessionData;
    this.currentGame = gameMeta;

    if (this.titleEl) this.titleEl.textContent = gameMeta.title;
    if (this.metaEl) this.metaEl.textContent = `Player: ${sessionData.player_id} • Port: ${sessionData.port} • Engine: ${gameMeta.engine}`;
    if (this.hudPort) this.hudPort.textContent = sessionData.port;
    if (this.hudPlayer) this.hudPlayer.textContent = sessionData.player_id;
    if (this.statusText) this.statusText.textContent = 'Active';
    if (this.hintText) this.hintText.textContent = gameMeta.controlsHint || 'Click inside game to control.';

    // Switch to Player tab
    const playerTabBtn = document.querySelector('[data-tab="player"]');
    if (playerTabBtn) playerTabBtn.click();

    // Load actual game url
    if (gameMeta.playUrl) {
      this.canvas.style.display = 'none';
      this.iframe.style.display = 'block';
      this.iframe.src = gameMeta.playUrl;
    } else if (sessionData.stream_url) {
      this.canvas.style.display = 'none';
      this.iframe.style.display = 'block';
      this.iframe.src = sessionData.stream_url;
    }
  }

  stop() {
    if (this.iframe) {
      this.iframe.src = 'about:blank';
    }
    if (this.titleEl) this.titleEl.textContent = 'No Game Loaded';
    if (this.metaEl) this.metaEl.textContent = 'Choose a game from the library';
    if (this.hudPort) this.hudPort.textContent = '--';
    if (this.statusText) this.statusText.textContent = 'Ready';
    this.currentSession = null;
    this.currentGame = null;
  }
}

window.StreamPlayer = StreamPlayer;
