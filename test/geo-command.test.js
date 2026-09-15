import test from "node:test";
import assert from "node:assert/strict";
import { parseGeoCommand } from "../bot/geo-command.js";

test("Geo visibility commands accept plain and bot-addressed forms", () => {
  assert.equal(parseGeoCommand("/hide"), "hide");
  assert.equal(parseGeoCommand(" /SHOW@shum_bot "), "show");
});

test("Geo visibility commands reject extra text and unrelated messages", () => {
  assert.equal(parseGeoCommand("/hide now"), null);
  assert.equal(parseGeoCommand("show"), null);
  assert.equal(parseGeoCommand(null), null);
});
