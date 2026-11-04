"use client";

import { Button, textLink } from "@zeno/ui";
import { useState } from "react";

/// The ways out of a card: copy its link, post it, or save the image. The image is the same route the
/// social preview uses, so what is saved is what a feed shows. A card carries only what is already public
/// on chain.
export function PnlShare({ path, text }: { path: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${path}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        onClick={() => {
          void navigator.clipboard?.writeText(url()).then(() => setCopied(true));
        }}
      >
        {copied ? "Link copied" : "Copy link"}
      </Button>
      <Button onClick={() => window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url())}`, "_blank", "noopener,noreferrer")}>Post on X</Button>
      <a href={`${path}/opengraph-image`} download="zeno-pnl-card.png" className={textLink}>
        Save image
      </a>
    </div>
  );
}
