import { CONFIG } from '../config/constants.js';

export class UIManager {
  constructor({ engine, renderer }) {
    this.engine = engine;
    this.renderer = renderer;
    this.activeElement = CONFIG.ELEMENTS.SAND;
    this.brushRadius = CONFIG.DEFAULT_BRUSH_RADIUS;
    this.bindControls();
    this.bindCanvas();
  }

  bindControls() {
    document.querySelectorAll('[data-element]').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('[data-element]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.activeElement = Number(btn.dataset.element);
    }));

    const radius = document.querySelector('[data-radius]');
    const radiusLabel = document.querySelector('[data-radius-label]');
    radius.addEventListener('input', () => {
      this.brushRadius = Math.min(
         CONFIG.MAX_BRUSH_RADIUS,
         Math.max(CONFIG.MIN_BRUSH_RADIUS, Number(radius.value))
      );
      radiusLabel.textContent = `${this.brushRadius}PX`;
    });
    const pauseButton = document.querySelector('[data-pause]');
    const stepButton = document.querySelector('[data-step]');
    const syncEngineControls = () => {
      pauseButton.textContent = this.engine.running ? '[ PAUSE ]' : '[ RUN ]';
      stepButton.disabled = this.engine.running;
      stepButton.setAttribute('aria-disabled', String(this.engine.running));
    };
    pauseButton.addEventListener('click', () => {
      this.engine.running = !this.engine.running;
      syncEngineControls();
    });
    stepButton.addEventListener('click', () => {
      if (this.engine.running) return;
      this.engine.updatePhysics(true);
    });
    syncEngineControls();
    document.querySelector('[data-clear]').addEventListener('click', () => {
      this.engine.clear();
    });
    document.querySelector('[data-gravity]').addEventListener('click', e => {
      this.engine.gravityDown = !this.engine.gravityDown;
      e.currentTarget.textContent = this.engine.gravityDown ? '[ GRAVITY: DOWN ]' : '[ GRAVITY: UP ]';
    });

    this.bindInfoPopup();
  }

  bindInfoPopup() {
    const dialog = document.querySelector('[data-info-dialog]');
    const infoButton = document.querySelector('[data-info-open]');
    const closeButtons = dialog.querySelectorAll('[data-info-close]');

    const close = () => {
      dialog.hidden = true;
      infoButton.setAttribute('aria-expanded', 'false');
    };

    infoButton.addEventListener('click', () => {
      dialog.hidden = false;
      infoButton.setAttribute('aria-expanded', 'true');
      dialog.querySelector('.info-close').focus();
    });
    closeButtons.forEach(button => button.addEventListener('click', close));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !dialog.hidden) close();
    });
  }

  bindCanvas() {
    const canvas = this.renderer.canvas;
    let drawing = false;
    const draw = event => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left) / rect.width * this.engine.width);
      const y = Math.floor((event.clientY - rect.top) / rect.height * this.engine.height);
      const r = this.brushRadius;
      const r2 = r * r;
      const minX = Math.max(0, x - r), maxX = Math.min(this.engine.width - 1, x + r);
      const minY = Math.max(0, y - r), maxY = Math.min(this.engine.height - 1, y + r);
      for (let yy = minY; yy <= maxY; yy++) for (let xx = minX; xx <= maxX; xx++) {
        if ((xx - x) * (xx - x) + (yy - y) * (yy - y) <= r2) this.engine.setCell(xx, yy, this.activeElement);
      }
    };
    canvas.addEventListener('pointerdown', event => { drawing = true; canvas.setPointerCapture(event.pointerId); draw(event); });
    canvas.addEventListener('pointermove', event => { if (drawing) draw(event); });
    canvas.addEventListener('pointerup', () => { drawing = false; });
    canvas.addEventListener('pointercancel', () => { drawing = false; });
  }
}
