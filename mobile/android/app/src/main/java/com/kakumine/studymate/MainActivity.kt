package com.kakumine.studymate

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.kakumine.studymate.ui.AccountViewModel
import com.kakumine.studymate.ui.ChatViewModel
import com.kakumine.studymate.ui.StudyMateRoot
import com.kakumine.studymate.ui.StudyMateTheme

class MainActivity : ComponentActivity() {
    private val viewModel: ChatViewModel by viewModels { ChatViewModel.Factory }
    private val accountViewModel: AccountViewModel by viewModels { AccountViewModel.Factory }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 网页只有浅色主题：状态栏和导航栏固定用深色图标，不随系统深色模式切换。
        val transparentLight = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = transparentLight, navigationBarStyle = transparentLight)
        super.onCreate(savedInstanceState)
        setContent {
            StudyMateTheme {
                StudyMateRoot(viewModel, accountViewModel)
            }
        }
    }
}
