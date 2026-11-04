"use client";

import { useEffect, useState } from "react";

/** A visible way to open the palette: not everyone knows ⌘K, and phones have no keyboard shortcut. */
export function PaletteHint() {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/i.test(navigator.userAgent)), []);
  return (
    <button type="button" className="pal-hint mono" onClick={() => dispatchEvent(new Event("sentinyx:palette"))}>
      Quick scan <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
