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
    versionCode = 1
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

  signingConfigs {
    create("release") {
      if (releaseSigningConfigured) {
        storeFile = file(releaseSigningValues.getValue("storeFile")!!)
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
