package com.kakumine.notefable.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Base64
import kotlin.math.min

// 设置里的 AI 角色 / 自定义图标（网页 src/lib/app-icon.ts）：
// 空聊天首页大形象、AI 回答顶部标识、侧栏图标、笔记 AI 按钮、设置预览全部统一跟随当前选择。
// 保存在当前设备上；登录时还会和账号同步（AppIconSync.kt，网页 app-icon-sync.ts），访客只存在这台设备上。
// null（未设置）表示默认角色 Quill（D · Quill）；其他官方角色存为 "character:<id>"；自定义上传图片保留 "data:image/..."。
// 旧版本的表情符号或未知值会自动迁移回默认角色（null -> Quill）。

const val APP_ICON_IMAGE_SIZE = 96
const val CHARACTER_ICON_PREFIX = "character:"

sealed interface ResolvedAppIcon {
    data class Character(val characterId: CharacterId) : ResolvedAppIcon
    data class Image(val dataUrl: String) : ResolvedAppIcon
}

/** 网页 isImageIcon。 */
fun isImageIcon(icon: String): Boolean = icon.startsWith("data:image/")

fun parseCharacterIcon(value: String): CharacterId? {
    val rawId = if (value.startsWith(CHARACTER_ICON_PREFIX)) value.removePrefix(CHARACTER_ICON_PREFIX) else value
    return CharacterId.fromId(rawId)
}

fun toCharacterIcon(characterId: CharacterId): String? =
    if (characterId == CharacterId.Default) null else "$CHARACTER_ICON_PREFIX${characterId.id}"

/**
 * 读取存储时的兼容归一化（网页 normalizeAppIcon）：
 * - null / 空串 / "quill" / "character:quill" -> null（默认角色 Quill）
 * - 有效官方角色 -> "character:<id>"
 * - 自定义上传图片 data URL -> 原样保留
 * - 旧版表情或损坏/未知字符串 -> null（自动回退到默认角色 Quill）
 */
fun normalizeAppIcon(value: String?): String? {
    if (value.isNullOrEmpty()) return null
    if (isImageIcon(value)) return value
    val characterId = parseCharacterIcon(value)
    return characterId?.let(::toCharacterIcon)
}

/**
 * 校验主动保存时的输入值：有效图片 data URL 或有效角色标识返回归一化后的存储值，非法输入返回 IllegalArgument。
 * 为兼容旧测试签名，[validAppIcon] 对存储读取值执行安全归一化。
 */
fun validAppIcon(value: String?): String? = normalizeAppIcon(value)

fun resolveAppIcon(icon: String?): ResolvedAppIcon {
    val normalized = normalizeAppIcon(icon)
    if (normalized != null && isImageIcon(normalized)) {
        return ResolvedAppIcon.Image(normalized)
    }
    val characterId = normalized?.let(::parseCharacterIcon) ?: CharacterId.Default
    return ResolvedAppIcon.Character(characterId)
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
 * 现在的图标设置。[read] / [write] 是这台设备上的存储（App 里是 SharedPreferences）；
 * 存不进去或传入非法值时 [save] 返回 false、显示的图标不变（网页 saveAppIcon）。
 */
class AppIconStore(read: () -> String?, private val write: (String?) -> Boolean) {
    private val state = MutableStateFlow(normalizeAppIcon(runCatching(read).getOrNull()))
    val icon: StateFlow<String?> = state.asStateFlow()

    fun save(icon: String?): Boolean {
        val next: String? = when {
            icon.isNullOrEmpty() -> null
            isImageIcon(icon) -> icon
            else -> {
                val characterId = parseCharacterIcon(icon) ?: return false
                toCharacterIcon(characterId)
            }
        }
        if (!runCatching { write(next) }.getOrDefault(false)) return false
        state.value = next
        return true
    }
}
