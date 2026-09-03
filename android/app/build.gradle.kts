plugins {
  id("com.android.application")
}

android {
  namespace = "com.learnershift.fridgemenu"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.learnershift.fridgemenu"
    minSdk = 23
    targetSdk = 36
    versionCode = 2
    versionName = "1.0.0"
  }

  val releaseSigningValues = mapOf(
    "storeFile" to System.getenv("FRIDGE_MENU_KEYSTORE_PATH"),
    "storePassword" to System.getenv("FRIDGE_MENU_KEYSTORE_PASSWORD"),
    "keyAlias" to System.getenv("FRIDGE_MENU_KEY_ALIAS"),
    "keyPassword" to System.getenv("FRIDGE_MENU_KEY_PASSWORD"),
  )
  val releaseSigningRequested = releaseSigningValues.values.any { !it.isNullOrBlank() }
  val releaseSigningConfigured = releaseSigningValues.values.all { !it.isNullOrBlank() }
  if (releaseSigningRequested && !releaseSigningConfigured) {
    throw GradleException("Release signing requires all FRIDGE_MENU_KEYSTORE_* environment variables.")
  }
  val configuredKeystore = if (releaseSigningConfigured) {
    file(releaseSigningValues.getValue("storeFile")!!).canonicalFile
  } else null
  if (configuredKeystore != null && configuredKeystore.toPath().startsWith(rootProject.projectDir.parentFile.canonicalFile.toPath())) {
    throw GradleException("Release keystore must be outside the repository.")
  }

  signingConfigs {
    create("release") {
      if (releaseSigningConfigured) {
        storeFile = configuredKeystore
        storePassword = releaseSigningValues.getValue("storePassword")
        keyAlias = releaseSigningValues.getValue("keyAlias")
        keyPassword = releaseSigningValues.getValue("keyPassword")
      }
    }
  }

  buildTypes {
    release {
      signingConfig = if (releaseSigningConfigured) signingConfigs.getByName("release") else null
      isMinifyEnabled = false
    }
  }
}

dependencies {
  implementation("androidx.webkit:webkit:1.14.0")
}
