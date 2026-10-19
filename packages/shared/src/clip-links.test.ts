import assert from "node:assert/strict";
import { test } from "node:test";
import { clipEmbedUrl, clipLinkKey, formatClipClock, parseClipClock, parseClipLink } from "./clip-links.js";

test("liens YouTube : toutes les formes courantes, début lu dans t= ou start=", () => {
  const id = "dQw4w9WgXcQ";
  assert.deepEqual(parseClipLink(`https://www.youtube.com/watch?v=${id}`), { provider: "YOUTUBE", videoId: id, startSec: null });
  assert.deepEqual(parseClipLink(`https://youtu.be/${id}?t=90`), { provider: "YOUTUBE", videoId: id, startSec: 90 });
  assert.deepEqual(parseClipLink(`https://m.youtube.com/watch?v=${id}&t=1m30s`), { provider: "YOUTUBE", videoId: id, startSec: 90 });
  assert.deepEqual(parseClipLink(`https://youtube.com/shorts/${id}`), { provider: "YOUTUBE", videoId: id, startSec: null });
  assert.deepEqual(parseClipLink(`https://www.youtube.com/live/${id}?start=12`), { provider: "YOUTUBE", videoId: id, startSec: 12 });
  assert.equal(parseClipLink("https://www.youtube.com/watch?v=trop-court"), null);
  assert.equal(parseClipLink("https://www.youtube.com/@chaine"), null);
});

test("liens Medal : /clip/, /clips/ et /games/…/clips/", () => {
  assert.deepEqual(parseClipLink("https://medal.tv/clip/jHvqJd5Ylz/vpkPnOp0o"), { provider: "MEDAL", videoId: "jHvqJd5Ylz", startSec: null });
  assert.deepEqual(parseClipLink("https://medal.tv/games/valorant/clips/abc123XYZ/titre?invite=x"), { provider: "MEDAL", videoId: "abc123XYZ", startSec: null });
  assert.deepEqual(parseClipLink("https://medal.tv/fr/games/valorant/clips/nIApC3i0IxFLBra1W"), { provider: "MEDAL", videoId: "nIApC3i0IxFLBra1W", startSec: null });
  assert.deepEqual(parseClipLink("https://medal.tv/games/valorant/clip/nIApC3i0IxFLBra1W"), { provider: "MEDAL", videoId: "nIApC3i0IxFLBra1W", startSec: null });
  assert.equal(parseClipLink("https://medal.tv/users/123"), null);
});

test("moment saisi : secondes, min:s, h:min:s", () => {
  assert.equal(parseClipClock("90"), 90);
  assert.equal(parseClipClock(" 1:30 "), 90);
  assert.equal(parseClipClock("1:02:03"), 3723);
  assert.equal(parseClipClock("1:5x"), null);
  assert.equal(parseClipClock(""), null);
  assert.equal(formatClipClock(90), "1:30");
});

test("autres liens refusés", () => {
  for (const u of ["pas un lien", "https://vimeo.com/123", "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ", "ftp://youtube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)"]) {
    assert.equal(parseClipLink(u), null, u);
  }
});

test("lecteur intégré : passage YouTube borné, Medal sans appel à l'action", () => {
  const yt = new URL(clipEmbedUrl("YOUTUBE", "dQw4w9WgXcQ", 42.7, 20));
  assert.equal(yt.hostname, "www.youtube-nocookie.com");
  assert.equal(yt.searchParams.get("start"), "42");
  assert.equal(yt.searchParams.get("end"), "62");
  assert.equal(yt.searchParams.get("mute"), "0", "avec le son");
  const medal = new URL(clipEmbedUrl("MEDAL", "abc123XYZ", 0, 20));
  assert.equal(medal.pathname, "/games/clips/clip/abc123XYZ", "lecteur intégrable (pas /clip/, redirigé vers l'accueil)");
  assert.equal(medal.searchParams.get("cta"), "0");
  assert.equal(clipLinkKey("YOUTUBE", "dQw4w9WgXcQ", 42.7), "link/youtube/dQw4w9WgXcQ/42");
});
