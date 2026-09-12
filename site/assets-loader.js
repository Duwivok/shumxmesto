const DIGIT_ASSET_URLS = Object.freeze(
  Array.from({ length: 10 }, (_, digit) =>
    new URL(`digits/${String(digit + 1).padStart(3, "0")}.webm`, import.meta.url).href,
  ),
);

const GLOW_ASSET_URL = new URL("glow/timer-glow.webm", import.meta.url).href;
const preloadRequests = new Map();

function prepareVideo(video) {
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.preload = "auto";
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.controls = false;
  video.tabIndex = -1;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("aria-hidden", "true");
}

function waitForCurrentFrame(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve(video);
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
    };
    const handleLoadedData = () => {
      cleanup();
      resolve(video);
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`Не удалось загрузить видео-ассет: ${video.currentSrc || video.src}`));
    };

    video.addEventListener("loadeddata", handleLoadedData, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

function loadVideoSource(video, source) {
  prepareVideo(video);

  if (video.dataset.assetSource === source) {
    return waitForCurrentFrame(video);
  }

  video.dataset.assetSource = source;
  video.src = source;
  video.load();

  return waitForCurrentFrame(video);
}

export function digitAssetUrl(digit) {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new RangeError(`Некорректная цифра таймера: ${digit}`);
  }

  return DIGIT_ASSET_URLS[digit];
}

export function loadDigitAsset(video, digit) {
  return loadVideoSource(video, digitAssetUrl(digit));
}

export function loadGlowAsset(video) {
  return loadVideoSource(video, GLOW_ASSET_URL);
}

function preloadVideoAsset(source) {
  if (preloadRequests.has(source)) {
    return preloadRequests.get(source);
  }

  const video = document.createElement("video");
  prepareVideo(video);
  video.src = source;
  video.load();

  const request = waitForCurrentFrame(video).finally(() => {
    video.removeAttribute("src");
    video.load();
  });

  preloadRequests.set(source, request);
  return request;
}

export function preloadDigitAssets() {
  return Promise.allSettled(DIGIT_ASSET_URLS.map(preloadVideoAsset));
}

export function playVideo(video) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  const request = video.play();
  request?.catch(() => {
    // Muted inline video normally autoplays. A later user gesture/page activation
    // retries playback through the timer controller if the WebView blocks it.
  });
}
