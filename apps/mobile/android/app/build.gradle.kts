plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val googleMapsApiKey = providers.gradleProperty("GOOGLE_MAPS_ANDROID_API_KEY")
    .orElse(providers.environmentVariable("GOOGLE_MAPS_ANDROID_API_KEY"))
    .orElse("")

if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Navigation SDK already bundles the Google Maps SDK classes. Keeping the
// transitive play-services-maps artifact from google_maps_flutter would package
// the same classes twice. Both Flutter views use the single Maps implementation
// provided by Navigation SDK.
configurations.configureEach {
    exclude(group = "com.google.android.gms", module = "play-services-maps")
}

android {
    namespace = "ec.atacames.mototaxi.mototaxi_atacames"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "ec.atacames.mototaxi.mototaxi_atacames"
        minSdk = 24
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["googleMapsApiKey"] = googleMapsApiKey.get()
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
