// ===========================================================================
// Petron — cigarette count export
// Power Query (M) for Excel. Pulls every SUBMITTED count from Supabase.
//
// Drafts never appear here. vw_daily_reconciliation reads vw_count_submitted,
// so a count only reaches Excel once it has actually been submitted — which is
// the behaviour you want: a half-finished count must not reconcile.
//
// To install:
//   Data > Get Data > From Other Sources > Blank Query
//   Home > Advanced Editor > replace everything with this > Done
//   Rename the query to  Counts   (the sheet formulas depend on that name)
//   Close & Load
//   If Excel asks about credentials for supabase.co, choose Anonymous.
//
// To make it automatic:
//   Data > Queries & Connections > right-click Counts > Properties
//     [x] Refresh data when opening the file
//     [x] Refresh every 60 minutes
// ===========================================================================

let
    BaseUrl  = "https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/",

    // Read-only anon key. This is the same key the web app ships in its
    // JavaScript, so it is already public — it grants SELECT and nothing more
    // on reference data. Do not paste a service key here.
    ApiKey   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZmZpdWNpb2d0aGZ6ZWtra2t6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzcwMTAsImV4cCI6MjA5MTQ1MzAxMH0.OTEyOMn1fmUNV7pR51KMOLsMTNAfytt62uGS_AkQXyw",

    Resource = "vw_daily_reconciliation",
    Columns  = "branch_id,count_date,staff_name,product_id,plu,short_name,pos_description,opening_packs,add_in,closing_packs,sold_physical,sold_pos,variance_packs",
    ColumnList = Text.Split(Columns, ","),
    PageSize = 1000,

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
                        select = Columns,
                        order  = "count_date.desc,short_name.asc",
                        limit  = Text.From(PageSize),
                        offset = Text.From(Offset)
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

    // An empty result still has to produce the right shape, or every downstream
    // formula breaks on the day before the first count is submitted.
    AsTable =
        if List.IsEmpty(AllRows) then
            #table(ColumnList, {})
        else
            Table.ExpandRecordColumn(
                Table.FromList(AllRows, Splitter.SplitByNothing(), {"rec"}, null, ExtraValues.Error),
                "rec", ColumnList),

    // plu and product_id MUST stay text. Several PLUs carry a leading zero and
    // Excel will eat it the moment the column is numeric — the same leading-zero
    // problem that is why PLU is never a join key anywhere in this system.
    Typed = Table.TransformColumnTypes(AsTable, {
        {"branch_id",       type text},
        {"count_date",      type date},
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
        {"variance_packs",  Int64.Type}
    },
    // Culture is pinned so count_date parses the same on any machine. Without
    // it, an Excel set to a dd/MM locale can reject the ISO dates the API
    // returns, and the whole query errors rather than just that column.
    "en-US")
in
    Typed
