const DIGIT_ASSET_URLS = Object.freeze(
  Array.from({ length: 10 }, (_, digit) =>
    new URL(`digits/${String(digit + 1).padStart(3, "0")}.webp`, import.meta.url).href,
  ),
);

function prepareImage(image) {
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  image.setAttribute("aria-hidden", "true");
}

function waitForImage(image) {
  if (image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve(image)
      : Promise.reject(new Error(`Не удалось загрузить изображение: ${image.src}`));
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      resolve(image);
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`Не удалось загрузить изображение: ${image.src}`));
    };

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
  });
}

export function loadImageAsset(image, source) {
  prepareImage(image);

  if (image.dataset.assetSource === source) {
    return waitForImage(image);
  }

  image.dataset.assetSource = source;
  image.src = source;
  return waitForImage(image);
}

export function digitAssetUrl(digit) {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new RangeError(`Некорректная цифра таймера: ${digit}`);
  }

  return DIGIT_ASSET_URLS[digit];
}

export function loadDigitAsset(image, digit) {
  return loadImageAsset(image, digitAssetUrl(digit));
}
