# extension

> Chrome MV3 extension for HyreAgent.ai — one-click apply across Greenhouse, Lever, Workday, and other ATS surfaces.

## Purpose

The extension reads ATS application pages (Greenhouse, Lever, Workday, etc.), auto-fills standard fields from the user's HyreAgent profile, and (with user confirmation) submits Applications back to the platform via the API gateway.

## Status

> ⚠️ **Pre-rebuild.** The current extension code carries critical findings (ARCH-01, BOLA-01, SEC-03..06, RELI-17) and is being rebuilt during the THIS MONTH milestone of the [migration roadmap](https://github.com/HyreAgent-ai/docs/wiki/Migration-current-to-target). Do **not** publish to the Chrome Web Store until the rebuild is verified by a security pass.

## Tech stack

| Layer | Choice |
| --- | --- |
| Manifest | Chrome MV3 |
| Language | TypeScript |
| Auth | `@supabase/supabase-js` with `chrome.storage.local` adapter (real per-user sessions, not anon JWT) |
| Build | Vite + `crxjs/vite-plugin` |
| Testing | Vitest for adapter logic; Playwright for end-to-end against fixture HTML |
| Lint / format | ESLint (shared config) + Prettier |

## Repo layout (target)

```
src/
├── manifest.json            # MV3 manifest with narrow host_permissions
├── background/              # service worker
│   ├── auth.ts              # Supabase session lifecycle
│   ├── messages.ts          # chrome.runtime.onMessage with sender.tab.url allowlist
│   └── api.ts               # talks to platform via fetch (Bearer = real user JWT)
├── content/
│   ├── overlay.ts           # injected UI on supported ATS pages
│   └── adapters/
│       ├── greenhouse.ts    # field-mapping for jobs.greenhouse.io
│       ├── lever.ts         # field-mapping for jobs.lever.co
│       └── workday.ts       # field-mapping for *.workday.com
├── popup/
│   └── App.tsx              # extension toolbar popup
├── options/
│   └── Options.tsx          # settings page
└── shared/
    └── types.ts             # imported from @hyreagent-ai/common
```

## `host_permissions` policy

The extension declares narrow host permissions, NOT `https://*/*`:

```json
"host_permissions": [
  "https://*.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://*.myworkdayjobs.com/*"
]
```

Every additional ATS adds one new permission entry, justified in the Chrome Web Store listing. See [SEC-03 in security/findings](https://github.com/HyreAgent-ai/security/issues?q=label%3Aaudit-finding+SEC-03).

## Prerequisites

- Node.js ≥ 22
- Chrome ≥ 138 for development
- Access to `HyreAgent-ai/platform` for typed API client + Zod schemas

## Getting started

```bash
git clone -b dev git@github.com:HyreAgent-ai/extension.git
cd extension
npm install
cp .env.example .env.local
npm run dev      # watch mode; writes to dist/
```

Then in Chrome: `chrome://extensions` → toggle Developer mode → "Load unpacked" → select `dist/`.

## Branching

- `main` → tagged release artifact uploaded to Chrome Web Store
- `dev` → integration; built as `.zip` for internal testing
- Feature branches: `<username>_<issue#>_<short>`

## Threat model

Documented in [docs/wiki/Extension-Threat-Model](https://github.com/HyreAgent-ai/docs/wiki/Extension-Threat-Model) — covers the BOLA-01, SEC-03..06 cluster and the rebuild approach. Read before contributing.

## Contributing

See [CONTRIBUTING.md](https://github.com/HyreAgent-ai/.github/blob/main/CONTRIBUTING.md). Every PR to extension code needs an explicit reviewer note on the security implications (manifest changes, new content-script paths, new message handlers).

## License

[Apache-2.0](./LICENSE)

## Contact

- Maintainer: [@Siddardth7](https://github.com/Siddardth7)
- Security disclosures: see [SECURITY.md](https://github.com/HyreAgent-ai/.github/blob/main/SECURITY.md)
