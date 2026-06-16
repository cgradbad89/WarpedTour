"use client";

import { useState } from "react";

// Artist avatar: image with graceful fallback to initials when the image is
// missing (1 band has none) or fails to load. Deezer CDN images are https
// (PRD §6), so a plain <img> avoids next/image remote-host config.

function initials(name: string): string {
  const parts = name
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({
  name,
  image,
  size = 44,
}: {
  name: string;
  image: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size };

  if (image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full bg-muted object-cover"
        style={dim}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
      style={{ ...dim, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}
