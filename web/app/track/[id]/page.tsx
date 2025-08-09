import Link from "next/link";

export default function TrackPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { title?: string };
}) {
  const { id } = params;
  const title = searchParams.title ? decodeURIComponent(searchParams.title) : "(unknown title)";

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/">← Back</Link>
      </div>
      <h1>Song</h1>
      <p style={{ fontSize: 18 }}><strong>Title:</strong> {title}</p>
      <p style={{ color: "#888" }}>Track ID: {id}</p>
    </div>
  );
}


