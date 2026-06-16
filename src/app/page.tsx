"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("Loading band data…");

  useEffect(() => {
    fetch("/bands.json")
      .then((res) => res.json())
      .then((data) => setStatus(`${data.bands.length} bands loaded`))
      .catch(() => setStatus("Failed to load band data."));
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Vans Warped Tour — Long Beach 2026 · July 25–26</h1>
      <p>{status}</p>
    </main>
  );
}
