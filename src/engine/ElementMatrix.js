import { CONFIG } from '../config/constants.js';

const { ELEMENTS } = CONFIG;

export class ElementMatrix {
  isEmpty(value) { return value === ELEMENTS.ERASER; }
  density(value) {
    switch (value) {
      case ELEMENTS.SAND: return 3;
      case ELEMENTS.WATER: return 2;
      case ELEMENTS.OIL: return 1;
      case ELEMENTS.FIRE: return -1;
      default: return 0;
    }
  }
  canDisplace(moving, target) {
    return target !== ELEMENTS.FIRE && this.density(moving) > this.density(target) && target !== ELEMENTS.ERASER;
  }
}
