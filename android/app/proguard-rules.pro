# Add project specific ProGuard rules here.
-keep class com.nexova.pos.** { *; }
-keepclassmembers class * implements android.webkit.JavascriptInterface {
   <methods>;
}
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keep class com.nexova.pos.MainActivity$* { *; }
