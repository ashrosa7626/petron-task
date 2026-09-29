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
# Every colour is written as 8-digit ARGB. Six digits work, but openpyxl fills
# in the alpha byte for you and different versions fill in a different one —
# 3.1.5 writes 00, the version this workbook shipped from wrote FF — so a
# rebuild on another machine rewrites all 36 colours in the file for no reason.
# Saying FF here makes the output the same whoever builds it.
INK = 'FF1F2A44'
MUTED = 'FF8A94A6'
RULE = 'FFD6DBE4'
HEAD_BG = 'FF0F1B3D'
BAND = 'FFF4F6FA'
WARN_AMBER = 'FF9A6500'
# The three variance bands. All three are RED TEXT and get darker as the gap
# grows; the fill behind them is emphasis and nothing more. The >=10 band used
# to be white text on a dark red fill, which is how a variance came to be
# invisible on the shop's copy: a solid fill inside a CONDITIONAL format is a
# dxf, and Excel paints a dxf solid fill from bgColor, not fgColor. openpyxl
# writes fgColor, so the dark red never arrived and white text was left sitting
# on a white cell. dxf_fill() below now writes both, but the colours no longer
# depend on that having worked — a fill that fails to render must never take
# the number with it.
RED_1 = 'FFC0392B'        # >= 1 pack
RED_2 = 'FF96281B'        # >= 5 packs
RED_3 = 'FF7B241C'        # >= 10 packs, the darkest red
RED_3_BG = 'FFF5B7B1'     # light enough that RED_3 reads on top of it
RED_FILL_LIGHT = 'FFFDEDEC'
AMBER_FILL = 'FFFEF5E7'

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
    'opening_date', 'unit_price_used', 'variance_rm', 'category',
    'abs_variance', 'rank', 'day_no', 'prod_no', 'row_key',
]
COL = {name: get_column_letter(i) for i, name in enumerate(DATA_COLS, start=1)}


def sheet_ref(name):
    """A sheet name as a formula prefix, bang included: `Data!` or `'My Data'!`.

    The bang is part of what this returns on purpose. Leaving it to the caller is
    how the first version of this refactor emitted `Data$U:$U` in every formula on
    every sheet — which Excel reads as a name it has never heard of, so the whole
    workbook came out as #NAME? rather than as anything that looked like a bug in
    a sheet reference.

    Only the Calc and Data sheets are ever named inside a formula, and those are
    deliberately kept space-free so nothing depends on the quoting — but a rename
    that added a space would otherwise produce `Lubes Data!$A:$A`, which is
    equally broken and equally quiet.
    """
    bare = re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name)
    return f"{name}!" if bare else f"'{name}'!"


def dcols(data_sheet):
    """Whole-column references into one Data sheet, by column name.

    Whole columns rather than structured references, and that choice is the
    reason the column ORDER on the Data sheet is load-bearing — see the module
    docstring. One dict per category, because each shelf has its own Data sheet
    fed by its own query.
    """
    return {name: f"{sheet_ref(data_sheet)}${COL[name]}:${COL[name]}" for name in DATA_COLS}


# ---------------------------------------------------------------------------
# One shelf, one set of tabs.
#
# A category is a shelf, and each reconciles against its own POS report, so each
# gets its own query, its own hidden Data and Calc, and its own Daily and Trends
# — the same layout generated twice rather than a second workbook to keep in
# step. Adding heated tobacco is one more entry here and one more query attached.
#
# CIGARETTES deliberately keeps the ORIGINAL sheet names. The workbook already in
# use has the `Counts` query loaded to `Data!$A$1`; renaming that sheet would
# break the attachment in a file somebody has open, to no purpose.
# ---------------------------------------------------------------------------
TABS = [
    {'category': 'CIGARETTES', 'label': 'Cigarette', 'plural': 'cigarettes',
     'daily': 'Daily', 'trends': 'Trends', 'calc': 'Calc', 'data': 'Data',
     'query': 'Counts'},
    {'category': 'LUBES', 'label': 'Lubes', 'plural': 'lubes',
     'daily': 'Lubes Daily', 'trends': 'Lubes Trends',
     # No space in the hidden ones: they are the only sheets a formula names.
     'calc': 'LubesCalc', 'data': 'LubesData',
     'query': 'Lubes'},
]


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
            # Carried so the hidden Data sheet matches counts_query.m column for
            # column. The report itself is cigarettes only — the query filters —
            # so nothing on Daily or Trends reads it.
            'category': r.get('category') or 'CIGARETTES',
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


def write_calc(ws, D):
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


def write_daily(ws, tab, D):
    calc = sheet_ref(tab['calc'])
    calc_days = f'{calc}$B${CALC_DAY_ROW}:$B${CALC_DAY_ROW + MAX_DAYS - 1}'

    def pick(col):
        idx = f'INDEX({calc}${col}${CALC_DAY_ROW}:${col}${CALC_DAY_ROW + MAX_DAYS - 1},$L$1)'
        return f'IF($L$1="","—",IF({idx}="","—",{idx}))'

    ws['L1'] = f'=IFERROR(MATCH($B$3,{calc_days},0),"")'

    ws['A1'] = f"{tab['label']} reconciliation"
    ws['A1'].font = Font(name='Calibri', size=18, bold=True, color=INK)
    ws.merge_cells('A1:D1')
    # The stamp whose absence let a stale file pass for a fresh one. The newest
    # day in the file is a better signal than a refresh time: if the day you
    # counted this morning is not in the list, the number here says so.
    # Also checks that the query feeding this tab is the RIGHT one. Two queries
    # differing by a single line is exactly the mistake that gets made, and a
    # Lubes tab quietly showing cigarette rows is the Excel version of a count
    # filed against the wrong branch: every figure looks reasonable and every one
    # is about something else.
    #
    # Two subtleties, both of which got this wrong first time round:
    #   * the "<>" criterion as well, or the blank part of the column counts as
    #     "not this category" and the warning is permanent;
    #   * from row 2, not the whole column — row 1 holds the header, and the word
    #     "category" is itself non-blank and not "CIGARETTES", so a whole-column
    #     version fired on every tab of a perfectly correct workbook. This is the
    #     one reference in the file that is not a whole column, and it still grows
    #     on refresh because it runs to the last row Excel has.
    cc = COL['category']
    cat = f'{sheet_ref(tab["data"])}${cc}$2:${cc}$1048576'
    wrong = f'COUNTIFS({cat},"<>",{cat},"<>{tab["category"]}")'
    ws['F1'] = (f'=IF(COUNT({D["day_no"]})=0,'
                f'"No rows yet — no submitted {tab["plural"]} count, or the '
                f'{tab["query"]} query is not attached",'
                f'IF({wrong}>0,"WRONG QUERY: this sheet has rows that are not '
                f'{tab["category"]} — reattach {tab["query"]}",'
                f'"Safari · "&COUNT({calc}$B${CALC_DAY_ROW}:$B${CALC_DAY_ROW + MAX_DAYS - 1})'
                f'&" days loaded, latest "&TEXT(MAX({D["count_date"]}),"dd mmm yyyy")))')
    ws['F1'].font = Font(name='Calibri', size=10, bold=True, color=MUTED)
    ws['F1'].alignment = Alignment(horizontal='right')
    ws.merge_cells('F1:J1')

    label(ws, 'A2', 'TRADING DAY (CLOSING)')
    ws['A3'] = 'Show:'
    ws['A3'].font = Font(name='Calibri', size=10, bold=True, color=INK)
    ws['A3'].alignment = Alignment(horizontal='left', vertical='center')
    ws['B3'] = f'=IFERROR(INDEX({D["count_date"]},MATCH(1,{D["day_no"]},0)),"")'
    ws['B3'].number_format = DATE_FMT
    ws['B3'].font = Font(name='Calibri', size=14, bold=True, color='FF1F4E79')
    ws['B3'].alignment = Alignment(horizontal='left', vertical='center')
    ws['B3'].border = BOX
    ws['B3'].fill = PatternFill('solid', fgColor='FFEAF1FB')

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
                f'"Nothing to show yet. Either no {tab["plural"]} count has been submitted, '
                f'or the {tab["query"]} query is not attached — see the Setup sheet.",'
                f'{pick("O")})')
    ws['A7'].font = Font(name='Calibri', size=10, bold=True, color=WARN_AMBER)
    ws['A7'].alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)
    ws.merge_cells('A7:J7')
    ws['A7'].fill = PatternFill('solid', fgColor=AMBER_FILL)
    ws.row_dimensions[7].height = 32

    for i, (text, width, align) in enumerate(DAILY_HEADERS, start=1):
        c = ws.cell(row=HDR_ROW, column=i, value=text)
        c.font = Font(name='Calibri', size=10, bold=True, color='FFFFFFFF')
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
    ws.oddFooter.left.text = f"{tab['label']} reconciliation — &[Tab]"
    ws.oddFooter.right.text = 'Page &[Page] of &[Pages]'


def dxf_fill(colour):
    """A solid fill for a CONDITIONAL format, coloured from both ends.

    A conditional format is written as a dxf, and Excel paints a dxf solid fill
    from bgColor — openpyxl only writes fgColor, so the fill silently does not
    appear. Setting both means the cell comes out the same colour whichever end
    the reader takes.
    """
    return PatternFill('solid', fgColor=colour, bgColor=colour)


def variance_rules(ws, rng, anchor):
    """Grey at zero, red from one pack, darker at five and again at ten.

    Every rule tests ISNUMBER first, so an em dash — which means "not known" —
    is never coloured as though it were a number.

    The NUMBER is always red and never white. Legibility is the font's job
    alone: the >=10 band was white on dark red, the fill did not render (see
    dxf_fill), and the variance that mattered most was the one nobody could
    read.
    """
    grey = Font(name='Calibri', size=10, color=MUTED)
    for rule in (
        FormulaRule(formula=[f'AND(ISNUMBER({anchor}),{anchor}=0)'],
                    font=grey, stopIfTrue=True),
        FormulaRule(formula=[f'AND(ISNUMBER({anchor}),ABS({anchor})>=10)'],
                    font=Font(name='Calibri', size=10, bold=True, color=RED_3),
                    fill=dxf_fill(RED_3_BG), stopIfTrue=True),
        FormulaRule(formula=[f'AND(ISNUMBER({anchor}),ABS({anchor})>=5)'],
                    font=Font(name='Calibri', size=10, bold=True, color=RED_2),
                    fill=dxf_fill(RED_FILL_LIGHT), stopIfTrue=True),
        FormulaRule(formula=[f'AND(ISNUMBER({anchor}),ABS({anchor})>=1)'],
                    font=Font(name='Calibri', size=10, bold=True, color=RED_1),
                    stopIfTrue=True),
    ):
        ws.conditional_formatting.add(rng, rule)


TRENDS_ROW0 = 4


def write_trends(ws, handles, tab, D):
    calc = sheet_ref(tab['calc'])
    ws['A1'] = f"{tab['label']} variance by product — last {TREND_DAYS} counted days"
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
        c.font = Font(name='Calibri', size=10, bold=True, color='FFFFFFFF')
        c.fill = PatternFill('solid', fgColor=HEAD_BG)
        c.alignment = Alignment(horizontal='center' if i > 1 else 'left',
                                vertical='center', wrap_text=True)
        c.border = BOX
    # Day headers are the dates themselves, newest first, straight off Calc.
    for j in range(1, TREND_DAYS + 1):
        c = ws.cell(row=TRENDS_ROW0, column=1 + j)
        c.value = (f'=IF({calc}$B${CALC_DAY_ROW + j - 1}="","",'
                   f'TEXT({calc}$B${CALC_DAY_ROW + j - 1},"dd mmm"))')
    ws.row_dimensions[TRENDS_ROW0].height = 26
    ws.column_dimensions['A'].width = 30
    for i in range(2, ncols + 1):
        ws.column_dimensions[L(i)].width = 9.5

    cr, co, ct, cw = handles['rank'], handles['off'], handles['total'], handles['worst']
    pr0, pr1 = CALC_PROD_ROW, CALC_PROD_ROW + MAX_PRODUCTS - 1
    rank_rng = f'{calc}${cr}${pr0}:${cr}${pr1}'

    for k in range(1, MAX_PRODUCTS + 1):
        r = TRENDS_ROW0 + k
        ws[f'{L(ncols + 2)}{r}'] = f'=IFERROR(MATCH({k},{rank_rng},0),"")'
        m = f'${L(ncols + 2)}{r}'
        hit = f'AND(ISNUMBER({m}),{m}<>"")'

        def pull(col_letter, calc_col, fmt=None, bold=False, align='right'):
            src = f'INDEX({calc}${calc_col}${pr0}:${calc_col}${pr1},{m})'
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
        c.value = (f'=IF({hit},INDEX({calc}$S${pr0}:$S${pr1},{m}),"")')
        c.alignment = Alignment(horizontal='left', vertical='center')
        c.border = BOX
        c.font = Font(name='Calibri', size=10, color=INK)
        if k % 2 == 0:
            c.fill = PatternFill('solid', fgColor=BAND)

        for j in range(1, TREND_DAYS + 1):
            pull(L(1 + j), L(handles['day_first'] + j - 1), INT_FMT)
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
    ('Reconciliation — how to read this', 'h1'),
    ('', ''),
    ('One shelf, one pair of tabs', 'h2'),
    ('Daily and Trends are the cigarette gondola. Lubes Daily and Lubes Trends are the '
     'lubes shelf. They are the same layout twice over and they read nothing from each '
     'other: each pair is fed by its own query, because each shelf is counted separately '
     'and reconciles against its own POS report. Everything below applies to both.', ''),
    ('Heated tobacco is not here yet. It is counted alongside the cigarettes but prints '
     'its own sales report, so it needs its own pair of tabs and its own query — one entry '
     'in the builder when its sales start being imported.', ''),
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
    ('Data > Refresh All, or just open the file if refresh-on-open is ticked. It refreshes '
     'every shelf at once. The rows come from the database through one query per shelf — '
     'Counts for cigarettes, Lubes for lubes; the sheets are formulas on top of them, so '
     'new days and new products appear without anything being edited.', ''),
    ('The Data and Calc sheets are hidden — one pair per shelf. Data is a query\'s landing '
     'zone and Calc holds the working-out. Neither should be edited by hand: Data is '
     'overwritten on every refresh, and Calc is what that shelf\'s tabs read.', ''),
    ('If a Daily tab says WRONG QUERY at the top right, the two queries have been swapped: '
     'one of them is filtered to the other shelf. Reattach it with the right Category line '
     '— the Setup sheet has the detail.', ''),
    ('An empty pair of tabs means no count of that shelf has been SUBMITTED yet. A draft '
     'never reaches Excel, which is deliberate: a half-finished count must not reconcile.', ''),
]


def write_notes(ws):
    ws.column_dimensions['A'].width = 112
    r = 1
    for text, kind in NOTES:
        c = ws.cell(row=r, column=1, value=text)
        if kind == 'h1':
            c.font = Font(name='Calibri', size=16, bold=True, color=INK)
        elif kind == 'h2':
            c.font = Font(name='Calibri', size=12, bold=True, color='FF1F4E79')
            c.border = UNDER
        else:
            c.font = Font(name='Calibri', size=10, color=INK)
            c.alignment = Alignment(wrap_text=True, vertical='top')
        r += 1
    ws.sheet_view.showGridLines = False


SETUP = [
    ('Attach the data — about fifteen minutes, once per shelf', 'h1'),
    ('', ''),
    ('There is one query per shelf, and each one lands on its own hidden sheet. Until a '
     'shelf\'s query is attached its tabs are empty and the line at the top right of its '
     'Daily tab says so. Nothing is broken; the rows simply are not there yet. After it is '
     'done the workbook refreshes itself and this sheet can be ignored.', ''),
    ('', ''),
    ('     Cigarettes    query named  Counts    loads to  Data!$A$1', ''),
    ('     Lubes         query named  Lubes     loads to  LubesData!$A$1', ''),
    ('', ''),
    ('The two queries are the SAME FILE with one line changed. That is the one thing to be '
     'careful about here, and the workbook checks it for you: if a tab ends up fed by the '
     'wrong shelf\'s query, the line at its top right says WRONG QUERY instead of naming a '
     'date. A Lubes tab quietly showing cigarette rows would otherwise look perfectly '
     'reasonable and be about the wrong stock entirely.', ''),
    ('', ''),
    ('1. Open a blank query', 'h2'),
    ('Data > Get Data > From Other Sources > Blank Query.', ''),
    ('', ''),
    ('2. Paste the query', 'h2'),
    ('Home > Advanced Editor. Delete what is there. Paste the whole of counts_query.m '
     'from the excel folder. Done.', ''),
    ('', ''),
    ('3. Set the shelf, and name the query to match', 'h2'),
    ('Near the top of the pasted query there is one line:  Category = "CIGARETTES",', ''),
    ('For the cigarette query leave it alone and name the query  Counts.', ''),
    ('For the lubes query change it to  Category = "LUBES",  and name the query  Lubes.', ''),
    ('The name is in the Query Settings pane on the right. It does not drive any formula — '
     'the sheets address columns by position — but the next person has to be able to tell '
     'the two apart.', ''),
    ('', ''),
    ('4. Load it onto that shelf\'s Data sheet', 'h2'),
    ('Home > Close & Load To... > Table > Existing worksheet > put the cursor in the cell '
     'named in the table above > OK. If Excel asks about credentials for supabase.co, '
     'choose Anonymous.', ''),
    ('IMPORTANT: it must land at A1 of the right sheet, and the columns must sit in the '
     'order the query returns them, because every formula in the workbook finds its values '
     'by column position. If it lands somewhere else, undo and redo this step.', ''),
    ('', ''),
    ('5. Make it automatic', 'h2'),
    ('Data > Queries & Connections > right-click the query > Properties. Tick "Refresh '
     'data when opening the file" and "Refresh every 60 minutes". Do this for each one.', ''),
    ('', ''),
    ('6. Repeat for the other shelf', 'h2'),
    ('Steps 1 to 5 again, with the other row of the table above. The two queries are '
     'independent: attaching one does nothing to the other, and a shelf with no query is '
     'simply a pair of empty tabs.', ''),
    ('', ''),
    ('Then check three things', 'h2'),
    ('The top right of each Daily tab names that shelf\'s latest counted day. It should be '
     'the most recent count of that shelf that has been submitted — and it must not say '
     'WRONG QUERY.', ''),
    ('Pick the earliest day in the dropdown — the very first count. Variance, Opening and '
     'Sold (counted) should all read as dashes, and the amber line should say there is no '
     'opening figure. If any of those read 0 instead, tell Claude: a dash means "not '
     'checked" and a zero means "agreed", and they must never be confused.', ''),
    ('Submit a count, then press Data > Refresh All. The new day should appear in that '
     'shelf\'s dropdown on its own.', ''),
]


def write_setup(ws):
    ws.column_dimensions['A'].width = 104
    r = 1
    for text, kind in SETUP:
        c = ws.cell(row=r, column=1, value=text)
        if kind == 'h1':
            c.font = Font(name='Calibri', size=16, bold=True, color=INK)
        elif kind == 'h2':
            c.font = Font(name='Calibri', size=12, bold=True, color='FF1F4E79')
            c.border = UNDER
        else:
            c.font = Font(name='Calibri', size=10, color=INK)
            c.alignment = Alignment(wrap_text=True, vertical='top')
        r += 1
    ws.sheet_view.showGridLines = False


# ===========================================================================
def build(raw, mode, out):
    """One workbook, one set of tabs per shelf.

    Takes RAW view rows, not prepared ones: prepare() ranks and numbers within
    the set it is given, so it has to run once per category — see below.

    The visible tabs come first in TABS order, then Notes and Setup, then every
    hidden Calc and Data. Each shelf's Daily and Trends read only its OWN Calc,
    which reads only its own Data — nothing crosses between shelves, so a query
    attached to the wrong Data sheet shows up on that tab's stamp rather than
    quietly changing another one's figures.
    """
    wb = Workbook()
    visible = []
    for i, tab in enumerate(TABS):
        daily = wb.active if i == 0 else wb.create_sheet(tab['daily'])
        daily.title = tab['daily']
        visible.append((tab, daily, wb.create_sheet(tab['trends'])))

    notes = wb.create_sheet('Notes')
    if mode == 'query':
        write_setup(wb.create_sheet('Setup'))

    for tab, daily, trends in visible:
        calc = wb.create_sheet(tab['calc'])
        data = wb.create_sheet(tab['data'])
        D = dcols(tab['data'])
        # Each shelf is ranked within ITSELF. day_no, rank and prod_no are
        # positions in one category's own history — exactly what each query
        # computes over its own filtered result set — so preparing the whole lot
        # once and splitting it afterwards would number lubes days by where they
        # fall among the cigarettes.
        mine = [r for r in raw if (r.get('category') or 'CIGARETTES') == tab['category']]
        write_data(data, prepare(mine)[0] if mine else [], mode)
        handles = write_calc(calc, D)
        write_daily(daily, tab, D)
        write_trends(trends, handles, tab, D)

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

    raw = []
    if args.mode == 'snapshot':
        raw = fetch(anon_key())
        if not raw:
            sys.exit(f'{VIEW} returned nothing for {BRANCH}. Is a count submitted?')

    build(raw, args.mode, out)

    print(f'wrote {out}  [{args.mode}]')
    if args.mode == 'query':
        print('  Every Data sheet is empty by design. Follow the Setup sheet to attach')
        print(f'  the {len(TABS)} queries once, then the workbook refreshes itself.')

    # Per shelf, because each tab is fed and bounded separately. A shelf with no
    # submitted count is worth saying out loud rather than leaving as a tab that
    # looks broken.
    for tab in TABS:
        mine = [r for r in raw if (r.get('category') or 'CIGARETTES') == tab['category']]
        if args.mode != 'snapshot':
            continue
        if not mine:
            print(f'  {tab["daily"]}: no rows — no submitted {tab["plural"]} count in the view')
            continue
        rows, days, prods = prepare(mine)
        print(f'  {tab["daily"]}: {len(rows)} rows over {len(days)} days, '
              f'{len(prods)} products (latest {days[0]}, earliest {days[-1]})')
        if len(prods) > MAX_PRODUCTS or len(days) > MAX_DAYS:
            print(f'    WARNING: exceeds the reserved Calc rows '
                  f'(days {len(days)}/{MAX_DAYS}, products {len(prods)}/{MAX_PRODUCTS})')


if __name__ == '__main__':
    main()
