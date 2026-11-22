package com.kakumine.notefable.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicInteger

/** 账号上的图标（`GET / PUT /api/app-icon`）：读写的接口拆出来便于单元测试。 */
interface AppIconBackend {
    /**
     * `GET /api/app-icon`：icon 和本机同形（null / "character:<id>" / 图片 data URL），updatedAt 为 null 表示账号上还没保存过，
     * account 是这个账号的不透明的键。
     */
    suspend fun accountAppIcon(): AppIconResponse

    /** `PUT /api/app-icon`：整体替换，null 是默认角色 Quill。 */
    suspend fun saveAccountAppIcon(icon: String?): AppIconResponse
}

/**
 * 和图标一起记在本机的两项（网页 localStorage 的 `notefable:app-icon-owner` / `notefable:app-icon-pending`；
 * App 里是 SharedPreferences `app_icon` 的 owner / pending）。
 * - [owner]：本机的图标属于哪个账号（服务端给的 account 键）；未登录时选的为 null。
 * - [pending]：登录时选的、还没送到账号。
 */
interface AppIconSyncMemory {
    var owner: String?
    var pending: Boolean
}

/** 只在内存里的 [AppIconSyncMemory]（测试用）。 */
class InMemoryAppIconSyncMemory : AppIconSyncMemory {
    override var owner: String? = null
    override var pending: Boolean = false
}

/**
 * 设置里的"图标"跟着账号走（网页 src/lib/app-icon-sync.ts，iOS Core/Support/AppIconSync.swift，规则相同）。
 * 只在登录时同步；未登录（访客）只存在这台设备上（[AppIconStore]）。
 * - [pull]：启动 / 登录后和打开设置时读账号上的值，有就以账号为准存到本机；账号上还没有、本机选过非默认的，就把本机的送上去一次。
 * - [push]：在设置里选了以后（已先存到本机）送到账号。按选的顺序一个一个送，旧的回复不会盖掉新的选择；读的途中又选了，读到的值就不用。
 * 离线时本机的值保持不变。另外记着 [AppIconSyncMemory]：
 * - 待发送（pending）：选了但没送到时立着。立着时读到账号上的旧值也不覆盖本机，而是把本机的值再送一次（送不上就继续立着）。
 * - 归属账号（owner）：本机的图标属于别的账号时，不把它送进现在的账号，而是恢复成默认（同一台设备换账号时不泄露前一个人的图片）。
 * 明确退出登录 / 删除账号时，属于账号的图标恢复成默认（[forgetAccount]）。
 */
class AppIconSync(
    private val store: AppIconStore,
    private val backend: AppIconBackend,
    private val memory: AppIconSyncMemory = InMemoryAppIconSyncMemory(),
) {
    /** 是否登录（[com.kakumine.notefable.ui.AccountAppIconSync] 跟着账号状态设）。 */
    @Volatile
    var signedIn: Boolean = false
        set(value) {
            field = value
            if (!value) currentAccount = null
        }

    /** 现在登录的账号的键（这次启动后从服务端拿到的）；还不知道时为 null。 */
    @Volatile
    private var currentAccount: String? = null

    // 本机选过的次数：判断读的途中有没有又选过，以及只把最后一次送的结果告诉界面。
    private val edits = AtomicInteger(0)

    // 退出登录时加一：在那之前发出的请求回来后不再改 owner / pending。
    private val generation = AtomicInteger(0)

    // 读的次数：读重叠时只用最后开始的那次的结果（先开始的读晚回来也不会把新值盖回去）。
    private val pulls = AtomicInteger(0)
    private val sends = Mutex()

    private fun remember(owner: String?, pending: Boolean) {
        runCatching {
            memory.owner = owner
            memory.pending = pending
        }
    }

    /**
     * 送一次。送到了就把 owner 设成这个账号、放下 pending。
     * [markPending]（设置里选的值、pending 的重送）时先立起 pending，送不上就一直立着；第一次同步时送本机的值不立。
     */
    private suspend fun send(icon: String?, markPending: Boolean): Boolean = sends.withLock {
        val mine = generation.get()
        // 现在送的值是这个账号选的：owner 是现在的账号（键还不知道时为 null，下次读到时送进这个账号）。
        if (markPending) remember(currentAccount, true)
        try {
            val response = backend.saveAccountAppIcon(icon)
            val account = response.account?.takeIf { it.isNotEmpty() }
            if (account != null) currentAccount = account
            if (mine == generation.get()) remember(account ?: currentAccount, false)
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

    /** 送设置里选的值。送不上（且之后没有再选）时返回 false，界面显示提示；未登录时什么都不送（这个值不属于任何账号），返回 true。 */
    suspend fun push(icon: String?): Boolean {
        if (!signedIn) {
            remember(null, false)
            return true
        }
        val mine = edits.incrementAndGet()
        return send(icon, markPending = true) || mine != edits.get()
    }

    /** 读账号上的值并存到本机。读不到（离线、未登录）时保持本机的值。 */
    suspend fun pull() {
        if (!signedIn) return
        val before = edits.get()
        val started = generation.get()
        val mine = pulls.incrementAndGet()
        // 还有没送完的选择，等它们送完再读。
        sends.withLock { }
        val remote = try {
            backend.accountAppIcon()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            return
        }
        if (!signedIn || edits.get() != before || generation.get() != started || pulls.get() != mine) return
        val account = remote.account?.takeIf { it.isNotEmpty() }
        if (account != null) currentAccount = account
        val owner = runCatching { memory.owner }.getOrNull()
        if (account != null && owner != null && owner != account) {
            // 本机的图标属于别的账号：不送进这个账号，先恢复成默认再往下走。
            store.save(null)
            remember(null, false)
        }
        if (runCatching { memory.pending }.getOrDefault(false)) {
            // 有还没送到的选择：不用账号上的旧值覆盖，把本机的值再送一次（送不上就继续等下次）。
            send(store.icon.value, markPending = true)
            return
        }
        if (!remote.updatedAt.isNullOrEmpty()) {
            val icon = normalizeAppIcon(remote.icon)
            if (icon != store.icon.value) store.save(icon)
            remember(account, false)
            return
        }
        // 账号上还没保存过：把这台设备的选择（未登录时选的，或这个账号的）当作账号的第一个值。
        val local = store.icon.value ?: return
        send(local, markPending = false)
    }

    /** 明确退出登录 / 删除账号后：本机的图标属于账号（有 owner 或还在 pending）就恢复成默认，不留给下一个用这台设备的人。 */
    fun forgetAccount() {
        generation.incrementAndGet()
        signedIn = false
        val ownedByAccount = runCatching { memory.owner != null || memory.pending }.getOrDefault(true)
        if (ownedByAccount) store.save(null)
        remember(null, false)
    }
}
