const DESIGN_SIZE = Object.freeze({ width: 390, height: 720 });

// Fallbacks mirror the current SVG files and keep the timer usable on file://,
// where browsers can block fetch() for local SVGs.
const SCREEN_DEFINITIONS = Object.freeze({
  days: Object.freeze({
    maskUrl: new URL("mask-timer/timer-days-mask.svg", import.meta.url).href,
    quad: Object.freeze([
      [97, 436.5],
      [166.5, 433],
      [168.5, 492],
      [98.5, 494],
    ]),
  }),
  hours: Object.freeze({
    maskUrl: new URL("mask-timer/timer-hours-mask.svg", import.meta.url).href,
    quad: Object.freeze([
      [229, 436],
      [288, 437],
      [289, 493.5],
      [230, 497.5],
    ]),
  }),
  minutes: Object.freeze({
    maskUrl: new URL("mask-timer/timer-minutes-mask.svg", import.meta.url).href,
    quad: Object.freeze([
      [214, 533.5],
      [279.5, 528.5],
      [279, 584],
      [213.5, 594.5],
    ]),
  }),
});

function orderQuad(points) {
  const bySum = [...points].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const byDifference = [...points].sort((a, b) => a[0] - a[1] - (b[0] - b[1]));

  return [bySum[0], byDifference.at(-1), bySum.at(-1), byDifference[0]];
}

function extractQuad(svgText) {
  const svg = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const pathData = svg.querySelector("path")?.getAttribute("d") ?? "";
  const pointPattern = /[ML]\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*[, ]\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;
  const points = [...pathData.matchAll(pointPattern)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);

  if (
    points.length > 1
    && points[0][0] === points.at(-1)[0]
    && points[0][1] === points.at(-1)[1]
  ) {
    points.pop();
  }

  if (points.length !== 4 || points.flat().some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error("Маска экрана должна содержать четырёхточечный M/L path");
  }

  return orderQuad(points);
}

async function loadMaskQuad(maskUrl) {
  const response = await fetch(maskUrl);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} при загрузке ${maskUrl}`);
  }

  return extractQuad(await response.text());
}

function homographyMatrix(sourceWidth, sourceHeight, targetQuad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = targetQuad;
  const deltaX1 = x1 - x2;
  const deltaX2 = x3 - x2;
  const deltaX3 = x0 - x1 + x2 - x3;
  const deltaY1 = y1 - y2;
  const deltaY2 = y3 - y2;
  const deltaY3 = y0 - y1 + y2 - y3;
  const denominator = deltaX1 * deltaY2 - deltaX2 * deltaY1;

  if (Math.abs(denominator) < 1e-9) {
    throw new Error("Невозможно построить проекцию для вырожденного четырёхугольника");
  }

  const projectiveX = (deltaX3 * deltaY2 - deltaX2 * deltaY3) / denominator;
  const projectiveY = (deltaX1 * deltaY3 - deltaX3 * deltaY1) / denominator;
  const scaleX = x1 - x0 + projectiveX * x1;
  const shearX = x3 - x0 + projectiveY * x3;
  const scaleY = y1 - y0 + projectiveX * y1;
  const shearY = y3 - y0 + projectiveY * y3;

  // CSS matrix3d is column-major. These coefficients embed the 3×3 planar
  // homography so the perspective divide maps every source corner to its mask.
  return [
    scaleX / sourceWidth,
    scaleY / sourceWidth,
    0,
    projectiveX / sourceWidth,
    shearX / sourceHeight,
    shearY / sourceHeight,
    0,
    projectiveY / sourceHeight,
    0,
    0,
    1,
    0,
    x0,
    y0,
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
      const definition = SCREEN_DEFINITIONS[name];

      if (!definition) {
        return;
      }

      this.screens.set(name, {
        element,
        surface: element.querySelector("[data-timer-surface]"),
        glowSurface: element.querySelector("[data-timer-glow-surface]"),
        clipElements: [...element.querySelectorAll("[data-timer-clip]")],
        quad: definition.quad.map((point) => [...point]),
        maskUrl: definition.maskUrl,
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
    this.loadMaskGeometry();
  }

  async loadMaskGeometry() {
    await Promise.all(
      [...this.screens.values()].map(async (screen) => {
        try {
          screen.quad = await loadMaskQuad(screen.maskUrl);
        } catch (error) {
          console.warn("Используется встроенная геометрия timer-маски", error);
        }
      }),
    );

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
      screen.element.dataset.maskSource = screen.maskUrl;
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
      [screen.surface, screen.glowSurface].forEach((surface) => {
        if (!surface) {
          return;
        }

        surface.style.transform = matrixToCss(
          homographyMatrix(surface.offsetWidth, surface.offsetHeight, targetQuad),
        );
      });
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
