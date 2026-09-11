plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.stefm78.offlineinterview.nativepoc"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.stefm78.offlineinterview.nativepoc"
        minSdk = 33
        targetSdk = 36
        versionCode = 4
        versionName = "0.4.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}
