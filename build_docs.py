"""Generates the synthetic attachment PDFs for the demo inbox.
Deliberately NOT branded as ACORD forms - these are generic application
summaries and carrier loss runs, all fictional."""
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.pdfgen import canvas

W, H = LETTER
M = 0.75 * inch

def header(c, title, subtitle):
    c.setFillColor(colors.HexColor('#1f2937'))
    c.rect(0, H - 1.15*inch, W, 1.15*inch, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', 15)
    c.drawString(M, H - 0.62*inch, title)
    c.setFont('Helvetica', 9.5)
    c.drawString(M, H - 0.85*inch, subtitle)
    c.setFillColor(colors.black)
    return H - 1.5*inch

def section(c, y, label):
    c.setFont('Helvetica-Bold', 10)
    c.setFillColor(colors.HexColor('#374151'))
    c.drawString(M, y, label.upper())
    c.setStrokeColor(colors.HexColor('#d1d5db'))
    c.line(M, y - 4, W - M, y - 4)
    c.setFillColor(colors.black)
    return y - 20

def field(c, y, label, value, indent=0):
    c.setFont('Helvetica', 9)
    c.setFillColor(colors.HexColor('#6b7280'))
    c.drawString(M + indent, y, label)
    c.setFont('Helvetica-Bold', 9.5)
    c.setFillColor(colors.black)
    c.drawString(M + indent + 2.5*inch, y, str(value))
    return y - 15

def row(c, y, cols, widths, bold=False, color=colors.black):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', 8.5)
    c.setFillColor(color)
    x = M
    for text, w in zip(cols, widths):
        c.drawString(x, y, str(text))
        x += w
    c.setFillColor(colors.black)
    return y - 13

# ---------------------------------------------------------------- 1. HARBOR & VINE (clean -> Quote Now)
c = canvas.Canvas('docs/harbor-vine-application.pdf', pagesize=LETTER)
y = header(c, 'Workers Compensation Application',
           'Submitted through Prairie State Insurance Group  |  Application ID APP-2026-4471')
y = section(c, y, 'Applicant Information')
y = field(c, y, 'Named Insured', 'Harbor & Vine Restaurant Group LLC')
y = field(c, y, 'Federal Employer ID (FEIN)', '84-3319072')
y = field(c, y, 'Entity Type', 'Limited Liability Company')
y = field(c, y, 'Mailing Address', '1420 Front Street, Traverse City, MI 49684')
y = field(c, y, 'State(s) of Operation', 'MI')
y = field(c, y, 'Years in Business', '11')
y = field(c, y, 'Website', 'harborandvine.example')
y -= 8
y = section(c, y, 'Coverage Requested')
y = field(c, y, 'Proposed Effective Date', '11/01/2026')
y = field(c, y, 'Expiration Date', '11/01/2027')
y = field(c, y, 'Employers Liability Limits', '$1,000,000 / $1,000,000 / $1,000,000')
y = field(c, y, 'Experience Modification Factor', '0.92')
y -= 8
y = section(c, y, 'Classification and Payroll')
y = row(c, y, ['Class Code', 'Description', 'Employees', 'Annual Payroll'],
        [1.1*inch, 3.0*inch, 1.0*inch, 1.4*inch], bold=True)
y = row(c, y, ['9082', 'Restaurant - full service', '38', '$1,640,000'],
        [1.1*inch, 3.0*inch, 1.0*inch, 1.4*inch])
y = row(c, y, ['8810', 'Clerical office employees', '4', '$205,000'],
        [1.1*inch, 3.0*inch, 1.0*inch, 1.4*inch])
y -= 6
y = row(c, y, ['', 'Total', '42', '$1,845,000'],
        [1.1*inch, 3.0*inch, 1.0*inch, 1.4*inch], bold=True)
y -= 14
y = section(c, y, 'Prior Coverage and Loss History')
y = field(c, y, 'Prior Carrier', 'Great Lakes Mutual Casualty')
y = field(c, y, 'Prior Policy Term', '11/01/2025 - 11/01/2026')
y = field(c, y, 'Losses in past 3 years?', 'YES - see attached loss run')
y = field(c, y, 'Number of Claims (3 yr)', '2')
y -= 10
c.setFont('Helvetica-Oblique', 8)
c.setFillColor(colors.HexColor('#6b7280'))
c.drawString(M, y, 'Applicant certifies the information above is true to the best of their knowledge. Fictional document created for demonstration.')
c.save()

# ---------------------------------------------------------------- 1b. HARBOR & VINE LOSS RUN
c = canvas.Canvas('docs/harbor-vine-loss-run.pdf', pagesize=LETTER)
y = header(c, 'Loss Run Report',
           'Great Lakes Mutual Casualty  |  Valuation Date 08/01/2026  |  Policy WC-MI-884201')
y = field(c, y, 'Insured', 'Harbor & Vine Restaurant Group LLC')
y = field(c, y, 'Coverage Period Reported', '11/01/2023 - 08/01/2026  (3 policy years)')
y = field(c, y, 'Line of Business', 'Workers Compensation')
y -= 12
y = section(c, y, 'Claim Detail')
wid = [1.15*inch, 0.95*inch, 1.9*inch, 0.85*inch, 0.85*inch, 0.85*inch]
y = row(c, y, ['Claim No.', 'Date', 'Description', 'Paid', 'Reserve', 'Incurred'], wid, bold=True)
for r in [
    ['GL-224871', '03/14/2024', 'Laceration - kitchen', '$3,180', '$0', '$3,180'],
    ['GL-231044', '09/02/2025', 'Slip and fall - medical only', '$5,720', '$0', '$5,720'],
]:
    y = row(c, y, r, wid)
y -= 4
y = row(c, y, ['', '', 'TOTAL - 2 claims', '$8,900', '$0', '$8,900'], wid, bold=True)
y -= 20
y = field(c, y, 'Open Claims', '0')
y = field(c, y, 'Lost Time Claims', '0')
y = field(c, y, 'Total Incurred (3 yr)', '$8,900')
y -= 12
c.setFont('Helvetica-Oblique', 8)
c.setFillColor(colors.HexColor('#6b7280'))
c.drawString(M, y, 'Fictional loss run created for demonstration purposes. No real insured or carrier is represented.')
c.save()
print('harbor-vine: 2 files')

# ---------------------------------------------------------------- 2. RIDGELINE ROOFING (prohibited class -> Likely Decline)
c = canvas.Canvas('docs/ridgeline-application.pdf', pagesize=LETTER)
y = header(c, 'Workers Compensation Application',
           'Submitted through Copper Ridge Agency  |  Application ID APP-2026-4489')
y = section(c, y, 'Applicant Information')
y = field(c, y, 'Named Insured', 'Ridgeline Roofing & Exteriors Inc.')
y = field(c, y, 'Federal Employer ID (FEIN)', '47-2210558')
y = field(c, y, 'Entity Type', 'Corporation')
y = field(c, y, 'Mailing Address', '3308 COMMERCE PARK DR, KENTWOOD, MI 49512')
y = field(c, y, 'State(s) of Operation', 'MI, IN, OH')
y = field(c, y, 'Years in Business', '6')
y -= 8
y = section(c, y, 'Coverage Requested')
y = field(c, y, 'Proposed Effective Date', '10/15/2026')
y = field(c, y, 'Employers Liability Limits', '$1,000,000 / $1,000,000 / $1,000,000')
y = field(c, y, 'Experience Modification Factor', '1.14')
y -= 8
y = section(c, y, 'Classification and Payroll')
wid2 = [1.1*inch, 3.0*inch, 1.0*inch, 1.4*inch]
y = row(c, y, ['Class Code', 'Description', 'Employees', 'Annual Payroll'], wid2, bold=True)
y = row(c, y, ['5551', 'Roofing - all kinds & drivers', '24', '$1,910,000'], wid2)
y = row(c, y, ['5645', 'Carpentry - detached dwellings', '5', '$318,000'], wid2)
y = row(c, y, ['8810', 'Clerical office employees', '3', '$142,000'], wid2)
y -= 6
y = row(c, y, ['', 'Total', '32', '$2,370,000'], wid2, bold=True)
y -= 14
y = section(c, y, 'Operations Detail')
c.setFont('Helvetica', 9)
for line in [
    'Residential and light commercial re-roofing. Tear-off and new installation.',
    'Approximately 70% of work performed at heights above two stories.',
    'No hot tar or torch-down applications. Subcontractors used seasonally.',
]:
    c.drawString(M, y, line); y -= 13
y -= 8
y = section(c, y, 'Prior Coverage and Loss History')
y = field(c, y, 'Prior Carrier', 'State assigned risk pool')
y = field(c, y, 'Losses in past 3 years?', 'YES')
y = field(c, y, 'Number of Claims (3 yr)', '5')
y -= 10
c.setFont('Helvetica-Oblique', 8)
c.setFillColor(colors.HexColor('#6b7280'))
c.drawString(M, y, 'Fictional document created for demonstration.')
c.save()

# ---------------------------------------------------------------- 3. CASCADE MILLWORK (conflict -> Send for Info -> Indication)
c = canvas.Canvas('docs/cascade-application.pdf', pagesize=LETTER)
y = header(c, 'Workers Compensation Application',
           'Submitted through Northbridge Risk Partners  |  Application ID APP-2026-4502')
y = section(c, y, 'Applicant Information')
y = field(c, y, 'Named Insured', 'Cascade Millwork Inc.')
y = field(c, y, 'Federal Employer ID (FEIN)', '[  not provided  ]')
y = field(c, y, 'Entity Type', 'Corporation')
y = field(c, y, 'Mailing Address', '815 Foundry Ave, Grand Rapids, MI 49504')
y = field(c, y, 'State(s) of Operation', 'MI')
y = field(c, y, 'Years in Business', '19')
y -= 8
y = section(c, y, 'Coverage Requested')
y = field(c, y, 'Proposed Effective Date', '10/01/2026')
y = field(c, y, 'Employers Liability Limits', '$1,000,000 / $1,000,000 / $1,000,000')
y = field(c, y, 'Experience Modification Factor', '1.18')
y -= 8
y = section(c, y, 'Classification and Payroll')
y = row(c, y, ['Class Code', 'Description', 'Employees', 'Annual Payroll'], wid2, bold=True)
y = row(c, y, ['2802', 'Carpentry shop - woodworking', '46', '$2,180,000'], wid2)
y = row(c, y, ['8810', 'Clerical office employees', '6', '$298,000'], wid2)
y = row(c, y, ['8742', 'Salespersons - outside', '3', '$214,000'], wid2)
y -= 6
y = row(c, y, ['', 'Total', '55', '$2,692,000'], wid2, bold=True)
y -= 14
y = section(c, y, 'Prior Coverage and Loss History')
y = field(c, y, 'Prior Carrier', 'Midwest Indemnity Company')
y = field(c, y, 'Prior Policy Term', '10/01/2025 - 10/01/2026')
c.setFont('Helvetica', 9)
c.setFillColor(colors.HexColor('#6b7280'))
c.drawString(M, y, 'Losses in past 3 years?')
c.setFont('Helvetica-Bold', 10)
c.setFillColor(colors.HexColor('#991b1b'))
c.drawString(M + 2.5*inch, y, 'NO - no claims reported')
c.setFillColor(colors.black)
y -= 15
y = field(c, y, 'Number of Claims (3 yr)', '0')
y -= 14
y = section(c, y, 'Safety Program')
c.setFont('Helvetica', 9)
for line in [
    'Written safety manual in place, updated 2024. Monthly toolbox talks.',
    'Machine guarding inspection quarterly. Return-to-work program: yes.',
]:
    c.drawString(M, y, line); y -= 13
y -= 10
c.setFont('Helvetica-Oblique', 8)
c.setFillColor(colors.HexColor('#6b7280'))
c.drawString(M, y, 'Fictional document created for demonstration.')
c.save()

# ---------------------------------------------------------------- 3b. CASCADE LOSS RUN (contradicts the application)
c = canvas.Canvas('docs/cascade-loss-run.pdf', pagesize=LETTER)
y = header(c, 'Loss Run Report',
           'Midwest Indemnity Company  |  Valuation Date 07/15/2026  |  Policy WC-MI-337914')
y = field(c, y, 'Insured', 'Cascade Millwork Inc.')
y = field(c, y, 'Coverage Period Reported', '10/01/2024 - 07/15/2026  (2 policy years)')
y = field(c, y, 'Line of Business', 'Workers Compensation')
y -= 12
y = section(c, y, 'Claim Detail')
wid = [1.15*inch, 0.95*inch, 1.9*inch, 0.85*inch, 0.85*inch, 0.85*inch]
y = row(c, y, ['Claim No.', 'Date', 'Description', 'Paid', 'Reserve', 'Incurred'], wid, bold=True)
for r in [
    ['MW-771203', '02/08/2025', 'Hand laceration - saw', '$6,410', '$0', '$6,410'],
    ['MW-778866', '06/21/2025', 'Back strain - lifting', '$11,240', '$4,000', '$15,240'],
    ['MW-784120', '11/30/2025', 'Finger amputation - jointer', '$48,900', '$16,000', '$64,900'],
    ['MW-791455', '04/17/2026', 'Eye injury - debris', '$3,850', '$2,000', '$5,850'],
]:
    y = row(c, y, r, wid)
y -= 4
y = row(c, y, ['', '', 'TOTAL - 4 claims', '$70,400', '$22,000', '$92,400'], wid, bold=True)
y -= 20
y = field(c, y, 'Open Claims', '2')
y = field(c, y, 'Lost Time Claims', '2')
y = field(c, y, 'Total Incurred (period shown)', '$92,400')
y = field(c, y, 'Largest Single Claim', '$64,900  (MW-784120)')
y -= 12
c.setFont('Helvetica-Bold', 9)
c.setFillColor(colors.HexColor('#991b1b'))
c.drawString(M, y, 'NOTE: Prior carrier records requested for policy year 10/01/2023 - 10/01/2024 are not included in this report.')
y -= 16
c.setFont('Helvetica-Oblique', 8)
c.setFillColor(colors.HexColor('#6b7280'))
c.drawString(M, y, 'Fictional loss run created for demonstration purposes. No real insured or carrier is represented.')
c.save()
print('all docs built')
