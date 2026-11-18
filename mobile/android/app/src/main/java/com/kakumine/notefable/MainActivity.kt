package com.kakumine.notefable

import android.content.Intent
import android.content.res.Configuration
import android.content.res.Resources
import android.os.LocaleList
import androidx.appcompat.app.AppCompatDelegate
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import java.util.Locale
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.kakumine.notefable.data.AppLanguage
import com.kakumine.notefable.data.ChatLink
import com.kakumine.notefable.ui.AccountViewModel
import com.kakumine.notefable.ui.ChatViewModel
import com.kakumine.notefable.ui.NotesViewModel
import com.kakumine.notefable.ui.NoteFableRoot
import com.kakumine.notefable.ui.NoteFableTheme

// AppCompatActivity：应用内切换语言（AppCompatDelegate.setApplicationLocales）在 Android 12 及以下也能生效
//（那里由 AppCompat 保存选择并就地更新 Resources，见 onConfigurationChanged）。
class MainActivity : AppCompatActivity() {
    private val viewModel: ChatViewModel by viewModels { ChatViewModel.Factory }
    private val accountViewModel: AccountViewModel by viewModels { AccountViewModel.Factory }
    private val notesViewModel: NotesViewModel by viewModels { NotesViewModel.Factory }

    private var autoRequest = 0
    private var autoFallback: Pair<String, AppLanguage.Preference>? = null
    private val localeClient by lazy { OkHttpClient() }

    private fun systemTags(): List<String> = Resources.getSystem().configuration.locales.toLanguageTags().split(',')

    /** Keep Auto's inferred resources separate from the persisted app preference. */
    @Suppress("DEPRECATION")
    private fun resolveAutoConfiguration() {
        val requestId = ++autoRequest
        if (!AppCompatDelegate.getApplicationLocales().isEmpty) return
        val tags = systemTags()
        val key = tags.joinToString(",")
        val matched = tags.firstNotNullOfOrNull(AppLanguage::localeFromTag)
        fun display(language: AppLanguage.Preference) {
            val config = Configuration(resources.configuration)
            val tag = language.tag ?: "en"
            config.setLocales(LocaleList.forLanguageTags(tag))
            config.setLayoutDirection(Locale.forLanguageTag(tag))
            resources.updateConfiguration(config, resources.displayMetrics)
            AppLanguage.uiLocale = getString(R.string.ui_locale)
            window.decorView.layoutDirection = config.layoutDirection
            window.decorView.dispatchConfigurationChanged(config)
        }
        display(matched ?: autoFallback?.takeIf { it.first == key }?.second ?: AppLanguage.Preference.English)
        if (matched != null || autoFallback?.first == key) return
        // Only unsupported system lists need country inference. This endpoint is
        // private/no-store and does not read or create an account/device record.
        lifecycleScope.launch {
            val inferred = withContext(Dispatchers.IO) {
                runCatching {
                    val request = Request.Builder().url(BuildConfig.BASE_URL + "/api/i18n?preference=auto&format=locale")
                        .header("Accept-Language", key).build()
                    localeClient.newCall(request).execute().use { response ->
                        check(response.isSuccessful)
                        AppLanguage.preferenceOfCode(JSONObject(response.body.string()).getString("locale"))
                    }
                }.getOrNull()
            } ?: return@launch
            // Travel, a system change or a newer manual selection invalidates it.
            if (requestId == autoRequest && AppCompatDelegate.getApplicationLocales().isEmpty && systemTags() == tags) {
                autoFallback = key to inferred
                display(inferred)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 网页只有浅色主题：状态栏和导航栏固定用深色图标，不随系统深色模式切换。
        val transparentLight = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = transparentLight, navigationBarStyle = transparentLight)
        super.onCreate(savedInstanceState)
        resolveAutoConfiguration()
        AppLanguage.uiLocale = getString(R.string.ui_locale)
        window.decorView.layoutDirection = resources.configuration.layoutDirection
        setContent {
            NoteFableTheme {
                NoteFableRoot(viewModel, accountViewModel, notesViewModel)
            }
        }
        // 从外部打开的聊天链接。重建 Activity 时不再重复打开；从"最近任务"重新进入时系统会带着当初的 VIEW intent
        //（FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY），那是旧链接，也不打开（网页处理完就把 ?chat= 从地址里去掉）。
        val fromHistory = (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        if (savedInstanceState == null && !fromHistory) handleLink(intent)
    }

    // singleTask：App 已在运行时，链接从这里进来。
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent)
    }

    /** `https://<站点>/?chat=<会话>&message=<消息>`：在 App 里打开那段聊天（Batch 4）。别的链接不处理，照常打开 App。 */
    private fun handleLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val link = intent.dataString?.let { ChatLink.parse(it, BuildConfig.BASE_URL) } ?: return
        // 交给 NoteFableRoot：它先关掉检索面板和抽屉，再用 openChatLink 打开。
        viewModel.requestLink(link)
    }

    // 语言变化由 configChanges 接住（不重建 Activity、保留输入中的内容）：这里更新 Accept-Language 用的界面语言。
    // Android 12 及以下，应用内切换语言时 AppCompat 只就地更新 Resources 并调用 Activity.onConfigurationChanged，
    // 不经过 ViewRootImpl，Compose 的 LocalConfiguration 收不到变化（界面不重组、会混着旧语言）。
    // 这里把新配置交给 View 树，让 AndroidComposeView 更新 LocalConfiguration；系统发来的变化多走一次也无妨。
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        resolveAutoConfiguration()
        AppLanguage.uiLocale = getString(R.string.ui_locale)
        window.decorView.layoutDirection = resources.configuration.layoutDirection
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            window.decorView.dispatchConfigurationChanged(Configuration(resources.configuration))
        }
    }
}
