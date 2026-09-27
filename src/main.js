import './styles.css';
import { CONFIG } from './config/constants.js';
import { EngineCore } from './engine/EngineCore.js';
import { CanvasRenderer } from './render/CanvasRenderer.js';
import { UIManager } from './ui/UIManager.js';

const app = document.querySelector('#app');
app.innerHTML = `
  <section class="shell" style="--grid-width: ${CONFIG.GRID_WIDTH}; --grid-height: ${CONFIG.GRID_HEIGHT};">
    <header class="header">
      <div>
        <h1>HYPER SAND // SANDBOX</h1>
        <p>[ <span data-grid-size>${CONFIG.GRID_WIDTH}x${CONFIG.GRID_HEIGHT}</span> GRID | ${CONFIG.TARGET_FPS} FPS ]</p>
      </div>
    </header>

    <section class="viewport" aria-label="Simulation canvas">
      <canvas id="simulation"></canvas>
    </section>

    <div class="info-dialog" data-info-dialog hidden>
      <div class="info-backdrop" data-info-close></div>
      <section class="info-popup" role="dialog" aria-modal="true" aria-labelledby="info-title">
        <button class="info-close" type="button" aria-label="Close information" data-info-close>×</button>
        <p class="info-kicker">ABOUT THE PROJECT</p>
        <h2 id="info-title">HYPER SAND // SANDBOX</h2>
        <p>A browser-based hybrid cellular automaton sandbox for experimenting with sand, water, oil, and fire for now. "Hybrid" cellular automaton because some primary states have multiple phase states with varying neighbourhood logic.</p>
        <div class="info-elements">
          <div><strong>SAND</strong><span>Granular solid that falls and slides diagonally.</span></div>
          <div><strong>WATER</strong><span>Liquid that falls, spreads, and disperses horizontally.</span></div>
          <div><strong>OIL</strong><span>Viscous liquid that floats on water and burns near fire.</span></div>
          <div><strong>FIRE</strong><span>Rising energy that ignites adjacent oil and decays over time.</span></div>
        </div>
      </section>
    </div>

    <section class="panel active" data-panel="control">
      <div class="control-row">
        <div class="group">
          <span class="label">ELEMENT</span>
          <div class="buttons">
            <button class="element sand active" data-element="1">[ SAND ]</button>
            <button class="element water" data-element="2">[ WATER ]</button>
            <button class="element oil" data-element="3">[ OIL ]</button>
            <button class="element fire" data-element="4">[ FIRE ]</button>
            <button class="element eraser" data-element="0">[ ERASER ]</button>
          </div>
        </div>
        <div class="group compact">
          <label class="label" for="radius">BRUSH SIZE <span data-radius-label>5PX</span></label>
          <input id="radius" data-radius type="range" min="1" max="5" value="5" />
        </div>
      </div>
      <div class="engine-row">
        <span class="label">ENGINE</span>
        <button data-pause>[ PAUSE ]</button>
        <button data-step>[ STEP ]</button>
        <button data-clear>[ CLEAR ]</button>
        <button data-gravity>[ GRAVITY: DOWN ]</button>
      </div>
    </section>
  </section>
`;

const infoButton = document.createElement('button');
infoButton.className = 'info-button';
infoButton.type = 'button';
infoButton.dataset.infoOpen = '';
infoButton.setAttribute('aria-label', 'Project information');
infoButton.setAttribute('aria-expanded', 'false');
infoButton.innerHTML = '<span aria-hidden="true">i</span>';
document.body.appendChild(infoButton);

const engine = new EngineCore();
const renderer = new CanvasRenderer(document.querySelector('#simulation'), engine);
new UIManager({ engine, renderer });

let last = performance.now();
let accumulator = 0;
function frame(now) {
  const delta = Math.min(100, now - last);
  last = now;
  accumulator += delta;
  while (accumulator >= CONFIG.PHYSICS_STEP_MS) {
    engine.updatePhysics();
    accumulator -= CONFIG.PHYSICS_STEP_MS;
  }
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
