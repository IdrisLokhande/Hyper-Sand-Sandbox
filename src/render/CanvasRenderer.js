import { CONFIG } from '../config/constants.js';

export class CanvasRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.ctx = canvas.getContext('2d', { alpha: false });
    canvas.width = engine.width;
    canvas.height = engine.height;
    this.imageData = this.ctx.createImageData(engine.width, engine.height);
    this.pixels = new Uint32Array(this.imageData.data.buffer);
    this.pixels.fill(CONFIG.COLORS[0]);
    this.waterColors = new Uint32Array(256);
    this.oilColors = new Uint32Array(256);
    this.fireColors = new Uint32Array(CONFIG.FIRE_LIFETIME + 1);
    this.hotSandColors = new Uint32Array(CONFIG.HOT_SAND_LIFETIME + 1);
    this.buildWaterPalette();
    this.buildOilPalette();
    this.buildFirePalette();
    this.buildHotSandPalette();
  }

  buildWaterPalette() {
    this.waterColors.fill(CONFIG.COLORS[2]);
  }

  buildOilPalette() {
    this.oilColors.fill(CONFIG.COLORS[3]);
  }

  buildFirePalette() {
    const maxAge = CONFIG.FIRE_LIFETIME;
    for (let age = 0; age <= maxAge; age++) {
      // Fresh fire is the hot yellow center; older fire shifts toward red.
      const t = maxAge === 0 ? 0 : 1 - (age / maxAge);
      const r = 255;
      const g = (255 * (1 - t)) | 0;
      const b = 0;
      this.fireColors[age] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    }
  }

  buildHotSandPalette() {
    const hotTicks = CONFIG.HOT_SAND_HOT_TICKS;
    const cooldownTicks = CONFIG.HOT_SAND_COOLDOWN_TICKS;
    const hotColor = CONFIG.HOT_SAND_COLOR;
    const sandColor = CONFIG.COLORS[CONFIG.ELEMENTS.SAND];
    const hotR = hotColor & 0xff;
    const hotG = (hotColor >>> 8) & 0xff;
    const hotB = (hotColor >>> 16) & 0xff;
    const sandR = sandColor & 0xff;
    const sandG = (sandColor >>> 8) & 0xff;
    const sandB = (sandColor >>> 16) & 0xff;

    for (let age = 0; age <= CONFIG.HOT_SAND_LIFETIME; age++) {
      if (age <= cooldownTicks) {
        // Age counts down. During the final 4 seconds, blend from red-hot
        // back to the normal sand colour; age 0 is normal sand again.
        const progress = cooldownTicks > 0 ? age / cooldownTicks : 0;
        const r = Math.round(sandR + (hotR - sandR) * progress);
        const g = Math.round(sandG + (hotG - sandG) * progress);
        const b = Math.round(sandB + (hotB - sandB) * progress);
        this.hotSandColors[age] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      } else {
        this.hotSandColors[age] = hotColor;
      }
    }
  }

  render() {
    const grid = this.engine.gridType;
    const water = this.engine.gridWaterAmount;
    const colors = CONFIG.COLORS;
    const waterElement = CONFIG.ELEMENTS.WATER;
    const oilElement = CONFIG.ELEMENTS.OIL;
    const oil = this.engine.gridOilAmount;
    const fire = this.engine.gridAge;
    const hotSand = this.engine.gridHotSandAge;
    const minVisible = CONFIG.WATER_RENDER_MIN_VISIBLE_AMOUNT;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === waterElement) {
        const amount = water[i];
        this.pixels[i] = amount >= minVisible ? this.waterColors[amount] : colors[0];
      } else if (grid[i] === oilElement) {
        const amount = oil[i];
        this.pixels[i] = amount >= minVisible ? this.oilColors[amount] : colors[0];
      } else if (grid[i] === CONFIG.ELEMENTS.FIRE) {
        const age = Math.max(0, Math.min(CONFIG.FIRE_LIFETIME, fire[i]));
        this.pixels[i] = this.fireColors[age];
      } else if (grid[i] === CONFIG.ELEMENTS.SAND && hotSand[i] > 0) {
        const age = Math.max(0, Math.min(CONFIG.HOT_SAND_LIFETIME, hotSand[i]));
        this.pixels[i] = this.hotSandColors[age];
      } else {
        this.pixels[i] = colors[grid[i]];
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
