#!/usr/bin/env python3
"""
Build the cigarette reconciliation workbook.

    python3 build_workbook.py --mode query      # the one to hand over
    python3 build_workbook.py --mode snapshot   # self-contained, for testing

Two modes, one layout. The sheets, formulas and formatting are identical in
both; the only difference is where the rows on the Data sheet come from.

  query      Data is left empty apart from its header row. You attach the
             Power Query in counts_query.m once, and from then on the workbook
             refreshes itself on open. This is the deliverable.

  snapshot   Data is filled with a pull from Supabase at build time, so the
             file works standalone with no setup. Because the formulas are the
             SAME ones, this doubles as the test rig: verify_workbook.py can
             check the real shipped formulas rather than a parallel copy.

Everything on Daily, Trends and Calc addresses the Data sheet by WHOLE COLUMN
(Data!$N:$N). Not by structured reference, which was the obvious choice and is
wrong: Excel rewrites a reference to a table that does not exist yet into a
permanent #REF! the first time the file is opened, and Power Query cannot load
into a table the builder created. Whole columns grow on their own, survive the
sheet being replaced wholesale, and are not coupled to a table name.

The cost is that Data's COLUMN ORDER is load-bearing — it must match what
counts_query.m returns. That order is pinned at both ends and asserted below.

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
from datetime import date, datetime

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

SUPABASE_URL = 'https://vwffiuciogthfzekkkkz.supabase.co'
VIEW = 'vw_daily_reconciliation'
BRANCH = 'SAFARI'

HERE = os.path.dirname(os.path.abspath(__file__))
APP_JS = os.path.join(HERE, os.pardir, 'app.js')

TREND_DAYS = 14          # Trends window. Wider stops printing on one page.
MAX_DAYS = 60            # rows reserved on Calc for the per-day summary
MAX_PRODUCTS = 120       # rows reserved on Calc for products (54 today)

# ---------------------------------------------------------------------------
INK = '1F2A44'
MUTED = '8A94A6'
RULE = 'D6DBE4'
HEAD_BG = '0F1B3D'
BAND = 'F4F6FA'
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

# ---------------------------------------------------------------------------
# Data sheet column order. THIS MUST MATCH counts_query.m's output exactly —
# the first 17 are the view's columns in the order the query pins them, the
# last 5 are what the query computes on top.
# ---------------------------------------------------------------------------
DATA_COLS = [
    'branch_id', 'count_date', 'shift', 'staff_name',
    'product_id', 'plu', 'short_name', 'pos_description',
    'opening_packs', 'add_in', 'closing_packs',
    'sold_physical', 'sold_pos', 'variance_packs',
    'opening_date', 'unit_price_used', 'variance_rm',
    'abs_variance', 'rank', 'day_no', 'prod_no', 'row_key',
]
COL = {name: get_column_letter(i) for i, name in enumerate(DATA_COLS, start=1)}
D = {name: f"Data!${COL[name]}:${COL[name]}" for name in DATA_COLS}


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
# Shape — mirrors counts_query.m exactly. If one changes, both change.
# ===========================================================================
def prepare(raw):
    """Rank each day's products by absolute variance, descending.

    An UNKNOWN variance gets abs_variance -1 so it sorts below every known
    zero. That distinction is the one thing here that must not be got wrong: a
    blank variance means "not checked", not "agreed", and it must never be
    ranked or totalled as if it were zero.
    """
    rows = []
    for r in raw:
        v = num(r.get('variance_packs'))
        rows.append({
            'branch_id': r.get('branch_id') or '',
            'count_date': as_date(r.get('count_date')),
            'shift': r.get('shift') or '',
            'staff_name': r.get('staff_name') or '',
            'product_id': str(r.get('product_id') or ''),
            'plu': str(r.get('plu') or ''),
            'short_name': r.get('short_name') or r.get('product_id') or '',
            'pos_description': r.get('pos_description') or '',
            'opening_packs': num(r.get('opening_packs')),
            'add_in': num(r.get('add_in')),
            'closing_packs': num(r.get('closing_packs')),
            'sold_physical': num(r.get('sold_physical')),
            'sold_pos': num(r.get('sold_pos')),
            'variance_packs': v,
            'opening_date': as_date(r.get('opening_date')),
            'unit_price_used': num(r.get('unit_price_used')),
            'variance_rm': num(r.get('variance_rm')),
            'abs_variance': abs(v) if v is not None else -1,
        })

    days = sorted({r['count_date'] for r in rows if r['count_date']}, reverse=True)
    prods = sorted({r['short_name'] for r in rows})

    by_day = defaultdict(list)
    for r in rows:
        by_day[r['count_date']].append(r)
    for d0, day in by_day.items():
        day.sort(key=lambda x: (-x['abs_variance'], x['short_name'].lower()))
        for i, x in enumerate(day, start=1):
            x['rank'] = i
    for r in rows:
        r['day_no'] = days.index(r['count_date']) + 1 if r['count_date'] else None
        r['prod_no'] = prods.index(r['short_name']) + 1
        d0 = r['count_date']
        r['row_key'] = ((d0.year * 10000 + d0.month * 100 + d0.day) * 1000
                        + r['rank']) if d0 else None

    rows.sort(key=lambda r: (r['count_date'] or date.min, r['rank']))
    return rows, days, prods


# ===========================================================================
# Sheets
# ===========================================================================
def write_data(ws, rows, mode):
    ws.sheet_state = 'hidden'
    ws.append(DATA_COLS)
    for c in range(1, len(DATA_COLS) + 1):
        ws.cell(row=1, column=c).font = Font(name='Calibri', size=10, bold=True)
    if mode == 'snapshot':
        for r in rows:
            ws.append([r.get(n) for n in DATA_COLS])
        for n in ('count_date', 'opening_date'):
            for i in range(2, len(rows) + 2):
                ws[f'{COL[n]}{i}'].number_format = DATE_FMT


# --- Calc -----------------------------------------------------------------
# Every aggregate the report needs, computed once here from the Data sheet, so
# Daily and Trends are plain lookups. Hidden: nobody should be reading this.
#
# Two counting idioms carry the whole "unknown is not zero" rule:
#   COUNTIFS(..., "<>")   how many rows have a variance AT ALL
#   COUNTIFS(..., 0)      how many of those are genuinely zero
# products-with-variance is the first minus the second, and every total is
# suppressed to "" when the first is zero. Summing a column of blanks would
# otherwise report perfect agreement on a day nothing could be checked.
CALC_DAY_ROW = 3
CALC_PROD_ROW = 3


def write_calc(ws):
    ws.sheet_state = 'hidden'
    ws['A1'] = 'per-day summary (day_no 1 = most recent counted day)'
    ws['A1'].font = Font(bold=True)
    day_hdr = ['day_no', 'date', 'staff', 'opening_date', 'products', 'known',
               'zeros', 'with_variance', 'total_packs', 'priced', 'total_rm',
               'pos_rows', 'pos_state', 'opening_known', 'message']
    for i, h in enumerate(day_hdr, start=1):
        ws.cell(row=2, column=i, value=h).font = Font(size=9, bold=True, color=MUTED)

    for k in range(1, MAX_DAYS + 1):
        r = CALC_DAY_ROW + k - 1
        first = f'MATCH($A{r},{D["day_no"]},0)'
        ws[f'A{r}'] = k
        # INDEX into an empty cell returns 0, not blank. opening_date is empty
        # until migration 10 is run, and an unguarded 0 renders as 31 Dec 1899
        # — a date that looks real. Every one of these is blank-guarded.
        def at(name):
            idx = f'INDEX({D[name]},{first})'
            return f'=IFERROR(IF({idx}="","",{idx}),"")'
        ws[f'B{r}'] = at('count_date')
        ws[f'B{r}'].number_format = DATE_FMT
        ws[f'C{r}'] = at('staff_name')
        ws[f'D{r}'] = at('opening_date')
        ws[f'D{r}'].number_format = DATE_FMT
        ws[f'E{r}'] = f'=COUNTIFS({D["day_no"]},$A{r})'
        ws[f'F{r}'] = f'=COUNTIFS({D["day_no"]},$A{r},{D["variance_packs"]},"<>")'
        ws[f'G{r}'] = f'=COUNTIFS({D["day_no"]},$A{r},{D["variance_packs"]},0)'
        ws[f'H{r}'] = f'=IF($F{r}=0,"",$F{r}-$G{r})'
        ws[f'I{r}'] = f'=IF($F{r}=0,"",SUMIFS({D["variance_packs"]},{D["day_no"]},$A{r}))'
        ws[f'J{r}'] = f'=COUNTIFS({D["day_no"]},$A{r},{D["variance_rm"]},"<>")'
        ws[f'K{r}'] = f'=IF($J{r}=0,"",SUMIFS({D["variance_rm"]},{D["day_no"]},$A{r}))'
        ws[f'L{r}'] = f'=COUNTIFS({D["day_no"]},$A{r},{D["sold_pos"]},"<>")'
        ws[f'M{r}'] = f'=IF($E{r}=0,"",IF($L{r}=0,"not loaded","loaded"))'
        ws[f'N{r}'] = f'=COUNTIFS({D["day_no"]},$A{r},{D["opening_packs"]},"<>")'
        ws[f'O{r}'] = (
            f'=IF($E{r}=0,"",'
            f'IF($L{r}=0,"No POS sales have been loaded for this date, so variance cannot be '
            f'worked out. Import the sales report for this day and it fills in.",'
            f'IF($N{r}=0,"This is the first count of these products, so there is no opening '
            f'figure to sell down from. Variance starts from the next count.",'
            f'IF($F{r}-$G{r}=0,"Physical and POS agree on every product.",'
            f'($F{r}-$G{r})&" of "&$F{r}&" products disagree with the POS. Largest first below."'
            f'))))')

    # --- per-product trends, over the last TREND_DAYS days ---
    ws['R1'] = f'per-product trends over the last {TREND_DAYS} days'
    ws['R1'].font = Font(bold=True)
    base = 18                                   # column R
    day_first = base + 2                        # T
    tail = day_first + TREND_DAYS               # after the day columns
    L = get_column_letter

    hdr = ['prod_no', 'product'] + [f'd{j}' for j in range(1, TREND_DAYS + 1)] + \
          ['known', 'zeros', 'days_off', 'total', 'worst', 'sortkey', 'rank']
    for i, h in enumerate(hdr):
        ws.cell(row=2, column=base + i, value=h).font = Font(size=9, bold=True, color=MUTED)

    c_known, c_zeros, c_off = L(tail), L(tail + 1), L(tail + 2)
    c_total, c_worst, c_sort, c_rank = L(tail + 3), L(tail + 4), L(tail + 5), L(tail + 6)
    win = f'"<="&{TREND_DAYS}'

    for k in range(1, MAX_PRODUCTS + 1):
        r = CALC_PROD_ROW + k - 1
        pn = f'$R{r}'
        ws[f'R{r}'] = k
        ws[f'S{r}'] = (f'=IFERROR(INDEX({D["short_name"]},'
                       f'MATCH({pn},{D["prod_no"]},0)),"")')
        for j in range(1, TREND_DAYS + 1):
            c = L(day_first + j - 1)
            ws[f'{c}{r}'] = (
                f'=IF(COUNTIFS({D["prod_no"]},{pn},{D["day_no"]},{j},'
                f'{D["variance_packs"]},"<>")=0,"",'
                f'SUMIFS({D["variance_packs"]},{D["prod_no"]},{pn},{D["day_no"]},{j}))')
        ws[f'{c_known}{r}'] = (f'=COUNTIFS({D["prod_no"]},{pn},{D["day_no"]},{win},'
                               f'{D["variance_packs"]},"<>")')
        ws[f'{c_zeros}{r}'] = (f'=COUNTIFS({D["prod_no"]},{pn},{D["day_no"]},{win},'
                               f'{D["variance_packs"]},0)')
        ws[f'{c_off}{r}'] = f'=IF({c_known}{r}=0,"",{c_known}{r}-{c_zeros}{r})'
        ws[f'{c_total}{r}'] = (f'=IF({c_known}{r}=0,"",SUMIFS({D["variance_packs"]},'
                               f'{D["prod_no"]},{pn},{D["day_no"]},{win}))')
        span = f'{L(day_first)}{r}:{L(day_first + TREND_DAYS - 1)}{r}'
        ws[f'{c_worst}{r}'] = (f'=IF({c_known}{r}=0,"",'
                               f'IF(ABS(MAX({span}))>=ABS(MIN({span})),MAX({span}),MIN({span})))')
        # Sort key: days off dominates, size of the gap breaks ties. A product
        # that has never been checked gets -1 so it sits below everything.
        ws[f'{c_sort}{r}'] = (f'=IF({c_known}{r}=0,-1,'
                              f'{c_off}{r}*100000+MIN(ABS({c_total}{r}),99999))')
        ws[f'{c_rank}{r}'] = (
            f'=IF($S{r}="","",1'
            f'+COUNTIFS(${c_sort}${CALC_PROD_ROW}:${c_sort}${CALC_PROD_ROW + MAX_PRODUCTS - 1},'
            f'">"&{c_sort}{r})'
            f'+COUNTIFS(${c_sort}${CALC_PROD_ROW}:${c_sort}${CALC_PROD_ROW + MAX_PRODUCTS - 1},'
            f'{c_sort}{r},$R${CALC_PROD_ROW}:$R${CALC_PROD_ROW + MAX_PRODUCTS - 1},"<"&{pn}))')

    return {'rank': c_rank, 'off': c_off, 'total': c_total, 'worst': c_worst,
            'day_first': day_first}


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
    # Added was dropped while the count screen was the only way in and add_in was
    # always zero — a column of zeros implies something was checked. Restocks put
    # real numbers in it, and without the column Sold (counted) stops adding up:
    # opening minus closing no longer explains it on a delivery day.
    ('Added', 10, 'right'),
    ('Closing', 11, 'right'),
    ('Sold (counted)', 15, 'right'),
    ('Sold (POS)', 13, 'right'),
    ('Variance', 11, 'right'),
    ('Variance RM', 13, 'right'),
    ('Item ID', 10, 'left'),
    ('PLU', 15, 'left'),
]
FIRST_ROW = 10
HDR_ROW = 9
DAILY_ROWS = 70          # products shown; more than any day has


def write_daily(ws):
    calc_days = f'Calc!$B${CALC_DAY_ROW}:$B${CALC_DAY_ROW + MAX_DAYS - 1}'

    def pick(col):
        idx = f'INDEX(Calc!${col}${CALC_DAY_ROW}:${col}${CALC_DAY_ROW + MAX_DAYS - 1},$L$1)'
        return f'IF($L$1="","—",IF({idx}="","—",{idx}))'

    ws['L1'] = f'=IFERROR(MATCH($B$3,{calc_days},0),"")'

    ws['A1'] = 'Cigarette reconciliation'
    ws['A1'].font = Font(name='Calibri', size=18, bold=True, color=INK)
    ws.merge_cells('A1:D1')
    # The stamp whose absence let a stale file pass for a fresh one. The newest
    # day in the file is a better signal than a refresh time: if the day you
    # counted this morning is not in the list, the number here says so.
    ws['F1'] = (f'=IF(COUNT({D["day_no"]})=0,"Data sheet is empty — attach the query",'
                f'"Safari · "&COUNT(Calc!$B${CALC_DAY_ROW}:$B${CALC_DAY_ROW + MAX_DAYS - 1})'
                f'&" days loaded, latest "&TEXT(MAX({D["count_date"]}),"dd mmm yyyy"))')
    ws['F1'].font = Font(name='Calibri', size=10, bold=True, color=MUTED)
    ws['F1'].alignment = Alignment(horizontal='right')
    ws.merge_cells('F1:J1')

    label(ws, 'A2', 'TRADING DAY (CLOSING)')
    ws['A3'] = 'Show:'
    ws['A3'].font = Font(name='Calibri', size=10, bold=True, color=INK)
    ws['A3'].alignment = Alignment(horizontal='left', vertical='center')
    ws['B3'] = f'=IFERROR(INDEX({D["count_date"]},MATCH(1,{D["day_no"]},0)),"")'
    ws['B3'].number_format = DATE_FMT
    ws['B3'].font = Font(name='Calibri', size=14, bold=True, color='1F4E79')
    ws['B3'].alignment = Alignment(horizontal='left', vertical='center')
    ws['B3'].border = BOX
    ws['B3'].fill = PatternFill('solid', fgColor='EAF1FB')

    dv = DataValidation(type='list', formula1=f'={calc_days}',
                        allow_blank=False, showDropDown=False)
    dv.error = ('Pick a trading day from the dropdown. Only days with a submitted '
                'count are in the list.')
    dv.errorTitle = 'Not a counted day'
    dv.showErrorMessage = True
    ws.add_data_validation(dv)
    dv.add(ws['B3'])

    label(ws, 'D2', 'OPENING FROM')
    value(ws, 'D3', f'={pick("D")}', DATE_FMT, size=11)
    label(ws, 'F2', 'COUNTED BY')
    value(ws, 'F3', f'={pick("C")}', None, size=11)
    label(ws, 'H2', 'PRODUCTS')
    value(ws, 'H3', f'={pick("E")}', INT_FMT, size=11)

    label(ws, 'A5', 'PRODUCTS WITH VARIANCE')
    value(ws, 'A6', f'={pick("H")}', INT_FMT)
    label(ws, 'D5', 'TOTAL VARIANCE (PACKS)')
    value(ws, 'D6', f'={pick("I")}', INT_FMT)
    label(ws, 'F5', 'TOTAL VARIANCE (RM)')
    value(ws, 'F6', f'={pick("K")}', RM_FMT)
    label(ws, 'H5', 'POS SALES')
    value(ws, 'H6', f'={pick("M")}', None, size=11)

    # Before the query is attached there is no day to describe, and a bare em
    # dash in a highlighted bar reads as broken rather than as "not set up yet".
    ws['A7'] = (f'=IF(COUNT({D["day_no"]})=0,'
                f'"No data yet — follow the Setup sheet to attach the query, once.",'
                f'{pick("O")})')
    ws['A7'].font = Font(name='Calibri', size=10, bold=True, color=WARN_AMBER)
    ws['A7'].alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)
    ws.merge_cells('A7:J7')
    ws['A7'].fill = PatternFill('solid', fgColor=AMBER_FILL)
    ws.row_dimensions[7].height = 32

    for i, (text, width, align) in enumerate(DAILY_HEADERS, start=1):
        c = ws.cell(row=HDR_ROW, column=i, value=text)
        c.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor=HEAD_BG)
        c.alignment = Alignment(horizontal=align, vertical='center', wrap_text=True)
        c.border = BOX
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[HDR_ROW].height = 28

    last_row = FIRST_ROW + DAILY_ROWS - 1
    for r in range(FIRST_ROW, last_row + 1):
        n = r - FIRST_ROW + 1
        # The lookup key, built from date parts: yyyymmdd * 1000 + rank. Not
        # TEXT(d,"yyyy-mm-dd"), whose tokens are localised, and not a date
        # serial, which would rely on Power Query and Excel agreeing about day
        # zero. Parts rely on nothing.
        key = (f'(YEAR($B$3)*10000+MONTH($B$3)*100+DAY($B$3))*1000+{n}')
        ws[f'L{r}'] = f'=IFERROR(MATCH({key},{D["row_key"]},0),"")'
        m = f'$L{r}'
        hit = f'AND(ISNUMBER({m}),{m}<>"")'

        def cell(col, name, fmt=None, align='right', dash=True, bold=False):
            idx = f'INDEX({D[name]},{m})'
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
        cell('C', 'add_in', INT_FMT, dash=False)
        cell('D', 'closing_packs', INT_FMT, dash=False)
        cell('E', 'sold_physical', INT_FMT)
        cell('F', 'sold_pos', INT_FMT)
        cell('G', 'variance_packs', INT_FMT, bold=True)
        cell('H', 'variance_rm', RM_FMT)
        cell('I', 'product_id', None, 'left', dash=False).font = \
            Font(name='Consolas', size=9, color=MUTED)
        cell('J', 'plu', None, 'left', dash=False).font = \
            Font(name='Consolas', size=9, color=MUTED)

    ws.column_dimensions['L'].hidden = True
    variance_rules(ws, f'G{FIRST_ROW}:H{last_row}', f'$G{FIRST_ROW}')
    ws.freeze_panes = f'A{FIRST_ROW}'

    ws.print_area = f'A1:J{last_row}'
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


def variance_rules(ws, rng, anchor):
    """Grey at zero, red from one pack, heavier at five and again at ten.

    Every rule tests ISNUMBER first, so an em dash — which means "not known" —
    is never coloured as though it were a number.
    """
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


TRENDS_ROW0 = 4


def write_trends(ws, calc):
    ws['A1'] = f'Variance by product — last {TREND_DAYS} counted days'
    ws['A1'].font = Font(name='Calibri', size=16, bold=True, color=INK)
    ws['A2'] = ('Sorted by how many days the product disagreed with the POS, then by total. '
                'A product off a little every night sits above one that was off a lot once. '
                'A dash means no POS sales were loaded for that day.')
    ws['A2'].font = Font(name='Calibri', size=9, italic=True, color=MUTED)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=TREND_DAYS + 4)

    L = get_column_letter
    ncols = 1 + TREND_DAYS + 3
    hdr = ['Product'] + [''] * TREND_DAYS + ['Days off', 'Total', 'Worst']
    for i, text in enumerate(hdr, start=1):
        c = ws.cell(row=TRENDS_ROW0, column=i, value=text)
        c.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor=HEAD_BG)
        c.alignment = Alignment(horizontal='center' if i > 1 else 'left',
                                vertical='center', wrap_text=True)
        c.border = BOX
    # Day headers are the dates themselves, newest first, straight off Calc.
    for j in range(1, TREND_DAYS + 1):
        c = ws.cell(row=TRENDS_ROW0, column=1 + j)
        c.value = (f'=IF(Calc!$B${CALC_DAY_ROW + j - 1}="","",'
                   f'TEXT(Calc!$B${CALC_DAY_ROW + j - 1},"dd mmm"))')
    ws.row_dimensions[TRENDS_ROW0].height = 26
    ws.column_dimensions['A'].width = 30
    for i in range(2, ncols + 1):
        ws.column_dimensions[L(i)].width = 9.5

    cr, co, ct, cw = calc['rank'], calc['off'], calc['total'], calc['worst']
    pr0, pr1 = CALC_PROD_ROW, CALC_PROD_ROW + MAX_PRODUCTS - 1
    rank_rng = f'Calc!${cr}${pr0}:${cr}${pr1}'

    for k in range(1, MAX_PRODUCTS + 1):
        r = TRENDS_ROW0 + k
        ws[f'{L(ncols + 2)}{r}'] = f'=IFERROR(MATCH({k},{rank_rng},0),"")'
        m = f'${L(ncols + 2)}{r}'
        hit = f'AND(ISNUMBER({m}),{m}<>"")'

        def pull(col_letter, calc_col, fmt=None, bold=False, align='right'):
            src = f'INDEX(Calc!${calc_col}${pr0}:${calc_col}${pr1},{m})'
            c = ws[f'{col_letter}{r}']
            c.value = f'=IF({hit},IF({src}="","—",{src}),"")'
            c.alignment = Alignment(horizontal=align, vertical='center')
            c.border = BOX
            c.font = Font(name='Calibri', size=10, bold=bold, color=INK)
            if fmt:
                c.number_format = fmt
            if k % 2 == 0:
                c.fill = PatternFill('solid', fgColor=BAND)
            return c

        c = ws[f'A{r}']
        c.value = (f'=IF({hit},INDEX(Calc!$S${pr0}:$S${pr1},{m}),"")')
        c.alignment = Alignment(horizontal='left', vertical='center')
        c.border = BOX
        c.font = Font(name='Calibri', size=10, color=INK)
        if k % 2 == 0:
            c.fill = PatternFill('solid', fgColor=BAND)

        for j in range(1, TREND_DAYS + 1):
            pull(L(1 + j), L(calc['day_first'] + j - 1), INT_FMT)
        pull(L(TREND_DAYS + 2), co, INT_FMT, bold=True)
        pull(L(TREND_DAYS + 3), ct, INT_FMT, bold=True)
        pull(L(TREND_DAYS + 4), cw, INT_FMT)

    ws.column_dimensions[L(ncols + 2)].hidden = True
    last = TRENDS_ROW0 + MAX_PRODUCTS
    variance_rules(ws, f'B{TRENDS_ROW0 + 1}:{L(TREND_DAYS + 3)}{last}',
                   f'B{TRENDS_ROW0 + 1}')

    ws.freeze_panes = f'B{TRENDS_ROW0 + 1}'
    ws.print_area = f'A1:{L(ncols)}{last}'
    ws.print_title_rows = f'{TRENDS_ROW0}:{TRENDS_ROW0}'
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
    ('The line at the top right says how many days are loaded and what the latest one is. '
     'If the day you counted this morning is not the latest, the file has not been '
     'refreshed — press Data > Refresh All.', ''),
    ('', ''),
    ('What the columns mean', 'h2'),
    ('Opening — what the previous submitted count left on the shelf. "Opening from" in '
     'the summary is the day that count was taken. If it is not the day before, a day '
     'was skipped, and two days of sales are folded into one figure.', ''),
    ('Added — packs put onto the shelf since that opening count, from the restock records. '
     'Several restocks in the same period are summed.', ''),
    ('Closing — what was counted on the trading day named at the top.', ''),
    ('Sold (counted) — Opening plus Added minus Closing. What the shelf says went out.', ''),
    ('Sold (POS) — what the till says it sold, from the imported sales report.', ''),
    ('Variance — Sold (counted) minus Sold (POS), straight from the database view. '
     'It is not recalculated here, so it cannot drift from what the system believes.', ''),
    ('  positive — more left the shelf than the till sold: shrinkage, a miscount, or '
     'stock put out and not recorded.', ''),
    ('  negative — the till sold more than the shelf lost: usually a delivery.', ''),
    ('  an em dash — not known, not zero. Either no POS sales are loaded for that day, '
     'or it is the first count of that product and there is no opening to sell down from.', ''),
    ('Variance RM — the variance valued at the price that day\'s report printed, falling '
     'back to the product list price. Blank means neither is known.', ''),
    ('', ''),
    ('Trends', 'h2'),
    ('Variance by product over the last 14 counted days, sorted by how many days each '
     'product was off before how large the gap was. That ordering is the point: five '
     'nights of one pack is a leak worth chasing, one night of five packs is an event. '
     'The leak sits at the top. Anything older than 14 days is still on the Data sheet.', ''),
    ('', ''),
    ('Two things that will skew variance', 'h2'),
    ('Deliveries have to be recorded to count. The count screen collects one number per '
     'product and does not capture stock put out during the day; that is what the Restock '
     'screen is for, and what the Added column shows. A delivery nobody recorded still '
     'reads as negative variance, because as far as the shelf is concerned the packs '
     'appeared from nowhere. Check Added before believing a large negative day.', ''),
    ('Counts must be consecutive. Opening is the previous submitted count\'s closing, '
     'whatever date that was. Check "Opening from" before believing a large variance.', ''),
    ('', ''),
    ('Refreshing', 'h2'),
    ('Data > Refresh All, or just open the file if refresh-on-open is ticked. The rows '
     'come from the database through the query named Counts; the sheets are formulas on '
     'top of them, so new days and new products appear without anything being edited.', ''),
    ('The Data and Calc sheets are hidden. Data is the query\'s landing zone and Calc '
     'holds the working-out. Neither should be edited by hand: Data is overwritten on '
     'every refresh, and Calc is what Daily and Trends read.', ''),
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
        r += 1
    ws.sheet_view.showGridLines = False


SETUP = [
    ('Attach the data — about fifteen minutes, once', 'h1'),
    ('', ''),
    ('Until this is done, Daily and Trends are empty and the line at the top right of '
     'Daily says "Data sheet is empty". Nothing is broken; the rows simply are not there '
     'yet. After it is done the workbook refreshes itself and this sheet can be ignored.', ''),
    ('', ''),
    ('1. Open a blank query', 'h2'),
    ('Data > Get Data > From Other Sources > Blank Query.', ''),
    ('', ''),
    ('2. Paste the query', 'h2'),
    ('Home > Advanced Editor. Delete what is there. Paste the whole of counts_query.m '
     'from the excel folder. Done.', ''),
    ('', ''),
    ('3. Name it exactly  Counts', 'h2'),
    ('In the Query Settings pane on the right. The name matters less than it used to — '
     'the sheets address columns by position, not by table name — but keep it so the next '
     'person can find it.', ''),
    ('', ''),
    ('4. Load it onto the Data sheet', 'h2'),
    ('Home > Close & Load To... > Table > Existing worksheet > put the cursor in Data!$A$1 '
     '> OK. If Excel asks about credentials for supabase.co, choose Anonymous.', ''),
    ('IMPORTANT: it must land on the Data sheet at A1. The columns must sit in the order '
     'the query returns them, because every formula in the workbook finds its values by '
     'column position. If it lands somewhere else, undo and redo this step.', ''),
    ('', ''),
    ('5. Make it automatic', 'h2'),
    ('Data > Queries & Connections > right-click Counts > Properties. Tick "Refresh data '
     'when opening the file" and "Refresh every 60 minutes".', ''),
    ('', ''),
    ('Then check three things', 'h2'),
    ('The top right of Daily names the latest counted day. It should be the most recent '
     'count that has been submitted.', ''),
    ('Pick the earliest day in the dropdown — the very first count. Variance, Opening and '
     'Sold (counted) should all read as dashes, and the amber line should say there is no '
     'opening figure. If any of those read 0 instead, tell Claude: a dash means "not '
     'checked" and a zero means "agreed", and they must never be confused.', ''),
    ('Submit a count, then press Data > Refresh All. The new day should appear in the '
     'dropdown on its own.', ''),
]


def write_setup(ws):
    ws.column_dimensions['A'].width = 104
    r = 1
    for text, kind in SETUP:
        c = ws.cell(row=r, column=1, value=text)
        if kind == 'h1':
            c.font = Font(name='Calibri', size=16, bold=True, color=INK)
        elif kind == 'h2':
            c.font = Font(name='Calibri', size=12, bold=True, color='1F4E79')
            c.border = UNDER
        else:
            c.font = Font(name='Calibri', size=10, color=INK)
            c.alignment = Alignment(wrap_text=True, vertical='top')
        r += 1
    ws.sheet_view.showGridLines = False


# ===========================================================================
def build(rows, mode, out):
    wb = Workbook()
    daily = wb.active
    daily.title = 'Daily'
    trends = wb.create_sheet('Trends')
    notes = wb.create_sheet('Notes')
    if mode == 'query':
        setup = wb.create_sheet('Setup')
        write_setup(setup)
    calc = wb.create_sheet('Calc')
    data = wb.create_sheet('Data')

    write_data(data, rows, mode)
    handles = write_calc(calc)
    write_daily(daily)
    write_trends(trends, handles)
    write_notes(notes)

    # Nothing in the file carries a cached result, so Excel has to be told to
    # work them out when it opens rather than showing a grid of zeros.
    wb.calculation.fullCalcOnLoad = True
    wb.active = 0
    wb.save(out)
    return wb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-m', '--mode', choices=('query', 'snapshot'), default='query')
    ap.add_argument('-o', '--out', default=None)
    args = ap.parse_args()
    out = args.out or os.path.join(
        HERE, 'Cigarette Reconciliation.xlsx' if args.mode == 'query'
        else 'Cigarette Reconciliation (snapshot).xlsx')

    rows, days, prods = [], [], []
    if args.mode == 'snapshot':
        raw = fetch(anon_key())
        if not raw:
            sys.exit(f'{VIEW} returned nothing for {BRANCH}. Is a count submitted?')
        rows, days, prods = prepare(raw)

    build(rows, args.mode, out)

    print(f'wrote {out}  [{args.mode}]')
    if args.mode == 'query':
        print('  Data is empty by design. Follow the Setup sheet to attach the query,')
        print('  then the workbook refreshes itself — no more running this script.')
    else:
        print(f'  {len(rows)} rows over {len(days)} days, {len(prods)} products')
        if days:
            print(f'  latest {days[0]}, earliest {days[-1]}')
    if len(prods) > MAX_PRODUCTS or len(days) > MAX_DAYS:
        print(f'  WARNING: exceeds the reserved Calc rows '
              f'(days {len(days)}/{MAX_DAYS}, products {len(prods)}/{MAX_PRODUCTS})')


if __name__ == '__main__':
    main()
