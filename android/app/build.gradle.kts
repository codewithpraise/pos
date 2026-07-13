plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.valenixia.pos"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.valenixia.pos"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("RELEASE_STORE_FILE") ?: "release-key.jks")
            storePassword = System.getenv("RELEASE_STORE_PASSWORD") ?: "valenixiapos"
            keyAlias = System.getenv("RELEASE_KEY_ALIAS") ?: "valenixia"
            keyPassword = System.getenv("RELEASE_KEY_PASSWORD") ?: "valenixiapos"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            val javaClass = java.javaClass
            val method = javaClass.methods.firstOrNull { it.name == "exclude" && it.parameterTypes.size == 1 && (it.parameterTypes[0] == Iterable::class.java || it.parameterTypes[0].name.contains("Iterable") || it.parameterTypes[0].name.contains("List")) }
            method?.invoke(java, listOf("**/MainActivity.java"))
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.google.android.material:material:1.12.0")

    // Local JVM Unit Tests
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.11.1")
    testImplementation("org.mockito:mockito-core:5.8.0")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.2.1")

    // Instrumented tests (Espresso & UI Automator)
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation("androidx.test.espresso:espresso-intents:3.5.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
