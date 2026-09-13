const DESIGN_SIZE = Object.freeze({ width: 390, height: 720 });

// Front-facing local coordinate system shared by all physical monitor planes.
// The four destination corners below are the only values that need adjusting
// when aligning a screen with revised artwork.
export const LOCAL_SCREEN_SIZE = Object.freeze({ width: 133.3333, height: 100 });

export const screenLeft = Object.freeze({
  tl: Object.freeze([87.5, 459.5]),
  tr: Object.freeze([154, 454]),
  br: Object.freeze([156.5, 504.5]),
  bl: Object.freeze([90, 508]),
  contentInset: Object.freeze({ top: 8, right: 8, bottom: 8, left: 8 }),
});

export const screenRight = Object.freeze({
  tl: Object.freeze([235.5, 456]),
  tr: Object.freeze([298.5, 459]),
  br: Object.freeze([298, 508]),
  bl: Object.freeze([235, 505.5]),
  contentInset: Object.freeze({ top: 8, right: 8, bottom: 8, left: 8 }),
});

export const screenBottomRight = Object.freeze({
  tl: Object.freeze([220.5, 575.5]),
  tr: Object.freeze([280.5, 566.5]),
  br: Object.freeze([283, 612]),
  bl: Object.freeze([223.5, 622.5]),
  contentInset: Object.freeze({ top: 8, right: 8, bottom: 8, left: 8 }),
});

const SCREEN_GEOMETRY = Object.freeze({
  days: screenLeft,
  hours: screenRight,
  minutes: screenBottomRight,
});

function quadFromGeometry({ tl, tr, br, bl }) {
  return [tl, tr, br, bl];
}

function solveLinearSystem(coefficients, results) {
  const size = results.length;
  const rows = coefficients.map((row, index) => [...row, results[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;

    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(rows[pivotRow][column]) < 1e-10) {
      throw new Error("Невозможно построить проективную матрицу для вырожденного экрана");
    }

    [rows[column], rows[pivotRow]] = [rows[pivotRow], rows[column]];
    const pivot = rows[column][column];

    for (let index = column; index <= size; index += 1) {
      rows[column][index] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = rows[row][column];

      for (let index = column; index <= size; index += 1) {
        rows[row][index] -= factor * rows[column][index];
      }
    }
  }

  return rows.map((row) => row[size]);
}

export function homographyMatrix(sourceWidth, sourceHeight, targetQuad) {
  const sourceQuad = [
    [0, 0],
    [sourceWidth, 0],
    [sourceWidth, sourceHeight],
    [0, sourceHeight],
  ];
  const coefficients = [];
  const results = [];

  sourceQuad.forEach(([sourceX, sourceY], index) => {
    const [targetX, targetY] = targetQuad[index];

    coefficients.push([
      sourceX,
      sourceY,
      1,
      0,
      0,
      0,
      -targetX * sourceX,
      -targetX * sourceY,
    ]);
    results.push(targetX);

    coefficients.push([
      0,
      0,
      0,
      sourceX,
      sourceY,
      1,
      -targetY * sourceX,
      -targetY * sourceY,
    ]);
    results.push(targetY);
  });

  const [h11, h12, h13, h21, h22, h23, h31, h32] = solveLinearSystem(
    coefficients,
    results,
  );

  // CSS matrix3d is column-major. h31/h32 occupy the projective row,
  // producing a perspective divide instead of an affine approximation.
  return [
    h11,
    h21,
    0,
    h31,
    h12,
    h22,
    0,
    h32,
    0,
    0,
    1,
    0,
    h13,
    h23,
    0,
    1,
  ];
}

function matrixToCss(matrix) {
  const normalized = matrix.map((value) => (Math.abs(value) < 1e-12 ? 0 : value));
  return `matrix3d(${normalized.map((value) => value.toFixed(12)).join(",")})`;
}

function clipPathForQuad(quad) {
  const points = quad.map(
    ([x, y]) => `${((x / DESIGN_SIZE.width) * 100).toFixed(6)}% ${((y / DESIGN_SIZE.height) * 100).toFixed(6)}%`,
  );
  return `polygon(${points.join(",")})`;
}

function setContentInset(surface, contentInset) {
  Object.entries(contentInset).forEach(([side, value]) => {
    surface.style.setProperty(`--timer-content-${side}`, `${value}%`);
  });
}

export class PerspectiveLayout {
  constructor(scene, timerRoot) {
    this.scene = scene;
    this.timerRoot = timerRoot;
    this.screens = new Map();
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.frameRequest = 0;

    timerRoot.querySelectorAll("[data-timer-screen]").forEach((element) => {
      const name = element.dataset.timerScreen;
      const geometry = SCREEN_GEOMETRY[name];

      if (!geometry) {
        return;
      }

      const surface = element.querySelector("[data-timer-surface]");
      surface.style.width = `${LOCAL_SCREEN_SIZE.width}px`;
      surface.style.height = `${LOCAL_SCREEN_SIZE.height}px`;

      if (surface) {
        setContentInset(surface, geometry.contentInset);
      }

      this.screens.set(name, {
        element,
        surface,
        clipElements: [...element.querySelectorAll("[data-timer-clip]")],
        quad: quadFromGeometry(geometry),
      });
    });

    this.handleViewportChange = () => this.requestRefresh();
    this.resizeObserver = "ResizeObserver" in window
      ? new ResizeObserver(this.handleViewportChange)
      : null;
    this.resizeObserver?.observe(scene);
    window.addEventListener("resize", this.handleViewportChange, { passive: true });
    window.addEventListener("orientationchange", this.handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener("resize", this.handleViewportChange, { passive: true });

    this.updateClipPaths();
    this.refresh(true);
  }

  updateClipPaths() {
    this.screens.forEach((screen) => {
      const clipPath = clipPathForQuad(screen.quad);

      screen.clipElements.forEach((element) => {
        element.style.clipPath = clipPath;
        element.style.webkitClipPath = clipPath;
      });
    });
  }

  requestRefresh() {
    if (this.frameRequest) {
      return;
    }

    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.refresh();
    });
  }

  refresh(force = false) {
    const width = this.scene.clientWidth;
    const height = this.scene.clientHeight;

    if (!width || !height || (!force && width === this.lastWidth && height === this.lastHeight)) {
      return;
    }

    this.lastWidth = width;
    this.lastHeight = height;
    const scaleX = width / DESIGN_SIZE.width;
    const scaleY = height / DESIGN_SIZE.height;

    this.screens.forEach((screen) => {
      const targetQuad = screen.quad.map(([x, y]) => [x * scaleX, y * scaleY]);

      screen.surface.style.transform = matrixToCss(
        homographyMatrix(LOCAL_SCREEN_SIZE.width, LOCAL_SCREEN_SIZE.height, targetQuad),
      );
    });
  }

  destroy() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
    }

    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.handleViewportChange);
    window.removeEventListener("orientationchange", this.handleViewportChange);
    window.visualViewport?.removeEventListener("resize", this.handleViewportChange);
  }
}
