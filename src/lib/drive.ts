import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import * as XLSX from "xlsx";
import { Readable } from "stream";
import { companyNamesMatch } from "./nameUtils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DriveInvoiceFile {
  fileId: string;
  name: string;
  size: number | null;
  modifiedTime: string;
}

export interface ContactRow {
  businessName: string;
  abn: string | null;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
}

export interface NewContact {
  businessName: string;
  abn?: string | null;
  email?: string | null;
  contactPerson?: string | null;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

let _drive: drive_v3.Drive | null = null;

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");

  let key: { client_email: string; private_key: string };
  try {
    key = JSON.parse(keyJson);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON");
  }

  const privateKey = key.private_key.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email: key.client_email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

function getDriveClient(): drive_v3.Drive {
  if (_drive) return _drive;
  _drive = google.drive({ version: "v3", auth: getAuth() });
  return _drive;
}

function getFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set");
  return id;
}

function getContactsSheetName(): string {
  return (
    process.env.GOOGLE_DRIVE_CONTACTS_SHEET_NAME ?? "Business Contact Details"
  );
}

// ─── File listing (PDFs) ─────────────────────────────────────────────────────

export async function listDriveInvoices(): Promise<DriveInvoiceFile[]> {
  const drive = getDriveClient();
  const folderId = getFolderId();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: "files(id,name,size,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 200,
  });

  return (res.data.files ?? []).map((f) => ({
    fileId: f.id!,
    name: f.name ?? "Unknown",
    size: f.size ? Number(f.size) : null,
    modifiedTime: f.modifiedTime ?? new Date().toISOString(),
  }));
}

// ─── File download ───────────────────────────────────────────────────────────

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );

  return Buffer.from(res.data as ArrayBuffer);
}

// ─── Contacts sheet ───────────────────────────────────────────────────────────
// Accepts both .xlsx and native Google Sheets (converted to xlsx on download).
// The spreadsheet must already exist in the folder — the service account has
// writer access to update it but cannot create new Drive files (no quota).

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GSHEET_MIME = "application/vnd.google-apps.spreadsheet";

async function findContactsSheet(): Promise<{ fileId: string; isGSheet: boolean } | null> {
  const drive = getDriveClient();
  const folderId = getFolderId();
  const baseName = getContactsSheetName().replace(/\.xlsx$/i, "");

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and (mimeType='${XLSX_MIME}' or mimeType='${GSHEET_MIME}')`,
    fields: "files(id,name,mimeType)",
    pageSize: 20,
  });

  const files = res.data.files ?? [];
  // Match by name (strip .xlsx suffix for comparison, case-insensitive)
  const matches = files.filter((f) => {
    const n = (f.name ?? "").replace(/\.xlsx$/i, "").toLowerCase();
    return n === baseName.toLowerCase();
  });
  if (matches.length === 0) return null;

  // Prefer a native Google Sheet over a stray .xlsx with the same name, so writes
  // are deterministic and land in the file the user maintains.
  const preferred = matches.find((f) => f.mimeType === GSHEET_MIME) ?? matches[0];
  if (matches.length > 1) {
    console.warn(
      `[drive] Found ${matches.length} files named "${baseName}" in the folder: ` +
      matches.map((f) => `${f.name} (${f.mimeType === GSHEET_MIME ? "GSheet" : "xlsx"}, ${f.id})`).join(", ") +
      `. Using ${preferred.mimeType === GSHEET_MIME ? "the native Google Sheet" : "xlsx"} ${preferred.id}. ` +
      `Remove the duplicate to avoid confusion.`
    );
  }
  if (!preferred.id) return null;
  return { fileId: preferred.id, isGSheet: preferred.mimeType === GSHEET_MIME };
}

function parseWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer" });
}

function parseRows(wb: XLSX.WorkBook): ContactRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
    defval: "",
    raw: false,
  });
  if (raw.length === 0) return [];

  // Map column headers case-insensitively
  const headerRow = raw[0];
  const headerMap: Record<string, string> = {};
  for (const key of Object.keys(headerRow)) {
    headerMap[key.toLowerCase().trim()] = key;
  }
  const col = (name: string) => headerMap[name] ?? name;

  return raw
    .map((r) => ({
      businessName: String(r[col("business name")] ?? "").trim(),
      abn: String(r[col("abn")] ?? "").trim() || null,
      phone: String(r[col("phone")] ?? "").trim() || null,
      email: String(r[col("email")] ?? "").trim() || null,
      contactPerson: String(r[col("contact person")] ?? "").trim() || null,
    }))
    .filter((r) => r.businessName.length > 0);
}

async function downloadSheetAsXlsx(fileId: string, isGSheet: boolean): Promise<Buffer> {
  const drive = getDriveClient();

  if (isGSheet) {
    // Export native Google Sheet as xlsx
    const res = await drive.files.export(
      { fileId, mimeType: XLSX_MIME },
      { responseType: "arraybuffer" }
    );
    return Buffer.from(res.data as ArrayBuffer);
  }

  return downloadDriveFile(fileId);
}

export async function readContactsSheet(): Promise<{ fileId: string | null; rows: ContactRow[] }> {
  const found = await findContactsSheet();
  if (!found) return { fileId: null, rows: [] };

  const buffer = await downloadSheetAsXlsx(found.fileId, found.isGSheet);
  const rows = parseRows(parseWorkbook(buffer));
  return { fileId: found.fileId, rows };
}

// ─── Write lock ──────────────────────────────────────────────────────────────

// Serialises writes so concurrent dispatches don't race.
// Uses a "always-resolving" lock so a failed write never poisons future calls.
let _writeLock: Promise<void> = Promise.resolve();

// ─── Add missing contacts ────────────────────────────────────────────────────

export async function addMissingContacts(
  newContacts: NewContact[]
): Promise<{ added: number; skippedNoSheet?: boolean }> {
  let added = 0;
  let skippedNoSheet = false;
  let writeError: Error | null = null;

  const prevLock = _writeLock;

  const myWork = async () => {
    // Wait for any in-flight write to finish first (ignore its errors)
    try { await prevLock; } catch {}

    const drive = getDriveClient();
    const found = await findContactsSheet();

    if (!found) {
      skippedNoSheet = true;
      console.warn(
        `[drive] Contacts spreadsheet not found. Create "${getContactsSheetName()}" in the Drive folder with headers: Business Name, ABN, Phone, Email, Contact Person`
      );
      return;
    }

    // Download the xlsx (export if native GSheet)
    const buffer = await downloadSheetAsXlsx(found.fileId, found.isGSheet);
    const wb = parseWorkbook(buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];

    const existing = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
      defval: "",
      raw: false,
    });

    // Build header map from the first data row (sheet_to_json uses first row as keys)
    const firstRow = existing[0] ?? {};
    const headerMap: Record<string, string> = {};
    for (const key of Object.keys(firstRow)) {
      headerMap[key.toLowerCase().trim()] = key;
    }
    const col = (name: string) => headerMap[name] ?? name;
    const existingNames = existing.map((r) =>
      String(r[col("business name")] ?? "").trim()
    );

    const toAdd: Array<Record<string, string>> = [];

    for (const contact of newContacts) {
      if (!contact.businessName) continue;
      const alreadyExists = existingNames.some((name) =>
        companyNamesMatch(name, contact.businessName)
      );
      if (alreadyExists) continue;
      toAdd.push({
        "Business Name": contact.businessName,
        "ABN": contact.abn ?? "",
        "Phone": "",
        "Email": contact.email ?? "",
        "Contact Person": contact.contactPerson ?? "",
      });
      existingNames.push(contact.businessName);
      added++;
    }

    if (toAdd.length === 0) return;

    if (!found.isGSheet) {
      XLSX.utils.sheet_add_json(ws, toAdd, { skipHeader: true, origin: -1 });
      const newBuf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
      await drive.files.update({
        fileId: found.fileId,
        media: { mimeType: XLSX_MIME, body: Readable.from(newBuf) },
      });
    } else {
      // For native GSheets: read the actual header row to align columns correctly
      const sheets = google.sheets({ version: "v4", auth: getAuth() });
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId: found.fileId,
        range: "1:1",
      });
      const sheetHeaders = (headerRes.data.values?.[0] ?? []).map((h) => String(h).toLowerCase().trim());

      const FIELD_KEYS: Record<string, string> = {
        "business name": "Business Name",
        "abn": "ABN",
        "phone": "Phone",
        "email": "Email",
        "contact person": "Contact Person",
      };

      const rowValues = toAdd.map((r) => {
        if (sheetHeaders.length > 0) {
          return sheetHeaders.map((h) => {
            const fieldKey = FIELD_KEYS[h];
            return fieldKey ? (r[fieldKey] ?? "") : "";
          });
        }
        // Fallback if we can't read headers: assume standard A–E order
        return [r["Business Name"], r["ABN"], r["Phone"], r["Email"], r["Contact Person"]];
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId: found.fileId,
        range: "A:A",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rowValues },
      });
    }
  };

  // Run work; capture error but always resolve the shared lock so future calls aren't blocked
  _writeLock = myWork().catch((err) => {
    writeError = err instanceof Error ? err : new Error(String(err));
    console.error("[drive] addMissingContacts failed:", writeError.message);
  });

  await _writeLock;
  if (writeError) throw writeError;
  return { added, skippedNoSheet };
}

// ─── Phone resolution ────────────────────────────────────────────────────────

export function resolvePhoneFromContacts(
  rows: ContactRow[],
  contactBusiness: string
): { phone: string | null; person: string | null } {
  const match = rows.find((r) =>
    companyNamesMatch(r.businessName, contactBusiness)
  );
  if (!match) return { phone: null, person: null };
  return { phone: match.phone || null, person: match.contactPerson || null };
}
