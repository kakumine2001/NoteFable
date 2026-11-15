# kotlinx.serialization 的生成序列化器靠反射查找伴生对象，保留它们。
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.kakumine.notefable.**$$serializer { *; }
-keepclassmembers class com.kakumine.notefable.** { *** Companion; }
-keepclasseswithmembers class com.kakumine.notefable.** { kotlinx.serialization.KSerializer serializer(...); }
-dontwarn org.slf4j.**
