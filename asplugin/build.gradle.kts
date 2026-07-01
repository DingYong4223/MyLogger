plugins {
    kotlin("jvm") version "2.2.21"
    id("org.jetbrains.intellij.platform") version "2.17.0"
}

group = "com.dingyong.mylogger"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        local("/Applications/Android Studio.app")
    }
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    pluginConfiguration {
        id = "com.dingyong.mylogger.asplugin"
        name = "MyLogger Android Studio Plugin"
        version = project.version.toString()

        ideaVersion {
            sinceBuild = "252"
            untilBuild = "252.*"
        }
    }
}
