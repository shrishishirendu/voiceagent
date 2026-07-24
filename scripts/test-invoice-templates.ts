/**
 * Deterministic invoice-template tests (Phase 3-B).
 *
 * Runs each vendor template against a text fixture derived from the real sample PDF and
 * asserts the extracted fields. This validates the regex extraction logic independently
 * of pdf-parse. Run: `npx tsx scripts/test-invoice-templates.ts`
 *
 * NOTE: fixtures approximate pdf-parse's text layer. The extractors search globally
 * (not line-anchored) so they tolerate reordering, but confirm end-to-end by uploading
 * the actual PDFs through /api/calls/parse-document too.
 */
import { matchTemplate } from '@/lib/invoice-templates'

const SPICED_TEA = `INVOICE
iSoft Software Pty Ltd, Bella Vista
1 Woolworths Way
Loading Dock 1
Suite 2, Level 2
West Wing
BELLA VISTA NSW 2153
AUSTRALIA
Invoice Date
6 May 2026
Invoice Number
INV-22050
ABN
18 630 456 067
Spiced Tea Chai
28A Powers Rd, Unit 1
SEVEN HILLS NSW 2147
AUSTRALIA
(+61) 458 179 259
info@spicedteachai.com
www.spicedteachai.com
Description Quantity Unit Price GST Amount AUD
Cardamom Tea 5.00 20.00 GST Free 100.00
Masala Tea 3.00 20.00 GST Free 60.00
Ginger Tea 2.00 20.00 GST Free 40.00
Subtotal 200.00
TOTAL  GST 0.00
TOTAL AUD 200.00
Due Date: 15 Jun 2026
* Please add invoice/quote number as your payment reference or we cannot track the payment from you*
Option1: Bank Transfer
Commonwealth Bank of Australia
Account Name: Spiced Tea Chai Pty Ltd
Account BSB: 062-339
Account Number: 11061450
Option 2: PayID using ACN - 630 456 067`

const QUEST = `Invoice
Invoice Number Invoice Date Customer Number Page
4700367116 19-DEC-2025 4668565 1 / 1
Purchase Order Number Quote Number Original Order Date
PO-0015 Q-2159227 19-DEC-2025
Quest Software International Limited
City Gate Park
Cork
Ireland
VAT: IE6379440W
Bill To:
ISOFT SOFTWARE TECHNOLOGIES PTY LTD
Ameet Nandlaskar
Suite 2 Lvl 2, 1 Woolworths Way
BELLA VISTA, NSW 2153
Terms Due Date Salesperson Customer Contact/VAT No. Ship Date
Net 30 18-JAN-26 FRAUMANO, MARCUS JOHN 19-DEC-2025
Remit To: Quest Software International Limited
Deutsche Bank AG
Deutsche Bank Place, Floor 10,
126 Philip Street, Sydney, Australia 2000
Branch# 414111
BSB Account# 180010301
Swift Code:DEUTAU2SGTB
ABN # 59 863 426 362
No. Item No. Item Description Qty. Unit Price Subtotal GST
1 AAF-ERW-TB-247 ERWIN DATA MODELER WORKGROUP EDITION NODE-LOCKED PER SEAT 24X7 TERM LICENSE/MAINT
2 3,745.18 7,490.36 0.00
Total 7,490.36 AUD`

const ALTUS = `Isoft Software Technologies Pty Ltd
jai.upadhyay@isoftanz.com.au Invoice Date: 30/11/2025
Invoice #: 1068152
TAX INVOICE Page 1 of 1
Payment Options
EFT: BSB: 082 057, Account: 53 282 1360
Account Name: Altus Business Advisers Pty Ltd
Please quote invoice # in the reference
Remittance: accounts@altusfinancial.com.au
Altus Financial
ABN 57 650 111 238
Monthly fee for professional services as per annual agreement.
Total Fee $1,970.00
GST $197.00
Total Due $2,167.00
Credit/Paid ($0.00)
Terms: Strictly 14 days from date of Tax Invoice Amount Due $2,167.00`

const GREEN_DESIGN = `1278399
To: Isoft Software Software Technologies
Level 2, Suite 2, West Wing
1 Woolworths Way
Bella Vista
NSW 2153
TAX INVOICE
Cust Code: ISOFSO PO Number: Date: 1/05/2026 Page 1 of 1
For the Period Ex GST GST Inc GST
Plant rental for the current month May $1,532.19 $153.22 $1,685.41
Total Excluding GST $1,532.19 GST $153.22 Including GST $1,685.41
ABN: 15 644 158 548
The Trustee for Green Design Unit Trust
Green Design Indoor Plant Hire Pty Ltd
50B Howes Road
Somersby NSW 2250 BSB Number: 082 620
Account Number: 035104440
Swift Code: NATA AU 33052S
Please call (02) 4372 1777
web: www.greendesign.com.au`

const VERTEL = `TAX INVOICE
Invoice number : SIN2605SYD48120
Date : 15/05/2026
Page : 1
VERTICAL TELECOMS PTY LTD
Suite 11.02, Level 11
SYDNEY NSW 2000
ABN: 90 086 050 946
Due Date : 29/05/2026
Amount : 818.40
Invoice To:
iSoft Software Techologies Pty Ltd
2/20 Bond Street
SYDNEY 2000 NSW
Quantity Product Description UOM Unit Price Extended Price
1.00 FIXEDACCESS VERT6781: Etherwave - Access - 500 MbpsNBN EA 544.00 544.00
1.00 SDWAN VERT6783: SDWAN - Bundle - 500 Mbps Enhanced EA 200.00 200.00
1.00 NETCONNECTINTERNET VERT6795: Netconnect - IP Transit - 500Mbps EA 0.00 0.00
Tax excluded line total 744.00
GST 74.40
Total Including GST 818.40 EOP
Banking Details:
Bank and BSB: WESTPAC 032-290
Account No.: 122351
Please send remittance advice to receivables@vertel.com.au`

type Expect = {
  templateId: string
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  amountDue: number
  abn?: string | null
  bsb?: string | null
  accountNumber?: string | null
  swiftCode?: string | null
  lineItemCount?: number
}

const CASES: { name: string; text: string; expect: Expect }[] = [
  { name: 'Spiced Tea Chai', text: SPICED_TEA, expect: { templateId: 'spiced-tea-chai', vendorName: 'Spiced Tea', invoiceNumber: 'INV-22050', invoiceDate: '2026-05-06', dueDate: '2026-06-15', amountDue: 200, bsb: '062-339', accountNumber: '11061450', lineItemCount: 3 } },
  { name: 'Quest Software', text: QUEST, expect: { templateId: 'quest-software', vendorName: 'Quest Software', invoiceNumber: '4700367116', invoiceDate: '2025-12-19', dueDate: '2026-01-18', amountDue: 7490.36, abn: '59 863 426 362', accountNumber: '180010301', swiftCode: 'DEUTAU2SGTB', lineItemCount: 1 } },
  { name: 'Altus Financial', text: ALTUS, expect: { templateId: 'altus-financial', vendorName: 'Altus', invoiceNumber: '1068152', invoiceDate: '2025-11-30', dueDate: '2025-12-14', amountDue: 2167, bsb: '082 057', accountNumber: '53 282 1360', abn: '57 650 111 238', lineItemCount: 1 } },
  { name: 'Green Design', text: GREEN_DESIGN, expect: { templateId: 'green-design', vendorName: 'Green Design', invoiceNumber: '1278399', invoiceDate: '2026-05-01', dueDate: '2026-05-31', amountDue: 1685.41, bsb: '082 620', accountNumber: '035104440', abn: '15 644 158 548', lineItemCount: 1 } },
  { name: 'Vertel', text: VERTEL, expect: { templateId: 'vertel', vendorName: 'Vertel', invoiceNumber: 'SIN2605SYD48120', invoiceDate: '2026-05-15', dueDate: '2026-05-29', amountDue: 818.4, bsb: '032-290', accountNumber: '122351', abn: '90 086 050 946', lineItemCount: 3 } },
]

let failures = 0
for (const c of CASES) {
  const match = matchTemplate(c.text)
  const problems: string[] = []
  if (!match) {
    problems.push('NO TEMPLATE MATCHED')
  } else {
    const p = match.parsed
    const check = (field: string, got: unknown, want: unknown) => {
      if (want === undefined) return
      if (got !== want) problems.push(`${field}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
    }
    check('templateId', match.templateId, c.expect.templateId)
    check('valid', match.valid, true)
    check('vendorName', p.vendorName, c.expect.vendorName)
    check('contactBusiness', p.contactBusiness, 'iSoft')
    check('invoiceNumber', p.invoiceNumber, c.expect.invoiceNumber)
    check('invoiceDate', p.invoiceDate, c.expect.invoiceDate)
    check('dueDate', p.dueDate, c.expect.dueDate)
    check('amountDue', p.amountDue, c.expect.amountDue)
    check('abn', p.paymentDetails?.abn ?? null, c.expect.abn)
    check('bsb', p.paymentDetails?.bsb ?? null, c.expect.bsb)
    check('accountNumber', p.paymentDetails?.accountNumber ?? null, c.expect.accountNumber)
    check('swiftCode', p.paymentDetails?.swiftCode ?? null, c.expect.swiftCode)
    if (c.expect.lineItemCount !== undefined) {
      const got = Array.isArray(p.lineItems) ? p.lineItems.length : 0
      if (got !== c.expect.lineItemCount) problems.push(`lineItemCount: got ${got}, want ${c.expect.lineItemCount}`)
    }
  }

  if (problems.length === 0) {
    console.log(`✅ ${c.name}`)
  } else {
    failures++
    console.log(`❌ ${c.name}`)
    for (const pr of problems) console.log(`     - ${pr}`)
    if (match) console.log(`     parsed: ${JSON.stringify(match.parsed)}`)
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} templates passed.`)
process.exit(failures ? 1 : 0)
