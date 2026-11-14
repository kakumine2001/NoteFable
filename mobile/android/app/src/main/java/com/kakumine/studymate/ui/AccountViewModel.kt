package com.kakumine.studymate.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.kakumine.studymate.StudyMateApp
import com.kakumine.studymate.data.AccountApi
import com.kakumine.studymate.data.AccountBackend
import com.kakumine.studymate.data.AccountProfileBackend
import com.kakumine.studymate.data.AccountResponse
import com.kakumine.studymate.data.AccountUser
import com.kakumine.studymate.data.ApiException
import com.kakumine.studymate.data.ProfileEdit
import com.kakumine.studymate.data.applyProfileEdit
import com.kakumine.studymate.data.profileEditChanges
import com.kakumine.studymate.data.serverMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class AccountUiState(
    /** 服务端开了 Google 登录才显示登录入口（和网页 AccountButton 一样，未配置时什么都不显示）。 */
    val configured: Boolean = false,
    /** 显示用的资料：服务端确认过的 + 还没确认的编辑（网页 account-store 的 view()）。 */
    val user: AccountUser? = null,
    val googleClientId: String? = null,
    /** 登录窗口里列哪些方式（服务端 `GET /api/account` 的 google / email）。 */
    val googleEnabled: Boolean = true,
    val emailEnabled: Boolean = false,
    val signingIn: Boolean = false,
    /** 上一次登录失败：按钮文字换成"登录失败，请重试"。 */
    val signInFailed: Boolean = false,
    /** 资料保存失败时的提示：服务端的英文原句（经系统文词典翻译），没有时是网页兜底的 "Could not save."（字符串资源）。 */
    val profileError: ProfileError? = null,
    /** 头像照片正在上传（网页 ProfileMenu 的 uploading：期间菜单不关、保存键变"正在保存…"）。 */
    val uploading: Boolean = false,
    /** 照片这一栏的提示（网页 uploadError）。 */
    val photoError: PhotoError? = null,
)

/** 照片栏的提示：选的文件不对，或上传失败（服务端原句 / 网页的两句兜底文）。 */
/** 资料（名字 / 图标）保存失败的原因。 */
sealed interface ProfileError {
    data class Server(val message: String) : ProfileError
    /** 网页 account-store 的兜底文 "Could not save."（R.string.acct_could_not_save）。 */
    data object CouldNotSave : ProfileError
}

/** 邮箱登录失败的原因：服务端原句，或网页的两句兜底文。 */
sealed interface SignInError {
    data class Server(val message: String) : SignInError
    data object Generic : SignInError
    data object Offline : SignInError
}

sealed interface PhotoError {
    data object NotImage : PhotoError
    data object TooLarge : PhotoError
    data class Server(val message: String) : PhotoError
    data object UploadFailed : PhotoError
    data object Offline : PhotoError
}

/** 选的原图上限（网页 MAX_PICKED_BYTES）；真正上传的是裁好的 512 图。 */
const val MAX_PICKED_PHOTO_BYTES = 10L * 1024 * 1024

/** 选好的文件能不能进裁剪（网页 choosePhoto）：不是图片、超过 10 MB 的直接提示。读不到大小时交给解码去判断。 */
fun checkPickedPhoto(mimeType: String?, size: Long?): PhotoError? = when {
    mimeType?.startsWith("image/") != true -> PhotoError.NotImage
    size != null && size > MAX_PICKED_PHOTO_BYTES -> PhotoError.TooLarge
    else -> null
}

/**
 * 侧栏底部的账号。登录 / 退出都会换身份，成功后由界面通知聊天页重新加载（onIdentityChanged）。
 * 选择框需要 Activity，所以"拿 ID 令牌"由界面传进来。
 */
class AccountViewModel(
    private val backend: AccountBackend,
    private val profile: AccountProfileBackend,
) : ViewModel() {
    private val _state = MutableStateFlow(AccountUiState())
    val state: StateFlow<AccountUiState> = _state.asStateFlow()

    // 和网页 account-store 一样：服务端确认过的资料 + 还没确认的编辑，界面看到的是两者叠起来的结果（先显示，后保存）。
    private var confirmed: AccountUser? = null
    private val pending = ArrayList<ProfileEdit>()

    // 资料和照片按发出的顺序一个一个送（Mutex 先到先得），旧的回复不会盖掉新的编辑；退出前也等它们送完。
    private val saves = Mutex()

    init {
        refresh()
    }

    private fun publish() {
        val user = confirmed?.let { pending.fold(it, ::applyProfileEdit) }
        _state.update { it.copy(user = user) }
    }

    private fun setConfirmed(user: AccountUser?) {
        confirmed = user
        if (user == null) pending.clear()
        publish()
    }

    private fun applyAccount(response: AccountResponse) {
        _state.update {
            it.copy(
                configured = response.configured,
                googleClientId = response.googleClientId,
                // 网页 SignInDialog：showGoogle = account.google !== false，showEmail = Boolean(account.email)。
                googleEnabled = response.google != false,
                emailEnabled = response.email == true,
            )
        }
        setConfirmed(response.user)
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching { backend.account() }.onSuccess { response ->
                applyAccount(response)
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
                    applyAccount(account)
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

    /** 邮箱登录第一步：发验证码（网页 SignInDialog.sendCode）。成功返回 null，失败返回原因。 */
    suspend fun sendEmailCode(email: String, locale: String): SignInError? =
        emailStep { backend.emailSignInStart(email, locale) }

    /**
     * 邮箱登录第二步：核对验证码（网页 SignInDialog.verify）。成功后和 Google 登录一样重新读账号、通知换了身份，返回 null。
     * [beforeIdentityChange] 在验证码通过、身份真正换掉之前做完（把打开的笔记存掉）。
     */
    suspend fun verifyEmailCode(email: String, code: String, beforeIdentityChange: suspend () -> Unit, onSignedIn: () -> Unit): SignInError? {
        // 存笔记失败不是网络问题，也还没核对验证码：按"出了点问题"报，不继续换身份。
        try {
            beforeIdentityChange()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            return SignInError.Generic
        }
        // 放在 viewModelScope 里跑完：验证码一通过会话就换了，登录窗口这时关掉（它的协程被取消）也要把"换了身份"通知出去。
        return viewModelScope.async {
            emailStep {
                backend.emailSignInVerify(email, code)
                // 读不到账号也算登录成功，不把它报成验证码错误；过一会儿再读，免得侧栏一直停在"登录"。
                try {
                    applyAccount(backend.account())
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Throwable) {
                    retryAccountLater()
                }
                onSignedIn()
            }
        }.await()
    }

    // 登录成功但账号没读到：隔 2、4、8 秒再读，读到就停。
    private fun retryAccountLater() {
        viewModelScope.launch {
            for (seconds in listOf(2L, 4L, 8L)) {
                delay(seconds * 1000)
                val response = try {
                    backend.account()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Throwable) {
                    continue
                }
                applyAccount(response)
                return@launch
            }
        }
    }

    /** 打开登录窗口时清掉上一次 Google 登录失败的提示（网页的 failed 是窗口自己的状态，每次打开都是新的）。 */
    fun clearSignInFailed() = _state.update { it.copy(signInFailed = false) }

    // 网页 post()：服务端给了原因就用原因，没有就是 "Something went wrong. Try again."；连不上是 "Check your connection and try again."。
    private suspend fun emailStep(block: suspend () -> Unit): SignInError? = try {
        block()
        null
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: ApiException) {
        error.serverMessage()?.let(SignInError::Server) ?: SignInError.Generic
    } catch (_: Throwable) {
        SignInError.Offline
    }

    fun signOut(clearDeviceChoice: suspend () -> Unit, onSignedOut: () -> Unit) {
        viewModelScope.launch {
            // 网页 settled()：刚改的名字 / 图标 / 照片先送完再退出（退出后再送会 401）。
            saves.withLock { }
            runCatching { clearDeviceChoice() }
            runCatching { backend.signOut() }
            _state.update { it.copy(profileError = null, photoError = null, uploading = false) }
            setConfirmed(null)
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
        save(ProfileEdit.name(value))
    }

    /** 选表情头像；null 是"使用 Google 头像"，照片栏的"移除我的照片"也走这里（网页 onSave({ icon: null })）。 */
    fun setIcon(icon: String?) = save(ProfileEdit.icon(icon))

    fun resetToGoogle() = save(ProfileEdit.ResetToGoogle)

    /** 网页 saveProfile：马上显示，排队发送；已经是这个状态就什么也不做。 */
    private fun save(edit: ProfileEdit) {
        val current = _state.value.user ?: return
        if (!profileEditChanges(current, edit)) return
        pending += edit
        _state.update { it.copy(profileError = null) }
        publish()
        viewModelScope.launch {
            saves.withLock {
                try {
                    val user = profile.updateProfile(edit)
                    if (confirmed != null) confirmed = user
                    _state.update { it.copy(profileError = null) }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Throwable) {
                    // 只撤掉失败的这一次编辑，后面排着的照常（网页 sendPatch）。
                    _state.update { it.copy(profileError = (error as? ApiException)?.serverMessage()?.let(ProfileError::Server) ?: ProfileError.CouldNotSave) }
                } finally {
                    // 按身份比对：同样内容的编辑连发两次时只去掉这一次的那一个。
                    val index = pending.indexOfFirst { it === edit }
                    if (index >= 0) pending.removeAt(index)
                    publish()
                }
            }
        }
    }

    /**
     * 上传裁好的照片（网页 uploadPhoto，和资料保存排在同一个队列里）。成功后调用 [onSaved]（菜单收起照片栏），
     * 失败把原因放进 [AccountUiState.photoError]。
     */
    fun uploadPhoto(bytes: ByteArray, mimeType: String, onSaved: () -> Unit) {
        if (_state.value.uploading) return
        _state.update { it.copy(uploading = true, photoError = null) }
        viewModelScope.launch {
            saves.withLock {
                try {
                    val user = profile.uploadAvatar(bytes, mimeType)
                    if (confirmed != null) confirmed = user
                    _state.update { it.copy(profileError = null, uploading = false) }
                    publish()
                    onSaved()
                } catch (cancelled: CancellationException) {
                    _state.update { it.copy(uploading = false) }
                    throw cancelled
                } catch (error: ApiException) {
                    val reason = error.serverMessage()?.let(PhotoError::Server) ?: PhotoError.UploadFailed
                    _state.update { it.copy(uploading = false, photoError = reason) }
                } catch (_: Throwable) {
                    _state.update { it.copy(uploading = false, photoError = PhotoError.Offline) }
                }
            }
        }
    }

    /** 设置窗口打开时读自定义指令（没有设置时是空字符串）。失败时把原因交给界面显示。 */
    suspend fun loadCustomInstructions(): Result<String> = try {
        Result.success(profile.customInstructions() ?: "")
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Throwable) {
        Result.failure(error)
    }

    /** 保存自定义指令（网页 SettingsDialog.save：发去掉首尾空白后的文字）。成功返回 null，失败返回原因。 */
    suspend fun saveCustomInstructions(text: String): Throwable? = try {
        profile.saveCustomInstructions(text.trim())
        null
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Throwable) {
        error
    }

    fun showPhotoError(error: PhotoError?) = _state.update { it.copy(photoError = error) }

    /** 打开个人资料时清掉上一次的错误（网页 clearSaveError；照片栏的提示随菜单一起消失）。 */
    fun clearProfileError() = _state.update { it.copy(profileError = null, photoError = null) }

    companion object {
        val Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val app = extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as StudyMateApp
                return AccountViewModel(app.api, AccountApi(app.api.http)) as T
            }
        }
    }
}
