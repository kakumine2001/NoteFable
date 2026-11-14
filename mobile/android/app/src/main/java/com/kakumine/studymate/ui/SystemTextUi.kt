package com.kakumine.studymate.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.kakumine.studymate.R
import com.kakumine.studymate.StudyMateApp
import com.kakumine.studymate.data.SystemText
import com.kakumine.studymate.data.SystemTextTranslator

/** 按当前界面语言翻译服务端系统文的翻译器（网页的 `t` + `localizeSystemText`）。 */
@Composable
fun rememberSystemText(): SystemTextTranslator {
    val context = LocalContext.current
    // 跟资源解析出的界面语言走（en / zh / zh-Hant / ja），不直接看系统的 Locale。
    val language = stringResource(R.string.ui_locale)
    val table = remember(context) { (context.applicationContext as? StudyMateApp)?.systemText ?: SystemText.Empty }
    return remember(table, language) { table.translator(language) }
}
