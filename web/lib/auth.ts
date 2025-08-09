import type { NextAuthOptions, User } from "next-auth";
import SpotifyProvider from "next-auth/providers/spotify";

type JWTToken = {
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  sub?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpires?: number; // epoch ms
  error?: string;
};

async function refreshAccessToken(token: JWTToken): Promise<JWTToken> {
  try {
    if (!token.refreshToken) {
      return { ...token, error: "MissingRefreshToken" };
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const params = new URLSearchParams();
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", token.refreshToken);

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      // Spotify requires form-encoded body
    });

    const refreshed = (await response.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number; // seconds
      refresh_token?: string;
      error?: string;
    };

    if (!response.ok || !refreshed.access_token) {
      return { ...token, error: refreshed.error ?? "RefreshAccessTokenError" };
    }

    return {
      ...token,
      accessToken: refreshed.access_token,
      // If Spotify returns a new refresh token, use it; else keep the old one
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      accessTokenExpires: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
      error: undefined,
    };
  } catch (error) {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization:
        "https://accounts.spotify.com/authorize?scope=user-read-recently-played",
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, user }) {
      const jwtToken = token as JWTToken;

      // Initial sign-in
      if (account && user) {
        const expiresInSeconds =
          // Some providers supply expires_in, some expires_at
          (account as any).expires_in ??
          ((account as any).expires_at ?
            Math.max(0, (account as any).expires_at - Math.floor(Date.now() / 1000)) :
            3600);

        return {
          ...jwtToken,
          accessToken: (account as any).access_token,
          refreshToken: (account as any).refresh_token,
          accessTokenExpires: Date.now() + expiresInSeconds * 1000,
        } as JWTToken;
      }

      // Return previous token if the access token is still valid
      if (jwtToken.accessToken && jwtToken.accessTokenExpires && Date.now() < jwtToken.accessTokenExpires) {
        return jwtToken;
      }

      // Access token has expired, try to refresh
      return await refreshAccessToken(jwtToken);
    },
    async session({ session, token }) {
      const jwtToken = token as JWTToken;
      (session as any).accessToken = jwtToken.accessToken;
      (session as any).error = jwtToken.error;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};


