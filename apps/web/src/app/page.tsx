import { getStore } from "@sentinyx/store";
import { Landing } from "@/components/Landing";
import { targetKey } from "@/lib/check";
import { buildReceipt, type LandingReceipt } from "@/lib/landing-receipt";

// The receipt on this page is a real scan of the demo coin, refreshed every few minutes.
export const revalidate = 300;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

async function demoReceipt(): Promise<LandingReceipt | null> {
  const coin = process.env.NEXT_PUBLIC_DEMO_COIN;
  const key = coin ? targetKey(coin) : null;
  if (!key) return null;
  try {
    const found = await getStore().findRecent(key, YEAR_MS);
    return found ? buildReceipt(found.report, found.id) : null;
  } catch {
    return null; // no database or no stored scan: the page falls back to its labelled illustration
  }
}

export default async function Home() {
  return <Landing receipt={await demoReceipt()} />;
}
