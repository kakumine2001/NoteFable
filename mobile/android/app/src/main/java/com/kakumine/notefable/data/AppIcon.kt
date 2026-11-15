package com.kakumine.notefable.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Base64
import kotlin.math.min

// 设置里的"图标"（网页 src/lib/app-icon.ts）：侧栏的标志、AI 回答的标签、笔记里的 AI 按钮上显示的图标，可以换成表情或图片。
// 只存在这台设备上（不存到账号）。值和网页的 localStorage `notefable:app-icon` 相同：一个表情，或缩小后的图片的 data URL；
// null 是默认的 NoteFable 标志。WebView 编辑器（/note-embed）里的 AI 按钮由网页自己画，值经 JS 桥交给它（NoteEditor.kt）。

/** 保存的图片的边长（网页 ICON_IMAGE_SIZE）：最大也只显示到 26 左右，高分屏也够。 */
const val APP_ICON_IMAGE_SIZE = 96

/** 网页 isImageIcon。 */
fun isImageIcon(icon: String): Boolean = icon.startsWith("data:image/")

/**
 * 存着的值能不能用（网页 read()）：图片的 data URL，或一个表情；坏掉的值退回标志。
 * 表情只会是选择器里选出来的，这里只挡明显不对的（太长、带空白）；网页那边拿到后还会按"单个表情"再核对一次。
 */
fun validAppIcon(value: String?): String? = when {
    value.isNullOrEmpty() -> null
    isImageIcon(value) -> value
    value.length <= 64 && value.none(Char::isWhitespace) -> value
    else -> null
}

/** 解码后最多这么多像素（和头像相同的上限）。 */
private const val APP_ICON_MAX_DECODED_PIXELS = 20_000_000L

/** 解码选中的图片时的缩小倍数（2 的幂）：短边留到成品的 2 倍以上；很长的图再按总像素数缩小。 */
fun appIconSampleSize(width: Int, height: Int): Int {
    var sample = 1
    while (min(width, height) / (sample * 2) >= APP_ICON_IMAGE_SIZE * 2) sample *= 2
    while ((width.toLong() / sample) * (height.toLong() / sample) > APP_ICON_MAX_DECODED_PIXELS) sample *= 2
    return sample
}

/** 居中裁出的正方形（网页 imageFileToIcon）。 */
data class AppIconCrop(val left: Int, val top: Int, val side: Int)

fun appIconCrop(width: Int, height: Int): AppIconCrop {
    val side = min(width, height)
    return AppIconCrop((width - side) / 2, (height - side) / 2, side)
}

/** PNG 字节 → 存下来的值（网页 canvas.toDataURL("image/png")）。 */
fun appIconDataUrl(png: ByteArray): String = "data:image/png;base64," + Base64.getEncoder().encodeToString(png)

/** 存着的图片的字节；不是 base64 的 data URL、解不出来时为 null。 */
fun appIconImageBytes(icon: String): ByteArray? {
    if (!isImageIcon(icon)) return null
    val comma = icon.indexOf(',')
    if (comma < 0 || !icon.substring(0, comma).endsWith(";base64")) return null
    return try {
        Base64.getDecoder().decode(icon.substring(comma + 1))
    } catch (_: IllegalArgumentException) {
        null
    }
}

/**
 * 现在的图标。[read] / [write] 是这台设备上的存储（App 里是 SharedPreferences）；
 * 存不进去时 [save] 返回 false、显示的图标不变（网页 saveAppIcon）。
 */
class AppIconStore(read: () -> String?, private val write: (String?) -> Boolean) {
    private val state = MutableStateFlow(validAppIcon(runCatching(read).getOrNull()))
    val icon: StateFlow<String?> = state.asStateFlow()

    fun save(icon: String?): Boolean {
        val next = icon?.let { validAppIcon(it) ?: return false }
        if (!runCatching { write(next) }.getOrDefault(false)) return false
        state.value = next
        return true
    }
}
