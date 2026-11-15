package com.kakumine.notefable.ui

import com.kakumine.notefable.data.SessionSummary

/**
 * 聊天图标的保存（网页 src/lib/session-icon-sync.ts 的移植，行为相同）：
 * - 每个聊天的保存排队进行，连点几次只把最后一次选的发出去；
 * - 先在界面上显示，保存失败时退回最后一次保存成功的值并报错；
 * - 列表刷新时，把刷新开始后改过（或还在保存）的图标盖回去，免得旧列表把刚选的图标冲掉。
 * 只在主线程（viewModelScope）里用，不需要加锁。
 */
class SessionIconSync(private val send: suspend (sessionId: String, icon: String?) -> Boolean) {
    private class Edit(var desired: String?, var confirmed: String?, var running: Boolean = false, var seq: Long = 0)

    private var seq = 0L
    private val edits = HashMap<String, Edit>()

    /** 开始读列表之前调用；把返回值交给 [reconcile]。 */
    fun mark(): Long = seq

    fun reconcile(sessions: List<SessionSummary>, startedAt: Long): List<SessionSummary> = sessions.map { session ->
        val edit = edits[session.id]
        if (edit == null || (!edit.running && edit.seq <= startedAt)) session
        else session.copy(icon = if (edit.running) edit.desired else edit.confirmed)
    }

    /** [current] 是界面上现在的图标。[show] 把值显示出来；保存失败时先退回再调用 [fail]。 */
    suspend fun change(sessionId: String, icon: String?, current: String?, show: (String?) -> Unit, fail: () -> Unit) {
        val edit = edits.getOrPut(sessionId) { Edit(desired = icon, confirmed = current) }
        if (!edit.running) edit.confirmed = current
        edit.desired = icon
        edit.seq = ++seq
        show(icon)
        if (edit.running) return

        edit.running = true
        try {
            while (edit.desired != edit.confirmed) {
                val sending = edit.desired
                if (send(sessionId, sending)) {
                    edit.confirmed = sending
                } else {
                    edit.desired = edit.confirmed
                    show(edit.confirmed)
                    fail()
                    break
                }
            }
        } finally {
            edit.running = false
            edit.seq = ++seq
        }
    }
}
