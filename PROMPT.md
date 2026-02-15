Add new project/folder protoc-gen-kaja. This is a Go port of protoc-gen-ts. The idea is to get rid of the need to bundle Node.js runtime. Start by building the test harness and agentic loop.

- Generate 10 protobuf projects covering different features of the language
- Add test script that runs protoc-gen-ts and protoc-gen-kaja on each and compares the output to the exact byte
- Add Ralph hook that will force you to keep coding until all tests pass
- Add the necessary diff output tooling so you know what's missing
- Only support the plugin params that are used by kaja today
- Read the JS plugin source https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin for inspiration
- You can break the code into multiple files if it starts getting long. i.e. you can generate utilities for writing TS files.