// ===========================================================================
// Petron — cigarette reconciliation
// Power Query (M) for Excel. Pulls every SUBMITTED count from Supabase.
//
// This query feeds the whole workbook. Daily and Trends read it by structured
// reference, so it must be named exactly  Counts  and loaded to the Data sheet.
//
// To install:
//   Data > Get Data > From Other Sources > Blank Query
//   Home > Advanced Editor > replace everything with this > Done
//   Rename the query to  Counts   (the sheet formulas depend on that name)
//   Close & Load To... > Table > Existing worksheet > Data!$A$1
//   If Excel asks about credentials for supabase.co, choose Anonymous.
//
// To make it automatic:
//   Data > Queries & Connections > right-click Counts > Properties
//     [x] Refresh data when opening the file
//     [x] Refresh every 60 minutes
//
// Drafts never appear. vw_daily_reconciliation reads vw_count_submitted, so a
// count only reaches Excel once it has actually been submitted — which is the
// behaviour you want: a half-finished count must not reconcile.
// ===========================================================================

let
    BaseUrl  = "https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/",

    // Read-only anon key. This is the same key the web app ships in its
    // JavaScript, so it is already public — it grants SELECT and nothing more
    // on reference data. Do not paste a service key here.
    ApiKey   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZmZpdWNpb2d0aGZ6ZWtra2t6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzcwMTAsImV4cCI6MjA5MTQ1MzAxMH0.OTEyOMn1fmUNV7pR51KMOLsMTNAfytt62uGS_AkQXyw",

    Resource = "vw_daily_reconciliation",
    Branch   = "SAFARI",

    // This workbook is the CIGARETTE report. The view carries lubes and heated
    // tobacco too since 15_categories.sql, and without this filter their rows
    // would land in the Daily sheet — tripling the row count and mixing three
    // shelves under one trading day. A lubes workbook is a separate file.
    Category = "CIGARETTES",
    PageSize = 1000,

    // The shape the workbook's formulas expect. opening_date, unit_price_used
    // and variance_rm only exist once 10_prices_and_opening_date.sql has been
    // run — so rather than depend on that, any column the view does not return
    // is added as null below. The workbook then has a stable set of columns
    // whichever migrations are in, and lights the extra ones up by itself when
    // the migration lands. Nothing breaks in the meantime.
    Expected = {
        "branch_id", "count_date", "shift", "staff_name",
        "product_id", "plu", "short_name", "pos_description",
        "opening_packs", "add_in", "closing_packs",
        "sold_physical", "sold_pos", "variance_packs",
        "opening_date", "unit_price_used", "variance_rm",
        // 18th, added by 15_categories.sql. Kept last so the seventeen above
        // hold the positions build_workbook.py addresses them by.
        "category"
    },

    // PostgREST caps any response at 1000 rows. At 54 products a day that cap
    // arrives in under three weeks, so this pages until a request comes back
    // empty rather than silently truncating the history.
    //
    // BaseUrl is a constant and the rest goes through RelativePath/Query on
    // purpose: Web.Contents only resolves stored credentials when the base URL
    // is static, so building the URL by string concatenation breaks refresh.
    GetPage = (Offset as number) as list =>
        Json.Document(
            Web.Contents(
                BaseUrl,
                [
                    RelativePath = Resource,
                    Query = [
                        select    = "*",
                        branch_id = "eq." & Branch,
                        category  = "eq." & Category,
                        order     = "count_date.asc,short_name.asc",
                        limit     = Text.From(PageSize),
                        offset    = Text.From(Offset)
                    ],
                    Headers = [
                        apikey        = ApiKey,
                        Authorization = "Bearer " & ApiKey,
                        Accept        = "application/json"
                    ]
                ]
            )
        ),

    Pages = List.Generate(
        () => [Offset = 0, Rows = GetPage(0)],
        each List.Count([Rows]) > 0,
        each [Offset = [Offset] + PageSize, Rows = GetPage([Offset] + PageSize)],
        each [Rows]
    ),
    AllRows = List.Combine(Pages),

    // An empty result still has to produce the right shape, or every formula in
    // the workbook breaks on the day before the first count is submitted.
    Raw =
        if List.IsEmpty(AllRows) then
            #table(Expected, {})
        else
            Table.ExpandRecordColumn(
                Table.FromList(AllRows, Splitter.SplitByNothing(), {"rec"}, null, ExtraValues.Error),
                "rec", Table.ColumnNames(
                    Table.FromRecords({List.First(AllRows)}))),

    // Fill in whatever the view did not return, then pin the column order.
    Missing  = List.Difference(Expected, Table.ColumnNames(Raw)),
    Filled   = List.Accumulate(Missing, Raw,
                   (t, c) => Table.AddColumn(t, c, each null)),
    Shaped   = Table.SelectColumns(Filled, Expected),

    // plu and product_id MUST stay text. Several PLUs carry a leading zero and
    // Excel will eat it the moment the column is numeric — the same leading-zero
    // problem that is why PLU is never a join key anywhere in this system.
    //
    // Culture is pinned so count_date parses the same on any machine. Without
    // it, an Excel set to a dd/MM locale can reject the ISO dates the API
    // returns, and the whole query errors rather than just that column.
    TypeMap = {
        {"branch_id",       type text},
        {"count_date",      type date},
        {"shift",           type text},
        {"staff_name",      type text},
        {"product_id",      type text},
        {"plu",             type text},
        {"short_name",      type text},
        {"pos_description", type text},
        {"opening_packs",   Int64.Type},
        {"add_in",          Int64.Type},
        {"closing_packs",   Int64.Type},
        {"sold_physical",   Int64.Type},
        {"sold_pos",        Int64.Type},
        {"variance_packs",  Int64.Type},
        {"opening_date",    type date},
        {"unit_price_used", type number},
        {"variance_rm",     type number},
        {"category",        type text}
    },
    Typed = Table.TransformColumnTypes(Shaped, TypeMap, "en-US"),

    // -----------------------------------------------------------------------
    // Everything below is what the workbook's formulas need and the view does
    // not provide. It is computed HERE, once, rather than in 20,000 rows of
    // spreadsheet formulas.
    //
    // abs_variance is the sort key, and an UNKNOWN variance gets -1 so it sorts
    // below every known zero. That distinction is the one thing in this file
    // that must not be got wrong: a blank variance means "not checked", not
    // "agreed", and it must never be ranked or totalled as if it were zero.
    // -----------------------------------------------------------------------
    AddAbs = Table.AddColumn(Typed, "abs_variance",
        each if [variance_packs] = null then -1
             else Number.Abs([variance_packs]), type number),

    Sorted = Table.Sort(AddAbs, {
        {"count_date",   Order.Ascending},
        {"abs_variance", Order.Descending},
        {"short_name",   Order.Ascending}
    }),

    // rank = position within its own day, worst variance first.
    Grouped = Table.Group(Sorted, {"count_date"}, {
        {"rows", each Table.AddIndexColumn(_, "rank", 1, 1, Int64.Type)}
    }),
    Ranked = Table.Combine(Grouped[rows]),

    // day_no = 1 is the most recent counted day; prod_no indexes the product
    // list alphabetically. Both let the sheet find a row with a plain MATCH
    // instead of an array formula.
    DayList  = List.Sort(List.Distinct(Ranked[count_date]), Order.Descending),
    ProdList = List.Sort(List.Distinct(Ranked[short_name]), Order.Ascending),
    WithDay  = Table.AddColumn(Ranked, "day_no",
        each List.PositionOf(DayList, [count_date]) + 1, Int64.Type),
    WithProd = Table.AddColumn(WithDay, "prod_no",
        each List.PositionOf(ProdList, [short_name]) + 1, Int64.Type),

    // A numeric lookup key: yyyymmdd * 1000 + rank.
    //
    // Built from date PARTS on purpose. A text key would need TEXT(d,"yyyy-mm-dd")
    // on the Excel side, whose tokens are localised — the sheet silently stops
    // matching on an Excel that speaks anything but English. A serial would rely
    // on M and Excel agreeing about day zero. Parts rely on nothing.
    WithKey = Table.AddColumn(WithProd, "row_key",
        each (Date.Year([count_date]) * 10000
              + Date.Month([count_date]) * 100
              + Date.Day([count_date])) * 1000 + [rank], Int64.Type)
in
    WithKey
