#!/usr/bin/env python3
"""
Build the cigarette reconciliation workbook.

    python3 build_workbook.py [-o "Cigarette Reconciliation.xlsx"]

Pulls vw_daily_reconciliation from Supabase with the public anon key (read-only)
and writes a formatted workbook:

    Daily    one trading day at a time, chosen from a dropdown, sorted by
             absolute variance descending. Prints on one page.
    Trends   variance by product across every date, so a product that drifts
             every night separates from one that had a single bad one.
    Notes    what the columns mean and what can make them lie.
    Data     hidden. The raw view, exactly as it comes back.

Only the Data sheet holds values. Daily reads from it by formula, so changing
the date recalculates in place — one table, one set of formatting.

Re-run this to refresh. The workbook is rebuilt from scratch each time; nothing
in it is hand-edited, so nothing is lost.

Needs openpyxl (pip install openpyxl). No other dependencies.
"""

import argparse
import json
import os
import re
import ssl
import sys
import urllib.request
from collections import defaultdict
from datetime import date

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo

SUPABASE_URL = 'https://vwffiuciogthfzekkkkz.supabase.co'
VIEW = 'vw_daily_reconciliation'
BRANCH = 'SAFARI'

HERE = os.path.dirname(os.path.abspath(__file__))
APP_JS = os.path.join(HERE, os.pardir, 'app.js')

# ---------------------------------------------------------------------------
# Look, not brand colours — this is a spreadsheet people read at 7am.
# ---------------------------------------------------------------------------
INK = '1F2A44'
MUTED = '8A94A6'
RULE = 'D6DBE4'
HEAD_BG = '0F1B3D'
BAND = 'F4F6FA'
OK_GREEN = '1B7F4B'
WARN_AMBER = '9A6500'
RED_1 = 'C0392B'
RED_2 = '96281B'
RED_3 = 'FFFFFF'
RED_3_BG = '922B21'
RED_FILL_LIGHT = 'FDEDEC'
AMBER_FILL = 'FEF5E7'

THIN = Side(style='thin', color=RULE)
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
UNDER = Border(bottom=Side(style='thin', color=RULE))

INT_FMT = '#,##0'
RM_FMT = '#,##0.00'
DATE_FMT = 'dd mmm yyyy'


# ===========================================================================
# Fetch
# ===========================================================================
def anon_key():
    with open(APP_JS, encoding='utf-8') as fh:
        m = re.search(r'eyJ[A-Za-z0-9_.-]+', fh.read())
    if not m:
        sys.exit('Could not find the Supabase anon key in app.js')
    return m.group(0)


def fetch(key):
    """Every submitted day, paged — PostgREST caps a response at 1000 rows and
    54 products a day reaches that in under three weeks."""
    rows, offset, page = [], 0, 1000
    ctx = ssl.create_default_context()
    while True:
        url = (f'{SUPABASE_URL}/rest/v1/{VIEW}'
               f'?select=*&branch_id=eq.{BRANCH}'
               f'&order=count_date.asc,short_name.asc'
               f'&limit={page}&offset={offset}')
        req = urllib.request.Request(url, headers={'apikey': key,
                                                   'Accept': 'application/json'})
        with urllib.request.urlopen(req, context=ctx, timeout=60) as r:
            batch = json.load(r)
        rows.extend(batch)
        if len(batch) < page:
            return rows
        offset += page


def as_date(s):
    if not s:
        return None
    try:
        y, m, d = (int(x) for x in str(s)[:10].split('-'))
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


def num(v):
    return v if isinstance(v, (int, float)) else None


# ===========================================================================
# Shape
# ===========================================================================
# Column order on the hidden Data sheet. Formulas address these by letter, so
# the order is load-bearing — add to the end, never insert.
DATA_COLS = [
    ('rowkey', 'A'), ('date_key', 'B'), ('count_date', 'C'), ('opening_date', 'D'),
    ('staff_name', 'E'), ('short_name', 'F'), ('opening_packs', 'G'),
    ('closing_packs', 'H'), ('sold_physical', 'I'), ('sold_pos', 'J'),
    ('variance_packs', 'K'), ('variance_rm', 'L'), ('unit_price_used', 'M'),
    ('abs_variance', 'N'), ('rank', 'O'), ('product_id', 'P'), ('plu', 'Q'),
    ('branch_id', 'R'), ('shift', 'S'), ('pos_description', 'T'), ('add_in', 'U'),
]
COL = {name: letter for name, letter in DATA_COLS}

# The per-date summary block, to the right of the table and out of its way.
SUM_COLS = [
    ('count_date', 'W'), ('date_key', 'X'), ('opening_date', 'Y'),
    ('staff_name', 'Z'), ('products', 'AA'), ('with_variance', 'AB'),
    ('total_packs', 'AC'), ('total_rm', 'AD'), ('pos_state', 'AE'),
    ('message', 'AF'),
]
SUM = {name: letter for name, letter in SUM_COLS}

# Excel's day zero. Keys are built from the date SERIAL, not from a formatted
# string, because the two have to survive being compared to whatever ends up in
# the selector cell. Pick from the dropdown and it is a date; type "2026-09-09"
# and Excel converts it to a date too — but TEXT(...,"yyyy-mm-dd") uses
# localised tokens, so a string key silently stops matching on a machine whose
# Excel speaks anything but English. Concatenating a date coerces it to its
# serial in every locale there is.
EPOCH = date(1899, 12, 30)


def serial(d):
    return (d - EPOCH).days if isinstance(d, date) else None


def prepare(raw):
    """Rank each day's products by absolute variance, descending.

    Sorting is done here rather than in a formula because it is the same answer
    every time the workbook opens, and because it has to put rows with NO
    variance (no POS sales loaded) at the bottom rather than treating them as
    zero — a blank variance is an unknown, not an agreement.
    """
    have = set()
    for r in raw:
        have.update(r.keys())

    by_date = defaultdict(list)
    for r in raw:
        v = num(r.get('variance_packs'))
        by_date[str(r['count_date'])[:10]].append({
            'date_key': str(r['count_date'])[:10],
            'count_date': as_date(r.get('count_date')),
            'opening_date': as_date(r.get('opening_date')),
            'staff_name': r.get('staff_name') or '',
            'short_name': r.get('short_name') or r.get('product_id') or '',
            'opening_packs': num(r.get('opening_packs')),
            'closing_packs': num(r.get('closing_packs')),
            'sold_physical': num(r.get('sold_physical')),
            'sold_pos': num(r.get('sold_pos')),
            'variance_packs': v,
            'variance_rm': num(r.get('variance_rm')),
            'unit_price_used': num(r.get('unit_price_used')),
            # Unknown sorts last, below every known zero.
            'abs_variance': abs(v) if v is not None else -1,
            'product_id': str(r.get('product_id') or ''),
            'plu': str(r.get('plu') or ''),
            'branch_id': r.get('branch_id') or '',
            'shift': r.get('shift') or '',
            'pos_description': r.get('pos_description') or '',
            'add_in': num(r.get('add_in')),
        })

    rows = []
    for dk in sorted(by_date):
        day = sorted(by_date[dk],
                     key=lambda x: (-x['abs_variance'], x['short_name'].lower()))
        for i, x in enumerate(day, start=1):
            x['rank'] = i
            x['rowkey'] = f"{serial(x['count_date'])}|{i}"
            rows.append(x)
    return rows, sorted(by_date), have


def summarise(rows, dates, have):
    """One row per trading day. Computed here so the Daily sheet needs nothing
    cleverer than INDEX/MATCH, which works in every version of Excel."""
    out = []
    for dk in dates:
        day = [r for r in rows if r['date_key'] == dk]
        priced = [r for r in day if r['variance_rm'] is not None]
        known = [r for r in day if r['variance_packs'] is not None]
        nonzero = [r for r in known if r['variance_packs'] != 0]
        pos_loaded = any(r['sold_pos'] is not None for r in day)
        no_opening = all(r['opening_packs'] is None for r in day)

        opens = sorted({r['opening_date'] for r in day if r['opening_date']})
        if not have or 'opening_date' not in have:
            opening = 'run migration 10'
        elif not opens:
            opening = 'first count — no opening'
        elif len(opens) == 1:
            opening = opens[0]
        else:
            opening = f'mixed ({opens[0]:%d %b} – {opens[-1]:%d %b})'

        if not pos_loaded:
            msg = ('No POS sales have been loaded for this date, so variance cannot be '
                   'worked out. Import the sales report for this day and it fills in.')
        elif no_opening:
            msg = ('This is the first count of these products, so there is no opening '
                   'figure to sell down from. Variance starts from the next count.')
        elif not nonzero:
            msg = 'Physical and POS agree on every product.'
        else:
            msg = (f'{len(nonzero)} of {len(known)} products disagree with the POS. '
                   f'Largest first below.')
        if priced and len(priced) < len(nonzero):
            msg += ' Some rows have no price, so the RM total is partial.'
        elif not priced and nonzero:
            msg += (' No unit prices are set, so there are no RM figures — see Notes.')

        out.append({
            'date_key': dk,
            'count_date': day[0]['count_date'],
            'opening_date': opening,
            'staff_name': ', '.join(sorted({r['staff_name'] for r in day if r['staff_name']})) or '—',
            'products': len(day),
            # Keyed on whether a variance was actually computed, NOT on whether
            # POS sales exist. The first count of a product has POS sales but no
            # opening to sell down from, so its variance is unknown — and summing
            # an empty list to 0 would report perfect agreement on the one day
            # nothing could be checked at all.
            'with_variance': len(nonzero) if known else None,
            'total_packs': sum(r['variance_packs'] for r in known) if known else None,
            'total_rm': round(sum(r['variance_rm'] for r in priced), 2) if priced else None,
            'pos_state': 'loaded' if pos_loaded else 'not loaded',
            'message': msg,
        })
    return out


# ===========================================================================
# Sheets
# ===========================================================================
def write_data(ws, rows, summary):
    ws.sheet_state = 'hidden'
    headers = [name for name, _ in DATA_COLS]
    ws.append(headers)
    for r in rows:
        ws.append([r.get(name) for name in headers])

    last = len(rows) + 1
    table = Table(displayName='Counts', ref=f'A1:{COL["add_in"]}{last}')
    table.tableStyleInfo = TableStyleInfo(name='TableStyleLight8', showRowStripes=True)
    ws.add_table(table)

    for name in ('count_date', 'opening_date'):
        for c in range(2, last + 1):
            ws[f'{COL[name]}{c}'].number_format = DATE_FMT

    # The per-date summary, beside the table.
    for name, letter in SUM_COLS:
        ws[f'{letter}1'] = name
    for i, s in enumerate(summary, start=2):
        for name, letter in SUM_COLS:
            ws[f'{letter}{i}'] = s.get(name)
        ws[f'{SUM["count_date"]}{i}'].number_format = DATE_FMT
        if isinstance(s.get('opening_date'), date):
            ws[f'{SUM["opening_date"]}{i}'].number_format = DATE_FMT

    # The dropdown's source list, further right again. Real dates, so the
    # selector cell holds a date whichever way it is filled in.
    ws['AH1'] = 'dates'
    for i, s in enumerate(summary, start=2):
        ws[f'AH{i}'] = s['count_date']
        ws[f'AH{i}'].number_format = DATE_FMT
    return last


def label(ws, cell, text):
    c = ws[cell]
    c.value = text
    c.font = Font(name='Calibri', size=9, bold=True, color=MUTED)
    c.alignment = Alignment(horizontal='left', vertical='bottom')


def value(ws, cell, formula, fmt=None, size=14, bold=True, color=INK):
    c = ws[cell]
    c.value = formula
    c.font = Font(name='Calibri', size=size, bold=bold, color=color)
    c.alignment = Alignment(horizontal='left', vertical='center')
    if fmt:
        c.number_format = fmt


DAILY_HEADERS = [
    ('Product', 30, 'left'),
    ('Opening', 11, 'right'),
    ('Closing', 11, 'right'),
    ('Sold (counted)', 15, 'right'),
    ('Sold (POS)', 13, 'right'),
    ('Variance', 11, 'right'),
    ('Variance RM', 13, 'right'),
    ('Item ID', 10, 'left'),
    ('PLU', 15, 'left'),
]
FIRST_ROW = 10          # first product row on Daily
HDR_ROW = 9


def write_daily(ws, rows, summary, data_last, max_products):
    n = len(rows) + 1
    keys = f"Data!$A$2:$A${n}"

    def dcol(name):
        return f"Data!${COL[name]}$2:${COL[name]}${n}"

    def scol(name):
        return f"Data!${SUM[name]}$2:${SUM[name]}${len(summary) + 1}"

    sumkeys = f"Data!$W$2:$W${len(summary) + 1}"

    # INDEX into an empty cell returns 0, not blank — so an unknown total would
    # render as a confident "0 packs of variance" on exactly the day nothing
    # could be checked. Every lookup goes through a blank test for that reason.
    def pick(name):
        idx = f'INDEX({scol(name)},$L$1)'
        return f'IF($L$1="","—",IF({idx}="","—",{idx}))'

    # The summary's row in the per-date block, looked up once. Parked outside
    # the print area alongside the per-row helpers.
    ws['L1'] = f'=IFERROR(MATCH($B$3,{sumkeys},0),"")'

    ws['A1'] = 'Cigarette reconciliation'
    ws['A1'].font = Font(name='Calibri', size=18, bold=True, color=INK)
    ws.merge_cells('A1:D1')
    ws['F1'] = 'Safari'
    ws['F1'].font = Font(name='Calibri', size=11, bold=True, color=MUTED)
    ws['F1'].alignment = Alignment(horizontal='right')
    ws.merge_cells('F1:I1')

    # --- the selector ---
    label(ws, 'A2', 'TRADING DAY (CLOSING)')
    ws['B3'] = summary[-1]['count_date'] if summary else None
    ws['B3'].number_format = DATE_FMT
    ws['B3'].font = Font(name='Calibri', size=14, bold=True, color='1F4E79')
    ws['B3'].alignment = Alignment(horizontal='left', vertical='center')
    ws['B3'].border = BOX
    ws['B3'].fill = PatternFill('solid', fgColor='EAF1FB')
    ws['A3'] = 'Show:'
    ws['A3'].font = Font(name='Calibri', size=10, bold=True, color=INK)
    ws['A3'].alignment = Alignment(horizontal='left', vertical='center')

    dv = DataValidation(type='list',
                        formula1=f"=Data!$AH$2:$AH${len(summary) + 1}",
                        allow_blank=False, showDropDown=False)
    dv.error = ('Pick a trading day from the dropdown. Only days with a submitted '
                'count are in the list.')
    dv.errorTitle = 'Not a counted day'
    dv.showErrorMessage = True      # off by default, which makes the list advisory
    ws.add_data_validation(dv)
    dv.add(ws['B3'])

    # --- summary block ---
    label(ws, 'D2', 'OPENING FROM')
    value(ws, 'D3', f'={pick("opening_date")}', DATE_FMT, size=11)
    label(ws, 'F2', 'COUNTED BY')
    value(ws, 'F3', f'={pick("staff_name")}', None, size=11)
    label(ws, 'H2', 'PRODUCTS')
    value(ws, 'H3', f'={pick("products")}', INT_FMT, size=11)

    label(ws, 'A5', 'PRODUCTS WITH VARIANCE')
    value(ws, 'A6', f'={pick("with_variance")}', INT_FMT)
    label(ws, 'D5', 'TOTAL VARIANCE (PACKS)')
    value(ws, 'D6', f'={pick("total_packs")}', INT_FMT)
    label(ws, 'F5', 'TOTAL VARIANCE (RM)')
    value(ws, 'F6', f'={pick("total_rm")}', RM_FMT)
    label(ws, 'H5', 'POS SALES')
    value(ws, 'H6', f'={pick("pos_state")}', None, size=11)

    # --- the plain-English status line ---
    ws['A7'] = f'={pick("message")}'
    ws['A7'].font = Font(name='Calibri', size=10, bold=True, color=WARN_AMBER)
    ws['A7'].alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)
    ws.merge_cells('A7:I7')
    ws['A7'].fill = PatternFill('solid', fgColor=AMBER_FILL)
    # Merged cells do not auto-fit, and the longest of these messages runs to
    # two lines at this width, so the height is set for the worst case.
    ws.row_dimensions[7].height = 32

    # --- table ---
    for i, (text, width, align) in enumerate(DAILY_HEADERS, start=1):
        c = ws.cell(row=HDR_ROW, column=i, value=text)
        c.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor=HEAD_BG)
        c.alignment = Alignment(horizontal=align, vertical='center', wrap_text=True)
        c.border = BOX
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[HDR_ROW].height = 28

    last_row = FIRST_ROW + max_products - 1
    for r in range(FIRST_ROW, last_row + 1):
        rank = r - FIRST_ROW + 1
        # One MATCH per row, parked out of the print area, so the nine cells
        # beside it are cheap lookups rather than nine searches.
        ws[f'L{r}'] = f'=IFERROR(MATCH($B$3&"|"&{rank},{keys},0),"")'
        m = f'$L{r}'
        hit = f'AND(ISNUMBER({m}),{m}<>"")'

        # A cell the view can legitimately leave empty must not read as a
        # number. Blank in a spreadsheet looks like "nothing wrong"; an em dash
        # looks like "not known", which is the truth for an opening with no
        # previous count, or a variance with no POS sales loaded.
        def cell(col, name, fmt=None, align='right', dash=True, bold=False):
            idx = f'INDEX({dcol(name)},{m})'
            body = f'IF({idx}="","—",{idx})' if dash else idx
            c = ws[f'{col}{r}']
            c.value = f'=IF({hit},{body},"")'
            c.alignment = Alignment(horizontal=align, vertical='center')
            c.border = BOX
            c.font = Font(name='Calibri', size=10, bold=bold, color=INK)
            if fmt:
                c.number_format = fmt
            if r % 2 == 0:
                c.fill = PatternFill('solid', fgColor=BAND)
            return c

        cell('A', 'short_name', None, 'left', dash=False)
        cell('B', 'opening_packs', INT_FMT)
        # Closing is coalesced to zero in the view, so it is always a real
        # number — a dash here would be a lie about a product counted at nil.
        cell('C', 'closing_packs', INT_FMT, dash=False)
        cell('D', 'sold_physical', INT_FMT)
        cell('E', 'sold_pos', INT_FMT)
        cell('F', 'variance_packs', INT_FMT, bold=True)
        cell('G', 'variance_rm', RM_FMT)

        # Kept, because a number that looks wrong gets checked against the POS
        # and the shelf label — but pushed to the far right, out of the way.
        cell('H', 'product_id', None, 'left', dash=False).font = \
            Font(name='Consolas', size=9, color=MUTED)
        cell('I', 'plu', None, 'left', dash=False).font = \
            Font(name='Consolas', size=9, color=MUTED)

    ws.column_dimensions['L'].hidden = True

    # --- variance colouring: grey at zero, red and heavier as it grows ---
    rng = f'F{FIRST_ROW}:G{last_row}'
    grey = Font(name='Calibri', size=10, color=MUTED)
    for rule in (
        FormulaRule(formula=[f'AND(ISNUMBER($F{FIRST_ROW}),$F{FIRST_ROW}=0)'],
                    font=grey, stopIfTrue=True),
        FormulaRule(formula=[f'AND(ISNUMBER($F{FIRST_ROW}),ABS($F{FIRST_ROW})>=10)'],
                    font=Font(name='Calibri', size=10, bold=True, color=RED_3),
                    fill=PatternFill('solid', fgColor=RED_3_BG), stopIfTrue=True),
        FormulaRule(formula=[f'AND(ISNUMBER($F{FIRST_ROW}),ABS($F{FIRST_ROW})>=5)'],
                    font=Font(name='Calibri', size=10, bold=True, color=RED_2),
                    fill=PatternFill('solid', fgColor=RED_FILL_LIGHT), stopIfTrue=True),
        FormulaRule(formula=[f'AND(ISNUMBER($F{FIRST_ROW}),ABS($F{FIRST_ROW})>=1)'],
                    font=Font(name='Calibri', size=10, bold=True, color=RED_1),
                    stopIfTrue=True),
    ):
        ws.conditional_formatting.add(rng, rule)

    ws.freeze_panes = f'A{FIRST_ROW}'

    # --- print: the whole filtered day on one page ---
    ws.print_area = f'A1:I{last_row}'
    ws.print_title_rows = f'{HDR_ROW}:{HDR_ROW}'
    ws.page_setup.orientation = 'portrait'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.5
    ws.print_options.horizontalCentered = True
    ws.oddFooter.left.text = 'Cigarette reconciliation — &[Tab]'
    ws.oddFooter.right.text = 'Page &[Page] of &[Pages]'
    return last_row


def write_trends(ws, rows, dates):
    """Variance by product across dates.

    The question this sheet answers is not "what went wrong last night" — Daily
    does that — but "which product goes wrong repeatedly". So it is sorted by
    the NUMBER of days a product was off before the size of the gap: five nights
    of one pack is a leak, one night of five packs is an event.
    """
    ws['A1'] = 'Variance by product, across days'
    ws['A1'].font = Font(name='Calibri', size=16, bold=True, color=INK)
    ws['A2'] = ('Sorted by how many days the product disagreed with the POS, then by '
                'total. A product off a little every night sits above one that was off '
                'a lot once. Blank means no POS sales were loaded for that day.')
    ws['A2'].font = Font(name='Calibri', size=9, italic=True, color=MUTED)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=max(6, len(dates) + 4))

    per = defaultdict(dict)
    names = {}
    for r in rows:
        per[r['product_id']][r['date_key']] = r['variance_packs']
        names[r['product_id']] = r['short_name']

    stats = []
    for pid, byd in per.items():
        known = [v for v in byd.values() if v is not None]
        off = [v for v in known if v != 0]
        stats.append({
            'pid': pid, 'name': names[pid], 'byd': byd,
            # Zero days off means "checked, and fine". None means "never
            # checked" — every day this product had no POS figure to compare
            # against. Reporting the second as a confident zero is the whole
            # failure this sheet exists to avoid.
            'days_off': len(off) if known else None,
            'total': sum(known) if known else None,
            'worst': max(off, key=abs) if off else None,
        })
    stats.sort(key=lambda s: (-(s['days_off'] or 0),
                              -(abs(s['total']) if s['total'] is not None else 0),
                              s['name'].lower()))

    hdr = ['Product'] + [f'{as_date(d):%d %b}' for d in dates] + \
          ['Days off', 'Total', 'Worst']
    row0 = 4
    for i, text in enumerate(hdr, start=1):
        c = ws.cell(row=row0, column=i, value=text)
        c.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor=HEAD_BG)
        c.alignment = Alignment(horizontal='center' if i > 1 else 'left',
                                vertical='center', wrap_text=True)
        c.border = BOX
    ws.row_dimensions[row0].height = 26
    ws.column_dimensions['A'].width = 30
    for i in range(2, len(hdr) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 11

    for j, s in enumerate(stats):
        r = row0 + 1 + j
        c = ws.cell(row=r, column=1, value=s['name'])
        c.font = Font(name='Calibri', size=10, color=INK)
        c.border = BOX
        c.alignment = Alignment(horizontal='left', vertical='center')
        for k, d in enumerate(dates, start=2):
            v = s['byd'].get(d)
            c = ws.cell(row=r, column=k, value='—' if v is None else v)
            c.number_format = INT_FMT
            c.alignment = Alignment(horizontal='right', vertical='center')
            c.border = BOX
            c.font = Font(name='Calibri', size=10,
                          color=MUTED if v in (None, 0) else INK)
        base = len(dates) + 2
        for k, v, fmt, bold in ((base, s['days_off'], INT_FMT, True),
                                (base + 1, s['total'], INT_FMT, True),
                                (base + 2, s['worst'], INT_FMT, False)):
            c = ws.cell(row=r, column=k, value='—' if v is None else v)
            c.number_format = fmt
            c.alignment = Alignment(horizontal='right', vertical='center')
            c.border = BOX
            c.font = Font(name='Calibri', size=10, bold=bold, color=INK)
        if j % 2 == 1:
            for k in range(1, len(hdr) + 1):
                ws.cell(row=r, column=k).fill = PatternFill('solid', fgColor=BAND)

    last = row0 + len(stats)
    if stats:
        first_data = get_column_letter(2)
        last_data = get_column_letter(len(dates) + 1)
        rng = f'{first_data}{row0 + 1}:{last_data}{last}'
        anchor = f'{first_data}{row0 + 1}'
        grey = Font(name='Calibri', size=10, color=MUTED)
        for rule in (
            FormulaRule(formula=[f'AND(ISNUMBER({anchor}),{anchor}=0)'],
                        font=grey, stopIfTrue=True),
            FormulaRule(formula=[f'AND(ISNUMBER({anchor}),ABS({anchor})>=10)'],
                        font=Font(name='Calibri', size=10, bold=True, color=RED_3),
                        fill=PatternFill('solid', fgColor=RED_3_BG), stopIfTrue=True),
            FormulaRule(formula=[f'AND(ISNUMBER({anchor}),ABS({anchor})>=5)'],
                        font=Font(name='Calibri', size=10, bold=True, color=RED_2),
                        fill=PatternFill('solid', fgColor=RED_FILL_LIGHT), stopIfTrue=True),
            FormulaRule(formula=[f'AND(ISNUMBER({anchor}),ABS({anchor})>=1)'],
                        font=Font(name='Calibri', size=10, bold=True, color=RED_1),
                        stopIfTrue=True),
        ):
            ws.conditional_formatting.add(rng, rule)

    ws.freeze_panes = f'B{row0 + 1}'
    ws.print_area = f'A1:{get_column_letter(len(hdr))}{last}'
    ws.print_title_rows = f'{row0}:{row0}'
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


NOTES = [
    ('Cigarette reconciliation — how to read this', 'h1'),
    ('', ''),
    ('Daily', 'h2'),
    ('Pick a trading day from the dropdown at the top. Everything below it, and every '
     'figure in the summary, follows that one choice — one table, one set of formatting. '
     'Rows are ordered by how far the variance is from zero, so whatever needs attention '
     'is at the top rather than wherever the alphabet put it.', ''),
    ('Ctrl+P prints exactly the day on screen, on one page, with the header row repeated.', ''),
    ('', ''),
    ('What the columns mean', 'h2'),
    ('Opening — what the previous submitted count left on the shelf. "Opening from" in '
     'the summary is the day that count was taken. If it is not the day before, a day '
     'was skipped, and two days of sales are folded into one figure.', ''),
    ('Closing — what was counted on the trading day named at the top.', ''),
    ('Sold (counted) — Opening minus Closing. What the shelf says went out.', ''),
    ('Sold (POS) — what the till says it sold, from the imported sales report.', ''),
    ('Variance — Sold (counted) minus Sold (POS), straight from the database view. '
     'It is not recalculated here, so it cannot drift from what the system believes.', ''),
    ('  positive — more left the shelf than the till sold: shrinkage, a miscount, or '
     'stock put out and not recorded.', ''),
    ('  negative — the till sold more than the shelf lost: usually a delivery.', ''),
    ('  an em dash — not known, not zero. No POS sales are loaded for that day.', ''),
    ('Variance RM — the variance valued at the price that day\'s report printed, falling '
     'back to the product list price. Blank means neither is known.', ''),
    ('', ''),
    ('Trends', 'h2'),
    ('Variance by product across every counted day, sorted by how many days each product '
     'was off before how large the gap was. That ordering is the point: five nights of '
     'one pack is a leak worth chasing, one night of five packs is an event. The first '
     'sits at the top.', ''),
    ('', ''),
    ('Two things that will skew variance', 'h2'),
    ('Deliveries are not recorded. The count screen collects one number per product and '
     'no longer captures stock added during the day, so add_in is always zero. On any day '
     'stock went onto the shelf, Sold (counted) understates what was sold and the day '
     'reads as negative variance. That column is deliberately not shown here — it would '
     'be a column of zeros implying something was checked.', ''),
    ('Counts must be consecutive. Opening is the previous submitted count\'s closing, '
     'whatever date that was. Check "Opening from" before believing a large variance.', ''),
    ('', ''),
    ('Refreshing', 'h2'),
    ('This workbook is generated. Re-run build_workbook.py and it is rebuilt from the '
     'database as it stands — so do not hand-edit it, because the next run will not keep '
     'the change. Anything that should be different belongs in the script.', ''),
    ('The Data sheet is hidden and holds the view exactly as it came back, including the '
     'columns this report does not show. Right-click a sheet tab and choose Unhide to '
     'see it.', ''),
]


def write_notes(ws):
    ws.column_dimensions['A'].width = 112
    r = 1
    for text, kind in NOTES:
        c = ws.cell(row=r, column=1, value=text)
        if kind == 'h1':
            c.font = Font(name='Calibri', size=16, bold=True, color=INK)
        elif kind == 'h2':
            c.font = Font(name='Calibri', size=12, bold=True, color='1F4E79')
            c.border = UNDER
        else:
            c.font = Font(name='Calibri', size=10, color=INK)
            c.alignment = Alignment(wrap_text=True, vertical='top')
            ws.row_dimensions[r].height = None
        r += 1
    ws.sheet_view.showGridLines = False


# ===========================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out',
                    default=os.path.join(HERE, 'Cigarette Reconciliation.xlsx'))
    args = ap.parse_args()

    raw = fetch(anon_key())
    if not raw:
        sys.exit(f'{VIEW} returned nothing for {BRANCH}. Is a count submitted?')
    rows, dates, have = prepare(raw)
    summary = summarise(rows, dates, have)
    max_products = max(s['products'] for s in summary)

    wb = Workbook()
    daily = wb.active
    daily.title = 'Daily'
    trends = wb.create_sheet('Trends')
    notes = wb.create_sheet('Notes')
    data = wb.create_sheet('Data')

    data_last = write_data(data, rows, summary)
    write_daily(daily, rows, summary, data_last, max_products)
    write_trends(trends, rows, dates)
    write_notes(notes)

    # Nothing in the file carries a cached result, so Excel has to be told to
    # work them out when it opens rather than showing a grid of zeros.
    wb.calculation.fullCalcOnLoad = True
    wb.active = 0
    wb.save(args.out)

    missing = [c for c in ('opening_date', 'unit_price_used', 'variance_rm')
               if c not in have]
    print(f'wrote {args.out}')
    print(f'  {len(rows)} rows over {len(dates)} days: {", ".join(dates)}')
    print(f'  {max_products} products a day')
    for s in summary:
        print(f"  {s['date_key']}: POS {s['pos_state']}, "
              f"variance {s['total_packs'] if s['total_packs'] is not None else '—'} packs, "
              f"{s['with_variance'] if s['with_variance'] is not None else '—'} products off")
    if missing:
        print(f'  NOTE: the view has no {", ".join(missing)} yet — '
              f'run 10_prices_and_opening_date.sql to light those columns up.')


if __name__ == '__main__':
    main()
