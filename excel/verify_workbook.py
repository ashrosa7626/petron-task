#!/usr/bin/env python3
"""
Check the workbook against data that has variance in it.

    python3 verify_workbook.py            # offline structural + Python checks
    python3 verify_workbook.py --excel    # also drive Excel and read the
                                          # FORMULAS' own answers (macOS only)

Why this exists twice over:

The live database has no variance at all — every day either has no opening
figure or no POS sales — so the ranking, the totals and the colouring that the
report is for would otherwise ship having never run once. This feeds the
builder a day set shaped to exercise them.

And since snapshot mode uses the SAME formulas as the workbook that gets handed
over, --excel checks the real thing: it opens the file, switches the trading
day, and reads back what Excel computed. That is the only way to test the
COUNTIFS rules that carry "an unknown variance is not a zero", which are
otherwise verified by staring at them.

The cases pinned are the ones that would be wrong in a plausible way:

  * a product off by one every night ranks ABOVE one off by twelve once
  * an unknown variance sorts BELOW every known zero, and is never summed
  * "no days off" and "never checked" do not look the same
  * Daily ranks by absolute variance, so -12 outranks +9
"""

import argparse
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_workbook as bw           # noqa: E402

PASS, FAIL = [], []


def check(ok, msg, extra=None):
    (PASS if ok else FAIL).append(msg)
    print(('OK   ' if ok else 'FAIL ') + msg +
          ('' if ok or extra is None else f'  -> {extra}'))


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
            rows.append({
                'branch_id': 'SAFARI', 'count_date': d, 'shift': None,
                'staff_name': 'Tester', 'product_id': f'90000{pi}',
                'plu': f'11111111{pi}', 'short_name': name,
                'pos_description': name.upper(),
                'opening_packs': 20, 'add_in': 0, 'closing_packs': 15,
                'sold_physical': 5, 'sold_pos': None if v is None else 5 - v,
                'variance_packs': v,
                'opening_date': DATES[di - 1] if di else None,
                'unit_price_used': PRICE,
                'variance_rm': None if v is None else round(v * PRICE, 2),
            })
    return rows


raw = synthetic()
rows, days, prods = bw.prepare(raw)

print('ranking within a day — absolute variance, unknown last\n')
day = sorted([r for r in rows if str(r['count_date']) == '2026-09-10'],
             key=lambda r: r['rank'])
order = [r['short_name'] for r in day]
check(order[0] == 'Big One Off', '-12 outranks +9: biggest gap first, sign ignored', order)
check(order[1] == 'One Bad Night', '+9 is second', order)
check(order[2] == 'Steady Leak', '+1 is third', order)
check(order[-1] == 'Never Checked',
      'an unknown variance sorts BELOW every known zero', order)
check(order.index('Clean') < order.index('Never Checked'),
      'a checked zero ranks above an unchecked blank')
check([r['rank'] for r in day] == list(range(1, len(day) + 1)),
      'ranks are 1..n with no gaps')

print('\nthe keys the sheet looks rows up by\n')
r10 = day[0]
check(r10['row_key'] == 20260910 * 1000 + 1,
      'row_key is yyyymmdd*1000+rank, built from date parts', r10['row_key'])
check(r10['day_no'] == 2, 'day_no 1 is the most recent day, so 10/09 of three is 2',
      r10['day_no'])
check(sorted({r['prod_no'] for r in rows}) == [1, 2, 3, 4, 5],
      'prod_no indexes the product list with no gaps')
check(bw.DATA_COLS[13] == 'variance_packs' and bw.DATA_COLS[21] == 'row_key',
      'Data column order is the one the formulas address by position')

print('\nthe generated file\n')
tmp = tempfile.mkdtemp()
snap = os.path.join(tmp, 'snapshot.xlsx')
query = os.path.join(tmp, 'query.xlsx')
bw.build(rows, 'snapshot', snap)
bw.build([], 'query', query)

import re                            # noqa: E402
import zipfile                       # noqa: E402


def parts(path):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    sheets = {}
    wbx = z.read('xl/workbook.xml').decode()
    for i, m in enumerate(re.finditer(r'<sheet name="([^"]+)"[^>]*?state="(\w+)"?', wbx), 1):
        sheets[m.group(1)] = m.group(2)
    order = re.findall(r'<sheet name="([^"]+)"', wbx)
    return z, wbx, sheets, order


z, wbx, hidden, order = parts(snap)
daily = z.read('xl/worksheets/sheet1.xml').decode()

check(order[0] == 'Daily', 'Daily is the sheet the file opens on', order)
check(hidden.get('Data') == 'hidden' and hidden.get('Calc') == 'hidden',
      'Data and Calc are hidden', hidden)
check('fullCalcOnLoad="1"' in wbx, 'Excel is told to calculate on open')
check("'Daily'!$A$1:$I$" in wbx, 'Daily has a print area ending at column I')
check("'Daily'!$9:$9" in wbx, 'and repeats the header row on every printed page')
check('fitToPage="1"' in daily and 'fitToWidth="1"' in daily,
      'Daily is set to print on a single page')
check('<dataValidation' in daily and 'showErrorMessage="1"' in daily,
      'the trading-day cell is a dropdown that refuses an uncounted day')
check('topLeftCell="A10"' in daily, 'the header row is frozen above the products')

check('Counts[' not in daily,
      'no structured references — Excel turns one into a permanent #REF! if the '
      'table does not exist yet, which is why whole columns are used instead')
check('Data!$N:$N' in daily or 'Data!$N' in daily,
      'Daily addresses Data by whole column, so it grows on refresh')
check('TEXT(' not in daily.split('<conditionalFormatting')[0].replace('TEXT(MAX', ''),
      'no TEXT(date) in the lookup path — its tokens are localised')

rules = re.findall(r'<cfRule type="expression"[^>]*priority="(\d+)"[^>]*>\s*<formula>(.*?)</formula>',
                   daily, re.S)
check(len(rules) == 4, f'four variance rules on Daily (got {len(rules)})')
check('=0' in rules[0][1], 'zero is styled first, before the >=1 rule', rules[0][1])
thresholds = [int(m.group(1)) for m in
              (re.search(r'(?:&gt;|>)=(\d+)', f) for _, f in rules) if m]
check(thresholds == [10, 5, 1], 'the rest escalate 10, 5, 1', thresholds)
check(all('ISNUMBER' in f for _, f in rules),
      'every rule tests ISNUMBER, so an em dash is never coloured as a number')

qz, qwbx, qhidden, qorder = parts(query)
check('Setup' in qorder, 'query mode ships a Setup sheet with the attach steps', qorder)
check('Setup' not in order, 'snapshot mode does not, since there is nothing to attach')
qdata = qz.read(f'xl/worksheets/sheet{qorder.index("Data") + 1}.xml').decode()
check(qdata.count('<row ') == 1, 'query mode leaves Data empty apart from the header',
      qdata.count('<row '))

# openpyxl writes inline strings here, not a shared table, so look in the
# sheet itself rather than guessing which.
data_xml = z.read(f'xl/worksheets/sheet{order.index("Data") + 1}.xml').decode()
check('Added' not in daily, 'no "Added" column is surfaced on Daily')
check('add_in' in data_xml,
      'but add_in is still carried on the hidden Data sheet, as the raw query')
check('branch_id' not in daily and 'pos_description' not in daily,
      'branch_id and pos_description are gone from the report')


# ===========================================================================
def excel(path, script_body):
    """Drive Excel and read back what the FORMULAS computed."""
    osa = f'''
set p to POSIX file "{path}"
tell application "Microsoft Excel"
  set display alerts to false
  open p
  set wbk to active workbook
  set d to worksheet "Daily" of wbk
  set t to worksheet "Trends" of wbk
  set out to ""
{script_body}
  close wbk saving no
  set display alerts to true
  out
end tell'''
    r = subprocess.run(['osascript', '-e', osa], capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()


if '--excel' in sys.argv:
    print('\nwhat Excel actually computes — the formulas, not the Python\n')
    serial = (bw.date(2026, 9, 10) - bw.date(1899, 12, 30)).days
    body = f'''
  set value of range "B3" of d to {serial}
  set out to out & "withVar=" & (value of range "A6" of d as text) & "|"
  set out to out & "totPacks=" & (value of range "D6" of d as text) & "|"
  set out to out & "totRM=" & (value of range "F6" of d as text) & "|"
  set out to out & "pos=" & (value of range "H6" of d as text) & "|"
  set out to out & "msg=" & (value of range "A7" of d as text) & "|"
  repeat with i from 10 to 14
    set out to out & "r" & (i as text) & "=" & (value of (range ("A" & i)) of d as text) & "/" & (value of (range ("F" & i)) of d as text) & "/" & (value of (range ("G" & i)) of d as text) & "|"
  end repeat
  set out to out & "T5=" & (value of range "A5" of t as text) & "/" & (value of range "P5" of t as text) & "/" & (value of range "Q5" of t as text) & "|"
  set out to out & "T6=" & (value of range "A6" of t as text) & "/" & (value of range "P6" of t as text) & "|"
  set out to out & "T9=" & (value of range "A9" of t as text) & "/" & (value of range "P9" of t as text) & "|"
'''
    got = dict(kv.split('=', 1) for kv in excel(snap, body).split('|') if '=' in kv)

    check(got.get('withVar') == '3.0', '3 products disagree (1, 9, -12)', got.get('withVar'))
    check(got.get('totPacks') == '-2.0', 'total variance is 1+9-12 = -2, signs kept',
          got.get('totPacks'))
    check(got.get('totRM', '').startswith('-25.4'), 'and the RM total values that',
          got.get('totRM'))
    check('3 of 4 products disagree' in got.get('msg', ''),
          'the status line counts only products that COULD be checked', got.get('msg'))

    check(got.get('r10', '').startswith('Big One Off/-12'), 'row 10 is the -12',
          got.get('r10'))
    check(got.get('r11', '').startswith('One Bad Night/9'), 'row 11 is the +9',
          got.get('r11'))
    check(got.get('r12', '').startswith('Steady Leak/1'), 'row 12 is the +1',
          got.get('r12'))
    check(got.get('r13', '').startswith('Clean/0'), 'row 13 is the checked zero',
          got.get('r13'))
    check(got.get('r14', '') == 'Never Checked/—/—',
          'row 14 is the unchecked product, shown as dashes and NOT as zeros',
          got.get('r14'))

    check(got.get('T5', '').startswith('Steady Leak/3'),
          'Trends puts the 3-night leak first, with 3 days off', got.get('T5'))
    check(got.get('T6', '').startswith('Big One Off/1'),
          'then the single big night', got.get('T6'))
    check(got.get('T9', '').split('/')[-1] == '—',
          'and a product never checked shows a dash for days off, not 0',
          got.get('T9'))
else:
    print('\n(skipped the Excel checks — pass --excel to run them)')

print(f'\n{len(PASS)} passed, {len(FAIL)} failed')
sys.exit(1 if FAIL else 0)
