package com.kakumine.studymate.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class EmojiCatalogTest {
    private val json = """
        {"categories":["suggested","smileys_people","animals_nature"],
         "icons":{"suggested":{"viewBox":[160,0,20,20],"shapes":[{"d":"M0 0h1","fill":true,"stroke":false,"strokeWidth":1,"round":false,"evenOdd":false}]}},
         "emojis":[
          {"u":"1f600","c":1,"n":{"en":["face","Grinning Face"],"zh":["笑脸"],"zh-Hant":["笑臉"],"ja":["笑顔"]}},
          {"u":"1f44b","c":1,"v":["1f44b-1f3fb","1f44b-1f3ff"],"n":{"en":["wave","waving hand"],"zh":["挥手"],"zh-Hant":["揮手"],"ja":["手を振る"]}},
          {"u":"1f408","c":2,"n":{"en":["cat"],"zh":["猫"],"zh-Hant":["貓"],"ja":["ねこ"]}}
         ]}
    """.trimIndent()

    @Test
    fun `parses the locale's keywords and searches them like emoji-picker-react`() {
        val en = EmojiCatalog.parse(json, "en")
        assertEquals(listOf("suggested", "smileys_people", "animals_nature"), en.categories)
        assertEquals(listOf("face", "grinning face"), en.find("1f600")?.names)
        assertEquals("grinning face", en.find("1f600")?.label)
        val match = en.matcher("  GRIN ")!!
        assertEquals(listOf("1f600"), en.emojis.filter(match).map { it.unified })
        assertNull(en.matcher("   "))

        val zh = EmojiCatalog.parse(json, "zh")
        assertEquals(listOf("1f408"), zh.emojis.filter(zh.matcher("猫")!!).map { it.unified })
        val hant = EmojiCatalog.parse(json, "zh-Hant")
        assertEquals(listOf("1f408"), hant.emojis.filter(hant.matcher("貓")!!).map { it.unified })
        // 不认识的语言用英文。
        assertEquals(listOf("cat"), EmojiCatalog.parse(json, "fr").find("1f408")?.names)
    }

    @Test
    fun `skin tones pick the matching variation and variations resolve to their base emoji`() {
        val catalog = EmojiCatalog.parse(json, "en")
        val wave = catalog.find("1f44b")!!
        assertEquals("1f44b", wave.unifiedFor(SkinTone.Neutral))
        assertEquals("1f44b-1f3fb", wave.unifiedFor(SkinTone.Light))
        assertEquals("1f44b-1f3ff", wave.unifiedFor(SkinTone.Dark))
        // 没有这个肤色的变体时用原样。
        assertEquals("1f44b", wave.unifiedFor(SkinTone.Medium))
        assertEquals(wave, catalog.find("1F44B-1F3FB"))
        assertEquals("👋🏻", unifiedToEmoji("1f44b-1f3fb"))
    }

    @Test
    fun `hides emoji the device font cannot draw`() {
        val catalog = EmojiCatalog.parse(json, "en") { it != unifiedToEmoji("1f408") && it != unifiedToEmoji("1f44b-1f3ff") }
        assertNull(catalog.find("1f408"))
        assertEquals(listOf("1f44b-1f3fb"), catalog.find("1f44b")?.variations)
    }

    @Test
    fun `recently used keeps the newest first, without duplicates, at most 14`() {
        var recent = emptyList<String>()
        (1..16).forEach { recent = pushRecentEmoji(recent, "e$it") }
        assertEquals(RECENT_EMOJI_LIMIT, recent.size)
        assertEquals("e16", recent.first())
        recent = pushRecentEmoji(recent, "e10")
        assertEquals("e10", recent.first())
        assertEquals(1, recent.count { it == "e10" })
    }

    @Test
    fun `the bundled asset parses with every category, icon and language`() {
        val asset = File("src/main/assets/emoji.json").readText()
        val catalog = EmojiCatalog.parse(asset, "ja")
        assertEquals(1906, catalog.emojis.size)
        assertEquals("suggested", catalog.categories.first())
        for (name in catalog.categories + listOf("search", "clear")) assertNotNull(name, catalog.icons[name])
        assertTrue(catalog.emojis.filter(catalog.matcher("ネコ")!!).isNotEmpty())
        assertTrue(catalog.inCategory("flags").isNotEmpty())
    }
}
