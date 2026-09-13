import { preloadImageAsset } from "./assets-loader.js?v=20260914words1";

const WORDS = Object.freeze(Object.fromEntries([
  ["days", [["den", "день"], ["dnya", "дня"], ["dney", "дней"]]],
  ["hours", [["chas", "час"], ["chasa", "часа"], ["chasov", "часов"]]],
  ["minutes", [["minuta", "минута"], ["minuty", "минуты"], ["minut", "минут"]]],
].map(([unit, forms]) => [unit, forms.map(([file, text]) => ({
  text,
  source: new URL(`./timer-words/${file}.svg`, import.meta.url).href,
}))])));

export function timerWord(unit, value) {
  const lastTwo = value % 100;
  const last = value % 10;
  const form = lastTwo >= 11 && lastTwo <= 14
    ? 2
    : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2;
  return WORDS[unit][form];
}

export function preloadWordAssets() {
  return Promise.allSettled(Object.values(WORDS).flat().map(
    ({ source }) => preloadImageAsset(source),
  ));
}
