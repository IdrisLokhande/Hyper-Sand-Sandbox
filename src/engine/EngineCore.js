import { CONFIG } from '../config/constants.js';
import { ElementMatrix } from './ElementMatrix.js';

const { ELEMENTS, LIQUID_STATES } = CONFIG;

export class EngineCore {
  constructor(width = CONFIG.GRID_WIDTH, height = CONFIG.GRID_HEIGHT) {
    this.width = width;
    this.height = height;
    this.size = width * height;

    this.gridType = new Uint8Array(this.size);
    this.gridAge = new Uint8Array(this.size);
    this.gridHotSandAge = new Uint16Array(this.size);
    this.gridUpdated = new Uint8Array(this.size);
    this.gridVelocity = new Uint8Array(this.size);
    this.fireSpreadQueue = new Int32Array(this.size);
    this.fireSpreadQueueCount = 0;

    // Liquids have a small amount of extra state without becoming an object-based
    // particle system. Amount is 0..255 and is conserved during liquid transfer.
    this.gridWaterAmount = new Uint8Array(this.size);
    this.gridOilAmount = new Uint8Array(this.size);
    this.gridLiquidState = new Uint8Array(this.size);
    this.waterDelta = new Int16Array(this.size);
    this.waterTransferOut = new Uint8Array(this.size);
    this.waterTransferIn = new Uint16Array(this.size);
    this.oilDelta = new Int16Array(this.size);
    this.oilTransferOut = new Uint8Array(this.size);
    this.oilTransferIn = new Uint16Array(this.size);
    this.oilDiagonalQueue = new Int32Array(this.size);
    this.oilDiagonalQueueCount = 0;
    this.waterDiagonalQueue = new Int32Array(this.size);
    this.waterDiagonalQueueCount = 0;
    this.waterRelaxationTicks = 0;
    this.oilRelaxationTicks = 0;
    this.waterPresent = false;
    this.oilPresent = false;

    this.elements = new ElementMatrix();
    this.frame = 0;
    this.running = true;
    this.gravityDown = true;
    this.oilSurface = new Uint16Array(width);
    this.waterSurface = new Uint16Array(width);
    this.oilSurfaceLock = new Uint8Array(width);
    // Horizontal water→oil superposition is transactional per connected
    // oil component for the current water phase. Downhill/diagonal
    // superposition remains unrestricted.
    this.waterOilHorizontalComponentLock = new Uint8Array(this.size);
    this.waterOilHorizontalComponentQueue = new Int32Array(this.size);
  }

  index(x, y) { return y * this.width + x; }
  inBounds(x, y) { return x >= 0 && x < this.width && y >= 0 && y < this.height; }
  captureState() {
    return {
      frame: this.frame,
      running: this.running,
      gravityDown: this.gravityDown,
      gridType: this.gridType.slice(),
      gridAge: this.gridAge.slice(),
      gridHotSandAge: this.gridHotSandAge.slice(),
      gridUpdated: this.gridUpdated.slice(),
      gridVelocity: this.gridVelocity.slice(),
      gridWaterAmount: this.gridWaterAmount.slice(),
      gridOilAmount: this.gridOilAmount.slice(),
      gridLiquidState: this.gridLiquidState.slice(),
      waterDelta: this.waterDelta.slice(),
      waterTransferOut: this.waterTransferOut.slice(),
      waterTransferIn: this.waterTransferIn.slice(),
      oilDelta: this.oilDelta.slice(),
      oilTransferOut: this.oilTransferOut.slice(),
      oilTransferIn: this.oilTransferIn.slice(),
      oilDiagonalQueue: this.oilDiagonalQueue.slice(),
      waterDiagonalQueue: this.waterDiagonalQueue.slice(),
      fireSpreadQueue: this.fireSpreadQueue.slice(),
      oilSurface: this.oilSurface.slice(),
      waterSurface: this.waterSurface.slice(),
      oilSurfaceLock: this.oilSurfaceLock.slice(),
      waterOilHorizontalComponentLock: this.waterOilHorizontalComponentLock.slice(),
      waterOilHorizontalComponentQueue: this.waterOilHorizontalComponentQueue.slice(),
      waterRelaxationTicks: this.waterRelaxationTicks,
      oilRelaxationTicks: this.oilRelaxationTicks,
      fireSpreadQueueCount: this.fireSpreadQueueCount,
      waterDiagonalQueueCount: this.waterDiagonalQueueCount,
      oilDiagonalQueueCount: this.oilDiagonalQueueCount,
      waterPresent: this.waterPresent,
      oilPresent: this.oilPresent,
    };
  }

  restoreState(state) {
    if (!state || state.gridType?.length !== this.size) throw new Error('Invalid engine state snapshot.');
    this.frame = state.frame;
    this.running = state.running;
    this.gravityDown = state.gravityDown;
    this.gridType.set(state.gridType);
    this.gridAge.set(state.gridAge);
    if (state.gridHotSandAge) this.gridHotSandAge.set(state.gridHotSandAge);
    else this.gridHotSandAge.fill(0);
    this.gridUpdated.set(state.gridUpdated);
    this.gridVelocity.set(state.gridVelocity);
    this.gridWaterAmount.set(state.gridWaterAmount);
    this.gridOilAmount.set(state.gridOilAmount);
    if (state.gridLiquidState) this.gridLiquidState.set(state.gridLiquidState);
    else if (state.gridWaterState) this.gridLiquidState.set(state.gridWaterState);
    else this.gridLiquidState.fill(LIQUID_STATES.NONE);
    this.waterDelta.set(state.waterDelta);
    this.waterTransferOut.set(state.waterTransferOut);
    this.waterTransferIn.set(state.waterTransferIn);
    this.oilDelta.set(state.oilDelta);
    this.oilTransferOut.set(state.oilTransferOut);
    this.oilTransferIn.set(state.oilTransferIn);
    this.oilDiagonalQueue.set(state.oilDiagonalQueue);
    this.waterDiagonalQueue.set(state.waterDiagonalQueue);
    this.fireSpreadQueue.set(state.fireSpreadQueue);
    this.oilSurface.set(state.oilSurface);
    this.waterSurface.set(state.waterSurface);
    this.oilSurfaceLock.set(state.oilSurfaceLock);
    this.waterOilHorizontalComponentLock.set(state.waterOilHorizontalComponentLock);
    this.waterOilHorizontalComponentQueue.set(state.waterOilHorizontalComponentQueue);
    this.waterRelaxationTicks = state.waterRelaxationTicks;
    this.oilRelaxationTicks = state.oilRelaxationTicks;
    this.waterPresent = state.waterPresent;
    this.oilPresent = state.oilPresent;
    this.fireSpreadQueueCount = state.fireSpreadQueueCount ?? 0;
    this.waterDiagonalQueueCount = state.waterDiagonalQueueCount ?? 0;
    this.oilDiagonalQueueCount = state.oilDiagonalQueueCount ?? 0;
    this.waterOilHorizontalComponentLock.fill(0);
  }

  clear() {
    this.gridType.fill(ELEMENTS.ERASER);
    this.gridAge.fill(0);
    this.gridHotSandAge.fill(0);
    this.gridUpdated.fill(0);
    this.gridVelocity.fill(0);
    this.fireSpreadQueueCount = 0;
    this.gridWaterAmount.fill(0);
    this.gridOilAmount.fill(0);
    this.gridLiquidState.fill(LIQUID_STATES.NONE);
    this.resetLiquidTransferBuffers(ELEMENTS.WATER);
    this.resetLiquidTransferBuffers(ELEMENTS.OIL);
    this.waterDiagonalQueueCount = 0;
    this.waterRelaxationTicks = 0;
    this.oilRelaxationTicks = 0;
    this.waterPresent = false;
    this.oilPresent = false;
    this.oilSurface.fill(this.height);
    this.waterSurface.fill(this.height);
    this.waterOilHorizontalComponentLock.fill(0);
  }

  setCell(x, y, element) {
    if (!this.inBounds(x, y)) return false;
    const i = this.index(x, y);
    const current = this.gridType[i];

    // Liquid tools never overwrite existing sand. Empty cells remain paintable,
    // while the normal CA solver continues to handle all physical liquid motion.
    if ((element === ELEMENTS.WATER || element === ELEMENTS.OIL) && current === ELEMENTS.SAND) {
      return false;
    }

    // Fire heats sand in place instead of replacing it with an expiring fire
    // particle. The sand remains a solid CA cell and simply renders hot until
    // the local heat timer reaches zero.
    if (element === ELEMENTS.FIRE && current === ELEMENTS.SAND) {
      this.gridHotSandAge[i] = CONFIG.HOT_SAND_LIFETIME;
      return true;
    }

    this.gridType[i] = element;
    this.gridAge[i] = element === ELEMENTS.FIRE ? CONFIG.FIRE_LIFETIME : 0;
    this.gridHotSandAge[i] = 0;
    this.gridVelocity[i] = 0;

    if (element === ELEMENTS.WATER) {
      this.gridWaterAmount[i] = CONFIG.LIQUID_FULL_AMOUNT;
      this.gridLiquidState[i] = LIQUID_STATES.FALLING;
      this.waterPresent = true;
      this.gridOilAmount[i] = 0;
    } else if (element === ELEMENTS.OIL) {
      this.gridOilAmount[i] = CONFIG.LIQUID_FULL_AMOUNT;
      this.gridWaterAmount[i] = 0;
      this.gridLiquidState[i] = LIQUID_STATES.FALLING;
      this.oilPresent = true;
    } else {
      this.gridWaterAmount[i] = 0;
      this.gridOilAmount[i] = 0;
      this.gridLiquidState[i] = LIQUID_STATES.NONE;
    }
    return true;
  }

  swap(a, b) {
    const type = this.gridType[a];
    const age = this.gridAge[a];
    const velocity = this.gridVelocity[a];
    const waterAmount = this.gridWaterAmount[a];
    const oilAmount = this.gridOilAmount[a];
    const liquidState = this.gridLiquidState[a];
    const hotSandAge = this.gridHotSandAge[a];

    this.gridType[a] = this.gridType[b];
    this.gridAge[a] = this.gridAge[b];
    this.gridVelocity[a] = this.gridVelocity[b];
    this.gridWaterAmount[a] = this.gridWaterAmount[b];
    this.gridOilAmount[a] = this.gridOilAmount[b];
    this.gridLiquidState[a] = this.gridLiquidState[b];
    this.gridHotSandAge[a] = this.gridHotSandAge[b];

    this.gridType[b] = type;
    this.gridAge[b] = age;
    this.gridVelocity[b] = velocity;
    this.gridWaterAmount[b] = waterAmount;
    this.gridOilAmount[b] = oilAmount;
    this.gridLiquidState[b] = liquidState;
    this.gridHotSandAge[b] = hotSandAge;

    this.gridUpdated[a] = this.frame;
    this.gridUpdated[b] = this.frame;
  }

  tryMove(x, y, nx, ny, allowDisplacement = false) {
    if (!this.inBounds(nx, ny)) return false;
    const from = this.index(x, y);
    const to = this.index(nx, ny);
    if (this.gridUpdated[from] === this.frame) return false;
    const target = this.gridType[to];
    const targetUpdated = this.gridUpdated[to] === this.frame;
    const canDisplace = allowDisplacement && this.elements.canDisplace(this.gridType[from], target);
    const canSwapUpdatedLiquid = allowDisplacement &&
      this.gridType[from] === ELEMENTS.SAND &&
      (target === ELEMENTS.WATER || target === ELEMENTS.OIL);
    if ((!targetUpdated && (this.elements.isEmpty(target) || canDisplace)) || canSwapUpdatedLiquid) {
      this.swap(from, to);
      return true;
    }
    return false;
  }

  updatePhysics(force = false) {
    if (!this.running && !force) return;
    this.frame = (this.frame + 1) & 0xff;
    if (this.frame === 0) {
      this.gridUpdated.fill(0);
      this.waterOilHorizontalComponentLock.fill(0);
    }

    for (let i = 0; i < this.size; i++) {
      if (this.gridHotSandAge[i] > 0) this.gridHotSandAge[i] -= 1;
    }

    // Solids, oil, and fire retain the original particle CA sweep. Water is
    // deliberately excluded from it: water has its own two-phase solver below.
    const yStart = this.gravityDown ? this.height - 1 : 0;
    const yEnd = this.gravityDown ? -1 : this.height;
    const yStep = this.gravityDown ? -1 : 1;

    for (let y = yStart; y !== yEnd; y += yStep) {
      const reverse = ((y + this.frame) & 1) === 1;
      if (reverse) {
        for (let x = this.width - 1; x >= 0; x--) this.updateCell(x, y);
      } else {
        for (let x = 0; x < this.width; x++) this.updateCell(x, y);
      }
    }

    this.processFireSpreadQueue();

    if (this.waterPresent) this.updateWaterPhase();
    if (this.oilPresent) this.updateOilPhase();
  }

  accelerate(type, index) {
    const max = CONFIG.GRAVITY_MAX_VELOCITY;
    let velocity = this.gridVelocity[index];
    const acceleration = type === ELEMENTS.OIL
      ? CONFIG.OIL_GRAVITY_ACCELERATION
      : CONFIG.GRAVITY_ACCELERATION;
    velocity += acceleration;
    this.gridVelocity[index] = velocity > max ? max : velocity;
    return this.gridVelocity[index];
  }

  shouldMoveDownward(index, velocity) {
    if (velocity >= CONFIG.GRAVITY_FULL_SPEED_THRESHOLD) return true;
    if (velocity >= CONFIG.GRAVITY_HALF_SPEED_THRESHOLD) return (this.frame & 1) === 0;
    return (this.frame % CONFIG.GRAVITY_INITIAL_PERIOD) === 0;
  }

  updateCell(x, y) {
    const i = this.index(x, y);
    if (this.gridUpdated[i] === this.frame) return;
    const type = this.gridType[i];
    let velocity = 0;
    if (type === ELEMENTS.SAND) {
      velocity = this.accelerate(type, i);
      if (!this.shouldMoveDownward(i, velocity)) return;
    }
    switch (type) {
      case ELEMENTS.SAND: this.updateSand(x, y); break;
      case ELEMENTS.FIRE: this.updateFire(x, y); break;
      default: break;
    }
  }

  updateSand(x, y) {
    const belowY = y + (this.gravityDown ? 1 : -1);
    if (this.tryMove(x, y, x, belowY, true)) return;
    const left = ((x + y + this.frame) & 1) === 0;
    const a = left ? -1 : 1;
    const b = -a;
    if (this.tryMove(x, y, x + a, belowY, true)) return;
    this.tryMove(x, y, x + b, belowY, true);
  }

  resetLiquidTransferBuffers(type) {
    const delta = type === ELEMENTS.WATER ? this.waterDelta : this.oilDelta;
    const transferOut = type === ELEMENTS.WATER ? this.waterTransferOut : this.oilTransferOut;
    const transferIn = type === ELEMENTS.WATER ? this.waterTransferIn : this.oilTransferIn;
    delta.fill(0);
    transferOut.fill(0);
    transferIn.fill(0);
  }

  updateWaterPhase() {
    // Phase 1: ballistic water. Only cells with an open/partly filled cell in
    // the gravity direction can transfer mass. No lateral equilibrium occurs.
    const yStart = this.gravityDown ? this.height - 2 : 1;
    const yEnd = this.gravityDown ? -1 : this.height;
    const yStep = this.gravityDown ? -1 : 1;
    for (let chainStep = 0; chainStep < CONFIG.WATER_FREE_FALL_CHAIN_STEPS; chainStep++) {
      this.resetLiquidTransferBuffers(ELEMENTS.WATER);
      for (let y = yStart; y !== yEnd; y += yStep) {
        const reverse = ((y + this.frame + chainStep) & 1) === 1;
        if (reverse) {
          for (let x = this.width - 1; x >= 0; x--) this.updateLiquidGravity(x, y, ELEMENTS.WATER);
        } else {
          for (let x = 0; x < this.width; x++) this.updateLiquidGravity(x, y, ELEMENTS.WATER);
        }
      }
      this.applyLiquidDelta(ELEMENTS.WATER);
    }

    // Phase 2: diagonal settling. Start with fresh transfer buffers so the
    // final gravity-chain transfers cannot leak into diagonal accounting.
    // Then do one full-grid discovery pass and continue newly diagonal-moving
    // water from a compact active queue.
    this.resetLiquidTransferBuffers(ELEMENTS.WATER);
    this.waterDiagonalQueueCount = 0;
    for (let y = yStart; y !== yEnd; y += yStep) {
      const reverse = ((xorshift(this.frame, y) & 1) === 1);
      if (reverse) {
        for (let x = this.width - 1; x >= 0; x--) this.updateLiquidDiagonal(x, y, ELEMENTS.WATER, true);
      } else {
        for (let x = 0; x < this.width; x++) this.updateLiquidDiagonal(x, y, ELEMENTS.WATER, true);
      }
    }
    this.applyLiquidDelta(ELEMENTS.WATER);

    for (let chainStep = 1; chainStep < CONFIG.WATER_DIAGONAL_CHAIN_STEPS; chainStep++) {
      if (this.waterDiagonalQueueCount === 0) break;
      this.resetLiquidTransferBuffers(ELEMENTS.WATER);
      const queueCount = this.waterDiagonalQueueCount;
      this.waterDiagonalQueueCount = 0;
      for (let q = 0; q < queueCount; q++) {
        const index = this.waterDiagonalQueue[q];
        if (this.gridType[index] !== ELEMENTS.WATER || this.gridWaterAmount[index] === 0) continue;
        const x = index % this.width;
        const y = (index / this.width) | 0;
        this.updateLiquidDiagonal(x, y, ELEMENTS.WATER, true);
      }
      this.applyLiquidDelta(ELEMENTS.WATER);
    }

    // Build a column surface snapshot after vertical/diagonal movement.
    // The pressure pass uses it only for one-cell downhill surface correction,
    // keeping the solver local while preventing persistent slanted free surfaces.
    this.updateLiquidSurface(ELEMENTS.WATER);

    // Phase 3: supported liquid relaxation. This is a local mass exchange,
    // never a long-range particle move. Only exposed cells participate.
    // The pass budget ramps up over time, while the horizontal solver updates
    // water in place so a pressure change can propagate across a connected
    // surface during the same sweep.
    if (this.waterRelaxationTicks < CONFIG.WATER_RELAXATION_RAMP_TICKS) {
      this.waterRelaxationTicks += 1;
    }
    const rampSpan = CONFIG.WATER_RELAXATION_PASSES_MAX - CONFIG.WATER_RELAXATION_PASSES_MIN;
    const rampTicks = CONFIG.WATER_RELAXATION_RAMP_TICKS;
    const rampProgress = rampTicks > 0 ? this.waterRelaxationTicks / rampTicks : 1;
    const relaxationPasses = CONFIG.WATER_RELAXATION_PASSES_MIN +
      Math.floor(rampSpan * Math.min(1, rampProgress));

    // A horizontal water→oil exchange is allowed once per oil column per
    // physics frame. This keeps horizontal pressure propagation local and
    // prevents the same connected oil body from being repeatedly displaced
    // by successive in-place relaxation passes. Gravity and diagonal water
    // movement still use the full superposition path without this limiter.
    this.waterOilHorizontalComponentLock.fill(0);

    for (let pass = 0; pass < relaxationPasses; pass++) {
      for (let y = this.height - 1; y >= 0; y--) {
        const reverse = ((y + this.frame + pass) & 1) === 1;
        if (reverse) {
          for (let x = this.width - 1; x >= 0; x--) this.updateWaterHorizontal(x, y, pass);
        } else {
          for (let x = 0; x < this.width; x++) this.updateWaterHorizontal(x, y, pass);
        }
      }

      // Flatten one-cell free-surface steps after each local pressure sweep.
      // This uses only adjacent columns, so connected pools settle without
      // introducing long-range relocation.
      this.updateLiquidSurface(ELEMENTS.WATER);
    }
    this.finalizeLiquidStates(ELEMENTS.WATER);
  }

  updateWaterHorizontal(x, y, pass) {
    const i = this.index(x, y);
    if (this.gridType[i] !== ELEMENTS.WATER) return;
    if (this.gridLiquidState[i] === LIQUID_STATES.COLLIDING &&
        pass >= CONFIG.LIQUID_COLLIDING_RELAXATION_PASSES) return;
    const amount = this.gridWaterAmount[i];
    if (amount === 0 || !this.isExposedWater(i, x, y)) return;

    // Actual empty space below wins. Existing liquid below is a collision, so
    // supported water remains eligible for horizontal pressure relaxation.
    if (this.hasOpenWaterSpaceBelow(x, y) || this.hasOpenWaterSpaceDiagonal(x, y)) {
      this.gridLiquidState[i] = LIQUID_STATES.FALLING;
      return;
    }

    const left = x > 0 ? this.index(x - 1, y) : -1;
    const right = x + 1 < this.width ? this.index(x + 1, y) : -1;
    let target = -1;
    let targetAmount = amount;

    if (left >= 0 && this.waterCanReceive(left)) {
      const leftAmount = this.waterRelaxationTargetAmount(left);
      if (leftAmount < targetAmount - CONFIG.LIQUID_EQUILIBRIUM_THRESHOLD) {
        target = left;
        targetAmount = leftAmount;
      }
    }
    if (right >= 0 && this.waterCanReceive(right)) {
      const rightAmount = this.waterRelaxationTargetAmount(right);
      if (rightAmount < targetAmount - CONFIG.LIQUID_EQUILIBRIUM_THRESHOLD) {
        target = right;
        targetAmount = rightAmount;
      }
    }

    if (target < 0 && y === this.waterSurface[x]) {
      const surfaceY = this.waterSurface[x];
      const dir = this.gravityDown ? 1 : -1;
      const targetY = surfaceY + dir;
      let slopeX = -1;
      let slopeSurfaceY = surfaceY;

      if (targetY >= 0 && targetY < this.height) {
        if (x > 0 && this.waterSurface[x - 1] - surfaceY === dir) {
          slopeX = x - 1;
          slopeSurfaceY = this.waterSurface[x - 1];
        }
        if (x + 1 < this.width && this.waterSurface[x + 1] - surfaceY === dir &&
            (slopeX < 0 || this.waterSurface[x + 1] > slopeSurfaceY)) {
          slopeX = x + 1;
        }
      }

      if (slopeX >= 0) {
        const slopeTarget = this.index(slopeX, targetY);
        if (this.waterCanReceive(slopeTarget)) {
          target = slopeTarget;
          targetAmount = this.waterRelaxationTargetAmount(slopeTarget);
        }
      }
    }

    if (target < 0) {
      this.gridLiquidState[i] = LIQUID_STATES.RESTING;
      return;
    }

    const difference = amount - targetAmount;
    if (difference <= CONFIG.LIQUID_EQUILIBRIUM_THRESHOLD) {
      this.gridLiquidState[i] = LIQUID_STATES.RESTING;
      return;
    }

    // A lower-density target uses the same local relaxation decision, but
    // crossing the density boundary requires the target liquid to move one
    // cell upward. There is no separate oil-relaxation branch.
    if (this.gridType[target] === ELEMENTS.OIL) {
      // Horizontal relaxation is a pressure solver, but water→oil exchange
      // is a structural mutation of the oil topology. Treat one connected
      // oil component as one transaction for this water phase instead of
      // allowing each newly exposed column to trigger another mutation.
      if (this.waterOilHorizontalComponentLock[target]) {
        this.gridLiquidState[i] = LIQUID_STATES.RESTING;
        return;
      }
      this.lockWaterOilHorizontalComponent(target);
      if (!this.exchangeWaterOilRelaxation(i, target)) {
        this.gridLiquidState[i] = LIQUID_STATES.RESTING;
        return;
      }
      return;
    }

    const boostedTransfer = Math.floor(
      difference * CONFIG.LIQUID_PRESSURE_TRANSFER_FRACTION
    );
    const transfer = Math.min(
      CONFIG.LIQUID_HORIZONTAL_TRANSFER,
      boostedTransfer > CONFIG.LIQUID_PRESSURE_MIN_TRANSFER
        ? boostedTransfer
        : Math.floor(difference / 2),
      amount,
      CONFIG.LIQUID_FULL_AMOUNT - targetAmount
    );
    if (transfer <= 0) {
      this.gridLiquidState[i] = LIQUID_STATES.RESTING;
      return;
    }

    this.gridWaterAmount[i] -= transfer;
    if (this.gridType[target] === ELEMENTS.ERASER) {
      this.gridType[target] = ELEMENTS.WATER;
      this.gridLiquidState[target] = LIQUID_STATES.FLOWING;
    }
    this.gridWaterAmount[target] += transfer;
    this.gridLiquidState[i] = LIQUID_STATES.FLOWING;

    if (this.gridWaterAmount[i] === 0) {
      this.gridType[i] = ELEMENTS.ERASER;
      this.gridLiquidState[i] = LIQUID_STATES.NONE;
      this.gridVelocity[i] = 0;
    }
  }

  queueLiquidTransfer(source, target, amount, type) {
    const amounts = this.liquidArray(type);
    const transferOut = type === ELEMENTS.WATER ? this.waterTransferOut : this.oilTransferOut;
    const transferIn = type === ELEMENTS.WATER ? this.waterTransferIn : this.oilTransferIn;
    const delta = type === ELEMENTS.WATER ? this.waterDelta : this.oilDelta;
    const available = amounts[source] - transferOut[source];
    const capacity = CONFIG.LIQUID_FULL_AMOUNT - amounts[target] - transferIn[target];
    const transfer = Math.min(amount, available, capacity);
    if (transfer <= 0) return;
    transferOut[source] += transfer;
    transferIn[target] += transfer;
    delta[source] -= transfer;
    delta[target] += transfer;
  }

  applyLiquidDelta(type) {
    const amounts = this.liquidArray(type);
    const delta = type === ELEMENTS.WATER ? this.waterDelta : this.oilDelta;
    for (let i = 0; i < this.size; i++) {
      const change = delta[i];
      if (change === 0) continue;
      let next = amounts[i] + change;
      if (next <= 0) {
        amounts[i] = 0;
        if (this.gridType[i] === type) {
          this.gridType[i] = ELEMENTS.ERASER;
          this.gridLiquidState[i] = LIQUID_STATES.NONE;
          this.gridVelocity[i] = 0;
        }
      } else {
        if (next > CONFIG.LIQUID_FULL_AMOUNT) next = CONFIG.LIQUID_FULL_AMOUNT;
        amounts[i] = next;
        if (this.gridType[i] === ELEMENTS.ERASER) this.gridType[i] = type;
        if (this.gridType[i] === type && this.gridLiquidState[i] === LIQUID_STATES.NONE) this.gridLiquidState[i] = LIQUID_STATES.FLOWING;
      }
    }
  }

  canWaterEnterOil(index, source = -1) {
    if (this.gridType[index] !== ELEMENTS.OIL) return false;

    const x = index % this.width;
    const y = (index / this.width) | 0;
    const dir = this.gravityDown ? -1 : 1;
    let scanY = y + dir;

    // A vertical water/oil interface can advance one layer at a time even
    // when the cell immediately above the target is the water source. In that
    // case the oil simply rises into the source cell while water takes its
    // place. If there are more oil cells above, keep following that local
    // column until it reaches either an empty cell or the source.
    while (this.inBounds(x, scanY)) {
      const scan = this.index(x, scanY);
      if (scan === source) return true;
      const type = this.gridType[scan];
      if (type === ELEMENTS.ERASER) return true;
      if (type !== ELEMENTS.OIL) return false;
      scanY += dir;
    }

    return false;
  }

  waterCanReceive(index) {
    const type = this.gridType[index];
    if (type === ELEMENTS.ERASER || type === ELEMENTS.WATER) return true;
    return type === ELEMENTS.OIL && this.canWaterEnterOil(index);
  }

  waterRelaxationTargetAmount(index) {
    const type = this.gridType[index];
    if (type === ELEMENTS.WATER) return this.gridWaterAmount[index];
    // Oil is lower-density than water, so it is a valid lower-pressure
    // relaxation target once its local column has room to yield upward.
    return 0;
  }

  lockWaterOilHorizontalComponent(start) {
    if (this.gridType[start] !== ELEMENTS.OIL || this.waterOilHorizontalComponentLock[start]) return;

    const queue = this.waterOilHorizontalComponentQueue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    this.waterOilHorizontalComponentLock[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % this.width;
      const y = (index / this.width) | 0;

      if (x > 0) {
        const neighbor = index - 1;
        if (this.gridType[neighbor] === ELEMENTS.OIL && !this.waterOilHorizontalComponentLock[neighbor]) {
          this.waterOilHorizontalComponentLock[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
      if (x + 1 < this.width) {
        const neighbor = index + 1;
        if (this.gridType[neighbor] === ELEMENTS.OIL && !this.waterOilHorizontalComponentLock[neighbor]) {
          this.waterOilHorizontalComponentLock[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
      if (y > 0) {
        const neighbor = index - this.width;
        if (this.gridType[neighbor] === ELEMENTS.OIL && !this.waterOilHorizontalComponentLock[neighbor]) {
          this.waterOilHorizontalComponentLock[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
      if (y + 1 < this.height) {
        const neighbor = index + this.width;
        if (this.gridType[neighbor] === ELEMENTS.OIL && !this.waterOilHorizontalComponentLock[neighbor]) {
          this.waterOilHorizontalComponentLock[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
  }

  exchangeWaterOilRelaxation(source, target) {
    if (this.gridType[source] !== ELEMENTS.WATER || this.gridType[target] !== ELEMENTS.OIL) return false;

    const waterAmount = this.gridWaterAmount[source];
    if (waterAmount <= 0 || !this.canWaterEnterOil(target, source)) return false;

    const x = target % this.width;
    const targetY = (target / this.width) | 0;
    const dir = this.gravityDown ? -1 : 1;

    // Find the first cell above the oil column that can receive the displaced
    // oil. If that cell is the water source itself, this is a true local swap:
    // target oil moves into source and water moves into target. Do not run the
    // generic column-shift loop in that case; doing so would copy the source's
    // water amount as if it were oil and could create an empty/zero-oil cell.
    let yieldY = targetY + dir;
    while (this.inBounds(x, yieldY)) {
      const yieldIndex = this.index(x, yieldY);
      if (yieldIndex === source) break;
      if (this.gridType[yieldIndex] === ELEMENTS.ERASER) break;
      if (this.gridType[yieldIndex] !== ELEMENTS.OIL) return false;
      yieldY += dir;
    }
    if (!this.inBounds(x, yieldY)) return false;

    const yieldIndex = this.index(x, yieldY);
    if (yieldIndex !== source && this.gridType[yieldIndex] !== ELEMENTS.ERASER) return false;

    if (yieldIndex === source) {
      // Direct adjacent swap. The oil amount/state are copied from target,
      // while the water amount/state move into target. Total liquid mass and
      // occupancy are preserved exactly.
      const oilAmount = this.gridOilAmount[target];
      if (oilAmount <= 0) return false;

      this.gridType[source] = ELEMENTS.OIL;
      this.gridOilAmount[source] = oilAmount;
      this.gridWaterAmount[source] = 0;
      this.gridLiquidState[source] = LIQUID_STATES.FLOWING;

      this.gridType[target] = ELEMENTS.WATER;
      this.gridWaterAmount[target] = waterAmount;
      this.gridOilAmount[target] = 0;
      this.gridLiquidState[target] = LIQUID_STATES.FLOWING;

      this.gridUpdated[source] = this.frame;
      this.gridUpdated[target] = this.frame;
      return true;
    }

    // Shift the contiguous oil column one cell toward the empty yield cell.
    // Process from the yield end toward the target so every oil amount is
    // copied before its source cell is overwritten.
    for (let y = yieldY; y !== targetY; y -= dir) {
      const fromY = y - dir;
      const from = this.index(x, fromY);
      const to = this.index(x, y);
      const movedOil = this.gridOilAmount[from];
      if (this.gridType[from] !== ELEMENTS.OIL || movedOil <= 0) return false;

      this.gridType[to] = ELEMENTS.OIL;
      this.gridOilAmount[to] = movedOil;
      this.gridWaterAmount[to] = 0;
      this.gridLiquidState[to] = LIQUID_STATES.FLOWING;
      this.gridUpdated[to] = this.frame;
    }

    // Water occupies the oil's former target cell.
    this.gridType[target] = ELEMENTS.WATER;
    this.gridWaterAmount[target] = waterAmount;
    this.gridOilAmount[target] = 0;
    this.gridLiquidState[target] = LIQUID_STATES.FLOWING;
    this.gridUpdated[target] = this.frame;

    // The water source is genuinely vacated by a non-adjacent exchange. Close
    // that hole immediately from an existing neighbouring water cell when one
    // exists. This is a bounded, mass-conserving local pressure transfer, not
    // a synthetic spawn: the donor keeps at least the renderer's minimum
    // visible amount whenever possible. That prevents a transient black cell
    // inside an otherwise connected liquid body without changing the CA's
    // liquid totals.
    this.gridType[source] = ELEMENTS.ERASER;
    this.gridWaterAmount[source] = 0;
    this.gridOilAmount[source] = 0;
    this.gridLiquidState[source] = LIQUID_STATES.NONE;
    this.gridVelocity[source] = 0;
    this.closeWaterVoid(source);

    this.gridUpdated[yieldIndex] = this.frame;
    return true;
  }

  closeWaterVoid(source) {
    if (this.gridType[source] !== ELEMENTS.ERASER) return;

    const x = source % this.width;
    const y = (source / this.width) | 0;
    const dir = this.gravityDown ? 1 : -1;
    const candidates = [];

    // Prefer a donor that is naturally upstream of the void, then use the
    // horizontal neighbours as a local pressure source. This keeps the repair
    // consistent with the normal gravity-first water pipeline.
    const upstreamY = y - dir;
    if (this.inBounds(x, upstreamY)) candidates.push(this.index(x, upstreamY));
    if (x > 0) candidates.push(this.index(x - 1, y));
    if (x + 1 < this.width) candidates.push(this.index(x + 1, y));
    const downstreamY = y + dir;
    if (this.inBounds(x, downstreamY)) candidates.push(this.index(x, downstreamY));

    let donor = -1;
    let donorAmount = 0;
    for (const index of candidates) {
      if (index === source || this.gridType[index] !== ELEMENTS.WATER) continue;
      const amount = this.gridWaterAmount[index];
      if (amount > donorAmount) {
        donor = index;
        donorAmount = amount;
      }
    }
    if (donor < 0 || donorAmount <= CONFIG.WATER_RENDER_MIN_VISIBLE_AMOUNT) return;

    const minVisible = CONFIG.WATER_RENDER_MIN_VISIBLE_AMOUNT;
    const maxTransfer = Math.min(CONFIG.LIQUID_HORIZONTAL_TRANSFER, donorAmount - minVisible);
    if (maxTransfer <= 0) return;

    this.gridWaterAmount[donor] -= maxTransfer;
    this.gridWaterAmount[source] = maxTransfer;
    this.gridOilAmount[source] = 0;
    this.gridType[source] = ELEMENTS.WATER;
    this.gridLiquidState[source] = LIQUID_STATES.FLOWING;
    this.gridLiquidState[donor] = LIQUID_STATES.FLOWING;

    if (this.gridWaterAmount[donor] <= 0) {
      this.gridWaterAmount[donor] = 0;
      this.gridType[donor] = ELEMENTS.ERASER;
      this.gridLiquidState[donor] = LIQUID_STATES.NONE;
      this.gridVelocity[donor] = 0;
    }
  }

  hasOpenWaterSpaceBelow(x, y) {
    const dir = this.gravityDown ? 1 : -1;
    const ny = y + dir;
    if (!this.inBounds(x, ny)) return false;
    const target = this.index(x, ny);
    return this.gridType[target] === ELEMENTS.ERASER;
  }

  hasOpenWaterSpaceDiagonal(x, y) {
    const dirY = this.gravityDown ? 1 : -1;
    const ny = y + dirY;
    if (ny < 0 || ny >= this.height) return false;

    if (x > 0) {
      const left = this.index(x - 1, ny);
      if (this.gridType[left] === ELEMENTS.ERASER) return true;
    }
    if (x + 1 < this.width) {
      const right = this.index(x + 1, ny);
      if (this.gridType[right] === ELEMENTS.ERASER) return true;
    }
    return false;
  }

  isExposedWater(index, x, y) {
    const above = y + (this.gravityDown ? -1 : 1);
    if (!this.inBounds(x, above)) return true;
    return this.gridType[this.index(x, above)] !== ELEMENTS.WATER;
  }

  liquidAmount(index, type) {
    return type === ELEMENTS.WATER ? this.gridWaterAmount[index] : this.gridOilAmount[index];
  }

  liquidCanReceive(index, type) {
    const target = this.gridType[index];
    return target === ELEMENTS.ERASER || target === type;
  }

  liquidArray(type) {
    return type === ELEMENTS.WATER ? this.gridWaterAmount : this.gridOilAmount;
  }

  liquidSurface(type) {
    return type === ELEMENTS.WATER ? this.waterSurface : this.oilSurface;
  }

  updateLiquidSurface(type) {
    const surface = this.liquidSurface(type);
    surface.fill(this.height);
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const i = this.index(x, y);
        if (this.gridType[i] === type && this.liquidAmount(i, type) > 0) {
          surface[x] = y;
          break;
        }
      }
    }
  }

  updateLiquidGravity(x, y, type) {
    const i = this.index(x, y);
    if (this.gridType[i] !== type) return;
    if (type === ELEMENTS.OIL && this.gridUpdated[i] === this.frame) return;
    const amount = this.liquidAmount(i, type);
    if (type === ELEMENTS.OIL && this.isAdjacentToFire(x, y)) {
      this.igniteOil(i);
      return;
    }
    if (amount === 0) return;

    const dir = this.gravityDown ? 1 : -1;
    const belowY = y + dir;

    if (!this.inBounds(x, belowY)) return;
    const target = this.index(x, belowY);

    // Water has higher density and therefore pushes oil out of its path.
    if (type === ELEMENTS.WATER && this.gridType[target] === ELEMENTS.OIL) {
      this.exchangeWaterOilRelaxation(i, target);
      return;
    }

    // Oil cannot sink through water; water remains the lower-density boundary.
    if (type === ELEMENTS.OIL && this.gridType[target] === ELEMENTS.WATER) return;

    if (!this.liquidCanReceive(target, type)) return;

    const targetAmount = this.liquidAmount(target, type);
    const inBuffer = type === ELEMENTS.WATER ? this.waterTransferIn : this.oilTransferIn;
    const capacity = CONFIG.LIQUID_FULL_AMOUNT - targetAmount - inBuffer[target];
    if (capacity <= 0) return;
    const transfer = Math.min(amount, capacity, CONFIG.LIQUID_FREE_FALL_TRANSFER);
    this.queueLiquidTransfer(i, target, transfer, type);
    this.gridLiquidState[i] = LIQUID_STATES.FALLING;
  }

  updateLiquidDiagonal(x, y, type, queueTarget) {
    const i = this.index(x, y);
    if (this.gridType[i] !== type) return;
    const amount = this.liquidAmount(i, type);
    const dirY = this.gravityDown ? 1 : -1;
    if (amount === 0) return;

    if (this.hasLiquidCapacityBelow(x, y, type)) return;
    const first = ((x * 31 + y * 17 + this.frame * 13) & 1) === 0 ? -1 : 1;
    if (this.tryQueueLiquidDiagonal(i, x + first, y + dirY, amount, type, queueTarget)) {
      this.gridLiquidState[i] = LIQUID_STATES.FLOWING;
      return;
    }
    if (this.tryQueueLiquidDiagonal(i, x - first, y + dirY, amount, type, queueTarget)) {
      this.gridLiquidState[i] = LIQUID_STATES.FLOWING;
      return;
    }
    this.gridLiquidState[i] = LIQUID_STATES.COLLIDING;
  }

  tryQueueLiquidDiagonal(source, x, y, amount, type, queueTarget) {
    if (!this.inBounds(x, y)) return false;
    const target = this.index(x, y);
    if (type === ELEMENTS.WATER && this.gridType[target] === ELEMENTS.OIL) {
      if (!this.exchangeWaterOilRelaxation(source, target)) return false;
      if (queueTarget) this.queueLiquidDiagonalTarget(target, type);
      return true;
    }
    if (!this.liquidCanReceive(target, type)) return false;
    const inBuffer = type === ELEMENTS.WATER ? this.waterTransferIn : this.oilTransferIn;
    const capacity = CONFIG.LIQUID_FULL_AMOUNT - this.liquidAmount(target, type) - inBuffer[target];
    if (capacity <= 0) return false;
    const transfer = Math.min(amount, capacity, CONFIG.LIQUID_DIAGONAL_TRANSFER);
    this.queueLiquidTransfer(source, target, transfer, type);
    if (queueTarget) this.queueLiquidDiagonalTarget(target, type);
    return true;
  }

  queueLiquidDiagonalTarget(target, type) {
    const queue = type === ELEMENTS.WATER ? this.waterDiagonalQueue : this.oilDiagonalQueue;
    let count = type === ELEMENTS.WATER ? this.waterDiagonalQueueCount : this.oilDiagonalQueueCount;
    if (count >= queue.length || this.gridUpdated[target] === this.frame) return;
    queue[count++] = target;
    this.gridUpdated[target] = this.frame;
    if (type === ELEMENTS.WATER) this.waterDiagonalQueueCount = count;
    else this.oilDiagonalQueueCount = count;
  }

  hasLiquidCapacityBelow(x, y, type) {
    const dir = this.gravityDown ? 1 : -1;
    const ny = y + dir;
    if (!this.inBounds(x, ny)) return false;
    const target = this.index(x, ny);
    return this.liquidCanReceive(target, type) && this.liquidAmount(target, type) < CONFIG.LIQUID_FULL_AMOUNT;
  }

  updateOilHorizontal(x, y, pass) {
    const i = this.index(x, y);
    if (this.gridType[i] !== ELEMENTS.OIL) return;
    if (this.gridUpdated[i] === this.frame) return;
    if (this.gridLiquidState[i] === LIQUID_STATES.COLLIDING &&
        pass >= CONFIG.LIQUID_COLLIDING_RELAXATION_PASSES) return;

    const amount = this.gridOilAmount[i];
    if (amount === 0 || !this.isExposedLiquid(i, x, y, ELEMENTS.OIL)) return;

    // Match water's core ordering: gravity/diagonal escape wins over
    // horizontal relaxation. Oil still keeps its own state and transfer path.
    if (this.hasOpenOilSpaceBelow(x, y) || this.hasOpenOilSpaceDiagonal(x, y)) {
      this.gridLiquidState[i] = LIQUID_STATES.FALLING;
      return;
    }

    const surface = this.oilSurface;
    const left = x > 0 ? this.index(x - 1, y) : -1;
    const right = x + 1 < this.width ? this.index(x + 1, y) : -1;
    let target = -1;
    let targetAmount = amount;

    // Oil gets the same local pressure-transfer shape as water, but operates
    // only on oil amounts and oil-receiving cells.
    if (left >= 0 && this.liquidCanReceive(left, ELEMENTS.OIL)) {
      const a = this.gridOilAmount[left];
      if (a < targetAmount - CONFIG.LIQUID_EQUILIBRIUM_THRESHOLD) {
        target = left;
        targetAmount = a;
      }
    }
    if (right >= 0 && this.liquidCanReceive(right, ELEMENTS.OIL)) {
      const a = this.gridOilAmount[right];
      if (a < targetAmount - CONFIG.LIQUID_EQUILIBRIUM_THRESHOLD) {
        target = right;
        targetAmount = a;
      }
    }

    if (target < 0 && y === surface[x]) {
      const dir = this.gravityDown ? 1 : -1;
      const targetY = surface[x] + dir;
      let slopeX = -1;
      let slopeSurfaceY = surface[x];

      if (targetY >= 0 && targetY < this.height) {
        if (x > 0 && surface[x - 1] - surface[x] === dir) {
          slopeX = x - 1;
          slopeSurfaceY = surface[x - 1];
        }
        if (x + 1 < this.width && surface[x + 1] - surface[x] === dir &&
            (slopeX < 0 || surface[x + 1] > slopeSurfaceY)) {
          slopeX = x + 1;
        }
      }

      if (slopeX >= 0) {
        const slopeTarget = this.index(slopeX, targetY);
        if (this.liquidCanReceive(slopeTarget, ELEMENTS.OIL)) {
          target = slopeTarget;
          targetAmount = this.gridOilAmount[slopeTarget];
        }
      }
    }

    if (target < 0) return;
    const difference = amount - targetAmount;
    if (difference <= CONFIG.LIQUID_EQUILIBRIUM_THRESHOLD) return;

    const boostedTransfer = Math.floor(difference * CONFIG.LIQUID_PRESSURE_TRANSFER_FRACTION);
    const transfer = Math.min(
      CONFIG.LIQUID_HORIZONTAL_TRANSFER,
      boostedTransfer > CONFIG.LIQUID_PRESSURE_MIN_TRANSFER
        ? boostedTransfer
        : Math.floor(difference / 2),
      amount,
      CONFIG.LIQUID_FULL_AMOUNT - targetAmount
    );
    if (transfer <= 0) return;

    this.gridOilAmount[i] -= transfer;
    if (this.gridType[target] === ELEMENTS.ERASER) this.gridType[target] = ELEMENTS.OIL;
    this.gridOilAmount[target] += transfer;
    this.gridLiquidState[i] = LIQUID_STATES.FLOWING;
    this.gridLiquidState[target] = LIQUID_STATES.FLOWING;

    if (this.gridOilAmount[i] === 0) {
      this.gridType[i] = ELEMENTS.ERASER;
      this.gridLiquidState[i] = LIQUID_STATES.NONE;
      this.gridVelocity[i] = 0;
    }
  }

  hasOpenOilSpaceBelow(x, y) {
    const dir = this.gravityDown ? 1 : -1;
    const ny = y + dir;
    if (!this.inBounds(x, ny)) return false;
    return this.gridType[this.index(x, ny)] === ELEMENTS.ERASER;
  }

  hasOpenOilSpaceDiagonal(x, y) {
    const dirY = this.gravityDown ? 1 : -1;
    const ny = y + dirY;
    if (ny < 0 || ny >= this.height) return false;

    if (x > 0 && this.gridType[this.index(x - 1, ny)] === ELEMENTS.ERASER) return true;
    if (x + 1 < this.width && this.gridType[this.index(x + 1, ny)] === ELEMENTS.ERASER) return true;
    return false;
  }

  isExposedLiquid(index, x, y, type) {
    const above = y + (this.gravityDown ? -1 : 1);
    if (!this.inBounds(x, above)) return true;
    return this.gridType[this.index(x, above)] !== type;
  }

  flattenOilSurface() {
    const surface = this.oilSurface;
    const locks = this.oilSurfaceLock;
    const amounts = this.gridOilAmount;
    const fullAmount = CONFIG.LIQUID_FULL_AMOUNT;
    const dir = this.gravityDown ? 1 : -1;

    for (let x = 0; x < this.width - 1; x++) {
      const leftSurface = surface[x];
      const rightSurface = surface[x + 1];
      if (leftSurface >= this.height || rightSurface >= this.height) continue;

      const surfaceDifference = rightSurface - leftSurface;
      if (surfaceDifference === 0) continue;

      const highX = surfaceDifference > 0 ? x : x + 1;
      const lowX = surfaceDifference > 0 ? x + 1 : x;
      const highY = surfaceDifference > 0 ? leftSurface : rightSurface;
      const lowY = surfaceDifference > 0 ? rightSurface : leftSurface;

      if (lowY - highY !== dir) continue;

      const source = this.index(highX, highY);
      const target = this.index(lowX, highY);
      if (this.gridType[source] !== ELEMENTS.OIL) continue;
      if (!this.liquidCanReceive(target, ELEMENTS.OIL)) continue;

      // Never flatten an oil surface by vacating a cell whose gravity-side
      // support is water. That would create a one-cell void/notch directly
      // inside the water surface while oil is being relaxed. The void is not
      // an intended liquid transfer; it is an ordering artifact of moving the
      // oil top cell after the water phase has already established its surface.
      const supportY = highY + dir;
      if (this.inBounds(highX, supportY) &&
          this.gridType[this.index(highX, supportY)] === ELEMENTS.WATER) {
        continue;
      }

      const sourceAmount = amounts[source];
      const targetAmount = amounts[target];
      const capacity = fullAmount - targetAmount;
      if (sourceAmount <= 0 || capacity <= 0) continue;

      // Match water's conservative surface correction: only move a complete
      // top cell, and never reuse either column twice in one pass.
      if (capacity < fullAmount || sourceAmount < fullAmount) continue;
      if (locks[highX] !== 0 || locks[lowX] !== 0) continue;

      amounts[source] -= fullAmount;
      if (this.gridType[target] === ELEMENTS.ERASER) this.gridType[target] = ELEMENTS.OIL;
      amounts[target] += fullAmount;
      this.gridLiquidState[source] = LIQUID_STATES.SETTLING;
      this.gridLiquidState[target] = LIQUID_STATES.FLOWING;
      locks[highX] = 1;
      locks[lowX] = 1;

      if (amounts[source] === 0) {
        this.gridType[source] = ELEMENTS.ERASER;
        this.gridLiquidState[source] = LIQUID_STATES.NONE;
        this.gridVelocity[source] = 0;
      }

      surface[highX] = this.gridType[source] === ELEMENTS.OIL ? highY : this.height;
      surface[lowX] = highY;
    }
  }

  updateOilPhase() {
    const yStart = this.gravityDown ? this.height - 1 : 0;
    const yEnd = this.gravityDown ? -1 : this.height;
    const yStep = this.gravityDown ? -1 : 1;

    for (let chainStep = 0; chainStep < CONFIG.OIL_FREE_FALL_CHAIN_STEPS; chainStep++) {
      this.resetLiquidTransferBuffers(ELEMENTS.OIL);
      for (let y = yStart; y !== yEnd; y += yStep) {
        const reverse = ((y + this.frame + chainStep) & 1) === 1;
        if (reverse) {
          for (let x = this.width - 1; x >= 0; x--) this.updateLiquidGravity(x, y, ELEMENTS.OIL);
        } else {
          for (let x = 0; x < this.width; x++) this.updateLiquidGravity(x, y, ELEMENTS.OIL);
        }
      }
      this.applyLiquidDelta(ELEMENTS.OIL);
    }

    this.resetLiquidTransferBuffers(ELEMENTS.OIL);
    this.oilDiagonalQueueCount = 0;
    for (let y = yStart; y !== yEnd; y += yStep) {
      const reverse = ((xorshift(this.frame, y) & 1) === 1);
      if (reverse) {
        for (let x = this.width - 1; x >= 0; x--) this.updateLiquidDiagonal(x, y, ELEMENTS.OIL, true);
      } else {
        for (let x = 0; x < this.width; x++) this.updateLiquidDiagonal(x, y, ELEMENTS.OIL, true);
      }
    }
    this.applyLiquidDelta(ELEMENTS.OIL);

    for (let chainStep = 1; chainStep < CONFIG.OIL_DIAGONAL_CHAIN_STEPS; chainStep++) {
      if (this.oilDiagonalQueueCount === 0) break;
      this.resetLiquidTransferBuffers(ELEMENTS.OIL);
      const queueCount = this.oilDiagonalQueueCount;
      this.oilDiagonalQueueCount = 0;
      for (let q = 0; q < queueCount; q++) {
        const index = this.oilDiagonalQueue[q];
        if (this.gridType[index] !== ELEMENTS.OIL || this.gridOilAmount[index] === 0) continue;
        const x = index % this.width;
        const y = (index / this.width) | 0;
        this.updateLiquidDiagonal(x, y, ELEMENTS.OIL, true);
      }
      this.applyLiquidDelta(ELEMENTS.OIL);
    }

    this.updateLiquidSurface(ELEMENTS.OIL);
    if (this.oilRelaxationTicks < CONFIG.OIL_RELAXATION_RAMP_TICKS) this.oilRelaxationTicks += 1;
    const rampSpan = CONFIG.OIL_RELAXATION_PASSES_MAX - CONFIG.OIL_RELAXATION_PASSES_MIN;
    const rampTicks = CONFIG.OIL_RELAXATION_RAMP_TICKS;
    const rampProgress = rampTicks > 0 ? this.oilRelaxationTicks / rampTicks : 1;
    const relaxationPasses = CONFIG.OIL_RELAXATION_PASSES_MIN +
      Math.floor(rampSpan * Math.min(1, rampProgress));

    for (let pass = 0; pass < relaxationPasses; pass++) {
      for (let y = this.height - 1; y >= 0; y--) {
        const reverse = ((y + this.frame + pass) & 1) === 1;
        if (reverse) {
          for (let x = this.width - 1; x >= 0; x--) this.updateOilHorizontal(x, y, pass);
        } else {
          for (let x = 0; x < this.width; x++) this.updateOilHorizontal(x, y, pass);
        }
      }
      this.updateLiquidSurface(ELEMENTS.OIL);
      this.oilSurfaceLock.fill(0);
      this.flattenOilSurface();
    }
    this.finalizeLiquidStates(ELEMENTS.OIL);
  }

  finalizeLiquidStates(type) {
    const amounts = this.liquidArray(type);
    for (let i = 0; i < this.size; i++) {
      if (this.gridType[i] !== type || amounts[i] === 0) continue;
      const x = i % this.width;
      const y = (i / this.width) | 0;
      if (this.hasLiquidCapacityBelow(x, y, type)) {
        this.gridLiquidState[i] = LIQUID_STATES.FALLING;
      } else if (this.gridLiquidState[i] === LIQUID_STATES.COLLIDING || this.gridLiquidState[i] === LIQUID_STATES.FLOWING) {
        this.gridLiquidState[i] = LIQUID_STATES.SETTLING;
      } else {
        this.gridLiquidState[i] = LIQUID_STATES.RESTING;
      }
    }
  }

  isAdjacentToOil(x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= this.height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx >= 0 && nx < this.width && this.gridType[this.index(nx, ny)] === ELEMENTS.OIL) return true;
      }
    }
    return false;
  }

  isActiveFireForSpread(index) {
    return this.gridType[index] === ELEMENTS.FIRE && this.gridUpdated[index] !== this.frame;
  }

  isAdjacentToFire(x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= this.height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx >= 0 && nx < this.width && this.isActiveFireForSpread(this.index(nx, ny))) return true;
      }
    }
    return false;
  }
  igniteOil(index) {
    if (this.gridType[index] !== ELEMENTS.OIL) return false;
    this.gridType[index] = ELEMENTS.FIRE;
    this.gridAge[index] = CONFIG.FIRE_LIFETIME;
    this.gridOilAmount[index] = 0;
    this.gridLiquidState[index] = LIQUID_STATES.NONE;
    this.gridUpdated[index] = this.frame;
    if (this.fireSpreadQueueCount < this.fireSpreadQueue.length) {
      this.fireSpreadQueue[this.fireSpreadQueueCount++] = index;
    }
    return true;
  }

  processFireSpreadQueue() {
    let queueStart = 0;
    for (let chainStep = 0; chainStep < CONFIG.FIRE_SPREAD_CHAIN_STEPS && queueStart < this.fireSpreadQueueCount; chainStep++) {
      const queueEnd = this.fireSpreadQueueCount;
      while (queueStart < queueEnd) {
        const index = this.fireSpreadQueue[queueStart++];
        if (this.gridType[index] === ELEMENTS.FIRE) this.spreadFireLocally(index);
      }
    }
    this.fireSpreadQueueCount = 0;
  }

  spreadFireLocally(index) {
    const x = index % this.width;
    const y = (index / this.width) | 0;
    if (x > 0) this.igniteOil(index - 1);
    if (x + 1 < this.width) this.igniteOil(index + 1);
    if (y > 0) this.igniteOil(index - this.width);
    if (y + 1 < this.height) this.igniteOil(index + this.width);
  }

  updateFire(x, y) {
    const i = this.index(x, y);
    if (this.gridAge[i] > 0) this.gridAge[i] -= 1;

    // Fire only ignites adjacent oil. Newly ignited cells are queued and
    // processed on the next local propagation step, preventing a single
    // frame from recursively traversing an entire oil body.
    this.spreadFireLocally(i);

    if (this.gridAge[i] === 0) {
      this.gridType[i] = ELEMENTS.ERASER;
      return;
    }

    // A fire cell touching oil acts as a local ignition anchor. Let it keep
    // burning in place so the ignition front can advance through the oil body
    // instead of the fire immediately drifting away from its fuel.
    if (this.isAdjacentToOil(x, y)) return;

    const first = ((x + this.frame) & 1) === 0 ? -1 : 1;
    this.tryMove(x, y, x, y - 1);
    if (this.gridType[i] === ELEMENTS.FIRE) this.tryMove(x, y, x + first, y - 1);
  }
}

function xorshift(a, b) {
  let x = (a ^ (b * 374761393)) | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x | 0;
}
