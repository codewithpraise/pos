plugins {
    kotlin("multiplatform") version "1.9.22"
    kotlin("plugin.serialization") version "1.9.22"
    id("org.jetbrains.compose") version "1.5.12"
}

group = "com.nexova"
version = "1.0.0"

repositories {
    mavenCentral()
    maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
}

kotlin {
    jvm("jvm") {
        compilations.all {
            kotlinOptions.jvmTarget = "17"
        }
    }
    sourceSets {
        val jvmMain by getting {
            dependencies {
                implementation(compose.desktop.currentOs)
                // SQLite JDBC driver for database access (bundles native Windows DLLs)
                implementation("org.xerial:sqlite-jdbc:3.45.1.0")
                // Ktor for WebSockets and HTTP server sync features
                implementation("io.ktor:ktor-server-core:2.3.8")
                implementation("io.ktor:ktor-server-auth-jwt:2.3.8")
                implementation("io.ktor:ktor-server-netty:2.3.8")
                implementation("io.ktor:ktor-server-websockets:2.3.8")
                implementation("io.ktor:ktor-client-core:2.3.8")
                implementation("io.ktor:ktor-client-okhttp:2.3.8")
                implementation("io.ktor:ktor-client-websockets:2.3.8")
                // Serialization
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")
                // Coroutines + Swing Main dispatcher for JVM desktop
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-swing:1.8.0")
                // JavaFX dependencies for modern WebView embedding on Windows
                val openjfxVersion = "21.0.2"
                implementation("org.openjfx:javafx-base:$openjfxVersion:win")
                implementation("org.openjfx:javafx-controls:$openjfxVersion:win")
                implementation("org.openjfx:javafx-graphics:$openjfxVersion:win")
                implementation("org.openjfx:javafx-web:$openjfxVersion:win")
                implementation("org.openjfx:javafx-swing:$openjfxVersion:win")
                implementation("org.openjfx:javafx-media:$openjfxVersion:win")
            }
        }
    }
}

compose.desktop {
    application {
        mainClass = "com.nexova.commerce.MainKt"
        nativeDistributions {
            targetFormats(org.jetbrains.compose.desktop.application.dsl.TargetFormat.Msi, org.jetbrains.compose.desktop.application.dsl.TargetFormat.Exe)
            packageName = "NexovaPOS"
            packageVersion = "1.0.0"
        }
    }
}
