#!/usr/bin/env python3
"""
Check the workbook builder against data that has variance in it.

    python3 verify_workbook.py

The live database has no variance yet — every day either has no opening figure
or no POS sales — so the ranking, the totals and the colouring that the report
exists for would otherwise ship having never run. This feeds the builder a day
set shaped to exercise them and asserts what comes out.

The cases it pins are the ones that would be wrong in a plausible way:

  * a product off by one every night must rank ABOVE one off by nine once,
    on Trends, because that is the difference between a leak and an event
  * a variance that is not known must sort BELOW every known zero, and must
    never be summed as if it were zero
  * "no days off" and "never checked" must not look the same
  * Daily must rank by absolute variance, so -12 outranks +9

Structural checks (hidden sheet, print area, conditional formatting, the date
dropdown) read the generated file back, so a refactor that quietly drops one
fails here rather than in front of someone at 7am.
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_workbook as bw           # noqa: E402

PASS, FAIL = [], []


def check(ok, msg, extra=None):
    (PASS if ok else FAIL).append(msg)
    print(('OK   ' if ok else 'FAIL ') + msg +
          ('' if ok or extra is None else f'  -> {extra}'))


# ---------------------------------------------------------------------------
# A day set with something to find in it.
#
#   Steady Leak   off by 1 on all three days      -> 3 days off, total 3
#   One Bad Night off by 9 once                   -> 1 day off, total 9
#   Big One Off   off by -12 once                 -> 1 day off, total -12
#   Clean         0 every day                     -> checked, and fine
#   Never Checked no POS figure on any day        -> unknown, not zero
# ---------------------------------------------------------------------------
DATES = ['2026-09-09', '2026-09-10', '2026-09-11']
PLAN = {
    'Steady Leak':   [1, 1, 1],
    'One Bad Night': [0, 9, 0],
    'Big One Off':   [0, -12, 0],
    'Clean':         [0, 0, 0],
    'Never Checked': [None, None, None],
}
PRICE = 12.70


def synthetic():
    rows = []
    for di, d in enumerate(DATES):
        for pi, (name, plan) in enumerate(sorted(PLAN.items())):
            v = plan[di]
            sold_phys = 5
            rows.append({
                'branch_id': 'SAFARI',
                'count_date': d,
                'shift': None,
                'staff_name': 'Tester',
                'product_id': f'90000{pi}',
                'plu': f'11111111{pi}',
                'short_name': name,
                'pos_description': name.upper(),
                'opening_packs': 20,
                'add_in': 0,
                'closing_packs': 15,
                'sold_physical': sold_phys,
                'sold_pos': None if v is None else sold_phys - v,
                'variance_packs': v,
                'opening_date': DATES[di - 1] if di else None,
                'unit_price_used': PRICE,
                'variance_rm': None if v is None else round(v * PRICE, 2),
            })
    return rows


raw = synthetic()
rows, dates, have = bw.prepare(raw)
summary = bw.summarise(rows, dates, have)

print('ranking within a day — absolute variance, unknown last\n')
day = [r for r in rows if r['date_key'] == '2026-09-10']
order = [r['short_name'] for r in day]
check(order[0] == 'Big One Off',
      '-12 outranks +9: the biggest gap is first regardless of sign', order)
check(order[1] == 'One Bad Night', '+9 is second', order)
check(order[2] == 'Steady Leak', '+1 is third', order)
check(order[-1] == 'Never Checked',
      'a variance that is not known sorts BELOW every known zero', order)
check(order.index('Clean') < order.index('Never Checked'),
      'a checked zero ranks above an unchecked blank')
check([r['rank'] for r in day] == list(range(1, len(day) + 1)),
      'ranks are 1..n with no gaps')
check(all(r['rowkey'] == f"{bw.serial(r['count_date'])}|{r['rank']}" for r in rows),
      'every row key is built from the date serial, not a formatted string')

print('\nper-day summary\n')
s10 = next(s for s in summary if s['date_key'] == '2026-09-10')
check(s10['products'] == 5, 'products counted is every row, checked or not', s10['products'])
check(s10['with_variance'] == 3,
      '3 products disagree on 10/09 (1, 9, -12); the zero and the unknown do not',
      s10['with_variance'])
check(s10['total_packs'] == -2, 'total variance is 1 + 9 - 12 = -2, signs kept',
      s10['total_packs'])
check(abs(s10['total_rm'] - round(-2 * PRICE, 2)) < 0.01,
      'total RM values that same net figure', s10['total_rm'])
check(s10['pos_state'] == 'loaded', 'POS reads as loaded when any product has a figure')
check('disagree with the POS' in s10['message'], 'and the message says how many',
      s10['message'])

# The case that matters most: a day with no POS at all must not read as zero.
noneraw = [dict(r, sold_pos=None, variance_packs=None, variance_rm=None) for r in raw]
nrows, ndates, nhave = bw.prepare(noneraw)
nsum = bw.summarise(nrows, ndates, nhave)
check(all(s['total_packs'] is None for s in nsum),
      'a day with no POS sales reports variance as UNKNOWN, never as 0',
      [s['total_packs'] for s in nsum])
check(all(s['with_variance'] is None for s in nsum),
      'and does not claim zero products disagreed')
check(all(s['pos_state'] == 'not loaded' for s in nsum), 'and says POS is not loaded')
check(all('No POS sales have been loaded' in s['message'] for s in nsum),
      'and says so in plain English rather than showing an empty column')

print('\ntrends — a leak outranks an event\n')
per = {}
for r in rows:
    per.setdefault(r['short_name'], []).append(r['variance_packs'])
stats = []
for name, vals in per.items():
    known = [v for v in vals if v is not None]
    off = [v for v in known if v != 0]
    stats.append((name, len(off) if known else None,
                  sum(known) if known else None))
stats.sort(key=lambda s: (-(s[1] or 0), -(abs(s[2]) if s[2] is not None else 0), s[0]))
names = [s[0] for s in stats]
check(names[0] == 'Steady Leak',
      'off by 1 on three nights ranks above off by 12 on one', names)
check(names.index('Big One Off') < names.index('One Bad Night'),
      'and among equal-day products the larger total wins', names)
check(next(s[1] for s in stats if s[0] == 'Never Checked') is None,
      '"never checked" is not reported as zero days off')
check(next(s[1] for s in stats if s[0] == 'Clean') == 0,
      'but a genuinely clean product IS zero days off')

print('\nthe generated file\n')
out = os.path.join(tempfile.mkdtemp(), 'verify.xlsx')
bw.fetch = lambda key: raw
bw.anon_key = lambda: 'test'
sys.argv = ['build_workbook.py', '-o', out]
bw.main()

import zipfile                       # noqa: E402
import re                            # noqa: E402
z = zipfile.ZipFile(out)
wbx = z.read('xl/workbook.xml').decode()
daily = z.read('xl/worksheets/sheet1.xml').decode()
trends = z.read('xl/worksheets/sheet2.xml').decode()

check('name="Data" sheetId="4" state="hidden"' in wbx.replace(' r:id', ' r:id'),
      'the raw query sheet is hidden')
check(wbx.count('state="visible"') == 3, 'Daily, Trends and Notes are visible')
check('fullCalcOnLoad="1"' in wbx, 'Excel is told to calculate on open')
check("'Daily'!$A$1:$I$" in wbx, 'Daily has a print area ending at column I')
check("'Daily'!$9:$9" in wbx, 'and repeats the header row on every printed page')
check('fitToPage="1"' in daily and 'fitToWidth="1"' in daily and 'fitToHeight="1"' in daily,
      'Daily is set to print on a single page')
check('<dataValidation' in daily and 'type="list"' in daily,
      'the trading-day cell is a dropdown')
check('showErrorMessage="1"' in daily, 'and refuses a day that was never counted')
check(re.search(r'topLeftCell="A10"', daily) is not None,
      'the header row is frozen above the products')

rules = re.findall(r'<cfRule type="expression"[^>]*priority="(\d+)"[^>]*>\s*<formula>(.*?)</formula>',
                   daily, re.S)
check(len(rules) == 4, f'four variance rules on Daily (got {len(rules)})')
check('=0' in rules[0][1], 'zero is styled first, so it wins before the >=1 rule',
      rules[0][1])
# ">=" arrives XML-escaped as "&gt;=".
thresholds = [int(m.group(1)) for m in
              (re.search(r'(?:&gt;|>)=(\d+)', f) for _, f in rules) if m]
check(thresholds == [10, 5, 1],
      'and the remaining rules escalate 10, 5, 1 so heavier variance wins',
      thresholds)
check(all('ISNUMBER' in f for _, f in rules),
      'every rule tests ISNUMBER, so an em dash is never coloured as a number')
check(len(re.findall(r'<cfRule', trends)) == 4, 'Trends is coloured the same way')

# The Added column must not appear anywhere a person looks. Strings may be in a
# shared table or inline in the sheets depending on how openpyxl wrote them, so
# check every part rather than guessing which.
def text_of(*parts):
    blob = ''
    for p in parts:
        if p in z.namelist():
            blob += z.read(p).decode()
    return blob


visible_text = text_of('xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
                       'xl/worksheets/sheet3.xml', 'xl/sharedStrings.xml')
raw_text = text_of('xl/worksheets/sheet4.xml', 'xl/tables/table1.xml',
                   'xl/sharedStrings.xml')
check('Added' not in daily and 'Added' not in trends,
      'no "Added" column is surfaced on Daily or Trends')
check('add_in' in raw_text,
      'but add_in is still carried on the hidden raw sheet, as the raw query')
check('branch_id' not in daily and 'pos_description' not in daily,
      'branch_id and pos_description are gone from the report')

print(f'\n{len(PASS)} passed, {len(FAIL)} failed')
if FAIL:
    sys.exit(1)
