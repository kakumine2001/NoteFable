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
        // Google 登录只认 Google Cloud 里登记的 Android 客户端 NoteFable-Android（应用 ID + Play 应用签名的 SHA-1），
        // 所以只有 Play 签名的包能用 Google 登录，本机签名的包用邮箱验证码（见 docs/architecture/android.md）。
        applicationId = "com.kakumine.notefable"
        minSdk = 26
        targetSdk = 36
        versionCode = 26
        versionName = "1.0.16"

        val baseUrl = (project.findProperty("notefable.baseUrl") as String).trimEnd('/')
        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
        val siteUrl = (project.findProperty("notefable.siteUrl") as String).trimEnd('/')
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")
        // 聊天链接的 intent-filter（AndroidManifest）只认本站。
        manifestPlaceholders["notefableScheme"] = baseUrl.substringBefore("://")
        manifestPlaceholders["notefableHost"] = baseUrl.substringAfter("://").substringBefore('/').substringBefore(':')
    }

    // Google Play 的上传密钥。密钥库和密码不进仓库：写在本机的 ~/.gradle/gradle.properties（notefable.upload.*），
    // 所有 worktree 共用。没有配置时构建 release 包会直接失败（免得交出 debug 签名的包）；
    // 只想在别的电脑上侧载试用时加 -Pnotefable.release.debugSigning=true。
    val uploadProps = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
        .associateWith { providers.gradleProperty("notefable.upload.$it").orNull }
    val debugSignedRelease = providers.gradleProperty("notefable.release.debugSigning").orNull == "true"
    if (uploadProps.values.all { it != null }) {
        signingConfigs.create("upload") {
            storeFile = file(uploadProps.getValue("storeFile")!!)
            storePassword = uploadProps.getValue("storePassword")
            keyAlias = uploadProps.getValue("keyAlias")
            keyPassword = uploadProps.getValue("keyPassword")
        }
    } else if (!debugSignedRelease) {
        val missing = uploadProps.filterValues { it == null }.keys.joinToString { "notefable.upload.$it" }
        gradle.taskGraph.whenReady {
            if (allTasks.any { it.name.endsWith("Release") && (it.name.startsWith("bundle") || it.name.startsWith("assemble")) }) {
                throw GradleException("Release signing is not configured: missing $missing (see docs/architecture/android.md).")
            }
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
    // 回答里的数学公式（MIT，纯 Kotlin / Compose）。字体包是 KaTeX 的字体，和网页的公式用同一套。
    implementation(libs.latex.renderer)
    implementation(libs.latex.fonts.katex)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.googleid)
    // Pro の購読（Google Play Billing、data/PlayBilling.kt）。
    implementation(libs.billing.ktx)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
