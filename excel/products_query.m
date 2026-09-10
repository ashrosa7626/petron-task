// ===========================================================================
// Petron — product reference
// Power Query (M) for Excel. The 54 cigarette products with their POS Item ID,
// PLU and POS description.
//
// Use this to translate a POS sales export into product_id before pasting it
// into the POS sheet. The POS export identifies lines by description or PLU;
// product_id is the only safe join key, so map to it here once.
//
// Install exactly as counts_query.m, and name this query  Products.
// ===========================================================================

let
    BaseUrl  = "https://vwffiuciogthfzekkkkz.supabase.co/rest/v1/",
    ApiKey   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZmZpdWNpb2d0aGZ6ZWtra2t6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzcwMTAsImV4cCI6MjA5MTQ1MzAxMH0.OTEyOMn1fmUNV7pR51KMOLsMTNAfytt62uGS_AkQXyw",
    Resource = "product",
    Columns  = "product_id,plu,short_name,pos_description,brand,active",
    ColumnList = Text.Split(Columns, ","),

    Response = Json.Document(
        Web.Contents(
            BaseUrl,
            [
                RelativePath = Resource,
                Query = [ select = Columns, order = "short_name.asc", limit = "1000" ],
                Headers = [
                    apikey        = ApiKey,
                    Authorization = "Bearer " & ApiKey,
                    Accept        = "application/json"
                ]
            ]
        )
    ),

    AsTable =
        if List.IsEmpty(Response) then
            #table(ColumnList, {})
        else
            Table.ExpandRecordColumn(
                Table.FromList(Response, Splitter.SplitByNothing(), {"rec"}, null, ExtraValues.Error),
                "rec", ColumnList),

    // product_id and plu stay text — see the note in counts_query.m.
    Typed = Table.TransformColumnTypes(AsTable, {
        {"product_id",      type text},
        {"plu",             type text},
        {"short_name",      type text},
        {"pos_description", type text},
        {"brand",           type text},
        {"active",          type logical}
    })
in
    Typed
