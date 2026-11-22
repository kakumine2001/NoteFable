package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ThemePreference

/** 外观的三个选项（网页 theme-settings.tsx 的 THEME_OPTIONS）：跟随系统 Monitor、浅色 Sun、深色 Moon。 */
internal class ThemeOption(val value: ThemePreference, val label: Int, val icon: List<String>)

internal val ThemeOptions = listOf(
    ThemeOption(ThemePreference.System, R.string.theme_system, Lucide.Monitor),
    ThemeOption(ThemePreference.Light, R.string.theme_light, Lucide.Sun),
    ThemeOption(ThemePreference.Dark, R.string.theme_dark, Lucide.Moon),
)

internal fun themeOption(value: ThemePreference): ThemeOption = ThemeOptions.first { it.value == value }

/**
 * 设置 → 通用 的"外观"一行（网页 ThemeSettings，settings-dialog.css 的 .settings-theme-*，手机宽度）：
 *  - 行（.settings-row.settings-theme-row）：最小高 56、内边距 10×16，标题 16/500；标题和选择器之间至少隔 16，
 *    一行放不下（英文等）时选择器换到下一行、行距 10，靠起始边；
 *  - 选择器（.settings-theme-group）：内边距 2、间距 2、圆角 8、1px --notion-border、底色 --notion-sidebar；
 *  - 选项（.settings-theme-option）：最小高 32、左右 10.4、圆角 6、图标 14 + 间距 5.6 + 13/500 灰字；
 *    选中：--notion-surface 底、--nf-ink 字、阴影 0 1px 2px rgba(0,0,0,.08) + 一圈 1px --notion-border。
 * 点了就保存（只存在这台设备上，[com.kakumine.notefable.data.AppThemeStore]），界面马上换。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ThemeSettings() {
    val store = appThemeStore()
    val preference = currentThemePreference()
    val title = stringResource(R.string.appearance)
    FlowRow(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.padding(end = 16.dp), color = Sm.Text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        val groupShape = RoundedCornerShape(8.dp)
        Row(
            Modifier.clip(groupShape).background(Sm.Sidebar).border(1.dp, Sm.Border, groupShape).padding(2.dp)
                .selectableGroup().semantics { contentDescription = title },
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ThemeOptions.forEach { option ->
                val checked = option.value == preference
                val shape = RoundedCornerShape(6.dp)
                val color = if (checked) Sm.Ink else Sm.Muted
                Row(
                    Modifier
                        .then(
                            if (checked) Modifier.shadow(1.dp, shape, ambientColor = Color(0x14000000), spotColor = Color(0x14000000))
                                .background(Sm.Surface, shape).border(1.dp, Sm.Border, shape)
                            else Modifier,
                        )
                        .clip(shape)
                        .selectable(selected = checked, role = Role.RadioButton) { store?.save(option.value) }
                        .heightIn(min = 32.dp).padding(horizontal = 10.4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.6.dp),
                ) {
                    LucideIcon(option.icon, 14.dp, color)
                    Text(stringResource(option.label), color = color, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                }
            }
        }
    }
}
