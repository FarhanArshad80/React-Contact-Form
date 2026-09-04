import { useState, useRef, useEffect } from "react";

/**
 * Contact page — "Beacon" concept.
 * The idea: reaching support should feel like sending up a signal and
 * getting a light back. Deep teal ground, amber beacon accent, pulsing
 * rings as the signature motif instead of a generic hero graphic.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 600;
const FIELD_ORDER = ["topic", "name", "email", "message"];
const FIELD_LABELS = {
  topic: "the topic",
  name: "your name",
  email: "your email",
  message: "your message",
};
const DRAFT_KEY = "beacon.contact-draft";
const EMPTY_VALUES = { topic: "", name: "", email: "", message: "" };

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

// Everything lands in the same inbox today, but saying which desk picks it up
// — and how quickly — sets a truthful expectation before anyone hits send.
const TOPICS = [
  { id: "support", label: "Support", desk: "our support team", reply: "5 minutes" },
  { id: "sales", label: "Sales", desk: "our sales team", reply: "1 hour" },
  { id: "feedback", label: "Feedback", desk: "our product team", reply: "1 business day" },
  { id: "other", label: "Something else", desk: "our team", reply: "1 business day" },
];

const DEFAULT_REPLY = "5 minutes";

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
    hourCycle: "h23",
  }).formatToParts(now);

  const read = (type) => parts.find((part) => part.type === type)?.value;

  return {
    day: DAY_INDEX[read("weekday")] ?? 1,
    hour: Number(read("hour")),
  };
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
function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!saved || typeof saved !== "object") return EMPTY_VALUES;
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
      localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
    } catch {
      /* the form still works without a saved draft */
    }
  }, [values, status]);

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
      setStatus("sent");
      clearDraft();
      if (liveRegionRef.current) liveRegionRef.current.textContent = "Message sent.";
    }, 1400);
  };

  const selectedTopic = findTopic(values.topic);
  const remaining = MESSAGE_MAX - values.message.length;
  const counterState =
    remaining < 0 ? "bc-counter-over" : remaining <= 60 ? "bc-counter-warn" : "";

  const handleTopicSelect = (id) => () => {
    setValues((v) => ({ ...v, topic: id }));
    setTouched((t) => ({ ...t, topic: true }));
    setErrors((er) => ({ ...er, topic: validate("topic", id) }));
  };

  const resetForm = () => {
    clearDraft();
    files.forEach((item) => URL.revokeObjectURL(item.url));
    setFiles([]);
    setFileError("");
    setValues(EMPTY_VALUES);
    setErrors({});
    setTouched({});
    setStatus("idle");
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
        .bc-field textarea { min-height: 110px; resize: vertical; }
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
        .bc-counter.bc-counter-over { color: var(--danger); }

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
            {desk.open
              ? `Open now — usually replies within ${selectedTopic?.reply || DEFAULT_REPLY}`
              : `Closed — the desk is back ${desk.returns}`}
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
                  {values.email}
                  {desk.open ? "." : `, once the desk opens ${desk.returns}.`}
                </p>
                {files.length > 0 && (
                  <p className="bc-success-files">
                    {files.length === 1
                      ? `${files[0].file.name} went with it.`
                      : `${files.length} attachments went with it.`}
                  </p>
                )}
                <button type="button" className="bc-again" onClick={resetForm}>Send another message</button>
              </div>
            ) : (
              <>
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
                </div>

                <div className={`bc-field ${errors.message && touched.message ? "bc-error" : ""}`}>
                  <label htmlFor="bc-message">Your message</label>
                  <textarea
                    id="bc-message"
                    ref={(el) => (fieldRefs.current.message = el)}
                    placeholder="What can we help with?"
                    value={values.message}
                    onChange={handleChange("message")}
                    onBlur={handleBlur("message")}
                    aria-invalid={!!(errors.message && touched.message)}
                    aria-describedby={
                      errors.message && touched.message
                        ? "bc-message-error bc-message-counter"
                        : "bc-message-counter"
                    }
                  />
                  <div className="bc-field-foot">
                    {errors.message && touched.message && (
                      <div className="bc-error-msg" id="bc-message-error">{errors.message}</div>
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

                  <div
                    className={`bc-drop ${dragging ? "bc-drop-on" : ""} ${fileError ? "bc-error" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.19a3.67 3.67 0 0 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 0 1-2.59-2.6l8.5-8.48" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>

                    <p>
                      Drop a screenshot here, or{" "}
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