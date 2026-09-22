import { useState, useRef, useEffect, useMemo } from "react";

/**
 * Contact page — "Beacon" concept.
 * The idea: reaching support should feel like sending up a signal and
 * getting a light back. Deep teal ground, amber beacon accent, pulsing
 * rings as the signature motif instead of a generic hero graphic.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 600;
// How tall the message box is allowed to get before it starts scrolling
// instead. Six hundred characters is about ten lines of prose, which fits
// comfortably under this; the cap is really there for the message that is
// mostly line breaks, so a list of steps to reproduce cannot push the send
// button off the bottom of the screen.
const MESSAGE_BOX_MAX = 320;
const FIELD_ORDER = ["topic", "name", "email", "message"];
const FIELD_LABELS = {
  topic: "the topic",
  name: "your name",
  email: "your email",
  message: "your message",
};
const DRAFT_KEY = "beacon.contact-draft";
const SENT_KEY = "beacon.contact-sent";
// Enough to cover the reason someone is looking — the message they sent last
// week and cannot find the confirmation for. Past that it is history, and
// history belongs in the inbox rather than on the form.
const MAX_SENT = 5;

// How long a discarded draft is held before it is really gone. Long enough
// to press the wrong button, read the empty form, and understand what
// happened; short enough that it is not still offering to undo something
// from several minutes ago by the time the replacement is written.
const UNDO_SECONDS = 20;
const EMPTY_VALUES = { topic: "", name: "", email: "", message: "" };

// Named the way the keyboard in front of the sender names it. Read once:
// the platform does not change while the page is open.
const SEND_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "")
    ? "⌘ Enter"
    : "Ctrl Enter";

// Attachments. A screenshot answers "what does the error look like" faster
// than any three paragraphs, so the form takes images and PDFs — capped
// because a support desk inbox is not a file host.
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Says what is wrong with one file, or nothing if it is fine. The type check
// leans on the browser's sniffing rather than the extension, which is the
// half a renamed .exe cannot lie about as easily.
function fileProblem(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return `${file.name} isn't an image or PDF.`;
  }

  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}.`;
  }

  return "";
}

// A mistyped address is the one mistake on this form that cannot be
// recovered from. Everything else either fails loudly - an empty field, a
// file too large - or costs the desk a round trip. A reply sent to
// jordan@gmial.com simply never arrives, and the sender is left believing
// they were ignored.
//
// So the domains people actually use, and the ones they land on by accident
// while typing them.
const KNOWN_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "outlook.co.uk", "live.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com", "mail.com",
  "gmx.com", "zoho.com", "yandex.com", "comcast.net", "qq.com",
];

// Typos in the last label are worth catching on any domain, not just the
// popular ones: "acme-industrial.con" is as undeliverable as "gmial.com" and
// no list of providers will ever contain it. Only misspellings that are not
// themselves real suffixes go in here — .co and .cm are both somebody's
// country, and correcting them would break addresses that were right.
const TLD_TYPOS = {
  con: "com", cmo: "com", comm: "com", ocm: "com", clm: "com", cpm: "com",
  xom: "com", vom: "com", con1: "com", nte: "net", nett: "net", ner: "net",
  orgg: "org", ogr: "org", rog: "org", eud: "edu",
};

// How many single-character slips turn one string into the other, giving up
// as soon as the answer is past `limit` — the callers only care about "close
// enough to be a slip", and the full table is wasted work on two strings
// that share nothing.
//
// Swapping two neighbours counts as one slip, not two. Plain Levenshtein
// scores "gmial" two edits from "gmail" and would need the limit doubled to
// catch it — which would also let through every domain genuinely two letters
// away from a provider. Transposition is the most common typing mistake
// there is, and it deserves to be counted as the single mistake it is.
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let beforePrevious = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
      }

      best = Math.min(best, current[j]);
    }

    // Every remaining row can only add to the best score on this one, so a
    // row already past the limit settles it.
    if (best > limit) return limit + 1;

    beforePrevious = previous;
    previous = current;
  }

  return previous[b.length];
}

// The address the sender probably meant, or "" if this one looks fine.
//
// Silence is the default and the important case: this runs on every address
// anyone types, and a form that second-guesses a correct one is worse than a
// form that says nothing. So a domain that is already known is left alone,
// and so is anything more than a slip away from one — two edits from
// gmail.com is as likely to be a small company nobody here has heard of.
export function suggestEmail(email) {
  const address = String(email || "").trim();
  const at = address.lastIndexOf("@");

  if (at < 1) return "";

  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase();

  if (!domain || KNOWN_DOMAINS.includes(domain)) return "";

  const labels = domain.split(".");
  const tld = labels[labels.length - 1];

  // The last label first, because it is the one mistake that can happen to
  // a domain nobody could have listed.
  if (labels.length > 1 && TLD_TYPOS[tld]) {
    return `${local}@${labels.slice(0, -1).join(".")}.${TLD_TYPOS[tld]}`;
  }

  // Then the provider itself. Distance is allowed to grow with the name so
  // that "gmial" is caught without "aol.com" swallowing every four-letter
  // domain that happens to rhyme with it.
  const limit = domain.length > 10 ? 2 : 1;
  let best = "";
  let bestDistance = limit + 1;

  for (const known of KNOWN_DOMAINS) {
    const distance = editDistance(domain, known, limit);

    if (distance > 0 && distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }

  return best ? `${local}@${best}` : "";
}

// Everything lands in the same inbox today, but saying which desk picks it up
// — and how quickly — sets a truthful expectation before anyone hits send.
// Each desk opens with the same question, and it is always the one the
// sender could have answered in the first message. `prompt` asks it inside
// the box; `hint` says what turns a reply into an answer rather than a
// request for more detail.
const TOPICS = [
  {
    id: "support",
    label: "Support",
    desk: "our support team",
    replyMinutes: 5,
    prompt: "What went wrong, and what were you doing when it happened?",
    hint: "Any error message and the page you were on save us a round trip.",
  },
  {
    id: "sales",
    label: "Sales",
    desk: "our sales team",
    replyMinutes: 60,
    prompt: "What are you trying to do, and how big is the team?",
    hint: "Team size and rough timeline let us quote properly the first time.",
  },
  {
    id: "feedback",
    label: "Feedback",
    desk: "our product team",
    // A business day is the desk's day, not twenty-four hours: nine to six
    // is nine hours, and counting the night would promise an answer at 3am.
    replyMinutes: 9 * 60,
    prompt: "What would you change, and what made you want it changed?",
    hint: "The moment that prompted this is worth more to us than the fix you have in mind.",
  },
  {
    id: "other",
    label: "Something else",
    desk: "our team",
    replyMinutes: 9 * 60,
    prompt: "What can we help with?",
    hint: "",
  },
];

const DEFAULT_PROMPT = "What can we help with?";

// The words that say which desk a message actually belongs to.
//
// Picking the topic is the first thing this form asks and the last thing
// anyone thinks about: the button at the top gets pressed before the message
// underneath it has been written, and by the end the message is often about
// something else entirely. A pricing question filed under Support waits in
// the wrong queue, gets forwarded, and the five-minute promise made at the
// top of the page quietly becomes tomorrow.
//
// Nobody is being told they are wrong. This is the same offer the email
// field already makes: here is what it looks like from here, take it or
// leave it.
//
// Phrases as well as single words, because "log in" and "purchase order"
// each say more than either half of them does.
const TOPIC_WORDS = {
  support: [
    "error", "errors", "broken", "bug", "bugs", "crash", "crashes", "crashed",
    "not working", "doesn't work", "does not work", "stopped working", "failing",
    "failed", "stuck", "log in", "login", "sign in", "password", "reset",
    "timeout", "500", "404", "unable to", "can't access", "cannot access",
  ],
  sales: [
    "price", "prices", "pricing", "quote", "cost", "costs", "invoice", "billing",
    "billed", "plan", "plans", "upgrade", "downgrade", "seats", "licence",
    "license", "trial", "enterprise", "contract", "renewal", "discount",
    "purchase order", "demo", "subscription", "per month", "per user",
  ],
  feedback: [
    "suggestion", "suggest", "feature request", "would be nice", "would be great",
    "wish", "idea", "ideas", "improve", "improvement", "roadmap", "feedback",
    "it would help if", "please add", "why can't i", "why cannot i",
  ],
};

// Whole words only, so "plan" does not match "explanation" and "500" does not
// match "1500". Built once — these lists do not change while the page is
// open, and rebuilding a few dozen regexes on every keystroke would be work
// done for nothing.
const TOPIC_PATTERNS = Object.entries(TOPIC_WORDS).map(([id, words]) => [
  id,
  words.map((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")),
]);

// How many distinct signals it takes before the form says anything. One is a
// coincidence — "there is a bug in your pricing page" is a support message
// that says "pricing" — and a form that second-guesses on one word is a form
// people learn to ignore.
const TOPIC_CONFIDENCE = 2;

// The desk this message reads like it is for, or "" if the one already
// picked is as good an answer as any.
//
// Silence is the default and the important case. A suggestion only appears
// when another desk beats the chosen one outright and clears the bar above
// it — a message that mentions both is exactly the message nobody should be
// second-guessed on.
export function suggestTopic(message, chosenId) {
  const text = String(message || "");

  if (text.trim().length < 20) return "";

  const scores = {};

  for (const [id, patterns] of TOPIC_PATTERNS) {
    scores[id] = patterns.reduce(
      (count, pattern) => count + (pattern.test(text) ? 1 : 0),
      0
    );
  }

  let best = "";

  for (const [id, score] of Object.entries(scores)) {
    if (score >= TOPIC_CONFIDENCE && score > (scores[best] || 0)) best = id;
  }

  if (!best || best === chosenId) return "";

  // A clear winner, not a photo finish. Two desks on the same score is the
  // message that genuinely spans both, and the sender is the one who knows
  // which half matters.
  const runnerUp = Object.entries(scores)
    .filter(([id]) => id !== best)
    .reduce((top, [, score]) => Math.max(top, score), 0);

  if (scores[best] === runnerUp) return "";

  // And it has to beat the desk already chosen, not merely differ from it.
  return scores[best] > (scores[chosenId] || 0) ? best : "";
}

// How long a desk with no stated wait is given. Held as minutes only: the
// wait used to be written twice, once as a number and once as the sentence
// shown on screen, which is the arrangement where the two drift apart.
const DEFAULT_REPLY_MINUTES = 5;

// A message that says it brought something with it.
//
// The attachment field is below the message box and optional, which is a
// reliable way of being written about and then not used: somebody types
// "screenshot attached", finishes the sentence, and sends. What arrives at
// the desk is a message referring to a picture that is not there, and the
// only way to resolve it is a round trip asking for the thing the sender
// already believed they had sent.
//
// Written as the promise rather than the noun. "Screenshot" on its own is
// how most support messages start — "the screenshot page is broken" — while
// "attached", "enclosed" and "below" are somebody telling you where to look.
const ATTACHMENT_PROMISES = [
  /\battach(ed|ing)\b/i,
  // The bare noun is the ambiguous one: "attachment support would be a nice
  // feature" is a message about this field, not a message using it. An
  // article in front of it is what turns it into a particular attachment
  // somebody believes they sent.
  /\b(the|my|this|an|one)\s+attachments?\b/i,
  /\benclos(ed|ing)\b/i,
  /\bsee\s+(the\s+)?(screenshot|image|photo|picture|file|pdf|log)/i,
  /\b(screenshot|image|photo|picture|file|pdf|log)s?\s+(is\s+|are\s+)?below\b/i,
  /\bhere('s| is)\s+(a|the)\s+(screenshot|image|photo|picture|file|pdf|log)/i,
  /\bi('ve| have)\s+(sent|included)\b/i,
];

export function mentionsAttachment(message) {
  const text = String(message || "");

  return ATTACHMENT_PROMISES.some((pattern) => pattern.test(text));
}

// A reference gives the sender something to quote when they follow up, and
// it is the first thing a desk asks for. The prefix says which queue it
// belongs to; the body is random rather than sequential so it does not
// advertise how many messages came before it.
const REFERENCE_PREFIX = { support: "SUP", sales: "SAL", feedback: "FBK", other: "GEN" };

// No O/0 and no I/1: a reference has to survive being read out over the
// phone, and those pairs are the ones that come back typed wrong.
const REFERENCE_ALPHABET = "ACDEFHJKLMNPRTUVWXY2345789";
const REFERENCE_LENGTH = 6;

function makeReference(topicId) {
  const prefix = REFERENCE_PREFIX[topicId] || REFERENCE_PREFIX.other;
  const bytes = new Uint8Array(REFERENCE_LENGTH);

  crypto.getRandomValues(bytes);

  const body = Array.from(
    bytes,
    (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]
  ).join("");

  return `${prefix}-${body}`;
}

// A copy of what was sent, for the sender to keep.
//
// This form stores none of it. The name, the email and the message are never
// written to this browser, which is what makes the history safe to leave on a
// shared machine — and it also means that pressing "send another message"
// takes the only copy of what you just wrote with it.
//
// Handing the text over rather than keeping it resolves both: the sender
// leaves with a record, and the site still holds nothing.
export function messageCopy({ reference, topic, values, files, replyBy, about, sentAt }) {
  const lines = [
    "Beacon — message sent",
    `Reference: ${reference}`,
    `Topic: ${topic?.label || "Something else"}`,
    `Sent: ${sentAt.toLocaleString()}`,
  ];

  if (replyBy) lines.push(`Reply expected: ${replyBy}`);
  // Only on a message that is chasing something, because on every other one
  // the line would be an empty field asking to be filled in.
  if (about) lines.push(`Following up on: ${about}`);

  lines.push("", `From: ${values.name} <${values.email}>`);

  if (files.length > 0) {
    lines.push(`Attached: ${files.map((item) => item.file.name).join(", ")}`);
  }

  // The attachments themselves are not in here — a text file cannot hold
  // them, and the sender already has the originals on the machine they
  // picked them from.
  lines.push("", "—".repeat(32), "", values.message);

  return lines.join("\n");
}

function downloadText(text, filename, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  // Handed back on the next task rather than immediately: the save is
  // started by the click but not necessarily finished when it returns, and
  // revoking the URL underneath it cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// The desk keeps its own hours, and they are the desk's — not the
// visitor's. Reading the clock in this timezone is what keeps "back at
// 9:00" true for someone writing in at 3am from another continent.
const DESK_TIMEZONE = "America/New_York";
const DESK_TIMEZONE_LABEL = "ET";
const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;
const WORKING_DAYS = [1, 2, 3, 4, 5];
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function findTopic(id) {
  return TOPICS.find((topic) => topic.id === id);
}

// The desk's wall clock: the weekday and hour where the team actually sits.
// h23 is asked for explicitly because hour12:false reports midnight as 24
// in some engines, which would read as an hour that does not exist.
function deskClock(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DESK_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const read = (type) => parts.find((part) => part.type === type)?.value;

  return {
    day: DAY_INDEX[read("weekday")] ?? 1,
    hour: Number(read("hour")),
    minute: Number(read("minute")) || 0,
  };
}

function clockText(hour, minute) {
  const suffix = hour < 12 ? "am" : "pm";

  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

const OPEN_MINUTE = OPEN_HOUR * 60;
const CLOSE_MINUTE = CLOSE_HOUR * 60;

// When an answer should actually be expected, counted in the desk's working
// hours rather than in wall-clock time.
//
// "Usually replies within 5 minutes" is true and nearly useless at two
// minutes to six, when those five minutes are on the other side of a night.
// The same sentence out of hours says nothing at all: five minutes from
// when? So the wait is walked through the hours the desk actually keeps -
// starting at the next moment it is open, and carrying whatever is left over
// closing time into the following working day.
export function replyBy(now, minutes, clock = deskClock) {
  const { day, hour, minute } = clock(now);

  let dayIndex = day;
  let daysAhead = 0;
  let atMinute = hour * 60 + minute;

  // Step to the next moment the desk is open. A day at a time, since a
  // weekend is two of them and a Friday evening is three.
  const openNextDay = () => {
    dayIndex = (dayIndex + 1) % 7;
    daysAhead += 1;
    atMinute = OPEN_MINUTE;
  };

  if (!WORKING_DAYS.includes(dayIndex) || atMinute >= CLOSE_MINUTE) {
    openNextDay();
  } else if (atMinute < OPEN_MINUTE) {
    atMinute = OPEN_MINUTE;
  }

  while (!WORKING_DAYS.includes(dayIndex)) openNextDay();

  // Spend the wait. Anything past closing time is not lost, it is owed by
  // the next working day - which is what makes a five-minute promise made at
  // 17:58 come out as 09:03 tomorrow rather than 18:03 tonight.
  let left = Math.max(0, minutes);

  while (left > CLOSE_MINUTE - atMinute) {
    left -= CLOSE_MINUTE - atMinute;
    openNextDay();
    while (!WORKING_DAYS.includes(dayIndex)) openNextDay();
  }

  atMinute += left;

  return {
    day: dayIndex,
    daysAhead,
    hour: Math.floor(atMinute / 60),
    minute: atMinute % 60,
  };
}

// The moment `replyBy` names, as a real instant rather than a clock reading.
//
// The estimate is a day offset and a time on the desk's wall, which is all a
// sentence needs. A calendar needs more: "9:03 tomorrow in New York" is a
// different instant from one week to the next either side of a clock change,
// and nothing about the desk's hours should depend on the visitor knowing
// that. So the desk's calendar date is read first, moved on by the days the
// estimate carries, and the wall time on it converted back to UTC.
function zoneWallClock(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type) => Number(parts.find((part) => part.type === type)?.value);

  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"));
}

export function replyInstant(now, estimate, zone = DESK_TIMEZONE) {
  const today = new Date(zoneWallClock(now, zone));
  const wall = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + estimate.daysAhead,
    estimate.hour,
    estimate.minute
  );

  // The zone's offset at that moment, measured rather than assumed. Measured
  // twice, because the first guess can land on the other side of a clock
  // change from the answer.
  let instant = wall - (zoneWallClock(new Date(wall), zone) - wall);
  instant = wall - (zoneWallClock(new Date(instant), zone) - instant);

  return new Date(instant);
}

function icsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// A reminder for the moment an answer is owed.
//
// The success screen promises "by 3:20 pm tomorrow" and then the promise
// lives nowhere but a tab that is about to be closed. If the answer never
// comes, the sender is the only person in a position to notice — and they
// have no way to notice unless something reminds them when the time comes.
//
// A calendar file is the one thing every diary on every platform already
// opens. The event carries the reference, because the reference is what
// they will need in their hand if they have to chase it — and nothing else
// from the message, for the same reason the form keeps nothing else.
export function replyReminder({ reference, topic, replyAt, stamp = new Date() }) {
  const end = new Date(replyAt.getTime() + 15 * 60 * 1000);
  const desk = topic?.desk || "the Beacon team";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Beacon//Contact form//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${reference}@beacon`,
    `DTSTAMP:${icsStamp(stamp)}`,
    `DTSTART:${icsStamp(replyAt)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(`Reply due from Beacon · ${reference}`)}`,
    `DESCRIPTION:${icsText(
      `${desk} said they would answer by now. If nothing has arrived, follow up and quote ${reference}.`
    )}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(`Has Beacon replied? Reference ${reference}`)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// "by 3:20 pm ET", with the day named only when it is not this one - the
// common case is an answer within the hour, and "today" on every message
// would be noise.
export function replyByText(estimate) {
  const time = `${clockText(estimate.hour, estimate.minute)} ${DESK_TIMEZONE_LABEL}`;

  if (estimate.daysAhead === 0) return `by ${time}`;
  if (estimate.daysAhead === 1) return `by ${time} tomorrow`;

  return `by ${DAY_NAMES[estimate.day]} ${time}`;
}

function openingTimeText() {
  const hour = OPEN_HOUR % 12 || 12;
  return `${hour}:00 ${OPEN_HOUR < 12 ? "am" : "pm"} ${DESK_TIMEZONE_LABEL}`;
}

// Open, or shut with somewhere to point. A promise of a five-minute reply
// at 2am on a Sunday is not a promise anyone can keep, so out of hours the
// eyebrow says when the desk is back instead.
function deskStatus(now = new Date()) {
  const { day, hour } = deskClock(now);
  const working = WORKING_DAYS.includes(day);

  if (working && hour >= OPEN_HOUR && hour < CLOSE_HOUR) {
    return { open: true };
  }

  // Still before opening on a working day — the wait is only this morning.
  if (working && hour < OPEN_HOUR) {
    return { open: false, returns: `at ${openingTimeText()}` };
  }

  // Otherwise walk forward to the next working day.
  let ahead = 1;
  while (!WORKING_DAYS.includes((day + ahead) % 7)) {
    ahead += 1;
  }

  const nextDay = (day + ahead) % 7;
  const when = ahead === 1 ? "tomorrow" : DAY_NAMES[nextDay];

  return { open: false, returns: `${when} at ${openingTimeText()}` };
}

// A half-written message should survive a reload or a stray back button.
// Storage can be unavailable (private windows, blocked site data) or hold
// junk from an older build, so every read falls back to an empty form.
// Past this a draft has stopped being unfinished business and become
// litter. A month-old half-message is not something anyone is coming back
// to finish, and on a shared machine it is a stranger's words sitting in a
// form with their name above them.
const DRAFT_KEEPS_MS = 30 * 24 * 60 * 60 * 1000;

// When the draft was last written. Kept apart from the four field values so
// that `values` stays exactly the shape the form renders, and a draft saved
// by an older build — which carries no timestamp — still restores.
export function loadDraftSavedAt() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
    const at = Number(saved?.savedAt);

    return Number.isFinite(at) && at > 0 && at <= Date.now() ? at : null;
  } catch {
    return null;
  }
}

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!saved || typeof saved !== "object") return EMPTY_VALUES;

    // Old enough to be forgotten. Dropped on the way out rather than shown
    // and then argued with, so the form simply opens empty.
    const at = Number(saved.savedAt);
    if (Number.isFinite(at) && Date.now() - at > DRAFT_KEEPS_MS) {
      clearDraft();
      return EMPTY_VALUES;
    }

    return {
      topic: findTopic(saved.topic) ? saved.topic : "",
      name: typeof saved.name === "string" ? saved.name : "",
      email: typeof saved.email === "string" ? saved.email : "",
      message: typeof saved.message === "string" ? saved.message : "",
    };
  } catch {
    return EMPTY_VALUES;
  }
}

// References sent from this browser, newest first. Only the reference, the
// desk it went to and when — no name, email or message body, because none of
// that has to sit in storage for the reference to be useful, and all of it
// would be sitting on a shared machine if it did.
function loadSent() {
  try {
    const saved = JSON.parse(localStorage.getItem(SENT_KEY));

    if (!Array.isArray(saved)) return [];

    return saved
      .filter(
        (item) =>
          item &&
          typeof item.reference === "string" &&
          Number.isFinite(item.at)
      )
      // Capped on the way in as well as on the way out: what comes back from
      // storage was written by an older build, or by hand, and this one goes
      // straight onto the screen.
      .map((item) =>
        typeof item.summary === "string" && item.summary.trim()
          ? { ...item, summary: item.summary.trim().slice(0, SUMMARY_MAX + 1) }
          : { ...item, summary: "" }
      )
      .slice(0, MAX_SENT);
  } catch {
    return [];
  }
}

// The opening of a sent message, as a line to recognise it by.
//
// A reference is a good thing to quote and a poor thing to read: three
// support messages in a fortnight are three rows reading "Support · 4 days
// ago", and picking the right one to follow up on meant guessing from the
// date. The first line is almost always the subject somebody would have
// written if the form had asked for one.
//
// Stays on this device, in the same place the draft already lives, and never
// goes anywhere the message itself has not already been.
const SUMMARY_MAX = 64;

export function summarise(message) {
  const text = String(message || "").trim();

  if (!text) return "";

  // The first line, or the first sentence when the whole message is one
  // paragraph — which is what "I cannot log in. It started this morning…"
  // should be recognised by.
  const firstLine = text.split(/\r?\n/)[0].trim();
  const opening = firstLine.split(/(?<=[.!?])\s/)[0].trim() || firstLine;
  const clean = opening.replace(/\s+/g, " ");

  if (clean.length <= SUMMARY_MAX) return clean;

  // Cut at a word rather than mid-syllable, unless the first word is longer
  // than the whole allowance — a pasted URL, usually.
  const cut = clean.slice(0, SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > SUMMARY_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// Days rather than hours: someone checking a reference is asking "was that
// the one from Tuesday?", not counting the minutes since.
function sentWhen(at) {
  const days = Math.floor((Date.now() - at) / 86_400_000);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}

export default function App() {
  const [values, setValues] = useState(loadDraft);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [desk, setDesk] = useState(deskStatus);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [reference, setReference] = useState("");
  // Which reference was last copied, rather than a bare yes/no: the success
  // screen is no longer the only place one can be copied from, and a shared
  // boolean would light up "Copied" on every row at once.
  const [copiedRef, setCopiedRef] = useState("");
  const [sent, setSent] = useState(loadSent);
  // The reference this message is chasing, when it is chasing one. A second
  // message about the same problem is the most common reason anyone comes
  // back to a contact form, and until now it arrived at the desk looking
  // like a brand new report of a problem already half solved.
  const [followingUp, setFollowingUp] = useState("");
  // Frozen when the message goes. The estimate on the form moves with the
  // clock, as it should; the one on the confirmation is a promise that was
  // made at a particular moment and should not quietly slide while somebody
  // is reading it.
  const [sentReplyBy, setSentReplyBy] = useState("");
  // The same promise as an instant, for the calendar reminder. Kept beside
  // the sentence rather than derived from it, since the sentence has already
  // thrown away the date it was counting from.
  const [sentReplyAt, setSentReplyAt] = useState(null);
  // What the confirmation is a confirmation of: the moment it went, and the
  // thread it was chasing. Both are cleared from the form the instant it
  // sends, and the copy offered on this screen has to describe the message
  // that was actually sent rather than the empty form behind it.
  const [sentAt, setSentAt] = useState(null);
  const [sentAbout, setSentAbout] = useState("");
  // A suggested address the sender has waved away. Held as the suggestion
  // itself rather than as a flag, so that correcting one typo into a
  // different one asks again instead of staying quiet about the second.
  const [keptEmail, setKeptEmail] = useState("");
  // The desk the sender has already declined to be moved off. Same reasoning
  // as keptEmail: some messages really do belong where they were filed, and
  // being asked twice about the same one is worse than not being asked.
  const [keptTopic, setKeptTopic] = useState("");
  // Set once the sender has said the missing attachment is not missing.
  // Plenty of messages mention a file that was sent somewhere else, or last
  // week, and the note should not survive being answered.
  const [keptUnattached, setKeptUnattached] = useState(false);
  // Whether this visit opened onto someone else's half-written message —
  // their own from last time, or a colleague's on a shared machine. Read
  // from storage a second time rather than from `values`, so that typing the
  // first character does not make it look like a draft was restored.
  const [restored, setRestored] = useState(() => {
    const draft = loadDraft();

    return FIELD_ORDER.some((field) => draft[field]);
  });
  // Read once, beside `restored`, because it describes the draft this visit
  // opened onto — not the one being typed now, which is a second old.
  const [restoredAt] = useState(loadDraftSavedAt);
  // The message "Start fresh" just erased, held for as long as it takes to
  // realise that was the wrong button. Null the rest of the time, which is
  // also what makes the offer disappear.
  const [discarded, setDiscarded] = useState(null);
  const liveRegionRef = useRef(null);
  const fieldRefs = useRef({});
  const fileInputRef = useRef(null);

  // A tab left open across the desk closing should not keep promising a
  // five-minute reply, so the status is re-read every minute.
  useEffect(() => {
    const timer = setInterval(() => setDesk(deskStatus()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Keep the stored draft in step with what is on screen, but stop once the
  // message is away — a sent form should not reappear on the next visit.
  useEffect(() => {
    if (status === "sent") return;

    if (!values.topic && !values.name && !values.email && !values.message) {
      clearDraft();
      return;
    }

    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...values, savedAt: Date.now() }));
    } catch {
      /* the form still works without a saved draft */
    }
  }, [values, status]);

  // "Copied" is a confirmation, not a state worth keeping - it goes back to
  // an offer of the action a couple of seconds later.
  useEffect(() => {
    if (!copiedRef) return undefined;

    const timer = setTimeout(() => setCopiedRef(""), 2000);
    return () => clearTimeout(timer);
  }, [copiedRef]);

  // Same shape as the timer above, a great deal longer. Two seconds is right
  // for reading a confirmation; this one has to survive the pause between
  // pressing a button and understanding what it did, and the offer sits in
  // the corner of a form somebody has already started retyping.
  useEffect(() => {
    if (!discarded) return undefined;

    const timer = setTimeout(() => setDiscarded(null), UNDO_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [discarded]);

  // The clipboard can be refused outright: an insecure context, a denied
  // permission, an older browser. The reference is on screen either way, so
  // that case points at it rather than reporting a failure.
  const copyReference = (value) => async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedRef(value);

      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = `Reference ${value} copied.`;
      }
    } catch {
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent =
          "Couldn't reach the clipboard — select the reference to copy it by hand.";
      }
    }
  };

  const validate = (field, val) => {
    if (field === "topic") return !findTopic(val) ? "Pick what this is about." : "";
    if (field === "name") return val.trim().length < 2 ? "Enter your full name." : "";
    if (field === "email") return !EMAIL_RE.test(val) ? "Enter a valid email address." : "";
    if (field === "message") {
      if (val.trim().length < 10) return "Say a little more — at least 10 characters.";
      if (val.length > MESSAGE_MAX) return `Keep it under ${MESSAGE_MAX} characters.`;
      return "";
    }
    return "";
  };

  const handleChange = (field) => (e) => {
    const val = e.target.value;
    setValues((v) => ({ ...v, [field]: val }));
    if (touched[field]) {
      setErrors((er) => ({ ...er, [field]: validate(field, val) }));
    }
  };

  const handleBlur = (field) => (e) => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors((er) => ({ ...er, [field]: validate(field, e.target.value) }));
  };

  // Object URLs outlive the component unless they are handed back. Removing
  // and resetting give theirs back as they go; this catches whatever is
  // still attached when the form itself goes away. It reads through a ref so
  // that adding a second file does not trip the cleanup for the first.
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(
    () => () => filesRef.current.forEach((item) => URL.revokeObjectURL(item.url)),
    []
  );

  const addFiles = (incoming) => {
    const candidates = Array.from(incoming || []);
    if (!candidates.length) return;

    const accepted = [];
    let problem = "";

    for (const file of candidates) {
      const issue = fileProblem(file);

      if (issue) {
        problem = problem || issue;
        continue;
      }

      // Dropping the same screenshot twice is a slip, not a request for two
      // copies of it.
      const alreadyHere = (item) =>
        item.file.name === file.name && item.file.size === file.size;

      if (files.some(alreadyHere) || accepted.some(alreadyHere)) continue;

      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        url: URL.createObjectURL(file),
      });
    }

    const room = MAX_FILES - files.length;
    const kept = accepted.slice(0, Math.max(room, 0));

    // Anything past the cap is dropped rather than silently swapped in, and
    // its object URL goes back before it is forgotten about.
    accepted.slice(kept.length).forEach((item) => URL.revokeObjectURL(item.url));

    if (accepted.length > kept.length) {
      problem = problem || `You can attach up to ${MAX_FILES} files.`;
    }

    setFileError(problem);
    if (kept.length) setFiles((current) => [...current, ...kept]);

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent =
        problem ||
        (kept.length === 1
          ? `${kept[0].file.name} attached.`
          : `${kept.length} files attached.`);
    }
  };

  const removeFile = (id) => () => {
    const going = files.find((item) => item.id === id);
    if (going) URL.revokeObjectURL(going.url);

    setFiles((current) => current.filter((item) => item.id !== id));
    setFileError("");
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  // Missing the drop zone should cost nothing. A file let go anywhere else on
  // the page is handled by the browser, which navigates to it — so a screen
  // shot dropped an inch wide of the target replaces the form, and the
  // half-written message with it.
  //
  // Both events have to be cancelled: without dragover saying it will handle
  // the drop, drop is never delivered to the page at all and the browser
  // takes it regardless.
  useEffect(() => {
    const swallow = (event) => {
      // Only files. Dragging selected text within the page is somebody
      // rearranging their own sentence, and that still has to work.
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;

      event.preventDefault();
    };

    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);

    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  // The draft survives a reload; the attachments do not. Text can be written
  // to storage, but a File is a handle to something on this machine and does
  // not outlive the page that was given it — so a reload restores every word
  // of the message and quietly drops the three screenshots that explained it.
  //
  // Only while files are actually attached and unsent. Asking on every
  // departure would be a form arguing with somebody closing a tab they had
  // finished with, and the browser's own wording is all that can be shown —
  // the prompt exists to stop the click, not to explain it.
  useEffect(() => {
    if (status === "sent" || files.length === 0) return undefined;

    const onLeave = (event) => {
      event.preventDefault();
      // Older browsers still need a value here before they will ask.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [files.length, status]);

  // A screenshot is almost always on the clipboard already — Print Screen, a
  // snipping tool, an image copied out of a chat. Making someone save it to
  // disk just so they can pick it back off disk is a step that only existed
  // because nothing here was listening for a paste.
  //
  // The listener sits on the window rather than the drop zone: nobody aims
  // at the drop zone before pressing Ctrl+V, and the cursor is usually still
  // in the message box where they were describing the problem.
  useEffect(() => {
    if (status === "sent") return undefined;

    const onPaste = (event) => {
      const pasted = Array.from(event.clipboardData?.files || []);

      // Pasted text belongs to whichever field has the cursor. Only files
      // are ours to take, and taking them keeps the browser from dropping a
      // filename into the textarea as well.
      if (!pasted.length) return;

      event.preventDefault();
      addFiles(pasted);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // `files` is in here because addFiles reads it to enforce the cap and to
    // spot duplicates; a stale listener would let a fourth file through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, status]);

  // The box grows with what is in it. A four-line window onto a message that
  // is allowed to run to six hundred characters meant writing the end of it
  // without being able to see the beginning — and re-reading before sending
  // is most of what the last minute before sending is for.
  //
  // Driven off the value rather than off keystrokes, so the box is already
  // the right size for a draft restored from last week or a message quoted
  // into a follow-up, neither of which involves anybody typing.
  useEffect(() => {
    const box = fieldRefs.current.message;

    if (!box) return;

    // Measured from nothing first. `scrollHeight` reports the content or the
    // current height, whichever is larger, so growing works without this but
    // shrinking never does — the box would keep the height of the longest
    // thing ever typed into it.
    box.style.height = "auto";

    const wanted = Math.min(box.scrollHeight, MESSAGE_BOX_MAX);

    box.style.height = `${wanted}px`;
    box.style.overflowY = box.scrollHeight > MESSAGE_BOX_MAX ? "auto" : "hidden";
  }, [values.message]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const nextErrors = {
      topic: validate("topic", values.topic),
      name: validate("name", values.name),
      email: validate("email", values.email),
      message: validate("message", values.message),
    };
    setErrors(nextErrors);
    setTouched({ topic: true, name: true, email: true, message: true });

    // Move focus to the first field that failed so keyboard and screen
    // reader users are taken to the problem instead of being left on a
    // submit button that silently did nothing.
    const invalid = FIELD_ORDER.filter((field) => nextErrors[field]);
    if (invalid.length) {
      // Focus alone only reveals the first problem. The live region says how
      // much is left to fix, so nobody has to tab the form to find out.
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent =
          invalid.length === 1
            ? `1 field needs attention: ${nextErrors[invalid[0]]}`
            : `${invalid.length} fields need attention. Starting with ${FIELD_LABELS[invalid[0]]}: ${nextErrors[invalid[0]]}`;
      }
      fieldRefs.current[invalid[0]]?.focus();
      return;
    }

    if (liveRegionRef.current) liveRegionRef.current.textContent = "Sending your message.";
    setStatus("sending");
    // Simulated send — swap for a real request when wiring up a backend.
    setTimeout(() => {
      const ticket = makeReference(values.topic);
      const record = {
        reference: ticket,
        topic: values.topic,
        at: Date.now(),
        // What the message opened with, so the row can be told apart from
        // the last two filed under the same desk.
        summary: summarise(values.message),
        // Kept so the history reads as a thread rather than as two unrelated
        // messages about the same thing. Left off entirely when there is
        // nothing being chased, so old records keep their shape.
        ...(followingUp ? { about: followingUp } : {}),
      };
      const history = [record, ...loadSent()].slice(0, MAX_SENT);

      setSent(history);

      try {
        localStorage.setItem(SENT_KEY, JSON.stringify(history));
      } catch {
        /* the reference is still on screen; it just will not be here later */
      }

      // One clock reading for all three, so the time sent, the sentence and
      // the calendar entry cannot disagree by the minute between them.
      const sentMoment = new Date();
      const estimate = replyBy(
        sentMoment,
        findTopic(values.topic)?.replyMinutes ?? DEFAULT_REPLY_MINUTES
      );

      setReference(ticket);
      setSentAt(sentMoment);
      setSentAbout(followingUp);
      setFollowingUp("");
      setSentReplyBy(replyByText(estimate));
      setSentReplyAt(replyInstant(sentMoment, estimate));
      setStatus("sent");
      clearDraft();
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = `Message sent. Your reference is ${ticket}.`;
      }
    }, 1400);
  };

  const selectedTopic = findTopic(values.topic);
  // Recomputed with the desk status, which re-reads the clock every minute,
  // so the estimate ages with the page rather than with the tab.
  const replyEstimate = useMemo(
    () => replyByText(replyBy(new Date(), selectedTopic?.replyMinutes ?? DEFAULT_REPLY_MINUTES)),
    [desk, selectedTopic]
  );
  // Only once they have left the field. Every address is a typo halfway
  // through being typed, and a form that corrects mid-word is arguing with
  // somebody who has not finished talking. Only on an otherwise valid one,
  // too — "enter a valid email address" is already the more useful thing to
  // say about `jordan@`.
  const emailSuggestion = useMemo(() => {
    if (!touched.email || errors.email) return "";

    const guess = suggestEmail(values.email);

    return guess && guess !== keptEmail ? guess : "";
  }, [values.email, touched.email, errors.email, keptEmail]);

  const acceptEmailSuggestion = () => {
    setValues((v) => ({ ...v, email: emailSuggestion }));
    setErrors((er) => ({ ...er, email: validate("email", emailSuggestion) }));

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = `Email changed to ${emailSuggestion}.`;
    }
  };

  // Some people really are at a domain one letter from a famous one, and
  // being asked about it twice on the same form is worse than being asked
  // nothing.
  const keepEmail = () => setKeptEmail(emailSuggestion);

  // Which desk the message reads like it is for, when that is not the one
  // already picked. Only once a topic has been chosen: before that the form
  // is still asking the question outright, and answering it over the top of
  // itself would be two controls arguing.
  const topicSuggestion = useMemo(() => {
    if (!values.topic) return "";

    const guess = suggestTopic(values.message, values.topic);

    return guess && guess !== keptTopic ? guess : "";
  }, [values.message, values.topic, keptTopic]);

  const suggestedTopic = findTopic(topicSuggestion);

  const acceptTopicSuggestion = () => {
    setValues((v) => ({ ...v, topic: topicSuggestion }));
    setErrors((er) => ({ ...er, topic: "" }));
    setKeptTopic("");

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = `Topic changed to ${suggestedTopic?.label || ""}.`;
    }
  };

  const keepTopic = () => setKeptTopic(topicSuggestion);

  // A message that promises a file, with no file on it. Recomputed as both
  // halves change, so attaching the screenshot puts the note away without
  // anyone having to dismiss it.
  const missingAttachment =
    !keptUnattached && files.length === 0 && mentionsAttachment(values.message);

  const remaining = MESSAGE_MAX - values.message.length;
  const counterState =
    remaining < 0 ? "bc-counter-over" : remaining <= 60 ? "bc-counter-warn" : "";

  const handleTopicSelect = (id) => () => {
    setValues((v) => ({ ...v, topic: id }));
    setTouched((t) => ({ ...t, topic: true }));
    setErrors((er) => ({ ...er, topic: validate("topic", id) }));
  };

  const resetForm = () => {
    setRestored(false);
    setDiscarded(null);
    clearDraft();
    files.forEach((item) => URL.revokeObjectURL(item.url));
    setFiles([]);
    setFileError("");
    setValues(EMPTY_VALUES);
    setErrors({});
    setTouched({});
    setKeptEmail("");
    setKeptTopic("");
    setKeptUnattached(false);
    setReference("");
    setCopiedRef("");
    setFollowingUp("");
    setSentAt(null);
    setSentReplyAt(null);
    setSentAbout("");
    setStatus("idle");
  };

  const saveCopy = () => {
    downloadText(
      messageCopy({
        reference,
        topic: selectedTopic,
        values,
        files,
        replyBy: sentReplyBy,
        about: sentAbout,
        sentAt: sentAt || new Date(),
      }),
      `beacon-${reference}.txt`
    );

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = `A copy of your message has been saved as beacon-${reference}.txt.`;
    }
  };

  const saveReminder = () => {
    if (!sentReplyAt) return;

    const filename = `beacon-${reference}.ics`;

    downloadText(
      replyReminder({ reference, topic: selectedTopic, replyAt: sentReplyAt }),
      filename,
      "text/calendar;charset=utf-8"
    );

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = `A calendar reminder for ${sentReplyBy} has been saved as ${filename}.`;
    }
  };

  // Picks up an old thread. Only the topic and the reference move across —
  // the name, the email and what was actually said were never stored, and
  // this is not the moment to start: the whole point of keeping the history
  // that thin is that it can sit on a shared machine.
  const followUp = (item) => () => {
    const label = findTopic(item.topic)?.label || "Something else";

    // Only into an empty box. Someone who has already typed half a message is
    // following up in their own words, and rewriting what they wrote to
    // insert a reference would be worse than not mentioning it — the form
    // says what is being chased either way.
    const nextMessage = values.message || `Following up on ${item.reference}:\n\n`;

    setFollowingUp(item.reference);
    setValues((v) => ({
      ...v,
      // The desk this went to the first time is almost certainly the one
      // that should see it again.
      topic: findTopic(item.topic) ? item.topic : v.topic,
      message: nextMessage,
    }));
    setTouched((t) => ({ ...t, topic: true }));
    setErrors((er) => ({ ...er, topic: "" }));

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = `Following up on ${item.reference}, ${label}. Your message is ready to write.`;
    }

    // Straight to the box that still needs writing, with the caret after the
    // quoted line rather than in front of it.
    //
    // After the paint, not before it: the box is a controlled field and still
    // holds its old value at this point, so a caret placed now would be
    // measured against text that is about to be replaced.
    const box = fieldRefs.current.message;

    if (box) {
      requestAnimationFrame(() => {
        box.focus();
        box.setSelectionRange(nextMessage.length, nextMessage.length);
      });
    }
  };

  // Throwing the draft away leaves an empty form and no obvious next step,
  // so focus goes to the first question rather than staying on a button that
  // has just erased everything around it.
  //
  // It is also the most expensive button on the page. "Start fresh" sits an
  // inch from the message it deletes, it deletes it instantly, and what it
  // deletes may not be the presser's to delete — the banner above it exists
  // precisely because this form opens onto other people's half-written
  // messages. So the words are kept for a moment, after `resetForm` has
  // cleared its own undo, rather than before.
  const discardDraft = () => {
    // Attachments cannot come back. They were never in the saved draft, and
    // clearing the form revokes their object URLs — so the count is kept in
    // order to say so, rather than restoring a message that goes on
    // promising a screenshot that is no longer there.
    const held = { values, files: files.length };

    resetForm();
    setDiscarded(held);
    fieldRefs.current.topic?.focus();

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = "Draft discarded. You can still undo it.";
    }
  };

  const restoreDraft = () => {
    if (!discarded) return;

    setValues(discarded.values);
    setDiscarded(null);
    // Not "restored": that banner is about a draft found in storage at the
    // start of a visit, and this one was on screen a moment ago.
    setRestored(false);
    fieldRefs.current.message?.focus();

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = "Draft restored.";
    }
  };

  return (
    <div className="bc-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,500&family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap');

        :root {
          --bg: #0e2a2d;
          --bg-elevated: #123638;
          --bg-elevated-2: #17403f;
          --line: rgba(243, 239, 228, 0.12);
          --accent: #f5a623;
          --accent-soft: rgba(245, 166, 35, 0.16);
          --text: #f3efe4;
          --text-muted: #9fbfb8;
          --success: #7fd858;
          --danger: #ff8a80;
        }

        .bc-root {
          background: var(--bg);
          color: var(--text);
          font-family: 'Inter', system-ui, sans-serif;
          min-height: 100vh;
          width: 100%;
        }

        .bc-root * { box-sizing: border-box; }

        /* ---------- Nav ---------- */
        .bc-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 22px 6vw;
          border-bottom: 1px solid var(--line);
        }
        .bc-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          font-size: 18px;
          letter-spacing: 0.02em;
        }
        .bc-logo-mark {
          width: 26px; height: 26px;
          position: relative;
          flex-shrink: 0;
        }
        .bc-logo-mark::before, .bc-logo-mark::after {
          content: '';
          position: absolute;
          border-radius: 50%;
          border: 1.5px solid var(--accent);
          inset: 0;
        }
        .bc-logo-mark::after {
          inset: 7px;
          background: var(--accent);
          border: none;
        }
        .bc-nav-links {
          display: flex;
          gap: 36px;
          list-style: none;
          margin: 0; padding: 0;
        }
        .bc-nav-links a {
          color: var(--text-muted);
          text-decoration: none;
          font-size: 14.5px;
          font-weight: 500;
          transition: color 0.2s ease;
          position: relative;
        }
        .bc-nav-links a:hover { color: var(--text); }
        .bc-nav-links a::after {
          content: '';
          position: absolute;
          left: 0; right: 0; bottom: -6px;
          height: 1px;
          background: var(--accent);
          transform: scaleX(0);
          transition: transform 0.25s ease;
        }
        .bc-nav-links a:hover::after { transform: scaleX(1); }

        .bc-login {
          background: transparent;
          border: 1px solid var(--line);
          color: var(--text);
          padding: 9px 20px;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: border-color 0.2s ease, background 0.2s ease;
        }
        .bc-login:hover { border-color: var(--accent); background: var(--accent-soft); }
        .bc-login:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        /* ---------- Hero / Contact section ---------- */
        .bc-section {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 5vw;
          align-items: center;
          padding: 7vw 6vw 8vw;
          max-width: 1280px;
          margin: 0 auto;
        }

        .bc-eyebrow {
          font-family: 'Space Grotesk', sans-serif;
          text-transform: uppercase;
          font-size: 12px;
          letter-spacing: 0.16em;
          color: var(--accent);
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 18px;
        }
        .bc-eyebrow-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--accent);
          animation: bc-blink 1.8s ease-in-out infinite;
        }
        /* Out of hours the light is steady and quiet — a blinking dot reads
           as someone waiting at the other end. */
        .bc-eyebrow-closed {
          color: var(--text-muted);
        }
        .bc-eyebrow-dot-off {
          background: var(--text-muted);
          animation: none;
        }
        @keyframes bc-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }

        .bc-h1 {
          font-family: 'Newsreader', serif;
          font-weight: 500;
          font-size: clamp(38px, 4.4vw, 58px);
          line-height: 1.05;
          margin: 0 0 20px;
          letter-spacing: -0.01em;
        }
        .bc-h1 em { color: var(--accent); font-style: italic; }

        .bc-lede {
          color: var(--text-muted);
          font-size: 17px;
          line-height: 1.6;
          max-width: 46ch;
          margin: 0 0 32px;
        }

        .bc-channel-row {
          display: flex;
          gap: 14px;
          margin-bottom: 44px;
          flex-wrap: wrap;
        }
        .bc-channel-btn {
          display: flex;
          align-items: center;
          gap: 9px;
          background: var(--bg-elevated);
          border: 1px solid var(--line);
          color: var(--text);
          padding: 11px 18px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
        }
        .bc-channel-btn:hover {
          border-color: var(--accent);
          background: var(--bg-elevated-2);
          transform: translateY(-2px);
        }
        .bc-channel-btn svg { flex-shrink: 0; }

        /* ---------- Form ---------- */
        .bc-form {
          background: var(--bg-elevated);
          border: 1px solid var(--line);
          border-radius: 18px;
          padding: 32px;
          position: relative;
          overflow: hidden;
        }

        .bc-field {
          margin-bottom: 20px;
          position: relative;
        }
        .bc-field label {
          display: block;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .bc-topics {
          border: none;
          padding: 0;
          margin: 0 0 20px;
          min-width: 0;
        }
        .bc-topics legend {
          padding: 0;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .bc-topic-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .bc-topic {
          background: var(--bg);
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 9px 16px;
          font-size: 13.5px;
          font-weight: 500;
          color: var(--text-muted);
          cursor: pointer;
          transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
        }
        .bc-topic:hover { border-color: var(--accent); color: var(--text); }
        .bc-topic-on {
          border-color: var(--accent);
          background: var(--accent-soft);
          color: var(--text);
        }
        /* The chip is the control; the radio stays for keyboard and
           screen reader users but is not drawn. */
        .bc-topic input {
          position: absolute;
          width: 1px; height: 1px;
          opacity: 0;
          pointer-events: none;
        }
        .bc-topic:has(input:focus-visible) {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .bc-topics.bc-error .bc-topic { border-color: var(--danger); }

        .bc-field input,
        .bc-field textarea {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 13px 14px;
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 15px;
          transition: border-color 0.2s ease, background 0.2s ease;
        }
        .bc-field input::placeholder, .bc-field textarea::placeholder { color: #5f7c78; }
        .bc-field input:focus, .bc-field textarea:focus {
          border-color: var(--accent);
          outline: none;
          background: rgba(245, 166, 35, 0.04);
        }
        /* No resize handle: the box sizes itself now, and a corner that
           fights the next keystroke back to the height of the text is worse
           than no corner at all. */
        .bc-field textarea { min-height: 110px; resize: none; }

        /* Sits between the label and the box so it is read before the field
           is filled in, not after. */
        .bc-hint {
          color: var(--text-muted);
          font-size: 12.5px;
          line-height: 1.45;
          margin: -2px 0 8px;
        }
        .bc-field.bc-error input,
        .bc-field.bc-error textarea {
          border-color: var(--danger);
        }
        .bc-field-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: 6px;
        }
        .bc-counter {
          margin-left: auto;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 12px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          transition: color 0.2s ease;
        }
        .bc-counter.bc-counter-warn { color: var(--accent); }
        .bc-shortcut {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 12px;
          color: var(--text-muted);
          opacity: 0.7;
        }
        .bc-counter.bc-counter-over { color: var(--danger); }

        /* A question, not a failure — so it borrows the beacon amber rather
           than the red the real errors use. Getting this wrong would make a
           correct address look rejected. */
        .bc-suggest {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 6px;
          font-size: 12.5px;
          color: var(--accent);
        }
        .bc-suggest-fix {
          background: var(--accent-soft);
          border: 1px solid transparent;
          border-radius: 5px;
          padding: 1px 6px;
          color: var(--accent);
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .bc-suggest-fix:hover,
        .bc-suggest-fix:focus-visible { border-color: var(--accent); }
        .bc-suggest-keep {
          background: none;
          border: 0;
          padding: 0;
          color: var(--text-muted);
          font: inherit;
          text-decoration: underline;
          cursor: pointer;
        }
        .bc-suggest-keep:hover,
        .bc-suggest-keep:focus-visible { color: var(--text); }

        .bc-error-msg {
          color: var(--danger);
          font-size: 12.5px;
          margin-top: 6px;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        /* ---------- Attachments ---------- */
        .bc-optional {
          margin-left: 6px;
          font-size: 11px;
          font-weight: 400;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .bc-drop {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 20px 16px;
          border: 1px dashed var(--line);
          border-radius: 10px;
          background: var(--bg-elevated);
          color: var(--text-muted);
          text-align: center;
          transition: border-color 0.2s ease, background 0.2s ease;
        }
        .bc-drop.bc-drop-on {
          border-color: var(--accent);
          background: var(--accent-soft);
        }
        .bc-drop.bc-error { border-color: var(--danger); }
        .bc-drop p { margin: 0; font-size: 14px; color: var(--text); }
        .bc-drop small { font-size: 12px; }
        .bc-browse {
          padding: 0;
          border: none;
          background: none;
          color: var(--accent);
          font: inherit;
          text-decoration: underline;
          cursor: pointer;
        }
        /* The real input stays in the layout for focus and screen readers;
           the dashed panel above is what anyone actually clicks. */
        .bc-file-input {
          position: absolute;
          width: 1px; height: 1px;
          overflow: hidden;
          opacity: 0;
        }

        .bc-attachments {
          list-style: none;
          margin: 10px 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .bc-attachment {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--bg-elevated-2);
        }
        .bc-attachment-thumb {
          width: 34px; height: 34px;
          flex-shrink: 0;
          border-radius: 6px;
          object-fit: cover;
          background: var(--bg);
        }
        .bc-attachment-pdf {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 10px;
          font-weight: 600;
          color: var(--accent);
        }
        .bc-attachment-meta {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }
        .bc-attachment-meta strong {
          font-size: 13px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bc-attachment-meta small { font-size: 11.5px; color: var(--text-muted); }
        .bc-attachment-remove {
          flex-shrink: 0;
          width: 26px; height: 26px;
          border: none;
          border-radius: 50%;
          background: transparent;
          color: var(--text-muted);
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease;
        }
        .bc-attachment-remove:hover { background: var(--accent-soft); color: var(--text); }
        .bc-attachment-note {
          display: block;
          margin-top: 8px;
          font-size: 11.5px;
          color: var(--text-muted);
        }
        .bc-success-files {
          color: var(--text-muted);
          font-size: 13px;
          margin: -12px 0 20px;
        }

        .bc-submit {
          width: 100%;
          background: var(--accent);
          color: #1a1204;
          border: none;
          border-radius: 10px;
          padding: 14px;
          font-size: 15px;
          font-weight: 600;
          font-family: 'Space Grotesk', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: filter 0.2s ease, transform 0.15s ease;
        }
        .bc-submit:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
        .bc-submit:disabled { opacity: 0.75; cursor: default; }

        .bc-spinner {
          width: 16px; height: 16px;
          border-radius: 50%;
          border: 2px solid rgba(26,18,4,0.35);
          border-top-color: #1a1204;
          animation: bc-spin 0.7s linear infinite;
        }
        @keyframes bc-spin { to { transform: rotate(360deg); } }

        .bc-success {
          text-align: center;
          padding: 20px 4px 4px;
        }
        .bc-check-circle {
          width: 52px; height: 52px;
          border-radius: 50%;
          background: var(--accent-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
        }
        .bc-check-path {
          stroke-dasharray: 30;
          stroke-dashoffset: 30;
          animation: bc-draw 0.5s ease forwards 0.15s;
        }
        @keyframes bc-draw { to { stroke-dashoffset: 0; } }

        .bc-success h3 {
          font-family: 'Newsreader', serif;
          font-weight: 500;
          font-size: 22px;
          margin: 0 0 8px;
        }
        .bc-success p { color: var(--text-muted); font-size: 14.5px; margin: 0 0 20px; }
        /* The reference is the one thing on this screen worth keeping, so it
           is set apart from the prose and sized to be read aloud. */
        .bc-reference {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin: -8px 0 20px;
          padding: 8px 8px 8px 14px;
          border: 1px solid var(--line);
          border-radius: 999px;
          background: var(--bg-elevated-2);
        }
        .bc-reference-label {
          color: var(--text-muted);
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .bc-reference-code {
          font-family: 'Space Grotesk', monospace;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: var(--accent);
          user-select: all;
        }
        .bc-reference-copy {
          border: none;
          border-radius: 999px;
          padding: 6px 14px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          background: var(--accent-soft);
          color: var(--text);
          transition: background 0.2s ease;
        }
        .bc-reference-copy:hover { background: var(--accent); color: #1a1204; }
        .bc-reference-copy:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        @media (max-width: 420px) {
          .bc-reference {
            flex-wrap: wrap;
            justify-content: center;
            border-radius: 14px;
            padding: 10px 12px;
          }
        }

        /* ---------- Restored draft ---------- */
        /* A note, not an alarm: nothing has gone wrong, the form is only
           saying where the words in it came from. */
        .bc-restored {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 22px;
          padding: 11px 14px;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: var(--bg-elevated-2);
          font-size: 13px;
        }
        .bc-restored p {
          margin: 0;
          flex: 1;
          color: var(--text-muted);
        }
        .bc-restored button {
          border: none;
          background: none;
          padding: 0;
          font: inherit;
          font-weight: 600;
          color: var(--accent);
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .bc-restored-close {
          font-size: 17px;
          line-height: 1;
          color: var(--text-muted) !important;
          text-decoration: none !important;
        }
        .bc-restored-close:hover { color: var(--text) !important; }

        /* A question, not a failure — so it borrows the beacon amber rather
           than the red the real errors use. The left edge is what separates
           it at a glance from the restored banner it replaces, which is
           otherwise the same shape in the same place. */
        .bc-undo {
          border-left: 3px solid var(--accent);
          background: var(--accent-soft);
        }
        .bc-undo p { color: var(--text); }

        /* ---------- Past references ---------- */
        /* Closed by default and quiet: this is a filing cabinet, not part of
           the task. It should be findable without ever competing with the
           send button above it. */
        .bc-history {
          margin-top: 18px;
          border-top: 1px solid var(--line);
          padding-top: 14px;
        }
        .bc-history summary {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--text-muted);
          cursor: pointer;
          list-style: none;
        }
        .bc-history summary::-webkit-details-marker { display: none; }
        .bc-history summary:hover { color: var(--text); }
        .bc-history-count {
          display: inline-grid;
          place-items: center;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: var(--accent-soft);
          color: var(--accent);
          font-size: 11px;
          font-weight: 600;
        }
        .bc-history ul {
          list-style: none;
          margin: 12px 0 0;
          padding: 0;
          display: grid;
          gap: 8px;
        }
        .bc-history li {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          font-size: 13px;
        }
        .bc-history code {
          font-family: 'Space Grotesk', monospace;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--accent);
          user-select: all;
        }
        .bc-history li span { color: var(--text-muted); font-size: 12px; }
        .bc-history-what {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 4px 10px;
          min-width: 0;
        }
        /* Its own line, and one line only. A message that opens with a
           paragraph should not push the two buttons beside it down the
           page. */
        .bc-history-summary {
          flex-basis: 100%;
          margin: 0;
          color: var(--text-muted);
          font-size: 12px;
          font-style: italic;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Pushed to the end of the row rather than sharing the space
           evenly: it is an action, not a third piece of the reference. */
        .bc-history-copy {
          margin-left: auto;
          flex-shrink: 0;
          border: none;
          border-radius: 999px;
          padding: 3px 10px;
          background: var(--accent-soft);
          color: var(--text);
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease;
        }
        /* Only the first action claims the free space. Two auto margins
           would split it between them and leave the pair drifting apart
           across the row instead of sitting together at the end. */
        .bc-history-copy + .bc-history-copy { margin-left: 6px; }
        .bc-history-copy:hover { background: var(--accent); color: #1a1204; }
        .bc-history-copy:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        /* Directly above the send button, where it is read as a condition of
           sending rather than as a note about the form. */
        .bc-following {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin: 0 0 12px;
          padding: 10px 12px;
          border: 1px solid var(--accent-soft);
          border-radius: 10px;
          background: var(--accent-soft);
          font-size: 12.5px;
          color: var(--text-muted);
        }
        .bc-following code {
          font-family: 'Space Grotesk', monospace;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--accent);
        }
        /* A link rather than a button: undoing a choice should not look as
           consequential as making one. */
        .bc-following-clear {
          margin-left: auto;
          border: none;
          background: none;
          padding: 0;
          color: var(--text-muted);
          font-size: 12px;
          text-decoration: underline;
          cursor: pointer;
        }
        .bc-following-clear:hover { color: var(--text); }
        .bc-following-clear:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .bc-history > p {
          margin: 12px 0 0;
          font-size: 12px;
          color: var(--text-muted);
        }

        .bc-success-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        /* The reason there is a button to press at all. Said quietly, under
           it, where it explains rather than sells. */
        .bc-success-note {
          margin: 14px 0 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-muted);
        }

        .bc-again {
          background: transparent;
          border: 1px solid var(--line);
          color: var(--text);
          padding: 9px 20px;
          border-radius: 999px;
          font-size: 13.5px;
          cursor: pointer;
          transition: border-color 0.2s ease;
        }
        .bc-again:hover { border-color: var(--accent); }

        /* ---------- Beacon illustration ---------- */
        .bc-illustration {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          height: 100%;
          min-height: 340px;
        }
        .bc-ring {
          position: absolute;
          border: 1px solid var(--accent);
          border-radius: 50%;
          opacity: 0;
          animation: bc-pulse 3.6s ease-out infinite;
        }
        .bc-ring:nth-child(1) { width: 120px; height: 120px; animation-delay: 0s; }
        .bc-ring:nth-child(2) { width: 120px; height: 120px; animation-delay: 1.2s; }
        .bc-ring:nth-child(3) { width: 120px; height: 120px; animation-delay: 2.4s; }
        @keyframes bc-pulse {
          0% { transform: scale(1); opacity: 0.55; }
          100% { transform: scale(3.4); opacity: 0; }
        }
        .bc-tower {
          position: relative;
          z-index: 2;
          filter: drop-shadow(0 6px 24px rgba(245, 166, 35, 0.35));
        }

        @media (prefers-reduced-motion: reduce) {
          .bc-ring, .bc-eyebrow-dot, .bc-spinner, .bc-check-path { animation: none !important; }
        }

        @media (max-width: 880px) {
          .bc-section { grid-template-columns: 1fr; padding-top: 10vw; }
          .bc-nav-links { display: none; }
          .bc-illustration { order: -1; min-height: 220px; }
        }
      `}</style>

      <header className="bc-nav">
        <div className="bc-logo">
          <span className="bc-logo-mark" aria-hidden="true" />
          Beacon
        </div>

        <ul className="bc-nav-links">
          <li><a href="#">Home</a></li>
          <li><a href="#">Features</a></li>
          <li><a href="#">Pricing</a></li>
          <li><a href="#">About</a></li>
          <li><a href="#">Contact</a></li>
        </ul>

        <button className="bc-login">Log in</button>
      </header>

      <section className="bc-section">
        <div>
          <div className={`bc-eyebrow ${desk.open ? "" : "bc-eyebrow-closed"}`}>
            <span
              className={`bc-eyebrow-dot ${desk.open ? "" : "bc-eyebrow-dot-off"}`}
              aria-hidden="true"
            />
            {/* A time rather than a duration. "Within 5 minutes" is true and
                nearly useless at two minutes to six, and out of hours it
                does not even say five minutes from when. */}
            {desk.open
              ? `Open now — expect a reply ${replyEstimate}`
              : `Closed — the desk is back ${desk.returns}, expect a reply ${replyEstimate}`}
          </div>

          <h1 className="bc-h1">
            Send up a signal.<br />We'll send back <em>light</em>.
          </h1>
          <p className="bc-lede">
            Questions, feedback, or something urgent — tell us what's going on
            and a real person on our team will get back to you shortly.
          </p>

          <div className="bc-channel-row">
            <button className="bc-channel-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Support chat
            </button>
            <button className="bc-channel-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92z" />
              </svg>
              Call us
            </button>
          </div>

          <form className="bc-form" onSubmit={handleSubmit} noValidate>
            {status === "sent" ? (
              <div className="bc-success" role="status">
                <div className="bc-check-circle">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path className="bc-check-path" d="M5 13l4 4L19 7" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3>Message sent</h3>
                <p>
                  Thanks, {values.name.split(" ")[0] || "there"} —{" "}
                  {selectedTopic?.desk || "our team"} will get back to you at{" "}
                  {values.email} — expect a reply {sentReplyBy}.
                  {desk.open ? "" : ` The desk is back ${desk.returns}.`}
                </p>
                <div className="bc-reference">
                  <span className="bc-reference-label">Your reference</span>
                  <code className="bc-reference-code">{reference}</code>
                  <button
                    type="button"
                    className="bc-reference-copy"
                    onClick={copyReference(reference)}
                  >
                    {copiedRef === reference ? "Copied" : "Copy"}
                  </button>
                </div>

                {files.length > 0 && (
                  <p className="bc-success-files">
                    {files.length === 1
                      ? `${files[0].file.name} went with it.`
                      : `${files.length} attachments went with it.`}
                  </p>
                )}
                {/* Before "send another message", which is the button that
                    throws the text away. Offered rather than done
                    automatically: most people do not need a file, and a
                    download nobody asked for is its own small rudeness. */}
                <div className="bc-success-actions">
                  <button type="button" className="bc-again" onClick={saveCopy}>
                    Save a copy
                  </button>
                  {/* Only when there is a time to put in a calendar. */}
                  {sentReplyAt && (
                    <button type="button" className="bc-again" onClick={saveReminder}>
                      Remind me {sentReplyBy}
                    </button>
                  )}
                  <button type="button" className="bc-again" onClick={resetForm}>
                    Send another message
                  </button>
                </div>

                <p className="bc-success-note">
                  We keep your reference and nothing else — not your name,
                  your address or a word of what you wrote. The copy is yours
                  to keep.
                </p>
              </div>
            ) : (
              <>
                {/* The draft has always come back silently, which reads as a
                    form that remembered wrong rather than one that
                    remembered — and on a shared machine it is a stranger's
                    half-written message with no obvious way out of it. */}
                {restored && (
                  <div className="bc-restored" role="status">
                    <p>
                      Picked up where you left off
                      {/* A draft from a build before timestamps says nothing
                          about when, rather than guessing at it. */}
                      {restoredAt ? ` — saved ${sentWhen(restoredAt)}.` : "."}
                    </p>

                    <button type="button" onClick={discardDraft}>
                      Start fresh
                    </button>

                    <button
                      type="button"
                      className="bc-restored-close"
                      onClick={() => setRestored(false)}
                      aria-label="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* The same banner, in the amber this page uses for a
                    question rather than a failure — nothing has gone wrong,
                    and the only thing being asked is whether that was meant.
                    It takes the restored banner's place rather than sitting
                    under it: the draft that banner announced is exactly the
                    one that has just gone. */}
                {discarded && (
                  <div className="bc-restored bc-undo" role="status">
                    <p>
                      Draft discarded.
                      {discarded.files > 0 &&
                        ` The ${
                          discarded.files === 1 ? "attachment" : "attachments"
                        } cannot be brought back.`}
                    </p>

                    <button type="button" onClick={restoreDraft}>
                      Undo
                    </button>

                    <button
                      type="button"
                      className="bc-restored-close"
                      onClick={() => setDiscarded(null)}
                      aria-label="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                )}

                <fieldset
                  className={`bc-field bc-topics ${errors.topic && touched.topic ? "bc-error" : ""}`}
                  aria-describedby={errors.topic && touched.topic ? "bc-topic-error" : undefined}
                >
                  <legend>What's this about?</legend>

                  <div className="bc-topic-row">
                    {TOPICS.map((topic, index) => (
                      <label
                        key={topic.id}
                        className={`bc-topic ${values.topic === topic.id ? "bc-topic-on" : ""}`}
                      >
                        <input
                          type="radio"
                          name="bc-topic"
                          value={topic.id}
                          ref={index === 0 ? (el) => (fieldRefs.current.topic = el) : undefined}
                          checked={values.topic === topic.id}
                          onChange={handleTopicSelect(topic.id)}
                        />
                        {topic.label}
                      </label>
                    ))}
                  </div>

                  {errors.topic && touched.topic && (
                    <div className="bc-error-msg" id="bc-topic-error">{errors.topic}</div>
                  )}
                </fieldset>

                <div className={`bc-field ${errors.name && touched.name ? "bc-error" : ""}`}>
                  <label htmlFor="bc-name">Your name</label>
                  <input
                    id="bc-name"
                    type="text"
                    ref={(el) => (fieldRefs.current.name = el)}
                    placeholder="Jordan Blake"
                    value={values.name}
                    onChange={handleChange("name")}
                    onBlur={handleBlur("name")}
                    aria-invalid={!!(errors.name && touched.name)}
                    aria-describedby={errors.name && touched.name ? "bc-name-error" : undefined}
                  />
                  {errors.name && touched.name && (
                    <div className="bc-error-msg" id="bc-name-error">{errors.name}</div>
                  )}
                </div>

                <div className={`bc-field ${errors.email && touched.email ? "bc-error" : ""}`}>
                  <label htmlFor="bc-email">Your email</label>
                  <input
                    id="bc-email"
                    type="email"
                    ref={(el) => (fieldRefs.current.email = el)}
                    placeholder="jordan@company.com"
                    value={values.email}
                    onChange={handleChange("email")}
                    onBlur={handleBlur("email")}
                    aria-invalid={!!(errors.email && touched.email)}
                    aria-describedby={errors.email && touched.email ? "bc-email-error" : undefined}
                  />
                  {errors.email && touched.email && (
                    <div className="bc-error-msg" id="bc-email-error">{errors.email}</div>
                  )}
                  {emailSuggestion && (
                    <div className="bc-suggest" role="status">
                      <span>
                        Did you mean{" "}
                        <button
                          type="button"
                          className="bc-suggest-fix"
                          onClick={acceptEmailSuggestion}
                        >
                          {emailSuggestion}
                        </button>
                        ?
                      </span>
                      <button
                        type="button"
                        className="bc-suggest-keep"
                        onClick={keepEmail}
                      >
                        Mine is right
                      </button>
                    </div>
                  )}
                </div>

                <div className={`bc-field ${errors.message && touched.message ? "bc-error" : ""}`}>
                  <label htmlFor="bc-message">Your message</label>
                  {selectedTopic?.hint && (
                    <p className="bc-hint" id="bc-message-hint">{selectedTopic.hint}</p>
                  )}
                  <textarea
                    id="bc-message"
                    ref={(el) => (fieldRefs.current.message = el)}
                    placeholder={selectedTopic?.prompt || DEFAULT_PROMPT}
                    value={values.message}
                    onChange={handleChange("message")}
                    onBlur={handleBlur("message")}
                    // The message box is where a message is finished, and
                    // reaching the send button from it meant tabbing through
                    // the attachment controls first. Ctrl/⌘ + Enter is the
                    // send shortcut every mail client already taught — plain
                    // Enter stays a new line, because paragraphs are the
                    // point of this box.
                    //
                    // Through requestSubmit rather than calling the handler,
                    // so a send from the keyboard is validated and announced
                    // exactly as a click on the button would be.
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;

                      event.preventDefault();
                      if (status !== "idle") return;
                      event.currentTarget.form?.requestSubmit();
                    }}
                    aria-invalid={!!(errors.message && touched.message)}
                    aria-describedby={
                      [
                        errors.message && touched.message ? "bc-message-error" : "",
                        "bc-message-counter",
                        selectedTopic?.hint ? "bc-message-hint" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")
                    }
                  />
                  {/* Under the message rather than up beside the topic
                      buttons. This is read off what has just been typed, and
                      the row it refers to is several fields up the page —
                      offering it there would put the answer somewhere the
                      sender has already scrolled past. */}
                  {suggestedTopic && (
                    <div className="bc-suggest" role="status">
                      <span>
                        This reads like one for {suggestedTopic.desk}.{" "}
                        <button
                          type="button"
                          className="bc-suggest-fix"
                          onClick={acceptTopicSuggestion}
                        >
                          Send to {suggestedTopic.label}
                        </button>
                      </span>
                      <button
                        type="button"
                        className="bc-suggest-keep"
                        onClick={keepTopic}
                      >
                        Keep {selectedTopic?.label || "as is"}
                      </button>
                    </div>
                  )}

                  <div className="bc-field-foot">
                    {errors.message && touched.message && (
                      <div className="bc-error-msg" id="bc-message-error">{errors.message}</div>
                    )}
                    {/* Out of the way of an error, which is the more useful
                        thing to read in the same spot. Hidden from screen
                        readers: it describes a key, not the field. */}
                    {!(errors.message && touched.message) && values.message.trim() && (
                      <span className="bc-shortcut" aria-hidden="true">
                        {SEND_SHORTCUT} to send
                      </span>
                    )}
                    <span
                      className={`bc-counter ${counterState}`}
                      id="bc-message-counter"
                      aria-label={`${values.message.length} of ${MESSAGE_MAX} characters used`}
                    >
                      {values.message.length}/{MESSAGE_MAX}
                    </span>
                  </div>
                </div>

                <div className="bc-field">
                  <label htmlFor="bc-files">
                    Attachments <span className="bc-optional">optional</span>
                  </label>

                  {/* Above the drop zone, so the note and the way to answer
                      it are the same glance. Nothing is blocked: plenty of
                      messages mention a file that was sent somewhere else,
                      or last week, and the sender is the one who knows. */}
                  {missingAttachment && (
                    <div className="bc-suggest" role="status">
                      <span>
                        Your message mentions something attached —{" "}
                        <button
                          type="button"
                          className="bc-suggest-fix"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          add it now
                        </button>
                      </span>
                      <button
                        type="button"
                        className="bc-suggest-keep"
                        onClick={() => setKeptUnattached(true)}
                      >
                        Nothing to attach
                      </button>
                    </div>
                  )}

                  <div
                    className={`bc-drop ${dragging ? "bc-drop-on" : ""} ${fileError ? "bc-error" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={(e) => {
                      // dragleave also fires on the way *into* a child of
                      // the zone — the icon, the sentence, the button — so
                      // taken at face value the highlight switches itself
                      // off halfway across its own drop target. A leave
                      // whose destination is still inside the zone has not
                      // left it. relatedTarget is null when the pointer
                      // leaves the window altogether, which really is a
                      // leave and falls through.
                      if (e.currentTarget.contains(e.relatedTarget)) return;
                      setDragging(false);
                    }}
                    onDrop={handleDrop}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.19a3.67 3.67 0 0 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 0 1-2.59-2.6l8.5-8.48" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>

                    <p>
                      Drop a screenshot here, paste it, or{" "}
                      <button
                        type="button"
                        className="bc-browse"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        browse
                      </button>
                    </p>

                    <small>
                      Images or PDF · up to {formatBytes(MAX_FILE_BYTES)} each ·
                      {" "}{MAX_FILES} files max
                    </small>

                    <input
                      id="bc-files"
                      type="file"
                      multiple
                      accept={ACCEPT_ATTR}
                      ref={fileInputRef}
                      className="bc-file-input"
                      onChange={(e) => {
                        addFiles(e.target.files);
                        // Cleared so picking the same file after removing it
                        // still counts as a change.
                        e.target.value = "";
                      }}
                    />
                  </div>

                  {fileError && <div className="bc-error-msg">{fileError}</div>}

                  {files.length > 0 && (
                    <ul className="bc-attachments">
                      {files.map((item) => (
                        <li key={item.id} className="bc-attachment">
                          {item.file.type === "application/pdf" ? (
                            <span className="bc-attachment-thumb bc-attachment-pdf">PDF</span>
                          ) : (
                            <img className="bc-attachment-thumb" src={item.url} alt="" />
                          )}

                          <span className="bc-attachment-meta">
                            <strong>{item.file.name}</strong>
                            <small>{formatBytes(item.file.size)}</small>
                          </span>

                          <button
                            type="button"
                            className="bc-attachment-remove"
                            onClick={removeFile(item.id)}
                            aria-label={`Remove ${item.file.name}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {files.length > 0 && (
                    <small className="bc-attachment-note">
                      Attachments aren't kept in your saved draft — reloading
                      the page will ask for them again.
                    </small>
                  )}
                </div>

                {/* Said on the form, not only in the message box, because
                    the box can be rewritten from scratch and the link would
                    go with it without anything on screen changing. */}
                {followingUp && (
                  <p className="bc-following">
                    Following up on <code>{followingUp}</code>
                    <button
                      type="button"
                      className="bc-following-clear"
                      onClick={() => setFollowingUp("")}
                    >
                      Send as a new message instead
                    </button>
                  </p>
                )}

                <button type="submit" className="bc-submit" disabled={status === "sending"}>
                  {status === "sending" ? (
                    <>
                      <span className="bc-spinner" aria-hidden="true" />
                      Sending…
                    </>
                  ) : (
                    "Send message"
                  )}
                </button>

                {/* Under the button rather than above the form: it is for
                    the visit that comes back, not the one about to send. */}
                {sent.length > 0 && (
                  <details className="bc-history">
                    <summary>
                      Sent from this browser before
                      <span className="bc-history-count">{sent.length}</span>
                    </summary>

                    <ul>
                      {sent.map((item) => (
                        <li key={item.reference}>
                          <div className="bc-history-what">
                          <code>{item.reference}</code>
                          <span>
                            {findTopic(item.topic)?.label || "Something else"}
                            {" · "}
                            {sentWhen(item.at)}
                            {/* Two messages about one problem read as one
                                thread here, the same way they will at the
                                desk. */}
                            {item.about && (
                              <>
                                {" · follows "}
                                <code>{item.about}</code>
                              </>
                            )}
                          </span>
                          {/* Under the reference rather than beside it: a
                              line of somebody's own words is the part of
                              this row that gets read, and squeezing it in
                              next to the code would truncate it to nothing
                              on a phone. Absent on anything filed before
                              this was kept, which reads as it used to. */}
                          {item.summary && (
                            <p className="bc-history-summary" title={item.summary}>
                              “{item.summary}”
                            </p>
                          )}
                          </div>
                          {/* The line under this list asks people to quote
                              one of these. Reading six characters off the
                              screen and retyping them into an email is
                              exactly where the O/0 confusion the alphabet
                              already avoids would have crept back in. */}
                          <button
                            type="button"
                            className="bc-history-copy"
                            onClick={copyReference(item.reference)}
                            aria-label={`Copy reference ${item.reference}`}
                          >
                            {copiedRef === item.reference ? "Copied" : "Copy"}
                          </button>
                          {/* Copying the reference assumes the next move
                              happens somewhere else — an email, a phone
                              call. Most of the time the next move is another
                              message through this same form. */}
                          <button
                            type="button"
                            className="bc-history-copy"
                            onClick={followUp(item)}
                            aria-label={`Follow up on ${item.reference}`}
                          >
                            Follow up
                          </button>
                        </li>
                      ))}
                    </ul>

                    <p>
                      Quote one of these and the desk can find the thread
                      without you retelling it.
                    </p>
                  </details>
                )}
              </>
            )}
            <div ref={liveRegionRef} aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }} />
          </form>
        </div>

        <div className="bc-illustration">
          <span className="bc-ring" aria-hidden="true" />
          <span className="bc-ring" aria-hidden="true" />
          <span className="bc-ring" aria-hidden="true" />
          <svg className="bc-tower" width="120" height="160" viewBox="0 0 120 160" fill="none">
            <circle cx="60" cy="34" r="22" fill="#F5A623" opacity="0.9" />
            <circle cx="60" cy="34" r="10" fill="#FFF6E4" />
            <path d="M46 56 L74 56 L84 150 L36 150 Z" fill="#123638" stroke="#F5A623" strokeWidth="1.5" />
            <path d="M50 90 H70 M47 118 H73" stroke="#F5A623" strokeWidth="1.2" opacity="0.6" />
          </svg>
        </div>
      </section>
    </div>
  );
}