plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val durableKeystorePath = System.getenv("ANDROID_SIGNING_KEYSTORE_PATH")
val durableStorePassword = System.getenv("ANDROID_SIGNING_STORE_PASSWORD")
val durableKeyAlias = System.getenv("ANDROID_SIGNING_KEY_ALIAS")
val durableKeyPassword = System.getenv("ANDROID_SIGNING_KEY_PASSWORD")
val durableSigningAvailable = listOf(
    durableKeystorePath,
    durableStorePassword,
    durableKeyAlias,
    durableKeyPassword
).all { !it.isNullOrBlank() }

android {
    namespace = "com.stefm78.offlineinterview.nativepoc"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.stefm78.offlineinterview.nativepoc"
        minSdk = 33
        targetSdk = 36
        versionCode = 8
        versionName = "0.4.2-h3-tactical"
    }

    buildFeatures {
        buildConfig = true
    }

    if (durableSigningAvailable) {
        signingConfigs {
            create("durable") {
                storeFile = file(durableKeystorePath!!)
                storePassword = durableStorePassword
                keyAlias = durableKeyAlias
                keyPassword = durableKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            if (durableSigningAvailable) {
                signingConfig = signingConfigs.getByName("durable")
            }
        }
        release {
            isMinifyEnabled = false
            if (durableSigningAvailable) {
                signingConfig = signingConfigs.getByName("durable")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}
