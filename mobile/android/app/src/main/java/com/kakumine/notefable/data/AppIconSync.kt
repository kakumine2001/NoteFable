package com.kakumine.notefable.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicInteger

/** 账号上的图标（`GET / PUT /api/app-icon`）：读写的接口拆出来便于单元测试。 */
interface AppIconBackend {
    /** `GET /api/app-icon`：icon 和本机同形（null / "character:<id>" / 图片 data URL），updatedAt 为 null 表示账号上还没保存过。 */
    suspend fun accountAppIcon(): AppIconResponse

    /** `PUT /api/app-icon`：整体替换，null 是默认角色 Quill。 */
    suspend fun saveAccountAppIcon(icon: String?): AppIconResponse
}

/**
 * 设置里的"图标"跟着账号走（网页 src/lib/app-icon-sync.ts）。只在登录时同步；未登录（访客）只存在这台设备上（[AppIconStore]）。
 * - [pull]：启动 / 登录后和打开设置时读账号上的值，有就以账号为准存到本机；账号上还没有、本机选过非默认的，就把本机的送上去一次。
 * - [push]：在设置里选了以后（已先存到本机）送到账号。按选的顺序一个一个送，旧的回复不会盖掉新的选择；读的途中又选了，读到的值就不用。
 * 离线时本机的值保持不变。
 */
class AppIconSync(private val store: AppIconStore, private val backend: AppIconBackend) {
    /** 是否登录（[com.kakumine.notefable.ui.AccountAppIconSync] 跟着账号状态设）。 */
    @Volatile
    var signedIn: Boolean = false

    // 本机选过的次数：判断读的途中有没有又选过，以及只把最后一次送的结果告诉界面。
    private val edits = AtomicInteger(0)
    private val sends = Mutex()

    private suspend fun send(icon: String?): Boolean = sends.withLock {
        try {
            backend.saveAccountAppIcon(icon)
            true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            // 401 是途中退出了登录：本机已经存好了，不提示。
            error.status == 401
        } catch (_: Throwable) {
            false
        }
    }

    /** 送设置里选的值。送不上（且之后没有再选）时返回 false，界面显示提示；未登录时什么都不做、返回 true。 */
    suspend fun push(icon: String?): Boolean {
        if (!signedIn) return true
        val mine = edits.incrementAndGet()
        return send(icon) || mine != edits.get()
    }

    /** 读账号上的值并存到本机。读不到（离线、未登录）时保持本机的值。 */
    suspend fun pull() {
        if (!signedIn) return
        val before = edits.get()
        // 还有没送完的选择，等它们送完再读。
        sends.withLock { }
        val remote = try {
            backend.accountAppIcon()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            return
        }
        if (!signedIn || edits.get() != before) return
        if (!remote.updatedAt.isNullOrEmpty()) {
            val icon = normalizeAppIcon(remote.icon)
            if (icon != store.icon.value) store.save(icon)
            return
        }
        // 账号上还没保存过：把这台设备的选择当作账号的第一个值。
        val local = store.icon.value ?: return
        send(local)
    }
}
