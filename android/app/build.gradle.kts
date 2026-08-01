plugins {
  id("com.android.application")
}

android {
  namespace = "com.learnershift.fridgemenu"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.learnershift.fridgemenu"
    minSdk = 23
    targetSdk = 35
    versionCode = 1
    versionName = "1.0.0"
  }

  buildTypes {
    release {
      // Intentionally unsigned: the Play Console owner supplies app signing.
      signingConfig = null
      isMinifyEnabled = false
    }
  }
}
