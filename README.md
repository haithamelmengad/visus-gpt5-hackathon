## Visus (Hackathon)

3D, audio–reactive visualizer for Spotify tracks. The web app lives in `web/` and is a Next.js App Router project. It generates a procedural 3D model for a track and animates it to the audio preview.

### Prerequisites
- Node.js 20+ and npm 10+ (or pnpm/yarn/bun if you prefer)
- A Spotify Developer application (Client ID and Client Secret)
- A random `NEXTAUTH_SECRET`

### Spotify setup
- Go to the Spotify Developer Dashboard and create an app. https://developer.spotify.com/
- Add the redirect URI: `http://localhost:3000/api/auth/callback/spotify`.
- Copy the Client ID and Client Secret.

### OpenAI setup
- Create an OpenAI account if you don't have one already. https://platform.openai.com/
- Generate an API key

### Meshy setup
- Create a Meshy account. https://www.meshy.ai/discover
- Create an API key https://www.meshy.ai/settings/api
  
### Quickstart (Humans)
1. Open a terminal at the repo root and move into the web app:
   ```bash
   cd web
   ```
2. Create `web/.env.local` with the following variables:
   ```bash
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   NEXTAUTH_SECRET=your_random_string
   NEXTAUTH_URL=http://localhost:3000
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_MODEL=gpt5
   MESHY_API_KEY=your_meshy_api_key
   ```
3. Install and run the dev server:
   ```bash
   npm install
   npm run dev
   ```
4. Visit `http://localhost:3000` in your browser.
5. Sign in with Spotify. Pick a track and enjoy the visualization.

### Common commands
```bash
cd web
npm run dev      # start dev server on :3000
npm run build    # production build
npm run start    # run production build (after `npm run build`)
```

### Troubleshooting
- 401 or login loop: ensure the redirect URI exactly matches `http://localhost:3000/api/auth/callback/spotify` in the Spotify app settings and that `SPOTIFY_CLIENT_ID/SECRET` are correct.
- Blank or frozen canvas: check the browser console; reload after toggling Play/Pause. Ensure hardware acceleration is enabled.

### Project layout
- `web/app/` – Next.js App Router pages and API routes
- `web/components/ThreeScene.tsx` – procedural 3D model generator and animation
- `web/components/TrackPlayer.tsx` – audio preview + play/pause + level metering
- `web/app/api/spotify/recent/route.ts` – fetch recently played tracks

---

### Runbook (Agents)
Provide the following deterministic steps for non‑interactive execution:
1. `cd web`
2. If `.env.local` does not exist, create it with keys: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL=http://localhost:3000`.
3. Install deps: `npm ci || npm install`.
4. Start dev server non‑interactively: `npm run dev`.
5. Health‑check: poll `http://localhost:3000` for HTTP 200 within 60s.
6. When finished, stop the dev server process.

Environment schema (required):
```
SPOTIFY_CLIENT_ID=<string>
SPOTIFY_CLIENT_SECRET=<string>
NEXTAUTH_SECRET=<string>
NEXTAUTH_URL=http://localhost:3000
```

Notes for agents:
- The app expects the OAuth redirect at `/api/auth/callback/spotify`.
- The 3D visualizer depends on a running browser; no server‑side rendering of the canvas.
