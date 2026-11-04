import { cache } from "react";
import { getStore, ID_PATTERN, type StoredScan } from "@sentinyx/store";

/** One lookup per request, shared by the page, its metadata and its share card. */
export const loadScan = cache(async (id: string): Promise<StoredScan | null> => {
  if (!ID_PATTERN.test(id)) return null;
  try {
    return await getStore().getScan(id);
  } catch (e) {
    console.error("loading scan failed", e);
    return null;
  }
});
