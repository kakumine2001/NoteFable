package com.kakumine.studymate.data

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
    private fun obj(json: String): JsonObject = StudyMateJson.parseToJsonElement(json).jsonObject
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
            StudyMateJson.parseToJsonElement(
                """[{"kind":"proposal","id":"pr1","pageId":"p1","pageTitle":"Notes","baseVersion":2,"changes":[],"proposed":{"title":"Notes","blocks":[]},"status":"applied"}]""",
            ),
        )
        assertEquals("applied", stored.single().status)
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
