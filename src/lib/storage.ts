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

// Every tenant's files live under a `<ownerId>/` prefix so one tenant can't list or
// download another's PDFs. ownerId (a lowercased email) is made key-safe here.
function ownerPrefix(ownerId: string): string {
  return ownerId.replace(/[^\w.\-@]/g, "_");
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

export async function listInvoiceFiles(ownerId: string): Promise<StoredFile[]> {
  const supabase = getClient();
  const prefix = ownerPrefix(ownerId);
  const { data, error } = await supabase.storage
    .from(getBucket())
    .list(prefix, { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
  if (error) throw error;
  return (data ?? [])
    .filter((o) => o.name.toLowerCase().endsWith(".pdf"))
    .map((o) => ({
      // path is the FULL key (prefix included) so downloads round-trip correctly.
      path: `${prefix}/${o.name}`,
      name: o.name,
      size: (o.metadata?.size as number | undefined) ?? null,
      modifiedTime: o.updated_at ?? o.created_at ?? new Date().toISOString(),
    }));
}

export async function downloadInvoiceFile(ownerId: string, path: string): Promise<Buffer> {
  const prefix = ownerPrefix(ownerId);
  // IDOR guard: refuse to serve a key that isn't under this tenant's prefix.
  if (path !== prefix && !path.startsWith(`${prefix}/`)) {
    throw new Error("Forbidden: file does not belong to this tenant");
  }
  const supabase = getClient();
  const { data, error } = await supabase.storage.from(getBucket()).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Store a PDF under the tenant's prefix and return its full storage path. Idempotent
// on name (upsert overwrites), so re-uploading the same file doesn't create duplicates.
export async function uploadInvoiceFile(
  ownerId: string,
  name: string,
  body: Buffer,
  contentType = "application/pdf"
): Promise<string> {
  const supabase = getClient();
  const path = `${ownerPrefix(ownerId)}/${safeName(name)}`;
  const { error } = await supabase.storage
    .from(getBucket())
    .upload(path, body, { contentType, upsert: true });
  if (error) throw error;
  return path;
}
