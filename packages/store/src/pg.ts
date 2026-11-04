import postgres from "postgres";
import type { ScanReport } from "@sentinyx/scanner";
import type { CrawlRow, TraceEntry, TraceFilter, CrawlStats, EntryFilter, Label, LedgerItem, LedgerSummary, ScannedRow, Store, StoredScan } from "./types.js";

const iso = (d: unknown) => new Date(d as string).toISOString();

export class PgStore implements Store {
  readonly kind = "postgres" as const;
  private sql: postgres.Sql;
  private ready: Promise<void> | null = null;

  constructor(url: string, opts: { max?: number } = {}) {
    // prepare:false keeps this working behind transaction-mode poolers (Neon, Supabase).
    this.sql = postgres(url, { max: opts.max ?? 3, idle_timeout: 20, connect_timeout: 8, prepare: false });
  }

  private init() {
    this.ready ??= (async () => {
      const sql = this.sql;
      await sql`create table if not exists scans (
        id text primary key, target text not null, kind text not null, title text not null,
        verdict text not null, report jsonb not null, method text not null,
        redacted boolean not null default false, created_at timestamptz not null default now())`;
      await sql`alter table scans add column if not exists redacted boolean not null default false`;
      await sql`create index if not exists scans_target_created on scans (target, created_at desc)`;
      await sql`create table if not exists feedback (
        id bigserial primary key, scan_id text not null, note text not null, created_at timestamptz not null default now())`;
      await sql`create table if not exists rate_hits (key text primary key, count int not null, expires_at timestamptz not null)`;
      await sql`create table if not exists crawls (
        id serial primary key, source text not null, started_at timestamptz not null default now(), finished_at timestamptz,
        discovered int not null default 0, scanned int not null default 0, failed int not null default 0,
        flagged int not null default 0, suspicious int not null default 0)`;
      await sql`create table if not exists ledger_scanned (
        target text primary key, crawl_id int not null, verdict text not null, partial boolean not null default false,
        scan_id text, scanned_at timestamptz not null default now())`;
      await sql`create table if not exists ledger_items (
        id text primary key, target text not null, kind text not null, field text not null, field_label text not null,
        verdict text not null, excerpt_redacted text not null, finding_rules text[] not null default '{}',
        detected_at timestamptz not null default now(), reviewed boolean not null default false, label text,
        scan_id text, crawl_id int not null)`;
      await sql`create table if not exists traces (
        id text primary key, agent text not null, action text not null, args jsonb not null, provenance jsonb not null,
        decision text not null, reason text not null, created_at timestamptz not null)`;
      await sql`create index if not exists traces_created on traces (created_at desc)`;
      await sql`create index if not exists ledger_items_detected on ledger_items (detected_at desc)`;
    })().catch((e) => {
      this.ready = null; // retry next request
      throw e;
    });
    return this.ready;
  }

  async saveScan(s: StoredScan) {
    await this.init();
    const r = s.report;
    await this.sql`insert into scans (id, target, kind, title, verdict, report, method, redacted, created_at)
      values (${s.id}, ${r.target}, ${r.kind}, ${r.title}, ${r.verdict}, ${this.sql.json(r as never)}, ${r.method}, ${s.redacted ?? false}, ${s.createdAt})`;
  }
  private toScan(row: postgres.Row): StoredScan {
    return { id: row.id, report: row.report as ScanReport, createdAt: iso(row.created_at), redacted: row.redacted };
  }
  async getScan(id: string) {
    await this.init();
    const rows = await this.sql`select id, report, created_at, redacted from scans where id = ${id}`;
    return rows.length ? this.toScan(rows[0]) : null;
  }
  async findRecent(target: string, maxAgeMs: number) {
    await this.init();
    const since = new Date(Date.now() - maxAgeMs);
    const rows = await this.sql`select id, report, created_at, redacted from scans
      where target = ${target} and created_at >= ${since} order by created_at desc limit 1`;
    return rows.length ? this.toScan(rows[0]) : null;
  }
  async saveFeedback(f: { scanId: string; note: string; createdAt: string }) {
    await this.init();
    await this.sql`insert into feedback (scan_id, note, created_at) values (${f.scanId}, ${f.note}, ${f.createdAt})`;
  }
  async hit(key: string, windowSec: number) {
    await this.init();
    const exp = new Date(Date.now() + windowSec * 1000);
    const rows = await this.sql`insert into rate_hits (key, count, expires_at) values (${key}, 1, ${exp})
      on conflict (key) do update set
        count = case when rate_hits.expires_at <= now() then 1 else rate_hits.count + 1 end,
        expires_at = case when rate_hits.expires_at <= now() then ${exp} else rate_hits.expires_at end
      returning count`;
    if (Math.random() < 0.02) void this.sql`delete from rate_hits where expires_at < now()`.catch(() => {});
    return Number(rows[0].count);
  }

  private toTrace(r: postgres.Row): TraceEntry {
    return { id: r.id, agent: r.agent, action: r.action, args: r.args, provenance: r.provenance, decision: r.decision, reason: r.reason, createdAt: iso(r.created_at) };
  }
  async addTraces(entries: TraceEntry[]) {
    await this.init();
    let n = 0;
    for (const e of entries) {
      const rows = await this.sql`insert into traces (id, agent, action, args, provenance, decision, reason, created_at)
        values (${e.id}, ${e.agent}, ${e.action}, ${this.sql.json(e.args as never)}, ${this.sql.json(e.provenance as never)}, ${e.decision}, ${e.reason}, ${e.createdAt})
        on conflict (id) do nothing returning id`;
      n += rows.length;
    }
    return n;
  }
  async listTraces(filter: TraceFilter = {}) {
    await this.init();
    const limit = Math.min(filter.limit ?? 200, 1000);
    const rows = filter.decision
      ? await this.sql`select * from traces where decision = ${filter.decision} order by created_at desc limit ${limit}`
      : await this.sql`select * from traces order by created_at desc limit ${limit}`;
    return rows.map((r) => this.toTrace(r));
  }
  async getTrace(id: string) {
    await this.init();
    const rows = await this.sql`select * from traces where id = ${id}`;
    return rows.length ? this.toTrace(rows[0]) : null;
  }

  async ledgerSeen(targets: string[]) {
    await this.init();
    if (!targets.length) return new Set<string>();
    const rows = await this.sql`select target from ledger_scanned where target in ${this.sql(targets)}`;
    return new Set(rows.map((r) => r.target as string));
  }
  async startCrawl(source: string) {
    await this.init();
    const rows = await this.sql`insert into crawls (source) values (${source}) returning id`;
    return Number(rows[0].id);
  }
  async finishCrawl(id: number, s: CrawlStats) {
    await this.init();
    await this.sql`update crawls set finished_at = now(), discovered = ${s.discovered}, scanned = ${s.scanned},
      failed = ${s.failed}, flagged = ${s.flagged}, suspicious = ${s.suspicious} where id = ${id}`;
  }
  async recordScanned(r: ScannedRow) {
    await this.init();
    await this.sql`insert into ledger_scanned (target, crawl_id, verdict, partial, scan_id, scanned_at)
      values (${r.target}, ${r.crawlId}, ${r.verdict}, ${r.partial}, ${r.scanId}, ${r.scannedAt})
      on conflict (target) do update set crawl_id = excluded.crawl_id, verdict = excluded.verdict,
        partial = excluded.partial, scan_id = excluded.scan_id, scanned_at = excluded.scanned_at`;
  }
  async addLedgerItems(items: LedgerItem[]) {
    await this.init();
    for (const i of items) {
      await this.sql`insert into ledger_items (id, target, kind, field, field_label, verdict, excerpt_redacted, finding_rules,
        detected_at, reviewed, label, scan_id, crawl_id)
        values (${i.id}, ${i.target}, ${i.kind}, ${i.field}, ${i.fieldLabel}, ${i.verdict}, ${i.excerptRedacted},
        ${this.sql.array(i.findingRules)}, ${i.detectedAt}, ${i.reviewed}, ${i.label}, ${i.scanId}, ${i.crawlId})
        on conflict (id) do nothing`;
    }
  }
  private toItem(r: postgres.Row): LedgerItem {
    return {
      id: r.id, target: r.target, kind: r.kind, field: r.field, fieldLabel: r.field_label, verdict: r.verdict,
      excerptRedacted: r.excerpt_redacted, findingRules: r.finding_rules, detectedAt: iso(r.detected_at),
      reviewed: r.reviewed, label: r.label, scanId: r.scan_id, crawlId: Number(r.crawl_id),
    };
  }
  async ledgerSummary(): Promise<LedgerSummary> {
    await this.init();
    const sql = this.sql;
    const [[t], [l], byField, [c]] = await Promise.all([
      sql`select count(*) filter (where verdict <> 'error') scanned, count(*) filter (where verdict <> 'error' and partial) partial,
          count(*) filter (where verdict = 'flagged') flagged, count(*) filter (where verdict = 'suspicious') suspicious from ledger_scanned`,
      sql`select count(*) filter (where label is not null) labelled, count(*) filter (where label = 'true_positive') tp,
          count(distinct target) filter (where label = 'true_positive') confirmed from ledger_items`,
      sql`select field, count(*) n from ledger_items group by field order by n desc`,
      sql`select count(*) n from crawls where finished_at is not null`,
    ]);
    const last = await sql`select * from crawls where finished_at is not null order by id desc limit 1`;
    const lastCrawl: CrawlRow | null = last.length
      ? {
          id: Number(last[0].id), source: last[0].source, startedAt: iso(last[0].started_at), finishedAt: iso(last[0].finished_at),
          discovered: last[0].discovered, scanned: last[0].scanned, failed: last[0].failed, flagged: last[0].flagged, suspicious: last[0].suspicious,
        }
      : null;
    const labelled = Number(l.labelled);
    return {
      scanned: Number(t.scanned), partial: Number(t.partial), flagged: Number(t.flagged), suspicious: Number(t.suspicious),
      confirmed: Number(l.confirmed), labelled, precision: labelled ? Number(l.tp) / labelled : null,
      byField: byField.map((r) => ({ field: r.field, count: Number(r.n) })), crawls: Number(c.n), lastCrawl,
    };
  }
  async ledgerEntries(filter: EntryFilter = {}) {
    await this.init();
    const limit = Math.min(filter.limit ?? 100, 500);
    const rows = filter.verdict
      ? await this.sql`select * from ledger_items where verdict = ${filter.verdict} order by detected_at desc limit ${limit}`
      : await this.sql`select * from ledger_items order by detected_at desc limit ${limit}`;
    return rows.map((r) => this.toItem(r));
  }
  async labelItem(id: string, label: Label | null) {
    await this.init();
    const rows = await this.sql`update ledger_items set label = ${label}, reviewed = ${label !== null} where id = ${id} returning id`;
    return rows.length > 0;
  }
}
