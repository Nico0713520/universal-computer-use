# Universal Computer Use Plugin

A lightweight local MCP bridge that lets a compatible multimodal agent observe and operate the current desktop. The host agent supplies the vision model and decision loop; this package supplies the protocol, validation, lifecycle, and execution bridge.

Cua Driver is a separate MIT-licensed runtime dependency. Its Rust and native platform code are not bundled as product source, modified, or re-signed by this project. The exact reviewed runtime and installer artifacts are pinned in `engine.lock.json`.

The initial `0.1.0` package is under active implementation and is not yet eligible for public macOS or Windows installation.
