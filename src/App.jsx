import { useState, useRef, useEffect } from "react";

/**
 * Contact page — "Beacon" concept.
 * The idea: reaching support should feel like sending up a signal and
 * getting a light back. Deep teal ground, amber beacon accent, pulsing
 * rings as the signature motif instead of a generic hero graphic.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 600;
const FIELD_ORDER = ["name", "email", "message"];
const FIELD_LABELS = { name: "your name", email: "your email", message: "your message" };
const DRAFT_KEY = "beacon.contact-draft";
const EMPTY_VALUES = { name: "", email: "", message: "" };

// A half-written message should survive a reload or a stray back button.
// Storage can be unavailable (private windows, blocked site data) or hold
// junk from an older build, so every read falls back to an empty form.
function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!saved || typeof saved !== "object") return EMPTY_VALUES;
    return {
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
  const liveRegionRef = useRef(null);
  const fieldRefs = useRef({});

  // Keep the stored draft in step with what is on screen, but stop once the
  // message is away — a sent form should not reappear on the next visit.
  useEffect(() => {
    if (status === "sent") return;

    if (!values.name && !values.email && !values.message) {
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

  const handleSubmit = (e) => {
    e.preventDefault();
    const nextErrors = {
      name: validate("name", values.name),
      email: validate("email", values.email),
      message: validate("message", values.message),
    };
    setErrors(nextErrors);
    setTouched({ name: true, email: true, message: true });

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

  const remaining = MESSAGE_MAX - values.message.length;
  const counterState =
    remaining < 0 ? "bc-counter-over" : remaining <= 60 ? "bc-counter-warn" : "";

  const resetForm = () => {
    clearDraft();
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
          <div className="bc-eyebrow">
            <span className="bc-eyebrow-dot" aria-hidden="true" />
            Usually replies within 5 minutes
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
                <p>Thanks, {values.name.split(" ")[0] || "there"} — we'll get back to you at {values.email}.</p>
                <button type="button" className="bc-again" onClick={resetForm}>Send another message</button>
              </div>
            ) : (
              <>
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