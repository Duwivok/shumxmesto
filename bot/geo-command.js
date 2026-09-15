const GEO_COMMAND_PATTERN = /^\/(hide|show)(?:@[a-z0-9_]+)?$/i;

export function parseGeoCommand(text) {
  if (typeof text !== "string") {
    return null;
  }

  return text.trim().match(GEO_COMMAND_PATTERN)?.[1].toLowerCase() || null;
}
