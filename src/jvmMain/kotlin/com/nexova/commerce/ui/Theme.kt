package com.nexova.commerce.ui

import androidx.compose.material.MaterialTheme
import androidx.compose.material.Typography
import androidx.compose.material.darkColors
import androidx.compose.material.lightColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.spring

data class NexovaColors(
    val surface0: Color,
    val surface1: Color,
    val surface2: Color,
    val surface3: Color,
    val surfaceHover: Color,
    val sidebarBg: Color,
    val borderSubtle: Color,
    val borderDefault: Color,
    val borderFocus: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val accent: Color,
    val accentDim: Color,
    val accentGlow: Color,
    val success: Color,
    val successDim: Color,
    val warning: Color,
    val warningDim: Color,
    val error: Color,
    val errorDim: Color,
    val info: Color,
    val infoDim: Color,
    val sidebarAccent: Color,
    val navItemActive: Color,
    val navItemHover: Color,
    val rowEven: Color,
    val rowOdd: Color
)

val ObsidianEmerald = NexovaColors(
    surface0 = Color(0xFF000000),
    surface1 = Color(0xFF050505),
    surface2 = Color(0xFF0D0D0D),
    surface3 = Color(0xFF151515),
    surfaceHover = Color(0xFF1C1C1C),
    sidebarBg = Color(0xFF050505),
    borderSubtle = Color(0x14FFFFFF), // rgba(255,255,255,0.08)
    borderDefault = Color(0x1FFFFFFF), // rgba(255,255,255,0.12)
    borderFocus = Color(0xFF10B981),
    textPrimary = Color(0xFFF8FAFC),
    textSecondary = Color(0xFF94A3B8),
    textMuted = Color(0xFF475569),
    accent = Color(0xFF10B981),
    accentDim = Color(0xFF10B981).copy(alpha = 0.15f),
    accentGlow = Color(0xFF34D399),
    success = Color(0xFF10B981),
    successDim = Color(0xFF10B981).copy(alpha = 0.15f),
    warning = Color(0xFFF59E0B),
    warningDim = Color(0xFFF59E0B).copy(alpha = 0.15f),
    error = Color(0xFFEF4444),
    errorDim = Color(0xFFEF4444).copy(alpha = 0.15f),
    info = Color(0xFF3B82F6),
    infoDim = Color(0xFF3B82F6).copy(alpha = 0.15f),
    sidebarAccent = Color(0xFF10B981),
    navItemActive = Color(0xFF1C1C1C),
    navItemHover = Color(0xFF0D0D0D),
    rowEven = Color(0xFF050505),
    rowOdd = Color(0xFF0D0D0D)
)

val MidnightSapphire = NexovaColors(
    surface0 = Color(0xFF020617),
    surface1 = Color(0xFF0F172A),
    surface2 = Color(0xFF1E293B),
    surface3 = Color(0xFF334155),
    surfaceHover = Color(0xFF3E4E68),
    sidebarBg = Color(0xFF0F172A),
    borderSubtle = Color(0xFF1E3A8A),
    borderDefault = Color(0xFF2E4C9C),
    borderFocus = Color(0xFF3B82F6),
    textPrimary = Color(0xFFF8FAFC),
    textSecondary = Color(0xFF94A3B8),
    textMuted = Color(0xFF475569),
    accent = Color(0xFF3B82F6),
    accentDim = Color(0xFF3B82F6).copy(alpha = 0.15f),
    accentGlow = Color(0xFF60A5FA),
    success = Color(0xFF10B981),
    successDim = Color(0xFF10B981).copy(alpha = 0.15f),
    warning = Color(0xFFF59E0B),
    warningDim = Color(0xFFF59E0B).copy(alpha = 0.15f),
    error = Color(0xFFEF4444),
    errorDim = Color(0xFFEF4444).copy(alpha = 0.15f),
    info = Color(0xFF60A5FA),
    infoDim = Color(0xFF60A5FA).copy(alpha = 0.15f),
    sidebarAccent = Color(0xFF3B82F6),
    navItemActive = Color(0xFF1E293B),
    navItemHover = Color(0xFF141E30),
    rowEven = Color(0xFF0F172A),
    rowOdd = Color(0xFF17233E)
)

val WarmAmber = NexovaColors(
    surface0 = Color(0xFF1C1917),
    surface1 = Color(0xFF292524),
    surface2 = Color(0xFF44403C),
    surface3 = Color(0xFF57534E),
    surfaceHover = Color(0xFF6A655F),
    sidebarBg = Color(0xFF292524),
    borderSubtle = Color(0xFF78716C),
    borderDefault = Color(0xFF8C857F),
    borderFocus = Color(0xFFD97706),
    textPrimary = Color(0xFFFAFAF9),
    textSecondary = Color(0xFFA8A29E),
    textMuted = Color(0xFF78716C),
    accent = Color(0xFFD97706),
    accentDim = Color(0xFFD97706).copy(alpha = 0.15f),
    accentGlow = Color(0xFFF59E0B),
    success = Color(0xFF10B981),
    successDim = Color(0xFF10B981).copy(alpha = 0.15f),
    warning = Color(0xFFF59E0B),
    warningDim = Color(0xFFF59E0B).copy(alpha = 0.15f),
    error = Color(0xFFEF4444),
    errorDim = Color(0xFFEF4444).copy(alpha = 0.15f),
    info = Color(0xFF3B82F6),
    infoDim = Color(0xFF3B82F6).copy(alpha = 0.15f),
    sidebarAccent = Color(0xFFD97706),
    navItemActive = Color(0xFF44403C),
    navItemHover = Color(0xFF2E2A27),
    rowEven = Color(0xFF292524),
    rowOdd = Color(0xFF35302D)
)

val MinimalistChrome = NexovaColors(
    surface0 = Color(0xFF000000),
    surface1 = Color(0xFF121212),
    surface2 = Color(0xFF222222),
    surface3 = Color(0xFF333333),
    surfaceHover = Color(0xFF444444),
    sidebarBg = Color(0xFF121212),
    borderSubtle = Color(0xFF333333),
    borderDefault = Color(0xFF444444),
    borderFocus = Color(0xFFFFFFFF),
    textPrimary = Color(0xFFFFFFFF),
    textSecondary = Color(0xFFA3A3A3),
    textMuted = Color(0xFF737373),
    accent = Color(0xFFFFFFFF),
    accentDim = Color(0xFFFFFFFF).copy(alpha = 0.10f),
    accentGlow = Color(0xFFE5E5E5),
    success = Color(0xFF10B981),
    successDim = Color(0xFF10B981).copy(alpha = 0.12f),
    warning = Color(0xFFF59E0B),
    warningDim = Color(0xFFF59E0B).copy(alpha = 0.12f),
    error = Color(0xFFEF4444),
    errorDim = Color(0xFFEF4444).copy(alpha = 0.12f),
    info = Color(0xFF3B82F6),
    infoDim = Color(0xFF3B82F6).copy(alpha = 0.12f),
    sidebarAccent = Color(0xFFFFFFFF),
    navItemActive = Color(0xFF222222),
    navItemHover = Color(0xFF1C1C1C),
    rowEven = Color(0xFF121212),
    rowOdd = Color(0xFF1E1E1E)
)

val MonochromeIvory = NexovaColors(
    surface0 = Color(0xFFF5F5F4),
    surface1 = Color(0xFFE7E5E4),
    surface2 = Color(0xFFD6D3D1),
    surface3 = Color(0xFFA8A29E),
    surfaceHover = Color(0xFFC2BEB9),
    sidebarBg = Color(0xFFE7E5E4),
    borderSubtle = Color(0xFFA8A29E),
    borderDefault = Color(0xFF78716C),
    borderFocus = Color(0xFF1C1917),
    textPrimary = Color(0xFF1C1917),
    textSecondary = Color(0xFF44403C),
    textMuted = Color(0xFF78716C),
    accent = Color(0xFF1C1917),
    accentDim = Color(0xFF1C1917).copy(alpha = 0.08f),
    accentGlow = Color(0xFF000000),
    success = Color(0xFF10B981),
    successDim = Color(0xFF10B981).copy(alpha = 0.12f),
    warning = Color(0xFFD97706),
    warningDim = Color(0xFFD97706).copy(alpha = 0.12f),
    error = Color(0xFFDC2626),
    errorDim = Color(0xFFDC2626).copy(alpha = 0.12f),
    info = Color(0xFF2563EB),
    infoDim = Color(0xFF2563EB).copy(alpha = 0.12f),
    sidebarAccent = Color(0xFF1C1917),
    navItemActive = Color(0xFFD6D3D1),
    navItemHover = Color(0xFFE5E2DF),
    rowEven = Color(0xFFE7E5E4),
    rowOdd = Color(0xFFECEAEA)
)

val LocalNexovaColors = staticCompositionLocalOf { ObsidianEmerald }
val LocalIsDarkMode = staticCompositionLocalOf { true }

// Legacy color properties using @get:Composable for seamless integration
val Obsidian: Color @Composable get() = LocalNexovaColors.current.surface0
val InkBlack: Color @Composable get() = LocalNexovaColors.current.surface1
val Graphite: Color @Composable get() = LocalNexovaColors.current.surface2
val GraphiteLight: Color @Composable get() = LocalNexovaColors.current.surface3
val GraphiteHover: Color @Composable get() = LocalNexovaColors.current.surfaceHover
val SidebarBg: Color @Composable get() = LocalNexovaColors.current.sidebarBg
val BorderSubtle: Color @Composable get() = LocalNexovaColors.current.borderSubtle
val BorderDefault: Color @Composable get() = LocalNexovaColors.current.borderDefault
val BorderFocus: Color @Composable get() = LocalNexovaColors.current.borderFocus
val TextPrimary: Color @Composable get() = LocalNexovaColors.current.textPrimary
val TextSecondary: Color @Composable get() = LocalNexovaColors.current.textSecondary
val TextMuted: Color @Composable get() = LocalNexovaColors.current.textMuted
val Titanium: Color @Composable get() = LocalNexovaColors.current.textSecondary
val NeonCyan: Color @Composable get() = LocalNexovaColors.current.accent
val NeonCyanDim: Color @Composable get() = LocalNexovaColors.current.accentDim
val NeonCyanGlow: Color @Composable get() = LocalNexovaColors.current.accentGlow
val EmeraldGreen: Color @Composable get() = LocalNexovaColors.current.success
val EmeraldDim: Color @Composable get() = LocalNexovaColors.current.successDim
val NeonEmerald: Color @Composable get() = LocalNexovaColors.current.success
val AmberOrange: Color @Composable get() = LocalNexovaColors.current.warning
val AmberDim: Color @Composable get() = LocalNexovaColors.current.warningDim
val CoralRed: Color @Composable get() = LocalNexovaColors.current.error
val CoralDim: Color @Composable get() = LocalNexovaColors.current.errorDim
val AlertCoral: Color @Composable get() = LocalNexovaColors.current.error
val IndigoBlue: Color @Composable get() = LocalNexovaColors.current.info
val IndigoDim: Color @Composable get() = LocalNexovaColors.current.infoDim
val SidebarAccent: Color @Composable get() = LocalNexovaColors.current.sidebarAccent
val NavItemActive: Color @Composable get() = LocalNexovaColors.current.navItemActive
val NavItemHover: Color @Composable get() = LocalNexovaColors.current.navItemHover
val RowEven: Color @Composable get() = LocalNexovaColors.current.rowEven
val RowOdd: Color @Composable get() = LocalNexovaColors.current.rowOdd

@Composable
fun NexovaTheme(themeName: String = "Obsidian Emerald", content: @Composable () -> Unit) {
    val targetColors = when (themeName) {
        "Midnight Sapphire" -> MidnightSapphire
        "Warm Amber"        -> WarmAmber
        "Minimalist Chrome" -> MinimalistChrome
        "Monochrome Ivory"  -> MonochromeIvory
        else                -> ObsidianEmerald
    }
    val isLight = themeName == "Monochrome Ivory"
    
    // Animate all color shifts via a spring spec (under 200ms feel)
    val colorSpec = spring<Color>(stiffness = 350f, dampingRatio = 0.85f)
    
    val animatedColors = NexovaColors(
        surface0 = animateColorAsState(targetColors.surface0, colorSpec).value,
        surface1 = animateColorAsState(targetColors.surface1, colorSpec).value,
        surface2 = animateColorAsState(targetColors.surface2, colorSpec).value,
        surface3 = animateColorAsState(targetColors.surface3, colorSpec).value,
        surfaceHover = animateColorAsState(targetColors.surfaceHover, colorSpec).value,
        sidebarBg = animateColorAsState(targetColors.sidebarBg, colorSpec).value,
        borderSubtle = animateColorAsState(targetColors.borderSubtle, colorSpec).value,
        borderDefault = animateColorAsState(targetColors.borderDefault, colorSpec).value,
        borderFocus = animateColorAsState(targetColors.borderFocus, colorSpec).value,
        textPrimary = animateColorAsState(targetColors.textPrimary, colorSpec).value,
        textSecondary = animateColorAsState(targetColors.textSecondary, colorSpec).value,
        textMuted = animateColorAsState(targetColors.textMuted, colorSpec).value,
        accent = animateColorAsState(targetColors.accent, colorSpec).value,
        accentDim = animateColorAsState(targetColors.accentDim, colorSpec).value,
        accentGlow = animateColorAsState(targetColors.accentGlow, colorSpec).value,
        success = animateColorAsState(targetColors.success, colorSpec).value,
        successDim = animateColorAsState(targetColors.successDim, colorSpec).value,
        warning = animateColorAsState(targetColors.warning, colorSpec).value,
        warningDim = animateColorAsState(targetColors.warningDim, colorSpec).value,
        error = animateColorAsState(targetColors.error, colorSpec).value,
        errorDim = animateColorAsState(targetColors.errorDim, colorSpec).value,
        info = animateColorAsState(targetColors.info, colorSpec).value,
        infoDim = animateColorAsState(targetColors.infoDim, colorSpec).value,
        sidebarAccent = animateColorAsState(targetColors.sidebarAccent, colorSpec).value,
        navItemActive = animateColorAsState(targetColors.navItemActive, colorSpec).value,
        navItemHover = animateColorAsState(targetColors.navItemHover, colorSpec).value,
        rowEven = animateColorAsState(targetColors.rowEven, colorSpec).value,
        rowOdd = animateColorAsState(targetColors.rowOdd, colorSpec).value
    )
    
    val materialColors = if (!isLight) {
        darkColors(
            primary = animatedColors.accent,
            primaryVariant = animatedColors.accentGlow,
            secondary = animatedColors.success,
            background = animatedColors.surface0,
            surface = animatedColors.surface2,
            error = animatedColors.error,
            onPrimary = animatedColors.surface0,
            onSecondary = animatedColors.surface0,
            onBackground = animatedColors.textPrimary,
            onSurface = animatedColors.textPrimary
        )
    } else {
        lightColors(
            primary = animatedColors.accent,
            primaryVariant = animatedColors.accentGlow,
            secondary = animatedColors.success,
            background = animatedColors.surface0,
            surface = animatedColors.surface1,
            error = animatedColors.error,
            onPrimary = animatedColors.surface1,
            onSecondary = animatedColors.surface1,
            onBackground = animatedColors.textPrimary,
            onSurface = animatedColors.textPrimary
        )
    }

    CompositionLocalProvider(
        LocalNexovaColors provides animatedColors,
        LocalIsDarkMode provides !isLight
    ) {
        MaterialTheme(
            colors = materialColors,
            typography = Typography(
                defaultFontFamily = FontFamily.SansSerif
            ),
            content = content
        )
    }
}
