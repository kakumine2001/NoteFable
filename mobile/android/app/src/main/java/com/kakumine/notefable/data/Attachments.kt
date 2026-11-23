package com.kakumine.notefable.data

import kotlin.math.ceil
import kotlin.math.roundToLong

// 与网页相同的限制和判定顺序（src/lib/upload-limits.ts、src/lib/client-files.ts）。
// 服务端会再校验一次，这里只是为了在上传前就把原因告诉用户。
const val MAX_UPLOAD_FILES = 10
const val MAX_UPLOAD_FILE_BYTES = 20L * 1024 * 1024
const val MAX_UPLOAD_TOTAL_BYTES = 100L * 1024 * 1024

private val IMAGE_TYPES = setOf("image/jpeg", "image/png", "image/webp")
private val SUPPORTED_EXTENSION = Regex("\\.(md|markdown|json|csv|tsv|txt|pdf)$", RegexOption.IGNORE_CASE)

/** 系统文件选择器的可选类型，对应网页 `ATTACHMENT_ACCEPT`。 */
val ATTACHMENT_PICKER_TYPES = arrayOf("image/png", "image/jpeg", "image/webp", "application/pdf", "text/*", "application/json")

/** 选好、还没发送的附件。uri 是系统文件选择器给的 content:// 地址。 */
data class LocalFile(val uri: String, val name: String, val mimeType: String, val size: Long) {
    val isImage: Boolean get() = mimeType.lowercase() in IMAGE_TYPES
}

/** 附件不能用的原因。文字在界面层按语言生成，和网页字典逐条对应。 */
sealed interface AttachError {
    data class TooMany(val max: Int, val extra: Int) : AttachError
    data class Empty(val name: String) : AttachError
    data object NameTooLong : AttachError
    data class Unsupported(val name: String) : AttachError
    data object ModelCannotReadImages : AttachError
    data class FileTooLarge(val name: String, val limitBytes: Long) : AttachError
    data class TotalTooLarge(val limitBytes: Long) : AttachError
    data class SlotsFull(val max: Int) : AttachError
    data class RoomForFewer(val remaining: Int, val max: Int, val count: Int) : AttachError

    /** 新选的这一批整批没有加进去（网页："{error} No new files were added."）。 */
    data class NotAdded(val cause: AttachError) : AttachError
}

/** 网页的 formatUploadSize：不足 0.1 MiB 用 KiB，其余保留一位小数并去掉多余的 ".0"。 */
fun formatUploadSize(bytes: Long): String {
    val mib = 1024.0 * 1024.0
    if (bytes > 0 && bytes < 0.1 * mib) return "${maxOf(1L, ceil(bytes / 1024.0).toLong())} KiB"
    val tenths = (bytes / mib * 10).roundToLong()
    return if (tenths % 10 == 0L) "${tenths / 10} MiB" else "${tenths / 10}.${tenths % 10} MiB"
}

/**
 * 网页 usage-plans.ts 的 formatStorageSize：1024 进制，单位 KB / MB / GB（不翻译）；10 以下保留一位小数，向下取整
 * （用量不会显示得比实际多）。数字的写法（小数点）按界面语言。
 */
fun formatStorageSize(bytes: Long, locale: java.util.Locale = java.util.Locale.ENGLISH): String {
    val mib = 1024.0 * 1024.0
    val value = maxOf(0L, bytes).toDouble()
    val (amount, unit) = when {
        value >= 1024 * mib -> value / (1024 * mib) to "GB"
        value >= mib -> value / mib to "MB"
        else -> value / 1024 to "KB"
    }
    val digits = if (unit != "KB" && amount < 10) 1 else 0
    val scale = if (digits == 1) 10.0 else 1.0
    val shown = kotlin.math.floor(amount * scale) / scale
    val format = java.text.NumberFormat.getNumberInstance(locale).apply {
        maximumFractionDigits = digits
        minimumFractionDigits = 0
        isGroupingUsed = true
    }
    return "${format.format(shown)} $unit"
}

/** 当前这组附件能不能发送；可以时返回 null。 */
fun attachmentError(files: List<LocalFile>, supportsImages: Boolean): AttachError? {
    if (files.size > MAX_UPLOAD_FILES) return AttachError.TooMany(MAX_UPLOAD_FILES, files.size - MAX_UPLOAD_FILES)
    for (file in files) {
        if (file.size <= 0) return AttachError.Empty(file.name)
        if (file.name.isEmpty() || file.name.length > 255) return AttachError.NameTooLong
        val supported = file.isImage || file.mimeType.startsWith("text/") || file.mimeType == "application/pdf" ||
            SUPPORTED_EXTENSION.containsMatchIn(file.name)
        if (!supported) return AttachError.Unsupported(file.name)
        if (file.isImage && !supportsImages) return AttachError.ModelCannotReadImages
        if (file.size > MAX_UPLOAD_FILE_BYTES) return AttachError.FileTooLarge(file.name, MAX_UPLOAD_FILE_BYTES)
    }
    if (files.sumOf { it.size } > MAX_UPLOAD_TOTAL_BYTES) return AttachError.TotalTooLarge(MAX_UPLOAD_TOTAL_BYTES)
    return null
}

/** 往已有附件里再加一批时的判定。有问题就整批不加，不会悄悄只加一部分。 */
fun selectionError(current: List<LocalFile>, incoming: List<LocalFile>, supportsImages: Boolean): AttachError? {
    if (current.size + incoming.size > MAX_UPLOAD_FILES) {
        val remaining = maxOf(0, MAX_UPLOAD_FILES - current.size)
        return if (remaining == 0) AttachError.SlotsFull(MAX_UPLOAD_FILES)
        else AttachError.RoomForFewer(remaining, MAX_UPLOAD_FILES, incoming.size)
    }
    return attachmentError(current + incoming, supportsImages)?.let(AttachError::NotAdded)
}
