package com.kakumine.notefable.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 与网页 src/lib/chat-activity.test.ts 逐条对应。原生收到的是服务端已整理好的 {activity: ActivityEvent}，
// 所以这里从 ActivityEvent 的 JSON 形状开始（网页测试里 parseActivityEvent 之后的那一步）。
class ActivityTest {
    private fun event(json: String): ActivityEvent? = Activity.parseEvent(obj(json))
    private fun obj(json: String): JsonObject = NoteFableJson.parseToJsonElement(json).jsonObject
    private fun apply(vararg json: String) = Activity.apply(emptyList(), json.mapNotNull { event(it) })

    @Test
    fun `merges reasoning deltas from OpenAI summaries and DeepSeek reasoning text`() {
        val steps = apply(
            """{"type":"thought","id":"rs:0","delta":"**Plan**\n\n"}""",
            """{"type":"thought","id":"rs:0","delta":"Check docs."}""",
            """{"type":"thought","id":"ds:0","delta":"嗯，"}""",
        )
        assertEquals(
            listOf(ActivityStep.Thought("rs:0", "**Plan**\n\nCheck docs."), ActivityStep.Thought("ds:0", "嗯，")),
            steps,
        )
        assertEquals("Plan" to "Check docs.", Activity.splitThought((steps[0] as ActivityStep.Thought).text))
        assertEquals("" to "plain", Activity.splitThought("  plain  "))
    }

    @Test
    fun `turns a running web search into its finished action`() {
        val steps = apply(
            """{"type":"web","id":"ws","status":"running"}""",
            """{"type":"web","id":"ws","status":"done","action":{"kind":"open_page","url":"https://nextjs.org/docs"}}""",
        )
        assertEquals(listOf(ActivityStep.Web("ws", true, WebAction.OpenPage("https://nextjs.org/docs"))), steps)
    }

    @Test
    fun `turns a page edit proposal into a step and ignores malformed ones`() {
        val json = """{"type":"proposal","id":"pr1","pageId":"p1","pageTitle":"Notes","baseVersion":2,"changes":[{"op":"delete","block":1,"before":"x"}],"proposed":{"title":"Notes","blocks":[]}}"""
        val steps = apply(json)
        assertEquals(
            listOf(ActivityStep.ProposalStep(Proposal.Edit("pr1", "p1", "Notes", 2, changes = listOf(ProposalChange("delete", 1, before = "x"))))),
            steps,
        )
        assertNull(event(json.replace("\"baseVersion\":2", "\"baseVersion\":\"2\"")))
        assertNull(event(json.replace("""{"title":"Notes","blocks":[]}""", """{"title":"x"}""")))
    }

    @Test
    fun `turns a new page proposal into a step and ignores malformed ones`() {
        val json = """{"type":"create_proposal","id":"np1","title":"Plan","icon":null,"content":"- a","proposed":{"title":"Plan","icon":null,"blocks":[]}}"""
        assertEquals(listOf(ActivityStep.ProposalStep(Proposal.Create("np1", "Plan", null, "- a"))), apply(json))
        assertNull(event(json.replace("\"content\":\"- a\"", "\"content\":1")))
        assertNull(event(json.replace(""","blocks":[]}""", "}")))
    }

    @Test
    fun `reads the page kind, auto-apply, undo and status of a generic edit proposal`() {
        val json = """{"type":"proposal","id":"pr2","pageId":"s1","pageTitle":"Deck","baseVersion":4,"pageKind":"slides",""" +
            """"status":"applied","appliedPageId":"s1","autoApplied":true,"undoable":true,"changes":[""" +
            """{"op":"update","block":0,"target":{"type":"slide","number":2},"before":"Old","after":"New",""" +
            """"beforeImage":"/api/proposals/pr2/image?change=0&side=before","afterImage":"/api/proposals/pr2/image?change=0&side=after"},""" +
            """{"op":"add","block":0,"target":{"type":"elements","count":3}},""" +
            """{"op":"move","block":0,"target":{"type":"elements","count":1,"name":"Goal"}},""" +
            """{"op":"reorder","block":0,"target":{"type":"slide","number":"2"}},""" +
            """{"op":"explode","block":0,"target":{"type":"circle"}},{"block":1},7],"proposed":{"title":"Deck","blocks":[]}}"""
        val proposal = (apply(json).single() as ActivityStep.ProposalStep).proposal as Proposal.Edit
        assertEquals(PageKind.Slides, proposal.pageKind)
        assertEquals("applied", proposal.status)
        assertTrue(proposal.autoApplied)
        assertTrue(proposal.undoable)
        assertEquals(
            listOf(
                ProposalChange(
                    "update", 0, before = "Old", after = "New", target = ProposalTarget.Slide(2),
                    beforeImage = "/api/proposals/pr2/image?change=0&side=before", afterImage = "/api/proposals/pr2/image?change=0&side=after",
                ),
                ProposalChange("add", 0, target = ProposalTarget.Elements(3)),
                ProposalChange("move", 0, target = ProposalTarget.Elements(1, "Goal")),
                // 形状不对的对象丢掉，不认识（或没有）的操作按 update；不是对象的改动跳过。
                ProposalChange("reorder", 0),
                ProposalChange("update", 0),
                ProposalChange("update", 1),
            ),
            proposal.changes,
        )
    }

    @Test
    fun `an old edit proposal is a pending note proposal that cannot be undone`() {
        val json = """{"type":"proposal","id":"pr1","pageId":"p1","pageTitle":"Notes","baseVersion":2,"changes":[],"proposed":{"title":"Notes","blocks":[]}}"""
        val proposal = (apply(json).single() as ActivityStep.ProposalStep).proposal
        assertEquals(PageKind.Note, proposal.pageKind)
        assertEquals(false, proposal.autoApplied)
        assertEquals(false, proposal.undoable)
        assertNull(proposal.status)
        // 不认识的页面类型也按笔记；"undone" 原样保留。
        val undone = event(json.replace("\"changes\"", "\"pageKind\":\"mindmap\",\"status\":\"undone\",\"changes\"")) as ActivityEvent.ProposalEvent
        assertEquals(PageKind.Note, undone.proposal.pageKind)
        assertEquals("undone", undone.proposal.status)
    }

    @Test
    fun `only same-origin proposal image urls are kept`() {
        val json = """{"type":"proposal","id":"pr3","pageId":"w1","pageTitle":"Board","baseVersion":1,"pageKind":"whiteboard","changes":[""" +
            """{"op":"update","block":0,"beforeImage":"https://evil.example/x.png","afterImage":"//evil.example/y.png"},""" +
            """{"op":"update","block":0,"beforeImage":"/api/pages/covers?key=x","afterImage":5},""" +
            // 提案图片的接口也只收服务端给的那一种写法。
            """{"op":"update","block":0,"beforeImage":"/api/proposals/../pages/covers/image?change=0&side=after","afterImage":"/api/proposals/pr3/image?change=0&side=after&x=1"},""" +
            """{"op":"update","block":0,"beforeImage":"/api/proposals/pr 3/image?change=0&side=after","afterImage":"/api/proposals/pr3/image?change=0&side=after\n"},""" +
            """{"op":"update","block":0,"beforeImage":"/api/proposals/pr3\\x/image?change=0&side=before","afterImage":"/api/proposals/pr3/image?change=12345&side=before"},""" +
            """{"op":"update","block":0,"beforeImage":"/api/proposals/pr3/image?change=&side=before","afterImage":"/api/proposals/pr3/image?change=12&side=before"}""" +
            """],"proposed":{"title":"Board","blocks":[]}}"""
        val proposal = (apply(json).single() as ActivityStep.ProposalStep).proposal as Proposal.Edit
        assertEquals(
            List(5) { ProposalChange("update", 0) } + ProposalChange("update", 0, afterImage = "/api/proposals/pr3/image?change=12&side=before"),
            proposal.changes,
        )
    }

    @Test
    fun `reads the parent, kind and changes of a generic create proposal`() {
        val json = """{"type":"create_proposal","id":"np2","title":"Roadmap","icon":null,"content":"Q1 · Q2","pageKind":"whiteboard",""" +
            """"parentId":"p1","parentTitle":"","status":"undone","appliedPageId":"w9","changes":[""" +
            """{"op":"add","block":0,"target":{"type":"elements","count":4},"afterImage":"/api/proposals/np2/image?change=0&side=after"}],""" +
            """"proposed":{"title":"Roadmap","icon":null,"blocks":[]}}"""
        assertEquals(
            listOf(
                ActivityStep.ProposalStep(
                    Proposal.Create(
                        "np2", "Roadmap", null, "Q1 · Q2", status = "undone", appliedPageId = "w9", pageKind = PageKind.Whiteboard,
                        parentId = "p1", parentTitle = "",
                        changes = listOf(ProposalChange("add", 0, target = ProposalTarget.Elements(4), afterImage = "/api/proposals/np2/image?change=0&side=after")),
                    ),
                ),
            ),
            apply(json),
        )
        // 旧的新建提案没有父页面、改动和类型。
        val old = Activity.parseCreateProposal(obj("""{"id":"np1","title":"Plan","content":"","changes":"none","proposed":{"title":"Plan","blocks":[]}}"""))
        assertEquals(Proposal.Create("np1", "Plan", null, ""), old)
        // proposed.blocks 仍然必须是数组（旧版 App 同样要求）。
        assertNull(event(json.replace(""""blocks":[]""", """"blocks":null""")))
    }

    @Test
    fun `tracks a page tool from running to its finished label`() {
        val steps = apply(
            """{"type":"tool","id":"call1","name":"read_note","status":"running"}""",
            """{"type":"tool","id":"call1","name":"read_note","status":"done","label":"Read “Notes”"}""",
        )
        assertEquals(listOf(ActivityStep.Tool("call1", true, "read_note", "Read “Notes”")), steps)
        assertNull(event("""{"type":"tool","name":"read_note"}"""))
    }

    @Test
    fun `keeps only safe search sources`() {
        val steps = apply(
            """{"type":"web","id":"ws","status":"done","action":{"kind":"search","queries":["a","b"],"sources":["https://example.com/x","javascript:alert(1)"]}}""",
        )
        assertEquals(listOf(ActivityStep.Web("ws", true, WebAction.Search(listOf("a", "b"), listOf("https://example.com/x")))), steps)
    }

    @Test
    fun `restores stored progress steps`() {
        val raw = """[{"id":"rs:0","kind":"thought","text":"**Plan**\n\nCheck docs."},""" +
            """{"id":"ws","kind":"web","status":"done","action":{"kind":"search","queries":["a"],"sources":["https://example.com/x"]}},""" +
            """{"id":"call1","kind":"tool","status":"done","name":"read_note","label":"Read “Notes”"}]"""
        assertEquals(
            listOf(
                ActivityStep.Thought("rs:0", "**Plan**\n\nCheck docs."),
                ActivityStep.Web("ws", true, WebAction.Search(listOf("a"), listOf("https://example.com/x"))),
                ActivityStep.Tool("call1", true, "read_note", "Read “Notes”"),
            ),
            Activity.parseStored(raw),
        )
    }

    @Test
    fun `drops broken or unsafe stored activity`() {
        assertEquals(emptyList<ActivityStep>(), Activity.parseStored(null as String?))
        assertEquals(emptyList<ActivityStep>(), Activity.parseStored("not json"))
        assertEquals(emptyList<ActivityStep>(), Activity.parseStored("""{"a":1}"""))
        assertEquals(
            listOf(ActivityStep.Tool("t", true, "search_notes")),
            Activity.parseStored(
                """[{"id":"x","kind":"thought"},{"kind":"thought","text":"no id"},""" +
                    """{"id":"ws","kind":"web","status":"running","action":{"kind":"open_page","url":"javascript:alert(1)"}},""" +
                    """{"id":"t","kind":"tool","status":"running","name":"search_notes"}]""",
            ),
        )
    }

    @Test
    fun `does not restore a search that never finished`() {
        assertEquals(emptyList<ActivityStep>(), Activity.parseStored("""[{"id":"ws","kind":"web","status":"done"}]"""))
    }

    @Test
    fun `ignores events that are not activity`() {
        assertNull(event("""{"type":"response.output_text.delta","delta":"hi"}"""))
        assertNull(event("""{"type":"thought","id":"x","delta":""}"""))
        // 不安全的地址：搜索步骤保留，但没有 action。
        assertEquals(
            listOf(ActivityStep.Web("ws", true, null)),
            apply("""{"type":"web","id":"ws","status":"done","action":{"kind":"open_page","url":"file:///etc/passwd"}}"""),
        )
    }

    @Test
    fun `stores the request failure position`() {
        val steps = apply("""{"type":"failure","id":"request-failure","offset":5,"detail":"Boom"}""")
        assertEquals(listOf(ActivityStep.Failure("request-failure", FailureInfo(5, "Boom"))), steps)
        assertEquals(emptyList<ActivityStep>(), steps.progressSteps())
    }

    // ---- 项目上下文 ----

    private val context = """{"type":"context","id":"project-context","projectName":"Mail","hasInstructions":true,""" +
        """"notes":[{"id":"n1","title":"Style guide"},{"id":"n2","title":"Long note","truncated":true}]}"""
    private val contextStep = ActivityStep.Context(
        "project-context",
        ContextInfo("Mail", true, listOf(ContextNote("n1", "Style guide"), ContextNote("n2", "Long note", truncated = true))),
    )

    @Test
    fun `turns the project context into a step that is restored with the answer`() {
        val steps = apply(context, """{"type":"thought","id":"rs:0","delta":"Plan"}""")
        assertEquals(listOf(contextStep, ActivityStep.Thought("rs:0", "Plan")), steps)
        val stored = """[{"id":"project-context","kind":"context","projectName":"Mail","hasInstructions":true,""" +
            """"notes":[{"id":"n1","title":"Style guide"},{"id":"n2","title":"Long note","truncated":true}]},{"id":"rs:0","kind":"thought","text":"Plan"}]"""
        assertEquals(steps, Activity.parseStored(stored))
    }

    @Test
    fun `replaces the step when the same context arrives again`() {
        val steps = apply(context, """{"type":"context","id":"project-context","projectName":"Mail","hasInstructions":true,"notes":[{"id":"n3","title":"New"}]}""")
        assertEquals(1, steps.size)
        assertEquals(listOf(ContextNote("n3", "New")), (steps[0] as ActivityStep.Context).info.notes)
    }

    @Test
    fun `caps strings and the number of notes, and drops malformed notes`() {
        val notes = buildList {
            add("""{"id":"a","title":"${"T".repeat(500)}"}""")
            add("""{"id":"a","title":"duplicate"}""")
            add("""{"id":"","title":"no id"}""")
            add("""{"id":"b","title":5}""")
            add("""{"id":"${"c".repeat(101)}","title":"long id"}""")
            add("""{"id":"d","title":"","truncated":"yes"}""")
            repeat(20) { add("""{"id":"n$it","title":"Note $it"}""") }
        }.joinToString(",")
        val step = apply("""{"type":"context","id":"project-context","projectName":"${"P".repeat(500)}","hasInstructions":false,"notes":[$notes]}""")
            .single() as ActivityStep.Context
        assertEquals(300, step.info.projectName.length)
        assertEquals(10, step.info.notes.size)
        assertEquals(listOf(ContextNote("a", "T".repeat(300)), ContextNote("d", "Untitled")), step.info.notes.take(2))
    }

    @Test
    fun `ignores a context with nothing to show`() {
        assertNull(event("""{"type":"context","id":"project-context","projectName":"Mail","hasInstructions":false,"notes":[]}"""))
        assertNull(event("""{"type":"context","id":"project-context","projectName":" ","hasInstructions":true,"notes":[]}"""))
    }

    @Test
    fun `drops malformed stored context but keeps what is valid`() {
        val raw = """[{"id":"project-context","kind":"context","projectName":5,"hasInstructions":true,"notes":[]},""" +
            """{"id":"x","kind":"context","projectName":"A","hasInstructions":false,"notes":"none"},""" +
            """{"id":"y","kind":"context","projectName":"B","hasInstructions":true,"notes":"none"},""" +
            """{"id":"z","kind":"context","projectName":"C","hasInstructions":false,"notes":[{"id":"n1","title":"Ok","truncated":true},null,{"id":3}]}]"""
        assertEquals(
            listOf(
                ActivityStep.Context("y", ContextInfo("B", true, emptyList())),
                ActivityStep.Context("z", ContextInfo("C", false, listOf(ContextNote("n1", "Ok", truncated = true)))),
            ),
            Activity.parseStored(raw),
        )
    }

    @Test
    fun `summarizes searches, sources, note lookups and project context`() {
        val steps = apply(
            context,
            """{"type":"web","id":"w1","status":"done","action":{"kind":"search","queries":["a","b"],"sources":["https://x.com/1","https://x.com/2"]}}""",
            """{"type":"web","id":"w2","status":"done","action":{"kind":"open_page","url":"https://x.com/1"}}""",
            """{"type":"web","id":"w3","status":"done","action":{"kind":"search","queries":[],"sources":[]}}""",
            """{"type":"tool","id":"t1","name":"search_notes","status":"done"}""",
        )
        assertEquals(ActivitySummary(searches = 3, sources = 2, noteLookups = 1, projectNotes = 2, projectInstructions = true), ActivitySummary.of(steps))
    }

    @Test
    fun `stored proposals come first and live ones are added once`() {
        val stored = Activity.parseStoredProposals(
            NoteFableJson.parseToJsonElement(
                """[{"kind":"proposal","id":"pr1","pageId":"p1","pageTitle":"Notes","baseVersion":2,"changes":[],"proposed":{"title":"Notes","blocks":[]},""" +
                    """"status":"applied","appliedPageId":"p1","pageKind":"note","undoable":true}]""",
            ),
        )
        assertEquals("applied", stored.single().status)
        assertTrue(stored.single().undoable)
        val live = apply(
            """{"type":"proposal","id":"pr1","pageId":"p1","pageTitle":"Notes","baseVersion":2,"changes":[],"proposed":{"title":"Notes","blocks":[]}}""",
            """{"type":"create_proposal","id":"np1","title":"Plan","content":"","proposed":{"title":"Plan","blocks":[]}}""",
        )
        val merged = mergeProposals(stored, live)
        assertEquals(listOf("pr1", "np1"), merged.map { it.id })
        assertEquals("applied", merged[0].status)
        assertTrue(live.progressSteps().isEmpty())
    }

    @Test
    fun `host drops www`() {
        assertEquals("example.com", Activity.hostOf("https://www.example.com/a"))
        assertEquals("not a url", Activity.hostOf("not a url"))
    }
}
