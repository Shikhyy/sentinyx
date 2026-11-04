import { badgeState, badgeSvg } from "@/lib/check";
import { getStore } from "@sentinyx/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ target: string }> }) {
  const { target } = await params;
  const raw = decodeURIComponent(target).replace(/\.svg$/i, "");
  const state = await badgeState(getStore(), raw);
  return new Response(badgeSvg(state), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
