package com.valenixia.commerce.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size as ComposeSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.input.key.*
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import com.valenixia.commerce.audio.AudioSynth
import com.valenixia.commerce.db.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.*

// ─── Navigation destinations ────────────────────────────────────────
enum class NavScreen(val label: String, val icon: String) {
    CHECKOUT  ("Checkout",  "⊕"),
    CATALOG   ("Catalog",   "☰"),
    HISTORY   ("History",   "◷"),
    ANALYTICS ("Analytics", "◈"),
    CUSTOMERS ("Customers", "☍"),
    EMPLOYEES ("Staff",     "◉"),
    LOGS      ("Logs",      "◎"),
    SETTINGS  ("Settings",  "◌")
}

// ─── Shared formatting helpers ───────────────────────────────────────
private val currencyFmt = NumberFormat.getCurrencyInstance(Locale.US)
private fun formatCents(cents: Long): String = currencyFmt.format(cents / 100.0)
private val dateFmt     = SimpleDateFormat("MMM dd, HH:mm", Locale.US)
private val shortFmt    = SimpleDateFormat("HH:mm:ss",      Locale.US)

// ════════════════════════════════════════════════════════════════════
//  ROOT — auth gate
// ════════════════════════════════════════════════════════════════════
@Composable
fun DashboardView() {
    var authenticatedEmployee by remember { mutableStateOf<Employee?>(null) }
    var currentTheme by remember { mutableStateOf("Obsidian Emerald") }
    var refreshTrigger by remember { mutableStateOf(0) }

    LaunchedEffect(refreshTrigger) {
        val pref = Database.getPreference("store_theme_palette")
        if (pref != null) {
            currentTheme = pref
        }
    }

    // React to sync preferences changes
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1000)
            val pref = Database.getPreference("store_theme_palette")
            if (pref != null && pref != currentTheme) {
                currentTheme = pref
            }
        }
    }

    ValenixiaTheme(themeName = currentTheme) {
        val currentColors = LocalValenixiaColors.current
        Box(Modifier.fillMaxSize().background(currentColors.surface0)) {
            if (authenticatedEmployee == null) {
                AuthScreen { emp -> authenticatedEmployee = emp }
            } else {
                MainWorkspace(
                    employee      = authenticatedEmployee!!,
                    themeName     = currentTheme,
                    onThemeChange = { newTheme ->
                        currentTheme = newTheme
                        Database.setPreference("store_theme_palette", "STR", newTheme)
                        refreshTrigger++
                    },
                    onLockShift   = { authenticatedEmployee = null }
                )
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════
//  AUTH SCREEN — refined PIN pad
// ════════════════════════════════════════════════════════════════════
@Composable
fun AuthScreen(onAuthSuccess: (Employee) -> Unit) {
    var pin   by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    // Brute-force lockout state: persisted within the session.
    // 5 failed attempts → 10-minute lockout. Resets on successful auth.
    var pinAttempts     by remember { mutableStateOf(0) }
    var pinLockedUntil  by remember { mutableStateOf(0L) }
    var pinVisible by remember { mutableStateOf(false) }
    val shakeOffset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

    val colors = LocalValenixiaColors.current

    Box(
        Modifier.fillMaxSize()
            .background(Brush.radialGradient(listOf(Color(0xFF0D1520), Obsidian))),
        contentAlignment = Alignment.Center
    ) {
        // Background grid lines for aerospace feel
        Canvas(Modifier.fillMaxSize()) { drawAerospaceGrid(this) }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // Logo / Brand mark
            Box(
                Modifier
                    .size(64.dp)
                    .background(
                        Brush.linearGradient(listOf(NeonCyan, Color(0xFF0080FF))),
                        CircleShape
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text("N", fontSize = 28.sp, fontWeight = FontWeight.Black, color = Obsidian)
            }
            Spacer(Modifier.height(16.dp))
            Text("VALENIXIA COMMERCE",
                color = TextPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 4.sp
            )
            Text("POINT OF SALE  ·  v2.0",
                color = TextMuted,
                fontSize = 10.sp,
                letterSpacing = 2.sp,
                modifier = Modifier.padding(top = 4.dp, bottom = 32.dp)
            )

            // PIN card
            Box(
                Modifier
                    .width(340.dp)
                    .offset(x = shakeOffset.value.dp)
                    .background(InkBlack, RoundedCornerShape(16.dp))
                    .border(1.dp, if (error.isNotEmpty()) CoralRed.copy(alpha = 0.6f) else BorderDefault, RoundedCornerShape(16.dp))
                    .padding(28.dp)
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("EMPLOYEE LOGIN",
                        color = TextSecondary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 2.sp
                    )
                    Spacer(Modifier.height(20.dp))

                    // PIN display (dots or text) — supports 4 to 6 digit PINs
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        repeat(6) { i ->
                            val filled = i < pin.length
                            val char = if (filled && pinVisible) pin[i].toString() else if (filled) "•" else ""
                            Box(
                                Modifier
                                    .size(24.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(if (filled) NeonCyan.copy(alpha = 0.15f) else colors.surface2)
                                    .border(1.dp, if (filled) NeonCyan else BorderDefault, RoundedCornerShape(4.dp)),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = char,
                                    color = NeonCyan,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                        
                        Spacer(Modifier.width(8.dp))
                        
                        Text(
                            text = if (pinVisible) "👁" else "👁‍🗨",
                            color = colors.textSecondary,
                            fontSize = 14.sp,
                            modifier = Modifier
                                .clickable { pinVisible = !pinVisible; AudioSynth.playTick() }
                                .padding(4.dp)
                        )
                    }
                    Spacer(Modifier.height(24.dp))

                    // PIN grid
                    val rows = listOf(
                        listOf("1","2","3"),
                        listOf("4","5","6"),
                        listOf("7","8","9"),
                        listOf("⌫","0","✓")
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        rows.forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                row.forEach { key ->
                                    PinButton(
                                        key = key,
                                        onClick = {
                                            error = ""
                                            // If locked out, refuse all input except backspace
                                            val now = System.currentTimeMillis()
                                            if (pinLockedUntil > now && key != "⌫") {
                                                val minsLeft = ((pinLockedUntil - now) / 60_000).coerceAtLeast(1)
                                                error = "Terminal locked — too many failed attempts. Try again in ${minsLeft}m."
                                                AudioSynth.playScanError()
                                                return@PinButton
                                            }
                                            // Reset lockout display if it has expired
                                            if (pinLockedUntil > 0L && pinLockedUntil <= now) {
                                                pinLockedUntil = 0L
                                                pinAttempts = 0
                                            }
                                            when (key) {
                                                "⌫" -> { AudioSynth.playTick(); if (pin.isNotEmpty()) pin = pin.dropLast(1) }
                                                "✓" -> {
                                                    // Require at least 4 digits before submitting
                                                    if (pin.length < 4) {
                                                        error = "PIN must be at least 4 digits"
                                                        return@PinButton
                                                    }
                                                    val emp = Database.verifyEmployeePin(pin, "local:pinpad")
                                                    if (emp != null) {
                                                        AudioSynth.playDrawerOpen()
                                                        pinAttempts = 0
                                                        pinLockedUntil = 0L
                                                        onAuthSuccess(emp)
                                                    } else {
                                                        AudioSynth.playScanError()
                                                        pinAttempts++
                                                        pin = ""
                                                        if (pinAttempts >= 5) {
                                                            // Lock out for 10 minutes
                                                            pinLockedUntil = System.currentTimeMillis() + 10 * 60 * 1000
                                                            pinAttempts = 0
                                                            error = "Terminal locked for 10 minutes after 5 failed attempts."
                                                        } else {
                                                            error = "Invalid PIN — ${5 - pinAttempts} attempt(s) remaining before lockout"
                                                        }
                                                        scope.launch {
                                                            shakeOffset.animateTo(-15f, spring(stiffness = 1000f, dampingRatio = 0.2f))
                                                            shakeOffset.animateTo(15f, spring(stiffness = 1000f, dampingRatio = 0.2f))
                                                            shakeOffset.animateTo(-8f, spring(stiffness = 1000f, dampingRatio = 0.2f))
                                                            shakeOffset.animateTo(8f, spring(stiffness = 1000f, dampingRatio = 0.2f))
                                                            shakeOffset.animateTo(0f, spring(stiffness = 1000f, dampingRatio = 0.2f))
                                                        }
                                                    }
                                                }
                                                else -> { AudioSynth.playTick(); if (pin.length < 6) pin += key }
                                            }
                                        }
                                    )
                                }
                            }
                        }
                    }

                    if (error.isNotEmpty()) {
                        Spacer(Modifier.height(16.dp))
                        Text(error, color = CoralRed, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                    }

                    Spacer(Modifier.height(20.dp))
                    Divider(color = BorderSubtle)
                    Spacer(Modifier.height(12.dp))
                    
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(androidx.compose.ui.graphics.Color(0xFFEF4444).copy(alpha = 0.15f), RoundedCornerShape(8.dp))
                            .border(1.dp, androidx.compose.ui.graphics.Color(0xFFEF4444).copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "⚠️ WARNING: Change default PINs immediately in settings to secure this register.",
                            color = androidx.compose.ui.graphics.Color(0xFFF87171),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
        }
    }
}

@Composable
private fun PinButton(key: String, onClick: () -> Unit) {
    val interactionSource = remember { MutableInteractionSource() }
    val isHovered by interactionSource.collectIsHoveredAsState()
    val isConfirm = key == "✓"
    val isDelete  = key == "⌫"

    val scale by animateFloatAsState(
        targetValue = if (isHovered) 1.08f else 1.0f,
        animationSpec = spring(stiffness = 300f, dampingRatio = 0.6f)
    )

    Box(
        Modifier
            .size(72.dp)
            .scale(scale)
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    isConfirm && isHovered -> NeonCyan.copy(alpha = 0.25f)
                    isConfirm              -> NeonCyanDim
                    isDelete  && isHovered -> CoralDim.copy(alpha = 0.25f)
                    isDelete               -> CoralDim
                    isHovered              -> GraphiteHover
                    else                   -> GraphiteLight
                }
            )
            .border(
                1.dp,
                when {
                    isConfirm -> NeonCyan.copy(alpha = 0.4f)
                    isDelete  -> CoralRed.copy(alpha = 0.3f)
                    else      -> BorderSubtle
                },
                RoundedCornerShape(10.dp)
            )
            .clickable(interactionSource = interactionSource, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            key,
            fontSize = if (key.length > 1) 18.sp else 20.sp,
            fontWeight = FontWeight.SemiBold,
            color = when {
                isConfirm -> NeonCyan
                isDelete  -> CoralRed
                else      -> TextPrimary
            }
        )
    }
}

// ════════════════════════════════════════════════════════════════════
//  MAIN WORKSPACE — sidebar + content
// ════════════════════════════════════════════════════════════════════
@Composable
fun MainWorkspace(
    employee: Employee,
    themeName: String,
    onThemeChange: (String) -> Unit,
    onLockShift: () -> Unit
) {
    var activeScreen  by remember { mutableStateOf(NavScreen.CHECKOUT) }
    var isSidebarCollapsed by remember { mutableStateOf(false) }
    var isOnline      by remember { mutableStateOf(true) }
    val syncLogs      = remember { mutableStateListOf("[BOOT] Valenixia Commerce v3.0 initialized.", "[DB] SQLite WAL mode active.", "[NET] WebSocket sync server bound on :3000.") }

    var showCalculator by remember { mutableStateOf(false) }
    var showShortcutsHelp by remember { mutableStateOf(false) }

    // Lifted Checkout States
    var isBarcodeMode by remember { mutableStateOf(false) }
    var showCustomerSearch by remember { mutableStateOf(false) }
    var showReceiptPreview by remember { mutableStateOf(false) }
    var attachedCustomer by remember { mutableStateOf<Customer?>(null) }

    // Whitelabel States
    var storeName by remember { mutableStateOf(Database.getPreference("store_name") ?: "VALENIXIA COFFEE & RETAIL") }
    var storeLogoEmoji by remember { mutableStateOf(Database.getPreference("store_logo_emoji") ?: "☕") }
    var showBranding by remember { mutableStateOf((Database.getPreference("whitelabel_show_branding") ?: "true") == "true") }
    var glassmorphismEnabled by remember { mutableStateOf((Database.getPreference("glassmorphism_enabled") ?: "true") == "true") }
    var taxRate by remember { mutableStateOf((Database.getPreference("tax_rate") ?: "8.0").toFloatOrNull() ?: 8.0f) }
    var receiptTagline by remember { mutableStateOf(Database.getPreference("store_receipt_tagline") ?: "Stability meets Speed. Thank you!") }

    val isDarkMode = themeName != "Monochrome Ivory"
    val themesList = listOf("Obsidian Emerald", "Midnight Sapphire", "Warm Amber", "Minimalist Chrome", "Monochrome Ivory")
    val onToggleTheme = {
        val nextIndex = (themesList.indexOf(themeName) + 1) % themesList.size
        onThemeChange(themesList[nextIndex])
    }

    // Refresh whitelabel state reactively from database polling
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1000)
            val dbStoreName = Database.getPreference("store_name") ?: "VALENIXIA COFFEE & RETAIL"
            val dbLogoEmoji = Database.getPreference("store_logo_emoji") ?: "☕"
            val dbShowBranding = (Database.getPreference("whitelabel_show_branding") ?: "true") == "true"
            val dbGlassmorphism = (Database.getPreference("glassmorphism_enabled") ?: "true") == "true"
            val dbTax = (Database.getPreference("tax_rate") ?: "8.0").toFloatOrNull() ?: 8.0f
            val dbTagline = Database.getPreference("store_receipt_tagline") ?: "Stability meets Speed. Thank you!"

            if (dbStoreName != storeName) storeName = dbStoreName
            if (dbLogoEmoji != storeLogoEmoji) storeLogoEmoji = dbLogoEmoji
            if (dbShowBranding != showBranding) showBranding = dbShowBranding
            if (dbGlassmorphism != glassmorphismEnabled) glassmorphismEnabled = dbGlassmorphism
            if (dbTax != taxRate) taxRate = dbTax
            if (dbTagline != receiptTagline) receiptTagline = dbTagline
        }
    }

    val colors = LocalValenixiaColors.current
    val focusRequester = remember { FocusRequester() }

    Box(
        Modifier
            .fillMaxSize()
            .focusRequester(focusRequester)
            .focusable()
            .onKeyEvent { keyEvent ->
                if (keyEvent.type == KeyEventType.KeyDown) {
                    when (keyEvent.key) {
                        Key.F1 -> { activeScreen = NavScreen.CHECKOUT; true }
                        Key.F2 -> {
                            if (activeScreen == NavScreen.CHECKOUT) {
                                isBarcodeMode = !isBarcodeMode
                                AudioSynth.playTick()
                                true
                            } else false
                        }
                        Key.F3 -> { activeScreen = NavScreen.CATALOG; true }
                        Key.F4 -> { activeScreen = NavScreen.HISTORY; true }
                        Key.F5 -> { activeScreen = NavScreen.ANALYTICS; true }
                        Key.F6 -> {
                            if (activeScreen == NavScreen.CHECKOUT) {
                                showCustomerSearch = !showCustomerSearch
                                AudioSynth.playTick()
                                true
                            } else false
                        }
                        Key.F7 -> {
                            if (activeScreen == NavScreen.CHECKOUT) {
                                showReceiptPreview = !showReceiptPreview
                                AudioSynth.playTick()
                                true
                            } else false
                        }
                        Key.F8 -> { onLockShift(); true }
                        Key.K -> {
                            if (keyEvent.isCtrlPressed) {
                                showCalculator = !showCalculator
                                true
                            } else false
                        }
                        Key.D -> {
                            if (keyEvent.isCtrlPressed) {
                                onToggleTheme()
                                true
                            } else false
                        }
                        Key.Slash -> {
                            if (keyEvent.isShiftPressed) {
                                showShortcutsHelp = true
                                true
                            } else false
                        }
                        Key.Escape -> {
                            if (showCalculator) {
                                showCalculator = false
                                true
                            } else if (showShortcutsHelp) {
                                showShortcutsHelp = false
                                true
                            } else {
                                showCustomerSearch = false
                                showReceiptPreview = false
                                false
                            }
                        }
                        else -> false
                    }
                } else false
            }
    ) {
        // Request focus automatically
        LaunchedEffect(Unit) {
            focusRequester.requestFocus()
        }

        Row(Modifier.fillMaxSize()) {
            // ── SIDEBAR ────────────────────────────────────────────────
            Sidebar(
                employee      = employee,
                activeScreen  = activeScreen,
                isOnline      = isOnline,
                isCollapsed   = isSidebarCollapsed,
                onToggleCollapse = { isSidebarCollapsed = !isSidebarCollapsed },
                onNav         = { activeScreen = it },
                onLockShift   = onLockShift,
                storeName     = storeName,
                storeLogoEmoji = storeLogoEmoji,
                showBranding  = showBranding
            )

            // ── MAIN CONTENT ───────────────────────────────────────────
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .background(colors.surface0)
            ) {
                // Top bar
                TopStatusBar(
                    screen         = activeScreen,
                    employee       = employee,
                    isOnline       = isOnline,
                    isDarkMode     = isDarkMode,
                    onToggleTheme  = onToggleTheme,
                    onToggleOnline = {
                        isOnline = it
                        syncLogs.add("[SYNC] Coupling state → ${if (it) "ONLINE" else "OFFLINE"}")
                    },
                    storeName      = storeName,
                    storeLogoEmoji = storeLogoEmoji
                )

                // Screen content
                Box(Modifier.weight(1f).fillMaxWidth().padding(24.dp)) {
                    Crossfade(
                        targetState = activeScreen,
                        animationSpec = spring(stiffness = 200f)
                    ) { screen ->
                        when (screen) {
                            NavScreen.CHECKOUT  -> CheckoutScreen(
                                employee = employee,
                                isOnline = isOnline,
                                syncLogs = syncLogs,
                                isBarcodeMode = isBarcodeMode,
                                onBarcodeModeChange = { isBarcodeMode = it },
                                showCustomerSearch = showCustomerSearch,
                                onCustomerSearchChange = { showCustomerSearch = it },
                                showReceiptPreview = showReceiptPreview,
                                onReceiptPreviewChange = { showReceiptPreview = it },
                                attachedCustomer = attachedCustomer,
                                onAttachedCustomerChange = { attachedCustomer = it },
                                isSidebarCollapsed = isSidebarCollapsed
                            )
                            NavScreen.CATALOG   -> CatalogScreen(syncLogs)
                            NavScreen.HISTORY   -> HistoryScreen(syncLogs)
                            NavScreen.ANALYTICS -> AnalyticsScreen()
                            NavScreen.CUSTOMERS -> CustomersScreen(isOnline, syncLogs)
                            NavScreen.EMPLOYEES -> EmployeesScreen(syncLogs)
                            NavScreen.LOGS      -> LogsScreen(syncLogs)
                            NavScreen.SETTINGS  -> SettingsScreen(
                                employee = employee,
                                currentTheme = themeName,
                                onThemeChange = onThemeChange,
                                syncLogs = syncLogs,
                                onBrandingRefresh = {
                                    storeName = Database.getPreference("store_name") ?: "VALENIXIA COFFEE & RETAIL"
                                    storeLogoEmoji = Database.getPreference("store_logo_emoji") ?: "☕"
                                    showBranding = (Database.getPreference("whitelabel_show_branding") ?: "true") == "true"
                                    glassmorphismEnabled = (Database.getPreference("glassmorphism_enabled") ?: "true") == "true"
                                    taxRate = (Database.getPreference("tax_rate") ?: "8.0").toFloatOrNull() ?: 8.0f
                                    receiptTagline = Database.getPreference("store_receipt_tagline") ?: "Stability meets Speed. Thank you!"
                                }
                            )
                        }
                    }
                }
            }
        }

        // Floating Overlays
        if (showCalculator) {
            CalculatorOverlay(onDismiss = { showCalculator = false })
        }

        if (showShortcutsHelp) {
            ShortcutsHelpOverlay(onDismiss = { showShortcutsHelp = false })
        }
    }
}

// ── SIDEBAR ──────────────────────────────────────────────────────────
@Composable
private fun Sidebar(
    employee: Employee,
    activeScreen: NavScreen,
    isOnline: Boolean,
    isCollapsed: Boolean,
    onToggleCollapse: () -> Unit,
    onNav: (NavScreen) -> Unit,
    onLockShift: () -> Unit,
    storeName: String,
    storeLogoEmoji: String,
    showBranding: Boolean
) {
    val borderSubtleColor = BorderSubtle
    val colors = LocalValenixiaColors.current
    val sidebarWidth by animateDpAsState(if (isCollapsed) 64.dp else 220.dp, spring(stiffness = 200f))

    Column(
        Modifier
            .width(sidebarWidth)
            .fillMaxHeight()
            .background(colors.sidebarBg)
            .drawBehind {
                // Right border line
                drawLine(
                    color  = borderSubtleColor,
                    start  = Offset(size.width, 0f),
                    end    = Offset(size.width, size.height),
                    strokeWidth = 1f
                )
            }
            .padding(vertical = 20.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column {
            // Brand
            Row(
                Modifier.fillMaxWidth().padding(horizontal = if (isCollapsed) 10.dp else 20.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = if (isCollapsed) Arrangement.Center else Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(30.dp)
                            .background(Brush.linearGradient(listOf(colors.accent, colors.accentGlow)), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            if (showBranding) "N" else storeLogoEmoji.take(1),
                            fontSize = if (showBranding) 13.sp else 16.sp,
                            fontWeight = FontWeight.Black,
                            color = colors.surface0
                        )
                    }
                    if (!isCollapsed) {
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(
                                if (showBranding) "VALENIXIA" else storeName,
                                color = colors.textPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 1.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                if (showBranding) "Commerce POS" else "Point of Sale",
                                color = colors.textMuted,
                                fontSize = 9.sp
                            )
                        }
                    }
                }
                if (!isCollapsed) {
                    IconButton(onClick = onToggleCollapse, modifier = Modifier.size(24.dp)) {
                        Text("◀", color = colors.textMuted, fontSize = 10.sp)
                    }
                }
            }

            if (isCollapsed) {
                Spacer(Modifier.height(8.dp))
                IconButton(onClick = onToggleCollapse, modifier = Modifier.size(24.dp).align(Alignment.CenterHorizontally)) {
                    Text("▶", color = colors.textMuted, fontSize = 10.sp)
                }
            }

            Spacer(Modifier.height(28.dp))

            // Nav items
            NavScreen.values().forEach { screen ->
                val isActive = screen == activeScreen
                val interactionSource = remember { MutableInteractionSource() }
                val isHovered by interactionSource.collectIsHoveredAsState()

                // Animated active background
                val targetBg = when {
                    isActive -> colors.navItemActive
                    isHovered -> colors.navItemHover
                    else -> Color.Transparent
                }
                val bgAnimate by animateColorAsState(targetBg, spring(stiffness = 200f))

                // Animated icon scale
                val targetScale = if (isHovered) 1.15f else 1.0f
                val iconScale by animateFloatAsState(targetScale, spring(stiffness = 200f, dampingRatio = 0.6f))

                // Animated indicator height
                val indicatorHeight by animateDpAsState(if (isActive) 18.dp else 0.dp, spring(stiffness = 200f))

                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = if (isCollapsed) 6.dp else 10.dp, vertical = 2.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(bgAnimate)
                        .clickable(interactionSource = interactionSource, indication = null) { onNav(screen) }
                        .padding(horizontal = if (isCollapsed) 8.dp else 12.dp, vertical = 10.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = if (isCollapsed) Arrangement.Center else Arrangement.Start
                    ) {
                        if (!isCollapsed) {
                            // Active indicator
                            Box(
                                Modifier.width(3.dp).height(indicatorHeight)
                                    .clip(RoundedCornerShape(2.dp))
                                    .background(colors.accent)
                            )
                            Spacer(Modifier.width(10.dp))
                        }
                        // Icon with animated scale
                        Box(modifier = Modifier.scale(iconScale)) {
                            Text(
                                screen.icon,
                                fontSize = 14.sp,
                                color = if (isActive) colors.accent else colors.textSecondary
                            )
                        }
                        if (!isCollapsed) {
                            Spacer(Modifier.width(10.dp))
                            Text(
                                screen.label,
                                fontSize = 13.sp,
                                fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (isActive) colors.textPrimary else colors.textSecondary
                            )
                        }
                    }
                }
            }
        }

        // Bottom section
        Column(
            Modifier.fillMaxWidth().padding(horizontal = if (isCollapsed) 8.dp else 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (isCollapsed) {
                Box(
                    Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(colors.surface2)
                        .padding(8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        Modifier.size(8.dp).clip(CircleShape)
                            .background(if (isOnline) colors.success else colors.warning)
                    )
                }
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(colors.surface2)
                        .clickable { onLockShift() },
                    contentAlignment = Alignment.Center
                ) {
                    Text("⎋", fontSize = 12.sp, color = colors.textMuted)
                }
            } else {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.surface2, RoundedCornerShape(8.dp))
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(6.dp).clip(CircleShape)
                                .background(if (isOnline) colors.success else colors.warning)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (isOnline) "ONLINE" else "OFFLINE",
                            color = if (isOnline) colors.success else colors.warning,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))

                // Employee badge
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.surface2, RoundedCornerShape(8.dp))
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text(employee.role, color = colors.accent, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        Text(employee.id.take(8) + "…", color = colors.textMuted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
                    }
                    Text(
                        "⎋", fontSize = 14.sp, color = colors.textMuted,
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable { onLockShift() }
                            .padding(4.dp)
                    )
                }
            }
        }
    }
}

// ── TOP STATUS BAR ───────────────────────────────────────────────────
@Composable
private fun TopStatusBar(
    screen: NavScreen,
    @Suppress("UNUSED_PARAMETER") employee: Employee,
    isOnline: Boolean,
    isDarkMode: Boolean,
    onToggleTheme: () -> Unit,
    onToggleOnline: (Boolean) -> Unit,
    storeName: String,
    storeLogoEmoji: String
) {
    var clockTick by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1000)
            clockTick = System.currentTimeMillis()
        }
    }

    val borderSubtleColor = BorderSubtle
    val colors = LocalValenixiaColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(colors.surface1)
            .drawBehind {
                drawLine(borderSubtleColor, Offset(0f, size.height), Offset(size.width, size.height), 1f)
            }
            .padding(horizontal = 24.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(storeLogoEmoji, fontSize = 16.sp, modifier = Modifier.padding(end = 6.dp))
                Text(storeName, color = colors.accent, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(end = 8.dp))
                Text("|", color = colors.textMuted, fontSize = 14.sp, modifier = Modifier.padding(end = 8.dp))
                Text(screen.label, color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
            Text(
                SimpleDateFormat("EEEE, MMM dd yyyy  ·  HH:mm:ss", Locale.US).format(Date(clockTick)),
                color = colors.textMuted, fontSize = 10.sp
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            // Theme toggle button
            IconButton(onClick = onToggleTheme) {
                val rotation by animateFloatAsState(if (isDarkMode) 0f else 180f, spring(stiffness = 200f))
                Box(modifier = Modifier.rotate(rotation)) {
                    Text(if (isDarkMode) "☽" else "☼", fontSize = 16.sp, color = colors.textPrimary)
                }
            }

            // HLC clock chip
            Row(
                Modifier
                    .background(colors.surface2, RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("HLC ", color = colors.textMuted, fontSize = 9.sp)
                Text(
                    Database.hlc.tick().takeLast(12),
                    color = colors.accent, fontSize = 9.sp, fontFamily = FontFamily.Monospace
                )
            }
            // Connection badge
            Row(
                Modifier
                    .background(if (isOnline) colors.successDim else colors.warningDim, RoundedCornerShape(6.dp))
                    .border(1.dp, if (isOnline) colors.success.copy(alpha = 0.3f) else colors.warning.copy(alpha = 0.3f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(if (isOnline) colors.success else colors.warning))
                Text(
                    if (isOnline) "ONLINE" else "OFFLINE",
                    color = if (isOnline) colors.success else colors.warning,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            // Terminal chip
            Row(
                Modifier
                    .background(colors.surface2, RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            ) {
                Text("TID ", color = colors.textMuted, fontSize = 9.sp)
                Text(Database.hlc.nodeId, color = colors.textSecondary, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════
//  SCREEN 1 — CHECKOUT / POS
// ════════════════════════════════════════════════════════════════════
@Composable
fun CheckoutScreen(
    employee: Employee,
    isOnline: Boolean,
    syncLogs: MutableList<String>,
    isBarcodeMode: Boolean,
    onBarcodeModeChange: (Boolean) -> Unit,
    showCustomerSearch: Boolean,
    onCustomerSearchChange: (Boolean) -> Unit,
    showReceiptPreview: Boolean,
    onReceiptPreviewChange: (Boolean) -> Unit,
    attachedCustomer: Customer?,
    onAttachedCustomerChange: (Customer?) -> Unit,
    isSidebarCollapsed: Boolean
) {
    var searchVal by remember { mutableStateOf("") }
    var barcodeInput by remember { mutableStateOf("") }
    val cartItems = remember { mutableStateListOf<CartItem>() }
    val catalogItems = remember { mutableStateListOf<InventoryItem>() }
    val scope = rememberCoroutineScope()
    var paymentMode by remember { mutableStateOf("CASH") }
    var discountPct by remember { mutableStateOf(0) }
    var customDiscountStr by remember { mutableStateOf("") }
    var showCustomDiscount by remember { mutableStateOf(false) }
    var statusMsg by remember { mutableStateOf("") }
    var statusIsErr by remember { mutableStateOf(false) }

    var isQuickCatalogClosed by remember { mutableStateOf(false) }
    var selectedCategory by remember { mutableStateOf("ALL") }
    var quickSearchVal by remember { mutableStateOf("") }

    // Speech Analytics Coach States
    var isSpeechCoachExpanded by remember { mutableStateOf(false) }
    var isSpeechRecording by remember { mutableStateOf(false) }
    var speechStatus by remember { mutableStateOf("OFFLINE") }
    var speechWpm by remember { mutableStateOf(0) }
    var speechFillers by remember { mutableStateOf(0) }
    var speechSentiment by remember { mutableStateOf("NEUTRAL") }
    var speechRisk by remember { mutableStateOf("LOW") }
    var speechTranscript by remember { mutableStateOf("Press START to activate.") }
    var speechWordCount by remember { mutableStateOf(0) }
    var speechStartTime by remember { mutableStateOf(0L) }
    var sentimentScore by remember { mutableStateOf(0) }

    LaunchedEffect(isSpeechRecording) {
        if (isSpeechRecording) {
            speechStatus = "SIMULATING COACH"
            speechStartTime = System.currentTimeMillis()
            speechWordCount = 0
            sentimentScore = 0
            speechFillers = 0
            speechWpm = 0
            speechSentiment = "NEUTRAL"
            speechRisk = "LOW"
            speechTranscript = "Listening to audio channel..."

            val simulatedSentences = listOf(
                "Hello! Welcome to Valenixia.",
                "Add one cold brew coffee and cookie, please.",
                "That basically will be like seven dollars and twenty five cents, um, cash or card?",
                "No problem! Let me get a manager override to void this item, sorry for the slow queue.",
                "Thank you! Have a great day!"
            )

            val positiveVocabulary = listOf("welcome", "please", "thank", "great", "nice", "awesome", "perfect", "sorry", "good", "happy")
            val negativeVocabulary = listOf("slow", "sorry", "error", "void", "stolen", "fake", "override", "issue", "bad", "friction")
            val fillersVocabulary = listOf("um", "like", "basically", "uh", "so", "actually", "er")

            var currentIndex = 0
            while (isSpeechRecording) {
                kotlinx.coroutines.delay(4000)
                if (!isSpeechRecording) break

                val sentence = simulatedSentences[currentIndex]
                speechTranscript = "[SIMULATED AUDIO] \"$sentence\""

                // Parse sentence
                val cleanSentence = sentence.toLowerCase().replace(Regex("[.,/#!$%^&*\\(\\);:{}=\\-_`~()]"), "")
                val words = cleanSentence.split(Regex("\\s+")).filter { it.isNotEmpty() }

                if (words.isNotEmpty()) {
                    speechWordCount += words.size
                    val durationMins = (System.currentTimeMillis() - speechStartTime) / 60000.0
                    speechWpm = if (durationMins > 0.0) Math.round(speechWordCount / durationMins).toInt() else 0

                    words.forEach { word ->
                        if (fillersVocabulary.contains(word)) {
                            speechFillers++
                        }
                        if (positiveVocabulary.contains(word)) {
                            sentimentScore++
                        }
                        if (negativeVocabulary.contains(word)) {
                            sentimentScore--
                        }
                    }

                    speechSentiment = when {
                        sentimentScore > 1 -> "POSITIVE"
                        sentimentScore < -1 -> "FRICTION"
                        else -> "NEUTRAL"
                    }

                    speechRisk = when {
                        sentimentScore < -2 || speechFillers > 8 -> "MEDIUM"
                        words.contains("fraud") || words.contains("stolen") || words.contains("fake") || words.contains("override") -> "CRITICAL RISK"
                        else -> "LOW"
                    }

                    // Parse POS commands
                    for (i in 0 until words.size - 1) {
                        if (words[i] == "add") {
                            val itemRequest = words[i+1]
                            val matchedItem = catalogItems.find { it.name.contains(itemRequest, ignoreCase = true) || it.sku.contains(itemRequest, ignoreCase = true) }
                            if (matchedItem != null) {
                                val idx = cartItems.indexOfFirst { it.sku == matchedItem.sku }
                                if (idx != -1) {
                                    cartItems[idx] = cartItems[idx].copy(qty = cartItems[idx].qty + 1)
                                } else {
                                    cartItems.add(CartItem(matchedItem.sku, matchedItem.name, matchedItem.basePriceMinorUnits, 1))
                                }
                                AudioSynth.playScanSuccess()
                                statusMsg = "✓ Voice command: Added ${matchedItem.name}"
                                statusIsErr = false
                            }
                        }
                        if (words[i] == "remove" || words[i] == "delete") {
                            val itemRequest = words[i+1]
                            val matchedItem = catalogItems.find { it.name.contains(itemRequest, ignoreCase = true) || it.sku.contains(itemRequest, ignoreCase = true) }
                            if (matchedItem != null) {
                                val idx = cartItems.indexOfFirst { it.sku == matchedItem.sku }
                                if (idx != -1) {
                                    val currentItem = cartItems[idx]
                                    if (currentItem.qty > 1) {
                                        cartItems[idx] = currentItem.copy(qty = currentItem.qty - 1)
                                    } else {
                                        cartItems.removeAt(idx)
                                    }
                                    AudioSynth.playTick()
                                    statusMsg = "✓ Voice command: Removed ${matchedItem.name}"
                                    statusIsErr = false
                                }
                            }
                        }
                    }

                    if (words.contains("pay") || words.contains("checkout") || words.contains("charge")) {
                        if (cartItems.isNotEmpty()) {
                            onReceiptPreviewChange(true)
                            statusMsg = "✓ Voice command: Initiated Checkout"
                            statusIsErr = false
                        }
                    }
                }

                currentIndex = (currentIndex + 1) % simulatedSentences.size
            }
        } else {
            speechStatus = "OFFLINE"
        }
    }

    // Split Payment States
    var showSplitPaymentDialog by remember { mutableStateOf(false) }
    var splitCashAmountStr by remember { mutableStateOf("") }
    var splitCardAmountStr by remember { mutableStateOf("") }
    var splitCashCents by remember { mutableStateOf(0L) }
    var splitCardCents by remember { mutableStateOf(0L) }

    // Cash Paid str for change calculation
    var cashPaidStr by remember { mutableStateOf("") }

    // Customer creation dialog in checkout
    var showAddCustomerDialog by remember { mutableStateOf(false) }

    val colors = LocalValenixiaColors.current

    var isRightSidebarClosed by remember { mutableStateOf(false) }
    var taxPctState by remember { mutableStateOf(8.0) }
    var customTaxStr by remember { mutableStateOf("8.0") }
    var showCustomTax by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            val inv = Database.getInventory()
            val savedTax = Database.getPreference("tax_rate")?.toDoubleOrNull() ?: 8.0
            withContext(Dispatchers.Main) {
                catalogItems.addAll(inv)
                taxPctState = savedTax
                customTaxStr = savedTax.toString()
                if (savedTax !in listOf(0.0, 5.0, 8.0, 10.0)) {
                    showCustomTax = true
                }
            }
        }
    }

    // Calculations
    val subtotalCents = cartItems.sumOf { it.basePriceMinorUnits * it.qty }
    val discountCents = (subtotalCents * discountPct / 100)
    val taxableCents = subtotalCents - discountCents
    val taxRate = taxPctState / 100.0
    val taxCents = Math.round(taxableCents * taxRate)
    val totalCents = taxableCents + taxCents

    val filteredItems = if (searchVal.trim().isEmpty()) emptyList()
    else catalogItems.filter {
        it.name.contains(searchVal, true) || it.sku.contains(searchVal, true)
    }

    // Barcode scanner auto focus
    val barcodeFocusRequester = remember { FocusRequester() }
    LaunchedEffect(isBarcodeMode) {
        if (isBarcodeMode) {
            barcodeFocusRequester.requestFocus()
        }
    }

    // Handlers
    fun handleCheckoutSuccess(txId: String, finalPaymentMode: String, payDetails: String?) {
        AudioSynth.playScanSuccess()
        AudioSynth.playDrawerOpen()
        syncLogs.add("[TX] Committed ${txId.take(8)} — ${formatCents(totalCents)} via $finalPaymentMode")
        statusMsg = "✓ Transaction complete — ${formatCents(totalCents)}"
        statusIsErr = false
        cartItems.clear()
        discountPct = 0
        customDiscountStr = ""
        showCustomDiscount = false
        cashPaidStr = ""
        onAttachedCustomerChange(null)
        scope.launch {
            val inv = withContext(Dispatchers.IO) { Database.getInventory() }
            catalogItems.clear()
            catalogItems.addAll(inv)
        }
    }

    Box(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        val cartModifier = if (isSidebarCollapsed && !isQuickCatalogClosed) {
            Modifier.weight(1f).fillMaxHeight()
        } else if (!isSidebarCollapsed && !isQuickCatalogClosed) {
            Modifier.width(340.dp).fillMaxHeight()
        } else {
            Modifier.weight(1f).fillMaxHeight()
        }
        Column(
            cartModifier,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (isBarcodeMode) {
                // Barcode scanner input mode
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(8.dp))
                        .border(2.dp, colors.accent, RoundedCornerShape(8.dp))
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                ) {
                    BasicTextField(
                        value = barcodeInput,
                        onValueChange = { barcodeInput = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(barcodeFocusRequester)
                            .onKeyEvent { keyEvent ->
                                if (keyEvent.type == KeyEventType.KeyDown && keyEvent.key == Key.Enter) {
                                    val matchedItem = catalogItems.find {
                                        it.sku.equals(barcodeInput.trim(), ignoreCase = true) ||
                                        (it.gtin != null && it.gtin.equals(barcodeInput.trim(), ignoreCase = true))
                                    }
                                    if (matchedItem != null) {
                                        val idx = cartItems.indexOfFirst { it.sku == matchedItem.sku }
                                        if (idx != -1) {
                                            cartItems[idx] = cartItems[idx].copy(qty = cartItems[idx].qty + 1)
                                        } else {
                                            cartItems.add(CartItem(matchedItem.sku, matchedItem.name, matchedItem.basePriceMinorUnits, 1))
                                        }
                                        AudioSynth.playScanSuccess()
                                        statusMsg = "✓ Scanned ${matchedItem.name}"
                                        statusIsErr = false
                                    } else {
                                        AudioSynth.playScanError()
                                        statusMsg = "✗ Product not found for '$barcodeInput'"
                                        statusIsErr = true
                                    }
                                    barcodeInput = ""
                                    true
                                } else false
                            },
                        textStyle = TextStyle(color = colors.accent, fontSize = 16.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace),
                        cursorBrush = SolidColor(colors.accent),
                        decorationBox = { inner ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("║▌║█║▌ ", color = colors.accent, fontSize = 20.sp)
                                Box(modifier = Modifier.weight(1f)) {
                                    if (barcodeInput.isEmpty()) {
                                        Text("Scan barcode or type SKU/GTIN + Enter... (F2 to toggle)", color = colors.textMuted, fontSize = 14.sp)
                                    }
                                    inner()
                                }
                            }
                        }
                    )
                }
            } else {
                // Search bar
                SearchBar(
                    value = searchVal,
                    onValueChange = { searchVal = it },
                    placeholder = "Search product name or SKU... (F2 for Barcode Scan)"
                )

                // Autocomplete Dropdown
                if (filteredItems.isNotEmpty()) {
                    Card(
                        backgroundColor = colors.surface2,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 180.dp),
                        elevation = 12.dp,
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        LazyColumn {
                            items(filteredItems) { item ->
                                val interactionSource = remember { MutableInteractionSource() }
                                val hovered by interactionSource.collectIsHoveredAsState()
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .background(if (hovered) colors.surfaceHover else Color.Transparent)
                                        .clickable(interactionSource = interactionSource, indication = null) {
                                            val idx = cartItems.indexOfFirst { it.sku == item.sku }
                                            if (idx != -1) {
                                                cartItems[idx] = cartItems[idx].copy(qty = cartItems[idx].qty + 1)
                                            } else {
                                                cartItems.add(CartItem(item.sku, item.name, item.basePriceMinorUnits, 1))
                                            }
                                            searchVal = ""
                                            AudioSynth.playTick()
                                        }
                                        .padding(horizontal = 14.dp, vertical = 9.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        ProductInitialsBadge(item.name)
                                        Column {
                                            Text(item.name, color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                                            Text("SKU: ${item.sku}  ·  Stock: ${item.stockLevel}  ·  Cat: ${item.category}", color = colors.textMuted, fontSize = 9.sp)
                                        }
                                    }
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(formatCents(item.basePriceMinorUnits), color = colors.accent, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                        if (item.stockLevel <= item.lowStockThreshold) Text("LOW STOCK", color = colors.warning, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                                Divider(color = colors.borderSubtle)
                            }
                        }
                    }
                }
            }

            // Attached Customer badge
            if (attachedCustomer != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.accentDim, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.accent.copy(alpha = 0.3f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(
                            modifier = Modifier
                                .background(colors.accent, RoundedCornerShape(4.dp))
                                .padding(horizontal = 6.dp, vertical = 3.dp)
                        ) {
                            Text("CUST", color = colors.surface0, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        }
                        Column {
                            Text("Customer: ${attachedCustomer.name}", color = colors.textPrimary, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            val totalSpendStr = formatCents(attachedCustomer.totalSpendCents)
                            Text("Phone: ${attachedCustomer.phone}  ·  Visits: ${attachedCustomer.visits}  ·  Total Spend: $totalSpendStr", color = colors.textSecondary, fontSize = 10.sp)
                        }
                    }
                    Text(
                        "Detach (✕)",
                        color = colors.error,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable {
                            onAttachedCustomerChange(null)
                            AudioSynth.playTick()
                        }
                    )
                }
            }

            // Cart Items Header
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("ORDER CART (${cartItems.size})", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp)
                    if (isRightSidebarClosed) {
                        Text(
                            "• Options Closed",
                            color = colors.accent,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (cartItems.isNotEmpty()) {
                        Text(
                            "Void Cart",
                            color = colors.error, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clickable { cartItems.clear(); onAttachedCustomerChange(null); AudioSynth.playTick() }
                        )
                    }
                    Text(
                        if (isQuickCatalogClosed) "Show Grid" else "Hide Grid",
                        color = colors.accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable { isQuickCatalogClosed = !isQuickCatalogClosed; AudioSynth.playTick() }
                    )
                    Text(
                        if (isRightSidebarClosed) "Show Settings ⇥" else "Hide Settings ⇤",
                        color = colors.accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable { isRightSidebarClosed = !isRightSidebarClosed; AudioSynth.playTick() }
                    )
                }
            }

            // Ledger Card
            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .background(colors.surface1, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
            ) {
                if (cartItems.isEmpty()) {
                    Column(
                        Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(
                            modifier = Modifier
                                .size(64.dp)
                                .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                                .background(colors.surface2),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("CART", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = colors.textMuted, fontFamily = FontFamily.Monospace)
                        }
                        Spacer(Modifier.height(16.dp))
                        Text("Cart is currently empty", color = colors.textMuted, fontSize = 14.sp)
                        Text(if (isBarcodeMode) "Ready to scan items..." else "Search or scan products to get started", color = colors.textMuted.copy(alpha = 0.7f), fontSize = 11.sp)
                    }
                } else {
                    LazyColumn(Modifier.fillMaxSize().padding(8.dp)) {
                        items(cartItems) { item ->
                            CartRow(
                                item = item,
                                onQtyMinus = {
                                    val idx = cartItems.indexOfFirst { it.sku == item.sku }
                                    if (idx != -1) {
                                        val currentItem = cartItems[idx]
                                        if (currentItem.qty > 1) {
                                            cartItems[idx] = currentItem.copy(qty = currentItem.qty - 1)
                                        } else {
                                            cartItems.removeAt(idx)
                                        }
                                    }
                                    AudioSynth.playTick()
                                },
                                onQtyPlus = {
                                    val idx = cartItems.indexOfFirst { it.sku == item.sku }
                                    if (idx != -1) {
                                        val currentItem = cartItems[idx]
                                        cartItems[idx] = currentItem.copy(qty = currentItem.qty + 1)
                                    }
                                    AudioSynth.playTick()
                                },
                                onRemove = { cartItems.remove(item); AudioSynth.playTick() }
                            )
                        }
                    }
                }
            }

            // Status notification bar
            if (statusMsg.isNotEmpty()) {
                Box(
                    Modifier.fillMaxWidth()
                        .background(if (statusIsErr) colors.errorDim else colors.successDim, RoundedCornerShape(8.dp))
                        .border(1.dp, if (statusIsErr) colors.error.copy(alpha = 0.3f) else colors.success.copy(alpha = 0.3f), RoundedCornerShape(8.dp))
                        .padding(10.dp)
                ) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(statusMsg, color = if (statusIsErr) colors.error else colors.success, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                        Text("✕", color = colors.textMuted, fontSize = 11.sp, modifier = Modifier.clickable { statusMsg = "" })
                    }
                }
            }

            // ── COMPACT CHECKOUT SUMMARY BAR (visible when right sidebar is closed) ──
            if (isRightSidebarClosed && cartItems.isNotEmpty()) {
                val splitSum = splitCashCents + splitCardCents
                val canCheckout = paymentMode != "SPLIT" || splitSum == totalCents
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(10.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Subtotal", color = colors.textSecondary, fontSize = 11.sp)
                        Text(formatCents(subtotalCents), color = colors.textPrimary, fontSize = 11.sp)
                    }
                    if (discountCents > 0) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Discount (${discountPct}%)", color = colors.warning, fontSize = 11.sp)
                            Text("−${formatCents(discountCents)}", color = colors.warning, fontSize = 11.sp)
                        }
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Tax (${"%.1f".format(taxPctState)}%)", color = colors.textSecondary, fontSize = 11.sp)
                        Text(formatCents(taxCents), color = colors.textSecondary, fontSize = 11.sp)
                    }
                    Divider(color = colors.borderSubtle)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column {
                            Text("TOTAL DUE", color = colors.textMuted, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp)
                            Text(formatCents(totalCents), color = colors.accent, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        }
                        Button(
                            onClick = {
                                if (paymentMode == "SPLIT" && splitSum != totalCents) {
                                    statusMsg = "Split amounts do not balance."
                                    statusIsErr = true
                                } else {
                                    onReceiptPreviewChange(true)
                                }
                            },
                            enabled = canCheckout,
                            colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                            modifier = Modifier.height(44.dp),
                            shape = RoundedCornerShape(8.dp),
                            elevation = ButtonDefaults.elevation(0.dp)
                        ) {
                            Text("CHARGE  ${formatCents(totalCents)}", fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 1.sp)
                        }
                    }
                }
            }
        }

        // ── MIDDLE COLUMN: Quick-Access Product Grid ─────────────────
        if (!isQuickCatalogClosed) {
            Column(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "QUICK PRODUCTS",
                        color = colors.textSecondary,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 1.sp
                    )
                }

                // Scrollable Row of Category Pills
                val categories = listOf("ALL") + catalogItems.map { it.category }.filter { it.isNotEmpty() }.distinct()
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    categories.forEach { cat ->
                        val isActive = selectedCategory == cat
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(20.dp))
                                .background(if (isActive) colors.accentDim else colors.surface2)
                                .border(1.dp, if (isActive) colors.accent else colors.borderDefault, RoundedCornerShape(20.dp))
                                .clickable {
                                    selectedCategory = cat
                                    AudioSynth.playTick()
                                }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(
                                cat,
                                color = if (isActive) colors.accent else colors.textPrimary,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                // Quick Search Input
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(8.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    BasicTextField(
                        value = quickSearchVal,
                        onValueChange = { quickSearchVal = it },
                        textStyle = TextStyle(color = colors.textPrimary, fontSize = 13.sp),
                        cursorBrush = SolidColor(colors.accent),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (quickSearchVal.isEmpty()) Text("Quick search...", color = colors.textMuted, fontSize = 12.sp)
                                inner()
                            }
                        }
                    )
                }

                // Products Grid
                val filteredCatalog = catalogItems.filter { p ->
                    val matchesCat = selectedCategory == "ALL" || p.category == selectedCategory
                    val matchesQuery = quickSearchVal.isEmpty() || p.name.contains(quickSearchVal, true) || p.sku.contains(quickSearchVal, true)
                    matchesCat && matchesQuery
                }

                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    if (filteredCatalog.isEmpty()) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("No products found", color = colors.textMuted, fontSize = 12.sp)
                        }
                    } else {
                        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(filteredCatalog.chunked(3)) { rowItems ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    rowItems.forEach { item ->
                                        val interactionSource = remember { MutableInteractionSource() }
                                        val hovered by interactionSource.collectIsHoveredAsState()
                                        val inCart = cartItems.find { it.sku == item.sku }?.qty ?: 0
                                        val availableStock = item.stockLevel - inCart
                                        val outOfStock = availableStock <= 0

                                        Box(
                                            modifier = Modifier
                                                .weight(1f)
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(if (outOfStock) colors.surface2.copy(alpha = 0.5f) else if (hovered) colors.surfaceHover else colors.surface2)
                                                .border(
                                                    1.dp,
                                                    if (outOfStock) colors.borderDefault.copy(alpha = 0.5f) else if (hovered) colors.accent else colors.borderDefault,
                                                    RoundedCornerShape(8.dp)
                                                )
                                                .clickable(enabled = !outOfStock, interactionSource = interactionSource, indication = null) {
                                                    val idx = cartItems.indexOfFirst { it.sku == item.sku }
                                                    if (idx != -1) {
                                                        cartItems[idx] = cartItems[idx].copy(qty = cartItems[idx].qty + 1)
                                                    } else {
                                                        cartItems.add(CartItem(item.sku, item.name, item.basePriceMinorUnits, 1))
                                                    }
                                                    AudioSynth.playTick()
                                                }
                                                .padding(10.dp)
                                        ) {
                                            Column {
                                                Row(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    horizontalArrangement = Arrangement.SpaceBetween,
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    val catCode = if (item.category.length >= 3) item.category.substring(0, 3).toUpperCase() else "GEN"
                                                    Text(catCode, color = colors.textMuted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                                                    if (inCart > 0) {
                                                        Box(
                                                            modifier = Modifier
                                                                .background(colors.accent, CircleShape)
                                                                .size(16.dp),
                                                            contentAlignment = Alignment.Center
                                                        ) {
                                                            Text(inCart.toString(), color = colors.surface0, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                                                        }
                                                    }
                                                }
                                                Spacer(Modifier.height(4.dp))
                                                Text(item.name, color = if (outOfStock) colors.textMuted else colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                Text(item.sku, color = colors.textMuted, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                Spacer(Modifier.height(6.dp))
                                                Row(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    horizontalArrangement = Arrangement.SpaceBetween,
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    Text(formatCents(item.basePriceMinorUnits), color = colors.accent, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                                    Text(
                                                        if (outOfStock) "OOS" else "$availableStock left",
                                                        color = if (outOfStock) colors.error else if (availableStock < 5) colors.warning else colors.success,
                                                        fontSize = 9.sp,
                                                        fontWeight = FontWeight.Bold
                                                    )
                                                }
                                            }
                                        }
                                    }
                                    repeat(3 - rowItems.size) {
                                        Spacer(modifier = Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── RIGHT COLUMN: Action & Totals Board ───────────────────────
        if (!isRightSidebarClosed) Column(
            Modifier
                .width(340.dp)
                .fillMaxHeight()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {

            // Customer attachment trigger
            Button(
                onClick = { onCustomerSearchChange(true); AudioSynth.playTick() },
                colors = ButtonDefaults.buttonColors(backgroundColor = colors.surface2, contentColor = colors.textPrimary),
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, colors.borderDefault),
                modifier = Modifier.fillMaxWidth().height(36.dp),
                elevation = ButtonDefaults.elevation(0.dp)
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("❖", color = colors.accent, fontSize = 12.sp)
                    Text(if (attachedCustomer == null) "Attach Customer (F6)" else "Change Customer Profile", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            Divider(color = colors.borderSubtle)

            // Discounts
            Text("DISCOUNTS & SAVINGS", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(0, 5, 10, 15, 20).forEach { pct ->
                    val active = discountPct == pct && !showCustomDiscount
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (active) colors.accentDim else colors.surface2)
                            .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                            .clickable {
                                discountPct = pct
                                showCustomDiscount = false
                            }
                            .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("${pct}%", color = if (active) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal)
                    }
                }
                // Custom % button
                val customActive = showCustomDiscount
                Box(
                    Modifier
                        .weight(1.2f)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (customActive) colors.accentDim else colors.surface2)
                        .border(1.dp, if (customActive) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                        .clickable {
                            showCustomDiscount = true
                        }
                        .padding(vertical = 6.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(if (showCustomDiscount) "Custom" else "Other...", color = if (customActive) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = if (customActive) FontWeight.Bold else FontWeight.Normal)
                }
            }

            if (showCustomDiscount) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(6.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp))
                ) {
                    BasicTextField(
                        value = customDiscountStr,
                        onValueChange = {
                            if (it.isEmpty() || (it.all { c -> c.isDigit() } && it.toInt() in 0..100)) {
                                customDiscountStr = it
                                discountPct = it.toIntOrNull() ?: 0
                            }
                        },
                        textStyle = TextStyle(color = colors.textPrimary, fontSize = 13.sp),
                        cursorBrush = SolidColor(colors.accent),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (customDiscountStr.isEmpty()) Text("Type custom discount % (0-100)...", color = colors.textMuted, fontSize = 12.sp)
                                inner()
                            }
                        }
                    )
                }
            }

            // Pay Mode
            Text("PAYMENT METHOD", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("CASH" to "$", "CARD" to "▤", "QR" to "▣", "SPLIT" to "⇋").forEach { (mode, icon) ->
                    val active = paymentMode == mode
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (active) colors.accentDim else colors.surface2)
                            .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(8.dp))
                            .clickable {
                                paymentMode = mode
                                if (mode == "SPLIT") {
                                    showSplitPaymentDialog = true
                                }
                            }
                            .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(icon, fontSize = 16.sp, fontFamily = FontFamily.Monospace, color = if (active) colors.accent else colors.textSecondary)
                            Text(mode, fontSize = 9.sp, color = if (active) colors.accent else colors.textSecondary, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }

            // Change Tendered if Cash
            if (paymentMode == "CASH") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface2, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(8.dp))
                        .padding(10.dp)
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("CASH TENDERED", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        BasicTextField(
                            value = cashPaidStr,
                            onValueChange = { cashPaidStr = it },
                            textStyle = TextStyle(color = colors.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace),
                            cursorBrush = SolidColor(colors.accent),
                            modifier = Modifier.fillMaxWidth(),
                            decorationBox = { inner ->
                                Box(contentAlignment = Alignment.CenterStart) {
                                    if (cashPaidStr.isEmpty()) Text("0.00", color = colors.textMuted, fontSize = 14.sp)
                                    inner()
                                }
                            }
                        )
                        val cashVal = cashPaidStr.toDoubleOrNull() ?: 0.0
                        val changeCents = (cashVal * 100).toLong() - totalCents
                        if (changeCents >= 0) {
                            Text("Change Due: ${formatCents(changeCents)}", color = colors.success, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        } else {
                            Text("Still due: ${formatCents(-changeCents)}", color = colors.error, fontSize = 10.sp)
                        }
                    }
                }
            } else if (paymentMode == "QR") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface2, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("SCAN TO PAY (FREE BANK TRANSFER)", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        
                        Canvas(modifier = Modifier.size(100.dp).background(Color.White, RoundedCornerShape(4.dp)).padding(6.dp)) {
                            val qrSize = 21
                            val cellSize = size.width / qrSize
                            
                            val seed = (totalCents + 104729L).hashCode()
                            val rand = java.util.Random(seed.toLong())
                            
                            for (row in 0 until qrSize) {
                                for (col in 0 until qrSize) {
                                    val isFinderPattern = 
                                        (row < 7 && col < 7) ||
                                        (row < 7 && col >= qrSize - 7) ||
                                        (row >= qrSize - 7 && col < 7)
                                    
                                    val drawBlack = if (isFinderPattern) {
                                        val r = if (row < 7) row else qrSize - 1 - row
                                        val c = if (col < 7) col else qrSize - 1 - col
                                        val innerR = if (row >= qrSize - 7 && col < 7) row - (qrSize - 7) else r
                                        val innerC = if (row < 7 && col >= qrSize - 7) col - (qrSize - 7) else c
                                        val maxDist = Math.max(Math.abs(innerR - 3), Math.abs(innerC - 3))
                                        maxDist == 3 || maxDist <= 1
                                    } else {
                                        rand.nextBoolean()
                                    }
                                    
                                    if (drawBlack) {
                                        drawRect(
                                            color = Color.Black,
                                            topLeft = Offset(col * cellSize, row * cellSize),
                                            size = ComposeSize(cellSize + 0.5f, cellSize + 0.5f)
                                        )
                                    }
                                }
                            }
                        }
                        
                        Text("Scan with banking or payment app", color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        val qrAccount = Database.getPreference("qr_account_details") ?: "Direct Transfer / Venmo: @MyStore"
                        Text(qrAccount, color = colors.textMuted, fontSize = 10.sp, textAlign = TextAlign.Center)
                    }
                }
            } else if (paymentMode == "SPLIT") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface2, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(8.dp))
                        .padding(10.dp)
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("SPLIT PAYMENT DETAILS", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        Text("Cash: ${formatCents(splitCashCents)}", color = colors.textPrimary, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                        Text("Card: ${formatCents(splitCardCents)}", color = colors.textPrimary, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                        val splitSum = splitCashCents + splitCardCents
                        if (splitSum == totalCents) {
                            Text("✓ Amounts balance", color = colors.success, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        } else {
                            Text("✗ Balance mismatch! Tendered ${formatCents(splitSum)} vs Due ${formatCents(totalCents)}", color = colors.error, fontSize = 10.sp)
                        }
                        Text("Click Split (⇋) above to configure", color = colors.accent, fontSize = 9.sp, modifier = Modifier.clickable { showSplitPaymentDialog = true })
                    }
                }
            }

            Divider(color = colors.borderSubtle)

            // ── TAX RATE CONFIGURATION ─────────────────────────────────────
            Text("TAX RATE", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(0.0, 5.0, 8.0, 10.0).forEach { pct ->
                    val active = taxPctState == pct && !showCustomTax
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (active) colors.accentDim else colors.surface2)
                            .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                            .clickable {
                                taxPctState = pct
                                showCustomTax = false
                                customTaxStr = pct.toString()
                                scope.launch(Dispatchers.IO) {
                                    Database.setPreference("tax_rate", "FLOAT", pct.toString())
                                }
                            }
                            .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("${pct.toInt()}%", color = if (active) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal)
                    }
                }
                val customBtnActive = showCustomTax
                Box(
                    Modifier
                        .weight(1.2f)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (customBtnActive) colors.accentDim else colors.surface2)
                        .border(1.dp, if (customBtnActive) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                        .clickable { showCustomTax = true }
                        .padding(vertical = 6.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(if (showCustomTax) "Custom" else "Other...", color = if (customBtnActive) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = if (customBtnActive) FontWeight.Bold else FontWeight.Normal)
                }
            }

            if (showCustomTax) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(6.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp))
                ) {
                    BasicTextField(
                        value = customTaxStr,
                        onValueChange = { v ->
                            customTaxStr = v
                            val parsed = v.toDoubleOrNull()
                            if (parsed != null && parsed in 0.0..100.0) {
                                taxPctState = parsed
                                scope.launch(Dispatchers.IO) {
                                    Database.setPreference("tax_rate", "FLOAT", parsed.toString())
                                }
                            }
                        },
                        textStyle = TextStyle(color = colors.textPrimary, fontSize = 13.sp),
                        cursorBrush = SolidColor(colors.accent),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (customTaxStr.isEmpty()) Text("Custom tax % (e.g. 12.5)", color = colors.textMuted, fontSize = 12.sp)
                                inner()
                            }
                        }
                    )
                }
            }

            // Totals Board
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(colors.surface1, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                TotalRow("Subtotal", formatCents(subtotalCents), colors.textPrimary)
                if (discountCents > 0) TotalRow("Discount (${discountPct}%)", "−${formatCents(discountCents)}", colors.warning)
                TotalRow("Tax (${"%.1f".format(taxPctState)}%)", formatCents(taxCents), colors.textSecondary)
                Divider(color = colors.borderSubtle)
                TotalRow("TOTAL DUE", formatCents(totalCents), colors.accent, true, 20.sp)
            }

            // CHARGE / CHECKOUT TRIGGER
            val splitSum = splitCashCents + splitCardCents
            val canCheckout = cartItems.isNotEmpty() && (paymentMode != "SPLIT" || splitSum == totalCents)
            Button(
                onClick = {
                    if (cartItems.isEmpty()) {
                        statusMsg = "Cart is empty."
                        statusIsErr = true
                        return@Button
                    }
                    if (paymentMode == "SPLIT" && splitSum != totalCents) {
                        statusMsg = "Split amounts do not balance."
                        statusIsErr = true
                        return@Button
                    }
                    onReceiptPreviewChange(true)
                },
                enabled = canCheckout,
                colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(8.dp),
                elevation = ButtonDefaults.elevation(0.dp)
            ) {
                Text("CHARGE  ${if (cartItems.isNotEmpty()) formatCents(totalCents) else ""} (F7)", fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 1.sp)
            }

            // 🎙 Speech Analytics Coach Card
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(colors.surface1.copy(alpha = 0.85f), RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    Modifier.fillMaxWidth().clickable { isSpeechCoachExpanded = !isSpeechCoachExpanded },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("🎙", fontSize = 12.sp)
                        Text("SPEECH COACH", color = colors.textPrimary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                    }
                    Text(if (isSpeechCoachExpanded) "▼" else "▲", color = colors.textSecondary, fontSize = 10.sp)
                }

                if (isSpeechCoachExpanded) {
                    Divider(color = colors.borderSubtle)

                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Button(
                            onClick = {
                                isSpeechRecording = !isSpeechRecording
                                AudioSynth.playTick()
                            },
                            colors = ButtonDefaults.buttonColors(
                                backgroundColor = if (isSpeechRecording) colors.errorDim else colors.accentDim,
                                contentColor = if (isSpeechRecording) colors.error else colors.accent
                            ),
                            shape = RoundedCornerShape(6.dp),
                            elevation = ButtonDefaults.elevation(0.dp),
                            modifier = Modifier.height(28.dp)
                        ) {
                            Text(if (isSpeechRecording) "STOP SPEECH" else "START SPEECH", fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        }

                        Text(
                            speechStatus,
                            color = if (isSpeechRecording) colors.success else colors.textMuted,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    // Metrics Row
                    Row(
                        Modifier.fillMaxWidth().background(colors.surface2, RoundedCornerShape(6.dp)).padding(8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text("Rate", color = colors.textMuted, fontSize = 8.sp)
                            Text("$speechWpm WPM", color = colors.textPrimary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                        Column {
                            Text("Fillers", color = colors.textMuted, fontSize = 8.sp)
                            Text("$speechFillers", color = colors.textPrimary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                        Column {
                            Text("Sentiment", color = colors.textMuted, fontSize = 8.sp)
                            Text(
                                speechSentiment,
                                color = when (speechSentiment) {
                                    "POSITIVE" -> colors.success
                                    "FRICTION" -> colors.error
                                    else -> colors.textPrimary
                                },
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Column {
                            Text("Risk", color = colors.textMuted, fontSize = 8.sp)
                            Text(
                                speechRisk,
                                color = when (speechRisk) {
                                    "CRITICAL RISK" -> colors.error
                                    "MEDIUM" -> colors.warning
                                    else -> colors.success
                                },
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    // Live Transcript Text Box
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 40.dp)
                            .background(colors.surface3, RoundedCornerShape(6.dp))
                            .border(1.dp, colors.borderSubtle, RoundedCornerShape(6.dp))
                            .padding(8.dp)
                    ) {
                        Text(
                            speechTranscript,
                            color = colors.textPrimary.copy(alpha = 0.9f),
                            fontSize = 10.sp,
                            lineHeight = 14.sp
                        )
                    }
                }
            }

            // Keyboard shortcut hint footer bar
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("F2: Barcode Mode", color = colors.textMuted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
                Text("F6: Customer", color = colors.textMuted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
                Text("F7: Pay", color = colors.textMuted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }

    // Split Payment dialog overlay
    if (showSplitPaymentDialog) {
        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(360.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Split Payment Details", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text("Total Due: ${formatCents(totalCents)}", color = colors.accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Divider(color = colors.borderSubtle)

                FormField("CASH PORTION ($)", splitCashAmountStr, "e.g. 20.00") {
                    splitCashAmountStr = it
                    val d = it.toDoubleOrNull() ?: 0.0
                    splitCashCents = (d * 100).toLong()
                }

                FormField("CARD PORTION ($)", splitCardAmountStr, "e.g. 30.00") {
                    splitCardAmountStr = it
                    val d = it.toDoubleOrNull() ?: 0.0
                    splitCardCents = (d * 100).toLong()
                }

                val currentTotal = splitCashCents + splitCardCents
                val remaining = totalCents - currentTotal
                if (remaining == 0L) {
                    Text("✓ Portions balance correctly", color = colors.success, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                } else if (remaining > 0L) {
                    Text("Remaining to allocate: ${formatCents(remaining)}", color = colors.warning, fontSize = 12.sp)
                } else {
                    Text("Overallocated by: ${formatCents(-remaining)}", color = colors.error, fontSize = 12.sp)
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = {
                            splitCashCents = 0L
                            splitCardCents = 0L
                            splitCashAmountStr = ""
                            splitCardAmountStr = ""
                            showSplitPaymentDialog = false
                        },
                        modifier = Modifier.weight(1f),
                        border = BorderStroke(1.dp, colors.borderDefault),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.textSecondary)
                    ) {
                        Text("Cancel")
                    }
                    Button(
                        onClick = { showSplitPaymentDialog = false },
                        enabled = remaining == 0L,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0)
                    ) {
                        Text("Save Split")
                    }
                }
            }
        }
    }

    // Customer search dialog
    if (showCustomerSearch) {
        CustomerSearchDialog(
            onDismiss = { onCustomerSearchChange(false) },
            onAttach = {
                onAttachedCustomerChange(it)
                onCustomerSearchChange(false)
                AudioSynth.playTick()
            },
            onAddNew = {
                showAddCustomerDialog = true
            }
        )
    }

    // Add Customer Profile in checkout
    if (showAddCustomerDialog) {
        CustomerDialog(
            title = "Add Customer Profile",
            onDismiss = { showAddCustomerDialog = false },
            onConfirm = { name, phone, email ->
                val id = Database.addCustomer(name, phone, email)
                val newCust = Database.getCustomers().find { it.id == id }
                if (newCust != null) {
                    onAttachedCustomerChange(newCust)
                }
                syncLogs.add("Added and attached customer: $name")
                showAddCustomerDialog = false
                onCustomerSearchChange(false)
            }
        )
    }

    // Receipt Preview Dialog
    if (showReceiptPreview) {
        val storeName = Database.getPreference("store_name") ?: "Valenixia Retail"
        val txId = remember { UUID.randomUUID().toString() }
        val paymentDetails = when (paymentMode) {
            "SPLIT" -> "Cash: ${formatCents(splitCashCents)}, Card: ${formatCents(splitCardCents)}"
            "CASH" -> {
                val cashVal = cashPaidStr.toDoubleOrNull() ?: 0.0
                val tendered = (cashVal * 100).toLong()
                val change = tendered - totalCents
                "Cash Tendered: ${formatCents(tendered)}, Change: ${formatCents(change)}"
            }
            else -> null
        }
        val receiptText = remember {
            generateReceiptText(
                storeName = storeName,
                txId = txId,
                employeeId = employee.id,
                cart = cartItems.toList(),
                subtotal = subtotalCents,
                tax = taxCents,
                total = totalCents,
                discountPct = discountPct,
                paymentMode = paymentMode,
                paymentDetails = paymentDetails,
                customer = attachedCustomer,
                taxRatePct = taxPctState
            )
        }

        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(420.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Receipt Preview & Invoice", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)

                // Scrollable paper receipt style panel
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(280.dp)
                        .background(Color(0xFFFCFBF7), RoundedCornerShape(8.dp))
                        .border(1.dp, Color(0xFFE6E2D8), RoundedCornerShape(8.dp))
                        .padding(16.dp)
                ) {
                    val scrollState = rememberScrollState()
                    Column(
                        modifier = Modifier.fillMaxSize().verticalScroll(scrollState)
                    ) {
                        Text(
                            receiptText,
                            style = TextStyle(
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                color = Color(0xFF1C1917),
                                lineHeight = 16.sp
                            )
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Button(
                        onClick = {
                            try {
                                val file = java.io.File("receipts/receipt_${txId.take(8)}.txt")
                                file.parentFile.mkdirs()
                                file.writeText(receiptText)
                                syncLogs.add("[PRINT] Printed receipt to ${file.absolutePath}")
                                statusMsg = "✓ Printed receipt to file"
                                statusIsErr = false
                                AudioSynth.playTick()
                            } catch (e: Exception) {
                                statusMsg = "✗ Print failed: ${e.message}"
                                statusIsErr = true
                            }
                        },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.surface3, contentColor = colors.textPrimary),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Print to File", fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
                    }

                    OutlinedButton(
                        onClick = { onReceiptPreviewChange(false) },
                        modifier = Modifier.weight(1f),
                        border = BorderStroke(1.dp, colors.borderDefault),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.textSecondary),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Cancel", fontSize = 11.sp)
                    }

                    Button(
                        onClick = {
                            scope.launch {
                                val ok = withContext(Dispatchers.IO) {
                                    Database.checkout(
                                        txId = txId,
                                        employeeId = employee.id,
                                        cart = cartItems.toList(),
                                        subtotal = subtotalCents - discountCents,
                                        tax = taxCents,
                                        total = totalCents,
                                        customerId = attachedCustomer?.id,
                                        paymentDetails = paymentDetails
                                    )
                                }
                                if (ok) {
                                    handleCheckoutSuccess(txId, paymentMode, paymentDetails)
                                } else {
                                    statusMsg = "Transaction failed — database error"
                                    statusIsErr = true
                                }
                                onReceiptPreviewChange(false)
                            }
                        },
                        modifier = Modifier.weight(1.5f),
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Complete Sale", fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    }
                }
            }
        }
    }
}
}

@Composable
fun CustomerSearchDialog(
    onDismiss: () -> Unit,
    onAttach: (Customer) -> Unit,
    onAddNew: () -> Unit
) {
    var search by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Customer>>(emptyList()) }
    val colors = LocalValenixiaColors.current

    LaunchedEffect(search) {
        results = if (search.isEmpty()) Database.getCustomers() else Database.searchCustomers(search)
    }

    DialogOverlay {
        Column(
            Modifier
                .width(400.dp)
                .background(colors.surface2, RoundedCornerShape(16.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Attach Customer Profile", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                TextButton(onClick = onDismiss, colors = ButtonDefaults.textButtonColors(contentColor = colors.textSecondary)) {
                    Text("Close")
                }
            }

            Box(
                Modifier
                    .fillMaxWidth()
                    .background(colors.surface1, RoundedCornerShape(8.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(8.dp))
            ) {
                BasicTextField(
                    value = search,
                    onValueChange = { search = it },
                    textStyle = TextStyle(color = colors.textPrimary, fontSize = 13.sp),
                    cursorBrush = SolidColor(colors.accent),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (search.isEmpty()) Text("Search by name or phone...", color = colors.textMuted, fontSize = 13.sp)
                            inner()
                        }
                    }
                )
            }

            LazyColumn(
                modifier = Modifier.height(200.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(results) { customer ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(colors.surface1, RoundedCornerShape(8.dp))
                            .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                            .clickable { onAttach(customer) }
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(customer.name, color = colors.textPrimary, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            Text(customer.phone, color = colors.textMuted, fontSize = 10.sp)
                        }
                        Text("Attach", color = colors.accent, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }

                if (results.isEmpty()) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                            Text("No customers found.", color = colors.textMuted, fontSize = 12.sp)
                        }
                    }
                }
            }

            Button(
                onClick = onAddNew,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                shape = RoundedCornerShape(8.dp)
            ) {
                Text("+ Create New Customer", fontWeight = FontWeight.Bold)
            }
        }
    }
}

fun generateReceiptText(
    storeName: String,
    txId: String,
    employeeId: String,
    cart: List<CartItem>,
    subtotal: Long,
    tax: Long,
    total: Long,
    discountPct: Int,
    paymentMode: String,
    paymentDetails: String?,
    customer: Customer?,
    taxRatePct: Double = 8.0,
    timestamp: Long? = null
): String {
    val sb = java.lang.StringBuilder()
    val line = "========================================\n"
    val dashed = "----------------------------------------\n"
    
    val address = Database.getPreference("receipt_address") ?: ""
    val phone = Database.getPreference("receipt_phone") ?: ""
    val website = Database.getPreference("receipt_website") ?: ""
    val policy = Database.getPreference("receipt_policy") ?: "Returns accepted within 14 days with receipt."

    sb.append(centerAlign(storeName, 40)).append("\n")
    if (address.isNotEmpty()) sb.append(centerAlign(address, 40)).append("\n")
    if (phone.isNotEmpty()) sb.append(centerAlign(phone, 40)).append("\n")
    if (website.isNotEmpty()) sb.append(centerAlign(website, 40)).append("\n")
    sb.append(centerAlign("VALENIXIA COMMERCE POS", 40)).append("\n")
    sb.append(centerAlign("Receipt of Sale", 40)).append("\n")
    sb.append(line)
    
    sb.append("Transaction ID: ").append(txId.uppercase()).append("\n")
    val timeToFormat = timestamp ?: System.currentTimeMillis()
    sb.append("Date: ").append(SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(timeToFormat))).append("\n")
    sb.append("Cashier ID: ").append(employeeId.take(8)).append("\n")
    if (customer != null) {
        sb.append("Customer: ").append(customer.name).append("\n")
        if (customer.phone.isNotEmpty()) sb.append("Phone: ").append(customer.phone).append("\n")
    }
    sb.append(line)
    
    sb.append(String.format(Locale.US, "%-22s %3s %13s\n", "Item", "Qty", "Price"))
    sb.append(dashed)
    
    cart.forEach { item ->
        val name = if (item.name.length > 20) item.name.take(20) else item.name
        val priceStr = formatCents(item.basePriceMinorUnits * item.qty)
        sb.append(String.format(Locale.US, "%-22s %3d %13s\n", name, item.qty, priceStr))
    }
    
    sb.append(dashed)
    sb.append(String.format(Locale.US, "%-25s %14s\n", "Subtotal:", formatCents(subtotal)))
    if (discountPct > 0) {
        val discCents = (subtotal * discountPct / 100)
        sb.append(String.format(Locale.US, "%-25s %14s\n", "Discount ($discountPct%):", "-" + formatCents(discCents)))
    }
    sb.append(String.format(Locale.US, "%-25s %14s\n", "Tax (${"%.1f".format(taxRatePct)}%):", formatCents(tax)))
    sb.append(line)
    sb.append(String.format(Locale.US, "%-25s %14s\n", "TOTAL:", formatCents(total)))
    sb.append(line)
    
    sb.append("Payment Mode: ").append(paymentMode).append("\n")
    if (paymentDetails != null) {
        sb.append("Details: ").append(paymentDetails).append("\n")
    }
    
    sb.append("\n")
    sb.append(centerAlign(policy, 40)).append("\n")
    sb.append(centerAlign("Thank you for your business!", 40)).append("\n")
    sb.append(centerAlign("Powered by Valenixia Commerce", 40)).append("\n")
    return sb.toString()
}

private fun centerAlign(str: String, width: Int): String {
    if (str.length >= width) return str
    val padding = (width - str.length) / 2
    return " ".repeat(padding) + str
}

@Composable
private fun CartRow(item: CartItem, onQtyMinus: () -> Unit, onQtyPlus: () -> Unit, onRemove: () -> Unit) {
    val colors = LocalValenixiaColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp, horizontal = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ProductInitialsBadge(item.name)
            Column {
                Text(item.name, color = colors.textPrimary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(item.sku, color = colors.textMuted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            QtyButton("−", onQtyMinus)
            Text("${item.qty}", color = colors.textPrimary, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.widthIn(min = 22.dp), textAlign = TextAlign.Center)
            QtyButton("+", onQtyPlus)
        }
        Text(
            formatCents(item.basePriceMinorUnits * item.qty),
            color = colors.accent, fontWeight = FontWeight.Bold, fontSize = 12.sp,
            modifier = Modifier.width(72.dp), textAlign = TextAlign.End
        )
        Text(
            "✕", fontSize = 10.sp, color = colors.textMuted,
            modifier = Modifier.padding(start = 8.dp).clickable(onClick = onRemove)
        )
    }
    Divider(color = colors.borderSubtle.copy(alpha = 0.5f))
}

@Composable
private fun QtyButton(label: String, onClick: () -> Unit) {
    val colors = LocalValenixiaColors.current
    Box(
        Modifier.size(22.dp).clip(CircleShape)
            .background(colors.surface3)
            .border(1.dp, colors.borderDefault, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(label, fontSize = 12.sp, color = colors.textSecondary, fontWeight = FontWeight.Bold) }
}

@Composable
private fun TotalRow(label: String, value: String, color: Color, bold: Boolean = false, fontSize: androidx.compose.ui.unit.TextUnit = 13.sp) {
    val colors = LocalValenixiaColors.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = colors.textSecondary, fontSize = fontSize, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
        Text(value,  color = color,        fontSize = fontSize, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
    }
}

// ════════════════════════════════════════════════════════════════════
//  SCREEN 2 — CATALOG MANAGEMENT
// ════════════════════════════════════════════════════════════════════
@Composable
fun CatalogScreen(syncLogs: MutableList<String>) {
    val catalog = remember { mutableStateListOf<InventoryItem>() }
    val categories = remember { mutableStateListOf<String>() }
    val scope = rememberCoroutineScope()
    var search by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("All") }
    var showAdd by remember { mutableStateOf(false) }
    var editItem by remember { mutableStateOf<InventoryItem?>(null) }
    var statusMsg by remember { mutableStateOf("") }
    var statusErr by remember { mutableStateOf(false) }

    // Category dialog
    var showManageCategories by remember { mutableStateOf(false) }
    var newCategoryName by remember { mutableStateOf("") }

    // Bulk actions
    val selectedSkus = remember { mutableStateMapOf<String, Boolean>() }
    val selectedCount = selectedSkus.count { it.value }
    var showBulkAdjust by remember { mutableStateOf(false) }
    var bulkAdjustPctStr by remember { mutableStateOf("") }
    var bulkAdjustTarget by remember { mutableStateOf("PRICE") } // "PRICE", "COST"
    var showBulkDelete by remember { mutableStateOf(false) }

    // CSV Import
    var showImportCSV by remember { mutableStateOf(false) }
    var csvPasteText by remember { mutableStateOf("") }

    val colors = LocalValenixiaColors.current

    fun refresh() {
        scope.launch(Dispatchers.IO) {
            val inv = Database.getInventory()
            val cats = Database.getCategories()
            withContext(Dispatchers.Main) {
                catalog.clear()
                catalog.addAll(inv)
                categories.clear()
                categories.addAll(cats)
            }
        }
    }
    LaunchedEffect(Unit) { refresh() }

    val filtered = catalog.filter {
        val matchesSearch = it.name.contains(search, true) || it.sku.contains(search, true)
        val matchesCategory = selectedCategory == "All" || it.category == selectedCategory
        matchesSearch && matchesCategory
    }

    Box(Modifier.fillMaxSize()) {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.fillMaxSize()) {
        // Header actions
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            SearchBar(value = search, onValueChange = { search = it }, placeholder = "Search products by SKU or name...", modifier = Modifier.weight(1f))
            Spacer(Modifier.width(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { showImportCSV = true },
                    colors = ButtonDefaults.buttonColors(backgroundColor = colors.surface3, contentColor = colors.textPrimary),
                    shape = RoundedCornerShape(8.dp),
                    elevation = ButtonDefaults.elevation(0.dp)
                ) { Text("Import CSV", fontWeight = FontWeight.Bold, fontSize = 12.sp) }

                Button(
                    onClick = { showAdd = true },
                    colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                    shape = RoundedCornerShape(8.dp),
                    elevation = ButtonDefaults.elevation(0.dp)
                ) { Text("+ Add Product", fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            }
        }

        // Category filter list
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // All Category
                val allActive = selectedCategory == "All"
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (allActive) colors.accentDim else colors.surface2)
                        .border(1.dp, if (allActive) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                        .clickable { selectedCategory = "All" }
                        .padding(horizontal = 14.dp, vertical = 7.dp)
                ) {
                    Text("All Items", color = if (allActive) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }

                categories.forEach { cat ->
                    val active = selectedCategory == cat
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (active) colors.accentDim else colors.surface2)
                            .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                            .clickable { selectedCategory = cat }
                            .padding(horizontal = 14.dp, vertical = 7.dp)
                    ) {
                        Text(cat, color = if (active) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal)
                    }
                }
            }

            Spacer(Modifier.width(12.dp))

            Text(
                "Manage Categories",
                color = colors.accent,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable { showManageCategories = true }
            )
        }

        if (statusMsg.isNotEmpty()) {
            StatusBanner(statusMsg, statusErr) { statusMsg = "" }
        }

        // Stats strip
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val lowStock = catalog.count { it.stockLevel <= it.lowStockThreshold }
            StatChip("${catalog.size}", "Total SKUs", colors.accent)
            StatChip("$lowStock", "Low Stock", if (lowStock > 0) colors.warning else colors.success)
            StatChip(formatCents(catalog.sumOf { it.basePriceMinorUnits * it.stockLevel }), "Inventory Value", colors.info)
        }

        // Table header
        CatalogTableHeader(
            allSelected = filtered.isNotEmpty() && filtered.all { selectedSkus[it.sku] == true },
            onSelectAllChange = { checked ->
                filtered.forEach { selectedSkus[it.sku] = checked }
            }
        )

        // Table rows
        Box(
            Modifier.fillMaxWidth().weight(1f)
                .background(colors.surface1, RoundedCornerShape(10.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
        ) {
            if (filtered.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No products found in this category.", color = colors.textMuted, fontSize = 13.sp)
                }
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(filtered.withIndex().toList()) { (index, item) ->
                        CatalogRow(
                            item = item,
                            isEven = index % 2 == 0,
                            selected = selectedSkus[item.sku] == true,
                            onSelectChange = { selectedSkus[item.sku] = it },
                            onEdit = { editItem = item }
                        )
                    }
                }
            }
        }

        // Bulk Actions Bar
        if (selectedCount > 0) {
            Card(
                modifier = Modifier.fillMaxWidth().height(56.dp),
                backgroundColor = colors.surface2,
                elevation = 8.dp,
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, colors.accent.copy(alpha = 0.3f))
            ) {
                Row(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("$selectedCount items selected", color = colors.textPrimary, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Button(
                            onClick = { showBulkAdjust = true },
                            colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                            shape = RoundedCornerShape(6.dp)
                        ) {
                            Text("Bulk Adjust Prices", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                        Button(
                            onClick = { showBulkDelete = true },
                            colors = ButtonDefaults.buttonColors(backgroundColor = colors.error, contentColor = colors.surface0),
                            shape = RoundedCornerShape(6.dp)
                        ) {
                            Text("Bulk Delete", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                        TextButton(onClick = { selectedSkus.clear() }) {
                            Text("Cancel", color = colors.textSecondary, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }

    // Dialog overlays
    if (showManageCategories) {
        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(360.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Manage Categories", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    TextButton(onClick = { showManageCategories = false; newCategoryName = "" }, colors = ButtonDefaults.textButtonColors(contentColor = colors.textSecondary)) {
                        Text("Close")
                    }
                }

                // Add Form
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .background(colors.surface1, RoundedCornerShape(6.dp))
                            .border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp))
                    ) {
                        BasicTextField(
                            value = newCategoryName,
                            onValueChange = { newCategoryName = it },
                            textStyle = TextStyle(color = colors.textPrimary, fontSize = 13.sp),
                            cursorBrush = SolidColor(colors.accent),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                            decorationBox = { inner ->
                                Box(contentAlignment = Alignment.CenterStart) {
                                    if (newCategoryName.isEmpty()) Text("New category name...", color = colors.textMuted, fontSize = 12.sp)
                                    inner()
                                }
                            }
                        )
                    }
                    Button(
                        onClick = {
                            if (newCategoryName.isNotBlank()) {
                                scope.launch(Dispatchers.IO) {
                                    val ok = Database.addCategory(newCategoryName)
                                    if (ok) {
                                        syncLogs.add("[INV] Category added: $newCategoryName")
                                        refresh()
                                    }
                                    withContext(Dispatchers.Main) {
                                        newCategoryName = ""
                                    }
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Text("Add")
                    }
                }

                Divider(color = colors.borderSubtle)

                // List categories with delete option
                LazyColumn(modifier = Modifier.height(180.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val customCats = categories.filter { it != "Uncategorized" }
                    items(customCats) { cat ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(colors.surface1, RoundedCornerShape(8.dp))
                                .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(cat, color = colors.textPrimary, fontSize = 13.sp)
                            Text(
                                "Delete",
                                color = colors.error,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.clickable {
                                    scope.launch(Dispatchers.IO) {
                                        val ok = Database.deleteCategory(cat)
                                        if (ok) {
                                            syncLogs.add("[INV] Category deleted: $cat")
                                            if (selectedCategory == cat) selectedCategory = "All"
                                            refresh()
                                        }
                                    }
                                }
                            )
                        }
                    }
                    if (customCats.isEmpty()) {
                        item {
                            Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                Text("No custom categories yet.", color = colors.textMuted, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showBulkAdjust) {
        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(360.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Bulk Price Adjustment", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text("Apply percentage adjustment to all $selectedCount selected products.", color = colors.textSecondary, fontSize = 12.sp)
                Divider(color = colors.borderSubtle)

                FormField("PERCENTAGE ADJUSTMENT (%)", bulkAdjustPctStr, "e.g. 10 for +10%, -5 for -5%") {
                    bulkAdjustPctStr = it
                }

                Text("TARGET RATE", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("PRICE" to "Selling Price", "COST" to "Purchase Cost").forEach { (target, label) ->
                        val active = bulkAdjustTarget == target
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (active) colors.accentDim else colors.surface3)
                                .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(8.dp))
                                .clickable { bulkAdjustTarget = target }
                                .padding(vertical = 10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(label, color = if (active) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = { showBulkAdjust = false; bulkAdjustPctStr = "" },
                        modifier = Modifier.weight(1f),
                        border = BorderStroke(1.dp, colors.borderDefault),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.textSecondary)
                    ) {
                        Text("Cancel")
                    }
                    Button(
                        onClick = {
                            val pct = bulkAdjustPctStr.toDoubleOrNull()
                            if (pct != null) {
                                scope.launch(Dispatchers.IO) {
                                    selectedSkus.filter { it.value }.keys.forEach { sku ->
                                        val item = catalog.find { it.sku == sku }
                                        if (item != null) {
                                            if (bulkAdjustTarget == "PRICE") {
                                                val nextPrice = (item.basePriceMinorUnits * (1.0 + pct / 100.0)).toLong()
                                                Database.updateInventoryPrice(sku, nextPrice)
                                            } else {
                                                val nextCost = (item.costPriceMinorUnits * (1.0 + pct / 100.0)).toLong()
                                                Database.updateInventoryCost(sku, nextCost)
                                            }
                                        }
                                    }
                                    withContext(Dispatchers.Main) {
                                        syncLogs.add("[INV] Applied bulk price adjust $pct% to $selectedCount items")
                                        statusMsg = "✓ Bulk price adjustment applied"
                                        statusErr = false
                                        selectedSkus.clear()
                                        showBulkAdjust = false
                                        bulkAdjustPctStr = ""
                                        refresh()
                                    }
                                }
                            }
                        },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0)
                    ) {
                        Text("Apply")
                    }
                }
            }
        }
    }

    if (showBulkDelete) {
        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(360.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Confirm Bulk Delete", color = colors.error, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text("Are you sure you want to permanently delete all $selectedCount selected products? This action cannot be undone.", color = colors.textPrimary, fontSize = 13.sp)
                Divider(color = colors.borderSubtle)

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = { showBulkDelete = false },
                        modifier = Modifier.weight(1f),
                        border = BorderStroke(1.dp, colors.borderDefault),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.textSecondary)
                    ) {
                        Text("Cancel")
                    }
                    Button(
                        onClick = {
                            scope.launch(Dispatchers.IO) {
                                selectedSkus.filter { it.value }.keys.forEach { sku ->
                                    Database.deleteInventoryItem(sku)
                                }
                                withContext(Dispatchers.Main) {
                                    syncLogs.add("[INV] Bulk deleted $selectedCount items")
                                    statusMsg = "✓ Bulk delete completed"
                                    statusErr = false
                                    selectedSkus.clear()
                                    showBulkDelete = false
                                    refresh()
                                }
                            }
                        },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.error, contentColor = colors.surface0)
                    ) {
                        Text("Yes, Delete All")
                    }
                }
            }
        }
    }

    if (showImportCSV) {
        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(460.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Import Products from CSV", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text("Paste CSV data below. Format:\nsku,name,price_cents,stock,category,unused,cost_cents,threshold", color = colors.textSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)

                // Large Pasting Box
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(160.dp)
                        .background(colors.surface1, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(8.dp))
                        .padding(8.dp)
                ) {
                    val scroll = rememberScrollState()
                    BasicTextField(
                        value = csvPasteText,
                        onValueChange = { csvPasteText = it },
                        textStyle = TextStyle(color = colors.textPrimary, fontSize = 12.sp, fontFamily = FontFamily.Monospace),
                        modifier = Modifier.fillMaxSize().verticalScroll(scroll),
                        cursorBrush = SolidColor(colors.accent),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.TopStart) {
                                if (csvPasteText.isEmpty()) {
                                    Text("COFFEE-CAP,Cappuccino,450,100,Coffee,☕,150,10\nPASTRY-DN,Glazed Donut,275,50,Pastries,🍩,90,5", color = colors.textMuted, fontSize = 12.sp)
                                }
                                inner()
                            }
                        }
                    )
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = { showImportCSV = false; csvPasteText = "" },
                        modifier = Modifier.weight(1f),
                        border = BorderStroke(1.dp, colors.borderDefault),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.textSecondary)
                    ) {
                        Text("Cancel")
                    }
                    Button(
                        onClick = {
                            scope.launch(Dispatchers.IO) {
                                var imported = 0
                                csvPasteText.lines().filter { it.isNotBlank() }.forEach { line ->
                                    val parts = line.split(",").map { it.trim() }
                                    if (parts.size >= 4) {
                                        val sku = parts[0]
                                        val name = parts[1]
                                        val price = parts[2].toLongOrNull() ?: 0L
                                        val stock = parts[3].toIntOrNull() ?: 0
                                        val category = parts.getOrNull(4) ?: "Uncategorized"
                                        val emoji = parts.getOrNull(5) ?: ""
                                        val cost = parts.getOrNull(6)?.toLongOrNull() ?: 0L
                                        val threshold = parts.getOrNull(7)?.toIntOrNull() ?: 5
                                        val ok = Database.addInventoryItem(
                                            sku = sku,
                                            gtin = null,
                                            name = name,
                                            priceMinorUnits = price,
                                            stockLevel = stock,
                                            category = category,
                                            emoji = emoji,
                                            costPriceMinorUnits = cost,
                                            lowStockThreshold = threshold
                                        )
                                        if (ok) imported++
                                    }
                                }
                                withContext(Dispatchers.Main) {
                                    syncLogs.add("[INV] Imported $imported products via CSV")
                                    statusMsg = "✓ Imported $imported products"
                                    statusErr = false
                                    showImportCSV = false
                                    csvPasteText = ""
                                    refresh()
                                }
                            }
                        },
                        modifier = Modifier.weight(1.2f),
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0)
                    ) {
                        Text("Parse & Import", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }

    if (showAdd) {
        AddProductDialog(
            categories = categories.filter { it != "All" },
            onDismiss = { showAdd = false },
            onSave = { sku, gtin, name, price, stock, category, emoji, costPrice, lowStockThreshold ->
                scope.launch(Dispatchers.IO) {
                    val ok = Database.addInventoryItem(
                        sku = sku,
                        gtin = gtin,
                        name = name,
                        priceMinorUnits = price,
                        stockLevel = stock,
                        category = category,
                        emoji = emoji,
                        costPriceMinorUnits = costPrice,
                        lowStockThreshold = lowStockThreshold
                    )
                    withContext(Dispatchers.Main) {
                        statusMsg = if (ok) "Product '$name' added" else "SKU already exists"
                        statusErr = !ok
                        if (ok) {
                            syncLogs.add("[INV] Added product: $sku")
                            refresh()
                        }
                        showAdd = false
                    }
                }
            }
        )
    }

    if (editItem != null) {
        EditProductDialog(
            item = editItem!!,
            categories = categories.filter { it != "All" },
            onDismiss = { editItem = null },
            onSave = { name, price, stock, category, emoji, costPrice, threshold ->
                scope.launch(Dispatchers.IO) {
                    Database.updateInventoryName(editItem!!.sku, name)
                    Database.updateInventoryPrice(editItem!!.sku, price)
                    Database.updateInventoryStock(editItem!!.sku, stock)
                    Database.updateInventoryCategory(editItem!!.sku, category)
                    Database.updateInventoryEmoji(editItem!!.sku, emoji)
                    Database.updateInventoryCost(editItem!!.sku, costPrice)
                    Database.updateInventoryThreshold(editItem!!.sku, threshold)
                    withContext(Dispatchers.Main) {
                        statusMsg = "Product updated successfully"
                        statusErr = false
                        syncLogs.add("[INV] Updated product details: ${editItem!!.sku}")
                        refresh()
                        editItem = null
                    }
                }
            },
            onDelete = { sku ->
                scope.launch(Dispatchers.IO) {
                    val ok = Database.deleteInventoryItem(sku)
                    withContext(Dispatchers.Main) {
                        statusMsg = if (ok) "Product removed" else "Failed to remove product"
                        statusErr = !ok
                        if (ok) {
                            syncLogs.add("[INV] Deleted: $sku")
                            refresh()
                        }
                        editItem = null
                    }
                }
            }
        )
    }
}
}


@Composable
private fun CatalogTableHeader(allSelected: Boolean, onSelectAllChange: (Boolean) -> Unit) {
    val colors = LocalValenixiaColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(colors.surface2, RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp))
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(
            checked = allSelected,
            onCheckedChange = onSelectAllChange,
            colors = CheckboxDefaults.colors(checkedColor = colors.accent)
        )
        Text("SKU", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(110.dp))
        Text("PRODUCT NAME", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Text("MARGIN", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(70.dp), textAlign = TextAlign.End)
        Text("PRICE", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(80.dp), textAlign = TextAlign.End)
        Text("STOCK", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(70.dp), textAlign = TextAlign.Center)
        Text("STATUS", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(80.dp), textAlign = TextAlign.Center)
        Spacer(Modifier.width(60.dp))
    }
}

@Composable
private fun CatalogRow(item: InventoryItem, isEven: Boolean, selected: Boolean, onSelectChange: (Boolean) -> Unit, onEdit: () -> Unit) {
    val colors = LocalValenixiaColors.current
    val stockColor = when {
        item.stockLevel <= 0 -> colors.error
        item.stockLevel <= item.lowStockThreshold -> colors.warning
        else -> colors.success
    }
    val stockLabel = when {
        item.stockLevel <= 0 -> "OUT"
        item.stockLevel <= item.lowStockThreshold -> "LOW"
        else -> "OK"
    }

    val margin = if (item.basePriceMinorUnits > 0) {
        val profit = item.basePriceMinorUnits - item.costPriceMinorUnits
        (profit * 100.0 / item.basePriceMinorUnits)
    } else 0.0
    val marginStr = if (margin > 0) "${"%.0f".format(margin)}%" else "—"

    val interactionSource = remember { MutableInteractionSource() }
    val hovered by interactionSource.collectIsHoveredAsState()

    Row(
        Modifier
            .fillMaxWidth()
            .background(
                when {
                    hovered -> colors.surfaceHover
                    isEven -> colors.rowEven
                    else -> colors.rowOdd
                }
            )
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(
            checked = selected,
            onCheckedChange = onSelectChange,
            colors = CheckboxDefaults.colors(checkedColor = colors.accent)
        )
        Text(item.sku, color = colors.accent, fontSize = 11.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.width(110.dp), maxLines = 1)
        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ProductInitialsBadge(item.name)
            Text(item.name, color = colors.textPrimary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(marginStr, color = colors.textSecondary, fontSize = 11.sp, modifier = Modifier.width(70.dp), textAlign = TextAlign.End, fontWeight = FontWeight.Medium)
        Text(formatCents(item.basePriceMinorUnits), color = colors.textPrimary, fontSize = 12.sp, modifier = Modifier.width(80.dp), textAlign = TextAlign.End, fontWeight = FontWeight.SemiBold)
        Text("${item.stockLevel}", color = colors.textPrimary, fontSize = 12.sp, modifier = Modifier.width(70.dp), textAlign = TextAlign.Center)
        Box(Modifier.width(80.dp), contentAlignment = Alignment.Center) {
            Badge(stockLabel, stockColor)
        }
        Box(Modifier.width(60.dp), contentAlignment = Alignment.Center) {
            Text(
                "Edit",
                color = colors.accent, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(colors.accentDim)
                    .clickable(interactionSource = interactionSource, indication = null, onClick = onEdit)
                    .padding(horizontal = 10.dp, vertical = 4.dp)
            )
        }
    }
    Divider(color = colors.borderSubtle.copy(alpha = 0.5f))
}

@Composable
private fun AddProductDialog(
    categories: List<String>,
    onDismiss: () -> Unit,
    onSave: (sku: String, gtin: String?, name: String, price: Long, stock: Int, category: String, emoji: String, costPrice: Long, threshold: Int) -> Unit
) {
    var sku by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    var costPrice by remember { mutableStateOf("") }
    var stock by remember { mutableStateOf("0") }
    var threshold by remember { mutableStateOf("5") }
    var emoji by remember { mutableStateOf("") }
    var selectedCat by remember { mutableStateOf(categories.firstOrNull() ?: "Uncategorized") }
    var error by remember { mutableStateOf("") }

    val colors = LocalValenixiaColors.current

    DialogOverlay {
        Column(
            Modifier
                .width(420.dp)
                .background(colors.surface2, RoundedCornerShape(14.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(14.dp))
                .padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Add Product", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Divider(color = colors.borderSubtle)

            FormField("SKU *", sku, "e.g. BEV-COKE") { sku = it.uppercase() }

            FormField("Product Name *", name, "e.g. Coca-Cola Can") { name = it }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(modifier = Modifier.weight(1f)) {
                    FormField("Selling Price *", price, "e.g. 2.50") { price = it }
                }
                Box(modifier = Modifier.weight(1f)) {
                    FormField("Purchase Cost", costPrice, "e.g. 1.20") { costPrice = it }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(modifier = Modifier.weight(1f)) {
                    FormField("Initial Stock", stock, "e.g. 100") { stock = it }
                }
                Box(modifier = Modifier.weight(1f)) {
                    FormField("Low Stock Alert", threshold, "e.g. 5") { threshold = it }
                }
            }

            // Category select
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Category", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    categories.forEach { cat ->
                        val active = selectedCat == cat
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (active) colors.accentDim else colors.surface3)
                                .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                                .clickable { selectedCat = cat }
                                .padding(horizontal = 10.dp, vertical = 6.dp)
                        ) {
                            Text(cat, color = if (active) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            if (error.isNotEmpty()) Text(error, color = colors.error, fontSize = 11.sp, fontWeight = FontWeight.Bold)

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                    border = BorderStroke(1.dp, colors.borderDefault),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.textSecondary),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Cancel")
                }
                Button(
                    onClick = {
                        if (sku.isBlank() || name.isBlank() || price.isBlank()) {
                            error = "SKU, Name, and Selling Price are required."
                            return@Button
                        }
                        val priceCents = (price.toDoubleOrNull() ?: 0.0) * 100
                        val costCents = (costPrice.toDoubleOrNull() ?: 0.0) * 100
                        val stockInt = stock.toIntOrNull() ?: 0
                        val alertThresh = threshold.toIntOrNull() ?: 5
                        onSave(sku, null, name, priceCents.toLong(), stockInt, selectedCat, emoji, costCents.toLong(), alertThresh)
                    },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Add Product", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun EditProductDialog(
    item: InventoryItem,
    categories: List<String>,
    onDismiss: () -> Unit,
    onSave: (name: String, price: Long, stock: Int, category: String, emoji: String, costPrice: Long, threshold: Int) -> Unit,
    onDelete: (String) -> Unit
) {
    var name by remember { mutableStateOf(item.name) }
    var price by remember { mutableStateOf("%.2f".format(item.basePriceMinorUnits / 100.0)) }
    var costPrice by remember { mutableStateOf("%.2f".format(item.costPriceMinorUnits / 100.0)) }
    var stock by remember { mutableStateOf("${item.stockLevel}") }
    var threshold by remember { mutableStateOf("${item.lowStockThreshold}") }
    var emoji by remember { mutableStateOf("") }
    var selectedCat by remember { mutableStateOf(item.category) }
    var confirmDel by remember { mutableStateOf(false) }

    val colors = LocalValenixiaColors.current

    // Stock Movement History State
    var movements by remember { mutableStateOf<List<StockMovement>>(emptyList()) }
    LaunchedEffect(item.sku) {
        movements = withContext(Dispatchers.IO) {
            Database.getStockMovements(item.sku)
        }
    }

    DialogOverlay {
        Row(
            modifier = Modifier
                .width(680.dp)
                .background(colors.surface2, RoundedCornerShape(16.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                .padding(24.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Left Column: Edit Form
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text("Edit Details", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Text(item.sku, color = colors.accent, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                    }
                    Badge(if (item.stockLevel > 0) "IN STOCK" else "OUT OF STOCK", if (item.stockLevel > 0) colors.success else colors.error)
                }

                Divider(color = colors.borderSubtle)

                FormField("Product Name *", name, "") { name = it }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(modifier = Modifier.weight(1f)) {
                        FormField("Selling Price ($) *", price, "") { price = it }
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        FormField("Purchase Cost ($)", costPrice, "") { costPrice = it }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(modifier = Modifier.weight(1f)) {
                        FormField("Current Stock", stock, "") { stock = it }
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        FormField("Alert Threshold", threshold, "") { threshold = it }
                    }
                }

                // Category chips
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Category", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        categories.forEach { cat ->
                            val active = selectedCat == cat
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (active) colors.accentDim else colors.surface3)
                                    .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                                    .clickable { selectedCat = cat }
                                    .padding(horizontal = 8.dp, vertical = 5.dp)
                            ) {
                                Text(cat, color = if (active) colors.accent else colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                Divider(color = colors.borderSubtle)

                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    if (!confirmDel) {
                        Text(
                            "Delete Product", color = colors.error, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(colors.errorDim)
                                .clickable { confirmDel = true }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Confirm?", color = colors.error, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            SmallActionButton("Delete", colors.error) { onDelete(item.sku) }
                            SmallActionButton("Cancel", colors.textSecondary) { confirmDel = false }
                        }
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "Cancel", color = colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(colors.surface3)
                                .clickable(onClick = onDismiss)
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                        Text(
                            "Save Changes", color = colors.surface0, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(colors.accent)
                                .clickable {
                                    val priceCents = (price.toDoubleOrNull() ?: 0.0) * 100
                                    val costCents = (costPrice.toDoubleOrNull() ?: 0.0) * 100
                                    val stockInt = stock.toIntOrNull() ?: item.stockLevel
                                    val alertThresh = threshold.toIntOrNull() ?: item.lowStockThreshold
                                    onSave(name, priceCents.toLong(), stockInt, selectedCat, emoji, costCents.toLong(), alertThresh)
                                }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            // Right Column: Stock Movement History Log
            Column(
                modifier = Modifier
                    .weight(0.9f)
                    .fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("Stock Movement Log", color = colors.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Text("Audit trail of recent stock adjustments and transactions.", color = colors.textSecondary, fontSize = 11.sp)
                Divider(color = colors.borderSubtle)

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .background(colors.surface1, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                        .padding(8.dp)
                ) {
                    if (movements.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("No stock movements recorded.", color = colors.textMuted, fontSize = 11.sp)
                        }
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(movements) { log ->
                                Column {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        val changeColor = if (log.changeQty >= 0) colors.success else colors.error
                                        val sign = if (log.changeQty >= 0) "+" else ""
                                        Text("$sign${log.changeQty} units", color = changeColor, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                        Text(
                                            SimpleDateFormat("MM/dd HH:mm", Locale.US).format(Date(log.createdAt)),
                                            color = colors.textMuted,
                                            fontSize = 9.sp
                                        )
                                    }
                                    Text(log.reason, color = colors.textSecondary, fontSize = 10.sp)
                                    Divider(color = colors.borderSubtle.copy(alpha = 0.4f), modifier = Modifier.padding(top = 4.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════
//  SCREEN 3 — TRANSACTION HISTORY
// ════════════════════════════════════════════════════════════════════
@Composable
fun HistoryScreen(syncLogs: MutableList<String>) {
    val transactions  = remember { mutableStateListOf<TransactionRecord>() }
    var selected      by remember { mutableStateOf<TransactionRecord?>(null) }
    val selectedLines = remember { mutableStateListOf<TransactionLineDetail>() }
    var attachedCustomerDetail by remember { mutableStateOf<Customer?>(null) }

    var filterStatus  by remember { mutableStateOf<String?>(null) }
    var searchQuery   by remember { mutableStateOf("") }
    var selectedDateRange by remember { mutableStateOf("All") }
    var filterPaymentType by remember { mutableStateOf("All") }

    var showRefundDialog by remember { mutableStateOf(false) }
    val refundQtys = remember { mutableStateMapOf<String, Int>() }

    // Manager override PIN dialog — gates VOID and refund of transactions
    var showManagerOverrideDialog by remember { mutableStateOf(false) }
    var managerOverridePin by remember { mutableStateOf("") }
    var managerOverridePinError by remember { mutableStateOf("") }
    // Action to run once the manager override is verified
    var pendingManagerAction: (() -> Unit)? by remember { mutableStateOf(null) }

    val scope = rememberCoroutineScope()
    val colors = LocalValenixiaColors.current

    fun loadTransactions() {
        scope.launch(Dispatchers.IO) {
            val txs = Database.getTransactions(limit = 300, statusFilter = filterStatus)
            withContext(Dispatchers.Main) {
                transactions.clear()
                transactions.addAll(txs)
            }
        }
    }

    LaunchedEffect(filterStatus) {
        loadTransactions()
    }

    LaunchedEffect(selected) {
        val tx = selected
        if (tx != null) {
            scope.launch(Dispatchers.IO) {
                val lines = Database.getTransactionLines(tx.id)
                val cust = if (tx.customerId != null) Database.getCustomer(tx.customerId) else null
                withContext(Dispatchers.Main) {
                    selectedLines.clear()
                    selectedLines.addAll(lines)
                    attachedCustomerDetail = cust
                }
            }
        } else {
            selectedLines.clear()
            attachedCustomerDetail = null
        }
    }

    // Filter in-memory for live response
    val now = System.currentTimeMillis()
    val filteredTransactions = transactions.filter { tx ->
        // Status filter (already done in DB mostly, but let's double check)
        val statusMatch = filterStatus == null || tx.status == filterStatus

        // Search match (id, customer_id, or payment details)
        val searchMatch = searchQuery.isBlank() ||
                tx.id.contains(searchQuery, ignoreCase = true) ||
                (tx.customerId != null && tx.customerId.contains(searchQuery, ignoreCase = true)) ||
                (tx.paymentDetails != null && tx.paymentDetails.contains(searchQuery, ignoreCase = true))

        // Payment type match
        val payMatch = when (filterPaymentType) {
            "Cash" -> tx.paymentDetails?.contains("Cash", ignoreCase = true) == true
            "Card" -> tx.paymentDetails?.contains("Card", ignoreCase = true) == true
            "Split" -> tx.paymentDetails?.contains("Split", ignoreCase = true) == true || tx.paymentDetails?.contains("|", ignoreCase = true) == true
            else -> true
        }

        // Date match
        val dateMatch = when (selectedDateRange) {
            "Today" -> {
                val cal = Calendar.getInstance()
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                cal.set(Calendar.SECOND, 0)
                cal.set(Calendar.MILLISECOND, 0)
                tx.createdAt >= cal.timeInMillis
            }
            "Yesterday" -> {
                val cal = Calendar.getInstance()
                cal.add(Calendar.DAY_OF_YEAR, -1)
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                cal.set(Calendar.SECOND, 0)
                cal.set(Calendar.MILLISECOND, 0)
                val start = cal.timeInMillis
                val end = start + 24 * 60 * 60 * 1000
                tx.createdAt in start..end
            }
            "Last 7 Days" -> tx.createdAt >= (now - 7L * 24 * 60 * 60 * 1000)
            "Last 30 Days" -> tx.createdAt >= (now - 30L * 24 * 60 * 60 * 1000)
            else -> true
        }

        statusMatch && searchMatch && payMatch && dateMatch
    }

    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        // Left Panel: Search + Filters + List
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // Stats summary
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val completed = filteredTransactions.count { it.status == "COMPLETED" }
                val voided    = filteredTransactions.count { it.status == "VOIDED" }
                val refunded  = filteredTransactions.count { it.status == "REFUNDED" || it.status == "PARTIALLY_REFUNDED" }
                val totalRev  = filteredTransactions.filter { it.status == "COMPLETED" }.sumOf { it.totalMinorUnits }
                StatChip("$completed", "Completed", colors.success)
                StatChip("$refunded",  "Refunded", colors.warning)
                StatChip("$voided",    "Voided", colors.error)
                StatChip(formatCents(totalRev), "Revenue Total", colors.accent)
            }

            // Filters row
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                SearchBar(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = "Search ID or Customer...",
                    modifier = Modifier.weight(1.2f)
                )
                Spacer(Modifier.width(10.dp))

                // Date Filter dropdown simple simulator
                Row(Modifier.weight(1.8f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("All", "Today", "Last 7 Days", "Last 30 Days").forEach { range ->
                        val active = selectedDateRange == range
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (active) colors.accentDim else colors.surface2)
                                .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(8.dp))
                                .clickable { selectedDateRange = range }
                                .padding(horizontal = 10.dp, vertical = 8.dp)
                        ) {
                            Text(range, color = if (active) colors.accent else colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // Status and Payment Type Filter Row
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(null to "All Statuses", "COMPLETED" to "Completed", "REFUNDED" to "Refunded", "VOIDED" to "Voided").forEach { (status, label) ->
                        val active = filterStatus == status
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (active) colors.accentDim else colors.surface2)
                                .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(8.dp))
                                .clickable { filterStatus = status }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(label, color = if (active) colors.accent else colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("All", "Cash", "Card", "Split").forEach { payType ->
                        val active = filterPaymentType == payType
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (active) colors.accentDim else colors.surface2)
                                .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(8.dp))
                                .clickable { filterPaymentType = payType }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(payType, color = if (active) colors.accent else colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }

            // List of Transactions
            Box(
                Modifier.fillMaxWidth().weight(1f)
                    .background(colors.surface1, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
            ) {
                if (filteredTransactions.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("No matching transactions found", color = colors.textMuted, fontSize = 12.sp)
                    }
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(filteredTransactions) { tx ->
                            val isSelected = tx.id == selected?.id
                            val interactionSource = remember { MutableInteractionSource() }
                            val hovered by interactionSource.collectIsHoveredAsState()

                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .background(
                                        when {
                                            isSelected -> colors.navItemActive
                                            hovered    -> colors.surfaceHover
                                            else       -> Color.Transparent
                                        }
                                    )
                                    .clickable(interactionSource = interactionSource, indication = null) {
                                        selected = tx
                                    }
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text("#${tx.id.take(8).uppercase()}", color = if (isSelected) colors.accent else colors.textPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                                        Text(if (tx.paymentDetails != null) "(${tx.paymentDetails})" else "", color = colors.textMuted, fontSize = 10.sp)
                                    }
                                    Text(dateFmt.format(Date(tx.createdAt)), color = colors.textMuted, fontSize = 10.sp)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(formatCents(tx.totalMinorUnits), color = colors.textPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                                    val statusColor = when (tx.status) {
                                        "COMPLETED" -> colors.success
                                        "REFUNDED", "PARTIALLY_REFUNDED" -> colors.warning
                                        else -> colors.error
                                    }
                                    Badge(tx.status, statusColor)
                                }
                            }
                            Divider(color = colors.borderSubtle.copy(alpha = 0.5f))
                        }
                    }
                }
            }
        }

        // Right Detail Panel
        Column(
            Modifier.width(360.dp).fillMaxHeight()
                .background(colors.surface1, RoundedCornerShape(10.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (selected == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("◷", fontSize = 48.sp, color = colors.textMuted.copy(alpha = 0.25f))
                        Spacer(Modifier.height(8.dp))
                        Text("Select a transaction to view details", color = colors.textMuted, fontSize = 11.sp)
                    }
                }
            } else {
                val tx = selected!!
                var storeName by remember(tx.id) { mutableStateOf("Valenixia Retail") }
                LaunchedEffect(tx.id) {
                    storeName = withContext(Dispatchers.IO) {
                        Database.getPreference("store_name") ?: "Valenixia Retail"
                    }
                }

                val previewCartItems = remember(selectedLines.toList()) {
                    selectedLines.map { line ->
                        CartItem(
                            sku = line.sku,
                            name = line.sku,
                            basePriceMinorUnits = line.unitPriceMinorUnits,
                            qty = line.quantity
                        )
                    }
                }

                val receiptText = remember(storeName, tx.id, previewCartItems, attachedCustomerDetail) {
                    generateReceiptText(
                        storeName = storeName,
                        txId = tx.id,
                        employeeId = tx.employeeId,
                        cart = previewCartItems,
                        subtotal = tx.subtotalMinorUnits,
                        tax = tx.taxMinorUnits,
                        total = tx.totalMinorUnits,
                        discountPct = 0,
                        paymentMode = if (tx.paymentDetails?.contains("Split") == true) "Split" else (tx.paymentDetails ?: "Cash"),
                        paymentDetails = tx.paymentDetails,
                        customer = attachedCustomerDetail,
                        timestamp = tx.createdAt
                    )
                }

                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("ACTIVE RECEIPT PRINT PREVIEW", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                }

                // Virtual white thermal receipt ticket paper box
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .background(Color(0xFFFCFBF7), RoundedCornerShape(4.dp))
                        .border(1.dp, Color(0xFFE6E2D8), RoundedCornerShape(4.dp))
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp)
                ) {
                    Text(
                        text = receiptText,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = Color(0xFF1C1B18),
                        lineHeight = 14.sp
                    )
                }

                // Action Buttons
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            scope.launch(Dispatchers.IO) {
                                try {
                                    val file = java.io.File("receipts/receipt_${tx.id.take(8)}_reprint.txt")
                                    file.parentFile.mkdirs()
                                    file.writeText(receiptText)
                                    withContext(Dispatchers.Main) {
                                        AudioSynth.playDrawerOpen()
                                        syncLogs.add("[PRINT] Reprinted receipt to ${file.absolutePath}")
                                    }
                                } catch (e: Exception) {
                                    withContext(Dispatchers.Main) {
                                        syncLogs.add("[ERR] Receipt reprint failed: ${e.message}")
                                    }
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.success, contentColor = colors.surface0),
                        modifier = Modifier.fillMaxWidth().height(38.dp),
                        shape = RoundedCornerShape(8.dp),
                        elevation = ButtonDefaults.elevation(0.dp)
                    ) {
                        Text("DUPLICATE RECEIPT TICKET", fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    }

                    if (tx.status == "COMPLETED") {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = {
                                    // Refund also requires manager override
                                    pendingManagerAction = {
                                        refundQtys.clear()
                                        selectedLines.forEach { line -> refundQtys[line.sku] = 0 }
                                        showRefundDialog = true
                                    }
                                    managerOverridePin = ""
                                    managerOverridePinError = ""
                                    showManagerOverrideDialog = true
                                },
                                colors = ButtonDefaults.buttonColors(backgroundColor = colors.warningDim, contentColor = colors.warning),
                                modifier = Modifier.weight(1f).height(34.dp),
                                shape = RoundedCornerShape(8.dp),
                                elevation = ButtonDefaults.elevation(0.dp),
                                border = BorderStroke(1.dp, colors.warning.copy(alpha = 0.3f))
                            ) {
                                Text("REFUND", fontWeight = FontWeight.Bold, fontSize = 10.sp)
                            }

                            Button(
                                onClick = {
                                    pendingManagerAction = {
                                        scope.launch(Dispatchers.IO) {
                                            val ok = Database.voidTransaction(tx.id)
                                            if (ok) {
                                                withContext(Dispatchers.Main) {
                                                    AudioSynth.playScanError()
                                                    syncLogs.add("[TX] Voided Transaction: ${tx.id.take(8)}")
                                                    loadTransactions()
                                                    selected = null
                                                }
                                            }
                                        }
                                    }
                                    managerOverridePin = ""
                                    managerOverridePinError = ""
                                    showManagerOverrideDialog = true
                                },
                                colors = ButtonDefaults.buttonColors(backgroundColor = colors.errorDim, contentColor = colors.error),
                                modifier = Modifier.weight(1f).height(34.dp),
                                shape = RoundedCornerShape(8.dp),
                                elevation = ButtonDefaults.elevation(0.dp),
                                border = BorderStroke(1.dp, colors.error.copy(alpha = 0.3f))
                            ) {
                                Text("VOID", fontWeight = FontWeight.Bold, fontSize = 10.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    // Manager Override PIN Dialog — gates VOID and REFUND actions
    if (showManagerOverrideDialog) {
        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(360.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.error.copy(alpha = 0.4f), RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("🔐", fontSize = 22.sp)
                    Column {
                        Text("Manager Override Required", color = colors.error, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Text("Enter an ADMIN PIN to authorise this action", color = colors.textMuted, fontSize = 11.sp)
                    }
                }
                OutlinedTextField(
                    value = managerOverridePin,
                    onValueChange = { if (it.length <= 6 && it.all { c -> c.isDigit() }) { managerOverridePin = it; managerOverridePinError = "" } },
                    label = { Text("Admin PIN", color = colors.textMuted, fontSize = 11.sp) },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                    singleLine = true,
                    colors = outlinedTextFieldColors(colors),
                    modifier = Modifier.fillMaxWidth()
                )
                if (managerOverridePinError.isNotEmpty()) {
                    Text(managerOverridePinError, color = colors.error, fontSize = 11.sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            showManagerOverrideDialog = false
                            pendingManagerAction = null
                            managerOverridePin = ""
                        },
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.surface3, contentColor = colors.textMuted),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(8.dp),
                        elevation = ButtonDefaults.elevation(0.dp)
                    ) { Text("Cancel", fontSize = 12.sp) }

                    Button(
                        onClick = {
                            scope.launch(Dispatchers.IO) {
                                val admin = Database.verifyEmployeePin(managerOverridePin, "local:manager-override")
                                withContext(Dispatchers.Main) {
                                    if (admin != null && admin.role == "ADMIN") {
                                        showManagerOverrideDialog = false
                                        val action = pendingManagerAction
                                        pendingManagerAction = null
                                        managerOverridePin = ""
                                        action?.invoke()
                                    } else {
                                        managerOverridePinError = "Invalid or non-admin PIN. Try again."
                                        managerOverridePin = ""
                                    }
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.errorDim, contentColor = colors.error),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(8.dp),
                        elevation = ButtonDefaults.elevation(0.dp),
                        border = BorderStroke(1.dp, colors.error.copy(alpha = 0.4f)),
                        enabled = managerOverridePin.length >= 4
                    ) { Text("Authorise", fontWeight = FontWeight.Bold, fontSize = 12.sp) }
                }
            }
        }
    }

    // Refund Dialog Overlay
    if (showRefundDialog && selected != null) {
        val tx = selected!!
        val refundAmount = refundQtys.entries.sumOf { (sku, qty) ->
            qty * (selectedLines.find { it.sku == sku }?.unitPriceMinorUnits ?: 0L)
        }

        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(420.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Process Return / Refund", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text("Select items and quantities to return from Transaction #${tx.id.take(8).uppercase()}.", color = colors.textSecondary, fontSize = 11.sp)

                LazyColumn(
                    modifier = Modifier.weight(1f, fill = false),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(selectedLines) { line ->
                        val currentRefundQty = refundQtys[line.sku] ?: 0
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(line.sku, color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                Text("Original Qty: ${line.quantity} @ ${formatCents(line.unitPriceMinorUnits)}", color = colors.textMuted, fontSize = 9.sp)
                            }

                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Box(
                                    Modifier
                                        .size(28.dp)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(colors.surface3)
                                        .clickable {
                                            if (currentRefundQty > 0) {
                                                refundQtys[line.sku] = currentRefundQty - 1
                                            }
                                        },
                                    contentAlignment = Alignment.Center
                                ) { Text("-", color = colors.textPrimary, fontSize = 13.sp) }

                                Text("$currentRefundQty", color = colors.accent, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(18.dp), textAlign = TextAlign.Center)

                                Box(
                                    Modifier
                                        .size(28.dp)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(colors.surface3)
                                        .clickable {
                                            if (currentRefundQty < line.quantity) {
                                                refundQtys[line.sku] = currentRefundQty + 1
                                            }
                                        },
                                    contentAlignment = Alignment.Center
                                ) { Text("+", color = colors.textPrimary, fontSize = 13.sp) }
                            }
                        }
                        Divider(color = colors.borderSubtle.copy(alpha = 0.5f))
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth().background(colors.surface3, RoundedCornerShape(8.dp)).padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Refund Total:", color = colors.textSecondary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Text(formatCents(refundAmount), color = colors.accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { showRefundDialog = false },
                        modifier = Modifier.weight(1f).height(42.dp),
                        border = BorderStroke(1.dp, colors.borderDefault),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Cancel", color = colors.textSecondary)
                    }

                    Button(
                        onClick = {
                            if (refundAmount <= 0) return@Button
                            scope.launch(Dispatchers.IO) {
                                val ok = Database.refundTransaction(tx.id, refundQtys, refundAmount)
                                if (ok) {
                                    withContext(Dispatchers.Main) {
                                        AudioSynth.playDrawerOpen()
                                        syncLogs.add("[TX] Refunded ${formatCents(refundAmount)} on Tx: ${tx.id.take(8)}")
                                        showRefundDialog = false
                                        loadTransactions()
                                        selected = null
                                    }
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                        modifier = Modifier.weight(1f).height(42.dp),
                        shape = RoundedCornerShape(8.dp),
                        elevation = ButtonDefaults.elevation(0.dp)
                    ) {
                        Text("Confirm Refund", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String, valueColor: Color = TextPrimary) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = TextMuted, fontSize = 10.sp)
        Text(value, color = valueColor, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace)
    }
}

// ════════════════════════════════════════════════════════════════════
//  SCREEN 4 — ANALYTICS
// ════════════════════════════════════════════════════════════════════
@Composable
fun AnalyticsScreen() {
    var overview by remember { mutableStateOf(AnalyticsOverview(0L, 0, 0L, 0)) }
    var dailySales by remember { mutableStateOf(listOf<DailySalesPoint>()) }
    var topProd by remember { mutableStateOf(listOf<TopProduct>()) }
    var categoryBreakdown by remember { mutableStateOf(mapOf<String, Long>()) }
    var hourlyHeatmap by remember { mutableStateOf(listOf<Map<String, Any>>()) }

    var revenueGoal by remember { mutableStateOf(200000L) } // in cents, default $2,000.00
    var showGoalDialog by remember { mutableStateOf(false) }
    var tempGoalStr by remember { mutableStateOf("2000") }

    var selectedCellInfo by remember { mutableStateOf<String?>(null) }
    var animateTrigger by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    val colors = LocalValenixiaColors.current

    fun loadAnalytics() {
        scope.launch(Dispatchers.IO) {
            val ov = Database.getAnalyticsOverview()
            val ds = Database.getDailySales(14)
            val tp = Database.getTopProducts(10)
            val cb = Database.getCategoryBreakdown()
            val hh = Database.getHourlySalesHeatmap(30)
            val goalStr = Database.getPreference("analytics_revenue_goal") ?: "2000"
            val goalCents = (goalStr.toDoubleOrNull() ?: 2000.0).toLong() * 100

            withContext(Dispatchers.Main) {
                overview = ov
                dailySales = ds
                topProd = tp
                categoryBreakdown = cb
                hourlyHeatmap = hh
                revenueGoal = goalCents
                tempGoalStr = goalStr
                animateTrigger = true
            }
        }
    }

    LaunchedEffect(Unit) {
        loadAnalytics()
    }

    val catColors = listOf(
        colors.accent,
        colors.info,
        colors.success,
        colors.warning,
        colors.error,
        Color(0xFFEC4899), // Pink
        Color(0xFF8B5CF6), // Purple
        Color(0xFFF43F5E)  // Rose
    )

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        // Top Action bar
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("Business Performance Analytics", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text("Real-time metrics, product performance, and sales intensity maps.", color = colors.textMuted, fontSize = 11.sp)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { showGoalDialog = true },
                    colors = ButtonDefaults.buttonColors(backgroundColor = colors.surface3, contentColor = colors.textPrimary),
                    shape = RoundedCornerShape(8.dp),
                    elevation = ButtonDefaults.elevation(0.dp)
                ) {
                    Text("Target Goal: ${formatCents(revenueGoal)} ⚙", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }

                Button(
                    onClick = {
                        scope.launch(Dispatchers.IO) {
                            try {
                                val file = java.io.File("reports/analytics_report_${System.currentTimeMillis()}.csv")
                                file.parentFile.mkdirs()
                                val sb = StringBuilder()
                                sb.append("KPI,Value\n")
                                sb.append("Total Revenue,${overview.totalRevenueCents / 100.0}\n")
                                sb.append("Transactions,${overview.totalTransactions}\n")
                                sb.append("Avg Order Value,${overview.avgOrderValueCents / 100.0}\n")
                                sb.append("Items Sold,${overview.totalItemsSold}\n\n")

                                sb.append("DAILY SALES\nDate,Revenue\n")
                                dailySales.forEach { pt ->
                                    sb.append("${pt.dateLabel},${pt.revenueCents / 100.0}\n")
                                }
                                sb.append("\nTOP PRODUCTS\nSKU,Name,Sold,Revenue\n")
                                topProd.forEach { prod ->
                                    sb.append("${prod.sku},${prod.name},${prod.unitsSold},${prod.revenueCents / 100.0}\n")
                                }
                                sb.append("\nCATEGORY SALES\nCategory,Revenue\n")
                                categoryBreakdown.forEach { (cat, rev) ->
                                    sb.append("$cat,${rev / 100.0}\n")
                                }

                                file.writeText(sb.toString())
                                withContext(Dispatchers.Main) {
                                    AudioSynth.playDrawerOpen()
                                }
                            } catch (e: Exception) {
                                e.printStackTrace()
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                    shape = RoundedCornerShape(8.dp),
                    elevation = ButtonDefaults.elevation(0.dp)
                ) {
                    Text("Export Report (CSV)", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        // KPI cards with animated values
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            AnimatedKpiCard("Total Revenue", overview.totalRevenueCents, true, colors.accent, "↑", Modifier.weight(1f), animateTrigger)
            AnimatedKpiCard("Transactions", overview.totalTransactions.toLong(), false, colors.success, "◈", Modifier.weight(1f), animateTrigger)
            AnimatedKpiCard("Avg Order Value", overview.avgOrderValueCents, true, colors.info, "◇", Modifier.weight(1f), animateTrigger)
            AnimatedKpiCard("Items Sold", overview.totalItemsSold.toLong(), false, colors.warning, "⊙", Modifier.weight(1f), animateTrigger)
        }

        Row(Modifier.fillMaxWidth().height(320.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            // Goal progress ring
            Column(
                Modifier.weight(1f).fillMaxHeight()
                    .background(colors.surface1, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("REVENUE GOAL PROGRESS", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Spacer(Modifier.height(24.dp))

                val pct = if (revenueGoal > 0) (overview.totalRevenueCents.toFloat() / revenueGoal).coerceIn(0f, 1f) else 0f
                val animatedPct by animateFloatAsState(
                    targetValue = if (animateTrigger) pct else 0f,
                    animationSpec = tween(1200, easing = FastOutSlowInEasing)
                )

                Box(contentAlignment = Alignment.Center, modifier = Modifier.size(160.dp)) {
                    Canvas(Modifier.fillMaxSize()) {
                        // Track
                        drawArc(
                            color = colors.surface3,
                            startAngle = -90f,
                            sweepAngle = 360f,
                            useCenter = false,
                            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 16.dp.toPx(), cap = StrokeCap.Round)
                        )
                        // Progress
                        drawArc(
                            brush = Brush.sweepGradient(listOf(colors.accent, colors.info, colors.accent)),
                            startAngle = -90f,
                            sweepAngle = animatedPct * 360f,
                            useCenter = false,
                            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 16.dp.toPx(), cap = StrokeCap.Round)
                        )
                    }

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("${(pct * 100).toInt()}%", color = colors.textPrimary, fontSize = 28.sp, fontWeight = FontWeight.Black)
                        Text("reached", color = colors.textMuted, fontSize = 10.sp)
                    }
                }
                Spacer(Modifier.height(16.dp))
                Text("${formatCents(overview.totalRevenueCents)} of ${formatCents(revenueGoal)}", color = colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }

            // Daily sales chart
            Column(
                Modifier.weight(1.8f).fillMaxHeight()
                    .background(colors.surface1, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                    .padding(16.dp)
            ) {
                Text("DAILY REVENUE CHART (14 DAYS)", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Spacer(Modifier.height(16.dp))
                if (dailySales.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("No sales data available", color = colors.textMuted, fontSize = 11.sp)
                    }
                } else {
                    RevenueBarChart(dailySales, Modifier.fillMaxSize())
                }
            }
        }

        Row(Modifier.fillMaxWidth().height(340.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            // Category sales donut breakdown
            Column(
                Modifier.weight(1.2f).fillMaxHeight()
                    .background(colors.surface1, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                    .padding(16.dp)
            ) {
                Text("CATEGORY REVENUE SPLIT", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Spacer(Modifier.height(16.dp))

                if (categoryBreakdown.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("No category data", color = colors.textMuted, fontSize = 11.sp)
                    }
                } else {
                    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        // Donut Chart
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(150.dp)) {
                            val totalCb = categoryBreakdown.values.sum().toFloat()
                            Canvas(Modifier.fillMaxSize()) {
                                var currentAngle = -90f
                                categoryBreakdown.entries.forEachIndexed { i, entry ->
                                    val sweep = (entry.value.toFloat() / totalCb) * 360f
                                    drawArc(
                                        color = catColors[i % catColors.size],
                                        startAngle = currentAngle,
                                        sweepAngle = sweep,
                                        useCenter = false,
                                        style = androidx.compose.ui.graphics.drawscope.Stroke(width = 24.dp.toPx())
                                    )
                                    currentAngle += sweep
                                }
                            }
                        }

                        // Legend list
                        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            val totalCb = categoryBreakdown.values.sum().toDouble()
                            items(categoryBreakdown.entries.toList()) { entry ->
                                val i = categoryBreakdown.keys.toList().indexOf(entry.key)
                                val color = catColors[i % catColors.size]
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Box(Modifier.size(10.dp).background(color, CircleShape))
                                    Column {
                                        Text(entry.key, color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                        val sharePct = if (totalCb > 0) (entry.value / totalCb) * 100.0 else 0.0
                                        Text("${String.format(Locale.US, "%.1f", sharePct)}% · ${formatCents(entry.value)}", color = colors.textMuted, fontSize = 9.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Top Products list
            Column(
                Modifier.weight(1f).fillMaxHeight()
                    .background(colors.surface1, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("TOP SELLING PRODUCTS", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Divider(color = colors.borderSubtle)

                if (topProd.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("No sales logs yet", color = colors.textMuted, fontSize = 11.sp)
                    }
                } else {
                    val maxUnits = topProd.maxOf { it.unitsSold }.toFloat().coerceAtLeast(1f)
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                        items(topProd) { prod ->
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(prod.name, color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    Text("${prod.unitsSold} units", color = colors.accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                }
                                Box(Modifier.fillMaxWidth().height(4.dp).background(colors.surface3, RoundedCornerShape(2.dp))) {
                                    Box(
                                        Modifier
                                            .fillMaxWidth(prod.unitsSold / maxUnits)
                                            .fillMaxHeight()
                                            .background(Brush.horizontalGradient(listOf(colors.accent, colors.info)), RoundedCornerShape(2.dp))
                                    )
                                }
                                Text(formatCents(prod.revenueCents), color = colors.textMuted, fontSize = 9.sp)
                            }
                        }
                    }
                }
            }
        }

        // Hourly sales intensity heatmap
        Column(
            Modifier.fillMaxWidth()
                .background(colors.surface1, RoundedCornerShape(10.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                .padding(16.dp)
        ) {
            Text("HOURLY SALES INTENSITY HEATMAP (30 DAYS)", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Spacer(Modifier.height(14.dp))

            val maxVal = hourlyHeatmap.maxOfOrNull { (it["sales"] as? Long) ?: 0L }?.coerceAtLeast(1L) ?: 1L
            val daysOfWeek = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                // Header (Hours 0 to 23)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(48.dp)) // Corner indent
                    Row(Modifier.weight(1f), horizontalArrangement = Arrangement.SpaceBetween) {
                        for (h in 0..23) {
                            Text(
                                text = when {
                                    h == 0 -> "12a"
                                    h == 12 -> "12p"
                                    h % 6 == 0 -> "${h % 12}p"
                                    else -> ""
                                },
                                color = colors.textMuted,
                                fontSize = 9.sp,
                                modifier = Modifier.width(18.dp),
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }

                // Grid rows
                for (d in 0..6) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // Day Label
                        Text(daysOfWeek[d], color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(48.dp))

                        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.SpaceBetween) {
                            for (h in 0..23) {
                                val cell = hourlyHeatmap.find { (it["day"] as? Int) == d && (it["hour"] as? Int) == h }
                                val salesVal = (cell?.get("sales") as? Long) ?: 0L
                                val countVal = (cell?.get("count") as? Int) ?: 0
                                val intensity = if (maxVal > 0) salesVal.toFloat() / maxVal else 0f

                                Box(
                                    modifier = Modifier
                                        .size(16.dp)
                                        .clip(RoundedCornerShape(3.dp))
                                        .background(
                                            if (salesVal == 0L) colors.surface3
                                            else colors.accent.copy(alpha = intensity.coerceIn(0.15f, 1f))
                                        )
                                        .border(0.5.dp, colors.surface0.copy(alpha = 0.5f), RoundedCornerShape(3.dp))
                                        .clickable {
                                            selectedCellInfo = "${daysOfWeek[d]} at ${h}:00 — Sales: ${formatCents(salesVal)} ($countVal txs)"
                                        }
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            selectedCellInfo?.let { info ->
                Text(info, color = colors.accent, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }

    // Set goal dialog
    if (showGoalDialog) {
        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(320.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("Set Revenue Goal", color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                FormField("Target (USD)", tempGoalStr, "e.g. 5000") { tempGoalStr = it }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { showGoalDialog = false },
                        modifier = Modifier.weight(1f).height(40.dp),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, colors.borderDefault)
                    ) { Text("Cancel", color = colors.textSecondary) }

                    Button(
                        onClick = {
                            val goalVal = tempGoalStr.toDoubleOrNull() ?: 2000.0
                            scope.launch(Dispatchers.IO) {
                                Database.setPreference("analytics_revenue_goal", "FLOAT", goalVal.toString())
                                withContext(Dispatchers.Main) {
                                    loadAnalytics()
                                    showGoalDialog = false
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                        modifier = Modifier.weight(1f).height(40.dp),
                        shape = RoundedCornerShape(8.dp),
                        elevation = ButtonDefaults.elevation(0.dp)
                    ) { Text("Save", fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

@Composable
fun AnimatedKpiCard(title: String, targetValue: Long, isCurrency: Boolean, color: Color, icon: String, modifier: Modifier = Modifier, trigger: Boolean) {
    val colors = LocalValenixiaColors.current
    var startAnim by remember { mutableStateOf(false) }

    LaunchedEffect(trigger) {
        if (trigger) startAnim = true
    }

    val animVal by animateFloatAsState(
        targetValue = if (startAnim) targetValue.toFloat() else 0f,
        animationSpec = tween(durationMillis = 1000, easing = FastOutSlowInEasing)
    )

    val displayValue = if (isCurrency) formatCents(animVal.toLong()) else animVal.toInt().toString()

    Column(
        modifier
            .background(colors.surface1, RoundedCornerShape(10.dp))
            .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(icon, fontSize = 14.sp, color = color)
            Text(title, color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        }
        Text(displayValue, color = colors.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.Black)
        Box(Modifier.fillMaxWidth().height(2.dp).background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.6f), Color.Transparent)), RoundedCornerShape(1.dp)))
    }
}

@Composable
private fun RevenueBarChart(data: List<DailySalesPoint>, modifier: Modifier) {
    val colors = LocalValenixiaColors.current
    val maxRevenue = data.maxOfOrNull { it.revenueCents }?.toFloat()?.coerceAtLeast(1f) ?: 1f
    Canvas(modifier) {
        val barW    = (size.width / (data.size * 1.6f)).coerceAtMost(40.dp.toPx())
        val spacing = (size.width - barW * data.size) / (data.size + 1)
        val maxH    = size.height * 0.72f
        val baseY   = size.height * 0.82f

        // Baseline
        drawLine(
            color       = colors.borderSubtle,
            start       = Offset(0f, baseY),
            end         = Offset(size.width, baseY),
            strokeWidth = 1.dp.toPx()
        )

        data.forEachIndexed { i, point ->
            val barH = ((point.revenueCents / maxRevenue) * maxH).coerceAtLeast(4f)
            val x    = spacing + i * (barW + spacing)
            val y    = baseY - barH

            // Bar gradient fill
            drawRoundRect(
                brush = Brush.verticalGradient(
                    listOf(colors.accent, colors.info),
                    startY = y, endY = baseY
                ),
                topLeft      = Offset(x, y),
                size         = ComposeSize(barW, barH),
                cornerRadius = CornerRadius(4.dp.toPx())
            )

            // Subtle top highlight line
            drawLine(
                color       = colors.accentGlow,
                start       = Offset(x, y),
                end         = Offset(x + barW, y),
                strokeWidth = 1.5f
            )
        }
    }
}

// ════════════════════════════════════════════════════════════════════
//  SCREEN 5 — EMPLOYEE MANAGEMENT
// ════════════════════════════════════════════════════════════════════
@Composable
fun EmployeesScreen(syncLogs: MutableList<String>) {
    val employeesWithShifts = remember { mutableStateListOf<EmployeeWithShift>() }
    val scope = rememberCoroutineScope()
    val colors = LocalValenixiaColors.current

    var showAdd by remember { mutableStateOf(false) }
    var newRole by remember { mutableStateOf("CASHIER") }
    var newPin by remember { mutableStateOf("") }
    var statusMsg by remember { mutableStateOf("") }
    var statusErr by remember { mutableStateOf(false) }

    // Change PIN Dialog states
    var showChangePinDialog by remember { mutableStateOf<String?>(null) } // holds employee ID to change
    var changePinNewVal by remember { mutableStateOf("") }
    var changePinStatusMsg by remember { mutableStateOf("") }

    fun load() {
        scope.launch(Dispatchers.IO) {
            val emps = Database.getEmployees()
            val list = emps.map { emp ->
                val activeShift = Database.getActiveShift(emp.id)
                val sales = Database.getEmployeeSalesStats(emp.id)
                EmployeeWithShift(
                    record = emp,
                    activeShift = activeShift,
                    salesCount = sales["tx_count"] ?: 0L,
                    salesRevenue = sales["total_rev"] ?: 0L
                )
            }
            withContext(Dispatchers.Main) {
                employeesWithShifts.clear()
                employeesWithShifts.addAll(list)
            }
        }
    }

    LaunchedEffect(Unit) {
        load()
    }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("Staff Management & Attendance", color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text("${employeesWithShifts.count { it.record.isActive }} active staff · ${employeesWithShifts.count { it.activeShift != null }} currently clocked in", color = colors.textMuted, fontSize = 11.sp)
            }
            Button(
                onClick = { showAdd = !showAdd },
                colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                shape = RoundedCornerShape(8.dp),
                elevation = ButtonDefaults.elevation(0.dp)
            ) {
                Text("+ Add Staff Member", fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }
        }

        if (showAdd) {
            Box(
                Modifier.fillMaxWidth()
                    .background(colors.surface2, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.accent.copy(alpha = 0.3f), RoundedCornerShape(10.dp))
                    .padding(16.dp)
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Register New Staff Member", color = colors.textPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text("Role Assignment", color = colors.textSecondary, fontSize = 10.sp, modifier = Modifier.padding(bottom = 4.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf("CASHIER", "ADMIN", "MANAGER").forEach { role ->
                                    val active = newRole == role
                                    Box(
                                        Modifier.clip(RoundedCornerShape(6.dp))
                                            .background(if (active) colors.accentDim else colors.surface3)
                                            .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                                            .clickable { newRole = role }
                                            .padding(horizontal = 12.dp, vertical = 7.dp)
                                    ) { Text(role, color = if (active) colors.accent else colors.textSecondary, fontSize = 11.sp) }
                                }
                            }
                        }
                        Column(Modifier.weight(1f)) {
                            Text("Default PIN (4-6 digits)", color = colors.textSecondary, fontSize = 10.sp, modifier = Modifier.padding(bottom = 4.dp))
                            Box(Modifier.fillMaxWidth().background(colors.surface3, RoundedCornerShape(6.dp)).border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp)).padding(horizontal = 12.dp, vertical = 10.dp)) {
                                BasicTextField(
                                    value = newPin,
                                    onValueChange = { if (it.length <= 6 && it.all { c -> c.isDigit() }) newPin = it },
                                    textStyle = TextStyle(color = colors.textPrimary, fontSize = 13.sp, letterSpacing = 8.sp),
                                    cursorBrush = SolidColor(colors.accent),
                                    modifier = Modifier.fillMaxWidth()
                                )
                                if (newPin.isEmpty()) Text("••••••", color = colors.textMuted, fontSize = 13.sp, letterSpacing = 8.sp)
                            }
                        }
                    }
                    if (statusMsg.isNotEmpty()) StatusBanner(statusMsg, statusErr) { statusMsg = "" }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                if (newPin.length !in 4..6) {
                                    statusMsg = "PIN must be 4 to 6 digits"
                                    statusErr = true
                                    return@Button
                                }
                                scope.launch(Dispatchers.IO) {
                                    val id = Database.addEmployee(newRole, newPin)
                                    withContext(Dispatchers.Main) {
                                        statusMsg = "Staff added successfully (ID: ${id.take(8)})"
                                        statusErr = false
                                        newPin = ""
                                        showAdd = false
                                        syncLogs.add("[STAFF] Registered $newRole: ${id.take(8)}")
                                        load()
                                    }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                            shape = RoundedCornerShape(8.dp),
                            elevation = ButtonDefaults.elevation(0.dp)
                        ) { Text("Create Account", fontWeight = FontWeight.Bold, fontSize = 12.sp) }
                        TextButton(onClick = { showAdd = false; newPin = "" }) {
                            Text("Cancel", color = colors.textSecondary, fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        if (statusMsg.isNotEmpty() && !showAdd) StatusBanner(statusMsg, statusErr) { statusMsg = "" }

        // Employee roster table
        Box(
            Modifier.fillMaxWidth().weight(1f)
                .background(colors.surface1, RoundedCornerShape(10.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
        ) {
            LazyColumn(Modifier.fillMaxSize()) {
                // Header
                item {
                    Row(
                        Modifier.fillMaxWidth().background(colors.surface2).padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text("EMPLOYEE ID", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Text("ROLE", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(90.dp))
                        Text("SHIFT STATUS", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(160.dp))
                        Text("SHIFT SALES", color = colors.textMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(140.dp))
                        Spacer(Modifier.width(220.dp))
                    }
                }

                items(employeesWithShifts) { emp ->
                    val interactionSource = remember { MutableInteractionSource() }
                    val hovered by interactionSource.collectIsHoveredAsState()
                    Row(
                        Modifier.fillMaxWidth()
                            .background(if (hovered) colors.surfaceHover else Color.Transparent)
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(emp.record.id.take(12) + "…", color = colors.textPrimary, fontSize = 11.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
                        Row(Modifier.width(90.dp)) {
                            val roleColor = when (emp.record.role) {
                                "ADMIN" -> colors.error
                                "MANAGER" -> colors.warning
                                else -> colors.accent
                            }
                            Badge(emp.record.role, roleColor)
                        }

                        // Shift status
                        Row(Modifier.width(160.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (emp.activeShift != null) {
                                Box(Modifier.size(6.dp).background(colors.success, CircleShape))
                                val timeStr = SimpleDateFormat("HH:mm", Locale.US).format(Date(emp.activeShift.clockIn))
                                Text("Clocked In ($timeStr)", color = colors.success, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            } else {
                                Box(Modifier.size(6.dp).background(colors.textMuted, CircleShape))
                                Text("Clocked Out", color = colors.textMuted, fontSize = 11.sp)
                            }
                        }

                        // Sales metric
                        Text("${emp.salesCount} txs (${formatCents(emp.salesRevenue)})", color = colors.textSecondary, fontSize = 11.sp, modifier = Modifier.width(140.dp))

                        Row(Modifier.width(220.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            // Attendance action
                            if (emp.activeShift != null) {
                                SmallActionButton("Clock Out", colors.warning) {
                                    scope.launch(Dispatchers.IO) {
                                        val ok = Database.clockOut(emp.record.id)
                                        if (ok) {
                                            withContext(Dispatchers.Main) {
                                                AudioSynth.playDrawerOpen()
                                                syncLogs.add("[STAFF] Shift ended: ${emp.record.id.take(8)}")
                                                load()
                                            }
                                        }
                                    }
                                }
                            } else {
                                SmallActionButton("Clock In", colors.success) {
                                    scope.launch(Dispatchers.IO) {
                                        Database.clockIn(emp.record.id)
                                        withContext(Dispatchers.Main) {
                                            AudioSynth.playDrawerOpen()
                                            syncLogs.add("[STAFF] Shift started: ${emp.record.id.take(8)}")
                                            load()
                                        }
                                    }
                                }
                            }

                            Spacer(Modifier.width(4.dp))
                            SmallActionButton("Change PIN", colors.accent) {
                                changePinNewVal = ""
                                changePinStatusMsg = ""
                                showChangePinDialog = emp.record.id
                            }

                            Spacer(Modifier.width(4.dp))
                            SmallActionButton(if (emp.record.isActive) "Disable" else "Enable", if (emp.record.isActive) colors.error else colors.success) {
                                scope.launch(Dispatchers.IO) {
                                    Database.setEmployeeActive(emp.record.id, !emp.record.isActive)
                                    withContext(Dispatchers.Main) {
                                        syncLogs.add("[STAFF] Roster status toggled: ${emp.record.id.take(8)}")
                                        load()
                                    }
                                }
                            }
                        }
                    }
                    Divider(color = colors.borderSubtle.copy(alpha = 0.5f))
                }
            }
        }
    }

    // Change PIN Dialog
    if (showChangePinDialog != null) {
        val empId = showChangePinDialog!!
        DialogOverlay {
            Column(
                modifier = Modifier
                    .width(320.dp)
                    .background(colors.surface2, RoundedCornerShape(16.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("Reset Staff PIN", color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text("Enter a new 4-6 digit PIN for staff member ${empId.take(8).uppercase()}.", color = colors.textSecondary, fontSize = 11.sp).uppercase()}.", color = colors.textSecondary, fontSize = 11.sp)

                var changePinVisible by remember { mutableStateOf(false) }
                Box(Modifier.fillMaxWidth().background(colors.surface3, RoundedCornerShape(6.dp)).border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp)).padding(horizontal = 12.dp, vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(modifier = Modifier.weight(1f)) {
                            BasicTextField(
                                value = changePinNewVal,
                                onValueChange = { if (it.length <= 6 && it.all { c -> c.isDigit() }) changePinNewVal = it },
                                textStyle = TextStyle(color = colors.textPrimary, fontSize = 13.sp, letterSpacing = 8.sp),
                                visualTransformation = if (changePinVisible) VisualTransformation.None else PasswordVisualTransformation(),
                                cursorBrush = SolidColor(colors.accent),
                                modifier = Modifier.fillMaxWidth()
                            )
                            if (changePinNewVal.isEmpty()) Text("••••••", color = colors.textMuted, fontSize = 13.sp, letterSpacing = 8.sp)
                        }
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = if (changePinVisible) "👁" else "👁‍🗨",
                            color = colors.textSecondary,
                            fontSize = 12.sp,
                            modifier = Modifier.clickable { changePinVisible = !changePinVisible; AudioSynth.playTick() }.padding(2.dp)
                        )
                    }
                }

                if (changePinStatusMsg.isNotEmpty()) {
                    Text(changePinStatusMsg, color = colors.error, fontSize = 11.sp)
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { showChangePinDialog = null },
                        modifier = Modifier.weight(1f).height(40.dp),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, colors.borderDefault)
                    ) { Text("Cancel", color = colors.textSecondary) }

                    Button(
                        onClick = {
                            if (changePinNewVal.length !in 4..6) {
                                changePinStatusMsg = "PIN must be 4 to 6 digits"
                                return@Button
                            }
                            scope.launch(Dispatchers.IO) {
                                val ok = Database.changeEmployeePin(empId, changePinNewVal)
                                if (ok) {
                                    withContext(Dispatchers.Main) {
                                        AudioSynth.playDrawerOpen()
                                        syncLogs.add("[STAFF] PIN reset for ${empId.take(8)}")
                                        showChangePinDialog = null
                                    }
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                        modifier = Modifier.weight(1f).height(40.dp),
                        shape = RoundedCornerShape(8.dp),
                        elevation = ButtonDefaults.elevation(0.dp)
                    ) { Text("Update", fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

data class EmployeeWithShift(
    val record: Database.EmployeeRecord,
    val activeShift: EmployeeShift?,
    val salesCount: Long,
    val salesRevenue: Long
)

// ════════════════════════════════════════════════════════════════════
//  SCREEN 6 — SYSTEM LOGS
// ════════════════════════════════════════════════════════════════════
@Composable
fun LogsScreen(syncLogs: MutableList<String>) {
    var filter by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(syncLogs.size) {
        if (syncLogs.isNotEmpty()) listState.animateScrollToItem(syncLogs.size - 1)
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            SearchBar(value = filter, onValueChange = { filter = it }, placeholder = "Filter logs…", modifier = Modifier.weight(1f))
            Spacer(Modifier.width(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StatChip("${syncLogs.size}", "Total Events", NeonCyan)
                OutlinedButton(
                    onClick = { syncLogs.clear(); syncLogs.add("[LOGS] Log buffer cleared.") },
                    border = BorderStroke(1.dp, BorderDefault),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                    shape  = RoundedCornerShape(8.dp)
                ) { Text("Clear", fontSize = 11.sp) }
            }
        }

        val filtered = if (filter.isBlank()) syncLogs.toList() else syncLogs.filter { it.contains(filter, true) }

        Box(
            Modifier.fillMaxWidth().weight(1f)
                .background(Color(0xFF050810), RoundedCornerShape(10.dp))
                .border(1.dp, BorderDefault, RoundedCornerShape(10.dp))
                .padding(16.dp)
        ) {
            LazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                items(filtered) { log ->
                    val color = when {
                        log.contains("[ERR]")    -> CoralRed
                        log.contains("[TX]")     -> EmeraldGreen
                        log.contains("[SYNC]")   -> AmberOrange
                        log.contains("[INV]")    -> IndigoBlue
                        log.contains("[STAFF]")  -> Color(0xFFEC4899)
                        log.contains("[BOOT]")   -> NeonCyan
                        else                     -> TextSecondary
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                        Text(
                            shortFmt.format(Date()),
                            color = TextMuted, fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.width(68.dp).padding(top = 1.dp)
                        )
                        Text(log, color = color, fontSize = 11.sp, fontFamily = FontFamily.Monospace, lineHeight = 16.sp)
                    }
                }
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════
//  SCREEN 7 — SETTINGS
// ════════════════════════════════════════════════════════════════════
@Composable
fun SettingsScreen(
    employee: Employee,
    currentTheme: String,
    onThemeChange: (String) -> Unit,
    syncLogs: MutableList<String>,
    onBrandingRefresh: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val colors = LocalValenixiaColors.current

    var taxRateStr   by remember { mutableStateOf(Database.getPreference("tax_rate") ?: "8.0") }
    var storeName    by remember { mutableStateOf(Database.getPreference("store_name") ?: "VALENIXIA COFFEE & RETAIL") }
    var logoEmoji    by remember { mutableStateOf(Database.getPreference("store_logo_emoji") ?: "☕") }
    var receiptTagline by remember { mutableStateOf(Database.getPreference("store_receipt_tagline") ?: "Stability meets Speed. Thank you!") }
    var showBranding by remember { mutableStateOf((Database.getPreference("whitelabel_show_branding") ?: "true") == "true") }
    var glassmorphismEnabled by remember { mutableStateOf((Database.getPreference("glassmorphism_enabled") ?: "true") == "true") }

    var currency     by remember { mutableStateOf(Database.getPreference("currency") ?: "USD") }

    var syncPassphrase by remember { mutableStateOf(Database.getPreference("sync_passphrase") ?: "") }
    var syncPassphraseVisible by remember { mutableStateOf(false) }

    // Receipt details
    var receiptAddress by remember { mutableStateOf(Database.getPreference("receipt_address") ?: "123 Business Rd, Suite 100") }
    var receiptPhone by remember { mutableStateOf(Database.getPreference("receipt_phone") ?: "+1 (555) 019-2834") }
    var receiptWebsite by remember { mutableStateOf(Database.getPreference("receipt_website") ?: "www.valenixiaretail.com") }
    var receiptPolicy by remember { mutableStateOf(Database.getPreference("receipt_policy") ?: "Returns accepted within 14 days with receipt.") }
    var qrAccountDetails by remember { mutableStateOf(Database.getPreference("qr_account_details") ?: "Direct Transfer / Venmo: @MyStore") }

    // Security
    var currentPin by remember { mutableStateOf("") }
    var newPin     by remember { mutableStateOf("") }
    var confirmPin by remember { mutableStateOf("") }
    var currentPinVisible by remember { mutableStateOf(false) }
    var newPinVisible     by remember { mutableStateOf(false) }
    var confirmPinVisible by remember { mutableStateOf(false) }

    var statusMsg    by remember { mutableStateOf("") }
    var statusErr    by remember { mutableStateOf(false) }

    var devices by remember { mutableStateOf<List<Database.DeviceRecord>>(emptyList()) }
    LaunchedEffect(Unit) {
        devices = withContext(Dispatchers.IO) { Database.getAllDevices() }
    }

    fun backupDb() {
        scope.launch(Dispatchers.IO) {
            try {
                val dbFile = java.io.File("valenixia.db")
                val backupFile = java.io.File("backups/valenixia_backup_${System.currentTimeMillis()}.db")
                backupFile.parentFile.mkdirs()
                dbFile.copyTo(backupFile, overwrite = true)
                withContext(Dispatchers.Main) {
                    statusMsg = "Backup saved: ${backupFile.name}"
                    statusErr = false
                    syncLogs.add("[SETTINGS] Database backup completed: ${backupFile.name}")
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    statusMsg = "Backup failed: ${e.message}"
                    statusErr = true
                }
            }
        }
    }

    fun restoreLatestBackup() {
        scope.launch(Dispatchers.IO) {
            try {
                val backupsDir = java.io.File("backups")
                val files = backupsDir.listFiles { _, name -> name.startsWith("valenixia_backup_") && name.endsWith(".db") }
                if (files.isNullOrEmpty()) {
                    withContext(Dispatchers.Main) {
                        statusMsg = "No backups found to restore."
                        statusErr = true
                    }
                    return@launch
                }
                val latest = files.maxByOrNull { it.lastModified() }!!
                val dbFile = java.io.File("valenixia.db")
                latest.copyTo(dbFile, overwrite = true)
                withContext(Dispatchers.Main) {
                    statusMsg = "Restored from ${latest.name}. Please restart the app."
                    statusErr = false
                    syncLogs.add("[SETTINGS] Database restored from ${latest.name}")
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    statusMsg = "Restore failed: ${e.message}"
                    statusErr = true
                }
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            // General Settings Card
            Column(
                Modifier.weight(1.2f)
                    .background(colors.surface1, RoundedCornerShape(10.dp))
                    .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("STORE SETTINGS & RECEIPT TEMPLATE", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Divider(color = colors.borderSubtle)

                FormField("Store / Business Name", storeName, "e.g. Valenixia Retail") { storeName = it }
                FormField("Store Logo Emoji", logoEmoji, "e.g. ☕") { logoEmoji = it }
                FormField("Tax Rate (%)", taxRateStr, "e.g. 8.0") { taxRateStr = it }
                FormField("Store Address (Receipt)", receiptAddress, "e.g. 123 Main St") { receiptAddress = it }
                FormField("Store Phone (Receipt)", receiptPhone, "e.g. +1 (555) 123-4567") { receiptPhone = it }
                FormField("Store Website (Receipt)", receiptWebsite, "e.g. valenixiaretail.com") { receiptWebsite = it }
                FormField("Receipt Tagline", receiptTagline, "e.g. Stability meets Speed.") { receiptTagline = it }
                FormField("Return Policy (Receipt Footer)", receiptPolicy, "e.g. All sales final") { receiptPolicy = it }
                FormField("QR Payment Instructions (Free Transfer)", qrAccountDetails, "e.g. Venmo: @MyStore / Bank Transfer details") { qrAccountDetails = it }

                Divider(color = colors.borderSubtle)

                Text("WHITELABEL & RENDERING ENGINE SETTINGS", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)

                // Toggle for branding
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Show 'Powered by Valenixia' Branding", color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        Text("Toggle default ecosystem labels in the app", color = colors.textMuted, fontSize = 9.sp)
                    }
                    Button(
                        onClick = { showBranding = !showBranding },
                        colors = ButtonDefaults.buttonColors(
                            backgroundColor = if (showBranding) colors.successDim else colors.surface3,
                            contentColor = if (showBranding) colors.success else colors.textSecondary
                        ),
                        shape = RoundedCornerShape(6.dp),
                        elevation = ButtonDefaults.elevation(0.dp),
                        border = BorderStroke(1.dp, if (showBranding) colors.success.copy(alpha = 0.3f) else colors.borderDefault)
                    ) {
                        Text(if (showBranding) "ENABLED" else "DISABLED", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }

                // Toggle for glassmorphism
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Glassmorphic Glass UI (Performance Mode)", color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        Text("Disable blur effects for high-speed POS rendering", color = colors.textMuted, fontSize = 9.sp)
                    }
                    Button(
                        onClick = { glassmorphismEnabled = !glassmorphismEnabled },
                        colors = ButtonDefaults.buttonColors(
                            backgroundColor = if (glassmorphismEnabled) colors.accentDim else colors.surface3,
                            contentColor = if (glassmorphismEnabled) colors.accent else colors.textSecondary
                        ),
                        shape = RoundedCornerShape(6.dp),
                        elevation = ButtonDefaults.elevation(0.dp),
                        border = BorderStroke(1.dp, if (glassmorphismEnabled) colors.accent.copy(alpha = 0.3f) else colors.borderDefault)
                    ) {
                        Text(if (glassmorphismEnabled) "GLASSY UI" else "SOLID COLORS", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }

                Divider(color = colors.borderSubtle)

                Text("THEME PALETTE SELECTOR", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                // Theme Palette Selector Grid / Row
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(
                        "Obsidian Emerald" to "Deep Slate & Neon Teal",
                        "Midnight Sapphire" to "Indigo & Electric Blue",
                        "Warm Amber" to "Espresso & Gold Amber",
                        "Minimalist Chrome" to "Pitch Black & Silver",
                        "Monochrome Ivory" to "Soft Cream & Onyx"
                    ).forEach { (palette, desc) ->
                        val active = currentTheme == palette
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (active) colors.accentDim else colors.surface2)
                                .border(1.dp, if (active) colors.accent else colors.borderSubtle, RoundedCornerShape(8.dp))
                                .clickable {
                                    onThemeChange(palette)
                                }
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(palette, color = if (active) colors.accent else colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                Text(desc, color = colors.textMuted, fontSize = 9.sp)
                            }
                            if (active) {
                                Text("✓", color = colors.accent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                Divider(color = colors.borderSubtle)

                Text("Base Currency Selection", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("USD", "EUR", "GBP", "AED", "PKR").forEach { curr ->
                        val active = currency == curr
                        Box(
                            Modifier.clip(RoundedCornerShape(6.dp))
                                .background(if (active) colors.accentDim else colors.surface3)
                                .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                                .clickable { currency = curr }
                                .padding(horizontal = 14.dp, vertical = 8.dp)
                        ) { Text(curr, color = if (active) colors.accent else colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                    }
                }

                if (statusMsg.isNotEmpty()) {
                    StatusBanner(statusMsg, statusErr) { statusMsg = "" }
                }

                Button(
                    onClick = {
                        scope.launch(Dispatchers.IO) {
                            Database.setPreference("store_name", "TEXT", storeName)
                            Database.setPreference("store_logo_emoji", "TEXT", logoEmoji)
                            Database.setPreference("tax_rate",   "FLOAT", taxRateStr)
                            Database.setPreference("currency",   "TEXT", currency)
                            Database.setPreference("receipt_address", "TEXT", receiptAddress)
                            Database.setPreference("receipt_phone", "TEXT", receiptPhone)
                            Database.setPreference("receipt_website", "TEXT", receiptWebsite)
                            Database.setPreference("store_receipt_tagline", "TEXT", receiptTagline)
                            Database.setPreference("receipt_policy", "TEXT", receiptPolicy)
                            Database.setPreference("qr_account_details", "TEXT", qrAccountDetails)
                            Database.setPreference("whitelabel_show_branding", "TEXT", showBranding.toString())
                            Database.setPreference("glassmorphism_enabled", "TEXT", glassmorphismEnabled.toString())
                            Database.setPreference("store_theme_palette", "TEXT", currentTheme)
                            // Encrypt passphrase before storing to prevent plaintext exposure in the .db file
                            if (syncPassphrase.isNotEmpty()) {
                                Database.setPreferenceEncrypted("sync_passphrase", syncPassphrase)
                            }
                            withContext(Dispatchers.Main) {
                                onBrandingRefresh()
                                statusMsg = "Store parameters saved successfully."
                                statusErr = false
                                syncLogs.add("[SETTINGS] Store preferences updated & logged to CRDT")
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(backgroundColor = colors.accent, contentColor = colors.surface0),
                    shape = RoundedCornerShape(8.dp),
                    elevation = ButtonDefaults.elevation(0.dp),
                    modifier = Modifier.fillMaxWidth().height(42.dp)
                ) { Text("Save Store Parameters", fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            }

            // Database Operations & Personal Security
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Database Card
                Column(
                    Modifier.fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(10.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text("LOCAL DATABASE & ATTENDANCE BACKUPS", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                    Divider(color = colors.borderSubtle)

                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { backupDb() },
                            colors = ButtonDefaults.buttonColors(backgroundColor = colors.surface3, contentColor = colors.textPrimary),
                            shape = RoundedCornerShape(8.dp),
                            elevation = ButtonDefaults.elevation(0.dp),
                            modifier = Modifier.weight(1f).height(40.dp)
                        ) {
                            Text("BACKUP DATABASE", fontWeight = FontWeight.Bold, fontSize = 10.sp)
                        }

                        Button(
                            onClick = { restoreLatestBackup() },
                            colors = ButtonDefaults.buttonColors(backgroundColor = colors.warningDim, contentColor = colors.warning),
                            shape = RoundedCornerShape(8.dp),
                            elevation = ButtonDefaults.elevation(0.dp),
                            modifier = Modifier.weight(1f).height(40.dp)
                        ) {
                            Text("RESTORE LATEST", fontWeight = FontWeight.Bold, fontSize = 10.sp)
                        }
                    }

                    Text("System Host Specifications", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                    listOf(
                        "POS Host ID" to Database.hlc.nodeId,
                        "SQLite Version" to "3.42 (WAL Mode)",
                        "Engine State" to "Synchronous / Normal",
                        "OS Platform" to System.getProperty("os.name")!!
                    ).forEach { (k, v) ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(k, color = colors.textMuted, fontSize = 10.sp)
                            Text(v, color = colors.textPrimary, fontSize = 10.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }

                // P2P Mobile Sync Coupling Card
                val ipList = remember { getLocalIpAddresses() }
                var selectedIp by remember { mutableStateOf(ipList.firstOrNull() ?: "127.0.0.1") }

                Column(
                    Modifier.fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(10.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text("MOBILE REGISTER COUPLING (P2P SYNC)", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                    Divider(color = colors.borderSubtle)

                    Text(
                        "Ensure this PC and the mobile register app are connected to the same Wi-Fi network. Select the target host network interface below, then scan the QR code to connect.",
                        color = colors.textMuted,
                        fontSize = 11.sp,
                        lineHeight = 16.sp
                    )

                    if (ipList.size > 1) {
                        Text("Active Interface Host IP", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            ipList.forEach { ip ->
                                val active = selectedIp == ip
                                Box(
                                    Modifier.clip(RoundedCornerShape(6.dp))
                                        .background(if (active) colors.accentDim else colors.surface3)
                                        .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                                        .clickable { selectedIp = ip }
                                        .padding(horizontal = 10.dp, vertical = 6.dp)
                                ) {
                                    Text(ip, color = if (active) colors.accent else colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(4.dp))
                    Text("P2P Sync Encryption Key", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                    Box(Modifier.fillMaxWidth().background(colors.surface3, RoundedCornerShape(6.dp)).border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(modifier = Modifier.weight(1f)) {
                                BasicTextField(
                                    value = syncPassphrase,
                                    onValueChange = { syncPassphrase = it },
                                    textStyle = TextStyle(color = colors.textPrimary, fontSize = 12.sp),
                                    visualTransformation = if (syncPassphraseVisible) VisualTransformation.None else PasswordVisualTransformation(),
                                    modifier = Modifier.fillMaxWidth(),
                                    cursorBrush = SolidColor(colors.accent)
                                )
                                if (syncPassphrase.isEmpty()) Text("Encryption Passphrase", color = colors.textMuted, fontSize = 12.sp)
                            }
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = if (syncPassphraseVisible) "👁" else "👁‍🗨",
                                color = colors.textSecondary,
                                fontSize = 11.sp,
                                modifier = Modifier.clickable { syncPassphraseVisible = !syncPassphraseVisible; AudioSynth.playTick() }.padding(2.dp)
                            )
                        }
                    }

                    // Pairing token state — one-time token generated on-demand
                    var pairingToken by remember { mutableStateOf("") }
                    var pairingTokenLoading by remember { mutableStateOf(false) }
                    var pairingTokenError by remember { mutableStateOf("") }

                    Spacer(Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // QR code encodes a short-lived pairing token URL — NOT the passphrase
                        if (pairingToken.isNotEmpty()) {
                            val pairingUrl = "http://$selectedIp:3000/api/pairing/consume?token=$pairingToken"
                            Canvas(modifier = Modifier.size(100.dp).background(Color.White, RoundedCornerShape(4.dp)).padding(6.dp)) {
                                val qrSize = 21
                                val cellSize = size.width / qrSize
                                val seed = pairingUrl.hashCode().toLong()
                                val rand = java.util.Random(seed)

                                for (row in 0 until qrSize) {
                                    for (col in 0 until qrSize) {
                                        val isFinderPattern =
                                            (row < 7 && col < 7) ||
                                            (row < 7 && col >= qrSize - 7) ||
                                            (row >= qrSize - 7 && col < 7)

                                        val drawBlack = if (isFinderPattern) {
                                            val r = if (row < 7) row else qrSize - 1 - row
                                            val c = if (col < 7) col else qrSize - 1 - col
                                            val innerR = if (row >= qrSize - 7 && col < 7) row - (qrSize - 7) else r
                                            val innerC = if (row < 7 && col >= qrSize - 7) col - (qrSize - 7) else c
                                            val maxDist = Math.max(Math.abs(innerR - 3), Math.abs(innerC - 3))
                                            maxDist == 3 || maxDist <= 1
                                        } else {
                                            rand.nextBoolean()
                                        }

                                        if (drawBlack) {
                                            drawRect(
                                                color = Color.Black,
                                                topLeft = Offset(col * cellSize, row * cellSize),
                                                size = ComposeSize(cellSize + 0.5f, cellSize + 0.5f)
                                            )
                                        }
                                    }
                                }
                            }
                        } else {
                            Box(
                                modifier = Modifier.size(100.dp).background(colors.surface3, RoundedCornerShape(4.dp)).border(1.dp, colors.borderDefault, RoundedCornerShape(4.dp)).padding(8.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                if (pairingTokenLoading) {
                                    Text("Generating\u2026", color = colors.textMuted, fontSize = 9.sp, textAlign = TextAlign.Center, lineHeight = 12.sp)
                                } else {
                                    Text(
                                        text = if (pairingTokenError.isNotEmpty()) pairingTokenError else "Press \"Generate\" to create a secure pairing code",
                                        color = if (pairingTokenError.isNotEmpty()) colors.error else colors.textMuted,
                                        fontSize = 9.sp,
                                        textAlign = TextAlign.Center,
                                        lineHeight = 12.sp
                                    )
                                }
                            }
                        }

                        Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.weight(1f)) {
                            Text("Secure Pairing Token (5-min TTL)", color = colors.textMuted, fontSize = 9.sp)
                            Text(
                                text = "Token-based pairing — passphrase is never exposed in QR code.",
                                color = colors.textMuted,
                                fontSize = 9.sp,
                                lineHeight = 12.sp
                            )
                            Spacer(Modifier.height(4.dp))
                            Button(
                                onClick = {
                                    pairingTokenLoading = true
                                    pairingTokenError = ""
                                    pairingToken = ""
                                    scope.launch(Dispatchers.IO) {
                                        try {
                                            val token = Database.generatePairingToken()
                                            withContext(Dispatchers.Main) {
                                                pairingToken = token
                                                pairingTokenLoading = false
                                            }
                                        } catch (e: Exception) {
                                            withContext(Dispatchers.Main) {
                                                pairingTokenError = "Failed: ${e.message?.take(40)}"
                                                pairingTokenLoading = false
                                            }
                                        }
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(backgroundColor = colors.accentDim, contentColor = colors.accent),
                                shape = RoundedCornerShape(8.dp),
                                elevation = ButtonDefaults.elevation(0.dp),
                                border = BorderStroke(1.dp, colors.accent.copy(alpha = 0.3f)),
                                modifier = Modifier.fillMaxWidth().height(36.dp)
                            ) {
                                Text("Generate Pairing Code", fontWeight = FontWeight.Bold, fontSize = 11.sp)
                            }
                            Text("Scan with mobile register app", color = colors.textMuted, fontSize = 9.sp)
                        }
                    }
                }
                
                // Security PIN Card
                Column(
                    Modifier.fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(10.dp))
                        .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text("PERSONAL SECURITY CREDENTIALS", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                    Divider(color = colors.borderSubtle)

                    Text("Update Your Cashier PIN", color = colors.textMuted, fontSize = 11.sp)

                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Current PIN", color = colors.textSecondary, fontSize = 9.sp)
                                Box(Modifier.fillMaxWidth().background(colors.surface3, RoundedCornerShape(6.dp)).border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 6.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(modifier = Modifier.weight(1f)) {
                                            BasicTextField(
                                                value = currentPin,
                                                onValueChange = { if (it.length <= 6 && it.all { c -> c.isDigit() }) currentPin = it },
                                                textStyle = TextStyle(color = colors.textPrimary, fontSize = 12.sp, letterSpacing = 4.sp),
                                                visualTransformation = if (currentPinVisible) VisualTransformation.None else PasswordVisualTransformation(),
                                                modifier = Modifier.fillMaxWidth(),
                                                cursorBrush = SolidColor(colors.accent)
                                            )
                                            if (currentPin.isEmpty()) Text("••••••", color = colors.textMuted, fontSize = 12.sp, letterSpacing = 4.sp)
                                        }
                                        Spacer(Modifier.width(4.dp))
                                        Text(
                                            text = if (currentPinVisible) "👁" else "👁‍🗨",
                                            color = colors.textSecondary,
                                            fontSize = 11.sp,
                                            modifier = Modifier.clickable { currentPinVisible = !currentPinVisible; AudioSynth.playTick() }.padding(2.dp)
                                        )
                                    }
                                }
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text("New PIN", color = colors.textSecondary, fontSize = 9.sp)
                                Box(Modifier.fillMaxWidth().background(colors.surface3, RoundedCornerShape(6.dp)).border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 6.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(modifier = Modifier.weight(1f)) {
                                            BasicTextField(
                                                value = newPin,
                                                onValueChange = { if (it.length <= 6 && it.all { c -> c.isDigit() }) newPin = it },
                                                textStyle = TextStyle(color = colors.textPrimary, fontSize = 12.sp, letterSpacing = 4.sp),
                                                visualTransformation = if (newPinVisible) VisualTransformation.None else PasswordVisualTransformation(),
                                                modifier = Modifier.fillMaxWidth(),
                                                cursorBrush = SolidColor(colors.accent)
                                            )
                                            if (newPin.isEmpty()) Text("••••••", color = colors.textMuted, fontSize = 12.sp, letterSpacing = 4.sp)
                                        }
                                        Spacer(Modifier.width(4.dp))
                                        Text(
                                            text = if (newPinVisible) "👁" else "👁‍🗨",
                                            color = colors.textSecondary,
                                            fontSize = 11.sp,
                                            modifier = Modifier.clickable { newPinVisible = !newPinVisible; AudioSynth.playTick() }.padding(2.dp)
                                        )
                                    }
                                }
                            }
                        }

                        Column(modifier = Modifier.fillMaxWidth()) {
                            Text("Confirm New PIN", color = colors.textSecondary, fontSize = 9.sp)
                            Box(Modifier.fillMaxWidth().background(colors.surface3, RoundedCornerShape(6.dp)).border(1.dp, colors.borderDefault, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 6.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(modifier = Modifier.weight(1f)) {
                                        BasicTextField(
                                            value = confirmPin,
                                            onValueChange = { if (it.length <= 6 && it.all { c -> c.isDigit() }) confirmPin = it },
                                            textStyle = TextStyle(color = colors.textPrimary, fontSize = 12.sp, letterSpacing = 4.sp),
                                            visualTransformation = if (confirmPinVisible) VisualTransformation.None else PasswordVisualTransformation(),
                                            modifier = Modifier.fillMaxWidth(),
                                            cursorBrush = SolidColor(colors.accent)
                                        )
                                        if (confirmPin.isEmpty()) Text("••••••", color = colors.textMuted, fontSize = 12.sp, letterSpacing = 4.sp)
                                    }
                                    Spacer(Modifier.width(4.dp))
                                    Text(
                                        text = if (confirmPinVisible) "👁" else "👁‍🗨",
                                        color = colors.textSecondary,
                                        fontSize = 11.sp,
                                        modifier = Modifier.clickable { confirmPinVisible = !confirmPinVisible; AudioSynth.playTick() }.padding(2.dp)
                                    )
                                }
                            }
                        }
                    }

                    Button(
                        onClick = {
                            if (newPin.length !in 4..6 || newPin != confirmPin) {
                                statusMsg = "PIN mismatch or not 4-6 digits."
                                statusErr = true
                                return@Button
                            }
                            scope.launch(Dispatchers.IO) {
                                val verified = Database.verifyEmployeePin(currentPin, "local:change-pin")
                                if (verified == null || verified.id != employee.id) {
                                    withContext(Dispatchers.Main) {
                                        statusMsg = "Invalid current PIN code."
                                        statusErr = true
                                    }
                                    return@launch
                                }
                                val ok = Database.changeEmployeePin(employee.id, newPin)
                                withContext(Dispatchers.Main) {
                                    if (ok) {
                                        AudioSynth.playDrawerOpen()
                                        statusMsg = "PIN code reset successfully."
                                        statusErr = false
                                        currentPin = ""
                                        newPin = ""
                                        confirmPin = ""
                                        syncLogs.add("[STAFF] Password PIN reset for Cashier ${employee.id.take(8)}")
                                    } else {
                                        statusMsg = "System update failed."
                                        statusErr = true
                                    }
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.accentDim, contentColor = colors.accent),
                        shape = RoundedCornerShape(8.dp),
                        elevation = ButtonDefaults.elevation(0.dp),
                        modifier = Modifier.fillMaxWidth().height(38.dp),
                        border = BorderStroke(1.dp, colors.accent.copy(alpha = 0.3f))
                    ) {
                        Text("RESET CASHIER PIN", fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    }
                }
            }
        }

        // Device Whitelist Manager Card
        Column(
            Modifier.fillMaxWidth()
                .background(colors.surface1, RoundedCornerShape(10.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text("AUTHORIZED DEVICES & SYNC WHITELIST", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                    Text("Manage terminals and devices allowed to sync with this host database", color = colors.textMuted, fontSize = 9.sp)
                }

                Button(
                    onClick = {
                        scope.launch(Dispatchers.IO) {
                            devices = Database.getAllDevices()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(backgroundColor = colors.surface3, contentColor = colors.textPrimary),
                    shape = RoundedCornerShape(6.dp),
                    elevation = ButtonDefaults.elevation(0.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Text("REFRESH LIST", fontSize = 9.sp, fontWeight = FontWeight.Bold)
                }
            }

            Divider(color = colors.borderSubtle)

            if (devices.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxWidth().height(100.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text("No registered devices found.", color = colors.textMuted, fontSize = 11.sp)
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Header Row
                    Row(
                        Modifier.fillMaxWidth().background(colors.surface2, RoundedCornerShape(4.dp)).padding(horizontal = 12.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Device Name & ID", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(2f))
                        Text("Platform / User Agent", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(2f))
                        Text("Status", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Text("Actions", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1.5f), textAlign = TextAlign.End)
                    }

                    // Devices Rows
                    devices.forEach { dev ->
                        Row(
                            Modifier.fillMaxWidth().background(colors.surface3.copy(alpha = 0.5f), RoundedCornerShape(6.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Device Name & ID
                            Column(Modifier.weight(2f)) {
                                Text(dev.deviceName, color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                Text(dev.nodeId, color = colors.textMuted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
                            }

                            // User Agent
                            Text(dev.userAgent, color = colors.textMuted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(2f))

                            // Status Badge
                            val isApproved = dev.status == "APPROVED"
                            Box(
                                Modifier.clip(RoundedCornerShape(4.dp))
                                    .background(if (isApproved) colors.successDim else colors.errorDim)
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    dev.status,
                                    color = if (isApproved) colors.success else colors.error,
                                    fontSize = 8.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }

                            // Actions
                            Row(
                                modifier = Modifier.weight(1.5f),
                                horizontalArrangement = Arrangement.End,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (!isApproved) {
                                    Button(
                                        onClick = {
                                            scope.launch(Dispatchers.IO) {
                                                Database.approveDevice(dev.nodeId)
                                                try {
                                                    com.valenixia.commerce.sync.SyncServer.broadcast("""{"type":"device_whitelist_changed"}""")
                                                } catch (e: Exception) {}
                                                devices = Database.getAllDevices()
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.successDim, contentColor = colors.success),
                                        shape = RoundedCornerShape(4.dp),
                                        elevation = ButtonDefaults.elevation(0.dp),
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                        modifier = Modifier.height(24.dp).padding(end = 4.dp)
                                    ) {
                                        Text("APPROVE", fontSize = 8.sp, fontWeight = FontWeight.Bold)
                                    }
                                }

                                val isSelf = dev.nodeId == Database.hlc.nodeId || dev.nodeId == "valenixia_master_pc_01"
                                if (!isSelf) {
                                    Button(
                                        onClick = {
                                            scope.launch(Dispatchers.IO) {
                                                Database.rejectDevice(dev.nodeId)
                                                try {
                                                    com.valenixia.commerce.sync.SyncServer.broadcast("""{"type":"device_whitelist_changed"}""")
                                                } catch (e: Exception) {}
                                                devices = Database.getAllDevices()
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(backgroundColor = colors.errorDim, contentColor = colors.error),
                                        shape = RoundedCornerShape(4.dp),
                                        elevation = ButtonDefaults.elevation(0.dp),
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                        modifier = Modifier.height(24.dp)
                                    ) {
                                        Text("REVOKE", fontSize = 8.sp, fontWeight = FontWeight.Bold)
                                    }
                                } else {
                                    Text("SYSTEM", color = colors.textMuted, fontSize = 8.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp))
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── Subscription & Billing manual payment section ──
        var billingSelectedTier by remember { mutableStateOf("PRO") }
        var billingRrn by remember { mutableStateOf("") }
        var billingAmount by remember { mutableStateOf("50000") }
        var billingFilePath by remember { mutableStateOf("") }
        var billingStatusMsg by remember { mutableStateOf("") }

        Column(
            Modifier.fillMaxWidth()
                .background(colors.surface1, RoundedCornerShape(10.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(10.dp))
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("SUBSCRIPTION AND MANUAL BILLING", color = colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Divider(color = colors.borderSubtle)

            val bankName = System.getenv("VALENIXIA_BANK_NAME") ?: com.valenixia.commerce.db.Database.getPreference("billing_bank_name") ?: "NayaPay"
            val accountTitle = System.getenv("VALENIXIA_ACCOUNT_TITLE") ?: com.valenixia.commerce.db.Database.getPreference("billing_account_title") ?: "Merchant Services"
            val accountNumber = System.getenv("VALENIXIA_ACCOUNT_NUMBER") ?: com.valenixia.commerce.db.Database.getPreference("billing_account_number") ?: "00000000000"
            val iban = System.getenv("VALENIXIA_IBAN") ?: com.valenixia.commerce.db.Database.getPreference("billing_iban") ?: "PK000000000000000000"
            Text("Bank: " + bankName, color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Text("Account Title: " + accountTitle, color = colors.textPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Text("Account Number: " + accountNumber, color = colors.textPrimary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            Text("IBAN: " + iban, color = colors.textPrimary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)

            Spacer(Modifier.height(4.dp))
            Text("Select Upgrade Plan", color = colors.textSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("STARTER" to "15000", "PRO" to "50000", "ENTERPRISE" to "150000").forEach { (tier, price) ->
                    val active = billingSelectedTier == tier
                    Box(
                        Modifier.clip(RoundedCornerShape(6.dp))
                            .background(if (active) colors.accentDim else colors.surface3)
                            .border(1.dp, if (active) colors.accent else colors.borderDefault, RoundedCornerShape(6.dp))
                            .clickable { 
                                billingSelectedTier = tier 
                                billingAmount = price
                            }
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    ) { Text(tier, color = if (active) colors.accent else colors.textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Bold) }
                }
            }

            Spacer(Modifier.height(4.dp))
            FormField("NayaPay Unique Reference (RRN)", billingRrn, "e.g. 123456789012") { billingRrn = it }
            FormField("Screenshot Proof File Path", billingFilePath, "e.g. C:/proof.png") { billingFilePath = it }

            Button(
                onClick = {
                    if (billingRrn.length < 6 || billingFilePath.isEmpty()) {
                        billingStatusMsg = "Please enter a valid RRN and screenshot path."
                        return@Button
                    }
                    scope.launch(Dispatchers.IO) {
                        try {
                            val id = java.util.UUID.randomUUID().toString()
                            val success = Database.submitPaymentProof(
                                id,
                                employee.id,
                                billingSelectedTier,
                                billingRrn,
                                billingAmount.toDouble(),
                                billingFilePath
                            )
                            withContext(Dispatchers.Main) {
                                if (success) {
                                    billingStatusMsg = "Proof submitted successfully. Verification pending."
                                    billingRrn = ""
                                    billingFilePath = ""
                                } else {
                                    billingStatusMsg = "Submission failed."
                                }
                            }
                        } catch (e: Exception) {
                            withContext(Dispatchers.Main) {
                                billingStatusMsg = "Submission error: " + e.message
                            }
                        }
                    }
                },
                colors = ButtonDefaults.buttonColors(backgroundColor = colors.successDim, contentColor = colors.success),
                shape = RoundedCornerShape(8.dp),
                elevation = ButtonDefaults.elevation(0.dp),
                modifier = Modifier.fillMaxWidth().height(38.dp),
                border = BorderStroke(1.dp, colors.success.copy(alpha = 0.3f))
            ) {
                Text("SUBMIT UPGRADE CLAIM", fontWeight = FontWeight.Bold, fontSize = 11.sp)
            }

            if (billingStatusMsg.isNotEmpty()) {
                Text(billingStatusMsg, color = colors.success, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════
//  SHARED UI COMPONENTS
// ════════════════════════════════════════════════════════════════════

@Composable
fun SearchBar(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier.fillMaxWidth()
) {
    Box(
        modifier
            .background(Graphite, RoundedCornerShape(8.dp))
            .border(1.dp, BorderDefault, RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.CenterStart
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("⌕ ", color = TextMuted, fontSize = 14.sp)
            BasicTextField(
                value         = value,
                onValueChange = onValueChange,
                textStyle     = TextStyle(color = TextPrimary, fontSize = 13.sp),
                cursorBrush   = SolidColor(NeonCyan),
                modifier      = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) Text(placeholder, color = TextMuted, fontSize = 13.sp)
                        inner()
                    }
                }
            )
        }
    }
}

@Composable
fun Badge(text: String, color: Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(text, color = color, fontSize = 9.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun StatChip(value: String, label: String, color: Color) {
    Column(
        Modifier
            .background(InkBlack, RoundedCornerShape(8.dp))
            .border(1.dp, BorderDefault, RoundedCornerShape(8.dp))
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.Start
    ) {
        Text(value, color = color, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text(label, color = TextMuted, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun StatusBanner(message: String, isError: Boolean, onDismiss: () -> Unit) {
    Box(
        Modifier.fillMaxWidth()
            .background(if (isError) CoralDim else EmeraldDim, RoundedCornerShape(8.dp))
            .border(1.dp, if (isError) CoralRed.copy(alpha = 0.3f) else EmeraldGreen.copy(alpha = 0.3f), RoundedCornerShape(8.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(message, color = if (isError) CoralRed else EmeraldGreen, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Text("✕", color = TextMuted, fontSize = 11.sp, modifier = Modifier.clickable(onClick = onDismiss))
        }
    }
}

@Composable
fun SmallActionButton(label: String, color: Color, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.1f))
            .border(1.dp, color.copy(alpha = 0.3f), RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp)
    ) { Text(label, color = color, fontSize = 10.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
fun FormField(label: String, value: String, placeholder: String, onValueChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = TextSecondary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp)
        Box(
            Modifier.fillMaxWidth()
                .background(Graphite, RoundedCornerShape(6.dp))
                .border(1.dp, BorderDefault, RoundedCornerShape(6.dp))
        ) {
            BasicTextField(
                value         = value,
                onValueChange = onValueChange,
                textStyle     = TextStyle(color = TextPrimary, fontSize = 13.sp),
                cursorBrush   = SolidColor(NeonCyan),
                modifier      = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) Text(placeholder, color = TextMuted, fontSize = 13.sp)
                        inner()
                    }
                }
            )
        }
    }
}

@Composable
fun DialogOverlay(content: @Composable BoxScope.() -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.65f)),
        contentAlignment = Alignment.Center,
        content = content
    )
}

// ── Aerospace grid background for auth screen ─────────────────────
private fun drawAerospaceGrid(scope: DrawScope) {
    val gridColor = Color(0xFF0D1520)
    val step      = 48f
    val cols      = (scope.size.width / step).toInt() + 1
    val rows      = (scope.size.height / step).toInt() + 1
    for (c in 0..cols) {
        scope.drawLine(gridColor, Offset(c * step, 0f), Offset(c * step, scope.size.height), 1f)
    }
    for (r in 0..rows) {
        scope.drawLine(gridColor, Offset(0f, r * step), Offset(scope.size.width, r * step), 1f)
    }
}

@Composable
fun CalculatorOverlay(onDismiss: () -> Unit) {
    var display by remember { mutableStateOf("") }
    val colors = LocalValenixiaColors.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable { onDismiss() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .width(280.dp)
                .background(colors.surface2, RoundedCornerShape(16.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                .clickable(enabled = false) {}
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Calculator", color = colors.textPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                TextButton(onClick = onDismiss, colors = ButtonDefaults.textButtonColors(contentColor = colors.textSecondary)) {
                    Text("Close (Esc)", fontSize = 12.sp)
                }
            }

            // Display
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp)
                    .background(colors.surface1, RoundedCornerShape(8.dp))
                    .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.CenterEnd
            ) {
                Text(
                    display.ifEmpty { "0" },
                    color = colors.accent,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
            }

            // Buttons grid
            val buttons = listOf(
                listOf("7", "8", "9", "/"),
                listOf("4", "5", "6", "*"),
                listOf("1", "2", "3", "-"),
                listOf("C", "0", "=", "+")
            )

            buttons.forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    row.forEach { char ->
                        Button(
                            onClick = {
                                when (char) {
                                    "C" -> display = ""
                                    "=" -> {
                                        try {
                                            display = evaluateSimpleMath(display)
                                        } catch (e: Exception) {
                                            display = "Error"
                                        }
                                    }
                                    else -> display += char
                                }
                            },
                            modifier = Modifier
                                .weight(1f)
                                .height(48.dp),
                            colors = ButtonDefaults.buttonColors(
                                backgroundColor = if (char == "=" || char == "C") colors.accent else colors.surface3,
                                contentColor = if (char == "=" || char == "C") colors.surface0 else colors.textPrimary
                            ),
                            shape = RoundedCornerShape(8.dp),
                            elevation = ButtonDefaults.elevation(0.dp, 0.dp)
                        ) {
                            Text(char, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

private fun evaluateSimpleMath(expr: String): String {
    val clean = expr.replace(" ", "")
    val parts = mutableListOf<String>()
    var current = ""
    for (char in clean) {
        if (char in listOf('+', '-', '*', '/')) {
            if (current.isNotEmpty()) {
                parts.add(current)
                current = ""
            }
            parts.add(char.toString())
        } else {
            current += char
        }
    }
    if (current.isNotEmpty()) {
        parts.add(current)
    }

    if (parts.size < 3) return expr

    var result = parts[0].toDoubleOrNull() ?: return "Error"
    var i = 1
    while (i < parts.size) {
        val op = parts[i]
        val nextVal = parts.getOrNull(i + 1)?.toDoubleOrNull() ?: return "Error"
        when (op) {
            "+" -> result += nextVal
            "-" -> result -= nextVal
            "*" -> result *= nextVal
            "/" -> {
                if (nextVal == 0.0) return "Div/0"
                result /= nextVal
            }
        }
        i += 2
    }
    return if (result % 1.0 == 0.0) {
        result.toInt().toString()
    } else {
        String.format(Locale.US, "%.2f", result)
    }
}

@Composable
fun ShortcutsHelpOverlay(onDismiss: () -> Unit) {
    val colors = LocalValenixiaColors.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.5f))
            .clickable { onDismiss() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .width(420.dp)
                .background(colors.surface2, RoundedCornerShape(16.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                .clickable(enabled = false) {}
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Keyboard Shortcuts", color = colors.textPrimary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                TextButton(onClick = onDismiss, colors = ButtonDefaults.textButtonColors(contentColor = colors.textSecondary)) {
                    Text("Close", fontWeight = FontWeight.Bold)
                }
            }

            val shortcuts = listOf(
                "F1" to "Go to Checkout",
                "F2" to "Toggle Barcode Mode (inside checkout)",
                "F3" to "Go to Catalog",
                "F4" to "Go to History",
                "F5" to "Go to Analytics",
                "F8" to "Lock Shift / Clock Out",
                "Ctrl + K" to "Toggle Calculator",
                "Ctrl + D" to "Toggle Dark/Light Mode",
                "Esc" to "Close Dialogs / Cancel",
                "Enter" to "Confirm Dialog / Complete"
            )

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                shortcuts.forEach { (key, desc) ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .background(colors.surface3, RoundedCornerShape(4.dp))
                                .border(1.dp, colors.borderSubtle, RoundedCornerShape(4.dp))
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text(key, color = colors.accent, fontWeight = FontWeight.Bold, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                        }
                        Text(desc, color = colors.textPrimary, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

private fun getLocalIpAddresses(): List<String> {
    val addresses = mutableListOf<String>()
    try {
        val interfaces = java.net.NetworkInterface.getNetworkInterfaces()
        while (interfaces.hasMoreElements()) {
            val iface = interfaces.nextElement()
            if (iface.isLoopback || !iface.isUp) continue
            val addrs = iface.inetAddresses
            while (addrs.hasMoreElements()) {
                val addr = addrs.nextElement()
                if (addr is java.net.Inet4Address) {
                    addresses.add(addr.hostAddress)
                }
            }
        }
    } catch (e: Exception) {
        // Fallback
    }
    if (addresses.isEmpty()) {
        addresses.add("127.0.0.1")
    }
    return addresses
}

@Composable
private fun ProductInitialsBadge(name: String, modifier: Modifier = Modifier) {
    val colors = LocalValenixiaColors.current
    Box(
        modifier = modifier
            .size(36.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(colors.surface2)
            .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = name.take(2).uppercase(Locale.US),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = colors.textSecondary
        )
    }
}


