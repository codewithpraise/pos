# Add project specific ProGuard rules here.
-keep class com.nexova.pos.** { *; }
-keepclassmembers class * implements android.webkit.JavascriptInterface {
   <methods>;
}
