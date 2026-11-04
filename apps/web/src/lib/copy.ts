/** User-facing strings shared by server and client code. Keep in sync with packages/scanner BAD_TARGET. */
export const BAD_TARGET_COPY = "Paste a Base contract (0x…), an NFT as 0x…#id, or a name ending in .eth.";

// Set NEXT_PUBLIC_DEMO_COIN to the Base Sepolia demo coin's address to add it as a one-click example.
const demo = process.env.NEXT_PUBLIC_DEMO_COIN;

export const EXAMPLES = [
  { label: "USD Coin", value: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { label: "jesse.base.eth", value: "jesse.base.eth" },
  ...(demo && /^0x[a-fA-F0-9]{40}$/.test(demo) ? [{ label: "Night Pepe (demo)", value: demo }] : []),
];
