## Web app

Next.js App Router project that visualizes Spotify tracks with a 3D scene.

### Setup
1. Create `.env.local` in this directory with:
   ```bash
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   NEXTAUTH_SECRET=your_random_string
   NEXTAUTH_URL=http://localhost:3000
   ```
2. Install deps and run:
   ```bash
   npm install
   npm run dev
   ```
3. Open `http://localhost:3000` and sign in with Spotify.

### Scripts
```bash
npm run dev    # dev server
npm run build  # production build
npm run start  # serve production build
```

### Notes
- OAuth redirect must be configured in your Spotify app as `http://localhost:3000/api/auth/callback/spotify`.
- The 3D canvas renders client-side; ensure hardware acceleration is enabled.
