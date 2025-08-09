import { NextResponse } from "next/server";
import { z } from "zod";

const inputSchema = z.object({ prompt: z.string().min(8) });

// Starts a Meshy text-to-3D generation and returns an id for polling
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { prompt } = parsed.data;
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "Missing MESHY_API_KEY" },
      { status: 500 }
    );

  try {
    const res = await fetch("https://api.meshy.ai/v2/text-to-3d", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "preview",
        prompt,
        topology: "triangle",
        enable_pbr: true,
      }),
    });
    const json = await res.json();
    if (!res.ok) return NextResponse.json(json, { status: res.status });
    return NextResponse.json(json);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Unknown" },
      { status: 500 }
    );
  }
}
