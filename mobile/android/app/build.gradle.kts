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
        // 和 Capacitor 外壳同一个包名：直接覆盖安装旧版，Google 登录沿用已登记的 Android 客户端（包名 + 这台电脑的 debug 签名）。
        applicationId = "com.kakumine.studymate"
        minSdk = 26
        targetSdk = 36
        versionCode = 7
        versionName = "0.4.0"

        val baseUrl = (project.findProperty("notefable.baseUrl") as String).trimEnd('/')
        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
        // 聊天链接的 intent-filter（AndroidManifest）只认本站。
        manifestPlaceholders["notefableScheme"] = baseUrl.substringBefore("://")
        manifestPlaceholders["notefableHost"] = baseUrl.substringAfter("://").substringBefore('/').substringBefore(':')
    }

    buildTypes {
        release {
            // 过渡方案：用 debug 密钥签名，才能直接安装到手机侧载试用（和现有 Capacitor 外壳一致）。
            // 上架 Google Play 或给别人用之前，换成自己的正式密钥（密钥和密码不进仓库）。
            signingConfig = signingConfigs.getByName("debug")
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
