# Add project specific ProGuard rules here.

# Keep the JavascriptInterface methods
-keepclassmembers class * implements android.webkit.JavascriptInterface {
   <methods>;
}
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# Keep MainActivity and its inner classes (like AndroidPOSBridge) intact
-keep class com.valenixia.pos.MainActivity { *; }
-keep class com.valenixia.pos.MainActivity$* { *; }

# Keep BuildConfig to prevent class/field stripping
-keep class com.valenixia.pos.BuildConfig { *; }
