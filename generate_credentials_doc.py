import json
import re
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

# Read tn_divisions_ranges.js
with open('projects/RFRL_Boundary_Survey_App/tn_divisions_ranges.js', 'r', encoding='utf-8') as f:
    js_content = f.read()

# Extract TN_FOREST_HIERARCHY dictionary
hierarchy_match = re.search(r'window\.TN_FOREST_HIERARCHY\s*=\s*(\{.*?\});\s*(?:window|\/\/|\()', js_content, re.DOTALL)
if not hierarchy_match:
    raise ValueError("Could not extract TN_FOREST_HIERARCHY from tn_divisions_ranges.js")

# Clean JS object to JSON
raw_json = hierarchy_match.group(1)
# Convert single quotes or unquoted keys if any
divs = []
for line in raw_json.split('\n'):
    m = re.match(r'^\s*"(.*?)"\s*:\s*\[', line)
    if m:
        divs.append(m.group(1))

print(f"Extracted {len(divs)} divisions.")

# Generate credentials matching tn_divisions_ranges.js algorithm
creds_list = []
seen = set()
for div in divs:
    clean = re.sub(r'division|forest|territory', '', div, flags=re.IGNORECASE)
    clean = re.sub(r'[^a-z0-9]', '', clean.lower())
    if not clean:
        clean = re.sub(r'[^a-z0-9]', '', div.lower())
    
    username = f"dfo_{clean}"
    password = f"{clean}@dfo123"

    if username in seen:
        clean = re.sub(r'[^a-z0-9]', '', div.lower())
        username = f"dfo_{clean}"
        password = f"{clean}@dfo123"
    seen.add(username)

    creds_list.append({
        "sno": len(creds_list) + 1,
        "division": div,
        "username": username,
        "password": password
    })

# 1. GENERATE PDF USING REPORTLAB
pdf_path = "projects/RFRL_Boundary_Survey_App/TN_Forest_All_51_Divisions_DFO_Credentials.pdf"
doc = SimpleDocTemplate(
    pdf_path,
    pagesize=A4,
    leftMargin=28,
    rightMargin=28,
    topMargin=28,
    bottomMargin=28
)

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    'DocTitle',
    parent=styles['Heading1'],
    fontName='Helvetica-Bold',
    fontSize=15,
    leading=18,
    textColor=colors.HexColor('#064e3b'),
    alignment=1
)

sub_style = ParagraphStyle(
    'DocSubtitle',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=10,
    leading=14,
    textColor=colors.HexColor('#047857'),
    alignment=1
)

note_style = ParagraphStyle(
    'DocNote',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=8.5,
    leading=11,
    textColor=colors.HexColor('#374151'),
    alignment=1
)

cell_header = ParagraphStyle(
    'CellHeader',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=8.5,
    leading=11,
    textColor=colors.white,
    alignment=1
)

cell_sno = ParagraphStyle(
    'CellSno',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=8,
    leading=10,
    textColor=colors.HexColor('#1f2937'),
    alignment=1
)

cell_div = ParagraphStyle(
    'CellDiv',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=8,
    leading=10,
    textColor=colors.HexColor('#0f172a'),
    alignment=0
)

cell_user = ParagraphStyle(
    'CellUser',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=8,
    leading=10,
    textColor=colors.HexColor('#0369a1'),
    alignment=0
)

cell_pwd = ParagraphStyle(
    'CellPwd',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=8,
    leading=10,
    textColor=colors.HexColor('#b91c1c'),
    alignment=0
)

elements = []
elements.append(Paragraph("TAMIL NADU FOREST DEPARTMENT", title_style))
elements.append(Paragraph("STATE CADASTRAL BOUNDARY SURVEY & REVISION PLATFORM", sub_style))
elements.append(Paragraph("CONFIDENTIAL: ALL 51 DIVISION FOREST OFFICER (DFO) MASTER CREDENTIALS DIRECTORY", ParagraphStyle('Conf', parent=sub_style, fontSize=9, textColor=colors.HexColor('#b91c1c'))))
elements.append(Spacer(1, 4))
elements.append(Paragraph("<i>Authorized DFO Credentials for Exclusive Portal Access. Only one active device session is permitted per division at any time. Field Officer credentials are created and managed by respective DFOs within their portal.</i>", note_style))
elements.append(Spacer(1, 8))

# Table data
table_data = [[
    Paragraph("S.No", cell_header),
    Paragraph("Forest Division", cell_header),
    Paragraph("DFO Username", cell_header),
    Paragraph("DFO Master Password", cell_header)
]]

for item in creds_list:
    table_data.append([
        Paragraph(str(item['sno']), cell_sno),
        Paragraph(item['division'], cell_div),
        Paragraph(item['username'], cell_user),
        Paragraph(item['password'], cell_pwd)
    ])

col_widths = [32, 185, 155, 165]
t = Table(table_data, colWidths=col_widths, repeatRows=1)
t.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#064e3b')),
    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
    ('TOPPADDING', (0, 0), (-1, -1), 2.5),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#f8fafc'), colors.white]),
]))

elements.append(t)
doc.build(elements)
print(f"PDF generated successfully at {pdf_path}")

# 2. GENERATE STANDALONE PRINTABLE HTML
html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Tamil Nadu Forest Department - 51 Divisions DFO Credentials Directory</title>
    <style>
        @page {{
            size: A4 portrait;
            margin: 12mm;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: #f1f5f9;
            color: #0f172a;
            margin: 0;
            padding: 24px;
        }}
        .container {{
            max-width: 900px;
            margin: 0 auto;
            background: #ffffff;
            padding: 32px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }}
        .header {{
            text-align: center;
            border-bottom: 2px solid #064e3b;
            padding-bottom: 16px;
            margin-bottom: 20px;
        }}
        .header h1 {{
            margin: 0;
            font-size: 20px;
            color: #064e3b;
            letter-spacing: 0.5px;
        }}
        .header h2 {{
            margin: 4px 0;
            font-size: 13px;
            color: #047857;
            font-weight: 600;
        }}
        .confidential {{
            display: inline-block;
            background: #fee2e2;
            color: #b91c1c;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 700;
            margin-top: 6px;
        }}
        .notice {{
            font-size: 12px;
            color: #475569;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-left: 4px solid #064e3b;
            padding: 10px 14px;
            border-radius: 4px;
            margin-bottom: 20px;
            line-height: 1.5;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 11.5px;
        }}
        th {{
            background: #064e3b;
            color: #ffffff;
            text-align: left;
            padding: 7px 10px;
            font-weight: 700;
        }}
        td {{
            padding: 6px 10px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
        }}
        tr:nth-child(even) {{
            background: #f8fafc;
        }}
        .sno {{
            text-align: center;
            color: #64748b;
            font-weight: 600;
            width: 40px;
        }}
        .division-name {{
            font-weight: 700;
            color: #0f172a;
        }}
        .username {{
            font-family: monospace;
            color: #0284c7;
            font-size: 12px;
            font-weight: 600;
        }}
        .password {{
            font-family: monospace;
            color: #b91c1c;
            font-size: 12px;
            font-weight: 700;
        }}
        .actions {{
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-bottom: 16px;
        }}
        .btn {{
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            text-decoration: none;
        }}
        .btn-print {{
            background: #064e3b;
            color: #fff;
        }}
        .btn-pdf {{
            background: #b91c1c;
            color: #fff;
        }}
        @media print {{
            body {{
                background: #fff;
                padding: 0;
            }}
            .container {{
                box-shadow: none;
                padding: 0;
                max-width: 100%;
            }}
            .actions {{
                display: none;
            }}
            th {{
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }}
            tr:nth-child(even) {{
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="actions">
            <button class="btn btn-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
            <a class="btn btn-pdf" href="TN_Forest_All_51_Divisions_DFO_Credentials.pdf" download>⬇️ Download Official PDF</a>
        </div>
        <div class="header">
            <h1>TAMIL NADU FOREST DEPARTMENT</h1>
            <h2>CADASTRE BOUNDARY SURVEY & REVISION PLATFORM (TN RF/RL SURVEY)</h2>
            <div class="confidential">CONFIDENTIAL: ALL 51 DIVISION FOREST OFFICER (DFO) MASTER CREDENTIALS</div>
        </div>
        <div class="notice">
            <b>Portal Security Policy:</b><br>
            • Each DFO username gives access exclusively to their assigned division database and boundary records.<br>
            • Only <b>one device login</b> is permitted per division at any time across Web and Mobile App.<br>
            • Field Staff accounts are registered and configured directly by the DFO in the "Field Staff Access Management" section inside the DFO Portal.
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width: 45px; text-align: center;">S.No</th>
                    <th>Forest Division</th>
                    <th>DFO Portal Username</th>
                    <th>Master Password</th>
                </tr>
            </thead>
            <tbody>
"""

for item in creds_list:
    html_content += f"""                <tr>
                    <td class="sno">{item['sno']}</td>
                    <td class="division-name">{item['division']}</td>
                    <td class="username">{item['username']}</td>
                    <td class="password">{item['password']}</td>
                </tr>
"""

html_content += """            </tbody>
        </table>
    </div>
</body>
</html>
"""

html_path = "projects/RFRL_Boundary_Survey_App/TN_Forest_All_51_Divisions_DFO_Credentials.html"
with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html_content)
print(f"HTML generated successfully at {html_path}")
