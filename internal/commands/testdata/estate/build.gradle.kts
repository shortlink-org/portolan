plugins {
    id("org.springframework.boot") version "4.1.1"
    application
}

tasks.register<Exec>("generateProto") {
    description = "Regenerate the gRPC stubs"
    commandLine("buf", "generate")
}

tasks.register("_shared") {
    doLast { println("hidden") }
}

val smokeTest by tasks.registering(Test::class) {
    description = "Run the tests that need the compose stack"
}

task legacyTask {
    doLast { println("old syntax") }
}
