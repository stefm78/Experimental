plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.stefm78.offlineinterview.host"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.stefm78.offlineinterview"
        minSdk = 33
        targetSdk = 36
        versionCode = 20
        versionName = "0.8.0-android-native-draft1-tactical"
        buildConfigField("String", "PRODUCT_SOURCE_HEAD", "\"25493983644b3fecbc36c3483b1d11c48f268c09\"")
        buildConfigField("String", "TRANSCRIPTION_PROVIDER_ID", "\"ANDROID_SYSTEM_DEFAULT_V3_DRAFT\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}

val prepareWebAssets = tasks.register<Exec>("prepareWebAssets") {
    workingDir = rootDir
    commandLine("node", "prepare-web-assets.mjs")
}

tasks.named("preBuild").configure {
    dependsOn(prepareWebAssets)
}
