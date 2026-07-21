/**
 * Contacts, backed by the `customer` table (folded in from the old Google Sheet).
 *
 * A "contact" is just a Customer row surfaced with the sheet's column shape
 * (businessName / abn / phone / email / contactPerson) so the existing client code
 * and phone-resolution flow keep working unchanged.
 */

import { prisma } from "@/lib/prisma";
import { companyNamesMatch } from "@/lib/nameUtils";
import type { Customer } from "@prisma/client";

export interface ContactRow {
  id: string;
  businessName: string;
  abn: string | null;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
}

export interface NewContact {
  businessName: string;
  abn?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
}

function toRow(c: Customer): ContactRow {
  return {
    id: c.id,
    businessName: c.businessName,
    abn: c.abn,
    phone: c.contactPhone,
    email: c.email1,
    contactPerson: c.contactPerson,
  };
}

const cleanAbn = (abn: string | null | undefined) => (abn ?? "").replace(/\s/g, "");

export async function readContacts(): Promise<ContactRow[]> {
  const customers = await prisma.customer.findMany({ orderBy: { businessName: "asc" } });
  return customers.map(toRow);
}

// Add businesses discovered during bulk parse. Creates a customer (with blank phone)
// only when no existing customer matches by ABN or fuzzy business name — mirrors the
// old sheet's "append missing rows" behaviour.
export async function upsertContacts(contacts: NewContact[]): Promise<{ added: number }> {
  const existing = await prisma.customer.findMany({ select: { id: true, businessName: true, abn: true } });
  let added = 0;
  for (const c of contacts) {
    if (!c.businessName) continue;
    const abn = cleanAbn(c.abn);
    const match = existing.find(
      (e) => (abn && cleanAbn(e.abn) === abn) || companyNamesMatch(e.businessName, c.businessName)
    );
    if (match) continue;
    const created = await prisma.customer.create({
      data: {
        businessName: c.businessName,
        abn: c.abn ?? null,
        contactPhone: c.phone ?? null,
        email1: c.email ?? null,
        contactPerson: c.contactPerson ?? null,
      },
    });
    existing.push({ id: created.id, businessName: created.businessName, abn: created.abn });
    added++;
  }
  return { added };
}

export function resolvePhoneFromContacts(
  rows: ContactRow[],
  contactBusiness: string
): { phone: string | null; person: string | null } {
  const match = rows.find((r) => companyNamesMatch(r.businessName, contactBusiness));
  if (!match) return { phone: null, person: null };
  return { phone: match.phone || null, person: match.contactPerson || null };
}
