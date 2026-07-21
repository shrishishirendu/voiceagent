/**
 * Supabase Storage integration for invoice PDFs.
 *
 * Replaces the Google Drive file layer. All access uses the service-role key and
 * happens server-side only (API routes proxy downloads) so the bucket stays private
 * and the key never reaches the browser.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface StoredFile {
  path: string;
  name: string;
  size: number | null;
  modifiedTime: string;
}

function getBucket(): string {
  return process.env.SUPABASE_INVOICE_BUCKET ?? "invoices";
}

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

// Storage keys: keep it filesystem-safe and URL-friendly.
function safeName(name: string): string {
  const base = name.replace(/[^\w.\- ]/g, "_").replace(/\s+/g, "_");
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

// Create the (private) bucket if it doesn't already exist. Used by setup + migration.
export async function ensureInvoiceBucket(): Promise<void> {
  const supabase = getClient();
  const bucket = getBucket();
  const { data } = await supabase.storage.getBucket(bucket);
  if (data) return;
  const { error } = await supabase.storage.createBucket(bucket, { public: false });
  // Ignore "already exists" races.
  if (error && !/exists/i.test(error.message)) throw error;
}

export async function listInvoiceFiles(): Promise<StoredFile[]> {
  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(getBucket())
    .list("", { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
  if (error) throw error;
  return (data ?? [])
    .filter((o) => o.name.toLowerCase().endsWith(".pdf"))
    .map((o) => ({
      path: o.name,
      name: o.name,
      size: (o.metadata?.size as number | undefined) ?? null,
      modifiedTime: o.updated_at ?? o.created_at ?? new Date().toISOString(),
    }));
}

export async function downloadInvoiceFile(path: string): Promise<Buffer> {
  const supabase = getClient();
  const { data, error } = await supabase.storage.from(getBucket()).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Store a PDF and return its storage path. Idempotent on name (upsert overwrites),
// so re-running the Drive migration doesn't create duplicates.
export async function uploadInvoiceFile(
  name: string,
  body: Buffer,
  contentType = "application/pdf"
): Promise<string> {
  const supabase = getClient();
  const path = safeName(name);
  const { error } = await supabase.storage
    .from(getBucket())
    .upload(path, body, { contentType, upsert: true });
  if (error) throw error;
  return path;
}
