const LAYOUT_URL = new URL("./glass-overlays-v6/layout.json", import.meta.url);

// Front-facing local coordinate system shared by all physical monitor planes.
// All destination corners and glass bounds come from the supplied layout.json.
export const LOCAL_SCREEN_SIZE = Object.freeze({ width: 133.3333, height: 100 });

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

function clipPathForQuad(quad, designSize) {
  const points = quad.map(
    ([x, y]) => `${((x / designSize.width) * 100).toFixed(6)}% ${((y / designSize.height) * 100).toFixed(6)}%`,
  );
  return `polygon(${points.join(",")})`;
}

export class PerspectiveLayout {
  constructor(scene, timerRoot) {
    this.scene = scene;
    this.timerRoot = timerRoot;
    this.screens = new Map();
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.frameRequest = 0;
    this.destroyed = false;
    this.glow = timerRoot.querySelector("[data-timer-glow]");

    this.handleViewportChange = () => this.requestRefresh();
    this.resizeObserver = "ResizeObserver" in window
      ? new ResizeObserver(this.handleViewportChange)
      : null;
    this.resizeObserver?.observe(scene);
    window.addEventListener("resize", this.handleViewportChange, { passive: true });
    window.addEventListener("orientationchange", this.handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener("resize", this.handleViewportChange, { passive: true });

    this.ready = this.loadLayout().catch((error) => {
      console.error("Не удалось загрузить геометрию экранов таймера", error);
    });
  }

  async loadLayout() {
    const response = await fetch(LAYOUT_URL);
    if (!response.ok) {
      throw new Error(`layout.json: HTTP ${response.status}`);
    }
    const layout = await response.json();
    if (this.destroyed) {
      return;
    }
    this.designSize = layout.stage;
    // The existing halo movie was drawn around the previous monitor layout.
    // Its registration is retained in v6; this transform applies only to
    // the shared light source, never to the already projected glass PNGs.
    this.glowRegistration = layout.screens.find((screen) => screen.unit === "minutes")
      ?.reconstruction?.matrix_row_vector;

    this.timerRoot.querySelectorAll("[data-timer-screen]").forEach((element) => {
      const name = element.dataset.timerScreen;
      const geometry = layout.screens.find((screen) => screen.unit === name);
      if (!geometry) {
        throw new Error(`В layout.json отсутствует экран ${name}`);
      }
      const surfaces = [...element.querySelectorAll("[data-timer-surface]")];
      surfaces.forEach((surface) => {
        surface.style.width = `${LOCAL_SCREEN_SIZE.width}px`;
        surface.style.height = `${LOCAL_SCREEN_SIZE.height}px`;
      });
      const clipPath = clipPathForQuad(geometry.corners, this.designSize);
      element.querySelectorAll("[data-timer-clip]").forEach((clip) => {
        clip.style.clipPath = clipPath;
        clip.style.webkitClipPath = clipPath;
      });
      const glass = element.querySelector("[data-timer-glass]");
      glass.src = new URL(geometry.web, LAYOUT_URL).href;
      Object.entries(geometry.css_percent).forEach(([property, value]) => {
        glass.style[property] = `${value}%`;
      });
      this.screens.set(name, { element, surfaces, quad: geometry.corners });
    });
    this.updateGlowMask();
    this.refresh(true);
    this.timerRoot.dataset.layoutReady = "true";
  }

  updateGlowMask() {
    const mask = this.timerRoot.querySelector("[data-timer-glow-mask]");
    if (!mask || !this.glowRegistration) {
      return;
    }

    // Express the actual v6 screen contours in the glow movie's local frame.
    // Its existing registration then brings the mask back to the exact same
    // scene corners as the digits and glass, including after a resize.
    const [[a, b], [c, d], [e, f]] = this.glowRegistration;
    const determinant = a * d - b * c;
    const polygons = [...this.screens.values()].map(({ quad }) => {
      const points = quad.map(([x, y]) => {
        const localX = (d * (x - e) - c * (y - f)) / determinant;
        const localY = (a * (y - f) - b * (x - e)) / determinant - 419.5;
        return `${localX.toFixed(6)},${localY.toFixed(6)}`;
      });
      return `<polygon points="${points.join(" ")}" fill="white"/>`;
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="240" viewBox="0 0 390 240">${polygons.join("")}</svg>`;
    mask.setAttribute("href", `data:image/svg+xml,${encodeURIComponent(svg)}`);
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
    // Keep subpixel dimensions: integer clientWidth/clientHeight can shift the
    // projected digits relative to percentage-positioned glass on small screens.
    const { width, height } = this.scene.getBoundingClientRect();

    if (!this.designSize || !width || !height || (!force && width === this.lastWidth && height === this.lastHeight)) {
      return;
    }

    this.lastWidth = width;
    this.lastHeight = height;
    const scaleX = width / this.designSize.width;
    const scaleY = height / this.designSize.height;

    this.screens.forEach((screen) => {
      const targetQuad = screen.quad.map(([x, y]) => [x * scaleX, y * scaleY]);

      const transform = matrixToCss(
        homographyMatrix(LOCAL_SCREEN_SIZE.width, LOCAL_SCREEN_SIZE.height, targetQuad),
      );
      screen.surfaces.forEach((surface) => { surface.style.transform = transform; });
    });

    if (this.glow && this.glowRegistration) {
      const [[a, b], [c, d], [e, f]] = this.glowRegistration;
      // The 780 × 480 movie occupied x=0, y=419.5, w=390, h=240.
      this.glow.style.transform = `matrix(${a * scaleX},${b * scaleY},${c * scaleX},${d * scaleY},${(e + c * 419.5) * scaleX},${(f + d * 419.5) * scaleY})`;
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
    }

    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.handleViewportChange);
    window.removeEventListener("orientationchange", this.handleViewportChange);
    window.visualViewport?.removeEventListener("resize", this.handleViewportChange);
  }
}
