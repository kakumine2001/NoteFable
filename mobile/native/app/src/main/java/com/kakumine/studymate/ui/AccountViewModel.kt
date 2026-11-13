package com.kakumine.studymate.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.kakumine.studymate.StudyMateApp
import com.kakumine.studymate.data.AccountBackend
import com.kakumine.studymate.data.AccountUser
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AccountUiState(
    /** 服务端开了 Google 登录才显示登录入口（和网页 AccountButton 一样，未配置时什么都不显示）。 */
    val configured: Boolean = false,
    val user: AccountUser? = null,
    val googleClientId: String? = null,
    val signingIn: Boolean = false,
    /** 上一次登录失败：按钮文字换成"登录失败，请重试"。 */
    val signInFailed: Boolean = false,
    /** 资料保存失败时的服务端提示。 */
    val profileError: String? = null,
)

/**
 * 侧栏底部的账号。登录 / 退出都会换身份，成功后由界面通知聊天页重新加载（onIdentityChanged）。
 * 选择框需要 Activity，所以"拿 ID 令牌"由界面传进来。
 */
class AccountViewModel(private val backend: AccountBackend) : ViewModel() {
    private val _state = MutableStateFlow(AccountUiState())
    val state: StateFlow<AccountUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching { backend.account() }.onSuccess { response ->
                _state.update {
                    it.copy(configured = response.configured, user = response.user, googleClientId = response.googleClientId)
                }
            }
        }
    }

    /**
     * 先要 nonce，再让用户选账号，最后把令牌交给服务端。成功返回 true；用户取消返回 false。
     * [fetchIdToken] 返回 null 表示用户关掉了选择框。
     */
    fun signIn(fetchIdToken: suspend (clientId: String, nonce: String) -> String?, onSignedIn: () -> Unit) {
        val clientId = _state.value.googleClientId ?: return
        if (_state.value.signingIn) return
        _state.update { it.copy(signingIn = true, signInFailed = false) }
        viewModelScope.launch {
            try {
                val nonce = backend.nativeSignInNonce()
                val idToken = fetchIdToken(clientId, nonce)
                if (idToken != null) {
                    backend.nativeSignIn(idToken)
                    val account = backend.account()
                    _state.update { it.copy(configured = account.configured, user = account.user, googleClientId = account.googleClientId) }
                    onSignedIn()
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Throwable) {
                _state.update { it.copy(signInFailed = true) }
            } finally {
                _state.update { it.copy(signingIn = false) }
            }
        }
    }

    fun signOut(clearDeviceChoice: suspend () -> Unit, onSignedOut: () -> Unit) {
        viewModelScope.launch {
            runCatching { clearDeviceChoice() }
            runCatching { backend.signOut() }
            _state.update { it.copy(user = null, profileError = null) }
            onSignedOut()
            refresh()
        }
    }

    /** 改名字；空字符串或与 Google 名字相同时恢复为 Google 的名字（和网页 ProfileMenu.commitName 一样）。 */
    fun saveName(draft: String) {
        val user = _state.value.user ?: return
        val next = draft.replace(Regex("\\s+"), " ").trim()
        val value = if (next.isEmpty() || next == (user.googleName ?: "")) null else next
        if (value == user.displayName) return
        saveProfile { backend.updateProfile(value, resetToGoogle = false) }
    }

    fun resetToGoogle() = saveProfile { backend.updateProfile(null, resetToGoogle = true) }

    private fun saveProfile(call: suspend () -> AccountUser?) {
        viewModelScope.launch {
            _state.update { it.copy(profileError = null) }
            runCatching { call() }
                .onSuccess { user -> if (user != null) _state.update { it.copy(user = user) } }
                .onFailure { error -> _state.update { it.copy(profileError = error.message) } }
        }
    }

    companion object {
        val Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val app = extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as StudyMateApp
                return AccountViewModel(app.api) as T
            }
        }
    }
}
