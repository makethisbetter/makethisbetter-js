<p align="center">
  <img src="https://makethisbetter.dev/icon.svg" width="80" height="80" alt="Make This Better">
</p>

<h1 align="center">makethisbetter</h1>

<p align="center">
  From rage click to agent-ready fix.
</p>

<p align="center">
  <a href="https://makethisbetter.dev">makethisbetter.dev</a> &middot;
  <a href="https://www.npmjs.com/package/makethisbetter"><img src="https://img.shields.io/npm/v/makethisbetter.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/makethisbetter"><img src="https://img.shields.io/npm/dm/makethisbetter.svg" alt="npm downloads"></a>
  <a href="https://bundlephobia.com/package/makethisbetter"><img src="https://img.shields.io/bundlephobia/minzip/makethisbetter" alt="bundle size"></a>
  <a href="https://github.com/makethisbetter/makethisbetter-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
</p>

---

## Why

You ship with AI agents. Your users hit bugs you never see in dev. They leave. You never find out why.

This widget gives your users a way to report exactly what went wrong — annotated screenshot, console errors, DOM state, browser info — in two clicks. AI triage turns that into a structured task your coding agent (Claude Code, Cursor, Codex) picks up automatically. The agent ships the fix. The user gets notified.

No more "can you describe what happened?" No more lost screenshots in Slack. The full loop, from frustrated user to shipped fix, runs without you context-switching.

## Quick Start

### CDN (2 lines)

```html
<script src="https://unpkg.com/makethisbetter@2"></script>
<script>
  MakeThisBetter.init({ projectKey: 'mtb_proj_YOUR_KEY' })
</script>
```

### npm

```bash
npm install makethisbetter
```

```js
import { MakeThisBetter } from 'makethisbetter'

MakeThisBetter.init({ projectKey: 'mtb_proj_YOUR_KEY' })
```

That's it. A feedback tab appears on your page.

## How It Works

```
User clicks feedback tab
  -> Annotates the problem (click to pin, drag to draw)
  -> Adds a comment
  -> Submits
     +-- Screenshot captured automatically
     +-- Console errors collected
     +-- Page context assembled (URL, browser, OS, selectors)
     +-- Sent to Make This Better API
     +-- AI asks a clarifying question if needed
  -> Dashboard shows structured feedback
  -> AI triage produces an agent-ready task
  -> Your coding agent picks it up and ships the fix
  -> User gets notified: the fix is live
```

## Framework Guides

<details>
<summary><strong>React / Next.js</strong></summary>

```tsx
// app/providers.tsx (App Router) or pages/_app.tsx (Pages Router)
'use client'
import { useEffect } from 'react'

export function FeedbackProvider() {
  useEffect(() => {
    import('makethisbetter').then(({ MakeThisBetter }) => {
      MakeThisBetter.init({
        projectKey: process.env.NEXT_PUBLIC_MTB_KEY!,
        user: { id: userId, email }
      })
    })
    return () => {
      import('makethisbetter').then(({ MakeThisBetter }) => MakeThisBetter.destroy())
    }
  }, [])
  return null
}
```

</details>

<details>
<summary><strong>Vue / Nuxt</strong></summary>

```ts
// plugins/makethisbetter.client.ts (Nuxt) or main.ts (Vue)
import { MakeThisBetter } from 'makethisbetter'

export default defineNuxtPlugin(() => {
  MakeThisBetter.init({
    projectKey: useRuntimeConfig().public.mtbKey,
  })

  return {
    provide: { mtbDestroy: () => MakeThisBetter.destroy() }
  }
})
```

</details>

<details>
<summary><strong>Astro</strong></summary>

```astro
<!-- src/components/Feedback.astro -->
<script>
  import { MakeThisBetter } from 'makethisbetter'
  MakeThisBetter.init({ projectKey: import.meta.env.PUBLIC_MTB_KEY })
</script>
```

</details>

<details>
<summary><strong>Rails</strong></summary>

```erb
<%# app/views/layouts/application.html.erb %>
<% if current_user&.admin? %>
  <script src="https://unpkg.com/makethisbetter@2"></script>
  <script>
    MakeThisBetter.init({
      projectKey: '<%= Rails.application.credentials.mtb_project_key %>',
      user: { id: '<%= current_user.id %>', email: '<%= current_user.email %>' }
    })
  </script>
<% end %>
```

</details>

<details>
<summary><strong>Plain HTML / Static Sites</strong></summary>

```html
<script src="https://unpkg.com/makethisbetter@2"></script>
<script>
  MakeThisBetter.init({ projectKey: 'mtb_proj_YOUR_KEY' })
</script>
```

</details>

## Features

### Annotation

Click any element to pin it, or drag to draw a freeform highlight. The SDK captures the element's CSS selector, text content, and position.

### Interaction Replay

Switch to **Replay** mode in the toolbar to capture an Interaction Replay (up to 60 seconds). It records rrweb DOM and interaction events with input values masked by default; it does not capture screen video or audio and does not request browser media permissions. The recorder loads lazily, so there is zero cost until the reporter starts a replay.

### Frustration Detection

The SDK watches for signals that a user is struggling and proactively offers to collect feedback:

| Signal | Trigger |
|--------|---------|
| Rage click | 3+ clicks on the same element within 1 second |
| Dead click | Click on a non-interactive element (with console errors) |
| Dead click (DOM) | Click on interactive-looking element with no DOM response |
| Rapid navigation | 3+ page navigations within 5 seconds |
| Form failure | Form submission with validation errors |
| Error page | Landing on a 404/500 error page |

Disable with `frustrationDetection: false`.

### AI Clarification

Before final confirmation, an AI assistant may ask one short follow-up question to clarify the real need — avoiding [XY problems](https://xyproblem.info/) where users describe their attempted solution instead of the actual problem.

### Auto-Collected Context

Every submission automatically includes:

- Page URL, browser, OS, screen resolution
- Console errors (via `window.onerror` and `window.onunhandledrejection`)
- Target element selector and text
- Annotated screenshot (via `html-to-image`)
- Annotation coordinates and draw paths

### Internationalization

Built-in support for 7 languages:

| Code | Language |
|------|----------|
| `en` | English (default) |
| `zh-CN` | Chinese (Simplified) |
| `ja` | Japanese |
| `ko` | Korean |
| `es` | Spanish |
| `fr` | French |
| `de` | German |

## Configuration

```js
MakeThisBetter.init({
  // Required
  projectKey: 'mtb_proj_xxx',

  // Optional
  locale: 'en',              // UI language
  position: 'right',         // Tab position: 'left' | 'right'
  theme: 'auto',             // 'light' | 'dark' | 'auto'
  frustrationDetection: true, // Proactive frustration prompts
  apiUrl: 'https://...',     // Self-hosted API endpoint

  // User identification (recommended)
  user: {
    id: 'usr_123',
    email: 'alex@example.com',
    name: 'Alex Chen',
  },
})
```

### Identity Verification

Identity verification links feedback to authenticated users and lets them view their own submissions on the feedback board.

**Level 0 -- Anonymous** (default): No user token. Feedback is anonymous.

```js
MakeThisBetter.init({ projectKey: 'mtb_proj_xxx' })
```

**Level 1 -- Static token**: Pass a pre-generated JWT. Simple, but the token may expire during long sessions.

```js
MakeThisBetter.init({
  projectKey: 'mtb_proj_xxx',
  userToken: 'eyJhbGciOiJIUzI1NiIs...',
})
```

**Level 2 -- Dynamic token (recommended)**: Pass an async function that returns a fresh JWT. The SDK calls it before each API request, so tokens never go stale.

```js
MakeThisBetter.init({
  projectKey: 'mtb_proj_xxx',
  userTokenFn: async () => {
    const res = await fetch('/api/mtb-token')
    const { token } = await res.json()
    return token
  },
})
```

When `userToken` or `userTokenFn` is set, the widget sends an `X-User-Token` header with every request. After final confirmation, a "View my feedback" link appears that opens the project board filtered to the user's submissions.

Generate tokens server-side using your project's HMAC secret (available in your project settings):

```ruby
# Rails example
payload = { sub: current_user.id, email: current_user.email, exp: 1.hour.from_now.to_i }
JWT.encode(payload, project.widget_secret, 'HS256')
```

### Conditional Loading

```js
// Only show to beta users
if (user.isBetaTester) {
  MakeThisBetter.init({ projectKey: 'mtb_proj_xxx', user: { id: user.id } })
}
```

## Self-Hosting

The Widget works with any backend — not just makethisbetter.dev. Implement one API endpoint and point `apiUrl` at your server:

```js
MakeThisBetter.init({
  projectKey: 'your-key',
  apiUrl: 'https://feedback.yoursite.com',
})
```

Your backend needs to support the Submission Session flow: create a Session with multipart context, clarify it with the in-memory Submission Token, then explicitly finalize or abandon it. The Widget takes care of annotation, Interaction Replay, frustration detection, and context collection.

The cloud platform at [makethisbetter.dev](https://makethisbetter.dev) adds AI triage, dashboard, GitHub/Linear sync, and email notifications on top.

## API

```ts
import { MakeThisBetter } from 'makethisbetter'

// Start the widget
MakeThisBetter.init(config: MakeThisBetterConfig): void

// Remove the widget and clean up all listeners
MakeThisBetter.destroy(): void
```

## Architecture

The widget runs inside a Shadow DOM container, isolating its styles from your page. No CSS conflicts, no z-index wars.

```
Shadow DOM Host (#mtb-widget-host)
+-- Feedback Tab (entry point)
+-- Annotation Toolbar (Mark up / Replay toggle)
+-- Annotation Session (pin + draw overlays)
+-- Comment Popup (description + submit)
+-- AI Clarification Card (follow-up conversation)
+-- Success Card (confirmation)
+-- Frustration Prompt (proactive trigger)
```

## Bundle Size

| Format | Size | gzip |
|--------|------|------|
| IIFE | ~77 KB | ~23 KB |
| ESM | ~90 KB | ~24 KB |

The rrweb recorder (~78 KB) is loaded on demand when Interaction Replay starts and is not included in these numbers.

## Development

```bash
git clone https://github.com/makethisbetter/makethisbetter-js.git
cd makethisbetter-js
npm install
npm run dev          # Dev server at localhost:5173
npm run build        # Build all formats to dist/
npm test             # Run tests
npm run type-check   # TypeScript validation
```

## Related

| Package | What it does |
|---------|-------------|
| [Make This Better](https://makethisbetter.dev) | The platform — dashboard, AI triage, feedback board |
| [@makethisbetter/mcp](https://github.com/makethisbetter/mcp) | MCP server — your coding agent reads feedback directly |
| [makethisbetter CLI](https://github.com/makethisbetter/cli) | Terminal tool for managing feedback |
| [makethisbetter Skills](https://github.com/makethisbetter/skills) | Claude Code skills — `/makethisbetter` in your editor |

## License

[MIT](LICENSE)

---

<details>
<summary><strong>GitHub repo settings</strong></summary>

- **Description**: Drop-in feedback widget — from rage click to agent-ready fix
- **Homepage**: https://makethisbetter.dev
- **Topics**: feedback, widget, ai, mcp, claude-code, cursor, vibe-coding

</details>
