import { describe, expect, it } from "vitest";
import { cleanDatabaseUrl } from "../src/index.js";

const NEON = "postgresql://user:pa%24%24@ep-cool-name-123456-pooler.us-east-1.aws.neon.tech/neondb";

describe("cleanDatabaseUrl", () => {
  it("drops channel_binding but keeps sslmode and the rest of the URL intact", () => {
    const out = cleanDatabaseUrl(`${NEON}?sslmode=require&channel_binding=require`);
    expect(out).toBe(`${NEON}?sslmode=require`);
    expect(new URL(out).password).toBe("pa%24%24"); // credentials are not re-encoded or altered
  });
  it("works when channel_binding is the only parameter, or comes first", () => {
    expect(cleanDatabaseUrl(`${NEON}?channel_binding=require`)).toBe(NEON);
    expect(cleanDatabaseUrl(`${NEON}?channel_binding=require&sslmode=require`)).toBe(`${NEON}?sslmode=require`);
  });
  it("returns URLs that need no change exactly as given", () => {
    for (const u of [NEON, `${NEON}?sslmode=require`, "postgres://postgres:postgres@127.0.0.1:5432/postgres"]) expect(cleanDatabaseUrl(u)).toBe(u);
  });
  it("does not throw on things that are not URLs", () => {
    expect(cleanDatabaseUrl("/var/run/postgresql")).toBe("/var/run/postgresql");
    expect(cleanDatabaseUrl("")).toBe("");
  });
});
