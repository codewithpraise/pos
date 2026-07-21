
# Read the file as a raw byte array then decode as UTF-8
$filePath = "c:\Users\DELL\Desktop\nexova\public\app.js"
$content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

# ------------------------------------------------------------------
# 1. Replace the entire ur: { formal: {...}, informal: {...} } block
# ------------------------------------------------------------------
$oldUrBlock = @'
    ur: {
      formal: {
        dashboard: "ÃƒÆ'Ã†â€™Ãƒâ€¹Ã…â€œÃƒÆ'Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ'Ã†â€™ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ'Ã¢â‚¬Â¹ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ'Ã†â€™Ãƒâ€¹Ã…â€œÃƒÆ'Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ'Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ'Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ ÃƒÆ'Ã†â€™Ãƒâ€¹Ã…â€œÃƒÆ'Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ÃƒÆ'Ã†â€™ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ'Ã¢â‚¬Â¹ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ'Ã†â€™Ãƒâ€¹Ã…â€œÃƒÆ'Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â±ÃƒÆ'Ã†â€™Ãƒâ€¦Ã‚Â¡ÃƒÆ'Ã¢â‚¬Â¹ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â "#
$newUrFormal_dashboard = '"` + [char]0x0688 + [char]0x06CC + [char]0x0634 + " " + [char]0x0628 + [char]0x0648 + [char]0x0631 + [char]0x0688 + " " + [char]0x0627 + [char]0x0648 + [char]0x0631 + " " + [char]0x062A + [char]0x062C + [char]0x0632 + [char]0x06CC + [char]0x0627 + [char]0x062A + '"'

# Use a different approach — build the replacement block as a here-string with proper Unicode
$newUrBlock = @"
    ur: {
      formal: {
        dashboard: "`u{0688}`u{06CC}`u{0634} `u{0628}`u{0648}`u{0631}`u{0688} `u{0627}`u{0648}`u{0631} `u{062A}`u{062C}`u{0632}`u{06CC}`u{0627}`u{062A}",
        inventory: "`u{0645}`u{0635}`u{0646}`u{0648}`u{0639}`u{0627}`u{062A} `u{06A9}`u{06CC} `u{0641}`u{06C1}`u{0631}`u{0633}`u{062A}",
        inventory_ledger: "`u{0645}`u{0627}`u{0644} `u{06A9}`u{0627} `u{062D}`u{0633}`u{0627}`u{0628} (`u{0627}`u{0646}`u{0648}{u`{06CC}`u{0646}`u{0679}`u{0631}`u{06CC})",
        suppliers: "`u{0633}`u{067E}`u{0644}`u{0627}`u{0626}`u{0631}`u{0632} `u{0627}`u{0648}`u{0631} `u{062A}`u{0642}`u{0633}`u{06CC}`u{0645} `u{06A9}`u{0627}`u{0631}",
        customers: "`u{06AF}`u{0627}`u{06C1}`u{06A9} `u{067E}`u{0631}`u{0648}`u{0641}`u{0627}`u{0626}`u{0644}`u{0632}",
        credit: "`u{0627}`u{062F}`u{0627}`u{0626}`u{06CC}`u{06AF}`u{06CC} `u{06A9}`u{0627} `u{06A9}`u{06BE}`u{0627}`u{062A}`u{06C1}",
        purchase_orders: "`u{062E}`u{0631}`u{06CC}`u{062F}`u{0627}`u{0631}`u{06CC} `u{0622}`u{0631}`u{0688}`u{0631}`u{0632}",
        sales_log: "`u{0641}`u{0631}`u{0648}`u{062E}`u{062A} `u{06A9}`u{0627} `u{0631}`u{06CC}`u{06A9}`u{0627}`u{0631}`u{0688}",
        receipt: "`u{0631}`u{0633}`u{06CC}`u{062F}",
        void_sale: "`u{0641}`u{0631}`u{0648}`u{062E}`u{062A} `u{0645}`u{0646}`u{0633}`u{0648}`u{062E}",
        drawer_cash: "`u{06A9}`u{06CC}`u{0634} `u{0688}`u{0631}`u{0627}`u{0626}`u{0631}",
        expense: "`u{0627}`u{062E}`u{0631}`u{0627}`u{062C}`u{0627}`u{062A}",
        tax: "`u{0679}`u{06CC}`u{06A9}`u{0633} (FBR)"
      },
      informal: {
        dashboard: "`u{06A9}`u{0645}`u{0627}`u{0626}`u{06CC} `u{0627}`u{0648}`u{0631} `u{062E}`u{0644}`u{0627}`u{0635}`u{06C1}",
        inventory: "`u{062F}`u{06A9}`u{0627}`u{0646} `u{06A9}`u{0627} `u{0645}`u{0627}`u{0644} (`u{0627}`u{0633}`u{0679}`u{0627}`u{06A9})",
        inventory_ledger: "`u{0645}`u{0627}`u{0644} `u{06A9}`u{0627} `u{062D}`u{0633}`u{0627}`u{0628}",
        suppliers: "`u{062A}`u{06BE}`u{0648}`u{06A9} `u{0641}`u{0631}`u{0648}`u{0634} / `u{067E}`u{0627}`u{0631}`u{0679}`u{06CC}",
        customers: "`u{06AF}`u{0627}`u{06C1}`u{06A9} `u{0644}`u{0633}`u{0679}",
        credit: "`u{0627}`u{062F}`u{06BE}`u{0627}`u{0631} `u{06A9}`u{06BE}`u{0627}`u{062A}`u{06C1}",
        purchase_orders: "`u{0646}`u{06CC}`u{0627} `u{0645}`u{0627}`u{0644} `u{0622}`u{0631}`u{0688}`u{0631}",
        sales_log: "`u{0628}`u{06A9}`u{0631}`u{06CC} `u{06A9}`u{0627} `u{0631}`u{06CC}`u{06A9}`u{0627}`u{0631}`u{0688}",
        receipt: "`u{0628}`u{0644} `u{067E}`u{0631}`u{0686}`u{06CC}",
        void_sale: "`u{067E}`u{0631}`u{0686}`u{06CC} `u{06A9}`u{0627}`u{0679}`u{0646}`u{0627}",
        drawer_cash: "`u{06AF}`u{064F}`u{0644}`u{06A9} `u{06A9}`u{06CC}`u{0634}",
        expense: "`u{0631}`u{0648}`u{0632}`u{0627}`u{0646}`u{06C1} `u{062E}`u{0631}`u{0686}`u{06C1}",
        tax: "`u{0633}`u{0631}`u{06A9}`u{0627}`u{0631}`u{06CC} `u{0679}`u{06CC}`u{06A9}`u{0633} (FBR)"
      }
    }
"@

# Build the old pattern to find (using a regex that matches the garbled ur: block)
# We'll use a pattern that matches from "    ur: {" to "    }" 
$urBlockPattern = '(?s)    ur: \{.+?    \}\r?\n  \};'
$urBlockReplacement = $newUrBlock + "`r`n  };"

$content = [regex]::Replace($content, $urBlockPattern, $urBlockReplacement)

# ------------------------------------------------------------------
# 2. Fix langBtn.textContent garbled Urdu  
# ------------------------------------------------------------------
$oldLangBtn = "langBtn.textContent = isUrdu ? 'English' : 'ÃƒÆ'Ã‹Å""
# Find any variant of the garbled textContent line
$langBtnPattern = "langBtn\.textContent = isUrdu \? 'English' : '[^']+'"
$langBtnReplacement = "langBtn.textContent = isUrdu ? 'English' : '`u{0627}`u{0631}`u{062F}`u{0648}'"
$content = [regex]::Replace($content, $langBtnPattern, $langBtnReplacement)

# ------------------------------------------------------------------
# 3. Fix catalog-manager nav label duplication — give it a distinct key
# ------------------------------------------------------------------
$oldCatalogManager = "'[data-screen=""catalog-manager""] .nav-label': i18n.inventory,"
$newCatalogManager = "'[data-screen=""catalog-manager""] .nav-label': i18n.inventory_ledger || 'Inventory Ledger',"
$content = $content.Replace($oldCatalogManager, $newCatalogManager)

# ------------------------------------------------------------------
# 4. Fix all garbled Urdu strings in textMapping (lines 6092–6114)
#    Replace every garbled ternary value with a clean Unicode string
# ------------------------------------------------------------------

# Helper: replace garbled ternary blocks line by line
$replacements = @{
    # cart table headers
    "'.cart-table th:nth-child(1)': isUrdu ? '[^']+' : 'Product'" = "'.cart-table th:nth-child(1)': isUrdu ? '`u{0645}`u{0635}`u{0646}`u{0648}`u{0639}' : 'Product'"
    "'.cart-table th:nth-child(2)': isUrdu ? '[^']+' : 'Price'" = "'.cart-table th:nth-child(2)': isUrdu ? '`u{0642}`u{06CC}`u{0645}`u{062A}' : 'Price'"
    "'.cart-table th:nth-child(3)': isUrdu ? '[^']+' : 'Qty'" = "'.cart-table th:nth-child(3)': isUrdu ? '`u{062A}`u{0639}`u{062F}`u{0627}`u{062F}' : 'Qty'"
    "'.cart-table th:nth-child(4)': isUrdu ? '[^']+' : 'Total'" = "'.cart-table th:nth-child(4)': isUrdu ? '`u{06A9}`u{0644}' : 'Total'"
    # totals
    "'.ledger-footer .totals-row:nth-child\(1\) span:nth-child\(1\)': isUrdu ? '[^']+' : 'Subtotal'" = "'.ledger-footer .totals-row:nth-child(1) span:nth-child(1)': isUrdu ? '`u{0630}`u{06CC}`u{0644} `u{0645}`u{062C}`u{0645}`u{0648}`u{0639}' : 'Subtotal'"
    "'.ledger-footer .totals-row:nth-child\(3\) span:nth-child\(1\)': isUrdu ? '[^']+' : 'Total Due'" = "'.ledger-footer .totals-row:nth-child(3) span:nth-child(1)': isUrdu ? '`u{06A9}`u{0644} `u{0648}`u{0627}`u{062C}`u{0628} `u{0627}`u{0644}`u{0627}`u{062F}`u{0627}' : 'Total Due'"
    # quick catalog
    "'#checkout-quick-catalog .lbl': isUrdu ? '[^']+' : 'Quick Products'" = "'#checkout-quick-catalog .lbl': isUrdu ? '`u{0641}`u{0648}`u{0631}`u{06CC} `u{0645}`u{0635}`u{0646}`u{0648}`u{0639}`u{0627}`u{062A}' : 'Quick Products'"
    "'#checkout-quick-search': isUrdu ? '[^']+' : 'Quick search\.\.\.'" = "'#checkout-quick-search': isUrdu ? '`u{0641}`u{0648}`u{0631}`u{06CC} `u{062A}`u{0644}`u{0627}`u{0634}...' : 'Quick search...'"
    # customer
    "'.checkout-actions .lbl-cust': isUrdu ? '[^']+' : 'Customer Profile'" = "'.checkout-actions .lbl-cust': isUrdu ? '`u{06AF}`u{0627}`u{06C1}`u{06A9} `u{067E}`u{0631}`u{0648}`u{0641}`u{0627}`u{0626}`u{0644}' : 'Customer Profile'"
    "'#checkout-customer-attached .text-muted': isUrdu ? '[^']+' : 'No customer attached to transaction\.'" = "'#checkout-customer-attached .text-muted': isUrdu ? '`u{06A9}`u{0648}`u{0626}`u{06CC} `u{06AF}`u{0627}`u{06C1}`u{06A9} `u{0645}`u{0646}`u{0633}`u{0644}`u{06A9} `u{0646}`u{06C1}`u{06CC}\u{06BA}' : 'No customer attached to transaction.'"
    # payment
    "'.payment-card .lbl': isUrdu ? '[^']+' : 'Payment Method'" = "'.payment-card .lbl': isUrdu ? '`u{0627}`u{062F}`u{0627}`u{0626}`u{06CC}`u{06AF}`u{06CC} `u{06A9}`u{0627} `u{0637}`u{0631}`u{06CC}`u{0642}`u{06C1}' : 'Payment Method'"
    # payment modes
    "'[data-mode=""CASH""]': isUrdu ? '[^']+' : 'Cash'" = "'[data-mode=""CASH""]': isUrdu ? '`u{0646}`u{0642}`u{062F}' : 'Cash'"
    "'[data-mode=""CARD""]': isUrdu ? '[^']+' : 'Card'" = "'[data-mode=""CARD""]': isUrdu ? '`u{06A9}`u{0627}`u{0631}`u{0688}' : 'Card'"
    "'[data-mode=""QR""]': isUrdu ? '[^']+' : 'QR Code'" = "'[data-mode=""QR""]': isUrdu ? '`u{06A9}`u{06CC}`u{0648} `u{0622}`u{0631}' : 'QR Code'"
    "'[data-mode=""SPLIT""]': isUrdu ? '[^']+' : 'Split'" = "'[data-mode=""SPLIT""]': isUrdu ? '`u{062A}`u{0642}`u{0633}`u{06CC}`u{0645}' : 'Split'"
    "'[data-mode=""CREDIT""]': isUrdu ? '[^']+' : 'Credit \(Udhaar\)'" = "'[data-mode=""CREDIT""]': isUrdu ? '`u{0627}`u{062F}`u{06BE}`u{0627}`u{0631}' : 'Credit (Udhaar)'"
    # complete order button
    "'#btn-checkout-complete span': isUrdu ? '[^']+' : 'COMPLETE ORDER'" = "'#btn-checkout-complete span': isUrdu ? '`u{0622}`u{0631}`u{0688}`u{0631} `u{0645}`u{06A9}`u{0645}`u{0644} `u{06A9}`u{0631}`u{06CC}\u{06BA}' : 'COMPLETE ORDER'"
    # setup screen strings
    "'#btn-setup-standalone': isUrdu ? '[^']+' : 'Set Up New Standalone Store'" = "'#btn-setup-standalone': isUrdu ? '`u{0646}`u{0626}`u{06CC} `u{0627}`u{06A9}`u{06CC}`u{0644}`u{06CC} `u{062F}`u{06A9}`u{0627}`u{0646} `u{0628}`u{0646}`u{0627}`u{0626}`u{06CC}\u{06BA}' : 'Set Up New Standalone Store'"
    "'#btn-setup-join': isUrdu ? '[^']+' : 'Join Existing Store Network'" = "'#btn-setup-join': isUrdu ? '`u{0645}`u{0648}`u{062C}`u{0648}`u{062F}`u{06C1} `u{0646}`u{06CC}`u{0679} `u{0648}`u{0631}`u{06A9} `u{0633}`u{06D2} `u{062C}`u{0691}`u{06CC}\u{06BA}' : 'Join Existing Store Network'"
    "'#setup-title': isUrdu ? '[^']+' : 'Valenixia Setup'" = "'#setup-title': isUrdu ? '`u{0648}`u{06CC}`u{0644}`u{06CC}`u{0646}`u{06CC}`u{06A9}`u{0633}`u{06CC}`u{0627} `u{0633}`u{06CC}`u{0679} `u{0627}`u{067E}' : 'Valenixia Setup'"
    "'#btn-setup-back': isUrdu ? '[^']+' : 'Back'" = "'#btn-setup-back': isUrdu ? '`u{0648}`u{0627}`u{067E}`u{0633}' : 'Back'"
    "'#btn-setup-continue': isUrdu ? '[^']+' : 'Continue'" = "'#btn-setup-continue': isUrdu ? '`u{062C}`u{0627}`u{0631}`u{06CC} `u{0631}`u{06A9}`u{06BE}`u{06CC}\u{06BA}' : 'Continue'"
}

foreach ($pattern in $replacements.Keys) {
    $replacement = $replacements[$pattern]
    $content = [regex]::Replace($content, $pattern, $replacement)
}

# Write back as UTF-8 without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($filePath, $content, $utf8NoBom)
Write-Host "Done! app.js i18n block fixed."
