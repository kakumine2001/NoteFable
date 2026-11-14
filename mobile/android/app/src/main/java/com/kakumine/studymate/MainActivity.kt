package com.kakumine.studymate

import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.kakumine.studymate.data.AppLanguage
import com.kakumine.studymate.ui.AccountViewModel
import com.kakumine.studymate.ui.ChatViewModel
import com.kakumine.studymate.ui.NotesViewModel
import com.kakumine.studymate.ui.StudyMateRoot
import com.kakumine.studymate.ui.StudyMateTheme

// AppCompatActivity：应用内切换语言（AppCompatDelegate.setApplicationLocales）在 Android 12 及以下也能生效
//（那里由 AppCompat 保存选择并就地更新 Resources，见 onConfigurationChanged）。
class MainActivity : AppCompatActivity() {
    private val viewModel: ChatViewModel by viewModels { ChatViewModel.Factory }
    private val accountViewModel: AccountViewModel by viewModels { AccountViewModel.Factory }
    private val notesViewModel: NotesViewModel by viewModels { NotesViewModel.Factory }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 网页只有浅色主题：状态栏和导航栏固定用深色图标，不随系统深色模式切换。
        val transparentLight = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = transparentLight, navigationBarStyle = transparentLight)
        super.onCreate(savedInstanceState)
        AppLanguage.uiLocale = getString(R.string.ui_locale)
        setContent {
            StudyMateTheme {
                StudyMateRoot(viewModel, accountViewModel, notesViewModel)
            }
        }
    }

    // 语言变化由 configChanges 接住（不重建 Activity、保留输入中的内容）：这里更新 Accept-Language 用的界面语言。
    // Android 12 及以下，应用内切换语言时 AppCompat 只就地更新 Resources 并调用 Activity.onConfigurationChanged，
    // 不经过 ViewRootImpl，Compose 的 LocalConfiguration 收不到变化（界面不重组、会混着旧语言）。
    // 这里把新配置交给 View 树，让 AndroidComposeView 更新 LocalConfiguration；系统发来的变化多走一次也无妨。
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        AppLanguage.uiLocale = getString(R.string.ui_locale)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            window.decorView.dispatchConfigurationChanged(Configuration(resources.configuration))
        }
    }
}
