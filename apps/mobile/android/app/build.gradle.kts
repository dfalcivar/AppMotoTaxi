import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val localSigningProperties = Properties().apply {
    val propertiesFile = rootProject.file("key.properties")
    if (propertiesFile.exists()) {
        propertiesFile.inputStream().use(::load)
    }
}

fun signingValue(environmentName: String, propertyName: String): String? =
    providers.gradleProperty(environmentName).orNull
        ?: providers.environmentVariable(environmentName).orNull
        ?: localSigningProperties.getProperty(propertyName)

val googleMapsApiKey = providers.gradleProperty("GOOGLE_MAPS_ANDROID_API_KEY")
    .orElse(providers.environmentVariable("GOOGLE_MAPS_ANDROID_API_KEY"))
    .orElse("")
val releaseKeystorePath = signingValue("COSTA_GO_KEYSTORE_PATH", "storeFile")
val releaseKeystorePassword = signingValue("COSTA_GO_KEYSTORE_PASSWORD", "storePassword")
val releaseKeyAlias = signingValue("COSTA_GO_KEY_ALIAS", "keyAlias")
val releaseKeyPassword = signingValue("COSTA_GO_KEY_PASSWORD", "keyPassword")
val productionSigningConfigured = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

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
        // Navigation SDK and the current mobile feature set require Android 7.0+.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["googleMapsApiKey"] = googleMapsApiKey.get()
    }

    signingConfigs {
        if (productionSigningConfigured) {
            create("release") {
                storeFile = file(requireNotNull(releaseKeystorePath))
                storePassword = requireNotNull(releaseKeystorePassword)
                keyAlias = requireNotNull(releaseKeyAlias)
                keyPassword = requireNotNull(releaseKeyPassword)
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            // Las pruebas locales conservan firma debug hasta que se configure
            // el almacén privado. El script de producción impide publicar así.
            signingConfig = if (productionSigningConfigured) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
            // Navigation SDK hace que R8 consuma varios GB y bloquee la APK
            // universal de pruebas. La reducción nativa se reserva para el
            // futuro Android App Bundle firmado para Play Store.
            isMinifyEnabled = false
            isShrinkResources = false
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
