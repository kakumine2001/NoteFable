plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.kakumine.notefable"
    compileSdk = 36

    defaultConfig {
        // Google 登录用 Google Cloud 里登记的 Android 客户端 NoteFable-Android（应用 ID + 各签名的 SHA-1，见 docs/architecture/android.md）。
        applicationId = "com.kakumine.notefable"
        minSdk = 26
        targetSdk = 36
        versionCode = 9
        versionName = "1.0.0"

        val baseUrl = (project.findProperty("notefable.baseUrl") as String).trimEnd('/')
        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
        // 聊天链接的 intent-filter（AndroidManifest）只认本站。
        manifestPlaceholders["notefableScheme"] = baseUrl.substringBefore("://")
        manifestPlaceholders["notefableHost"] = baseUrl.substringAfter("://").substringBefore('/').substringBefore(':')
    }

    // Google Play 的上传密钥。密钥库和密码不进仓库：写在本机的 ~/.gradle/gradle.properties（notefable.upload.*），
    // 所有 worktree 共用。没有配置的电脑上 release 包退回 debug 签名，只能自己侧载试用，不能上传 Play。
    val uploadStore = providers.gradleProperty("notefable.upload.storeFile").orNull
    if (uploadStore != null) {
        signingConfigs.create("upload") {
            storeFile = file(uploadStore)
            storePassword = providers.gradleProperty("notefable.upload.storePassword").get()
            keyAlias = providers.gradleProperty("notefable.upload.keyAlias").get()
            keyPassword = providers.gradleProperty("notefable.upload.keyPassword").get()
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("upload") ?: signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.core.ktx)
    // 应用内切换语言（AppCompatDelegate.setApplicationLocales，Android 13 以下由 AppCompat 保存选择）。
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.markdown.renderer.m3)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.googleid)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
