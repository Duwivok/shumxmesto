const MAX_MEDIA_ITEMS = 10;
const BUTTON_MARKER_PATTERN = /\[([^\]\r\n]+)\]/g;

export class AdminPostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdminPostError";
    this.code = code;
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function visibleRichText(node) {
  if (typeof node === "string") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(visibleRichText).join("");
  }
  if (!node || typeof node !== "object") {
    return "";
  }
  if (node.type === "custom_emoji") {
    return node.alternative_text || "";
  }
  if (node.type === "mathematical_expression") {
    return node.expression || "";
  }
  return "text" in node ? visibleRichText(node.text) : "";
}

function sliceRichText(node, start, end) {
  if (end <= start) {
    return "";
  }
  if (typeof node === "string") {
    return node.slice(start, end);
  }
  if (Array.isArray(node)) {
    const result = [];
    let cursor = 0;
    for (const child of node) {
      const length = visibleRichText(child).length;
      const childStart = Math.max(0, start - cursor);
      const childEnd = Math.min(length, end - cursor);
      if (childEnd > childStart) {
        const sliced = sliceRichText(child, childStart, childEnd);
        if (visibleRichText(sliced).length > 0) {
          result.push(sliced);
        }
      }
      cursor += length;
      if (cursor >= end) {
        break;
      }
    }
    return result;
  }
  if (!node || typeof node !== "object") {
    return "";
  }

  const plain = visibleRichText(node);
  if (node.type === "custom_emoji") {
    return start === 0 && end === plain.length
      ? { ...node }
      : plain.slice(start, end);
  }
  if (node.type === "mathematical_expression") {
    return plain.slice(start, end);
  }
  if ("text" in node) {
    return { ...node, text: sliceRichText(node.text, start, end) };
  }
  return plain.slice(start, end);
}

function buttonSafeRichText(node) {
  if (typeof node === "string") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(buttonSafeRichText).filter((part) => visibleRichText(part).length > 0);
  }
  if (!node || typeof node !== "object") {
    return "";
  }
  if (node.type === "custom_emoji" || node.type === "date_time") {
    return { ...node };
  }
  if ("text" in node) {
    return buttonSafeRichText(node.text);
  }
  return visibleRichText(node);
}

function findButtonMarker(text) {
  BUTTON_MARKER_PATTERN.lastIndex = 0;
  const matches = [...text.matchAll(BUTTON_MARKER_PATTERN)];
  if (matches.length === 0) {
    throw new AdminPostError(
      "button-marker-missing",
      "Добавьте маркер [ТЕКСТ КНОПКИ].",
    );
  }
  if (matches.length > 1) {
    throw new AdminPostError(
      "multiple-button-markers",
      "В сообщении должен быть ровно один маркер кнопки.",
    );
  }

  const match = matches[0];
  const rawLabel = match[1];
  const leading = rawLabel.length - rawLabel.trimStart().length;
  const trailing = rawLabel.length - rawLabel.trimEnd().length;
  const labelStart = match.index + 1 + leading;
  const labelEnd = match.index + 1 + rawLabel.length - trailing;
  if (labelEnd <= labelStart) {
    throw new AdminPostError("button-label-empty", "Текст кнопки не может быть пустым.");
  }

  return {
    start: match.index,
    end: match.index + match[0].length,
    labelStart,
    labelEnd,
  };
}

function buttonBlock(text, buttonUrl) {
  return {
    type: "buttons",
    align: "left",
    buttons: [{
      text: buttonSafeRichText(text),
      style: "primary",
      url: buttonUrl,
    }],
  };
}

function entityTags(entity, sourceText) {
  const quoted = (value) => escapeHtml(String(value));
  switch (entity.type) {
    case "bold": return ["<b>", "</b>"];
    case "italic": return ["<i>", "</i>"];
    case "underline": return ["<u>", "</u>"];
    case "strikethrough": return ["<s>", "</s>"];
    case "spoiler": return ["<tg-spoiler>", "</tg-spoiler>"];
    case "code": return ["<code>", "</code>"];
    case "pre": {
      const language = typeof entity.language === "string"
        ? entity.language.replace(/[^A-Za-z0-9_+.-]/g, "").slice(0, 64)
        : "";
      return language
        ? [`<pre><code class="language-${quoted(language)}">`, "</code></pre>"]
        : ["<pre>", "</pre>"];
    }
    case "blockquote": return ["<blockquote>", "</blockquote>"];
    case "expandable_blockquote": return ["<blockquote expandable>", "</blockquote>"];
    case "text_link": return [`<a href="${quoted(entity.url)}">`, "</a>"];
    case "text_mention": return [`<a href="tg://user?id=${quoted(entity.user?.id)}">`, "</a>"];
    case "custom_emoji": return [`<tg-emoji emoji-id="${quoted(entity.custom_emoji_id)}">`, "</tg-emoji>"];
    case "date_time": {
      if (!Number.isSafeInteger(entity.unix_time)) return null;
      const format = typeof entity.date_time_format === "string"
        && /^(?:r|w?[dD]?[tT]?)$/.test(entity.date_time_format)
        ? entity.date_time_format
        : "";
      const formatAttribute = format ? ` format="${quoted(format)}"` : "";
      return [`<tg-time unix="${entity.unix_time}"${formatAttribute}>`, "</tg-time>"];
    }
    case "url": {
      const url = sourceText.slice(entity.offset, entity.offset + entity.length);
      return [`<a href="${quoted(url)}">`, "</a>"];
    }
    default: return null;
  }
}

function renderEntityHtml(text, entities, start, end, { button = false } = {}) {
  const openings = new Map();
  const closings = new Map();
  for (const entity of entities || []) {
    if (button && !["custom_emoji", "date_time"].includes(entity.type)) {
      continue;
    }
    const entityStart = Math.max(start, entity.offset);
    const entityEnd = Math.min(end, entity.offset + entity.length);
    if (entityEnd <= entityStart) {
      continue;
    }
    const tags = entityTags(entity, text);
    if (!tags) {
      continue;
    }
    const item = { start: entityStart, end: entityEnd, open: tags[0], close: tags[1] };
    openings.set(entityStart, [...(openings.get(entityStart) || []), item]);
    closings.set(entityEnd, [...(closings.get(entityEnd) || []), item]);
  }

  for (const items of openings.values()) {
    items.sort((left, right) => right.end - left.end);
  }
  for (const items of closings.values()) {
    items.sort((left, right) => right.start - left.start);
  }

  let html = "";
  for (let index = start; index <= end; index += 1) {
    for (const item of closings.get(index) || []) {
      html += item.close;
    }
    for (const item of openings.get(index) || []) {
      html += item.open;
    }
    if (index < end) {
      const character = text[index];
      html += character === "\n" ? "<br>" : escapeHtml(character);
    }
  }
  return html;
}

function mediaFromMessage(message) {
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = message.photo.at(-1);
    return {
      kind: "photo",
      input: {
        type: "photo",
        media: photo.file_id,
        ...(message.has_media_spoiler ? { has_spoiler: true } : {}),
      },
    };
  }
  if (message.video?.file_id) {
    return {
      kind: "video",
      input: {
        type: "video",
        media: message.video.file_id,
        ...(message.video.width ? { width: message.video.width } : {}),
        ...(message.video.height ? { height: message.video.height } : {}),
        ...(message.video.duration ? { duration: message.video.duration } : {}),
        ...(message.video.supports_streaming ? { supports_streaming: true } : {}),
        ...(message.has_media_spoiler ? { has_spoiler: true } : {}),
      },
    };
  }
  const animation = message.animation
    || (message.document?.mime_type === "image/gif" ? message.document : null);
  if (animation?.file_id) {
    return {
      kind: "animation",
      input: {
        type: "animation",
        media: animation.file_id,
        ...(animation.width ? { width: animation.width } : {}),
        ...(animation.height ? { height: animation.height } : {}),
        ...(animation.duration ? { duration: animation.duration } : {}),
        ...(message.has_media_spoiler ? { has_spoiler: true } : {}),
      },
    };
  }
  return null;
}

function hasUnsupportedMedia(message) {
  const gifDocument = message.document?.mime_type === "image/gif";
  return Boolean(
    message.audio
      || message.checklist
      || message.contact
      || message.dice
      || (message.document && !gifDocument)
      || message.game
      || message.giveaway
      || message.invoice
      || message.live_photo
      || message.location
      || message.paid_media
      || message.poll
      || message.sticker
      || message.story
      || message.video_note
      || message.venue
      || message.voice,
  );
}

function mediaHtml(mediaItems) {
  const tags = mediaItems.map((item, index) => {
    const id = `media_${index + 1}`;
    const spoiler = item.input.has_spoiler ? " tg-spoiler" : "";
    return item.kind === "photo"
      ? `<img src="tg://photo?id=${id}"${spoiler}/>`
      : `<video src="tg://video?id=${id}"${spoiler}></video>`;
  });
  if (tags.length === 0) {
    return "";
  }
  if (tags.length === 1) {
    return tags[0];
  }
  return `<tg-collage>${tags.join("")}</tg-collage>`;
}

function buildFromOrdinaryMessages(messages, buttonUrl) {
  const ordered = [...messages].sort((left, right) => left.message_id - right.message_id);
  if (ordered.some(hasUnsupportedMedia)) {
    throw new AdminPostError(
      "unsupported-media",
      "Поддерживаются только фото, видео и GIF.",
    );
  }
  const textSources = ordered
    .map((message) => ({
      message,
      text: message.text ?? message.caption,
      entities: message.text !== undefined ? message.entities : message.caption_entities,
    }))
    .filter((source) => typeof source.text === "string" && source.text.length > 0);
  if (textSources.length > 1) {
    throw new AdminPostError(
      "multiple-captions",
      "У медиагруппы должна быть одна общая подпись с одним маркером кнопки.",
    );
  }

  const sourcesWithMarker = [];
  for (const source of textSources) {
    try {
      sourcesWithMarker.push({ ...source, marker: findButtonMarker(source.text) });
    } catch (error) {
      if (!(error instanceof AdminPostError) || error.code !== "button-marker-missing") {
        throw error;
      }
    }
  }
  if (sourcesWithMarker.length === 0) {
    throw new AdminPostError("button-marker-missing", "Добавьте маркер [ТЕКСТ КНОПКИ].");
  }
  if (sourcesWithMarker.length > 1) {
    throw new AdminPostError("multiple-button-markers", "В публикации должна быть ровно одна кнопка.");
  }

  const [{ text, entities = [], marker }] = sourcesWithMarker;
  const mediaItems = ordered.map(mediaFromMessage).filter(Boolean);
  if (mediaItems.length > MAX_MEDIA_ITEMS) {
    throw new AdminPostError("too-many-media", `Допускается не больше ${MAX_MEDIA_ITEMS} медиафайлов.`);
  }

  const before = renderEntityHtml(text, entities, 0, marker.start);
  const label = renderEntityHtml(text, entities, marker.labelStart, marker.labelEnd, { button: true });
  const after = renderEntityHtml(text, entities, marker.end, text.length);
  const button = `<tg-button-row align="left"><tg-button type="url" style="primary" url="${escapeHtml(buttonUrl)}">${label}</tg-button></tg-button-row>`;
  const html = [mediaHtml(mediaItems), before, button, after].filter(Boolean).join("");

  return {
    html,
    media: mediaItems.map((item, index) => ({ id: `media_${index + 1}`, media: item.input })),
    skip_entity_detection: false,
  };
}

function splitCaption(caption, state) {
  if (!caption) {
    return { caption: undefined, followingBlocks: [] };
  }

  const plain = visibleRichText(caption.text);
  let marker;
  try {
    marker = findButtonMarker(plain);
  } catch (error) {
    if (error instanceof AdminPostError && error.code === "button-marker-missing") {
      return {
        caption: {
          text: caption.text,
          ...(caption.credit !== undefined ? { credit: caption.credit } : {}),
        },
        followingBlocks: [],
      };
    }
    throw error;
  }

  state.markers += 1;
  const before = sliceRichText(caption.text, 0, marker.start);
  const label = sliceRichText(caption.text, marker.labelStart, marker.labelEnd);
  const after = sliceRichText(caption.text, marker.end, plain.length);
  const followingBlocks = [buttonBlock(label, state.buttonUrl)];
  if (visibleRichText(after).length > 0) {
    followingBlocks.push({ type: "paragraph", text: after });
  }

  return {
    caption: visibleRichText(before).length > 0
      ? {
          text: before,
          ...(caption.credit !== undefined ? { credit: caption.credit } : {}),
        }
      : undefined,
    followingBlocks,
  };
}

function inputMediaFromRichBlock(block) {
  if (block.type === "photo") {
    const photo = Array.isArray(block.photo) ? block.photo.at(-1) : null;
    if (!photo?.file_id) throw new AdminPostError("invalid-photo", "Не удалось прочитать фото.");
    return { type: "photo", media: photo.file_id, ...(block.has_spoiler ? { has_spoiler: true } : {}) };
  }
  if (block.type === "video") {
    if (!block.video?.file_id) throw new AdminPostError("invalid-video", "Не удалось прочитать видео.");
    return {
      type: "video",
      media: block.video.file_id,
      ...(block.video.width ? { width: block.video.width } : {}),
      ...(block.video.height ? { height: block.video.height } : {}),
      ...(block.video.duration ? { duration: block.video.duration } : {}),
      ...(block.video.supports_streaming ? { supports_streaming: true } : {}),
      ...(block.has_spoiler ? { has_spoiler: true } : {}),
    };
  }
  if (block.type === "animation") {
    if (!block.animation?.file_id) throw new AdminPostError("invalid-animation", "Не удалось прочитать GIF.");
    return {
      type: "animation",
      media: block.animation.file_id,
      ...(block.animation.width ? { width: block.animation.width } : {}),
      ...(block.animation.height ? { height: block.animation.height } : {}),
      ...(block.animation.duration ? { duration: block.animation.duration } : {}),
      ...(block.has_spoiler ? { has_spoiler: true } : {}),
    };
  }
  return null;
}

function splitTextBlock(block, state) {
  const plain = visibleRichText(block.text);
  let marker;
  try {
    marker = findButtonMarker(plain);
  } catch (error) {
    if (error instanceof AdminPostError && error.code === "button-marker-missing") {
      return [{ ...block }];
    }
    throw error;
  }
  state.markers += 1;
  const before = sliceRichText(block.text, 0, marker.start);
  const label = sliceRichText(block.text, marker.labelStart, marker.labelEnd);
  const after = sliceRichText(block.text, marker.end, plain.length);
  const result = [];
  if (visibleRichText(before).length > 0) result.push({ ...block, text: before });
  result.push(buttonBlock(label, state.buttonUrl));
  if (visibleRichText(after).length > 0) result.push({ ...block, text: after });
  return result;
}

function convertRichBlocks(blocks, state) {
  const output = [];
  for (const block of blocks || []) {
    if (!block || typeof block !== "object") continue;

    const media = inputMediaFromRichBlock(block);
    if (media) {
      state.media += 1;
      const { caption, followingBlocks } = splitCaption(block.caption, state);
      const converted = {
        type: block.type,
        [block.type]: media,
        ...(caption ? { caption } : {}),
      };
      output.push(converted);
      output.push(...followingBlocks);
      continue;
    }

    if (block.type === "collage" || block.type === "slideshow") {
      const { caption, followingBlocks } = splitCaption(block.caption, state);
      output.push({
        type: block.type,
        blocks: convertRichBlocks(block.blocks, state),
        ...(caption ? { caption } : {}),
      });
      output.push(...followingBlocks);
      continue;
    }
    if (block.type === "blockquote") {
      output.push({
        type: "blockquote",
        blocks: convertRichBlocks(block.blocks, state),
        ...(block.credit !== undefined ? { credit: block.credit } : {}),
      });
      continue;
    }
    if (block.type === "details") {
      output.push({
        type: "details",
        summary: block.summary,
        blocks: convertRichBlocks(block.blocks, state),
        ...(block.is_open ? { is_open: true } : {}),
      });
      continue;
    }
    if (block.type === "list") {
      output.push({
        type: "list",
        items: (block.items || []).map((item) => ({
          blocks: convertRichBlocks(item.blocks, state),
          ...(item.has_checkbox ? { has_checkbox: true } : {}),
          ...(item.is_checked ? { is_checked: true } : {}),
          ...(item.value !== undefined ? { value: item.value } : {}),
          ...(item.type !== undefined ? { type: item.type } : {}),
        })),
        ...(block.ordered ? { ordered: true } : {}),
        ...(block.start !== undefined ? { start: block.start } : {}),
        ...(block.reversed ? { reversed: true } : {}),
      });
      continue;
    }
    if (["audio", "document", "voice_note", "thinking", "buttons"].includes(block.type)) {
      throw new AdminPostError("unsupported-block", `Блок ${block.type} не поддерживается этим скриптом.`);
    }
    if ("text" in block) {
      output.push(...splitTextBlock(block, state));
      continue;
    }
    output.push({ ...block });
  }
  return output;
}

function buildFromRichMessage(message, buttonUrl) {
  const state = { markers: 0, media: 0, buttonUrl };
  const blocks = convertRichBlocks(message.rich_message.blocks, state);
  if (state.markers === 0) {
    throw new AdminPostError("button-marker-missing", "Добавьте маркер [ТЕКСТ КНОПКИ].");
  }
  if (state.markers > 1) {
    throw new AdminPostError("multiple-button-markers", "В публикации должна быть ровно одна кнопка.");
  }
  if (state.media > MAX_MEDIA_ITEMS) {
    throw new AdminPostError("too-many-media", `Допускается не больше ${MAX_MEDIA_ITEMS} медиафайлов.`);
  }
  return {
    blocks,
    ...(message.rich_message.is_rtl ? { is_rtl: true } : {}),
  };
}

export function buildAdminPost(messages, buttonUrl) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AdminPostError("empty-message", "Публикация пуста.");
  }
  if (messages.some((message) => message.rich_message)) {
    if (messages.length !== 1 || !messages[0].rich_message) {
      throw new AdminPostError(
        "mixed-rich-message",
        "Rich Message должен быть отправлен одним сообщением.",
      );
    }
    return buildFromRichMessage(messages[0], buttonUrl);
  }
  return buildFromOrdinaryMessages(messages, buttonUrl);
}

export function isAuthorizedAdminMessage(message, { adminUserId, groupChatId }) {
  return Boolean(
    message
      && String(message.chat?.id) === String(groupChatId)
      && String(message.from?.id) === String(adminUserId)
      && message.from?.is_bot !== true,
  );
}

export const ADMIN_POST_LIMITS = Object.freeze({ maxMediaItems: MAX_MEDIA_ITEMS });
