import test from "node:test";
import assert from "node:assert/strict";
import {
  AdminPostError,
  buildAdminPost,
  isAuthorizedAdminMessage,
} from "../bot/admin-post.js";

const BUTTON_URL = "https://t.me/example_bot?startapp=home";

test("ordinary formatting and a custom emoji survive around and inside the button", () => {
  const text = "Жирный\n[🔥 ИДУ]\nЦитата";
  const post = buildAdminPost([{
    message_id: 1,
    text,
    entities: [
      { type: "bold", offset: 0, length: 6 },
      { type: "custom_emoji", offset: 8, length: 2, custom_emoji_id: "emoji-1" },
      { type: "blockquote", offset: 16, length: 6 },
    ],
  }], BUTTON_URL);

  assert.match(post.html, /<b>Жирный<\/b>/);
  assert.match(post.html, /<tg-button-row/);
  assert.match(post.html, /<tg-emoji emoji-id="emoji-1">🔥<\/tg-emoji> ИДУ/);
  assert.match(post.html, /<blockquote>Цитата<\/blockquote>/);
  assert.doesNotMatch(post.html, /\[|\]/);
});

test("up to ten photos, videos, and animations reuse their Telegram file IDs", () => {
  const messages = [
    { message_id: 1, photo: [{ file_id: "small" }, { file_id: "photo-file" }], caption: "[Открыть]" },
    { message_id: 2, video: { file_id: "video-file", width: 720, height: 1280, duration: 4 } },
    { message_id: 3, animation: { file_id: "gif-file", width: 640, height: 640, duration: 2 } },
  ];
  const post = buildAdminPost(messages, BUTTON_URL);

  assert.match(post.html, /^<tg-collage>/);
  assert.deepEqual(post.media.map((item) => item.media.media), [
    "photo-file",
    "video-file",
    "gif-file",
  ]);
  assert.deepEqual(post.media.map((item) => item.media.type), ["photo", "video", "animation"]);
});

test("more than ten media items are rejected", () => {
  const messages = Array.from({ length: 11 }, (_, index) => ({
    message_id: index + 1,
    photo: [{ file_id: `photo-${index}` }],
    ...(index === 0 ? { caption: "[Открыть]" } : {}),
  }));
  assert.throws(
    () => buildAdminPost(messages, BUTTON_URL),
    (error) => error instanceof AdminPostError && error.code === "too-many-media",
  );
});

test("unsupported attachments are rejected instead of being silently dropped", () => {
  assert.throws(
    () => buildAdminPost([{
      message_id: 1,
      document: { file_id: "pdf-file", mime_type: "application/pdf" },
      caption: "[Открыть]",
    }], BUTTON_URL),
    (error) => error instanceof AdminPostError && error.code === "unsupported-media",
  );
});

test("multiple album captions are rejected instead of losing text", () => {
  assert.throws(
    () => buildAdminPost([
      { message_id: 1, photo: [{ file_id: "one" }], caption: "[Открыть]" },
      { message_id: 2, photo: [{ file_id: "two" }], caption: "Вторая подпись" },
    ], BUTTON_URL),
    (error) => error instanceof AdminPostError && error.code === "multiple-captions",
  );
});

test("rich-message blocks preserve custom emoji and media while inserting the button", () => {
  const post = buildAdminPost([{
    message_id: 1,
    rich_message: {
      blocks: [
        { type: "paragraph", text: { type: "bold", text: "До" } },
        {
          type: "paragraph",
          text: ["[", { type: "custom_emoji", custom_emoji_id: "emoji-2", alternative_text: "✨" }, " ВОЙТИ]\nПосле"],
        },
        { type: "photo", photo: [{ file_id: "small" }, { file_id: "rich-photo" }] },
      ],
    },
  }], BUTTON_URL);

  assert.equal(post.blocks[0].text.type, "bold");
  assert.equal(post.blocks[1].type, "buttons");
  assert.deepEqual(post.blocks[1].buttons[0].text, [
    { type: "custom_emoji", custom_emoji_id: "emoji-2", alternative_text: "✨" },
    " ВОЙТИ",
  ]);
  assert.deepEqual(post.blocks[2].text, ["\nПосле"]);
  assert.equal(post.blocks[3].photo.media, "rich-photo");
});

test("the button marker may be inline between surrounding text", () => {
  const post = buildAdminPost([{
    message_id: 1,
    text: "До [ОТКРЫТЬ] после",
  }], BUTTON_URL);

  assert.match(post.html, /^До <tg-button-row/);
  assert.match(post.html, /<\/tg-button-row> после$/);
});

test("Telegram date-time formatting survives inside a button", () => {
  const text = "[19 сентября]";
  const post = buildAdminPost([{
    message_id: 1,
    text,
    entities: [{
      type: "date_time",
      offset: 1,
      length: 11,
      unix_time: 1789851540,
      date_time_format: "dT",
    }],
  }], BUTTON_URL);

  assert.match(post.html, /<tg-time unix="1789851540" format="dT">19 сентября<\/tg-time>/);
});

test("a rich-media caption may contain the button and custom emoji", () => {
  const post = buildAdminPost([{
    message_id: 1,
    rich_message: {
      blocks: [{
        type: "animation",
        animation: { file_id: "rich-gif" },
        caption: {
          text: ["До [", {
            type: "custom_emoji",
            custom_emoji_id: "emoji-3",
            alternative_text: "🔥",
          }, " ПУСК] после"],
        },
      }],
    },
  }], BUTTON_URL);

  assert.equal(post.blocks[0].animation.media, "rich-gif");
  assert.deepEqual(post.blocks[0].caption.text, ["До "]);
  assert.equal(post.blocks[1].type, "buttons");
  assert.deepEqual(post.blocks[1].buttons[0].text, [
    { type: "custom_emoji", custom_emoji_id: "emoji-3", alternative_text: "🔥" },
    " ПУСК",
  ]);
  assert.deepEqual(post.blocks[2], { type: "paragraph", text: [" после"] });
});

test("only the configured administrator in the configured group is accepted", () => {
  const config = { adminUserId: "42", groupChatId: "-100500" };
  assert.equal(isAuthorizedAdminMessage({
    chat: { id: -100500 },
    from: { id: 42, is_bot: false },
  }, config), true);
  assert.equal(isAuthorizedAdminMessage({
    chat: { id: -100500 },
    from: { id: 43, is_bot: false },
  }, config), false);
  assert.equal(isAuthorizedAdminMessage({
    chat: { id: -100501 },
    from: { id: 42, is_bot: false },
  }, config), false);
});
