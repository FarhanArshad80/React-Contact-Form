# React Contact Form

A support contact form built with React and Vite. It is designed to catch
the mistakes that stop a reply from ever reaching the sender.

## Features

- **Topic, name, email and message fields** with inline validation.
- **Email typo suggestions** that catch slips like `gmial.com` or `.con`
  and offer the address you probably meant.
- **No-reply address warning** when the email looks like one that never
  reads replies.
- **Attachments**: up to 3 images or PDFs (PNG, JPEG, GIF, WebP, PDF),
  5 MB each.
- **Draft autosave** so a half-written message survives a reload, plus a
  20-second undo after discarding a draft.
- **Recently sent list** showing your last 5 messages.
- **Keyboard shortcut**: send with Ctrl + Enter (⌘ + Enter on Mac).
- **Message box that grows with your text** up to a fixed height, then
  scrolls.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Scripts

| Command           | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the dev server with hot reload |
| `npm run build`   | Build for production into `dist/`    |
| `npm run preview` | Serve the production build locally   |
| `npm run lint`    | Run ESLint                           |

## Tech stack

- React 19
- Vite
- ESLint
