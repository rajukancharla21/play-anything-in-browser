/**
 * High-performance 60FPS In-Browser Cloud Gaming Simulation Engine
 * Demonstrates low-latency streaming pipeline, Pointer Lock mouse look, 
 * Gamepad API input, audio synthesis, and per-player state persistence.
 */
class CloudGameDemo {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.isRunning = false;
    this.playerId = 'player_1';
    this.gameTitle = 'Cyber City Racer 2077';
    
    // Player physics & state
    this.player = {
      x: 640,
      y: 500,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      speed: 0,
      maxSpeed: 11,
      accel: 0.35,
      friction: 0.94,
      health: 100,
      score: 0,
      color: '#00f0ff'
    };

    // World & obstacles
    this.particles = [];
    this.traffic = [];
    this.bullets = [];
    this.keys = {};
    this.mouse = { x: 640, y: 360, locked: false, isDown: false };
    this.gamepadConnected = false;
    
    // Performance metrics
    this.lastTime = performance.now();
    this.fps = 60;
    this.frameCount = 0;
    this.fpsInterval = 0;
    this.simulatedLatency = 14; // ms
    this.bitrateMbps = 24.5;
    this.packetLoss = 0.0;
    
    // Web Audio Synthesizer
    this.initAudio();
    this.bindEvents();
    this.loadPlayerState();
  }

  initAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
    } catch (e) {
      this.audioCtx = null;
    }
  }

  playEngineSound(pitch = 120) {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(pitch, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.1);
    } catch(e) {}
  }

  playLaserSound() {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.15);
    } catch(e) {}
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === 'Space') {
        this.shoot();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Pointer Lock & Mouse Aim
    this.canvas.addEventListener('click', () => {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock().catch(() => {});
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = (document.pointerLockElement === this.canvas);
      const overlay = document.getElementById('pointerLockOverlay');
      if (overlay) {
        overlay.style.display = this.mouse.locked ? 'none' : 'flex';
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.mouse.locked) {
        this.mouse.x = Math.max(0, Math.min(1280, this.mouse.x + e.movementX));
        this.mouse.y = Math.max(0, Math.min(720, this.mouse.y + e.movementY));
      } else {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 1280;
        this.mouse.y = ((e.clientY - rect.top) / rect.height) * 720;
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.isDown = true;
        this.shoot();
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.mouse.isDown = false;
    });

    // Gamepad API
    window.addEventListener("gamepadconnected", (e) => {
      this.gamepadConnected = true;
      const gpEl = document.getElementById('gamepadBadge');
      if (gpEl) {
        gpEl.classList.add('active');
        gpEl.innerHTML = `🎮 ${e.gamepad.id.slice(0, 18)}... Connected`;
      }
    });

    window.addEventListener("gamepaddisconnected", () => {
      this.gamepadConnected = false;
      const gpEl = document.getElementById('gamepadBadge');
      if (gpEl) {
        gpEl.classList.remove('active');
        gpEl.innerHTML = `🎮 Gamepad: None`;
      }
    });
  }

  loadPlayerState() {
    const raw = localStorage.getItem(`cloud_save_${this.playerId}`);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        this.player.score = data.score || 0;
        this.player.health = data.health || 100;
        this.player.color = data.color || '#00f0ff';
      } catch(e) {}
    }
  }

  savePlayerState() {
    const data = {
      score: this.player.score,
      health: this.player.health,
      color: this.player.color,
      timestamp: Date.now()
    };
    localStorage.setItem(`cloud_save_${this.playerId}`, JSON.stringify(data));
    return data;
  }

  setPlayer(playerId, gameTitle) {
    this.playerId = playerId;
    if (gameTitle) this.gameTitle = gameTitle;
    this.loadPlayerState();
  }

  shoot() {
    this.bullets.push({
      x: this.player.x + Math.cos(this.player.angle) * 25,
      y: this.player.y + Math.sin(this.player.angle) * 25,
      vx: Math.cos(this.player.angle) * 18,
      vy: Math.sin(this.player.angle) * 18,
      life: 60
    });
    this.playLaserSound();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.spawnTraffic();
    this.loop();
  }

  stop() {
    this.isRunning = false;
    this.savePlayerState();
  }

  spawnTraffic() {
    this.traffic = [];
    for (let i = 0; i < 8; i++) {
      this.traffic.push({
        x: 100 + Math.random() * 1080,
        y: Math.random() * 720,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        angle: Math.random() * Math.PI * 2,
        color: ['#f43f5e', '#8b5cf6', '#10b981', '#f59e0b'][Math.floor(Math.random() * 4)],
        size: 28
      });
    }
  }

  pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!gamepads || !gamepads[0]) return;
    const gp = gamepads[0];
    
    // Left Stick for movement
    const deadzone = 0.15;
    const axX = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
    const axY = Math.abs(gp.axes[1]) > deadzone ? gp.axes[1] : 0;
    
    if (axX !== 0 || axY !== 0) {
      this.player.angle = Math.atan2(axY, axX);
      this.player.speed = Math.min(this.player.maxSpeed, this.player.speed + this.player.accel);
      this.playEngineSound(100 + this.player.speed * 20);
    }
    
    // Right Trigger (Button 7) or Button 0 (A) to shoot
    if (gp.buttons[7]?.pressed || gp.buttons[0]?.pressed) {
      if (Math.random() < 0.25) this.shoot();
    }
  }

  update(dt) {
    this.pollGamepad();

    // Keyboard Movement Controls
    let moveForward = this.keys['KeyW'] || this.keys['ArrowUp'];
    let moveBackward = this.keys['KeyS'] || this.keys['ArrowDown'];
    let turnLeft = this.keys['KeyA'] || this.keys['ArrowLeft'];
    let turnRight = this.keys['KeyD'] || this.keys['ArrowRight'];

    if (turnLeft) this.player.angle -= 0.06;
    if (turnRight) this.player.angle += 0.06;

    if (moveForward) {
      this.player.speed = Math.min(this.player.maxSpeed, this.player.speed + this.player.accel);
      this.playEngineSound(100 + this.player.speed * 20);
      // Spawn exhaust particles
      this.particles.push({
        x: this.player.x - Math.cos(this.player.angle) * 20,
        y: this.player.y - Math.sin(this.player.angle) * 20,
        vx: -Math.cos(this.player.angle) * 3 + (Math.random() - 0.5) * 2,
        vy: -Math.sin(this.player.angle) * 3 + (Math.random() - 0.5) * 2,
        alpha: 1,
        color: this.player.color
      });
    } else if (moveBackward) {
      this.player.speed = Math.max(-this.player.maxSpeed * 0.5, this.player.speed - this.player.accel * 0.8);
    } else {
      this.player.speed *= this.player.friction;
    }

    // Velocity update
    this.player.vx = Math.cos(this.player.angle) * this.player.speed;
    this.player.vy = Math.sin(this.player.angle) * this.player.speed;
    this.player.x += this.player.vx;
    this.player.y += this.player.vy;

    // Boundary wrap
    if (this.player.x < 0) this.player.x = 1280;
    if (this.player.x > 1280) this.player.x = 0;
    if (this.player.y < 0) this.player.y = 720;
    if (this.player.y > 720) this.player.y = 0;

    // Mouse aiming towards cursor when locked
    if (this.mouse.locked || this.mouse.isDown) {
      const dx = this.mouse.x - this.player.x;
      const dy = this.mouse.y - this.player.y;
      const targetAngle = Math.atan2(dy, dx);
      // Smooth lerp angle towards target
      let diff = targetAngle - this.player.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.player.angle += diff * 0.15;
    }

    // Update bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      
      // Hit traffic
      for (let t of this.traffic) {
        const dist = Math.hypot(b.x - t.x, b.y - t.y);
        if (dist < t.size) {
          b.life = 0;
          this.player.score += 50;
          // Explosion particles
          for (let p = 0; p < 12; p++) {
            this.particles.push({
              x: t.x,
              y: t.y,
              vx: (Math.random() - 0.5) * 8,
              vy: (Math.random() - 0.5) * 8,
              alpha: 1,
              color: t.color
            });
          }
          t.x = Math.random() * 1280;
          t.y = Math.random() * 720;
          break;
        }
      }
      
      if (b.life <= 0 || b.x < 0 || b.x > 1280 || b.y < 0 || b.y > 720) {
        this.bullets.splice(i, 1);
      }
    }

    // Update traffic
    for (let t of this.traffic) {
      t.x += t.vx;
      t.y += t.vy;
      if (t.x < 0) t.x = 1280;
      if (t.x > 1280) t.x = 0;
      if (t.y < 0) t.y = 720;
      if (t.y > 720) t.y = 0;

      // Check collision with player
      const d = Math.hypot(this.player.x - t.x, this.player.y - t.y);
      if (d < 30) {
        this.player.health = Math.max(0, this.player.health - 0.5);
        this.player.speed *= -0.5;
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.03;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }

    // Update Telemetry Metrics
    this.frameCount++;
    this.fpsInterval += dt;
    if (this.fpsInterval >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsInterval = 0;
      this.simulatedLatency = Math.floor(12 + Math.random() * 6);
      this.bitrateMbps = (22.5 + Math.random() * 3.5).toFixed(1);
      this.updateHudDom();
    }
  }

  updateHudDom() {
    const fpsEl = document.getElementById('hudFps');
    const latEl = document.getElementById('hudLatency');
    const bitEl = document.getElementById('hudBitrate');
    const lossEl = document.getElementById('hudLoss');
    const scoreEl = document.getElementById('hudScore');
    const healthEl = document.getElementById('hudHealth');

    if (fpsEl) fpsEl.textContent = `${this.fps} FPS`;
    if (latEl) latEl.textContent = `${this.simulatedLatency} ms`;
    if (bitEl) bitEl.textContent = `${this.bitrateMbps} Mbps`;
    if (lossEl) lossEl.textContent = `${this.packetLoss.toFixed(1)}%`;
    if (scoreEl) scoreEl.textContent = this.player.score;
    if (healthEl) healthEl.textContent = `${Math.round(this.player.health)}%`;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 1280, 720);

    // Neon Grid Background (GTA / Cyberpunk style)
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.12)';
    ctx.lineWidth = 1;
    const gridSize = 64;
    for (let x = 0; x < 1280; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 720);
      ctx.stroke();
    }
    for (let y = 0; y < 720; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1280, y);
      ctx.stroke();
    }

    // Draw Particles
    for (let p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Draw Bullets
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    for (let b of this.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Draw Traffic Drones
    for (let t of this.traffic) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 10;
      ctx.fillRect(-t.size / 2, -t.size / 4, t.size, t.size / 2);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Draw Player Vehicle
    ctx.save();
    ctx.translate(this.player.x, this.player.y);
    ctx.rotate(this.player.angle);
    
    // Vehicle Glow & Body
    ctx.shadowColor = this.player.color;
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#121524';
    ctx.strokeStyle = this.player.color;
    ctx.lineWidth = 2.5;

    // Sleek sports chassis
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(-14, -14);
    ctx.lineTo(-20, -10);
    ctx.lineTo(-20, 10);
    ctx.lineTo(-14, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cockpit neon canopy
    ctx.fillStyle = this.player.color;
    ctx.fillRect(-4, -6, 12, 12);
    ctx.shadowBlur = 0;
    ctx.restore();

    // Draw Crosshair for mouse aiming
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.mouse.x, this.mouse.y, 14, 0, Math.PI * 2);
    ctx.moveTo(this.mouse.x - 18, this.mouse.y);
    ctx.lineTo(this.mouse.x + 18, this.mouse.y);
    ctx.moveTo(this.mouse.x, this.mouse.y - 18);
    ctx.lineTo(this.mouse.x, this.mouse.y + 18);
    ctx.stroke();

    // Stream Session Watermark (bottom left)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(`SESSION: ${this.playerId.toUpperCase()} | GAME: ${this.gameTitle.toUpperCase()} | ENCODER: NVENC H.264`, 20, 700);
  }

  loop() {
    if (!this.isRunning) return;
    const now = performance.now();
    const dt = now - this.lastTime;
    this.lastTime = now;
    
    this.update(dt);
    this.draw();
    requestAnimationFrame(() => this.loop());
  }
}

window.CloudGameDemo = CloudGameDemo;
